# Roka Coins Data

Independent blockchain token-metadata service for the Roka ecosystem: canonical metadata (name, symbol, decimals,
logo, links, verification) for native and contract-based assets, cached in Supabase, fed by CoinGecko (primary) and
GeckoTerminal (secondary), served through a versioned REST API. It is an API service, not a website: there is no
admin UI; administration is done through the protected `/api/v1/admin/*` endpoints.

## Features
Read-through Postgres cache with stale-while-revalidate and tiered freshness · provider abstraction with ordered fallback,
timeouts, bounded retries and shared per-provider quota budgets · normalization to one canonical model · logo mirroring to
Supabase Storage with SSRF protection and magic-byte validation · admin overrides that providers can never overwrite ·
persistent refresh jobs + Vercel Cron · DB-backed rate limiting (works on serverless) · hashed API keys · audit log ·
unknown-token cooldowns · request ids, structured logs, safe errors.

## Stack
Next.js 15 (App Router, route handlers, Node runtime) · TypeScript strict · Supabase Postgres + Storage · zod · undici ·
Vitest · pnpm · Vercel.

## Repository layout
`app/` route handlers · `src/domain` pure logic + ports · `src/application` services · `src/infrastructure` adapters ·
`src/interfaces/http` envelope/auth/rate-limit wrapper · `src/security` SSRF, images, API keys · `supabase/migrations` SQL ·
`scripts/` API-key CLI, smoke test · `tests/` · `docs/`.

## Local development
```bash
pnpm install
cp .env.example .env.local     # fill in values (see docs/ENVIRONMENT.md)
# Supabase: create a project, then
supabase link --project-ref <ref> && supabase db push   # applies supabase/migrations (schema, chains, logo bucket)
pnpm dev
pnpm create-api-key -- --name dev --scopes read,admin   # prints a key once
curl localhost:3000/api/v1/coins/1/0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48
```
(`supabase` is the Supabase CLI. Alternatively run the SQL files in order in the dashboard SQL editor.)

Provider setup: CoinGecko needs no key for the `public` plan; for `demo`/`pro` set `COINGECKO_API_PLAN` and
`COINGECKO_API_KEY`. GeckoTerminal needs no key. Details: docs/PROVIDERS.md.

## Tests and validation
```bash
pnpm test         # vitest: unit + in-memory integration (providers mocked, no network, no quota)
pnpm typecheck && pnpm lint && pnpm build
pnpm validate     # all of the above
```

## Deployment
See docs/DEPLOYMENT.md (Vercel project, env vars, cron, API keys, smoke test).

## API
docs/API.md and docs/openapi.yaml. Example:
```
GET /api/v1/coins/42220/0x765de816845861e75a25fca122bb6898b8b1282a
Authorization: Bearer rcd_...   (optional; raises the rate limit)
```

## Security notes
Service-role key and pepper are server-only env vars · RLS on with no policies · API keys stored as HMAC-SHA256 only ·
admin = `admin` scope, never CORS-enabled, audited · SSRF defence on logo fetches (https only, DNS checked at connect
time, redirects re-validated, size/time caps, png/jpeg/webp/gif by magic bytes, SVG refused) · all SQL via parameterized
queries/RPC (search text never enters a filter string) · bodies capped, inputs validated with zod · errors never expose
internals · failed-auth attempts are rate limited.

Known trade-offs: rate limiting is fail-closed (503) if the database is unreachable; the CDN may serve a fresh cached
response for up to 5 minutes after an admin change; EIP-55 checksums are not enforced (identity uses lowercase).

## Future: Roka Infrastructure
Consume this service over `/api/v1` with a `read` key; do not share the database or re-implement providers.
See docs/ARCHITECTURE.md.

## Validation status of this codebase
See the delivery notes: the code was statically checked and the pure-logic tests were executed offline, but
`pnpm install`, the Next.js build, linting, real Vitest, and any live Supabase/CoinGecko/GeckoTerminal calls were NOT run.
Run `pnpm validate` and `scripts/smoke-test.sh` yourself before relying on it.
