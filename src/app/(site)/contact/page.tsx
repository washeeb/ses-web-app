import type { Metadata } from "next";
import { ActionForm } from "@/components/action-form";
import { Field } from "@/components/ui";
import { SERVICE_AREAS } from "@/content/site";
import { submitEnquiry } from "./actions";

export const metadata: Metadata = { title: "Contact & consultations" };

export default async function ContactPage({ searchParams }: { searchParams: Promise<{ service?: string; product?: string }> }) {
  const sp = await searchParams;
  const preset = sp.service ?? "";
  const message = sp.product ? `I would like a quotation for: ${sp.product}\n\nQuantity: \nDelivery location: ` : "";
  return (
    <div className="mx-auto grid max-w-5xl gap-10 px-4 py-12 md:grid-cols-[1fr_1.4fr]">
      <div>
        <h1 className="text-3xl font-bold text-slate-900">Talk to us</h1>
        <p className="mt-3 text-slate-600">Request a consultation, a quotation or a site visit. We respond within one business day.</p>
        <dl className="mt-6 space-y-3 text-sm">
          <div>
            <dt className="font-semibold">What happens next</dt>
            <dd className="text-slate-600">Your enquiry goes straight to our sales team, who will contact you to understand your requirements.</dd>
          </div>
          <div>
            <dt className="font-semibold">Your data</dt>
            <dd className="text-slate-600">We only use these details to respond to you. See our privacy notice.</dd>
          </div>
        </dl>
      </div>
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <ActionForm action={submitEnquiry} submitLabel="Send enquiry" resetOnSuccess>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Your name" htmlFor="contactName">
              <input id="contactName" name="contactName" className="field" required autoComplete="name" maxLength={120} />
            </Field>
            <Field label="E-mail" htmlFor="email">
              <input id="email" name="email" type="email" className="field" required autoComplete="email" maxLength={200} />
            </Field>
            <Field label="Phone (optional)" htmlFor="phone">
              <input id="phone" name="phone" type="tel" className="field" autoComplete="tel" maxLength={40} />
            </Field>
            <Field label="Organisation (optional)" htmlFor="companyName">
              <input id="companyName" name="companyName" className="field" autoComplete="organization" maxLength={160} />
            </Field>
          </div>
          <Field label="Area of interest" htmlFor="serviceInterest">
            <select id="serviceInterest" name="serviceInterest" className="field" defaultValue={preset}>
              <option value="">Not sure yet</option>
              {SERVICE_AREAS.filter((s) => s.status === "available").map((s) => (
                <option key={s.slug} value={s.title}>
                  {s.title}
                </option>
              ))}
              <option value="Store / products">Store / products</option>
              <option value="Partnership">Partnership</option>
              {preset && !SERVICE_AREAS.some((s) => s.title === preset) && !["Store / products", "Partnership"].includes(preset) && <option value={preset}>{preset}</option>}
            </select>
          </Field>
          <Field label="How can we help?" htmlFor="message">
            <textarea id="message" name="message" rows={6} className="field" required minLength={10} maxLength={4000} defaultValue={message} />
          </Field>
          {/* Honeypot for bots: hidden from people and assistive technology. */}
          <div aria-hidden className="absolute -left-[10000px]">
            <label htmlFor="website">Website</label>
            <input id="website" name="website" tabIndex={-1} autoComplete="off" />
          </div>
        </ActionForm>
      </div>
    </div>
  );
}
