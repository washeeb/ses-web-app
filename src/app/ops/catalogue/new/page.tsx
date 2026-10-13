import { getDb } from "@/server/db/client";
import { requireActor } from "@/server/web/session";
import { authorize } from "@/server/authz/policy";
import { listBrands, listCategoriesTree, listTags } from "@/server/modules/taxonomy";
import { ActionForm } from "@/components/action-form";
import { Card, PageHeader } from "@/components/ui";
import { createProductAction } from "../../actions";
import { ProductFields, VariantFields } from "../product-fields";

export default async function NewProductPage() {
  const actor = await requireActor("operator");
  authorize(actor, "catalogue.write");
  const db = getDb();
  const [categories, brands, tags] = await Promise.all([listCategoriesTree(db), listBrands(db), listTags(db)]);
  return (
    <>
      <PageHeader title="New product" />
      <Card>
        <ActionForm action={createProductAction} submitLabel="Create product">
          <ProductFields categories={categories} brands={brands} tagNames={tags.map((t) => t.name)} />
          <h2 className="pt-2 font-semibold">First option</h2>
          <VariantFields />
        </ActionForm>
      </Card>
    </>
  );
}
