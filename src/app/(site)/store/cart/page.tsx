import Link from "next/link";
import type { Metadata } from "next";
import { getDb } from "@/server/db/client";
import { priceCart } from "@/server/modules/store";
import { getSettings } from "@/server/modules/settings";
import { can } from "@/server/authz/policy";
import { readCart } from "@/server/web/cart";
import { getSessionState } from "@/server/web/session";
import { ActionForm } from "@/components/action-form";
import { AvailabilityBadge } from "@/components/availability";
import { EmptyState, Field, Money } from "@/components/ui";
import { cartQuoteAction, placeOrderAction, updateCartLineAction } from "../cart-actions";

export const metadata: Metadata = { title: "Your cart" };

export default async function CartPage() {
  const db = getDb();
  const [cart, session, settings] = await Promise.all([readCart(), getSessionState(), getSettings(db)]);
  const priced = await priceCart(db, cart);
  const actor = session && !session.pending ? session.actor : null;
  const canOrder = !!actor && actor.organizationType === "customer" && can(actor, "customer.orders.place", { organizationId: actor.organizationId });

  return (
    <div className="mx-auto max-w-5xl px-4 py-12">
      <nav aria-label="Breadcrumb" className="text-sm text-slate-500">
        <Link href="/store" className="hover:underline">Store</Link> / <span>Cart</span>
      </nav>
      <h1 className="mt-3 text-3xl font-bold text-slate-900">Your cart</h1>

      {priced.lines.length === 0 ? (
        <div className="mt-8">
          <EmptyState title="Your cart is empty">
            <Link href="/store" className="text-teal-700 underline">Browse the store</Link>
          </EmptyState>
        </div>
      ) : (
        <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_340px]">
          <section aria-labelledby="items-heading" className="min-w-0">
            <h2 id="items-heading" className="sr-only">Items</h2>
            <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
              {priced.lines.map((l) => (
                <li key={l.variantId} className="grid gap-3 p-4 sm:grid-cols-[1fr_auto]">
                  <div className="min-w-0">
                    <p className="font-medium">
                      <Link href={`/store/${l.slug}`} className="hover:text-teal-700">{l.productName}</Link>
                    </p>
                    <p className="text-sm text-slate-600">
                      {l.variantName} · SKU {l.sku} · <Money minor={l.unitPriceMinor} currency={priced.currency} /> each{l.billingPeriod ? ` per ${l.billingPeriod}` : ""}
                    </p>
                    <div className="mt-2"><AvailabilityBadge a={l.availability} showCount /></div>
                    {l.problem && <p className="mt-2 text-sm font-medium text-red-700" role="alert">{l.problem}</p>}
                  </div>
                  <div className="flex flex-col items-start gap-2 sm:items-end">
                    <p className="font-semibold"><Money minor={l.lineTotalMinor} currency={priced.currency} /></p>
                    <ActionForm action={updateCartLineAction} inline submitLabel="Update" submitClassName="btn btn-ghost">
                      <input type="hidden" name="variantId" value={l.variantId} />
                      <label htmlFor={`qty-${l.variantId}`} className="sr-only">Quantity of {l.productName} — {l.variantName}</label>
                      <input id={`qty-${l.variantId}`} name="quantity" type="number" min={1} max={999} defaultValue={l.quantity} className="field w-20" />
                    </ActionForm>
                    <ActionForm action={updateCartLineAction} inline submitLabel={<>Remove<span className="sr-only"> {l.productName} — {l.variantName}</span></>} submitClassName="text-sm text-red-700 underline">
                      <input type="hidden" name="variantId" value={l.variantId} />
                      <input type="hidden" name="op" value="remove" />
                    </ActionForm>
                  </div>
                </li>
              ))}
            </ul>
            <dl className="ml-auto mt-4 max-w-xs space-y-1 text-sm">
              <div className="flex justify-between"><dt>Subtotal</dt><dd><Money minor={priced.totals.subtotalMinor} currency={priced.currency} /></dd></div>
              {priced.totals.breakdown.map((t) => (
                <div key={t.code} className="flex justify-between"><dt>{t.name}</dt><dd><Money minor={t.amountMinor} currency={priced.currency} /></dd></div>
              ))}
              <div className="flex justify-between border-t border-slate-200 pt-1 text-base font-bold"><dt>Total</dt><dd><Money minor={priced.totals.totalMinor} currency={priced.currency} /></dd></div>
            </dl>
          </section>

          <aside className="min-w-0 space-y-6">
            <section aria-labelledby="checkout-heading" className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 id="checkout-heading" className="text-base font-semibold">Checkout</h2>
              {priced.overLimit ? (
                <p className="mt-2 text-sm text-slate-700">
                  Orders of <Money minor={priced.limitMinor} currency={priced.currency} /> or more go through a quotation so we can confirm supply, delivery and terms. Request one below.
                </p>
              ) : canOrder ? (
                <div className="mt-3">
                  <ActionForm action={placeOrderAction} submitLabel="Place order" submitClassName="btn btn-accent w-full">
                    <Field label="Your purchase order or reference (optional)" htmlFor="customerReference">
                      <input id="customerReference" name="customerReference" className="field" maxLength={60} />
                    </Field>
                    <p className="text-sm text-slate-600">
                      We hold the stock for {settings.reservationHoldHours} hours and issue your invoice straight away. Pay online by card or mobile money, or by bank transfer against the invoice.
                    </p>
                    {!priced.ok && <p className="text-sm font-medium text-red-700">Fix the items marked above before ordering.</p>}
                  </ActionForm>
                </div>
              ) : actor?.organizationType === "customer" ? (
                <p className="mt-2 text-sm text-slate-700">Your account can view orders but not place them. Ask your organisation&apos;s administrator, or request a quotation below.</p>
              ) : actor ? (
                <p className="mt-2 text-sm text-slate-700">Staff and partner accounts cannot order from the store. Use quotations in the operations area.</p>
              ) : (
                <div className="mt-2 space-y-3 text-sm text-slate-700">
                  <p>Business customers with an SES account can order and pay online.</p>
                  <Link href="/login?next=/store/cart" className="btn btn-primary w-full">Sign in to order</Link>
                  <p>No account yet? Request a quotation below and we will set one up for you.</p>
                </div>
              )}
            </section>

            {(!canOrder || priced.overLimit) && (
              <section aria-labelledby="quote-heading" className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <h2 id="quote-heading" className="text-base font-semibold">Request a quotation for this cart</h2>
                <div className="mt-3">
                  <ActionForm action={cartQuoteAction} submitLabel="Request quotation" submitClassName="btn btn-primary w-full" resetOnSuccess>
                    <Field label="Your name" htmlFor="contactName"><input id="contactName" name="contactName" className="field" required autoComplete="name" maxLength={120} defaultValue={actor?.name} /></Field>
                    <Field label="E-mail" htmlFor="email"><input id="email" name="email" type="email" className="field" required autoComplete="email" maxLength={200} defaultValue={actor?.email} /></Field>
                    <Field label="Phone (optional)" htmlFor="phone"><input id="phone" name="phone" type="tel" className="field" autoComplete="tel" maxLength={40} /></Field>
                    <Field label="Organisation (optional)" htmlFor="companyName"><input id="companyName" name="companyName" className="field" autoComplete="organization" maxLength={160} /></Field>
                    <Field label="Notes (optional)" htmlFor="message"><textarea id="message" name="message" rows={3} className="field" maxLength={2000} placeholder="Delivery location, timing, installation…" /></Field>
                    {/* Honeypot for bots: hidden from people and assistive technology. */}
                    <div aria-hidden className="absolute -left-[10000px]">
                      <label htmlFor="website">Website</label>
                      <input id="website" name="website" tabIndex={-1} autoComplete="off" />
                    </div>
                  </ActionForm>
                </div>
              </section>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
