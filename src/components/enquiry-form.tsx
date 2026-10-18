import { ActionForm } from "@/components/action-form";
import { Field } from "@/components/ui";
import { SERVICE_AREAS } from "@/content/site";
import { CALLBACK_WINDOWS, CONTACT_METHODS } from "@/server/modules/sales";
import { submitEnquiry } from "@/app/(site)/contact/actions";

const day = (offsetDays: number) => new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);

/**
 * Website enquiry: consultation, quotation or a booked call-back. Works without JavaScript; bots are filtered by a
 * hidden field and rate limits. `service` pre-selects the area of interest (a service title).
 */
export function EnquiryForm({ service = "", message = "", submitLabel = "Send enquiry", idPrefix = "" }: { service?: string; message?: string; submitLabel?: string; idPrefix?: string }) {
  const id = (name: string) => `${idPrefix}${name}`;
  const known = SERVICE_AREAS.some((s) => s.title === service) || ["Store / products", "Partnership", ""].includes(service);
  return (
    <ActionForm action={submitEnquiry} submitLabel={submitLabel} resetOnSuccess>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Your name" htmlFor={id("contactName")}>
          <input id={id("contactName")} name="contactName" className="field" required autoComplete="name" maxLength={120} />
        </Field>
        <Field label="E-mail" htmlFor={id("email")}>
          <input id={id("email")} name="email" type="email" className="field" required autoComplete="email" maxLength={200} />
        </Field>
        <Field label="Phone or WhatsApp" htmlFor={id("phone")} hint="Needed if you want a call or a WhatsApp message.">
          <input id={id("phone")} name="phone" type="tel" className="field" autoComplete="tel" maxLength={40} />
        </Field>
        <Field label="Organisation (optional)" htmlFor={id("companyName")}>
          <input id={id("companyName")} name="companyName" className="field" autoComplete="organization" maxLength={160} />
        </Field>
      </div>
      <Field label="Area of interest" htmlFor={id("serviceInterest")}>
        <select id={id("serviceInterest")} name="serviceInterest" className="field" defaultValue={service}>
          <option value="">Not sure yet</option>
          {SERVICE_AREAS.map((s) => (
            <option key={s.slug} value={s.title}>
              {s.title}
            </option>
          ))}
          <option value="Store / products">Store / products</option>
          <option value="Partnership">Partnership</option>
          {!known && <option value={service}>{service}</option>}
        </select>
      </Field>
      <Field label="How can we help?" htmlFor={id("message")}>
        <textarea id={id("message")} name="message" rows={5} className="field" required minLength={10} maxLength={4000} defaultValue={message} />
      </Field>
      <fieldset className="rounded-lg border border-slate-200 p-3">
        <legend className="px-1 text-sm font-semibold">How should we contact you?</legend>
        <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
          {Object.entries(CONTACT_METHODS).map(([value, label]) => (
            <label key={value} className="flex items-center gap-2">
              <input type="radio" name="preferredContact" value={value} defaultChecked={value === "email"} /> {label}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="rounded-lg border border-slate-200 p-3">
        <legend className="px-1 text-sm font-semibold">Book a call (optional)</legend>
        <p className="mb-3 text-xs text-slate-600">Pick a day and time and a specialist will call you then. Ghana time.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Day" htmlFor={id("callbackOn")}>
            <input id={id("callbackOn")} name="callbackOn" type="date" className="field" min={day(0)} max={day(60)} />
          </Field>
          <Field label="Time" htmlFor={id("callbackWindow")}>
            <select id={id("callbackWindow")} name="callbackWindow" className="field" defaultValue="">
              <option value="">Any time</option>
              {Object.entries(CALLBACK_WINDOWS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </fieldset>
      {/* Honeypot for bots: hidden from people and assistive technology. */}
      <div aria-hidden className="absolute -left-[10000px]">
        <label htmlFor={id("website")}>Website</label>
        <input id={id("website")} name="website" tabIndex={-1} autoComplete="off" />
      </div>
    </ActionForm>
  );
}
