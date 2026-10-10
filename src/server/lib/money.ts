/** All amounts are integer minor units. Rates are basis points (1 bp = 0.01%). */

export function applyBp(amountMinor: number, bp: number): number {
  // Round half away from zero, on integers only.
  const raw = (amountMinor * bp) / 10_000;
  return Math.sign(raw) * Math.round(Math.abs(raw));
}

export function formatMoney(amountMinor: number, currency = "GHS", locale = "en-GH"): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency, currencyDisplay: "code" }).format(
    amountMinor / 100,
  );
}

/** Parse a user-entered decimal amount ("1,250.50") into minor units. */
export function parseMoney(input: string): number | null {
  const cleaned = input.replace(/[,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const [whole, frac = ""] = cleaned.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

export interface TaxComponent {
  code: string;
  name: string;
  rateBp: number;
  compound: boolean;
}

export interface TotalsInput {
  lines: { quantity: number; unitPriceMinor: number; taxable: boolean }[];
  discountBp: number;
  taxes: TaxComponent[];
}

export function computeTotals({ lines, discountBp, taxes }: TotalsInput) {
  const lineTotals = lines.map((l) => l.quantity * l.unitPriceMinor);
  const subtotalMinor = lineTotals.reduce((a, b) => a + b, 0);
  const taxableSubtotal = lines.reduce((a, l, i) => a + (l.taxable ? lineTotals[i]! : 0), 0);
  const discountMinor = applyBp(subtotalMinor, discountBp);
  // Discount is spread proportionally, so the taxable base shrinks by the same rate.
  const taxableBase = taxableSubtotal - applyBp(taxableSubtotal, discountBp);
  const breakdown: { code: string; name: string; amountMinor: number }[] = [];
  let simpleTaxTotal = 0;
  for (const t of taxes.filter((t) => !t.compound)) {
    const amountMinor = applyBp(taxableBase, t.rateBp);
    simpleTaxTotal += amountMinor;
    breakdown.push({ code: t.code, name: t.name, amountMinor });
  }
  let compoundTotal = 0;
  for (const t of taxes.filter((t) => t.compound)) {
    const amountMinor = applyBp(taxableBase + simpleTaxTotal + compoundTotal, t.rateBp);
    compoundTotal += amountMinor;
    breakdown.push({ code: t.code, name: t.name, amountMinor });
  }
  const taxMinor = simpleTaxTotal + compoundTotal;
  return {
    lineTotals,
    subtotalMinor,
    discountMinor,
    taxMinor,
    totalMinor: subtotalMinor - discountMinor + taxMinor,
    breakdown,
  };
}
