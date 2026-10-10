import { getDb } from "@/server/db/client";
import { requireActor } from "@/server/web/session";
import { authorize } from "@/server/authz/policy";
import { listCustomers } from "@/server/modules/sales";
import { listStoreProducts } from "@/server/modules/catalogue";
import { getSettings } from "@/server/modules/settings";
import { formatMoney } from "@/server/lib/money";
import { ActionForm } from "@/components/action-form";
import { Card, Field, PageHeader } from "@/components/ui";
import { createQuoteAction } from "../../actions";
import { QuoteBuilder } from "./quote-builder";

export default async function NewQuotePage({ searchParams }: { searchParams: Promise<{ customer?: string; lead?: string }> }) {
  const actor = await requireActor("operator");
  authorize(actor, "quotes.write");
  const sp = await searchParams;
  const db = getDb();
  const [customers, products, settings] = await Promise.all([listCustomers(db, actor), listStoreProducts(db), getSettings(db)]);
  const variants = products.flatMap((p) => p.variants.map((v) => ({ id: v.id, label: `${p.name} — ${v.name} (${v.sku})`, priceMinor: v.priceMinor })));
  return (
    <>
      <PageHeader
        title="New quotation"
        description={`Quotations of ${formatMoney(settings.quoteApprovalThresholdMinor)} or more, or with discounts above ${settings.maxDiscountBpWithoutApproval / 100}%, need approval by someone else before they can be sent.`}
      />
      <Card>
        <ActionForm action={createQuoteAction} submitLabel="Create draft">
          <input type="hidden" name="leadId" value={sp.lead ?? ""} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Customer" htmlFor="customerOrgId">
              <select id="customerOrgId" name="customerOrgId" className="field" defaultValue={sp.customer ?? ""} required>
                <option value="" disabled>Choose a customer</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}{c.isDemo ? " (demo)" : ""}</option>
                ))}
              </select>
            </Field>
            <Field label="Discount (%)" htmlFor="discountPercent">
              <input id="discountPercent" name="discountPercent" type="number" min={0} max={50} step="0.5" defaultValue={0} className="field" />
            </Field>
          </div>
          <QuoteBuilder variants={variants} />
          <Field label="Notes for the customer (optional)" htmlFor="notes">
            <textarea id="notes" name="notes" rows={3} className="field" maxLength={2000} />
          </Field>
        </ActionForm>
      </Card>
    </>
  );
}
