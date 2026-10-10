import { desc, eq } from "drizzle-orm";
import type { DB } from "../db/client";
import { approvalRequests, productVariants, users } from "../db/schema";
import { authorize, type Actor } from "../authz/policy";
import type { Permission } from "../authz/permissions";
import { conflict, forbidden, notFound } from "../lib/errors";
import { audit } from "./audit";
import { publish } from "./events";
import { applyPrice } from "./catalogue";
import { applyQuoteDecision } from "./sales";
import { applyAssignment } from "./admin";

export const APPROVAL_TYPES: Record<string, { label: string; permission: Permission }> = {
  "quote.approval": { label: "Quotation", permission: "quotes.approve" },
  "price.change": { label: "Price change", permission: "catalogue.price.approve" },
  "permission.change": { label: "Permission change", permission: "permissions.manage" },
};

export async function listApprovals(db: DB, actor: Actor, status: "pending" | "all" = "pending") {
  authorize(actor, "approvals.read");
  const q = db
    .select({ a: approvalRequests, requesterName: users.name })
    .from(approvalRequests)
    .leftJoin(users, eq(users.id, approvalRequests.requestedBy))
    .orderBy(desc(approvalRequests.createdAt))
    .limit(200);
  return status === "pending" ? q.where(eq(approvalRequests.status, "pending")) : q;
}

export async function decideApproval(db: DB, actor: Actor, id: string, approve: boolean, note: string) {
  const req = await db.transaction(async (tx) => {
    const [req] = await tx.select().from(approvalRequests).where(eq(approvalRequests.id, id)).for("update");
    if (!req) throw notFound("Approval request not found.");
    const type = APPROVAL_TYPES[req.type];
    if (!type) throw conflict(`Unknown approval type ${req.type}.`);
    authorize(actor, type.permission);
    if (req.status !== "pending") throw conflict("This request has already been decided.");
    if (req.requestedBy === actor.userId) throw forbidden("You cannot approve or reject your own request.");
    const payload = req.payload as Record<string, unknown>;

    if (approve) {
      switch (req.type) {
        case "quote.approval":
          await applyQuoteDecision(tx, req.subjectId, true, actor.userId);
          break;
        case "price.change": {
          const [v] = await tx.select().from(productVariants).where(eq(productVariants.id, req.subjectId)).for("update");
          if (!v) throw notFound("Variant no longer exists.");
          if (v.priceMinor !== payload.fromMinor) throw conflict("The price has changed since this request was raised. Reject it and raise a new one.");
          await applyPrice(tx, v.id, Number(payload.toMinor), { actor, source: String(payload.source ?? "approval"), approvalId: req.id });
          break;
        }
        case "permission.change":
          if (payload.userId === actor.userId) throw forbidden("You cannot approve changes to your own permissions.");
          await applyAssignment(tx, {
            userId: String(payload.userId),
            permissionSetId: String(payload.permissionSetId),
            departmentId: (payload.departmentId as string | null) ?? null,
            grantedBy: actor.userId,
          });
          break;
      }
    } else if (req.type === "quote.approval") {
      await applyQuoteDecision(tx, req.subjectId, false, actor.userId);
    }

    await tx
      .update(approvalRequests)
      .set({ status: approve ? "approved" : "rejected", decidedBy: actor.userId, decidedAt: new Date(), decisionNote: note.trim() || null })
      .where(eq(approvalRequests.id, id));
    await audit(tx, {
      actor,
      action: `approval.${approve ? "approved" : "rejected"}`,
      targetType: req.subjectType,
      targetId: req.subjectId,
      data: { approvalId: id, type: req.type, note },
    });
    return req;
  });
  publish({ topic: "approvals" });
  if (req.type === "quote.approval") publish({ topic: "quotes" });
  if (req.type === "price.change") publish({ topic: "catalogue" });
}
