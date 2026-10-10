import { getDb } from "@/server/db/client";
import { requireActor } from "@/server/web/session";
import { authorize } from "@/server/authz/policy";
import { listCategories } from "@/server/modules/catalogue";
import { ActionForm } from "@/components/action-form";
import { Card, PageHeader } from "@/components/ui";
import { createProductAction } from "../../actions";
import { ProductFields, VariantFields } from "../product-fields";

export default async function NewProductPage() {
  const actor = await requireActor("operator");
  authorize(actor, "catalogue.write");
  const categories = await listCategories(getDb());
  return (
    <>
      <PageHeader title="New product" />
      <Card>
        <ActionForm action={createProductAction} submitLabel="Create product">
          <ProductFields categories={categories} />
          <h2 className="pt-2 font-semibold">First option</h2>
          <VariantFields />
        </ActionForm>
      </Card>
    </>
  );
}
