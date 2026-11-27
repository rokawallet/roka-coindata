# Database

Migrations: `supabase/migrations/*.sql` (schema, chain seed, storage bucket). RLS is enabled on every table with no
policies; only the service-role key (server-side) can read or write.

| Table | Purpose |
|---|---|
| `chains` | Chain registry (`chain_id` unique, provider ids, `is_active`) |
| `assets` | Canonical metadata. `identity_key` unique; check constraint enforces native/token shape and lowercase address |
| `asset_provider_mappings` | `(asset_id, provider)` -> provider reference (CoinGecko id, GeckoTerminal ref, ...) |
| `asset_overrides` | Admin-approved field overrides (`fields` jsonb, reason, approver) |
| `refresh_jobs` | Persistent jobs; partial unique index allows one pending/running job per asset |
| `discovery_misses` | Cooldowns for unknown tokens |
| `provider_health` | Last success/failure per provider |
| `api_keys` | Prefix + HMAC-SHA256 hash, scopes `read`/`admin`, expiry |
| `audit_log` | Admin mutations |
| `rate_limit_counters` | Fixed-window counters used by API limits and provider budgets |

Functions: `rate_limit_hit`, `rate_limit_cleanup`, `enqueue_stale_assets`, `claim_refresh_jobs`, `search_assets`
(execute revoked from `anon`/`authenticated`). Storage bucket `coin-logos` is public-read, 1 MiB, png/jpeg/webp/gif.

Apply with `supabase link --project-ref <ref> && supabase db push`, or paste the files into the SQL editor in order.
