import Link from "next/link";
import type { Metadata } from "next";
import { SERVICE_AREAS } from "@/content/site";
import { Badge } from "@/components/ui";
import { Picture } from "@/components/picture";
import { getDb } from "@/server/db/client";
import { mainImages } from "@/server/modules/media";

export const metadata: Metadata = { title: "Services" };
// Reads service pictures from the database, so it renders per request (never at build time).
export const dynamic = "force-dynamic";

export default async function ServicesPage() {
  const images = await mainImages(
    getDb(),
    "service",
    SERVICE_AREAS.map((s) => s.slug),
  );
  const groups = [
    { key: "available", title: "Services", intro: "What SES delivers today." },
    {
      key: "proposed",
      title: "Proposed services",
      intro:
        "Offerings under consideration. They are not yet available to order. Ask us if you are interested.",
    },
  ] as const;
  return (
    <div className="mx-auto max-w-6xl px-4 py-12">
      <h1 className="text-3xl font-bold text-slate-900">Services</h1>
      <p className="mt-2 max-w-2xl text-slate-600">
        Practical technology for businesses, institutions and partner companies.
      </p>
      {groups.map((g) => (
        <section key={g.key} className="mt-10" aria-labelledby={`h-${g.key}`}>
          <h2
            id={`h-${g.key}`}
            className="text-xl font-semibold text-slate-900"
          >
            {g.title}
          </h2>
          <p className="text-sm text-slate-600">{g.intro}</p>
          <div className="mt-5 grid gap-5 md:grid-cols-2">
            {SERVICE_AREAS.filter((s) => s.status === g.key).map((s) => (
              <article
                id={s.slug}
                key={s.slug}
                className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
              >
                {images.get(s.slug) && (
                  <Picture
                    m={images.get(s.slug)!}
                    sizes="(min-width: 768px) 560px, 100vw"
                    fallbackWidth={800}
                    className="aspect-[3/1] w-full object-cover"
                    alt=""
                  />
                )}
                <div className="p-6">
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="text-lg font-semibold">{s.title}</h3>
                    {s.status === "proposed" ? (
                      <Badge tone="amber">Proposed</Badge>
                    ) : (
                      <Badge tone="green">Available</Badge>
                    )}
                  </div>
                  <p className="mt-2 text-sm text-slate-600">{s.summary}</p>
                  <ul className="mt-3 list-inside list-disc text-sm text-slate-700">
                    {s.items.map((i) => (
                      <li key={i}>{i}</li>
                    ))}
                  </ul>
                  {s.note && (
                    <p className="mt-3 text-xs text-slate-500">{s.note}</p>
                  )}
                  {s.status === "available" && (
                    <Link
                      href={`/contact?service=${encodeURIComponent(s.title)}`}
                      className="mt-4 inline-block text-sm font-semibold text-teal-700 hover:underline"
                    >
                      Enquire about {s.title.toLowerCase()} →
                    </Link>
                  )}
                </div>
              </article>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
