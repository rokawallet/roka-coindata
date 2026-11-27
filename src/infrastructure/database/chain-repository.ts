import type { SupabaseClient } from '@supabase/supabase-js';
import type { ChainInput, ChainRepository } from '@/domain/ports';
import type { Chain } from '@/domain/types';
import { check } from './client';

export class SupabaseChainRepository implements ChainRepository {
  constructor(private readonly db: SupabaseClient) {}

  async list(options: { activeOnly?: boolean } = {}): Promise<Chain[]> {
    let query = this.db.from('chains').select('*').order('chain_id', { ascending: true });
    if (options.activeOnly) query = query.eq('is_active', true);
    const { data, error } = await query;
    check(error, 'chains.list');
    return (data ?? []) as Chain[];
  }

  async findByChainId(chainId: number): Promise<Chain | null> {
    const { data, error } = await this.db.from('chains').select('*').eq('chain_id', chainId).maybeSingle();
    check(error, 'chains.findByChainId');
    return (data as Chain | null) ?? null;
  }

  async findBySlug(slug: string): Promise<Chain | null> {
    const { data, error } = await this.db.from('chains').select('*').eq('slug', slug).maybeSingle();
    check(error, 'chains.findBySlug');
    return (data as Chain | null) ?? null;
  }

  async create(input: ChainInput): Promise<Chain> {
    const { data, error } = await this.db.from('chains').insert(input).select('*').single();
    check(error, 'chains.create');
    return data as Chain;
  }

  async update(chainId: number, patch: Partial<Omit<ChainInput, 'chain_id'>>): Promise<Chain | null> {
    const { data, error } = await this.db
      .from('chains')
      .update(patch)
      .eq('chain_id', chainId)
      .select('*')
      .maybeSingle();
    check(error, 'chains.update');
    return (data as Chain | null) ?? null;
  }
}
