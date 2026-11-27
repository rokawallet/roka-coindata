# API (v1)

Base: `/api/v1`. JSON envelope: `{ "success": true, "data": ..., "metadata": {...}, "request_id": "..." }`;
errors: `{ "success": false, "error": { "code", "message", "details?" }, "request_id" }`. Every response carries `X-Request-Id`.
Auth (optional on public routes, required for admin): `Authorization: Bearer rcd_<prefix>_<secret>`.
Rate limit headers: `X-RateLimit-Limit/Remaining/Reset`; 429 includes `Retry-After`.
Full machine-readable spec: [`openapi.yaml`](./openapi.yaml).

## Public
| Method & path | Notes |
|---|---|
| `GET /chains`, `GET /chains/{chain_id}` | Active chains |
| `GET /coins?chain=&page=&limit=` | Paginated assets |
| `GET /coins/{chain_id}/{contract_address}` | Read-through; `metadata.cache` = `hit` / `stale` / `miss` |
| `GET /coins/native/{chain_id}` | Native asset |
| `GET /search?q=&chain=&page=&limit=` | DB-only search by name, symbol, address prefix |
| `POST /metadata/discover` `{chain_id, contract_address}` | Stricter rate limit; 201 when newly discovered |
| `GET /health` (outside `/api/v1`) | Liveness + DB check |

## Admin (`admin` scope; no CORS)
| Method & path | Purpose |
|---|---|
| `GET/POST /admin/chains`, `PATCH /admin/chains/{chain_id}` | Manage chain registry |
| `GET/POST /admin/coins` | List all assets / register an official asset |
| `GET/PATCH /admin/coins/{chain_id}/{address\|native}` | Inspect (mappings, override) / set verification status |
| `PUT/DELETE /admin/coins/{chain_id}/{address\|native}/override` | Apply / remove official override |
| `POST /admin/coins/{chain_id}/{address\|native}/refresh` | Manual refresh |
| `GET /admin/discovered` | Unverified discovered tokens to review |
| `GET /admin/providers[?probe=true]` | Provider health |
| `GET /admin/jobs[?status=]`, `POST /admin/jobs/{id}/retry` | Refresh jobs |

`GET /api/cron/refresh` is for Vercel Cron only (Bearer `CRON_SECRET`).
