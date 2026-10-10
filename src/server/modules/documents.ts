import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { and, desc, eq, isNull } from "drizzle-orm";
import type { DB } from "../db/client";
import { documents, orders, purchaseOrders, quotes, suppliers, users } from "../db/schema";
import { can, type Actor } from "../authz/policy";
import type { Permission } from "../authz/permissions";
import { forbidden, invalid, notFound } from "../lib/errors";
import { audit } from "./audit";
import { operatorOrgId } from "./settings";

/**
 * Secure document storage.
 * - Files live outside the web root and outside the deployed app folder (UPLOAD_DIR), under random names.
 * - Types are checked by content (magic bytes), not by the browser's claim or the file extension alone.
 * - Every download is permission-checked and served as an attachment with nosniff.
 */
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

export type EntityType = "order" | "quote" | "purchase_order" | "supplier";
export const ENTITY_TYPES: EntityType[] = ["order", "quote", "purchase_order", "supplier"];

const TYPES = {
  pdf: { mime: "application/pdf", check: (b: Buffer) => b.subarray(0, 5).toString("latin1") === "%PDF-" },
  png: { mime: "image/png", check: (b: Buffer) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  jpg: { mime: "image/jpeg", check: (b: Buffer) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  jpeg: { mime: "image/jpeg", check: (b: Buffer) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  webp: { mime: "image/webp", check: (b: Buffer) => b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP" },
  docx: { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", check: isZip },
  xlsx: { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", check: isZip },
  csv: { mime: "text/csv", check: isPlainText },
  txt: { mime: "text/plain", check: isPlainText },
} as const satisfies Record<string, { mime: string; check: (b: Buffer) => boolean }>;
export const ALLOWED_EXTENSIONS = Object.keys(TYPES);

function isZip(b: Buffer) {
  return b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;
}
function isPlainText(b: Buffer) {
  const head = b.subarray(0, 8192);
  if (head.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(head.subarray(0, Math.max(0, head.length - 4)));
    return true;
  } catch {
    return false;
  }
}

/** Keeps a readable, safe display name: no paths, control characters or leading dots. */
export function sanitizeFileName(name: string) {
  const base = name.split(/[\\/]/).pop() ?? "file";
  const cleaned = base
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "")
    .replace(/\s+/g, " ")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 120);
  return cleaned || "file";
}

export function detectType(fileName: string, bytes: Buffer) {
  const ext = path.extname(fileName).slice(1).toLowerCase() as keyof typeof TYPES;
  const t = TYPES[ext];
  if (!t) throw invalid(`File type not allowed. Allowed: ${ALLOWED_EXTENSIONS.join(", ")}.`);
  if (!t.check(bytes)) throw invalid("The file's contents do not match its type.");
  return t.mime;
}

/**
 * Where files are stored. Production defaults to a folder *beside* the app (../ses-data/uploads),
 * because each deployment replaces the app folder and would otherwise delete uploads.
 */
export function uploadRoot() {
  const fallback = process.env.NODE_ENV === "production" ? "../ses-data/uploads" : ".data/uploads";
  return path.resolve(/*turbopackIgnore: true*/ process.env.UPLOAD_DIR || fallback);
}

function pathFor(storageKey: string) {
  if (!/^[a-f0-9]{48}$/.test(storageKey)) throw new Error("Invalid storage key");
  return path.join(/*turbopackIgnore: true*/ uploadRoot(), storageKey.slice(0, 2), storageKey);
}

/** Permissions needed to see documents attached to each kind of record (operator side). */
const ENTITY_READ: Record<EntityType, Permission> = {
  order: "orders.read",
  quote: "quotes.read",
  purchase_order: "procurement.read",
  supplier: "procurement.read",
};

/** Resolves the owning organisation of a record, and whether customers may ever see its documents. */
async function entityOwner(db: DB, type: EntityType, id: string): Promise<{ organizationId: string; customerFacing: boolean }> {
  if (type === "order") {
    const [o] = await db.select({ org: orders.customerOrgId }).from(orders).where(eq(orders.id, id));
    if (!o) throw notFound("Record not found.");
    return { organizationId: o.org, customerFacing: true };
  }
  if (type === "quote") {
    const [q] = await db.select({ org: quotes.customerOrgId }).from(quotes).where(eq(quotes.id, id));
    if (!q) throw notFound("Record not found.");
    return { organizationId: q.org, customerFacing: true };
  }
  if (type === "purchase_order") {
    const [p] = await db.select({ id: purchaseOrders.id }).from(purchaseOrders).where(eq(purchaseOrders.id, id));
    if (!p) throw notFound("Record not found.");
  } else {
    const [s] = await db.select({ id: suppliers.id }).from(suppliers).where(eq(suppliers.id, id));
    if (!s) throw notFound("Record not found.");
  }
  return { organizationId: await operatorOrgId(db), customerFacing: false };
}

function canStaffSee(actor: Actor, type: EntityType) {
  return can(actor, "documents.read") && can(actor, ENTITY_READ[type]);
}

export async function uploadDocument(
  db: DB,
  actor: Actor,
  input: { entityType: string; entityId: string; fileName: string; bytes: Buffer; visibility: string },
) {
  if (!ENTITY_TYPES.includes(input.entityType as EntityType)) throw invalid("Unknown record type.");
  const type = input.entityType as EntityType;
  if (!can(actor, "documents.write") || !can(actor, ENTITY_READ[type])) throw forbidden();
  if (input.bytes.length === 0) throw invalid("The file is empty.");
  if (input.bytes.length > MAX_UPLOAD_BYTES) throw invalid(`Files must be ${MAX_UPLOAD_BYTES / 1024 / 1024} MB or smaller.`);
  const owner = await entityOwner(db, type, input.entityId);
  const visibility = input.visibility === "customer" && owner.customerFacing ? "customer" : "internal";
  const fileName = sanitizeFileName(input.fileName);
  const contentType = detectType(fileName, input.bytes);

  const storageKey = randomBytes(24).toString("hex");
  const target = pathFor(storageKey);
  await mkdir(path.dirname(target), { recursive: true });
  const tmp = `${target}.tmp`;
  await writeFile(tmp, input.bytes, { mode: 0o600 });
  await rename(tmp, target);
  try {
    const [doc] = await db
      .insert(documents)
      .values({
        organizationId: owner.organizationId,
        entityType: type,
        entityId: input.entityId,
        fileName,
        contentType,
        sizeBytes: input.bytes.length,
        sha256: createHash("sha256").update(input.bytes).digest("hex"),
        storageKey,
        visibility,
        uploadedBy: actor.userId,
      })
      .returning();
    await audit(db, { actor, action: "document.uploaded", targetType: type, targetId: input.entityId, data: { documentId: doc!.id, fileName, visibility, sizeBytes: input.bytes.length } });
    return doc!;
  } catch (err) {
    await unlink(target).catch(() => {});
    throw err;
  }
}

/** Documents attached to a record that this actor may see. */
export async function listDocuments(db: DB, actor: Actor, entityType: EntityType, entityId: string) {
  const rows = await db
    .select({ d: documents, uploaderName: users.name })
    .from(documents)
    .innerJoin(users, eq(users.id, documents.uploadedBy))
    .where(and(eq(documents.entityType, entityType), eq(documents.entityId, entityId), isNull(documents.deletedAt)))
    .orderBy(desc(documents.createdAt));
  if (canStaffSee(actor, entityType)) return rows;
  return rows.filter(
    ({ d }) => d.visibility === "customer" && d.organizationId === actor.organizationId && can(actor, "customer.documents.read", { organizationId: d.organizationId }),
  );
}

/** Returns the file for download after checking access; never reveals whether an inaccessible document exists. */
export async function readDocument(db: DB, actor: Actor, documentId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(documentId)) throw notFound("Document not found.");
  const [d] = await db.select().from(documents).where(and(eq(documents.id, documentId), isNull(documents.deletedAt)));
  if (!d) throw notFound("Document not found.");
  const staff = canStaffSee(actor, d.entityType as EntityType);
  const customer =
    d.visibility === "customer" && d.organizationId === actor.organizationId && can(actor, "customer.documents.read", { organizationId: d.organizationId });
  if (!staff && !customer) throw notFound("Document not found.");
  const bytes = await readFile(pathFor(d.storageKey));
  await audit(db, { actor, action: "document.downloaded", targetType: d.entityType, targetId: d.entityId, data: { documentId: d.id } });
  return { doc: d, bytes };
}

/** Soft delete (the file is kept for audit until retention clean-up). */
export async function deleteDocument(db: DB, actor: Actor, documentId: string) {
  const [d] = await db.select().from(documents).where(and(eq(documents.id, documentId), isNull(documents.deletedAt)));
  if (!d) throw notFound("Document not found.");
  if (!can(actor, "documents.write") || !can(actor, ENTITY_READ[d.entityType as EntityType])) throw forbidden();
  await db.update(documents).set({ deletedAt: new Date(), deletedBy: actor.userId }).where(eq(documents.id, documentId));
  await audit(db, { actor, action: "document.deleted", targetType: d.entityType, targetId: d.entityId, data: { documentId, fileName: d.fileName } });
  return d;
}

/** RFC 6266/5987 Content-Disposition that is safe for any file name. */
export function contentDisposition(fileName: string) {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
