import { PortalShell } from "@/components/portal-shell";
import { requireActor } from "@/server/web/session";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireActor("customer", "/portal");
  return (
    <PortalShell actor={actor} title="Customer portal" nav={[{ href: "/portal", label: "Overview" }, { href: "/store", label: "Store" }]}>
      {children}
    </PortalShell>
  );
}
