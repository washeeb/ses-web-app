import Link from "next/link";
import { requireActor } from "@/server/web/session";
import { authorize, can } from "@/server/authz/policy";
import { EXPORTS } from "@/server/modules/csv";
import { Card, PageHeader } from "@/components/ui";

export default async function ExportsPage() {
  const actor = await requireActor("operator");
  authorize(actor, "data.export");
  const allowed = Object.entries(EXPORTS).filter(([, d]) => can(actor, d.perm));
  return (
    <>
      <PageHeader title="Data exports" description="CSV files open in Excel or Google Sheets. Every export is recorded in the audit log. Values that look like spreadsheet formulas are neutralised." />
      <Card>
        <ul className="divide-y divide-slate-100">
          {allowed.map(([kind, d]) => (
            <li key={kind} className="flex items-center justify-between gap-3 py-3">
              <span className="font-medium">{d.label}</span>
              <a href={`/api/exports/${kind}`} className="btn btn-ghost" download>Download CSV</a>
            </li>
          ))}
        </ul>
        {can(actor, "catalogue.write") && (
          <p className="mt-4 text-sm text-slate-600">
            To bulk-update products and prices, edit the products export and <Link href="/ops/catalogue/import" className="text-teal-700 hover:underline">import it</Link>.
          </p>
        )}
      </Card>
    </>
  );
}
