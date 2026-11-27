import type { SupabaseClient } from '@supabase/supabase-js';
import type { JobRepository, Page } from '@/domain/ports';
import type { RefreshJob } from '@/domain/types';
import { check, UNIQUE_VIOLATION } from './client';

export class SupabaseJobRepository implements JobRepository {
  constructor(private readonly db: SupabaseClient) {}

  async startInline(input: Parameters<JobRepository['startInline']>[0]): Promise<RefreshJob | null> {
    const { data, error } = await this.db
      .from('refresh_jobs')
      .insert({ ...input, status: 'running', attempts: 1, started_at: new Date().toISOString() })
      .select('*')
      .single();
    if (error?.code === UNIQUE_VIOLATION) return null; // another worker already owns this asset
    check(error, 'jobs.startInline');
    return data as RefreshJob;
  }

  async enqueueStale(limit: number): Promise<number> {
    const { data, error } = await this.db.rpc('enqueue_stale_assets', { p_limit: limit });
    check(error, 'jobs.enqueueStale');
    return Number(data ?? 0);
  }

  async claim(limit: number): Promise<RefreshJob[]> {
    const { data, error } = await this.db.rpc('claim_refresh_jobs', { p_limit: limit });
    check(error, 'jobs.claim');
    return (data ?? []) as RefreshJob[];
  }

  async complete(id: string): Promise<void> {
    const { error } = await this.db
      .from('refresh_jobs')
      .update({ status: 'completed', completed_at: new Date().toISOString(), last_error: null })
      .eq('id', id);
    check(error, 'jobs.complete');
  }

  async fail(id: string, message: string, retryAt: Date | null): Promise<void> {
    const patch = retryAt
      ? { status: 'pending', run_after: retryAt.toISOString(), last_error: message.slice(0, 300) }
      : { status: 'failed', completed_at: new Date().toISOString(), last_error: message.slice(0, 300) };
    const { error } = await this.db.from('refresh_jobs').update(patch).eq('id', id);
    check(error, 'jobs.fail');
  }

  async release(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const { error } = await this.db
      .from('refresh_jobs')
      .update({ status: 'pending', started_at: null })
      .in('id', ids)
      .eq('status', 'running');
    check(error, 'jobs.release');
  }

  async list(filter: { status?: RefreshJob['status'] }, page: number, limit: number): Promise<Page<RefreshJob>> {
    let query = this.db.from('refresh_jobs').select('*', { count: 'exact' });
    if (filter.status) query = query.eq('status', filter.status);
    const from = (page - 1) * limit;
    const { data, error, count } = await query
      .order('created_at', { ascending: false })
      .range(from, from + limit - 1);
    check(error, 'jobs.list');
    return { items: (data ?? []) as RefreshJob[], total: count ?? 0 };
  }

  async retry(id: string): Promise<RefreshJob | null> {
    const { data, error } = await this.db
      .from('refresh_jobs')
      .update({ status: 'pending', run_after: new Date().toISOString(), attempts: 0, completed_at: null })
      .eq('id', id)
      .eq('status', 'failed')
      .select('*')
      .maybeSingle();
    if (error?.code === UNIQUE_VIOLATION) return null; // an active job for this asset already exists
    check(error, 'jobs.retry');
    return (data as RefreshJob | null) ?? null;
  }
}
