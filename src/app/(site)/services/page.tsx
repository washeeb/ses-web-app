import Link from "next/link";
import type { Metadata } from "next";
import { SERVICE_AREAS } from "@/content/site";
import { Picture } from "@/components/picture";
import { getDb } from "@/server/db/client";
import { mainImages } from "@/server/modules/media";

export const metadata: Metadata = {
  title: "Services",
  description: "Enterprise software, integration, infrastructure, networks, cybersecurity, hardware, data, assessments, security monitoring, data protection, payments and Device-as-a-Service in Ghana.",
};
// Reads service pictures from the database, so it renders per request (never at build time).
export const dynamic = "force-dynamic";

export default async function ServicesPage() {
  const images = await mainImages(getDb(), "service", SERVICE_AREAS.map((s) => s.slug));
  return (
    <div className="mx-auto max-w-6xl px-4 py-12">
      <h1 className="text-3xl font-bold text-slate-900">Services</h1>
      <p className="mt-2 max-w-2xl text-slate-600">Practical technology for businesses, institutions and partner companies. Choose a service for details, or <Link href="/contact" className="text-teal-700 underline">tell us what you need</Link>.</p>
      <ul className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {SERVICE_AREAS.map((s) => {
          const img = images.get(s.slug);
          return (
            <li key={s.slug} id={s.slug} className="group relative flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition-shadow hover:shadow-md">
              {img && <Picture m={img} sizes="(min-width: 1024px) 360px, (min-width: 640px) 50vw, 100vw" fallbackWidth={800} className="aspect-[3/2] w-full object-cover" alt="" />}
              <div className="flex flex-1 flex-col p-5">
                <h2 className="text-lg font-semibold text-slate-900">
                  {/* The whole card is clickable through this link's stretched overlay. */}
                  <Link href={`/services/${s.slug}`} className="after:absolute after:inset-0 group-hover:text-teal-700">
                    {s.title}
                  </Link>
                </h2>
                <p className="mt-2 flex-1 text-sm text-slate-600">{s.summary}</p>
                <p className="mt-4 text-sm font-semibold text-teal-700" aria-hidden="true">Learn more and enquire →</p>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
