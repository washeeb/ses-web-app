import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/server/db/client";
import { getSettings } from "@/server/modules/settings";
import { SERVICE_AREAS } from "@/content/site";
import { EnquiryForm } from "@/components/enquiry-form";
import { WhatsAppIcon, waLink } from "@/components/whatsapp";

export const metadata: Metadata = {
  title: "Contact & consultations",
  description: "Request a consultation, a quotation or a site visit, book a call, or chat on WhatsApp. A specialist replies within one business day.",
};

export default async function ContactPage({ searchParams }: { searchParams: Promise<{ service?: string; product?: string; message?: string }> }) {
  const sp = await searchParams;
  const s = await getSettings(getDb());
  // ?service= takes a service slug (from service pages and the assistant) or a title.
  const area = SERVICE_AREAS.find((a) => a.slug === sp.service || a.title === sp.service);
  const service = area?.title ?? (sp.service ?? "").slice(0, 120);
  const message = sp.product ? `I would like a quotation for: ${sp.product.slice(0, 200)}\n\nQuantity: \nDelivery location: ` : (sp.message ?? "").slice(0, 500);
  const whatsapp = waLink(s.whatsappNumber, area ? `Hello Synclytics, I'm interested in ${area.title}.` : "Hello Synclytics, I would like to know more about your services.");
  return (
    <div className="mx-auto grid max-w-5xl gap-10 px-4 py-12 md:grid-cols-[1fr_1.4fr]">
      <div>
        <h1 className="text-3xl font-bold text-slate-900">Talk to us</h1>
        <p className="mt-3 text-slate-600">Request a consultation, a quotation or a site visit, or book a call at a time that suits you. We respond within one business day.</p>
        <ul className="mt-6 space-y-3 text-sm">
          {whatsapp && (
            <li>
              <a href={whatsapp} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 font-semibold text-[#1f7a43] hover:underline">
                <WhatsAppIcon /> Chat on WhatsApp<span className="sr-only"> (opens WhatsApp)</span>
              </a>
            </li>
          )}
          <li>
            <span className="font-semibold">E-mail:</span> <a href={`mailto:${s.supportEmail}`} className="text-teal-700 hover:underline">{s.supportEmail}</a>
          </li>
          {s.supportPhone && (
            <li>
              <span className="font-semibold">Phone:</span> <a href={`tel:${s.supportPhone.replace(/[^+\d]/g, "")}`} className="text-teal-700 hover:underline">{s.supportPhone}</a>
            </li>
          )}
        </ul>
        <dl className="mt-6 space-y-3 text-sm">
          <div>
            <dt className="font-semibold">What happens next</dt>
            <dd className="text-slate-600">Your enquiry goes straight to our sales team. If you booked a call, a specialist calls you on the day and time you chose.</dd>
          </div>
          <div>
            <dt className="font-semibold">Your data</dt>
            <dd className="text-slate-600">We only use these details to respond to you. See our <Link href="/privacy" className="text-teal-700 underline">privacy notice</Link>.</dd>
          </div>
        </dl>
      </div>
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <EnquiryForm service={service} message={message} />
      </div>
    </div>
  );
}
