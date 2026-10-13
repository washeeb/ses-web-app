import type { ActionState } from "@/server/web/actions";
import { ActionForm } from "./action-form";
import { ImageUploader } from "./image-uploader";
import { Picture } from "./picture";

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;
type Img = { id: string; ext: string; widths: number[]; width: number; height: number; alt: string };

/** Staff view of an item's pictures: first is the main one; reorder, describe, remove, upload more. */
export function ImageManager({
  images,
  ownerType,
  ownerId,
  defaultAlt,
  canWrite,
  uploadAction,
  imageAction,
  single = false,
}: {
  images: Img[];
  ownerType: string;
  ownerId: string;
  defaultAlt: string;
  canWrite: boolean;
  uploadAction: Action;
  imageAction: Action;
  /** Categories and brands show one picture: uploading replaces nothing, but only the first is used. */
  single?: boolean;
}) {
  const op = (id: string, name: string) => (
    <>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="op" value={name} />
    </>
  );
  return (
    <div className="space-y-4">
      {images.length === 0 ? (
        <p className="text-sm text-slate-600">No pictures yet.</p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {images.map((m, i) => (
            <li key={m.id} className="rounded-lg border border-slate-200 p-2">
              <div className="relative">
                <Picture m={m} sizes="(min-width: 1024px) 240px, 50vw" fallbackWidth={320} className="aspect-square w-full rounded object-contain bg-slate-50" alt={m.alt || defaultAlt} />
                {i === 0 && <span className="absolute left-1 top-1 rounded bg-teal-700 px-1.5 py-0.5 text-xs font-semibold text-white">{single ? "In use" : "Main"}</span>}
              </div>
              <p className="mt-1 text-xs text-slate-600">{m.width} × {m.height}px</p>
              {canWrite && (
                <div className="mt-2 space-y-2">
                  <ActionForm action={imageAction} inline submitLabel="Save" submitClassName="btn btn-ghost px-2 py-1 text-xs">
                    {op(m.id, "alt")}
                    <label className="sr-only" htmlFor={`alt-${m.id}`}>Description</label>
                    <input id={`alt-${m.id}`} name="alt" className="field py-1 text-xs" defaultValue={m.alt} placeholder="Describe the picture" maxLength={200} />
                  </ActionForm>
                  <div className="flex flex-wrap gap-1">
                    {i > 0 && (
                      <ActionForm action={imageAction} inline submitLabel={single ? "Use this" : "Make main"} submitClassName="btn btn-ghost px-2 py-1 text-xs">
                        {op(m.id, "main")}
                      </ActionForm>
                    )}
                    {!single && i > 0 && (
                      <ActionForm action={imageAction} inline submitLabel="← Earlier" submitClassName="btn btn-ghost px-2 py-1 text-xs">
                        {op(m.id, "left")}
                      </ActionForm>
                    )}
                    {!single && i < images.length - 1 && (
                      <ActionForm action={imageAction} inline submitLabel="Later →" submitClassName="btn btn-ghost px-2 py-1 text-xs">
                        {op(m.id, "right")}
                      </ActionForm>
                    )}
                    <ActionForm action={imageAction} inline submitLabel="Remove" submitClassName="btn btn-ghost px-2 py-1 text-xs text-red-700" confirm="Remove this picture?">
                      {op(m.id, "delete")}
                    </ActionForm>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {canWrite && <ImageUploader action={uploadAction} ownerType={ownerType} ownerId={ownerId} defaultAlt={defaultAlt} multiple={!single} />}
    </div>
  );
}
