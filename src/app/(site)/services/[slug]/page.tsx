import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { HOW_WE_WORK, SERVICE_AREAS } from "@/content/site";
import { getDb } from "@/server/db/client";
import { mainImages } from "@/server/modules/media";
import { listStoreProducts } from "@/server/modules/catalogue";
import { getSettings } from "@/server/modules/settings";
import { EnquiryForm } from "@/components/enquiry-form";
import { NoPicture, Picture, imageSrc, pickWidth } from "@/components/picture";
import { Badge, Money } from "@/components/ui";
import { WhatsAppIcon, waLink } from "@/components/whatsapp";

export const dynamic = "force-dynamic";

const base = () => (process.env.APP_URL ?? "").replace(/\/$/, "");
const find = (slug: string) => SERVICE_AREAS.find((s) => s.slug === slug);

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const s = find((await params).slug);
  if (!s) return { title: "Service not found" };
  const img = (await mainImages(getDb(), "service", [s.slug])).get(s.slug);
  return {
    title: s.title,
    description: s.summary,
    alternates: { canonical: `/services/${s.slug}` },
    openGraph: { title: `${s.title} · Synclytics Enterprise Systems`, description: s.summary, ...(img ? { images: [{ url: imageSrc(img, pickWidth(img, 1200)), alt: img.alt }] } : {}) },
  };
}

export default async function ServicePage({ params }: { params: Promise<{ slug: string }> }) {
  const s = find((await params).slug);
  if (!s) notFound();
  const db = getDb();
  const [images, settings, related] = await Promise.all([
    mainImages(db, "service", [s.slug]),
    getSettings(db),
    Promise.all((s.storeCategories ?? []).map((category) => listStoreProducts(db, { category }))).then((lists) => {
      const seen = new Set<string>();
      return lists.flat().filter((p) => !seen.has(p.id) && seen.add(p.id)).slice(0, 4);
    }),
  ]);
  const img = images.get(s.slug);
  const whatsapp = waLink(settings.whatsappNumber, `Hello Synclytics, I'm interested in ${s.title}.`);
  const others = SERVICE_AREAS.filter((x) => x.slug !== s.slug).slice(0, 12);
  const url = `${base()}/services/${s.slug}`;
  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "Service",
      name: s.title,
      description: s.intro,
      serviceType: s.title,
      url,
      areaServed: { "@type": "Country", name: "Ghana" },
      provider: { "@type": "Organization", name: "Synclytics Enterprise Systems", url: base() || undefined },
      ...(img ? { image: `${base()}${imageSrc(img, pickWidth(img, 1200))}` } : {}),
    },
    { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: s.faqs.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Services", item: `${base()}/services` },
        { "@type": "ListItem", position: 2, name: s.title, item: url },
      ],
    },
  ];

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <div className="mx-auto max-w-6xl px-4 py-10 pb-28 md:pb-10">
        <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
          <Link href="/services" className="hover:underline">Services</Link> / <span aria-current="page">{s.title}</span>
        </nav>
        <div className="mt-6 grid gap-10 lg:grid-cols-[1fr_340px]">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 md:text-4xl">{s.title}</h1>
            <p className="mt-4 text-lg text-slate-700">{s.intro}</p>
            {img && <Picture m={img} sizes="(min-width: 1024px) 740px, 100vw" fallbackWidth={1600} priority className="mt-6 aspect-[3/2] w-full rounded-xl object-cover" alt="" />}

            <section className="mt-10" aria-labelledby="included">
              <h2 id="included" className="text-xl font-semibold text-slate-900">What&apos;s included</h2>
              <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                {s.items.map((i) => (
                  <li key={i} className="flex items-start gap-2 text-slate-700">
                    <svg aria-hidden="true" viewBox="0 0 24 24" className="mt-0.5 h-5 w-5 shrink-0 text-teal-700" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m5 12 5 5 9-10" /></svg>
                    {i}
                  </li>
                ))}
              </ul>
              {s.note && <p className="mt-3 text-sm text-slate-600">{s.note}</p>}
            </section>

            <section className="mt-10" aria-labelledby="for-whom">
              <h2 id="for-whom" className="text-xl font-semibold text-slate-900">Who it&apos;s for</h2>
              <ul className="mt-3 list-inside list-disc space-y-1 text-slate-700">
                {s.forWhom.map((w) => <li key={w}>{w}</li>)}
              </ul>
            </section>

            <section className="mt-10" aria-labelledby="how">
              <h2 id="how" className="text-xl font-semibold text-slate-900">How we work</h2>
              <ol className="mt-4 grid gap-4 sm:grid-cols-2">
                {HOW_WE_WORK.map((h, i) => (
                  <li key={h.title} className="reveal rounded-xl border border-slate-200 bg-white p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-teal-700">Step {i + 1}</p>
                    <h3 className="mt-1 font-semibold text-slate-900">{h.title}</h3>
                    <p className="mt-1 text-sm text-slate-600">{h.text}</p>
                  </li>
                ))}
              </ol>
            </section>

            <section className="mt-10" aria-labelledby="faq">
              <h2 id="faq" className="text-xl font-semibold text-slate-900">Questions</h2>
              <div className="mt-3 divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
                {s.faqs.map((f) => (
                  <details key={f.q} className="group px-4 py-3">
                    <summary className="cursor-pointer list-none font-medium text-slate-900 marker:hidden">
                      <span className="flex items-center justify-between gap-3">
                        {f.q}
                        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 9 6 6 6-6" /></svg>
                      </span>
                    </summary>
                    <p className="mt-2 text-sm text-slate-700">{f.a}</p>
                  </details>
                ))}
              </div>
            </section>

            {related.length > 0 && (
              <section className="mt-10" aria-labelledby="related">
                <h2 id="related" className="text-xl font-semibold text-slate-900">Related in our store</h2>
                <ul className="mt-4 grid gap-4 sm:grid-cols-2">
                  {related.map((p) => {
                    const from = p.variants[0]!;
                    return (
                      <li key={p.id} className="flex gap-3 rounded-xl border border-slate-200 bg-white p-3">
                        {p.image ? <Picture m={p.image} sizes="80px" fallbackWidth={320} className="h-20 w-20 rounded object-contain" alt="" /> : <NoPicture label={p.name} className="h-20 w-20 rounded" />}
                        <div className="min-w-0">
                          <Link href={`/store/${p.slug}`} className="font-medium text-slate-900 hover:text-teal-700">{p.name}</Link>
                          <p className="text-sm text-slate-700"><Money minor={from.priceMinor} currency={from.currency} /></p>
                          {p.isDemo && <Badge tone="amber">Demonstration</Badge>}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}
          </div>

          <aside className="lg:sticky lg:top-24 lg:self-start" aria-labelledby="talk">
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 id="talk" className="text-lg font-semibold text-slate-900">Talk to a specialist</h2>
              <p className="mt-1 text-sm text-slate-600">Tell us what you need and we reply within one business day, or book a call at a time that suits you.</p>
              <div className="mt-4 grid gap-2">
                <a href="#enquire" className="btn btn-primary">Enquire or book a call</a>
                {whatsapp && (
                  <a href={whatsapp} target="_blank" rel="noopener noreferrer" className="btn border border-[#1f7a43] text-[#1f7a43] hover:bg-emerald-50">
                    <WhatsAppIcon /> Chat on WhatsApp<span className="sr-only"> (opens WhatsApp)</span>
                  </a>
                )}
                {settings.supportPhone && <a href={`tel:${settings.supportPhone.replace(/[^+\d]/g, "")}`} className="btn btn-ghost">Call {settings.supportPhone}</a>}
              </div>
            </div>
            <nav aria-label="Other services" className="mt-6 hidden lg:block">
              <h2 className="text-sm font-semibold text-slate-900">Other services</h2>
              <ul className="mt-2 space-y-1 text-sm">
                {others.map((o) => <li key={o.slug}><Link href={`/services/${o.slug}`} className="text-slate-700 hover:text-teal-700">{o.title}</Link></li>)}
              </ul>
            </nav>
          </aside>
        </div>

        <section id="enquire" className="mt-12 scroll-mt-24 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm md:p-8" aria-labelledby="enquire-h">
          <h2 id="enquire-h" className="text-2xl font-semibold text-slate-900">Enquire about {s.title.toLowerCase()}</h2>
          <p className="mt-1 mb-5 text-sm text-slate-600">A specialist replies within one business day. Prefer a call? Pick a day and time below.</p>
          <EnquiryForm service={s.title} idPrefix="svc-" />
        </section>
      </div>

      {/* Sticky contact bar on phones. */}
      <div className="sticky-contact-bar fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur md:hidden print:hidden">
        <div className="flex gap-2">
          <a href="#enquire" className="btn btn-primary flex-1">Enquire</a>
          {whatsapp && (
            <a href={whatsapp} target="_blank" rel="noopener noreferrer" className="btn flex-1 bg-[#1f7a43] text-white">
              <WhatsAppIcon /> WhatsApp<span className="sr-only"> (opens WhatsApp)</span>
            </a>
          )}
          {settings.supportPhone && <a href={`tel:${settings.supportPhone.replace(/[^+\d]/g, "")}`} className="btn btn-ghost flex-1">Call</a>}
        </div>
      </div>
    </>
  );
}
