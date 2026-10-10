import type { Metadata } from "next";
import { getDb } from "@/server/db/client";
import { getSettings } from "@/server/modules/settings";

export const metadata: Metadata = { title: "Privacy" };

export default async function PrivacyPage() {
  const s = await getSettings(getDb());
  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="text-3xl font-bold text-slate-900">Privacy notice</h1>
      <p className="mt-3 text-sm text-slate-500">
        {s.companyName} processes personal data in line with Ghana&apos;s Data Protection Act, 2012 (Act 843).
        {s.dpcRegistrationNumber && <> Registered with the Data Protection Commission, registration no. <strong>{s.dpcRegistrationNumber}</strong>.</>}
      </p>
      <div className="mt-6 space-y-4 text-slate-700">
        <p>We collect the details you give us in enquiry and account forms (name, e-mail, phone, organisation and your message) to respond to you and provide services.</p>
        <p>Account activity is logged for security, including sign-ins and changes to records. Access to personal data is limited to staff who need it.</p>
        <p>Online payments are processed by Paystack; we do not store card details. We do not sell personal data. Partner companies only receive what is needed to fulfil an order you place.</p>
        <p>
          To ask for a copy, correction or deletion of your data, contact <a className="text-teal-700 hover:underline" href={`mailto:${s.supportEmail}`}>{s.supportEmail}</a>.
        </p>
      </div>
    </div>
  );
}
