import { desc, eq } from "drizzle-orm";
import nodemailer from "nodemailer";
import type { DB } from "../db/client";
import { mailOutbox } from "../db/schema";
import { log } from "../lib/log";
import { enqueue } from "./jobs";

/**
 * Outgoing e-mail. Messages are stored, then delivered by the job queue (with retries):
 * - MAIL_ADAPTER=console — development: kept for /dev/mailbox, never sent.
 * - MAIL_ADAPTER=smtp — the hosting provider's mailbox (SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASSWORD, MAIL_FROM).
 */
export async function sendMail(db: DB, msg: { to: string; subject: string; body: string }) {
  const adapter = process.env.MAIL_ADAPTER ?? "console";
  if (!["console", "smtp"].includes(adapter)) throw new Error(`Unknown MAIL_ADAPTER "${adapter}".`);
  const [row] = await db.insert(mailOutbox).values({ ...msg, adapter }).returning({ id: mailOutbox.id });
  await enqueue(db, { type: "mail.send", payload: { id: row!.id }, dedupeKey: `mail:${row!.id}`, maxAttempts: 6 });
  log.info("mail.queued", { to: msg.to, subject: msg.subject, adapter });
}

type Transport = { sendMail: (m: { from: string; to: string; subject: string; text: string }) => Promise<unknown> };
let transport: Transport | null = null;

function smtpTransport(): Transport {
  if (transport) return transport;
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASSWORD;
  if (!host || !user || !pass) throw new Error("SMTP is not configured (SMTP_HOST, SMTP_USER, SMTP_PASSWORD).");
  const port = Number(process.env.SMTP_PORT ?? 465);
  transport = nodemailer.createTransport({
    host,
    port,
    secure: (process.env.SMTP_SECURE ?? (port === 465 ? "true" : "false")) === "true",
    auth: { user, pass },
    requireTLS: port !== 465, // never send credentials in clear text
  });
  return transport;
}

/** Job handler. After a real send the body is erased, because it may contain one-time links. */
export async function deliverMail(db: DB, payload: Record<string, unknown>, t: Transport | null = null) {
  const [m] = await db.select().from(mailOutbox).where(eq(mailOutbox.id, String(payload.id)));
  if (!m || m.sentAt) return;
  if (m.adapter === "console") {
    await db.update(mailOutbox).set({ sentAt: new Date() }).where(eq(mailOutbox.id, m.id));
    return;
  }
  try {
    await (t ?? smtpTransport()).sendMail({ from: process.env.MAIL_FROM ?? process.env.SMTP_USER!, to: m.to, subject: m.subject, text: m.body });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.update(mailOutbox).set({ lastError: message.slice(0, 500) }).where(eq(mailOutbox.id, m.id));
    throw err;
  }
  await db.update(mailOutbox).set({ sentAt: new Date(), lastError: null, body: "[delivered — body removed]" }).where(eq(mailOutbox.id, m.id));
}

export async function listMail(db: DB, limit = 50) {
  return db.select().from(mailOutbox).orderBy(desc(mailOutbox.createdAt)).limit(limit);
}
