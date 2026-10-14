"use client";

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Picture } from "./picture";

type Img = { id: string; ext: string; widths: number[]; width: number; height: number; alt: string };
export type HeroSlide = { id: string; headline: string; body: string | null; ctaLabel: string | null; ctaHref: string | null; image: Img | null };

const INTERVAL_MS = 7000;
const REDUCE = "(prefers-reduced-motion: reduce)";
const subscribe = (cb: () => void) => {
  const mq = window.matchMedia(REDUCE);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
};

/**
 * Home page slider (WAI-ARIA carousel pattern):
 * - Rotates only with more than one slide, and never when the visitor prefers reduced motion.
 * - Stops while the pointer is over it or keyboard focus is inside it; the pause button stops it for good.
 * - Changes are announced only when the visitor moves slides themselves (aria-live is off while rotating).
 * - All slides are stacked in one grid cell so the height never jumps; hidden slides are invisible and inert.
 * The page heading is fixed (screen-reader only); each slide headline is a level-2 heading.
 */
export function HeroSlider({ slides, label = "Highlights" }: { slides: HeroSlide[]; label?: string }) {
  const [current, setCurrent] = useState(0);
  const [paused, setPaused] = useState(false);
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const reduce = useSyncExternalStore(subscribe, () => window.matchMedia(REDUCE).matches, () => true);
  const multi = slides.length > 1;
  const rotating = multi && !paused && !reduce && !hover && !focus;

  useEffect(() => {
    if (!rotating) return;
    const t = window.setInterval(() => setCurrent((c) => (c + 1) % slides.length), INTERVAL_MS);
    return () => window.clearInterval(t);
  }, [rotating, slides.length]);

  const go = (i: number) => setCurrent((i + slides.length) % slides.length);

  return (
    <section
      aria-roledescription="carousel"
      aria-label={label}
      className="on-dark relative bg-gradient-to-br from-[#002253] via-[#062c66] to-[#00405a] text-[#fff]"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setFocus(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocus(false);
      }}
    >
      <div className="mx-auto max-w-6xl px-4 py-10 md:py-14">
        <h1 className="sr-only">Synclytics Enterprise Systems: enterprise technology for Ghanaian businesses</h1>
        {multi && (
          // Controls come first so keyboard users reach them before the slide content.
          <div className="mb-6 flex items-center gap-2 md:absolute md:bottom-6 md:left-1/2 md:mb-0 md:-translate-x-1/2">
            {!reduce && (
              <button type="button" onClick={() => setPaused((p) => !p)} className="slider-btn" aria-label={paused ? "Start the slides" : "Stop the slides"}>
                {paused ? (
                  <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
                ) : (
                  <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor"><path d="M6 5h4v14H6zM14 5h4v14h-4z" /></svg>
                )}
              </button>
            )}
            <button type="button" onClick={() => go(current - 1)} className="slider-btn" aria-label="Previous slide">
              <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m15 18-6-6 6-6" /></svg>
            </button>
            <div className="flex items-center" role="group" aria-label="Choose a slide">
              {slides.map((s, i) => (
                <button key={s.id} type="button" onClick={() => go(i)} className="grid h-8 w-8 place-items-center" aria-label={`Slide ${i + 1}: ${s.headline}`} aria-current={i === current ? "true" : undefined}>
                  <span aria-hidden="true" className={`block h-2.5 rounded-full transition-all ${i === current ? "w-6 bg-[#19c3c3]" : "w-2.5 bg-[#fff]/50"}`} />
                </button>
              ))}
            </div>
            <button type="button" onClick={() => go(current + 1)} className="slider-btn" aria-label="Next slide">
              <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m9 18 6-6-6-6" /></svg>
            </button>
          </div>
        )}
        <div className="grid" aria-live={rotating ? "off" : "polite"}>
          {slides.map((s, i) => {
            const on = i === current;
            return (
              <div
                key={s.id}
                role="group"
                aria-roledescription="slide"
                aria-label={`${i + 1} of ${slides.length}`}
                inert={!on}
                className={`col-start-1 row-start-1 grid items-center gap-8 md:grid-cols-[1fr_1.1fr] md:pb-10 ${on ? "visible opacity-100" : "invisible opacity-0"} motion-safe:transition-opacity motion-safe:duration-500`}
              >
                <div className="order-2 md:order-1">
                  <p className="text-sm font-semibold uppercase tracking-wide text-[#7fe3e3]">Synclytics Enterprise Systems</p>
                  <h2 className="mt-2 text-3xl font-bold leading-tight md:text-5xl">{s.headline}</h2>
                  {s.body && <p className="mt-4 max-w-xl text-lg text-[#e2e8f0]">{s.body}</p>}
                  {s.ctaLabel && s.ctaHref && (
                    <div className="mt-6 flex flex-wrap gap-3">
                      {s.ctaHref.startsWith("/") ? (
                        <Link href={s.ctaHref} className="btn btn-accent">{s.ctaLabel}</Link>
                      ) : (
                        <a href={s.ctaHref} className="btn btn-accent" rel="noopener">{s.ctaLabel}</a>
                      )}
                      {i === 0 && s.ctaHref !== "/store" && <Link href="/store" className="btn border border-[#fff]/40 text-[#fff] hover:bg-[#fff]/10">Browse the store</Link>}
                    </div>
                  )}
                </div>
                <div className="order-1 md:order-2">
                  {s.image && (
                    <Picture m={s.image} sizes="(min-width: 1152px) 600px, (min-width: 768px) 52vw, 100vw" fallbackWidth={800} priority={i === 0} className="aspect-[3/2] w-full rounded-xl object-cover" alt="" />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
