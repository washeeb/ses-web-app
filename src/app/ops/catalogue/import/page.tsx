import { requireActor } from "@/server/web/session";
import { authorize, can } from "@/server/authz/policy";
import { IMPORT_COLUMNS } from "@/server/modules/csv";
import { Card, PageHeader } from "@/components/ui";
import { Importer } from "./importer";

export default async function ImportPage() {
  const actor = await requireActor("operator");
  authorize(actor, "catalogue.write");
  return (
    <>
      <PageHeader
        title="Import products"
        description="Create or update products and options from a CSV file. Rows are matched by SKU. Price changes follow the usual rules: large changes go for approval."
      />
      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <Card>
          <Importer />
        </Card>
        <Card title="File format">
          <p className="text-sm text-slate-600">
            Columns (any order): <code className="text-xs">{IMPORT_COLUMNS.join(", ")}</code>.
          </p>
          <ul className="mt-2 list-inside list-disc text-sm text-slate-600">
            <li>type: hardware, software_licence, subscription or service_package</li>
            <li>price_ghs: e.g. 1250.00 (excluding tax)</li>
            <li>taxable / tracks_stock: yes or no</li>
            <li>billing_period: empty, month or year</li>
            <li>status: draft, active or retired</li>
            <li>Up to 1,000 rows, 1 MB</li>
          </ul>
          {can(actor, "data.export") && (
            <a href="/api/exports/products" className="btn btn-ghost mt-4" download>
              Download current products as a template
            </a>
          )}
        </Card>
      </div>
    </>
  );
}
