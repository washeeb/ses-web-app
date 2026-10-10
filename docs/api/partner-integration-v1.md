# SES Partner Integration — Contract v1 (`2026-10-v1`)

For partners (first: KingsView Solutions) connecting a store or business system to Synclytics Enterprise Systems.
**Status:** implemented and contract-tested against the SES simulator. No partner has connected in production yet.

## 1. Connections and credentials

SES creates a **connection** per partner system and shares, over a secure channel:

| Item | Purpose |
|---|---|
| Connection id (UUID) | Part of the webhook URL |
| Inbound signing secret (`whsec_…`) | Partner signs events it sends to SES |
| Outbound signing secret (`whsec_…`) | SES signs events it sends to the partner; partner verifies |
| API key (`ses_live_<prefix>_<secret>`) | Optional, scoped read access to the partner API |

Secrets are shown once, stored encrypted (AES-256-GCM) at SES, and can be rotated at any time (old secrets stop working immediately).

## 2. Partner → SES events (webhooks)

`POST {SES_BASE_URL}/api/v1/integrations/{connectionId}/events`

Headers:

```
Content-Type: application/json
SES-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(inbound_secret, "<t>.<raw body>")>
```

- The signature covers the exact raw bytes of the body.
- `t` must be within **±300 seconds** of SES time, otherwise the request is rejected (replay protection).
- Several `v1=` values may be sent during a secret rotation.

Envelope:

```json
{
  "id": "evt_01J…",                 // unique per event, 8–100 chars [A-Za-z0-9_.:-]
  "type": "stock.updated",
  "occurred_at": "2026-10-10T09:00:00Z",
  "version": 1791633900793,         // monotonic per entity (see below)
  "data": { … }
}
```

**`version` rules.** Must increase for each change to the same entity. Use a millisecond timestamp or a revision counter.
- `product.*` and `price.updated`: per SKU
- `stock.updated`: per SKU + location
- `fulfilment.updated`: per order line

Events whose version is ≤ the last applied version are acknowledged and recorded as `stale_ignored`.

### Event types

| Type | `data` |
|---|---|
| `product.upserted` | `sku`, `name`, `description?`, `product_type` (`hardware` \| `software_licence` \| `subscription` \| `service_package`), `tracks_stock` (bool), `active` (bool), `cost?` `{amount_minor, currency}` |
| `product.retired` | `sku` |
| `price.updated` | `sku`, `cost` `{amount_minor, currency}` |
| `stock.updated` | `sku`, `on_hand` (int ≥ 0), `location` (default `main`) |
| `fulfilment.updated` | `order_number`, `line_id?`, `status` (`accepted` \| `rejected` \| `shipped` \| `delivered`), `tracking_reference?` |

Money is always integer **minor units** (pesewas for GHS) with an ISO 4217 currency code.

### Responses

| Status | Meaning | Partner action |
|---|---|---|
| `202` | Accepted and queued | Done |
| `200` `{"status":"duplicate"}` | Same `id` already received | Done (do not resend) |
| `400` | Invalid JSON, envelope or data (details in `issues`) | Fix and resend with a **new** id |
| `401` | Missing, invalid or expired signature | Check secret and clock |
| `404` | Unknown connection | Check URL |
| `409` | Connection paused or disabled | Contact SES |
| `413` | Body over 256 KB | Split |
| `415` | Not `application/json` | Fix header |
| `429` | Over 600 requests/minute per connection | Back off and retry |
| `5xx` | Temporary SES problem | Retry with exponential backoff, **same id** |

### How SES applies events

- **Idempotent**: `(connection, id)` is unique; retries with the same id are safe.
- **Asynchronous**: processing happens in the SES job queue after `202`. Out-of-order dependencies, such as stock for a SKU SES has not seen yet, are retried with backoff (30 s, 2 min, 8 min, 32 min, ~2 h, capped at 6 h; 8 attempts), then dead-lettered for manual replay.
- **New products** are created as **drafts**. SES reviews them before they are sold.
- **Field ownership** per mapping decides which side owns `name`, `description`, `cost`, `stock` and `status`. Fields owned by SES are ignored.
- **Pricing**: SES sell price = partner cost × SES price rule (default +20%). Changes of **15% or more** are held for human approval.
- **Stale stock**: partner stock older than the connection's freshness window (default 15 minutes) is shown as "to be confirmed" and cannot be reserved or sold.

## 3. SES → Partner events

SES `POST`s to the partner's registered HTTPS endpoint with the same envelope and `SES-Signature` header, signed with the **outbound** secret.

| Type | `data` |
|---|---|
| `order.fulfilment_requested` | `order_number`, `lines[]` `{line_id, sku, quantity}` |
| `order.cancelled` | `order_number`, `lines[]` |

The partner must respond `2xx` within 10 s. SES retries non-2xx responses with the backoff above, and dead-lettered deliveries can be replayed. Partners should de-duplicate on `id`. Customer personal data is not included.

## 4. Partner API (read)

`Authorization: Bearer ses_live_<prefix>_<secret>` · 120 requests/minute per key.

| Endpoint | Scope | Returns |
|---|---|---|
| `GET /api/v1/health` | — | Contract version |
| `GET /api/v1/partner/mappings` | `catalogue:read` | Partner's mapped SKUs, listing state, cost and stock |
| `GET /api/v1/partner/fulfilment-requests` | `orders:read` | Order lines assigned to the partner |

Only the key owner's organisation data is returned. SES sell prices and other partners' data are never exposed.

## 5. Synchronisation targets

| Data | Target | Consistency |
|---|---|---|
| Webhook acknowledgement | p95 < 500 ms | — |
| Stock and price → SES UI | p95 < 10 s | Near real-time (live push after commit) |
| SES order events → partner | p95 < 30 s; retried up to ~24 h | Eventual, at least once |
| Polling partners (planned) | One polling interval (default 5 min) | Eventual |
| Full reconciliation (planned) | Daily | Eventual, drift reported |

These are design targets. They have not yet been measured under production load. **On the current shared hosting plan**, events are acknowledged immediately but follow-up processing can take up to ~5 minutes when the app has been idle (it is woken by requests and a 5-minute cron); a VPS restores the targets above.

## 6. Testing against SES

SES runs a labelled **KingsView simulator** that exercises this contract with fictional data. It covers duplicates, stale versions, bad signatures, replays and out-of-order delivery. Contract tests are in `tests/integrations.test.ts`.
