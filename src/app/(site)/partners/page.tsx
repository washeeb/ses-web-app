import type { Metadata } from "next";
import { PARTNERS } from "@/content/site";
import { Badge } from "@/components/ui";

export const metadata: Metadata = { title: "Partners" };

export default function PartnersPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-12">
      <h1 className="text-3xl font-bold text-slate-900">Partners</h1>
      <p className="mt-2 text-slate-600">
        We deliver telecom, connectivity and supply services with partner companies. Partner stores connect to our platform so their approved products, prices and
        stock can be offered alongside ours.
      </p>
      <div className="mt-8 space-y-4">
        {PARTNERS.map((p) => (
          <article key={p.name} className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-xl font-semibold">{p.name}</h2>
              <Badge tone="amber">{p.status}</Badge>
            </div>
            <p className="mt-2 text-sm text-slate-600">{p.description}</p>
            <ul className="mt-4 flex gap-3">
              {p.links.map((l) => (
                <li key={l.href}>
                  <a href={l.href} target="_blank" rel="noopener noreferrer" className="btn btn-ghost">
                    {l.label} <span className="sr-only">(opens in a new tab)</span>
                  </a>
                </li>
              ))}
            </ul>
          </article>
        ))}
      </div>
      <section className="mt-10 rounded-xl bg-slate-100 p-6">
        <h2 className="font-semibold">Become a partner</h2>
        <p className="mt-1 text-sm text-slate-600">
          Operators, ISPs and suppliers can connect their store or catalogue through our versioned partner API with signed webhooks. <a className="font-semibold text-teal-700 hover:underline" href="/contact?service=Partnership">Contact partnerships</a>.
        </p>
      </section>
    </div>
  );
}
