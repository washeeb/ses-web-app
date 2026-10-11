import Link from "next/link";
import type { Metadata } from "next";
import { getDb } from "@/server/db/client";
import { requireActor } from "@/server/web/session";
import { can } from "@/server/authz/policy";
import { listAllArticles } from "@/server/modules/knowledge";
import { Badge, Card, DateTime, EmptyState, PageHeader, StatusBadge, TableWrap } from "@/components/ui";

export const metadata: Metadata = { title: "Knowledge base" };

export default async function KnowledgePage() {
  const actor = await requireActor("operator");
  if (!can(actor, "kb.write")) return <EmptyState title="You can't open this page">Knowledge-base editing needs the kb.write permission. Everyone can read articles in the <Link href="/help" className="text-teal-700 underline">help centre</Link>.</EmptyState>;
  const rows = await listAllArticles(getDb(), actor);
  return (
    <>
      <PageHeader
        title="Knowledge base"
        description="Public articles appear in the website help centre; customer articles only for signed-in customers; internal articles only for staff. Support and AI suggestions draw on published articles."
        actions={<><Link href="/help" className="btn btn-ghost">Open help centre</Link><Link href="/ops/knowledge/new" className="btn btn-primary">New article</Link></>}
      />
      <Card>
        {rows.length === 0 ? (
          <EmptyState title="No articles yet">Start with the questions customers ask most often.</EmptyState>
        ) : (
          <TableWrap>
            <table className="table">
              <thead><tr><th>Title</th><th>Audience</th><th>Status</th><th>Updated</th></tr></thead>
              <tbody>
                {rows.map(({ a, editor }) => (
                  <tr key={a.id}>
                    <td><Link href={`/ops/knowledge/${a.id}`} className="font-medium text-teal-700 hover:underline">{a.title}</Link><span className="block text-xs text-slate-600">{a.category}</span></td>
                    <td><Badge tone={a.audience === "public" ? "green" : a.audience === "customers" ? "teal" : "amber"}>{a.audience}</Badge></td>
                    <td><StatusBadge status={a.status === "published" ? "active" : "draft"} /></td>
                    <td className="text-xs"><DateTime value={a.updatedAt} />{editor && <span className="block text-slate-500">{editor}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
    </>
  );
}
