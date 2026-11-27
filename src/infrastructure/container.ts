import { getEnv } from '@/config/env';
import type { Env } from '@/config/env';
import type {
  ApiKeyRepository,
  AssetRepository,
  AuditRepository,
  ChainRepository,
  JobRepository,
  MissRepository,
  ProviderHealthRepository,
  RateLimiter,
} from '@/domain/ports';
import type { MetadataProvider } from '@/domain/providers';
import type { FreshnessPolicy } from '@/domain/freshness';
import { AdminService } from '@/application/admin/admin-service';
import { AssetWriter } from '@/application/metadata/asset-writer';
import { LogoService } from '@/application/metadata/logo-service';
import { MetadataService } from '@/application/metadata/metadata-service';
import { ProviderOrchestrator, RateLimiterBudget } from '@/application/metadata/provider-orchestrator';
import { RefreshService } from '@/application/refresh/refresh-service';
import { SearchService } from '@/application/search/search-service';
import { createServiceClient } from './database/client';
import { SupabaseAssetRepository } from './database/asset-repository';
import { SupabaseChainRepository } from './database/chain-repository';
import { SupabaseJobRepository } from './database/job-repository';
import {
  SupabaseApiKeyRepository,
  SupabaseAuditRepository,
  SupabaseMissRepository,
  SupabaseProviderHealthRepository,
  SupabaseRateLimiter,
} from './database/support-repositories';
import { SafeImageDownloader } from './http/safe-image-downloader';
import { createLogger } from './logging/logger';
import type { Logger } from './logging/logger';
import { CoinGeckoProvider } from './providers/coingecko/coingecko-provider';
import { GeckoTerminalProvider } from './providers/geckoterminal/geckoterminal-provider';
import { SupabaseLogoStorage } from './storage/logo-storage';

export interface Container {
  env: Env;
  logger: Logger;
  now: () => Date;
  chains: ChainRepository;
  assets: AssetRepository;
  jobs: JobRepository;
  misses: MissRepository;
  apiKeys: ApiKeyRepository;
  health: ProviderHealthRepository;
  audit: AuditRepository;
  rateLimiter: RateLimiter;
  orchestrator: ProviderOrchestrator;
  metadata: MetadataService;
  search: SearchService;
  refresh: RefreshService;
  admin: AdminService;
  fallbackLogoUrl: string;
}

export function buildContainer(env: Env): Container {
  const logger = createLogger({ service: 'roka-coins-data' });
  const now = () => new Date();
  const db = createServiceClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

  const chains = new SupabaseChainRepository(db);
  const assets = new SupabaseAssetRepository(db);
  const jobs = new SupabaseJobRepository(db);
  const misses = new SupabaseMissRepository(db);
  const apiKeys = new SupabaseApiKeyRepository(db);
  const health = new SupabaseProviderHealthRepository(db);
  const audit = new SupabaseAuditRepository(db);
  const rateLimiter = new SupabaseRateLimiter(db);

  const registry: Record<string, MetadataProvider> = {
    coingecko: new CoinGeckoProvider({
      plan: env.COINGECKO_API_PLAN,
      apiKey: env.COINGECKO_API_KEY,
      baseUrl: env.COINGECKO_BASE_URL,
      timeoutMs: env.PROVIDER_TIMEOUT_MS,
      retries: env.PROVIDER_MAX_RETRIES,
    }),
    geckoterminal: new GeckoTerminalProvider({
      baseUrl: env.GECKOTERMINAL_BASE_URL,
      timeoutMs: env.PROVIDER_TIMEOUT_MS,
      retries: env.PROVIDER_MAX_RETRIES,
    }),
  };
  const providers = env.providerOrder.map((id) => registry[id]).filter((p): p is MetadataProvider => p !== undefined);
  const orchestrator = new ProviderOrchestrator(
    providers,
    new RateLimiterBudget(rateLimiter, {
      coingecko: env.COINGECKO_MAX_REQUESTS_PER_MINUTE,
      geckoterminal: env.GECKOTERMINAL_MAX_REQUESTS_PER_MINUTE,
    }),
    health,
    logger,
  );

  const policy: FreshnessPolicy = {
    verifiedSeconds: env.FRESHNESS_VERIFIED_SECONDS,
    establishedSeconds: env.FRESHNESS_ESTABLISHED_SECONDS,
    discoveredSeconds: env.FRESHNESS_DISCOVERED_SECONDS,
    failureBackoffSeconds: env.REFRESH_FAILURE_BACKOFF_SECONDS,
    maxBackoffSeconds: env.REFRESH_MAX_BACKOFF_SECONDS,
  };

  const logos = new LogoService(
    new SafeImageDownloader({ maxBytes: env.LOGO_MAX_BYTES, timeoutMs: env.LOGO_FETCH_TIMEOUT_MS }),
    new SupabaseLogoStorage(db, env.SUPABASE_LOGO_BUCKET),
    logger,
  );
  const writer = new AssetWriter({ assets, logos, policy, now });
  const refresh = new RefreshService({
    chains, assets, jobs, orchestrator, writer, policy, now, logger,
    batchSize: env.REFRESH_BATCH_SIZE,
    timeBudgetMs: env.REFRESH_TIME_BUDGET_MS,
  });
  const metadata = new MetadataService({
    chains, assets, misses, orchestrator, writer, refresh, policy, now, logger,
    unknownCooldownSeconds: env.UNKNOWN_TOKEN_COOLDOWN_SECONDS,
    unknownMaxCooldownSeconds: env.UNKNOWN_TOKEN_MAX_COOLDOWN_SECONDS,
  });

  return {
    env, logger, now, chains, assets, jobs, misses, apiKeys, health, audit, rateLimiter,
    orchestrator, metadata, refresh,
    search: new SearchService(assets, chains),
    admin: new AdminService({ chains, assets, jobs, writer, refresh, audit }),
    fallbackLogoUrl: `${env.APP_BASE_URL.replace(/\/+$/, '')}/fallback-logo.svg`,
  };
}

let instance: Container | undefined;

/** Lazily builds the dependency graph once per server instance. */
export function getContainer(): Container {
  instance ??= buildContainer(getEnv());
  return instance;
}
