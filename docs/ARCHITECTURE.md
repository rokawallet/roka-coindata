# Architecture

```
app/ (Next.js route handlers)  ->  src/interfaces/http (envelope, auth, rate limit, validation)
                                         |
                                  src/application  (MetadataService, RefreshService, AssetWriter,
                                         |          ProviderOrchestrator, LogoService, AdminService, SearchService)
                                         |
                                    src/domain      (types, address, normalize, merge/overrides, freshness, ports)
                                         ^
                  src/infrastructure (Supabase repos, storage, CoinGecko/GeckoTerminal adapters, safe downloader, logger)
```

* `domain` and `application` import nothing from Next.js. They depend only on interfaces in `domain/ports.ts` and
  `domain/providers.ts`, so the engine can be ported to Go behind the same HTTP contract.
* `infrastructure/container.ts` is the only place where concrete classes are wired.
* Request flow (`GET /coins/{chain}/{address}`): validate -> rate limit -> `MetadataService.getToken` ->
  DB lookup -> fresh: return; stale: return + background refresh (`after()`); missing: cooldown check ->
  in-flight de-duplication -> `ProviderOrchestrator` (budget check, provider call, normalize, merge) ->
  `AssetWriter` (override precedence, logo mirroring, persist) -> response.
* Identity: `chain_id + lowercase address` (`identity_key`), native = `chain_id:native`. CoinGecko ids are only a mapping.
* Overrides: `asset_overrides.fields` are re-applied on every provider write; removing an override is the explicit
  authorization for providers to overwrite those fields.
* Failure handling: provider errors never touch stored metadata; `refresh_failures` and `next_refresh_at` implement backoff.
* Concurrency: per-instance in-flight map + database-level unique active job per asset + shared DB rate limiter/budget.
* Scheduling: `enqueue_stale_assets` -> `claim_refresh_jobs` (`FOR UPDATE SKIP LOCKED`, reclaims stuck jobs) -> bounded batch.

## Roka Infrastructure integration
Roka Infrastructure should call this service over HTTPS with a `read` API key (higher rate limit), cache responses,
and never access the database. Provider logic stays here. The `/api/v1` contract is the stable boundary; breaking
changes ship as `/api/v2`.
