/* Usage: pnpm create-api-key -- --name "RokaWallet" --scopes read[,admin] [--expires-days 365]
 * Prints the key ONCE. Only an HMAC of it is stored. Requires SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, API_KEY_PEPPER. */
import { createClient } from '@supabase/supabase-js';
import { generateApiKey, hashApiKey } from '../src/security/api-keys';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, API_KEY_PEPPER } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !API_KEY_PEPPER || API_KEY_PEPPER.length < 32) {
    throw new Error('SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and API_KEY_PEPPER (>=32 chars) are required');
  }
  const name = arg('name');
  const scopes = (arg('scopes') ?? 'read').split(',').map((s) => s.trim());
  if (!name || !scopes.every((s) => s === 'read' || s === 'admin')) {
    throw new Error('Usage: --name <name> --scopes read[,admin] [--expires-days N]');
  }
  const days = arg('expires-days');
  const expires_at = days ? new Date(Date.now() + Number(days) * 86_400_000).toISOString() : null;

  const { key, prefix } = generateApiKey();
  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { error } = await db.from('api_keys').insert({
    name, key_prefix: prefix, key_hash: hashApiKey(key, API_KEY_PEPPER), scopes, expires_at,
  });
  if (error) throw new Error(`Insert failed: ${error.message}`);
  console.log(`Created API key "${name}" (scopes: ${scopes.join(',')}).\nStore it now; it cannot be shown again:\n\n${key}\n`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
