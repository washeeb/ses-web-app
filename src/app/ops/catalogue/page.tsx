import Link from "next/link";
import { getDb } from "@/server/db/client";
import { requireActor } from "@/server/web/session";
import { listProductsAdmin, PRODUCT_TYPE_LABEL } from "@/server/modules/catalogue";
import { can } from "@/server/authz/policy";
import { AvailabilityBadge } from "@/components/availability";
import { Badge, Card, EmptyState, Money, PageHeader, StatusBadge, TableWrap } from "@/components/ui";
import { LiveRefresh } from "@/components/live-refresh";

export default async function CataloguePage() {
  const actor = await requireActor("operator");
  const products = await listProductsAdmin(getDb(), actor);
  return (
    <>
      <PageHeader
        title="Catalogue & stock"
        description="Products from SES and connected partners. Partner products arrive as drafts and are only sold once you activate them."
        actions={
          <>
            <LiveRefresh topics={["catalogue", "stock"]} />
            {can(actor, "catalogue.write") && <Link href="/ops/catalogue/new" className="btn btn-primary">New product</Link>}
          </>
        }
      />
      <Card>
        {products.length === 0 ? (
          <EmptyState title="No products yet" />
        ) : (
          <TableWrap>
            <table className="table">
              <thead><tr><th>Product</th><th>Type</th><th>Status</th><th>Options</th><th>Availability</th></tr></thead>
              <tbody>
                {products.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <Link href={`/ops/catalogue/${p.id}`} className="font-medium text-teal-700 hover:underline">{p.name}</Link>
                      <div className="mt-1 flex gap-1">
                        {p.sourceConnectionId && <Badge tone="purple">Partner</Badge>}
                        {p.isDemo && <Badge tone="amber">Demo</Badge>}
                      </div>
                    </td>
                    <td>{PRODUCT_TYPE_LABEL[p.type]}</td>
                    <td><StatusBadge status={p.status} /></td>
                    <td>
                      {p.variants.map((v) => (
                        <p key={v.id} className="text-xs">{v.sku} · <Money minor={v.priceMinor} currency={v.currency} /></p>
                      ))}
                      {p.variants.length === 0 && <span className="text-xs text-slate-500">No active options</span>}
                    </td>
                    <td>{p.variants[0] && <AvailabilityBadge a={p.variants[0].availability} showCount />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
    </>
  );
}
