import type { SupabaseClient } from '@supabase/supabase-js';
import type { AssetListFilter, AssetRepository, Page } from '@/domain/ports';
import type {
  Asset,
  AssetMetadataPatch,
  AssetOverride,
  CoinMetadata,
  NewAsset,
  ProviderId,
  VerificationStatus,
} from '@/domain/types';
import { assetKey } from '@/domain/address';
import { check, UNIQUE_VIOLATION } from './client';

export class SupabaseAssetRepository implements AssetRepository {
  constructor(private readonly db: SupabaseClient) {}

  private async findByKey(key: string): Promise<Asset | null> {
    const { data, error } = await this.db.from('assets').select('*').eq('identity_key', key).maybeSingle();
    check(error, 'assets.findByKey');
    return (data as Asset | null) ?? null;
  }

  findToken(chainId: number, address: string): Promise<Asset | null> {
    return this.findByKey(assetKey(chainId, address));
  }

  findNative(chainId: number): Promise<Asset | null> {
    return this.findByKey(assetKey(chainId, null));
  }

  async findById(id: string): Promise<Asset | null> {
    const { data, error } = await this.db.from('assets').select('*').eq('id', id).maybeSingle();
    check(error, 'assets.findById');
    return (data as Asset | null) ?? null;
  }

  async insert(row: NewAsset): Promise<Asset> {
    const { data, error } = await this.db.from('assets').insert(row).select('*').single();
    if (error?.code === UNIQUE_VIOLATION) {
      const winner = await this.findByKey(row.identity_key);
      if (winner) return winner;
    }
    check(error, 'assets.insert');
    return data as Asset;
  }

  async updateMetadata(id: string, patch: AssetMetadataPatch): Promise<Asset> {
    const { data, error } = await this.db.from('assets').update(patch).eq('id', id).select('*').single();
    check(error, 'assets.updateMetadata');
    return data as Asset;
  }

  async setVerification(id: string, status: VerificationStatus): Promise<Asset> {
    const { data, error } = await this.db
      .from('assets')
      .update({ verification_status: status })
      .eq('id', id)
      .select('*')
      .single();
    check(error, 'assets.setVerification');
    return data as Asset;
  }

  async setHasOverride(id: string, value: boolean): Promise<Asset> {
    const { data, error } = await this.db
      .from('assets')
      .update({ has_override: value })
      .eq('id', id)
      .select('*')
      .single();
    check(error, 'assets.setHasOverride');
    return data as Asset;
  }

  async recordRefreshFailure(id: string, failures: number, nextRefreshAt: Date, message: string): Promise<void> {
    const { error } = await this.db
      .from('assets')
      .update({
        refresh_failures: failures,
        next_refresh_at: nextRefreshAt.toISOString(),
        last_refresh_error: message.slice(0, 300),
      })
      .eq('id', id);
    check(error, 'assets.recordRefreshFailure');
  }

  async upsertMappings(
    assetId: string,
    mappings: { provider: ProviderId; provider_ref: string }[],
  ): Promise<void> {
    if (mappings.length === 0) return;
    const rows = mappings.map((m) => ({ asset_id: assetId, ...m }));
    const { error } = await this.db.from('asset_provider_mappings').upsert(rows, { onConflict: 'asset_id,provider' });
    check(error, 'assets.upsertMappings');
  }

  async getMappings(assetId: string): Promise<{ provider: string; provider_ref: string }[]> {
    const { data, error } = await this.db
      .from('asset_provider_mappings')
      .select('provider, provider_ref')
      .eq('asset_id', assetId);
    check(error, 'assets.getMappings');
    return (data ?? []) as { provider: string; provider_ref: string }[];
  }

  async getOverride(assetId: string): Promise<AssetOverride | null> {
    const { data, error } = await this.db.from('asset_overrides').select('*').eq('asset_id', assetId).maybeSingle();
    check(error, 'assets.getOverride');
    return (data as AssetOverride | null) ?? null;
  }

  async saveOverride(input: {
    asset_id: string;
    fields: Partial<CoinMetadata>;
    reason: string;
    approved_by: string;
  }): Promise<void> {
    const { error } = await this.db
      .from('asset_overrides')
      .upsert({ ...input, approved_at: new Date().toISOString() }, { onConflict: 'asset_id' });
    check(error, 'assets.saveOverride');
  }

  async deleteOverride(assetId: string): Promise<void> {
    const { error } = await this.db.from('asset_overrides').delete().eq('asset_id', assetId);
    check(error, 'assets.deleteOverride');
  }

  async list(filter: AssetListFilter, page: number, limit: number): Promise<Page<Asset>> {
    let query = this.db.from('assets').select('*', { count: 'exact' });
    if (filter.chainIds) {
      if (filter.chainIds.length === 0) return { items: [], total: 0 };
      query = query.in('chain_id', filter.chainIds);
    }
    if (filter.verification) query = query.eq('verification_status', filter.verification);
    if (filter.excludeRejected) query = query.neq('verification_status', 'rejected');
    const from = (page - 1) * limit;
    const { data, error, count } = await query
      .order('created_at', { ascending: false })
      .order('id', { ascending: true })
      .range(from, from + limit - 1);
    check(error, 'assets.list');
    return { items: (data ?? []) as Asset[], total: count ?? 0 };
  }

  async search(query: string, chainId: number | null, page: number, limit: number): Promise<Page<Asset>> {
    // Parameterised RPC: the query text never touches a PostgREST filter string.
    const { data, error } = await this.db.rpc('search_assets', {
      p_query: query,
      p_chain_id: chainId,
      p_limit: limit,
      p_offset: (page - 1) * limit,
    });
    check(error, 'assets.search');
    const rows = (data ?? []) as { asset: Asset; total_count: number | string }[];
    return { items: rows.map((r) => r.asset), total: rows.length > 0 ? Number(rows[0]?.total_count ?? 0) : 0 };
  }
}
