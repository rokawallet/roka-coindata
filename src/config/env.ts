import { z } from 'zod';
import type { ProviderId } from '@/domain/types';

const int = (def: number, min = 0, max = Number.MAX_SAFE_INTEGER) =>
  z.coerce.number().int().min(min).max(max).default(def);
const bool = (def: boolean) =>
  z
    .enum(['true', 'false'])
    .default(def ? 'true' : 'false')
    .transform((v) => v === 'true');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_BASE_URL: z.string().url(),

  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  SUPABASE_LOGO_BUCKET: z.string().min(3).default('coin-logos'),

  API_KEY_PEPPER: z.string().min(32),
  CRON_SECRET: z.string().min(24),
  CORS_ALLOWED_ORIGINS: z.string().default(''),

  COINGECKO_API_PLAN: z.enum(['public', 'demo', 'pro']).default('demo'),
  COINGECKO_API_KEY: z.string().optional(),
  COINGECKO_BASE_URL: z.string().url().optional(),
  COINGECKO_MAX_REQUESTS_PER_MINUTE: int(10, 1),
  GECKOTERMINAL_BASE_URL: z.string().url().default('https://api.geckoterminal.com/api/v2'),
  GECKOTERMINAL_MAX_REQUESTS_PER_MINUTE: int(20, 1),
  PROVIDER_ORDER: z.string().default('coingecko,geckoterminal'),
  PROVIDER_TIMEOUT_MS: int(8000, 500, 30000),
  PROVIDER_MAX_RETRIES: int(2, 0, 3),

  FRESHNESS_VERIFIED_SECONDS: int(86_400, 60),
  FRESHNESS_ESTABLISHED_SECONDS: int(259_200, 60),
  FRESHNESS_DISCOVERED_SECONDS: int(1_209_600, 60),
  REFRESH_FAILURE_BACKOFF_SECONDS: int(900, 30),
  REFRESH_MAX_BACKOFF_SECONDS: int(86_400, 60),
  UNKNOWN_TOKEN_COOLDOWN_SECONDS: int(3600, 30),
  UNKNOWN_TOKEN_MAX_COOLDOWN_SECONDS: int(604_800, 60),
  REFRESH_BATCH_SIZE: int(20, 1, 200),
  REFRESH_TIME_BUDGET_MS: int(45_000, 1000, 55_000),

  PUBLIC_DISCOVERY_ENABLED: bool(true),

  RATE_LIMIT_PUBLIC_PER_MINUTE: int(120, 1),
  RATE_LIMIT_SERVICE_PER_MINUTE: int(1200, 1),
  RATE_LIMIT_DISCOVERY_PER_MINUTE: int(10, 1),
  RATE_LIMIT_DISCOVERY_SERVICE_PER_MINUTE: int(60, 1),
  RATE_LIMIT_ADMIN_PER_MINUTE: int(60, 1),
  MAX_BODY_BYTES: int(32_768, 1024, 1_048_576),

  LOGO_MAX_BYTES: int(1_048_576, 1024, 5_242_880),
  LOGO_FETCH_TIMEOUT_MS: int(8000, 500, 30000),
});

const PROVIDERS: readonly ProviderId[] = ['coingecko', 'geckoterminal'];

export type Env = Omit<z.output<typeof schema>, 'CORS_ALLOWED_ORIGINS' | 'PROVIDER_ORDER'> & {
  corsOrigins: string[];
  providerOrder: ProviderId[];
};

/** Validates configuration. Empty strings are treated as unset. Errors name variables, never values. */
export function loadEnv(source: Record<string, string | undefined>): Env {
  const cleaned = Object.fromEntries(
    Object.entries(source).filter(([, v]) => v !== undefined && v !== ''),
  );
  const parsed = schema.safeParse(cleaned);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${problems}`);
  }
  const { CORS_ALLOWED_ORIGINS, PROVIDER_ORDER, ...rest } = parsed.data;
  const providerOrder = [
    ...new Set(
      PROVIDER_ORDER.split(',')
        .map((p) => p.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
  const invalid = providerOrder.filter((p) => !PROVIDERS.includes(p as ProviderId));
  if (invalid.length > 0 || providerOrder.length === 0) {
    throw new Error(
      `Invalid environment configuration: PROVIDER_ORDER must list only ${PROVIDERS.join(', ')}`,
    );
  }
  return {
    ...rest,
    corsOrigins: CORS_ALLOWED_ORIGINS.split(',')
      .map((o) => o.trim())
      .filter(Boolean),
    providerOrder: providerOrder as ProviderId[],
  };
}

let cached: Env | undefined;
export function getEnv(): Env {
  cached ??= loadEnv(process.env);
  return cached;
}
