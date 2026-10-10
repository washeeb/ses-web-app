import { PortalShell } from "@/components/portal-shell";
import { requireActor } from "@/server/web/session";
import { can } from "@/server/authz/policy";
import type { Permission } from "@/server/authz/permissions";

const NAV: { href: string; label: string; perm?: Permission }[] = [
  { href: "/portal", label: "Overview" },
  { href: "/portal/invoices", label: "Invoices", perm: "customer.invoices.read" },
  { href: "/portal/support", label: "Support", perm: "customer.tickets.read" },
  { href: "/portal/subscriptions", label: "Subscriptions", perm: "customer.subscriptions.read" },
  { href: "/portal/projects", label: "Projects", perm: "customer.projects.read" },
  { href: "/portal/assets", label: "Equipment", perm: "customer.assets.read" },
  { href: "/portal/returns", label: "Returns & warranty" },
  { href: "/store", label: "Store" },
];

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireActor("customer", "/portal");
  return (
    <PortalShell actor={actor} title="Customer portal" nav={NAV.filter((n) => !n.perm || can(actor, n.perm, { organizationId: actor.organizationId }))}>
      {children}
    </PortalShell>
  );
}
