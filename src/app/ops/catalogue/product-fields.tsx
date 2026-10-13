import { Field } from "@/components/ui";
import { PRODUCT_TYPE_LABEL, PRODUCT_TYPES } from "@/server/modules/catalogue";

interface Defaults {
  name?: string;
  summary?: string | null;
  description?: string | null;
  type?: string;
  categoryId?: string | null;
  brandId?: string | null;
  specs?: { name: string; value: string }[];
  status?: string;
}

export function ProductFields({
  categories,
  brands,
  tagNames,
  tags = [],
  d = {},
}: {
  categories: { id: string; name: string; depth: number; active: boolean }[];
  brands: { id: string; name: string; active: boolean }[];
  /** All existing tag names, offered as suggestions. */
  tagNames: string[];
  /** This product's tags. */
  tags?: string[];
  d?: Defaults;
}) {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" htmlFor="name">
          <input id="name" name="name" className="field" required minLength={3} maxLength={160} defaultValue={d.name} />
        </Field>
        <Field label="Type" htmlFor="type">
          <select id="type" name="type" className="field" defaultValue={d.type ?? "hardware"}>
            {PRODUCT_TYPES.map((t) => (
              <option key={t} value={t}>{PRODUCT_TYPE_LABEL[t]}</option>
            ))}
          </select>
        </Field>
        <Field label="Category" htmlFor="categoryId">
          <select id="categoryId" name="categoryId" className="field" defaultValue={d.categoryId ?? ""}>
            <option value="">None</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.depth ? "\u00a0\u00a0— " : ""}{c.name}{c.active ? "" : " (hidden)"}</option>
            ))}
          </select>
        </Field>
        <Field label="Brand" htmlFor="brandId">
          <select id="brandId" name="brandId" className="field" defaultValue={d.brandId ?? ""}>
            <option value="">None</option>
            {brands.map((b) => <option key={b.id} value={b.id}>{b.name}{b.active ? "" : " (hidden)"}</option>)}
          </select>
        </Field>
        <Field label="Status" htmlFor="status" hint="Only active products appear in the public store.">
          <select id="status" name="status" className="field" defaultValue={d.status ?? "draft"}>
            <option value="draft">Draft</option>
            <option value="active">Active</option>
            <option value="retired">Retired</option>
          </select>
        </Field>
      </div>
      <Field label="Summary" htmlFor="summary">
        <input id="summary" name="summary" className="field" maxLength={300} defaultValue={d.summary ?? ""} />
      </Field>
      <Field label="Description" htmlFor="description">
        <textarea id="description" name="description" rows={4} className="field" maxLength={5000} defaultValue={d.description ?? ""} />
      </Field>
      <Field label="Tags" htmlFor="tagsText" hint="Separate with commas. New tags are created automatically.">
        <input id="tagsText" name="tagsText" className="field" maxLength={1000} defaultValue={tags.join(", ")} list="tag-suggestions" autoComplete="off" />
      </Field>
      <datalist id="tag-suggestions">{tagNames.map((t) => <option key={t} value={t} />)}</datalist>
      <Field label="Specifications" htmlFor="specsText" hint={'One per line, as "Name: value" — e.g. "Licence term: 12 months". Shown as a table in the store.'}>
        <textarea id="specsText" name="specsText" rows={4} className="field font-mono text-sm" maxLength={10000} defaultValue={(d.specs ?? []).map((s) => `${s.name}: ${s.value}`).join("\n")} />
      </Field>
    </>
  );
}

export function VariantFields() {
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <Field label="SKU" htmlFor="sku" hint="Leave empty to assign one automatically.">
        <input id="sku" name="sku" className="field uppercase" pattern="[A-Za-z0-9][A-Za-z0-9\-]{2,40}" placeholder="SE-NET-00001" />
      </Field>
      <Field label="Option name" htmlFor="variantName">
        <input id="variantName" name="variantName" className="field" required defaultValue="Standard" />
      </Field>
      <Field label="Price (GHS, excl. tax)" htmlFor="price">
        <input id="price" name="price" className="field" inputMode="decimal" required placeholder="1250.00" />
      </Field>
      <Field label="Billing period" htmlFor="billingPeriod">
        <select id="billingPeriod" name="billingPeriod" className="field" defaultValue="">
          <option value="">One-off</option>
          <option value="month">Monthly</option>
          <option value="year">Yearly</option>
        </select>
      </Field>
      <Field label="Warranty (months, 0 = none)" htmlFor="warrantyMonths">
        <input id="warrantyMonths" name="warrantyMonths" type="number" min={0} max={120} defaultValue={0} className="field" />
      </Field>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="taxable" defaultChecked /> Taxable</label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="tracksStock" defaultChecked /> Tracks stock (physical item)</label>
    </div>
  );
}
