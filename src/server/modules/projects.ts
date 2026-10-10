import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "../db/client";
import { organizations, projectMilestones, projects, projectTasks, users } from "../db/schema";
import { authorize, can, type Actor } from "../authz/policy";
import { conflict, forbidden, invalid, notFound } from "../lib/errors";
import { audit } from "./audit";
import { publish } from "./events";
import { announce, notifyPermission, notifyUsers, usersWithPermission } from "./notifications";
import { nextNumber } from "./settings";

const date = z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]).optional().default("");
const toDate = (d: string) => (d ? new Date(`${d}T00:00:00Z`) : null);

type Project = typeof projects.$inferSelect;

function assertCanSee(actor: Actor, p: Project) {
  if (can(actor, "projects.read")) return;
  if (p.customerOrgId && can(actor, "customer.projects.read", { organizationId: p.customerOrgId })) return;
  throw notFound("Project not found.");
}

async function loadProject(db: DB, id: string) {
  const [p] = await db.select().from(projects).where(eq(projects.id, id));
  if (!p) throw notFound("Project not found.");
  return p;
}

const publishProject = (p: Pick<Project, "customerOrgId">) => publish({ topic: "projects", orgIds: p.customerOrgId ? [p.customerOrgId] : [] });

async function operatorUser(db: DB, userId: string) {
  const [u] = await db
    .select({ id: users.id })
    .from(users)
    .innerJoin(organizations, eq(organizations.id, users.organizationId))
    .where(and(eq(users.id, userId), eq(organizations.type, "operator"), eq(users.status, "active")));
  if (!u) throw invalid("Choose an active SES staff member.");
  return u.id;
}

// ───────────────────────────── Projects ─────────────────────────────

export const projectInput = z.object({
  name: z.string().trim().min(3).max(160),
  customerOrgId: z.string().uuid().nullable().optional(),
  description: z.string().trim().max(4000).optional().default(""),
  managerUserId: z.string().uuid().optional(),
  startDate: date,
  dueDate: date,
});

export async function createProject(db: DB, actor: Actor, input: z.input<typeof projectInput>) {
  authorize(actor, "projects.write");
  const data = projectInput.parse(input);
  if (data.customerOrgId) {
    const [c] = await db.select().from(organizations).where(and(eq(organizations.id, data.customerOrgId), eq(organizations.type, "customer")));
    if (!c) throw invalid("Unknown customer.");
  }
  const managerUserId = await operatorUser(db, data.managerUserId ?? actor.userId);
  if (data.startDate && data.dueDate && data.dueDate < data.startDate) throw invalid("The due date is before the start date.");
  const p = await db.transaction(async (tx) => {
    const [p] = await tx
      .insert(projects)
      .values({
        number: await nextNumber(tx, "P"),
        customerOrgId: data.customerOrgId ?? null,
        name: data.name,
        description: data.description || null,
        managerUserId,
        startDate: toDate(data.startDate),
        dueDate: toDate(data.dueDate),
        createdBy: actor.userId,
      })
      .returning();
    await audit(tx, { actor, action: "project.created", targetType: "project", targetId: p!.id, data: { number: p!.number } });
    if (managerUserId !== actor.userId) await notifyUsers(tx, [managerUserId], { title: `You manage project ${p!.number}`, body: p!.name, link: `/ops/projects/${p!.id}` });
    return p!;
  });
  publishProject(p);
  announce();
  return p;
}

const PROJECT_STATUSES = ["planning", "active", "on_hold", "completed", "cancelled"] as const;

export async function setProjectStatus(db: DB, actor: Actor, id: string, status: string) {
  authorize(actor, "projects.write");
  const next = z.enum(PROJECT_STATUSES).parse(status);
  const p = await loadProject(db, id);
  if (["completed", "cancelled"].includes(p.status)) throw conflict(`This project is ${p.status}.`);
  if (next === "completed") {
    const ms = await db.select().from(projectMilestones).where(eq(projectMilestones.projectId, id));
    if (ms.length === 0) throw conflict("Add milestones and have them signed off before completing the project.");
    if (ms.some((m) => m.status !== "signed_off")) throw conflict("Every milestone must be signed off before the project is completed.");
  }
  await db.update(projects).set({ status: next, completedAt: next === "completed" ? new Date() : null }).where(eq(projects.id, id));
  await audit(db, { actor, action: "project.status_changed", targetType: "project", targetId: id, data: { from: p.status, to: next } });
  if (p.customerOrgId && ["active", "completed", "on_hold"].includes(next)) {
    await notifyUsers(db, await usersWithPermission(db, "customer.projects.read", p.customerOrgId), { title: `Project ${p.number} is now ${next.replace("_", " ")}`, body: p.name, link: `/portal/projects/${id}` });
    announce();
  }
  publishProject(p);
}

// ───────────────────────────── Milestones & tasks ─────────────────────────────

function assertEditable(p: Project) {
  if (["completed", "cancelled"].includes(p.status)) throw conflict(`This project is ${p.status}.`);
}

export async function addMilestone(db: DB, actor: Actor, projectId: string, input: { name: string; dueDate?: string }) {
  authorize(actor, "projects.write");
  const data = z.object({ name: z.string().trim().min(2).max(160), dueDate: date }).parse(input);
  const p = await loadProject(db, projectId);
  assertEditable(p);
  const [{ n }] = (await db.select({ n: sql<number>`count(*)::int` }).from(projectMilestones).where(eq(projectMilestones.projectId, projectId))) as [{ n: number }];
  const [m] = await db.insert(projectMilestones).values({ projectId, name: data.name, dueDate: toDate(data.dueDate), sortOrder: n }).returning();
  await audit(db, { actor, action: "project.milestone_added", targetType: "project", targetId: projectId, data: { milestone: data.name } });
  publishProject(p);
  return m!;
}

export async function addTask(db: DB, actor: Actor, projectId: string, input: { title: string; milestoneId?: string | null; assigneeUserId?: string | null; dueDate?: string }) {
  authorize(actor, "projects.write");
  const data = z
    .object({ title: z.string().trim().min(2).max(200), milestoneId: z.string().uuid().nullable().optional(), assigneeUserId: z.string().uuid().nullable().optional(), dueDate: date })
    .parse(input);
  const p = await loadProject(db, projectId);
  assertEditable(p);
  if (data.milestoneId) {
    const [m] = await db.select().from(projectMilestones).where(eq(projectMilestones.id, data.milestoneId));
    if (!m || m.projectId !== projectId) throw invalid("That milestone belongs to another project.");
    if (m.status === "signed_off") throw conflict("That milestone is already signed off.");
  }
  const assignee = data.assigneeUserId ? await operatorUser(db, data.assigneeUserId) : null;
  const [t] = await db.insert(projectTasks).values({ projectId, milestoneId: data.milestoneId ?? null, title: data.title, assigneeUserId: assignee, dueDate: toDate(data.dueDate) }).returning();
  if (assignee && assignee !== actor.userId) {
    await notifyUsers(db, [assignee], { title: `Task assigned: ${data.title}`, body: `Project ${p.number} — ${p.name}`, link: `/ops/projects/${projectId}` });
    announce();
  }
  publishProject(p);
  return t!;
}

export async function setTaskStatus(db: DB, actor: Actor, taskId: string, status: string) {
  authorize(actor, "projects.write");
  const next = z.enum(["todo", "in_progress", "done"]).parse(status);
  const [t] = await db.select().from(projectTasks).where(eq(projectTasks.id, taskId));
  if (!t) throw notFound("Task not found.");
  const p = await loadProject(db, t.projectId);
  assertEditable(p);
  if (t.milestoneId) {
    const [m] = await db.select().from(projectMilestones).where(eq(projectMilestones.id, t.milestoneId));
    if (m && m.status !== "open") throw conflict("Tasks of a milestone awaiting or past sign-off cannot change.");
  }
  await db.update(projectTasks).set({ status: next }).where(eq(projectTasks.id, taskId));
  publishProject(p);
}

/** Asks for sign-off: customer projects by the customer's administrator, internal ones by another SES project user. */
export async function requestSignoff(db: DB, actor: Actor, milestoneId: string) {
  authorize(actor, "projects.write");
  const p = await db.transaction(async (tx) => {
    const [m] = await tx.select().from(projectMilestones).where(eq(projectMilestones.id, milestoneId)).for("update");
    if (!m) throw notFound("Milestone not found.");
    const p = await loadProject(tx, m.projectId);
    assertEditable(p);
    if (m.status !== "open") throw conflict("This milestone is not open.");
    const open = await tx.select({ id: projectTasks.id }).from(projectTasks).where(and(eq(projectTasks.milestoneId, milestoneId), ne(projectTasks.status, "done")));
    if (open.length) throw conflict(`${open.length} task(s) in this milestone are not done yet.`);
    await tx.update(projectMilestones).set({ status: "awaiting_signoff", signoffRequestedBy: actor.userId, signoffRequestedAt: new Date(), signoffNote: null }).where(eq(projectMilestones.id, milestoneId));
    await audit(tx, { actor, action: "project.signoff_requested", targetType: "project", targetId: p.id, data: { milestone: m.name } });
    const notice = { title: `Sign-off requested: ${m.name}`, body: `Project ${p.number} — ${p.name}`, link: p.customerOrgId ? `/portal/projects/${p.id}` : `/ops/projects/${p.id}` };
    if (p.customerOrgId) await notifyUsers(tx, await usersWithPermission(tx, "customer.projects.signoff", p.customerOrgId), notice);
    else await notifyPermission(tx, "projects.write", notice, { exclude: actor.userId });
    return p;
  });
  publishProject(p);
  announce();
}

export async function decideSignoff(db: DB, actor: Actor, milestoneId: string, approve: boolean, note: string) {
  const p = await db.transaction(async (tx) => {
    const [m] = await tx.select().from(projectMilestones).where(eq(projectMilestones.id, milestoneId)).for("update");
    if (!m) throw notFound("Milestone not found.");
    const p = await loadProject(tx, m.projectId);
    if (p.customerOrgId) {
      if (!can(actor, "customer.projects.signoff", { organizationId: p.customerOrgId })) {
        if (!can(actor, "customer.projects.read", { organizationId: p.customerOrgId }) && !can(actor, "projects.read")) throw notFound("Project not found.");
        throw forbidden("Customer projects are signed off by the customer's administrator.");
      }
    } else {
      authorize(actor, "projects.write");
      if (m.signoffRequestedBy === actor.userId) throw forbidden("Someone other than the requester must sign off.");
    }
    if (m.status !== "awaiting_signoff") throw conflict("This milestone is not awaiting sign-off.");
    if (!approve && note.trim().length < 5) throw invalid("Say what still needs to be done.");
    await tx
      .update(projectMilestones)
      .set(approve ? { status: "signed_off", signedOffBy: actor.userId, signedOffAt: new Date(), signoffNote: note.trim() || null } : { status: "open", signoffNote: note.trim() })
      .where(eq(projectMilestones.id, milestoneId));
    await audit(tx, { actor, action: approve ? "project.milestone_signed_off" : "project.signoff_rejected", targetType: "project", targetId: p.id, data: { milestone: m.name, note: note.trim() } });
    await notifyUsers(tx, [p.managerUserId, m.signoffRequestedBy].filter((x): x is string => !!x), {
      title: `${m.name}: ${approve ? "signed off" : "sign-off declined"}`,
      body: note.trim() || `Project ${p.number}`,
      link: `/ops/projects/${p.id}`,
    });
    return p;
  });
  publishProject(p);
  announce();
}

// ───────────────────────────── Reading ─────────────────────────────

export async function listProjects(db: DB, actor: Actor, opts: { customerOrgId?: string; mine?: boolean } = {}) {
  const conds = [];
  if (can(actor, "projects.read")) {
    if (opts.customerOrgId) conds.push(eq(projects.customerOrgId, opts.customerOrgId));
    if (opts.mine) conds.push(eq(projects.managerUserId, actor.userId));
  } else {
    authorize(actor, "customer.projects.read", { organizationId: actor.organizationId });
    conds.push(eq(projects.customerOrgId, actor.organizationId));
  }
  const rows = await db
    .select({ p: projects, customerName: organizations.name, managerName: users.name })
    .from(projects)
    .leftJoin(organizations, eq(organizations.id, projects.customerOrgId))
    .innerJoin(users, eq(users.id, projects.managerUserId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(projects.createdAt))
    .limit(500);
  const ids = rows.map((r) => r.p.id);
  const progress = ids.length
    ? await db
        .select({ projectId: projectTasks.projectId, total: sql<number>`count(*)::int`, done: sql<number>`count(*) filter (where ${projectTasks.status} = 'done')::int` })
        .from(projectTasks)
        .where(inArray(projectTasks.projectId, ids))
        .groupBy(projectTasks.projectId)
    : [];
  return rows.map((r) => {
    const pr = progress.find((x) => x.projectId === r.p.id);
    return { ...r, tasksTotal: pr?.total ?? 0, tasksDone: pr?.done ?? 0 };
  });
}

export async function getProject(db: DB, actor: Actor, id: string) {
  const p = await loadProject(db, id);
  assertCanSee(actor, p);
  const [customer] = p.customerOrgId ? await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, p.customerOrgId)) : [];
  const [manager] = await db.select({ name: users.name }).from(users).where(eq(users.id, p.managerUserId));
  const milestones = await db.select().from(projectMilestones).where(eq(projectMilestones.projectId, id)).orderBy(asc(projectMilestones.sortOrder));
  const tasks = await db
    .select({ t: projectTasks, assigneeName: users.name })
    .from(projectTasks)
    .leftJoin(users, eq(users.id, projectTasks.assigneeUserId))
    .where(eq(projectTasks.projectId, id))
    .orderBy(asc(projectTasks.createdAt));
  const signers = milestones.flatMap((m) => (m.signedOffBy ? [m.signedOffBy] : []));
  const signerNames = signers.length ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, signers)) : [];
  return { ...p, customerName: customer?.name ?? null, managerName: manager?.name ?? null, milestones, tasks, signerNames };
}

/** SES staff who can run or work on projects. */
export async function projectStaff(db: DB) {
  const ids = await usersWithPermission(db, "projects.write");
  if (ids.length === 0) return [];
  return db.select({ id: users.id, name: users.name }).from(users).where(and(inArray(users.id, ids), eq(users.status, "active"))).orderBy(asc(users.name));
}
