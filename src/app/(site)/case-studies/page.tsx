import Link from "next/link";
import type { Metadata } from "next";
import { CASE_STUDIES } from "@/content/site";

export const metadata: Metadata = { title: "Case studies" };

export default function CaseStudiesPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-12">
      <h1 className="text-3xl font-bold text-slate-900">Case studies</h1>
      <p className="mt-2 max-w-2xl text-slate-600">
        How we approach typical engagements: the problem, what we deliver and the results we aim for.
      </p>
      <div className="mt-8 space-y-6">
        {CASE_STUDIES.map((c) => (
          <article key={c.title} className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm md:grid md:grid-cols-[1fr_2fr] md:gap-8">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-teal-700">{c.sector}</p>
              <h2 className="mt-2 text-xl font-semibold">{c.title}</h2>
              <p className="mt-2 text-xs text-slate-500">{c.services.join(" · ")}</p>
              <p className="mt-3 inline-block rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">Example engagement</p>
              <p className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                <Link href={`/contact?service=${c.serviceSlug}&message=${encodeURIComponent(`We have a similar need: ${c.title}.`)}`} className="font-semibold text-teal-700 hover:underline">Discuss a similar project →</Link>
                <Link href={`/services/${c.serviceSlug}`} className="text-slate-700 hover:underline">About the service</Link>
              </p>
            </div>
            <dl className="mt-4 space-y-3 text-sm md:mt-0">
              <div>
                <dt className="font-semibold text-slate-900">The challenge</dt>
                <dd className="text-slate-600">{c.challenge}</dd>
              </div>
              <div>
                <dt className="font-semibold text-slate-900">What we deliver</dt>
                <dd className="text-slate-600">{c.solution}</dd>
              </div>
              <div>
                <dt className="font-semibold text-slate-900">Expected outcomes</dt>
                <dd>
                  <ul className="list-inside list-disc text-slate-600">
                    {c.outcomes.map((o) => (
                      <li key={o}>{o}</li>
                    ))}
                  </ul>
                </dd>
              </div>
            </dl>
          </article>
        ))}
      </div>
      <p className="mt-8 text-sm text-slate-500">
        Client-approved case studies will be published here as projects complete. <Link href="/contact" className="font-semibold text-teal-700 hover:underline">Discuss a similar project</Link>.
      </p>
    </div>
  );
}
