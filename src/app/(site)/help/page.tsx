import Link from "next/link";
import type { Metadata } from "next";
import { getDb } from "@/server/db/client";
import { getSessionState } from "@/server/web/session";
import { searchArticles } from "@/server/modules/knowledge";
import { Badge, EmptyState } from "@/components/ui";

export const metadata: Metadata = { title: "Help centre", description: "Guides and answers for Synclytics Enterprise Systems customers." };

export default async function HelpPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const q = ((await searchParams).q ?? "").slice(0, 200);
  const session = await getSessionState();
  const actor = session && !session.pending ? session.actor : null;
  const articles = await searchArticles(getDb(), actor, q, 30);
  return (
    <div className="mx-auto max-w-4xl px-4 py-12">
      <h1 className="text-3xl font-bold text-slate-900">Help centre</h1>
      <p className="mt-2 text-slate-600">
        Guides and answers from our support team.{" "}
        {actor?.organizationType === "customer" ? "You also see guides for customers." : actor ? null : <>Customers can <Link href="/login?next=/help" className="text-teal-700">sign in</Link> to see more guides.</>}
      </p>
      <form role="search" className="mt-6 flex gap-2">
        <label htmlFor="q" className="sr-only">Search help articles</label>
        <input id="q" name="q" defaultValue={q} placeholder="Search, e.g. printer offline, VPN, invoice" className="field" />
        <button type="submit" className="btn btn-primary">Search</button>
      </form>
      <div className="mt-8">
        {articles.length === 0 ? (
          <EmptyState title={q ? "No articles match your search" : "No articles yet"}>
            {actor?.organizationType === "customer" ? <Link href="/portal/support/new" className="text-teal-700 underline">Report a problem to our support team</Link> : <Link href="/contact" className="text-teal-700 underline">Contact us</Link>}
          </EmptyState>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
            {articles.map((a) => (
              <li key={a.id} className="p-4">
                <p className="flex flex-wrap items-center gap-2">
                  <Link href={`/help/${a.slug}`} className="font-semibold text-slate-900 hover:text-teal-700">{a.title}</Link>
                  <Badge>{a.category}</Badge>
                  {a.audience === "customers" && <Badge tone="teal">customers</Badge>}
                  {a.audience === "internal" && <Badge tone="amber">internal</Badge>}
                </p>
                {a.summary && <p className="mt-1 text-sm text-slate-600">{a.summary}</p>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
