# Providers

Interface: `MetadataProvider` in `src/domain/providers.ts`. Adapters return unnormalized `ProviderResult`;
`normalizeMetadata` produces the canonical model. Add a provider by implementing the interface, registering it in
`container.ts` and adding its id to `ProviderId` / `PROVIDER_ORDER`.

**CoinGecko** (`GET /coins/{platform}/contract/{address}`, `GET /coins/{id}`) with
`localization/tickers/market_data/community_data/developer_data/sparkline=false`. Auth header by plan
(`x-cg-demo-api-key` / `x-cg-pro-api-key`). Per-chain mapping: `chains.coingecko_platform_id`, `coingecko_native_id`.

**GeckoTerminal** (`GET /networks/{network}/tokens/{address}` and `/info`), `Accept: application/json;version=20230302`.
Used for tokens missing from CoinGecko and to fill gaps (decimals, logo, socials). The token endpoint includes price
fields, which are discarded. Mapping: `chains.geckoterminal_network_id`. No native-asset support.

The endpoint paths and response fields above were written from knowledge of the public API docs and were NOT verified
against the live APIs in this build (no network). Verify them first (see README validation notes). Response parsing is
tolerant (zod, nullish fields) and unexpected shapes surface as `provider_unavailable`, never as corrupted data.

Policy: retries only for network errors/5xx (bounded by `PROVIDER_MAX_RETRIES`); 429 is never retried; a shared DB-backed
per-minute budget gates every provider call.
