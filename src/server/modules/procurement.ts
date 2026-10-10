import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "../db/client";
import {
  approvalRequests,
  goodsReceiptLines,
  goodsReceipts,
  productVariants,
  products,
  purchaseOrderLines,
  purchaseOrders,
  stockLevels,
  stockLocations,
  suppliers,
  users,
} from "../db/schema";
import { authorize, type Actor } from "../authz/policy";
import { conflict, forbidden, invalid, notFound } from "../lib/errors";
import { formatMoney } from "../lib/money";
import { audit } from "./audit";
import { publish } from "./events";
import { recordMovement } from "./inventory";
import { sendMail } from "./mail";
import { getSettings, nextNumber, operatorOrgId } from "./settings";

// ───────────────────────────── Suppliers ─────────────────────────────

export const supplierInput = z.object({
  name: z.string().trim().min(2).max(160),
  contactName: z.string().trim().max(120).optional().default(""),
  email: z.union([z.literal(""), z.string().trim().toLowerCase().email()]).optional().default(""),
  phone: z.string().trim().max(40).optional().default(""),
  address: z.string().trim().max(500).optional().default(""),
  taxId: z.string().trim().max(40).optional().default(""),
  paymentTermsDays: z.number().int().min(0).max(365).default(30),
  notes: z.string().trim().max(2000).optional().default(""),
  active: z.boolean().default(true),
});


export async function listSuppliers(db: DB, actor: Actor) {
  authorize(actor, "procurement.read");
  return db.select().from(suppliers).orderBy(desc(suppliers.active), asc(suppliers.name));
}

export async function saveSupplier(db: DB, actor: Actor, id: string | null, input: z.input<typeof supplierInput>) {
  authorize(actor, "procurement.write");
  const p = supplierInput.parse(input);
  const orNull = (v: string) => v || null;
  const data = {
    name: p.name,
    contactName: orNull(p.contactName),
    email: orNull(p.email),
    phone: orNull(p.phone),
    address: orNull(p.address),
    taxId: orNull(p.taxId),
    paymentTermsDays: p.paymentTermsDays,
    notes: orNull(p.notes),
    active: p.active,
  };
  if (id) {
    const [before] = await db.select().from(suppliers).where(eq(suppliers.id, id));
    if (!before) throw notFound("Supplier not found.");
    await db.update(suppliers).set(data).where(eq(suppliers.id, id));
    await audit(db, { actor, action: "supplier.updated", targetType: "supplier", targetId: id, data: { name: data.name } });
    return id;
  }
  const [row] = await db.insert(suppliers).values(data).returning();
  await audit(db, { actor, action: "supplier.created", targetType: "supplier", targetId: row!.id, data: { name: data.name } });
  return row!.id;
}

// ───────────────────────────── Purchase orders ─────────────────────────────

export const poInput = z.object({
  supplierId: z.string().uuid("Choose a supplier."),
  locationId: z.string().uuid("Choose where goods will be received."),
  expectedAt: z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]).optional().default(""),
  notes: z.string().trim().max(2000).optional().default(""),
  lines: z
    .array(
      z.object({
        variantId: z.string().uuid().nullable().optional(),
        description: z.string().trim().max(300).optional().default(""),
        quantity: z.number().int().min(1).max(1_000_000),
        unitCostMinor: z.number().int().min(0).max(100_000_000_000),
      }),
    )
    .min(1, "Add at least one line."),
});

export async function listPurchaseOrders(db: DB, actor: Actor) {
  authorize(actor, "procurement.read");
  return db
    .select({ po: purchaseOrders, supplierName: suppliers.name })
    .from(purchaseOrders)
    .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
    .orderBy(desc(purchaseOrders.createdAt))
    .limit(500);
}

export async function getPurchaseOrder(db: DB, actor: Actor, id: string) {
  authorize(actor, "procurement.read");
  const [row] = await db
    .select({ po: purchaseOrders, supplier: suppliers, locationName: stockLocations.name, creatorName: users.name })
    .from(purchaseOrders)
    .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
    .innerJoin(stockLocations, eq(stockLocations.id, purchaseOrders.locationId))
    .innerJoin(users, eq(users.id, purchaseOrders.createdBy))
    .where(eq(purchaseOrders.id, id));
  if (!row) throw notFound("Purchase order not found.");
  const lines = await db
    .select({ line: purchaseOrderLines, sku: productVariants.sku })
    .from(purchaseOrderLines)
    .leftJoin(productVariants, eq(productVariants.id, purchaseOrderLines.variantId))
    .where(eq(purchaseOrderLines.purchaseOrderId, id))
    .orderBy(asc(purchaseOrderLines.sortOrder));
  const receipts = await db
    .select({ r: goodsReceipts, receiverName: users.name })
    .from(goodsReceipts)
    .innerJoin(users, eq(users.id, goodsReceipts.receivedBy))
    .where(eq(goodsReceipts.purchaseOrderId, id))
    .orderBy(desc(goodsReceipts.createdAt));
  const approvals = await db
    .select()
    .from(approvalRequests)
    .where(and(eq(approvalRequests.subjectType, "purchase_order"), eq(approvalRequests.subjectId, id)))
    .orderBy(desc(approvalRequests.createdAt));
  return { ...row, lines, receipts, approvals };
}

export async function createPurchaseOrder(db: DB, actor: Actor, input: z.input<typeof poInput>) {
  authorize(actor, "procurement.write");
  const data = poInput.parse(input);
  const s = await getSettings(db);
  const [supplier] = await db.select().from(suppliers).where(eq(suppliers.id, data.supplierId));
  if (!supplier?.active) throw invalid("Choose an active supplier.");
  const [loc] = await db.select().from(stockLocations).where(eq(stockLocations.id, data.locationId));
  if (!loc || loc.connectionId) throw invalid("Goods can only be received into an SES location.");

  const variantIds = data.lines.flatMap((l) => (l.variantId ? [l.variantId] : []));
  const variants = variantIds.length
    ? await db
        .select({ v: productVariants, productName: products.name })
        .from(productVariants)
        .innerJoin(products, eq(products.id, productVariants.productId))
        .where(inArray(productVariants.id, variantIds))
    : [];
  const lines = data.lines.map((l, i) => {
    if (l.variantId) {
      const v = variants.find((x) => x.v.id === l.variantId);
      if (!v) throw invalid("A selected product no longer exists.");
      if (!v.v.tracksStock) throw invalid(`${v.v.sku} does not track stock; add it as a description-only line.`);
      return { variantId: v.v.id, description: l.description || `${v.productName} — ${v.v.name} (${v.v.sku})`, quantity: l.quantity, unitCostMinor: l.unitCostMinor, lineTotalMinor: l.quantity * l.unitCostMinor, sortOrder: i };
    }
    if (l.description.length < 3) throw invalid("Describe each line that is not a catalogue product.");
    return { variantId: null, description: l.description, quantity: l.quantity, unitCostMinor: l.unitCostMinor, lineTotalMinor: l.quantity * l.unitCostMinor, sortOrder: i };
  });
  const totalMinor = lines.reduce((a, l) => a + l.lineTotalMinor, 0);
  const po = await db.transaction(async (tx) => {
    const [po] = await tx
      .insert(purchaseOrders)
      .values({
        number: await nextNumber(tx, "PO"),
        supplierId: supplier.id,
        currency: supplier.currency ?? s.defaultCurrency,
        totalMinor,
        locationId: loc.id,
        expectedAt: data.expectedAt ? new Date(`${data.expectedAt}T00:00:00Z`) : null,
        notes: data.notes || null,
        createdBy: actor.userId,
      })
      .returning();
    await tx.insert(purchaseOrderLines).values(lines.map((l) => ({ ...l, purchaseOrderId: po!.id })));
    await audit(tx, { actor, action: "po.created", targetType: "purchase_order", targetId: po!.id, data: { number: po!.number, totalMinor } });
    return po!;
  });
  return po;
}

async function lockPo(tx: DB, id: string) {
  const [po] = await tx.select().from(purchaseOrders).where(eq(purchaseOrders.id, id)).for("update");
  if (!po) throw notFound("Purchase order not found.");
  return po;
}

/** Draft → approved, or → pending_approval when at or above the purchase approval threshold. */
export async function submitPurchaseOrder(db: DB, actor: Actor, id: string) {
  authorize(actor, "procurement.write");
  const s = await getSettings(db);
  const status = await db.transaction(async (tx) => {
    const po = await lockPo(tx, id);
    if (po.status !== "draft") throw conflict(`Only draft purchase orders can be submitted (this one is ${po.status.replace("_", " ")}).`);
    if (po.totalMinor >= s.poApprovalThresholdMinor) {
      await tx.update(purchaseOrders).set({ status: "pending_approval" }).where(eq(purchaseOrders.id, id));
      await tx.insert(approvalRequests).values({
        organizationId: await operatorOrgId(tx),
        type: "po.approval",
        subjectType: "purchase_order",
        subjectId: id,
        summary: `Purchase order ${po.number}: ${formatMoney(po.totalMinor, po.currency)} (limit ${formatMoney(s.poApprovalThresholdMinor)})`,
        payload: { number: po.number, totalMinor: po.totalMinor, currency: po.currency },
        requestedBy: actor.userId,
      });
      await audit(tx, { actor, action: "po.submitted_for_approval", targetType: "purchase_order", targetId: id });
      return "pending_approval" as const;
    }
    await tx.update(purchaseOrders).set({ status: "approved", approvedAt: new Date() }).where(eq(purchaseOrders.id, id));
    await audit(tx, { actor, action: "po.auto_approved", targetType: "purchase_order", targetId: id });
    return "approved" as const;
  });
  publish({ topic: "approvals" });
  return status;
}

/** Called by the approvals module inside its transaction. */
export async function applyPoDecision(tx: DB, poId: string, approved: boolean, approverId: string) {
  const po = await lockPo(tx, poId);
  if (po.status !== "pending_approval") throw conflict("Purchase order is no longer awaiting approval.");
  if (po.createdBy === approverId) throw forbidden("You cannot approve a purchase order you created.");
  await tx
    .update(purchaseOrders)
    .set(approved ? { status: "approved", approvedBy: approverId, approvedAt: new Date() } : { status: "rejected" })
    .where(eq(purchaseOrders.id, poId));
}

/** Marks the PO as sent and, if the supplier has an e-mail address, e-mails them the order. */
export async function sendPurchaseOrder(db: DB, actor: Actor, id: string) {
  authorize(actor, "procurement.write");
  const s = await getSettings(db);
  const { po, supplier, lines } = await db.transaction(async (tx) => {
    const po = await lockPo(tx, id);
    if (po.status !== "approved") throw conflict("Only approved purchase orders can be sent.");
    await tx.update(purchaseOrders).set({ status: "sent", sentAt: new Date() }).where(eq(purchaseOrders.id, id));
    const [supplier] = await tx.select().from(suppliers).where(eq(suppliers.id, po.supplierId));
    const lines = await tx.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.purchaseOrderId, id)).orderBy(asc(purchaseOrderLines.sortOrder));
    await audit(tx, { actor, action: "po.sent", targetType: "purchase_order", targetId: id, data: { emailed: !!supplier?.email } });
    return { po, supplier: supplier!, lines };
  });
  if (supplier.email) {
    const body = [
      `Dear ${supplier.contactName ?? supplier.name},`,
      "",
      `Please supply the following under purchase order ${po.number}:`,
      "",
      ...lines.map((l) => `- ${l.quantity} × ${l.description} @ ${formatMoney(l.unitCostMinor, po.currency)} = ${formatMoney(l.lineTotalMinor, po.currency)}`),
      "",
      `Total: ${formatMoney(po.totalMinor, po.currency)}`,
      po.expectedAt ? `Requested delivery: ${po.expectedAt.toISOString().slice(0, 10)}` : "",
      po.notes ? `Notes: ${po.notes}` : "",
      "",
      `Please quote ${po.number} on your delivery note and invoice.`,
      "",
      s.companyName,
      `${s.supportEmail} · ${s.supportPhone}`,
    ]
      .filter((x) => x !== null)
      .join("\n");
    await sendMail(db, { to: supplier.email, subject: `Purchase order ${po.number} — ${s.companyName}`, body });
  }
  return { emailed: !!supplier.email };
}

export async function cancelPurchaseOrder(db: DB, actor: Actor, id: string, reason: string) {
  authorize(actor, "procurement.write");
  if (reason.trim().length < 3) throw invalid("Give a reason for cancelling.");
  await db.transaction(async (tx) => {
    const po = await lockPo(tx, id);
    if (!["draft", "pending_approval", "approved", "sent"].includes(po.status)) throw conflict("This purchase order can no longer be cancelled.");
    const [received] = await tx
      .select({ n: sql<number>`coalesce(sum(${purchaseOrderLines.receivedQuantity}), 0)::int` })
      .from(purchaseOrderLines)
      .where(eq(purchaseOrderLines.purchaseOrderId, id));
    if ((received?.n ?? 0) > 0) throw conflict("Goods have already been received against this order.");
    await tx.update(purchaseOrders).set({ status: "cancelled" }).where(eq(purchaseOrders.id, id));
    await tx
      .update(approvalRequests)
      .set({ status: "cancelled", decidedAt: new Date() })
      .where(and(eq(approvalRequests.subjectId, id), eq(approvalRequests.status, "pending")));
    await audit(tx, { actor, action: "po.cancelled", targetType: "purchase_order", targetId: id, data: { reason } });
  });
}

export const receiptInput = z.object({
  notes: z.string().trim().max(1000).optional().default(""),
  lines: z.array(z.object({ lineId: z.string().uuid(), quantity: z.number().int().min(0) })).min(1),
});

/**
 * Goods receipt: adds stock at the PO's location, writes the stock ledger and moves the PO to
 * partially_received / received. Over-receipt is refused.
 */
export async function receiveGoods(db: DB, actor: Actor, id: string, input: z.input<typeof receiptInput>) {
  authorize(actor, "procurement.receive");
  const data = receiptInput.parse(input);
  const wanted = data.lines.filter((l) => l.quantity > 0);
  if (wanted.length === 0) throw invalid("Enter at least one received quantity.");
  const result = await db.transaction(async (tx) => {
    const po = await lockPo(tx, id);
    if (!["sent", "partially_received", "approved"].includes(po.status)) throw conflict("Goods can only be received against an approved or sent purchase order.");
    const lines = await tx.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.purchaseOrderId, id)).for("update");
    const [grn] = await tx
      .insert(goodsReceipts)
      .values({ number: await nextNumber(tx, "GRN"), purchaseOrderId: id, locationId: po.locationId, receivedBy: actor.userId, notes: data.notes || null })
      .returning();
    for (const w of wanted) {
      const line = lines.find((l) => l.id === w.lineId);
      if (!line) throw invalid("A line does not belong to this purchase order.");
      const outstanding = line.quantity - line.receivedQuantity;
      if (w.quantity > outstanding) throw conflict(`Cannot receive ${w.quantity} of "${line.description}": only ${outstanding} outstanding.`);
      await tx.update(purchaseOrderLines).set({ receivedQuantity: line.receivedQuantity + w.quantity }).where(eq(purchaseOrderLines.id, line.id));
      line.receivedQuantity += w.quantity;
      await tx.insert(goodsReceiptLines).values({ goodsReceiptId: grn!.id, purchaseOrderLineId: line.id, quantity: w.quantity });
      if (line.variantId) {
        const [lvl] = await tx
          .select()
          .from(stockLevels)
          .where(and(eq(stockLevels.variantId, line.variantId), eq(stockLevels.locationId, po.locationId)))
          .for("update");
        if (lvl) {
          await tx.update(stockLevels).set({ onHand: sql`${stockLevels.onHand} + ${w.quantity}`, sourceUpdatedAt: new Date() }).where(eq(stockLevels.id, lvl.id));
        } else {
          await tx.insert(stockLevels).values({ variantId: line.variantId, locationId: po.locationId, onHand: w.quantity });
        }
        await recordMovement(tx, { variantId: line.variantId, locationId: po.locationId, quantity: w.quantity, reason: "receipt", refType: "goods_receipt", refId: grn!.id, actorUserId: actor.userId });
      }
    }
    const complete = lines.every((l) => l.receivedQuantity >= l.quantity);
    await tx.update(purchaseOrders).set({ status: complete ? "received" : "partially_received" }).where(eq(purchaseOrders.id, id));
    await audit(tx, { actor, action: "po.goods_received", targetType: "purchase_order", targetId: id, data: { grn: grn!.number, lines: wanted.length, complete } });
    return { grnNumber: grn!.number, complete };
  });
  publish({ topic: "stock" });
  return result;
}
