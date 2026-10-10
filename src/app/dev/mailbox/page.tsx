import { notFound } from "next/navigation";
import { getDb } from "@/server/db/client";
import { listMail } from "@/server/modules/mail";
import { Card, DateTime, EmptyState } from "@/components/ui";

export const dynamic = "force-dynamic";

/** Development-only view of e-mails captured by the console mail adapter. Never available in production. */
export default async function DevMailbox() {
  if (process.env.NODE_ENV === "production" || (process.env.MAIL_ADAPTER ?? "console") !== "console") notFound();
  const mail = await listMail(getDb());
  return (
    <main id="main" className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-2xl font-bold">Development mailbox</h1>
      <p className="mb-6 text-sm text-slate-600">E-mails the platform would send. Only available in local development with MAIL_ADAPTER=console.</p>
      {mail.length === 0 ? (
        <EmptyState title="No messages" />
      ) : (
        <div className="space-y-4">
          {mail.map((m) => (
            <Card key={m.id} title={m.subject}>
              <p className="text-xs text-slate-500">To {m.to} · <DateTime value={m.createdAt} /></p>
              <pre className="mt-2 whitespace-pre-wrap break-all text-sm">{m.body}</pre>
            </Card>
          ))}
        </div>
      )}
    </main>
  );
}
