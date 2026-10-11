import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getDb } from "@/server/db/client";
import { requireActor } from "@/server/web/session";
import { can } from "@/server/authz/policy";
import { AppError } from "@/server/lib/errors";
import { getArticleForEdit, KB_CATEGORIES } from "@/server/modules/knowledge";
import { ActionForm } from "@/components/action-form";
import { Card, EmptyState, Field, PageHeader } from "@/components/ui";
import { deleteArticleAction, saveArticleAction } from "../actions";

export const metadata: Metadata = { title: "Article" };

export default async function ArticleEditor({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requireActor("operator");
  if (!can(actor, "kb.write")) return <EmptyState title="You can't open this page" />;
  const isNew = id === "new";
  const a = isNew
    ? null
    : await getArticleForEdit(getDb(), actor, id).catch((e) => {
        if (e instanceof AppError) notFound();
        throw e;
      });
  return (
    <>
      <Link href="/ops/knowledge" className="text-sm text-teal-700 hover:underline">← Knowledge base</Link>
      <div className="mt-4">
        <PageHeader title={a ? a.title : "New article"} description="Plain text: blank lines separate paragraphs. Never include passwords, keys or customer personal data." actions={a?.status === "published" ? <Link href={`/help/${a.slug}`} className="btn btn-ghost">View</Link> : undefined} />
      </div>
      <div className="grid gap-6 xl:grid-cols-[1fr_300px]">
        <Card>
          <ActionForm action={saveArticleAction} submitLabel="Save article">
            <input type="hidden" name="id" value={a?.id ?? ""} />
            <Field label="Title" htmlFor="title"><input id="title" name="title" className="field" required minLength={5} maxLength={160} defaultValue={a?.title} /></Field>
            <Field label="Summary (optional)" htmlFor="summary" hint="One sentence shown in search results."><input id="summary" name="summary" className="field" maxLength={300} defaultValue={a?.summary ?? ""} /></Field>
            <Field label="Article" htmlFor="body"><textarea id="body" name="body" rows={16} className="field font-mono text-sm" required minLength={20} maxLength={30000} defaultValue={a?.body} /></Field>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Category" htmlFor="category">
                <select id="category" name="category" className="field" defaultValue={a?.category ?? "general"}>
                  {KB_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </Field>
              <Field label="Who can read it" htmlFor="audience">
                <select id="audience" name="audience" className="field" defaultValue={a?.audience ?? "customers"}>
                  <option value="public">Everyone (website)</option>
                  <option value="customers">Signed-in customers</option>
                  <option value="internal">SES staff only</option>
                </select>
              </Field>
              <Field label="Status" htmlFor="status">
                <select id="status" name="status" className="field" defaultValue={a?.status ?? "draft"}>
                  <option value="draft">Draft</option>
                  <option value="published">Published</option>
                </select>
              </Field>
            </div>
          </ActionForm>
        </Card>
        {a && a.status === "draft" && (
          <Card title="Delete">
            <ActionForm action={deleteArticleAction} submitLabel="Delete draft" submitClassName="btn btn-danger w-full" confirm="Delete this draft article permanently?">
              <input type="hidden" name="id" value={a.id} />
            </ActionForm>
          </Card>
        )}
      </div>
    </>
  );
}
