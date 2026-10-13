type Img = { id: string; ext: string; widths: number[]; width: number; height: number; alt: string };

export const imageSrc = (m: Pick<Img, "id" | "ext">, width: number) => `/media/${m.id}/${width}.${m.ext}`;

/** Picks the smallest stored copy at least `min` wide (or the largest). */
export function pickWidth(m: Pick<Img, "widths">, min: number) {
  return m.widths.find((w) => w >= min) ?? m.widths[m.widths.length - 1]!;
}

/**
 * Responsive image: the browser chooses the right stored size for the screen (srcset/sizes). Width and height are
 * set so the page does not jump while loading; images below the fold load lazily.
 */
export function Picture({ m, sizes, className, priority = false, alt, fallbackWidth = 800 }: { m: Img; sizes: string; className?: string; priority?: boolean; alt?: string; fallbackWidth?: number }) {
  const h = Math.round((m.height / m.width) * pickWidth(m, fallbackWidth));
  return (
    // eslint-disable-next-line @next/next/no-img-element -- images are already resized and served from our own store
    <img
      src={imageSrc(m, pickWidth(m, fallbackWidth))}
      srcSet={m.widths.map((w) => `${imageSrc(m, w)} ${w}w`).join(", ")}
      sizes={sizes}
      width={pickWidth(m, fallbackWidth)}
      height={h}
      alt={alt ?? m.alt}
      loading={priority ? "eager" : "lazy"}
      decoding="async"
      fetchPriority={priority ? "high" : undefined}
      className={className}
    />
  );
}

/** Neutral placeholder when an item has no picture yet. */
export function NoPicture({ label, className = "" }: { label: string; className?: string }) {
  return (
    <div className={`flex items-center justify-center bg-slate-100 text-xs text-slate-500 ${className}`} role="img" aria-label={`No picture of ${label} yet`}>
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-8 w-8 text-slate-300" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <circle cx="9" cy="10" r="2" />
        <path d="m21 16-5-5-8 8" />
      </svg>
    </div>
  );
}
