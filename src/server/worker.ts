import type { DB } from "./db/client";
import { log } from "./lib/log";
import { enqueue, runDueJobs, type JobHandlers } from "./modules/jobs";
import { runMaintenance } from "./modules/maintenance";
import { onInboundDead, processInboundEvent } from "./modules/integrations/inbound";
import { deliverOutbound } from "./modules/integrations/outbound";
import { checkLowStock, expireReservations } from "./modules/inventory";
import { deliverMail } from "./modules/mail";
import { verifyAndApplyPayment } from "./modules/payments/paystack";
import { sendInvoiceReminders } from "./modules/invoices";
import { runRenewals } from "./modules/subscriptions";
import { autoCloseTickets, checkSla } from "./modules/tickets";

export const JOB_HANDLERS: JobHandlers = {
  "integration.inbound.process": (db, payload) => processInboundEvent(db, String(payload.inboundEventId)),
  "integration.outbound.deliver": (db, payload, job) => deliverOutbound(db, payload, job),
  "mail.send": (db, payload) => deliverMail(db, payload),
  "maintenance.hourly": async (db) => {
    await runMaintenance(db);
    await checkLowStock(db);
  },
  "invoices.reminders": async (db) => {
    await sendInvoiceReminders(db);
  },
  "services.daily": async (db) => {
    await runRenewals(db);
    await autoCloseTickets(db);
  },
  "tickets.sla": async (db) => {
    await checkSla(db);
  },
  "payment.paystack.verify": async (db, payload) => {
    await verifyAndApplyPayment(db, String(payload.reference));
  },
};

export async function tick(db: DB) {
  // At most one clean-up per hour, whichever process or cron call gets there first.
  await enqueue(db, { type: "maintenance.hourly", dedupeKey: `maintenance:${new Date().toISOString().slice(0, 13)}`, maxAttempts: 3 });
  // Overdue-invoice reminders once a day, after 08:00 UTC (Accra time).
  const now = new Date();
  if (now.getUTCHours() >= 8) await enqueue(db, { type: "invoices.reminders", dedupeKey: `invoices:reminders:${now.toISOString().slice(0, 10)}`, maxAttempts: 3 });
  // Subscription renewals and ticket auto-close daily; SLA breach checks every minute.
  if (now.getUTCHours() >= 6) await enqueue(db, { type: "services.daily", dedupeKey: `services:daily:${now.toISOString().slice(0, 10)}`, maxAttempts: 3 });
  await enqueue(db, { type: "tickets.sla", dedupeKey: `tickets:sla:${now.toISOString().slice(0, 16)}`, maxAttempts: 2 });
  const result = await runDueJobs(db, JOB_HANDLERS, {
    onDead: async (db, job, error) => {
      if (job.type === "integration.inbound.process") await onInboundDead(db, job, error);
    },
  });
  const expired = await expireReservations(db);
  return { ...result, expired };
}

const g = globalThis as unknown as { __sesWorker?: NodeJS.Timeout };

/** Polls the job table. One worker per database when using PGlite (single-process). */
export function startWorker(db: DB, intervalMs = 2000) {
  if (g.__sesWorker) return;
  let running = false;
  g.__sesWorker = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      const r = await tick(db);
      if (r.done || r.retried || r.dead || r.expired) log.info("worker.tick", r);
    } catch (err) {
      log.error("worker.tick_failed", { error: err instanceof Error ? err.message : String(err) });
    } finally {
      running = false;
    }
  }, intervalMs);
  log.info("worker.started", { intervalMs });
}
