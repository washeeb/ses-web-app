import { Field } from "./ui";

type Category = { id: string; name: string; slug: string; description: string | null; parentId: string | null; skuCode: string | null; active: boolean; sortOrder: number };

/** Fields for a new or existing category. Parents are top-level categories other than this one. */
export function CategoryFields({ c, parents }: { c: Category | null; parents: { id: string; name: string }[] }) {
  return (
    <>
      {c && <input type="hidden" name="id" value={c.id} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" htmlFor="name"><input id="name" name="name" className="field" required minLength={2} maxLength={80} defaultValue={c?.name} /></Field>
        <Field label="Inside" htmlFor="parentId" hint="Leave as top level, or choose a parent to make a sub-category.">
          <select id="parentId" name="parentId" className="field" defaultValue={c?.parentId ?? ""}>
            <option value="">Top level</option>
            {parents.filter((p) => p.id !== c?.id).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Description" htmlFor="description" hint="Shown at the top of the category in the store."><textarea id="description" name="description" rows={2} className="field" maxLength={1000} defaultValue={c?.description ?? ""} /></Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Web address" htmlFor="slug" hint="Leave empty to use the name.">
          <input id="slug" name="slug" className="field" maxLength={80} defaultValue={c?.slug} pattern="[a-z0-9-]*" />
        </Field>
        <Field label="SKU code" htmlFor="skuCode" hint="Three letters for new SKUs, e.g. NET.">
          <input id="skuCode" name="skuCode" className="field uppercase" maxLength={3} pattern="[A-Za-z]{3}" defaultValue={c?.skuCode ?? ""} />
        </Field>
        <Field label="Order" htmlFor="sortOrder" hint="Lower comes first.">
          <input id="sortOrder" name="sortOrder" type="number" min={0} max={1000} className="field" defaultValue={c?.sortOrder ?? 0} />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={c?.active ?? true} /> Show in the store</label>
    </>
  );
}

type Brand = { id: string; name: string; description: string | null; website: string | null; active: boolean };

export function BrandFields({ b }: { b: Brand | null }) {
  return (
    <>
      {b && <input type="hidden" name="id" value={b.id} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" htmlFor="name"><input id="name" name="name" className="field" required maxLength={80} defaultValue={b?.name} /></Field>
        <Field label="Website" htmlFor="website"><input id="website" name="website" type="url" className="field" maxLength={200} defaultValue={b?.website ?? ""} placeholder="https://" /></Field>
      </div>
      <Field label="Description" htmlFor="description"><textarea id="description" name="description" rows={2} className="field" maxLength={1000} defaultValue={b?.description ?? ""} /></Field>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={b?.active ?? true} /> Show in the store</label>
    </>
  );
}
