import { requireActor } from "@/server/web/session";
import { can } from "@/server/authz/policy";
import { TopNav } from "@/components/side-nav";
import { EmptyState } from "@/components/ui";

export default async function ReportsLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireActor("operator");
  if (!can(actor, "reports.read")) return <EmptyState title="You can't open this page" />;
  const tabs = [
    { href: "/ops/reports", label: "Departments", exact: true },
    { href: "/ops/reports/sales", label: "Sales" },
    { href: "/ops/reports/products", label: "Products" },
    ...(can(actor, "inventory.read") ? [{ href: "/ops/reports/inventory", label: "Inventory" }, { href: "/ops/reports/forecast", label: "Demand forecast" }] : []),
    ...(can(actor, "finance.read") ? [{ href: "/ops/reports/finance", label: "Finance & tax" }] : []),
    ...(can(actor, "procurement.read") ? [{ href: "/ops/reports/purchasing", label: "Procurement" }] : []),
    { href: "/ops/reports/pipeline", label: "Leads & quotations" },
  ];
  return (
    <>
      <nav aria-label="Reports" className="mb-6 flex flex-wrap gap-x-5 gap-y-2 border-b border-slate-200 text-sm print:hidden">
        <TopNav items={tabs} />
      </nav>
      {children}
    </>
  );
}
