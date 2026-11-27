import { createClient } from '@supabase/supabase-js';
import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import { InfrastructureError } from '@/errors';

/** Server-side client using the service-role key. Must never be imported into client-side code. */
export function createServiceClient(url: string, serviceRoleKey: string): SupabaseClient {
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { 'x-client-info': 'roka-coins-data' } },
  });
}

/** Throws an InfrastructureError (logged, never shown to clients) when a query failed. */
export function check(error: PostgrestError | null, context: string): void {
  if (error) throw new InfrastructureError(`${context}: ${error.message}`, error.code);
}

export const UNIQUE_VIOLATION = '23505';
