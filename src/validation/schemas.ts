import { z } from 'zod';
import { normalizeEvmAddress } from '@/domain/address';
import {
  cleanDescription,
  cleanText,
  normalizeDiscord,
  normalizeGithub,
  normalizeTelegram,
  normalizeTwitter,
  normalizeUrl,
} from '@/domain/normalize';
import type { CoinMetadata } from '@/domain/types';
import type { AssetRef } from '@/application/admin/admin-service';
import { errors } from '@/errors';

/** Parses untrusted input; throws a 400 AppError listing field paths and messages only. */
export function parse<S extends z.ZodTypeAny>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw errors.invalidRequest('Invalid request', {
      issues: result.error.issues.slice(0, 10).map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  return result.data as z.output<S>;
}

const custom = (ctx: z.RefinementCtx, message: string): typeof z.NEVER => {
  ctx.addIssue({ code: z.ZodIssueCode.custom, message });
  return z.NEVER;
};

export const chainIdSchema = z
  .string()
  .regex(/^\d{1,15}$/, 'chain_id must be a positive integer')
  .transform(Number)
  .refine((n) => n > 0, 'chain_id must be a positive integer');

export const addressSchema = z
  .string()
  .max(100)
  .transform((v, ctx) => normalizeEvmAddress(v) ?? custom(ctx, 'Invalid EVM contract address'));

export const assetRefSchema = z
  .string()
  .max(100)
  .transform((v, ctx): AssetRef => {
    if (v.toLowerCase() === 'native') return { kind: 'native' };
    const address = normalizeEvmAddress(v);
    return address ? { kind: 'token', address } : custom(ctx, 'Expected an EVM address or "native"');
  });

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const searchQuerySchema = paginationSchema.extend({
  q: z.string().trim().min(2).max(100),
  chain: z.string().trim().min(1).max(40).optional(),
});

export const coinListQuerySchema = paginationSchema.extend({
  chain: z.string().trim().min(1).max(40).optional(),
});

export const adminCoinListQuerySchema = paginationSchema.extend({
  chain_id: chainIdSchema.optional(),
  verification_status: z.enum(['unverified', 'verified', 'rejected']).optional(),
});

export const jobListQuerySchema = paginationSchema.extend({
  status: z.enum(['pending', 'running', 'completed', 'failed']).optional(),
});

// ----------------------------------------------------------------- request bodies

const httpsUrl = z.string().transform((v, ctx) => normalizeUrl(v) ?? custom(ctx, 'Invalid https URL'));
const social = (fn: (v: unknown) => string | null, label: string) =>
  z.string().transform((v, ctx) => fn(v) ?? custom(ctx, `Invalid ${label} URL or handle`));
const text = (max: number) => z.string().transform((v, ctx) => cleanText(v, max) ?? custom(ctx, 'Must not be empty'));

const metadataShape = {
  name: text(100).optional(),
  symbol: text(32).optional(),
  decimals: z.number().int().min(0).max(255).optional(),
  description: z.string().transform((v, ctx) => cleanDescription(v) ?? custom(ctx, 'Must not be empty')).optional(),
  logo_url: httpsUrl.optional(),
  website_url: httpsUrl.optional(),
  twitter_url: social(normalizeTwitter, 'Twitter/X').optional(),
  telegram_url: social(normalizeTelegram, 'Telegram').optional(),
  discord_url: social(normalizeDiscord, 'Discord').optional(),
  github_url: social(normalizeGithub, 'GitHub').optional(),
  other_links: z
    .record(z.string().regex(/^[a-z0-9_]{2,30}$/), httpsUrl)
    .refine((o) => Object.keys(o).length <= 10, 'At most 10 other links')
    .optional(),
};

type MetadataInput = {
  [K in keyof typeof metadataShape]?: z.output<(typeof metadataShape)[K]>;
};

export function toMetadataFields(input: MetadataInput): Partial<CoinMetadata> {
  const out: Partial<CoinMetadata> = {};
  if (input.name !== undefined) out.name = input.name;
  if (input.symbol !== undefined) out.symbol = input.symbol;
  if (input.decimals !== undefined) out.decimals = input.decimals;
  if (input.description !== undefined) out.description = input.description;
  if (input.logo_url !== undefined) out.logo_source_url = input.logo_url;
  if (input.website_url !== undefined) out.website_url = input.website_url;
  if (input.twitter_url !== undefined) out.twitter_url = input.twitter_url;
  if (input.telegram_url !== undefined) out.telegram_url = input.telegram_url;
  if (input.discord_url !== undefined) out.discord_url = input.discord_url;
  if (input.github_url !== undefined) out.github_url = input.github_url;
  if (input.other_links !== undefined) out.other_links = input.other_links;
  return out;
}

const reason = z.string().trim().min(3).max(500);

export const overrideBodySchema = z
  .object({ ...metadataShape, reason })
  .strict()
  .refine((b) => Object.keys(b).some((k) => k !== 'reason'), 'Provide at least one field to override');

export const registerAssetBodySchema = z
  .object({
    ...metadataShape,
    chain_id: z.number().int().positive(),
    contract_address: addressSchema.optional(),
    name: text(100),
    symbol: text(32),
    verification_status: z.enum(['verified', 'unverified']).default('verified'),
    reason,
  })
  .strict()
  .refine((b) => b.contract_address === undefined || b.decimals !== undefined, {
    message: 'decimals is required for contract-based assets',
    path: ['decimals'],
  });

export const verificationBodySchema = z
  .object({ verification_status: z.enum(['unverified', 'verified', 'rejected']) })
  .strict();

export const discoverBodySchema = z
  .object({ chain_id: z.number().int().positive(), contract_address: addressSchema })
  .strict();

const nullableId = z.string().trim().min(1).max(100).nullable();

const chainFields = {
  name: z.string().trim().min(1).max(80),
  slug: z.string().regex(/^[a-z0-9-]{2,40}$/),
  network_type: z.enum(['mainnet', 'testnet']),
  native_name: z.string().trim().min(1).max(60),
  native_symbol: z.string().trim().min(1).max(20),
  native_decimals: z.number().int().min(0).max(36),
  native_logo_url: httpsUrl.nullable(),
  coingecko_platform_id: nullableId,
  coingecko_native_id: nullableId,
  geckoterminal_network_id: nullableId,
  is_active: z.boolean(),
};

export const chainCreateSchema = z
  .object({
    chain_id: z.number().int().positive(),
    ...chainFields,
    native_logo_url: chainFields.native_logo_url.default(null),
    coingecko_platform_id: nullableId.default(null),
    coingecko_native_id: nullableId.default(null),
    geckoterminal_network_id: nullableId.default(null),
    network_type: chainFields.network_type.default('mainnet'),
    is_active: z.boolean().default(false),
  })
  .strict();

export const chainUpdateSchema = z
  .object(chainFields)
  .partial()
  .strict()
  .refine((b) => Object.keys(b).length > 0, 'Provide at least one field');
