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

type Slide = { id: string; headline: string; body: string | null; ctaLabel: string | null; ctaHref: string | null; active: boolean; sortOrder: number; startsOn: string | null; endsOn: string | null };

/** Home page slide wording, button and dates. The picture is managed separately. */
export function SlideFields({ s, nextOrder = 0 }: { s: Slide | null; nextOrder?: number }) {
  return (
    <>
      {s && <input type="hidden" name="id" value={s.id} />}
      <Field label="Headline" htmlFor="headline" hint="Short and specific: what you offer or what's new.">
        <input id="headline" name="headline" className="field" required minLength={3} maxLength={120} defaultValue={s?.headline} />
      </Field>
      <Field label="Text" htmlFor="body" hint="One or two sentences under the headline.">
        <textarea id="body" name="body" rows={2} className="field" maxLength={300} defaultValue={s?.body ?? ""} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Button label" htmlFor="ctaLabel" hint="Leave both empty for no button.">
          <input id="ctaLabel" name="ctaLabel" className="field" maxLength={40} defaultValue={s?.ctaLabel ?? ""} placeholder="Visit the shop" />
        </Field>
        <Field label="Button link" htmlFor="ctaHref" hint="A page here, e.g. /shop, or an https:// address.">
          <input id="ctaHref" name="ctaHref" className="field" maxLength={300} defaultValue={s?.ctaHref ?? ""} placeholder="/shop" />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Show from" htmlFor="startsOn" hint="Optional.">
          <input id="startsOn" name="startsOn" type="date" className="field" defaultValue={s?.startsOn ?? ""} />
        </Field>
        <Field label="Show until" htmlFor="endsOn" hint="Optional; includes this day.">
          <input id="endsOn" name="endsOn" type="date" className="field" defaultValue={s?.endsOn ?? ""} />
        </Field>
        <Field label="Order" htmlFor="sortOrder" hint="Lower comes first.">
          <input id="sortOrder" name="sortOrder" type="number" min={0} max={1000} className="field" defaultValue={s?.sortOrder ?? nextOrder} />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={s?.active ?? true} /> Show on the home page</label>
    </>
  );
}
