import Image from "next/image";
import Link from "next/link";
import horizontal from "@/assets/brand/synclytics-horizontal.png";
import reverse from "@/assets/brand/synclytics-horizontal-reverse.png";
import stacked from "@/assets/brand/synclytics-stacked.png";

const VARIANTS = {
  /** Default: transparent horizontal lockup for light backgrounds. */
  horizontal: { src: horizontal, height: 40 },
  /** On brand navy (#002253) only — the artwork carries its own navy background. */
  reverse: { src: reverse, height: 44 },
  stacked: { src: stacked, height: 120 },
} as const;

export function Logo({ href = "/", variant = "horizontal", height }: { href?: string | null; variant?: keyof typeof VARIANTS; height?: number }) {
  const v = VARIANTS[variant];
  const h = height ?? v.height;
  const img = (
    <Image
      src={v.src}
      alt="Synclytics Enterprise Systems"
      height={h}
      style={{ height: h, width: "auto" }}
      priority={variant !== "reverse"}
    />
  );
  if (href === null) return img;
  return (
    <Link href={href} aria-label="Synclytics Enterprise Systems — home" className="inline-flex shrink-0 items-center">
      {img}
    </Link>
  );
}
