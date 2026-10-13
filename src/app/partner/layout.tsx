import { PortalShell } from "@/components/portal-shell";
import { requireActor } from "@/server/web/session";

export default async function PartnerLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireActor("partner", "/partner");
  return (
    <PortalShell actor={actor} title="Partner portal" nav={[{ href: "/partner", label: "Overview", exact: true }]}>
      {children}
    </PortalShell>
  );
}
