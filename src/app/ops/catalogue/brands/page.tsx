import Link from "next/link";
import type { Metadata } from "next";
import { getDb } from "@/server/db/client";
import { requireActor } from "@/server/web/session";
import { can } from "@/server/authz/policy";
import { listBrands } from "@/server/modules/taxonomy";
import { mainImages } from "@/server/modules/media";
import { ActionForm } from "@/components/action-form";
import { BrandFields } from "@/components/taxonomy-forms";
import { NoPicture, Picture } from "@/components/picture";
import { Badge, Card, EmptyState, PageHeader, TableWrap } from "@/components/ui";
import { brandAction } from "../../actions";

export const metadata: Metadata = { title: "Brands" };

export default async function BrandsPage() {
  const actor = await requireActor("operator");
  if (!can(actor, "catalogue.read")) return <EmptyState title="You can't open this page" />;
  const db = getDb();
  const rows = await listBrands(db);
  const logos = await mainImages(db, "brand", rows.map((r) => r.id));
  return (
    <>
      <PageHeader title="Brands" description="Manufacturers and labels. Shoppers can filter by brand, and the brand shows on product pages." />
      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <Card>
          {rows.length === 0 ? <EmptyState title="No brands yet" /> : (
            <TableWrap>
              <table className="table">
                <thead><tr><th className="w-16"><span className="sr-only">Logo</span></th><th>Brand</th><th>Products</th><th>Shop</th></tr></thead>
                <tbody>
                  {rows.map((b) => {
                    const logo = logos.get(b.id);
                    return (
                      <tr key={b.id}>
                        <td>{logo ? <Picture m={logo} sizes="48px" fallbackWidth={320} className="h-12 w-12 rounded object-contain" alt="" /> : <NoPicture label={b.name} className="h-12 w-12 rounded" />}</td>
                        <td><Link href={`/ops/catalogue/brands/${b.id}`} className="font-medium text-teal-700 hover:underline">{b.name}</Link></td>
                        <td>{b.productCount}</td>
                        <td>{b.active ? <Badge tone="green">shown</Badge> : <Badge>hidden</Badge>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Card>
        {can(actor, "catalogue.write") && (
          <Card title="New brand">
            <ActionForm action={brandAction} submitLabel="Create brand">
              <BrandFields b={null} />
            </ActionForm>
          </Card>
        )}
      </div>
    </>
  );
}
