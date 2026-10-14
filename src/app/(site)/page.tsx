import Link from "next/link";
import { SERVICE_AREAS, PARTNERS } from "@/content/site";
import { getDb } from "@/server/db/client";
import { liveSlides } from "@/server/modules/slides";
import { HeroSlider } from "@/components/hero-slider";

export default async function HomePage() {
  const core = SERVICE_AREAS.filter((s) => s.status === "available");
  const slides = await liveSlides(getDb());
  return (
    <>
      {slides.length > 0 ? (
        <HeroSlider slides={slides} />
      ) : (
        <section className="bg-gradient-to-br from-brand-900 via-brand-700 to-accent-600 text-white">
          <div className="mx-auto grid max-w-6xl gap-10 px-4 py-20 md:grid-cols-[1.4fr_1fr] md:items-center">
            <div>
              <p className="text-sm font-semibold uppercase tracking-widest text-teal-200">
                Synclytics Enterprise Systems
              </p>
              <h1 className="mt-3 text-4xl font-bold leading-tight md:text-5xl">
                Technology that keeps your business connected, secure and
                running.
              </h1>
              <p className="mt-5 max-w-xl text-lg text-blue-100">
                Enterprise software, systems integration, cloud and networks,
                cybersecurity, hardware and data, delivered as one accountable
                partner.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link
                  href="/contact"
                  className="btn bg-white text-brand-900 hover:bg-teal-50"
                >
                  Request a consultation
                </Link>
                <Link
                  href="/store"
                  className="btn border border-white/40 text-white hover:bg-white/10"
                >
                  Browse the store
                </Link>
              </div>
            </div>
            <ul className="grid grid-cols-2 gap-3 text-sm">
              {[
                "ERP · CRM · POS",
                "APIs & integration",
                "Cloud & hybrid",
                "Networks & VPN",
                "Security & backup",
                "Analytics & BI",
              ].map((t) => (
                <li
                  key={t}
                  className="rounded-xl bg-white/10 px-4 py-5 font-semibold backdrop-blur ring-1 ring-white/15"
                >
                  {t}
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      <section
        className="mx-auto max-w-6xl px-4 py-16"
        aria-labelledby="services-heading"
      >
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2
              id="services-heading"
              className="text-3xl font-bold text-slate-900"
            >
              What we do
            </h2>
            <p className="mt-2 max-w-2xl text-slate-600">
              From the systems your teams use daily to the networks and
              infrastructure underneath them.
            </p>
          </div>
          <Link
            href="/services"
            className="text-sm font-semibold text-teal-700 hover:underline"
          >
            All services →
          </Link>
        </div>
        <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {core.map((s) => (
            <article
              key={s.slug}
              className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
            >
              <h3 className="text-lg font-semibold text-slate-900">
                {s.title}
              </h3>
              <p className="mt-2 text-sm text-slate-600">{s.summary}</p>
              <ul className="mt-4 flex flex-wrap gap-1.5">
                {s.items.map((i) => (
                  <li
                    key={i}
                    className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs text-slate-700"
                  >
                    {i}
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>

      <section className="border-y border-slate-200 bg-white">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-14 md:grid-cols-3">
          {[
            [
              "One accountable partner",
              "Software, infrastructure, networks and hardware under one contract and one support desk.",
            ],
            [
              "Built for Ghanaian businesses",
              "GHS pricing, mobile-money-ready commerce and local delivery with telecom and ISP partners.",
            ],
            [
              "Secure by design",
              "Least-privilege access, audit trails and approval controls throughout our own platform.",
            ],
          ].map(([t, d]) => (
            <div key={t}>
              <h3 className="font-semibold text-slate-900">{t}</h3>
              <p className="mt-1 text-sm text-slate-600">{d}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-16">
        <h2 className="text-2xl font-bold text-slate-900">Partners</h2>
        {PARTNERS.map((p) => (
          <div
            key={p.name}
            className="mt-4 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-6"
          >
            <div>
              <p className="font-semibold">{p.name}</p>
              <p className="text-sm text-slate-600">{p.status}</p>
            </div>
            <Link href="/partners" className="btn btn-ghost">
              About our partners
            </Link>
          </div>
        ))}
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-8">
        <div className="rounded-2xl bg-teal-700 px-8 py-10 text-white md:flex md:items-center md:justify-between">
          <div>
            <h2 className="text-2xl font-bold">
              Planning a system, network or upgrade?
            </h2>
            <p className="mt-1 text-teal-100">
              Tell us what you need. A specialist will respond within one
              business day.
            </p>
          </div>
          <Link
            href="/contact"
            className="btn mt-4 bg-white text-teal-800 hover:bg-teal-50 md:mt-0"
          >
            Talk to us
          </Link>
        </div>
      </section>
    </>
  );
}
