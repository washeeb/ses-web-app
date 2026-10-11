import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getDb } from "@/server/db/client";
import { getSessionState } from "@/server/web/session";
import { AppError } from "@/server/lib/errors";
import { getArticleBySlug } from "@/server/modules/knowledge";
import { Badge, DateTime } from "@/components/ui";

export const metadata: Metadata = { title: "Help article" };

export default async function HelpArticle({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const session = await getSessionState();
  const actor = session && !session.pending ? session.actor : null;
  const a = await getArticleBySlug(getDb(), actor, slug).catch((e) => {
    if (e instanceof AppError) notFound();
    throw e;
  });
  return (
    <article className="mx-auto max-w-3xl px-4 py-12">
      <nav aria-label="Breadcrumb" className="text-sm text-slate-500"><Link href="/help" className="hover:underline">Help centre</Link> / <span>{a.title}</span></nav>
      <h1 className="mt-3 text-3xl font-bold text-slate-900">{a.title}</h1>
      <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-600">
        <Badge>{a.category}</Badge>
        {a.status === "draft" && <Badge tone="amber">draft — not visible to readers</Badge>}
        {a.audience === "internal" && <Badge tone="amber">internal — staff only</Badge>}
        <span>Updated <DateTime value={a.updatedAt} dateOnly /></span>
      </p>
      {a.summary && <p className="mt-6 text-lg text-slate-700">{a.summary}</p>}
      {/* Plain text with line breaks: article bodies are never rendered as HTML. */}
      <div className="mt-6 whitespace-pre-line leading-relaxed text-slate-800">{a.body}</div>
      <p className="mt-10 text-sm text-slate-600">
        Still stuck?{" "}
        {actor?.organizationType === "customer" ? <Link href="/portal/support/new" className="text-teal-700">Report a problem</Link> : <Link href="/contact" className="text-teal-700">Contact us</Link>}
      </p>
    </article>
  );
}
