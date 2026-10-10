"use client";

export function PrintButton({ label = "Print or save as PDF" }: { label?: string }) {
  return (
    <button type="button" className="btn btn-ghost print:hidden" onClick={() => window.print()}>
      {label}
    </button>
  );
}
