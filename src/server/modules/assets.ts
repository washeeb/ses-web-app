import { and, desc, eq, ilike, or } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "../db/client";
import { assets, orderLines, orders, organizations, products, productVariants, serviceContracts, tickets, warranties } from "../db/schema";
import { authorize, can, type Actor } from "../authz/policy";
import { invalid, notFound } from "../lib/errors";
import { audit } from "./audit";
import { publish } from "./events";
import { nextNumber } from "./settings";

/** Most units auto-registered per order line; bigger lines are registered in bulk by staff. */
const AUTO_REGISTER_MAX = 100;

const staffCanRead = (actor: Actor) => can(actor, "assets.manage") || can(actor, "support.read") || can(actor, "orders.read");

/** Called when an order is fulfilled: one asset per hardware unit (serial numbers are added later). */
export async function createAssetsForOrder(tx: DB, orderId: string, installedAt: Date) {
  const rows = await tx
    .select({ line: orderLines, customerOrgId: orders.customerOrgId, isDemo: orders.isDemo, variantId: productVariants.id })
    .from(orderLines)
    .innerJoin(orders, eq(orders.id, orderLines.orderId))
    .innerJoin(productVariants, eq(productVariants.id, orderLines.variantId))
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(and(eq(orderLines.orderId, orderId), eq(products.type, "hardware")));
  let n = 0;
  for (const r of rows) {
    for (let i = 0; i < Math.min(r.line.quantity, AUTO_REGISTER_MAX); i++) {
      await tx.insert(assets).values({
        tag: await nextNumber(tx, "A", installedAt),
        customerOrgId: r.customerOrgId,
        variantId: r.variantId,
        name: r.line.description,
        orderId,
        orderLineId: r.line.id,
        installedAt,
        isDemo: r.isDemo,
      });
      n++;
    }
  }
  return n;
}

export async function listAssets(db: DB, actor: Actor, opts: { customerOrgId?: string; q?: string } = {}) {
  const conds = [];
  if (staffCanRead(actor)) {
    if (opts.customerOrgId) conds.push(eq(assets.customerOrgId, opts.customerOrgId));
  } else {
    authorize(actor, "customer.assets.read", { organizationId: actor.organizationId });
    conds.push(eq(assets.customerOrgId, actor.organizationId));
  }
  const q = opts.q?.trim();
  if (q) conds.push(or(ilike(assets.tag, `%${q}%`), ilike(assets.name, `%${q}%`), ilike(assets.serialNumber, `%${q}%`))!);
  return db
    .select({ a: assets, customerName: organizations.name })
    .from(assets)
    .innerJoin(organizations, eq(organizations.id, assets.customerOrgId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(assets.createdAt))
    .limit(500);
}

export async function getAsset(db: DB, actor: Actor, id: string) {
  const [row] = await db
    .select({ a: assets, customerName: organizations.name, orderNumber: orders.number, contractName: serviceContracts.name, contractNumber: serviceContracts.number })
    .from(assets)
    .innerJoin(organizations, eq(organizations.id, assets.customerOrgId))
    .leftJoin(orders, eq(orders.id, assets.orderId))
    .leftJoin(serviceContracts, eq(serviceContracts.id, assets.contractId))
    .where(eq(assets.id, id));
  if (!row || (!staffCanRead(actor) && !can(actor, "customer.assets.read", { organizationId: row.a.customerOrgId }))) throw notFound("Asset not found.");
  const [warranty] = row.a.orderLineId ? await db.select().from(warranties).where(eq(warranties.orderLineId, row.a.orderLineId)) : [];
  const history = await db.select().from(tickets).where(eq(tickets.assetId, id)).orderBy(desc(tickets.createdAt)).limit(50);
  return { ...row.a, customerName: row.customerName, orderNumber: row.orderNumber, contractName: row.contractName, contractNumber: row.contractNumber, warrantyEndsAt: warranty?.endsAt ?? null, tickets: history };
}

export const assetInput = z.object({
  name: z.string().trim().min(2).max(200),
  serialNumber: z.string().trim().max(100).optional().default(""),
  location: z.string().trim().max(200).optional().default(""),
  status: z.enum(["active", "in_repair", "retired"]).default("active"),
  contractId: z.string().uuid().nullable().optional(),
  notes: z.string().trim().max(2000).optional().default(""),
});

async function checkContract(db: DB, contractId: string | null | undefined, customerOrgId: string) {
  if (!contractId) return null;
  const [c] = await db.select().from(serviceContracts).where(eq(serviceContracts.id, contractId));
  if (!c || c.customerOrgId !== customerOrgId) throw invalid("That contract belongs to a different customer.");
  return c.id;
}

export async function createAsset(db: DB, actor: Actor, customerOrgId: string, input: z.input<typeof assetInput>) {
  authorize(actor, "assets.manage");
  const data = assetInput.parse(input);
  const [customer] = await db.select().from(organizations).where(and(eq(organizations.id, customerOrgId), eq(organizations.type, "customer")));
  if (!customer) throw invalid("Choose a customer.");
  const contractId = await checkContract(db, data.contractId, customerOrgId);
  const a = await db.transaction(async (tx) => {
    const [a] = await tx
      .insert(assets)
      .values({ tag: await nextNumber(tx, "A"), customerOrgId, name: data.name, serialNumber: data.serialNumber || null, location: data.location || null, status: data.status, contractId, notes: data.notes || null, installedAt: new Date() })
      .returning();
    await audit(tx, { actor, action: "asset.created", targetType: "asset", targetId: a!.id, data: { tag: a!.tag } });
    return a!;
  });
  publish({ topic: "assets", orgIds: [customerOrgId] });
  return a;
}

export async function updateAsset(db: DB, actor: Actor, id: string, input: z.input<typeof assetInput>) {
  authorize(actor, "assets.manage");
  const data = assetInput.parse(input);
  const [before] = await db.select().from(assets).where(eq(assets.id, id));
  if (!before) throw notFound("Asset not found.");
  const contractId = await checkContract(db, data.contractId, before.customerOrgId);
  const next = { name: data.name, serialNumber: data.serialNumber || null, location: data.location || null, status: data.status, contractId, notes: data.notes || null };
  await db.update(assets).set(next).where(eq(assets.id, id));
  const changed = Object.fromEntries(Object.entries(next).filter(([k, v]) => before[k as keyof typeof before] !== v).map(([k, v]) => [k, { from: before[k as keyof typeof before], to: v }]));
  await audit(db, { actor, action: "asset.updated", targetType: "asset", targetId: id, data: changed });
  publish({ topic: "assets", orgIds: [before.customerOrgId] });
}
