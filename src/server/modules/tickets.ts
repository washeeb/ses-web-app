import { and, asc, eq, inArray, isNull, lt, ne } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "../db/client";
import { assets, organizations, ticketMessages, tickets, users } from "../db/schema";
import { authorize, can, type Actor } from "../authz/policy";
import { conflict, forbidden, invalid, notFound } from "../lib/errors";
import { enforce } from "../auth/rate-limit";
import { audit } from "./audit";
import { publish } from "./events";
import { announce, notifyPermission, notifyUsers, usersWithPermission } from "./notifications";
import { getSettings, nextNumber } from "./settings";
import { addServiceMinutes, dueDates, PRIORITIES, serviceMinutesBetween, type Coverage, type Priority } from "./service-time";
import { slaFor } from "./subscriptions";

const DAY = 86_400_000;
export const TICKET_CATEGORIES = ["general", "hardware", "software", "network", "security", "billing", "account"] as const;
export const LEVEL_LABEL: Record<number, string> = { 1: "First line (L1)", 2: "Second line (L2)", 3: "Engineering (L3)" };
const OPEN = ["new", "open", "pending_customer"];

type Ticket = typeof tickets.$inferSelect;

const isStaff = (actor: Actor) => actor.organizationType === "operator";

function assertCanSee(actor: Actor, t: Ticket) {
  if (can(actor, "support.read")) return;
  if (can(actor, "customer.tickets.read", { organizationId: t.customerOrgId })) return;
  throw notFound("Ticket not found.");
}

async function lockTicket(tx: DB, id: string) {
  const [t] = await tx.select().from(tickets).where(eq(tickets.id, id)).for("update");
  if (!t) throw notFound("Ticket not found.");
  return t;
}

/** Customer users who follow the organisation's tickets. */
const customerFollowers = (db: DB, orgId: string) => usersWithPermission(db, "customer.tickets.read", orgId);

// ───────────────────────────── Raising ─────────────────────────────

export const ticketInput = z.object({
  customerOrgId: z.string().uuid().optional(),
  subject: z.string().trim().min(5, "Give the ticket a short subject (at least 5 characters).").max(160),
  description: z.string().trim().min(10, "Describe the problem (at least 10 characters).").max(8000),
  priority: z.enum(PRIORITIES).default("normal"),
  category: z.enum(TICKET_CATEGORIES).default("general"),
  assetId: z.string().uuid().nullable().optional(),
});

export async function createTicket(db: DB, actor: Actor, input: z.input<typeof ticketInput>, now = new Date()) {
  const data = ticketInput.parse(input);
  let customerOrgId: string;
  if (isStaff(actor)) {
    authorize(actor, "support.write");
    if (!data.customerOrgId) throw invalid("Choose the customer.");
    const [c] = await db.select().from(organizations).where(and(eq(organizations.id, data.customerOrgId), eq(organizations.type, "customer")));
    if (!c) throw invalid("Unknown customer.");
    customerOrgId = c.id;
  } else {
    authorize(actor, "customer.tickets.write", { organizationId: actor.organizationId });
    customerOrgId = actor.organizationId;
    await enforce(db, `ticket:user:${actor.userId}`, 20, 60 * 60);
  }
  if (data.assetId) {
    const [a] = await db.select().from(assets).where(eq(assets.id, data.assetId));
    if (!a || a.customerOrgId !== customerOrgId) throw invalid("That equipment is not registered to this customer.");
  }
  const sla = await slaFor(db, customerOrgId, now);
  const due = dueDates(now, data.priority, sla);
  const t = await db.transaction(async (tx) => {
    const [t] = await tx
      .insert(tickets)
      .values({
        number: await nextNumber(tx, "T", now),
        customerOrgId,
        contractId: sla.contractId,
        assetId: data.assetId ?? null,
        subject: data.subject,
        priority: data.priority,
        category: data.category,
        coverage: sla.coverage,
        requesterUserId: actor.userId,
        ...due,
      })
      .returning();
    await tx.insert(ticketMessages).values({ ticketId: t!.id, authorUserId: actor.userId, body: data.description });
    await audit(tx, { actor, action: "ticket.created", targetType: "ticket", targetId: t!.id, data: { number: t!.number, priority: data.priority } });
    await notifyPermission(tx, "support.write", { title: `New ${data.priority === "urgent" ? "URGENT " : ""}ticket ${t!.number}`, body: data.subject, link: `/ops/support/${t!.id}` }, { exclude: actor.userId });
    if (isStaff(actor)) {
      await notifyUsers(tx, await customerFollowers(tx, customerOrgId), { title: `Support ticket ${t!.number} opened for you`, body: data.subject, link: `/portal/support/${t!.id}` });
    }
    return t!;
  });
  publish({ topic: "tickets", orgIds: [customerOrgId] });
  announce();
  return t;
}

// ───────────────────────────── Conversation ─────────────────────────────

/** A paused resolution clock restarts: the due time moves on by the covered time spent waiting. */
function resumeSet(t: Ticket, now: Date) {
  if (!t.pausedAt) return {};
  const waited = serviceMinutesBetween(t.pausedAt, now, t.coverage as Coverage);
  return { pausedAt: null, resolutionDueAt: addServiceMinutes(t.resolutionDueAt, waited, t.coverage as Coverage) };
}

export async function replyToTicket(db: DB, actor: Actor, id: string, body: string, opts: { internal?: boolean } = {}, now = new Date()) {
  const text = body.trim();
  if (text.length < 2) throw invalid("Write a message.");
  if (text.length > 8000) throw invalid("The message is too long (8,000 characters at most).");
  const t = await db.transaction(async (tx) => {
    const t = await lockTicket(tx, id);
    const staff = isStaff(actor);
    if (staff) authorize(actor, "support.write");
    else {
      if (!can(actor, "customer.tickets.write", { organizationId: t.customerOrgId })) {
        if (!can(actor, "customer.tickets.read", { organizationId: t.customerOrgId })) throw notFound("Ticket not found.");
        throw forbidden("Your account can read tickets but not reply. Ask your organisation's administrator.");
      }
      if (opts.internal) throw forbidden();
    }
    if (t.status === "closed") throw conflict("This ticket is closed. Please open a new ticket and mention this one.");
    const internal = staff && !!opts.internal;
    await tx.insert(ticketMessages).values({ ticketId: id, authorUserId: actor.userId, body: text, internal });
    const patch: Partial<Ticket> = {};
    if (staff && !internal) {
      if (!t.firstRespondedAt) patch.firstRespondedAt = now;
      if (t.status === "new") patch.status = "open";
      if (!t.assigneeUserId) patch.assigneeUserId = actor.userId;
    }
    if (!staff) {
      // The customer answered or came back: the ticket is live again.
      if (t.status === "pending_customer") Object.assign(patch, { status: "open" }, resumeSet(t, now));
      if (t.status === "resolved") Object.assign(patch, { status: "open", resolvedAt: null });
    }
    if (Object.keys(patch).length) await tx.update(tickets).set(patch).where(eq(tickets.id, id));
    await audit(tx, { actor, action: internal ? "ticket.note_added" : "ticket.replied", targetType: "ticket", targetId: id });
    if (staff && !internal) {
      await notifyUsers(tx, (await customerFollowers(tx, t.customerOrgId)).filter((u) => u !== actor.userId), { title: `Reply on ticket ${t.number}`, body: t.subject, link: `/portal/support/${id}` });
    } else if (!staff) {
      const target = t.assigneeUserId ? [t.assigneeUserId] : await usersWithPermission(tx, "support.write");
      await notifyUsers(tx, target, { title: `Customer replied on ${t.number}${t.status === "resolved" ? " (reopened)" : ""}`, body: t.subject, link: `/ops/support/${id}` });
    }
    return t;
  });
  publish({ topic: "tickets", orgIds: [t.customerOrgId] });
  announce();
}

// ───────────────────────────── Staff handling ─────────────────────────────

const STAFF_STATUSES = ["open", "pending_customer", "resolved", "closed"] as const;

export async function setTicketStatus(db: DB, actor: Actor, id: string, status: string, now = new Date()) {
  authorize(actor, "support.write");
  const next = z.enum(STAFF_STATUSES).parse(status);
  const t = await db.transaction(async (tx) => {
    const t = await lockTicket(tx, id);
    if (t.status === next) return t;
    if (t.status === "closed") throw conflict("Closed tickets cannot be changed.");
    if (next === "closed" && t.status !== "resolved") throw conflict("Resolve the ticket before closing it.");
    const patch: Partial<Ticket> = { status: next };
    if (t.status === "pending_customer") Object.assign(patch, resumeSet(t, now));
    if (next === "pending_customer") patch.pausedAt = now;
    if (next === "resolved") patch.resolvedAt = now;
    if (next === "open") patch.resolvedAt = null;
    if (next === "closed") patch.closedAt = now;
    if (!t.firstRespondedAt && next !== "open") patch.firstRespondedAt = now;
    await tx.update(tickets).set(patch).where(eq(tickets.id, id));
    await audit(tx, { actor, action: "ticket.status_changed", targetType: "ticket", targetId: id, data: { from: t.status, to: next } });
    if (["pending_customer", "resolved"].includes(next)) {
      await notifyUsers(tx, await customerFollowers(tx, t.customerOrgId), {
        title: next === "resolved" ? `Ticket ${t.number} resolved` : `Ticket ${t.number} is waiting for your reply`,
        body: next === "resolved" ? "Reply if the problem is not fixed and we will reopen it." : t.subject,
        link: `/portal/support/${id}`,
      });
    }
    return t;
  });
  publish({ topic: "tickets", orgIds: [t.customerOrgId] });
  announce();
}

export async function assignTicket(db: DB, actor: Actor, id: string, assigneeUserId: string | null) {
  authorize(actor, "support.write");
  if (assigneeUserId) {
    const staff = await usersWithPermission(db, "support.write");
    if (!staff.includes(assigneeUserId)) throw invalid("Assign the ticket to someone who handles support.");
  }
  const t = await db.transaction(async (tx) => {
    const t = await lockTicket(tx, id);
    await tx.update(tickets).set({ assigneeUserId }).where(eq(tickets.id, id));
    await audit(tx, { actor, action: "ticket.assigned", targetType: "ticket", targetId: id, data: { assigneeUserId } });
    if (assigneeUserId && assigneeUserId !== actor.userId) await notifyUsers(tx, [assigneeUserId], { title: `Ticket ${t.number} assigned to you`, body: t.subject, link: `/ops/support/${id}` });
    return t;
  });
  publish({ topic: "tickets", orgIds: [t.customerOrgId] });
  announce();
}

/** L1 → L2 → engineering. Records an internal note and alerts the next line. */
export async function escalateTicket(db: DB, actor: Actor, id: string, reason: string) {
  authorize(actor, "support.write");
  if (reason.trim().length < 5) throw invalid("Explain why the ticket is being escalated.");
  const t = await db.transaction(async (tx) => {
    const t = await lockTicket(tx, id);
    if (!OPEN.includes(t.status)) throw conflict("Only open tickets can be escalated.");
    if (t.level >= 3) throw conflict("This ticket is already with engineering.");
    const level = t.level + 1;
    await tx.update(tickets).set({ level, assigneeUserId: null }).where(eq(tickets.id, id));
    await tx.insert(ticketMessages).values({ ticketId: id, authorUserId: actor.userId, body: `Escalated to ${LEVEL_LABEL[level]}: ${reason.trim()}`, internal: true });
    await audit(tx, { actor, action: "ticket.escalated", targetType: "ticket", targetId: id, data: { from: t.level, to: level, reason: reason.trim() } });
    const notice = { title: `Ticket ${t.number} escalated to ${LEVEL_LABEL[level]}`, body: `${t.subject} — ${reason.trim()}`, link: `/ops/support/${id}` };
    await notifyPermission(tx, level === 3 ? "projects.write" : "support.write", notice, { exclude: actor.userId });
    return t;
  });
  publish({ topic: "tickets", orgIds: [t.customerOrgId] });
  announce();
}

/** Priority changes re-target the clock from when the ticket was raised. */
export async function setTicketPriority(db: DB, actor: Actor, id: string, priority: string) {
  authorize(actor, "support.write");
  const p = z.enum(PRIORITIES).parse(priority) as Priority;
  const t = await db.transaction(async (tx) => {
    const t = await lockTicket(tx, id);
    if (!OPEN.includes(t.status)) throw conflict("Only open tickets can be re-prioritised.");
    const sla = await slaFor(tx, t.customerOrgId, t.createdAt);
    const due = dueDates(t.createdAt, p, { coverage: t.coverage as Coverage, targets: sla.targets });
    await tx.update(tickets).set({ priority: p, ...due, responseBreached: false, resolutionBreached: false }).where(eq(tickets.id, id));
    await audit(tx, { actor, action: "ticket.priority_changed", targetType: "ticket", targetId: id, data: { from: t.priority, to: p } });
    return t;
  });
  publish({ topic: "tickets", orgIds: [t.customerOrgId] });
}

// ───────────────────────────── SLA job ─────────────────────────────

/** Flags breached targets once and alerts the assignee (or the whole support team). */
export async function checkSla(db: DB, now = new Date()) {
  const late = await db
    .select()
    .from(tickets)
    .where(and(inArray(tickets.status, OPEN), isNull(tickets.pausedAt), lt(tickets.resolutionDueAt, now), eq(tickets.resolutionBreached, false)));
  const slow = await db
    .select()
    .from(tickets)
    .where(and(inArray(tickets.status, ["new", "open"]), isNull(tickets.firstRespondedAt), lt(tickets.responseDueAt, now), eq(tickets.responseBreached, false)));
  const breaches = [...slow.map((t) => ({ t, kind: "response" as const })), ...late.map((t) => ({ t, kind: "resolution" as const }))];
  for (const { t, kind } of breaches) {
    await db.transaction(async (tx) => {
      await tx.update(tickets).set(kind === "response" ? { responseBreached: true } : { resolutionBreached: true }).where(eq(tickets.id, t.id));
      await audit(tx, { action: `ticket.sla_breached`, targetType: "ticket", targetId: t.id, data: { kind } });
      const to = t.assigneeUserId ? [t.assigneeUserId] : await usersWithPermission(tx, "support.write");
      await notifyUsers(tx, to, { title: `SLA breached: ${kind} on ${t.number}`, body: `${t.priority} priority — ${t.subject}`, link: `/ops/support/${t.id}` });
    });
  }
  if (breaches.length) {
    publish({ topic: "tickets" });
    announce();
  }
  return breaches.length;
}

/** Daily: resolved tickets with no customer reply for `ticketAutoCloseDays` are closed. */
export async function autoCloseTickets(db: DB, now = new Date()) {
  const s = await getSettings(db);
  const rows = await db
    .update(tickets)
    .set({ status: "closed", closedAt: now })
    .where(and(eq(tickets.status, "resolved"), lt(tickets.resolvedAt, new Date(now.getTime() - s.ticketAutoCloseDays * DAY))))
    .returning({ id: tickets.id });
  for (const r of rows) await audit(db, { action: "ticket.auto_closed", targetType: "ticket", targetId: r.id });
  if (rows.length) publish({ topic: "tickets" });
  return rows.length;
}

// ───────────────────────────── Reading ─────────────────────────────

export type TicketFilter = "open" | "mine" | "breached" | "resolved" | "all";

export async function listTickets(db: DB, actor: Actor, opts: { filter?: TicketFilter; customerOrgId?: string } = {}) {
  const conds = [];
  if (can(actor, "support.read")) {
    if (opts.customerOrgId) conds.push(eq(tickets.customerOrgId, opts.customerOrgId));
  } else {
    authorize(actor, "customer.tickets.read", { organizationId: actor.organizationId });
    conds.push(eq(tickets.customerOrgId, actor.organizationId));
  }
  const f = opts.filter ?? "open";
  if (f === "open") conds.push(inArray(tickets.status, OPEN));
  if (f === "mine") conds.push(inArray(tickets.status, OPEN), eq(tickets.assigneeUserId, actor.userId));
  if (f === "breached") conds.push(inArray(tickets.status, OPEN), eq(tickets.resolutionBreached, true));
  if (f === "resolved") conds.push(inArray(tickets.status, ["resolved", "closed"]));
  return db
    .select({ t: tickets, customerName: organizations.name, assigneeName: users.name })
    .from(tickets)
    .innerJoin(organizations, eq(organizations.id, tickets.customerOrgId))
    .leftJoin(users, eq(users.id, tickets.assigneeUserId))
    .where(and(...conds))
    .orderBy(asc(tickets.resolutionDueAt))
    .limit(500);
}

export async function getTicket(db: DB, actor: Actor, id: string) {
  const [row] = await db
    .select({ t: tickets, customerName: organizations.name })
    .from(tickets)
    .innerJoin(organizations, eq(organizations.id, tickets.customerOrgId))
    .where(eq(tickets.id, id));
  if (!row) throw notFound("Ticket not found.");
  assertCanSee(actor, row.t);
  const staff = can(actor, "support.read");
  const messages = await db
    .select({ m: ticketMessages, authorName: users.name, authorOrgId: users.organizationId })
    .from(ticketMessages)
    .leftJoin(users, eq(users.id, ticketMessages.authorUserId))
    .where(and(eq(ticketMessages.ticketId, id), staff ? undefined : eq(ticketMessages.internal, false)))
    .orderBy(asc(ticketMessages.createdAt));
  const [asset] = row.t.assetId ? await db.select({ id: assets.id, tag: assets.tag, name: assets.name }).from(assets).where(eq(assets.id, row.t.assetId)) : [];
  const [requester] = await db.select({ name: users.name }).from(users).where(eq(users.id, row.t.requesterUserId));
  const [assignee] = row.t.assigneeUserId ? await db.select({ name: users.name }).from(users).where(eq(users.id, row.t.assigneeUserId)) : [];
  return { ...row.t, customerName: row.customerName, messages, asset: asset ?? null, requesterName: requester?.name ?? null, assigneeName: assignee?.name ?? null };
}

/** Support staff who can be assigned tickets. */
export async function supportStaff(db: DB) {
  const ids = await usersWithPermission(db, "support.write");
  if (ids.length === 0) return [];
  return db.select({ id: users.id, name: users.name }).from(users).where(and(inArray(users.id, ids), ne(users.status, "disabled"))).orderBy(asc(users.name));
}
