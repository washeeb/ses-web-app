import { z } from "zod";
import { hmacSha256Hex, safeEqual } from "../../lib/crypto";

/**
 * Partner integration contract v1. Documented in docs/api/partner-integration-v1.md.
 * Changing anything here is a contract change: add, never repurpose.
 */
export const CONTRACT_VERSION = "2026-10-v1";
export const SIGNATURE_HEADER = "ses-signature";
export const SIGNATURE_TOLERANCE_SECONDS = 300;

export function signPayload(secret: string, rawBody: string, timestampSec = Math.floor(Date.now() / 1000)) {
  return `t=${timestampSec},v1=${hmacSha256Hex(secret, `${timestampSec}.${rawBody}`)}`;
}

export type SignatureCheck = "ok" | "missing" | "malformed" | "expired" | "mismatch";

export function verifySignature(secret: string, rawBody: string, header: string | null, nowSec = Math.floor(Date.now() / 1000)): SignatureCheck {
  if (!header) return "missing";
  let t: number | null = null;
  const sigs: string[] = [];
  for (const part of header.split(",")) {
    const [k, v] = part.trim().split("=", 2);
    if (k === "t" && v && /^\d{1,12}$/.test(v)) t = Number(v);
    else if (k === "v1" && v && /^[a-f0-9]{64}$/.test(v)) sigs.push(v);
  }
  if (t === null || sigs.length === 0) return "malformed";
  if (Math.abs(nowSec - t) > SIGNATURE_TOLERANCE_SECONDS) return "expired";
  const expected = hmacSha256Hex(secret, `${t}.${rawBody}`);
  return sigs.some((s) => safeEqual(s, expected)) ? "ok" : "mismatch";
}

const money = z.object({ amount_minor: z.number().int().min(0).max(100_000_000_000), currency: z.string().regex(/^[A-Z]{3}$/) });
const sku = z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9._-]+$/, "SKU may contain letters, digits, dot, dash and underscore.");

export const EVENT_SCHEMAS = {
  "product.upserted": z.object({
    sku,
    name: z.string().trim().min(1).max(200),
    description: z.string().max(5000).optional(),
    product_type: z.enum(["hardware", "software_licence", "subscription", "service_package"]).default("hardware"),
    tracks_stock: z.boolean().default(true),
    active: z.boolean().default(true),
    cost: money.optional(),
  }),
  "product.retired": z.object({ sku }),
  "price.updated": z.object({ sku, cost: money }),
  "stock.updated": z.object({
    sku,
    on_hand: z.number().int().min(0).max(10_000_000),
    location: z.string().trim().min(1).max(40).regex(/^[A-Za-z0-9_-]+$/).default("main"),
  }),
  "fulfilment.updated": z.object({
    order_number: z.string().min(1).max(40),
    line_id: z.string().uuid().optional(),
    status: z.enum(["accepted", "rejected", "shipped", "delivered"]),
    tracking_reference: z.string().max(120).optional(),
  }),
} as const;

export type InboundEventType = keyof typeof EVENT_SCHEMAS;
export const INBOUND_EVENT_TYPES = Object.keys(EVENT_SCHEMAS) as InboundEventType[];

export const envelopeSchema = z.object({
  id: z.string().min(8).max(100).regex(/^[A-Za-z0-9_.:-]+$/),
  type: z.enum(INBOUND_EVENT_TYPES as [InboundEventType, ...InboundEventType[]]),
  occurred_at: z.string().datetime({ offset: true }),
  /**
   * Monotonic per entity: per SKU for product.* and price.*, per SKU+location for stock.*,
   * per order line for fulfilment.*. Older or equal versions are ignored.
   */
  version: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  data: z.record(z.string(), z.unknown()),
});
export type Envelope = z.infer<typeof envelopeSchema>;

export const OUTBOUND_EVENT_TYPES = ["order.fulfilment_requested", "order.cancelled"] as const;

export const API_SCOPES = ["catalogue:read", "orders:read", "integration:read"] as const;
export type ApiScope = (typeof API_SCOPES)[number];
