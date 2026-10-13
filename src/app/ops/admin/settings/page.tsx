import { getDb } from "@/server/db/client";
import { requireActor } from "@/server/web/session";
import { authorize } from "@/server/authz/policy";
import { getSettings, listCurrencies, listTaxes } from "@/server/modules/settings";
import { aiConfig } from "@/server/modules/ai";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, Field, PageHeader } from "@/components/ui";
import { updateSettingsAction, upsertTaxAction } from "../../actions";

export default async function SettingsPage() {
  const actor = await requireActor("operator");
  authorize(actor, "settings.manage");
  const db = getDb();
  const [s, currencies, taxes] = await Promise.all([getSettings(db), listCurrencies(db), listTaxes(db)]);
  const aiConfigured = !!aiConfig();
  return (
    <>
      <PageHeader title="Company settings" description="Changes are audited. Thresholds take effect for new quotations and price changes." />
      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Company & controls">
          <ActionForm action={updateSettingsAction} submitLabel="Save settings">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Company name" htmlFor="companyName"><input id="companyName" name="companyName" className="field" defaultValue={s.companyName} required /></Field>
              <Field label="Default currency" htmlFor="defaultCurrency">
                <select id="defaultCurrency" name="defaultCurrency" className="field" defaultValue={s.defaultCurrency}>
                  {currencies.map((c) => <option key={c.code} value={c.code} disabled={!c.active}>{c.code} — {c.name}{c.active ? "" : " (inactive)"}</option>)}
                </select>
              </Field>
              <Field label="Locale" htmlFor="locale"><input id="locale" name="locale" className="field" defaultValue={s.locale} /></Field>
              <Field label="Time zone" htmlFor="timezone"><input id="timezone" name="timezone" className="field" defaultValue={s.timezone} /></Field>
              <Field label="Quotation approval threshold (GHS)" htmlFor="quoteApprovalThreshold"><input id="quoteApprovalThreshold" name="quoteApprovalThreshold" className="field" defaultValue={(s.quoteApprovalThresholdMinor / 100).toFixed(2)} /></Field>
              <Field label="Purchase order approval threshold (GHS)" htmlFor="poApprovalThreshold"><input id="poApprovalThreshold" name="poApprovalThreshold" className="field" defaultValue={(s.poApprovalThresholdMinor / 100).toFixed(2)} /></Field>
              <Field label="Max discount without approval (%)" htmlFor="maxDiscountPercent"><input id="maxDiscountPercent" name="maxDiscountPercent" type="number" step="0.5" className="field" defaultValue={s.maxDiscountBpWithoutApproval / 100} /></Field>
              <Field label="Price change needing approval (≥ %)" htmlFor="sensitivePricePercent"><input id="sensitivePricePercent" name="sensitivePricePercent" type="number" step="0.5" className="field" defaultValue={s.sensitivePriceChangeBp / 100} /></Field>
              <Field label="Quotation validity (days)" htmlFor="quoteValidityDays"><input id="quoteValidityDays" name="quoteValidityDays" type="number" className="field" defaultValue={s.quoteValidityDays} /></Field>
              <Field label="Return window after delivery (days)" htmlFor="returnWindowDays"><input id="returnWindowDays" name="returnWindowDays" type="number" min={0} className="field" defaultValue={s.returnWindowDays} /></Field>
              <Field label="Stock hold after acceptance (hours)" htmlFor="reservationHoldHours"><input id="reservationHoldHours" name="reservationHoldHours" type="number" className="field" defaultValue={s.reservationHoldHours} /></Field>
              <Field label="Support e-mail" htmlFor="supportEmail"><input id="supportEmail" name="supportEmail" type="email" className="field" defaultValue={s.supportEmail} /></Field>
              <Field label="Support phone" htmlFor="supportPhone"><input id="supportPhone" name="supportPhone" className="field" defaultValue={s.supportPhone} /></Field>
              <Field label="Store order limit (GHS)" htmlFor="storeOrderLimit" hint="Carts at or above this total must go through a quotation."><input id="storeOrderLimit" name="storeOrderLimit" className="field" defaultValue={(s.storeOrderLimitMinor / 100).toFixed(2)} /></Field>
              <Field label="Invoice payment terms (days)" htmlFor="invoiceDueDays"><input id="invoiceDueDays" name="invoiceDueDays" type="number" min={0} className="field" defaultValue={s.invoiceDueDays} /></Field>
              <Field label="Renewal notice before period end (days)" htmlFor="renewalNoticeDays" hint="The renewal invoice is issued then."><input id="renewalNoticeDays" name="renewalNoticeDays" type="number" min={1} max={90} className="field" defaultValue={s.renewalNoticeDays} /></Field>
              <Field label="Renewal grace period (days)" htmlFor="renewalGraceDays" hint="Unpaid subscriptions lapse after this."><input id="renewalGraceDays" name="renewalGraceDays" type="number" min={0} max={60} className="field" defaultValue={s.renewalGraceDays} /></Field>
              <Field label="Close resolved tickets after (days)" htmlFor="ticketAutoCloseDays"><input id="ticketAutoCloseDays" name="ticketAutoCloseDays" type="number" min={1} max={60} className="field" defaultValue={s.ticketAutoCloseDays} /></Field>
            </div>
            <fieldset className="rounded-lg border border-slate-200 p-3">
              <legend className="px-1 text-sm font-semibold">Invoice details</legend>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Business address" htmlFor="companyAddress"><input id="companyAddress" name="companyAddress" className="field" defaultValue={s.companyAddress} maxLength={300} /></Field>
                <Field label="GRA taxpayer ID (TIN)" htmlFor="companyTin" hint="Printed on invoices once set."><input id="companyTin" name="companyTin" className="field" defaultValue={s.companyTin} maxLength={40} /></Field>
              </div>
              <div className="mt-4">
                <Field label="Payment instructions" htmlFor="paymentInstructions" hint="Bank account or mobile money details shown on every invoice."><textarea id="paymentInstructions" name="paymentInstructions" rows={3} className="field" defaultValue={s.paymentInstructions} maxLength={1000} /></Field>
              </div>
            </fieldset>
            <fieldset className="rounded-lg border border-slate-200 p-3">
              <legend className="px-1 text-sm font-semibold">AI assistance</legend>
              <p className="mb-3 text-xs text-slate-600">
                Suggestions for support replies and report summaries, for staff only. Ticket text is sent to the AI provider (with e-mail addresses and phone numbers removed). It also needs a provider key on the server: {aiConfigured ? "configured." : "not configured yet — the switch has no effect until it is."}
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="aiEnabled" defaultChecked={s.aiEnabled} /> Turn on AI assistance</label>
                <Field label="Requests per person per day" htmlFor="aiDailyLimitPerUser"><input id="aiDailyLimitPerUser" name="aiDailyLimitPerUser" type="number" min={0} max={500} className="field" defaultValue={s.aiDailyLimitPerUser} /></Field>
              </div>
            </fieldset>
            <fieldset className="rounded-lg border border-slate-200 p-3">
              <legend className="px-1 text-sm font-semibold">Reports</legend>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="weeklyReport" defaultChecked={s.weeklyReport} /> E-mail a weekly summary every Monday to staff who can view reports (each sees only what their role allows)</label>
            </fieldset>
            <fieldset className="rounded-lg border border-slate-200 p-3">
              <legend className="px-1 text-sm font-semibold">Data Protection Commission (Ghana)</legend>
              <p className="mb-3 text-xs text-slate-600">Once registered, enter the certificate details. The number appears on the privacy notice and site footer, and administrators are reminded 60 days before expiry.</p>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Registration number" htmlFor="dpcRegistrationNumber"><input id="dpcRegistrationNumber" name="dpcRegistrationNumber" className="field" defaultValue={s.dpcRegistrationNumber} maxLength={60} /></Field>
                <Field label="Certificate expires" htmlFor="dpcRegistrationExpires"><input id="dpcRegistrationExpires" name="dpcRegistrationExpires" type="date" className="field" defaultValue={s.dpcRegistrationExpires} /></Field>
              </div>
            </fieldset>
          </ActionForm>
        </Card>
        <Card title="Taxes">
          <p className="mb-4 rounded bg-slate-50 px-3 py-2 text-sm text-slate-700">
            Ghana standard rates under the VAT Act, 2025 (Act 1151), effective 1 January 2026: VAT 15%, NHIL 2.5% and GETFund 2.5%, each charged on the
            invoice value (not compounded). Update here if GRA changes the rates.
          </p>
          <div className="space-y-4">
            {[...taxes, null].map((t) => (
              <ActionForm key={t?.id ?? "new"} action={upsertTaxAction} className="grid items-end gap-2 rounded-lg border border-slate-200 p-3 sm:grid-cols-[6rem_1fr_6rem_auto]" submitLabel={t ? "Save" : "Add tax"} submitClassName="btn btn-ghost">
                <input type="hidden" name="id" value={t?.id ?? ""} />
                <input type="hidden" name="sortOrder" value={t?.sortOrder ?? taxes.length + 1} />
                <Field label="Code" htmlFor={`tc-${t?.id ?? "n"}`}><input id={`tc-${t?.id ?? "n"}`} name="code" className="field" defaultValue={t?.code} required /></Field>
                <Field label="Name" htmlFor={`tn-${t?.id ?? "n"}`}><input id={`tn-${t?.id ?? "n"}`} name="name" className="field" defaultValue={t?.name} required /></Field>
                <Field label="Rate %" htmlFor={`tr-${t?.id ?? "n"}`}><input id={`tr-${t?.id ?? "n"}`} name="ratePercent" type="number" step="0.01" className="field" defaultValue={t ? t.rateBp / 100 : ""} required /></Field>
                <div className="flex flex-col gap-1 text-xs sm:col-span-4 sm:flex-row sm:gap-4">
                  <label className="flex items-center gap-1"><input type="checkbox" name="compound" defaultChecked={t?.compound} /> Compound (charged on taxes before it)</label>
                  <label className="flex items-center gap-1"><input type="checkbox" name="active" defaultChecked={t?.active ?? true} /> Active</label>
                  {t?.isDemo && <Badge tone="amber">demo rate</Badge>}
                </div>
              </ActionForm>
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}
