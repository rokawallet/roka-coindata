# Environment configuration

All variables are validated at first request by `src/config/env.ts` (zod). Empty values count as unset.
Startup errors name the variable but never print its value. `.env.example` lists everything with placeholders.

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `APP_BASE_URL` | yes | – | Public URL; builds the fallback-logo URL |
| `SUPABASE_URL` | yes | – | Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | – | Server-only key. Never expose to browsers or commit |
| `SUPABASE_LOGO_BUCKET` | no | `coin-logos` | Must match the bucket created by the migration |
| `API_KEY_PEPPER` | yes | – | ≥32 chars. HMAC secret for API keys and IP hashing |
| `CRON_SECRET` | yes | – | ≥24 chars. Authenticates `/api/cron/refresh` |
| `CORS_ALLOWED_ORIGINS` | no | empty | Comma list or `*`. Applies to public routes only |
| `COINGECKO_API_PLAN` | no | `demo` | `public`, `demo` (header `x-cg-demo-api-key`) or `pro` (`x-cg-pro-api-key`, pro host) |
| `COINGECKO_API_KEY` | no | – | Required for `demo`/`pro` to authenticate |
| `COINGECKO_BASE_URL` | no | per plan | Override |
| `COINGECKO_MAX_REQUESTS_PER_MINUTE` | no | 10 | Shared budget across instances; set from your plan |
| `GECKOTERMINAL_BASE_URL` | no | official v2 | |
| `GECKOTERMINAL_MAX_REQUESTS_PER_MINUTE` | no | 20 | Counts HTTP calls (2 per lookup) |
| `PROVIDER_ORDER` | no | `coingecko,geckoterminal` | Fallback order |
| `PROVIDER_TIMEOUT_MS` / `PROVIDER_MAX_RETRIES` | no | 8000 / 2 | Per-request timeout; retries only for network/5xx |
| `FRESHNESS_*_SECONDS` | no | 1d / 3d / 14d | Refresh interval for verified / established / discovered assets |
| `REFRESH_FAILURE_BACKOFF_SECONDS`, `REFRESH_MAX_BACKOFF_SECONDS` | no | 900 / 86400 | Exponential backoff after failures |
| `UNKNOWN_TOKEN_COOLDOWN_SECONDS`, `UNKNOWN_TOKEN_MAX_COOLDOWN_SECONDS` | no | 3600 / 604800 | Doubling cooldown for tokens providers don't know |
| `REFRESH_BATCH_SIZE`, `REFRESH_TIME_BUDGET_MS` | no | 20 / 45000 | Bounds one cron run (must stay under `maxDuration` 60s) |
| `PUBLIC_DISCOVERY_ENABLED` | no | `true` | Anonymous GET of unknown token triggers discovery |
| `RATE_LIMIT_*` | no | see example | Per-minute limits; keyed by API key id, else hashed IP |
| `MAX_BODY_BYTES` | no | 32768 | JSON body cap |
| `LOGO_MAX_BYTES`, `LOGO_FETCH_TIMEOUT_MS` | no | 1 MiB / 8000 | Logo download limits |

The default provider budgets are conservative placeholders, not claims about any provider's actual limits.
Check your CoinGecko plan and set `COINGECKO_MAX_REQUESTS_PER_MINUTE` accordingly.
