import { getDb } from "@/server/db/client";
import { can, type Actor } from "@/server/authz/policy";
import { ALLOWED_EXTENSIONS, listDocuments, MAX_UPLOAD_BYTES, type EntityType } from "@/server/modules/documents";
import { uploadDocumentAction, deleteDocumentAction } from "@/app/documents-actions";
import { ActionForm } from "./action-form";
import { Badge, Card, DateTime } from "./ui";

const kb = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

/** Attachments for a record. Staff can upload and share with the customer; customers only see shared files. */
export async function DocumentsPanel({ actor, entityType, entityId, path, customerFacing = false }: { actor: Actor; entityType: EntityType; entityId: string; path: string; customerFacing?: boolean }) {
  const docs = await listDocuments(getDb(), actor, entityType, entityId);
  const staff = actor.organizationType === "operator";
  const canWrite = staff && can(actor, "documents.write");
  if (!staff && docs.length === 0) return null;
  return (
    <Card title="Documents">
      {docs.length === 0 ? (
        <p className="text-sm text-slate-500">No documents attached.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {docs.map(({ d, uploaderName }) => (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <div className="min-w-0">
                <a href={`/api/documents/${d.id}`} className="break-all font-medium text-teal-700 hover:underline">{d.fileName}</a>
                <p className="text-xs text-slate-500">
                  {kb(d.sizeBytes)} · {uploaderName} · <DateTime value={d.createdAt} />
                </p>
              </div>
              <span className="flex items-center gap-2">
                {staff && (d.visibility === "customer" ? <Badge tone="teal">shared with customer</Badge> : <Badge>internal</Badge>)}
                {canWrite && (
                  <ActionForm action={deleteDocumentAction} inline submitLabel="Remove" submitClassName="text-xs text-red-700 hover:underline" confirm={`Remove ${d.fileName}?`}>
                    <input type="hidden" name="id" value={d.id} />
                    <input type="hidden" name="path" value={path} />
                  </ActionForm>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {canWrite && (
        <ActionForm action={uploadDocumentAction} submitLabel="Upload" submitClassName="btn btn-ghost" className="mt-4 space-y-2" resetOnSuccess>
          <input type="hidden" name="entityType" value={entityType} />
          <input type="hidden" name="entityId" value={entityId} />
          <input type="hidden" name="path" value={path} />
          <label className="field-label" htmlFor={`file-${entityId}`}>Add a file</label>
          <input id={`file-${entityId}`} name="file" type="file" required accept={ALLOWED_EXTENSIONS.map((e) => `.${e}`).join(",")} className="block w-full text-sm" />
          <p className="text-xs text-slate-500">{ALLOWED_EXTENSIONS.join(", ").toUpperCase()} · up to {MAX_UPLOAD_BYTES / 1024 / 1024} MB</p>
          {customerFacing && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="visibility" value="customer" /> Share with the customer (visible in their portal)
            </label>
          )}
        </ActionForm>
      )}
    </Card>
  );
}
