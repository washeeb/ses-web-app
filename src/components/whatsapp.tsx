/**
 * WhatsApp click-to-chat (https://wa.me/<number>?text=…). The number comes from Company settings; nothing shows
 * until it is set. Local Ghana numbers (0XX XXX XXXX) become international (233XX XXX XXXX).
 */
export function waNumber(raw: string | null | undefined) {
  const digits = (raw ?? "").replace(/\D/g, "");
  if (digits.length === 10 && digits.startsWith("0")) return `233${digits.slice(1)}`;
  if (digits.length >= 11 && digits.length <= 15 && !digits.startsWith("0")) return digits;
  return null;
}

export function waLink(raw: string | null | undefined, text: string) {
  const n = waNumber(raw);
  return n ? `https://wa.me/${n}?text=${encodeURIComponent(text)}` : null;
}

export function WhatsAppIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className} fill="currentColor">
      <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38a9.87 9.87 0 0 0 4.74 1.21h.01c5.46 0 9.91-4.45 9.91-9.91A9.85 9.85 0 0 0 12.04 2Zm5.8 14.13c-.24.68-1.42 1.31-1.96 1.36-.5.05-1.12.07-1.81-.11-.42-.13-.95-.31-1.64-.6-2.88-1.24-4.76-4.14-4.9-4.33-.15-.19-1.17-1.55-1.17-2.96 0-1.41.74-2.1 1-2.39.27-.29.58-.36.78-.36h.56c.18 0 .42-.07.66.5.24.58.83 2 .9 2.15.07.15.12.32.02.51-.1.19-.15.31-.29.48-.15.17-.31.38-.44.51-.15.15-.3.31-.13.6.17.29.76 1.25 1.63 2.03 1.12 1 2.07 1.31 2.36 1.45.29.15.46.12.63-.07.17-.19.73-.85.92-1.14.19-.29.39-.24.66-.15.27.1 1.7.8 1.99.95.29.15.49.22.56.34.07.12.07.7-.17 1.38Z" />
    </svg>
  );
}

/** Floating chat button, bottom right; raised on phones where a sticky contact bar is shown. */
export function WhatsAppButton({ number, text, raised = false }: { number: string; text: string; raised?: boolean }) {
  const href = waLink(number, text);
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={`floating-whatsapp fixed right-4 z-40 inline-flex items-center gap-2 rounded-full bg-[#1f7a43] px-4 py-3 text-sm font-semibold text-white shadow-lg hover:bg-[#17663a] print:hidden ${raised ? "bottom-20 md:bottom-5" : "bottom-5"}`}
    >
      <WhatsAppIcon />
      <span>Chat on WhatsApp</span>
      <span className="sr-only">(opens WhatsApp)</span>
    </a>
  );
}
