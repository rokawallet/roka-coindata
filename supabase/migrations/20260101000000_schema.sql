-- Roka Coins Data: core schema. All access goes through the server-side service role.
-- RLS is enabled on every table with no policies, so anon/authenticated roles get no access.

create extension if not exists pg_trgm with schema extensions;
create extension if not exists pgcrypto with schema extensions;

create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ---------------------------------------------------------------- chains
create table public.chains (
  id uuid primary key default gen_random_uuid(),
  chain_id bigint not null unique check (chain_id > 0),
  family text not null default 'evm' check (family in ('evm')),
  name text not null check (char_length(name) between 1 and 80),
  slug text not null unique check (slug ~ '^[a-z0-9-]{2,40}$'),
  network_type text not null default 'mainnet' check (network_type in ('mainnet', 'testnet')),
  native_name text not null,
  native_symbol text not null,
  native_decimals smallint not null check (native_decimals between 0 and 36),
  native_logo_url text,
  coingecko_platform_id text,
  coingecko_native_id text,
  geckoterminal_network_id text,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger chains_updated_at before update on public.chains
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------- assets
create table public.assets (
  id uuid primary key default gen_random_uuid(),
  -- canonical identity: "<chain_id>:<lowercase 0x address>" or "<chain_id>:native"
  identity_key text not null unique,
  chain_id bigint not null references public.chains (chain_id) on update cascade on delete restrict,
  asset_type text not null check (asset_type in ('native', 'token')),
  contract_address text,
  name text,
  symbol text,
  decimals smallint check (decimals between 0 and 255),
  description text,
  logo_url text,
  logo_path text,
  logo_source_url text,
  website_url text,
  twitter_url text,
  telegram_url text,
  discord_url text,
  github_url text,
  other_links jsonb not null default '{}'::jsonb check (jsonb_typeof(other_links) = 'object'),
  coingecko_id text,
  metadata_sources text[] not null default '{}',
  verification_status text not null default 'unverified'
    check (verification_status in ('unverified', 'verified', 'rejected')),
  has_override boolean not null default false,
  metadata_fetched_at timestamptz,
  next_refresh_at timestamptz not null default now(),
  refresh_failures integer not null default 0,
  last_refresh_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint assets_identity_shape check (
    (asset_type = 'native' and contract_address is null and identity_key = chain_id::text || ':native')
    or
    (asset_type = 'token' and contract_address ~ '^0x[0-9a-f]{40}$'
      and identity_key = chain_id::text || ':' || contract_address)
  )
);
create trigger assets_updated_at before update on public.assets
  for each row execute function public.set_updated_at();
create index assets_chain_idx on public.assets (chain_id);
create index assets_next_refresh_idx on public.assets (next_refresh_at)
  where verification_status <> 'rejected';
create index assets_verification_idx on public.assets (verification_status, created_at desc);
create index assets_symbol_lower_idx on public.assets (lower(symbol));
create index assets_name_trgm_idx on public.assets using gin (lower(name) extensions.gin_trgm_ops);
create index assets_address_prefix_idx on public.assets (contract_address text_pattern_ops);
create index assets_coingecko_idx on public.assets (coingecko_id) where coingecko_id is not null;

-- ---------------------------------------------------------------- provider mappings
create table public.asset_provider_mappings (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.assets (id) on delete cascade,
  provider text not null check (char_length(provider) between 2 and 40),
  provider_ref text not null check (char_length(provider_ref) between 1 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (asset_id, provider)
);
create trigger mappings_updated_at before update on public.asset_provider_mappings
  for each row execute function public.set_updated_at();
create index mappings_provider_ref_idx on public.asset_provider_mappings (provider, provider_ref);

-- ---------------------------------------------------------------- overrides
create table public.asset_overrides (
  asset_id uuid primary key references public.assets (id) on delete cascade,
  fields jsonb not null check (jsonb_typeof(fields) = 'object'),
  reason text not null,
  approved_by text not null,
  approved_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- refresh jobs
create table public.refresh_jobs (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid references public.assets (id) on delete cascade,
  asset_key text not null,
  chain_id bigint not null,
  contract_address text,
  job_type text not null check (job_type in ('refresh', 'discover', 'manual')),
  status text not null default 'pending' check (status in ('pending', 'running', 'completed', 'failed')),
  priority integer not null default 10,
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  last_error text,
  run_after timestamptz not null default now(),
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz
);
-- At most one active (pending/running) job per asset: prevents duplicate refresh work.
create unique index refresh_jobs_active_key_idx on public.refresh_jobs (asset_key)
  where status in ('pending', 'running');
create index refresh_jobs_claim_idx on public.refresh_jobs (priority desc, created_at)
  where status = 'pending';
create index refresh_jobs_status_idx on public.refresh_jobs (status, created_at desc);

-- ---------------------------------------------------------------- unknown token cooldowns
create table public.discovery_misses (
  asset_key text primary key,
  chain_id bigint not null,
  contract_address text not null,
  attempts integer not null default 1,
  last_attempt_at timestamptz not null default now(),
  next_attempt_at timestamptz not null
);
create index discovery_misses_next_idx on public.discovery_misses (next_attempt_at);

-- ---------------------------------------------------------------- provider health
create table public.provider_health (
  provider text primary key,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  last_error text,
  consecutive_failures integer not null default 0,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- api keys
create table public.api_keys (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  key_prefix text not null unique check (key_prefix ~ '^[a-f0-9]{12}$'),
  key_hash text not null check (key_hash ~ '^[a-f0-9]{64}$'),  -- HMAC-SHA256(pepper, key)
  scopes text[] not null default '{read}' check (scopes <@ array['read', 'admin']::text[]),
  is_active boolean not null default true,
  expires_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- audit log
create table public.audit_log (
  id bigint generated always as identity primary key,
  actor text not null,
  action text not null,
  target text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_log_created_idx on public.audit_log (created_at desc);

-- ---------------------------------------------------------------- rate limiting
create table public.rate_limit_counters (
  key text not null,
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (key, window_start)
);

create or replace function public.rate_limit_hit(
  p_key text, p_limit integer, p_window_seconds integer, p_cost integer default 1
) returns table (allowed boolean, remaining integer, reset_at timestamptz)
language plpgsql as $$
declare
  v_window_start timestamptz;
  v_hits integer;
begin
  if p_window_seconds <= 0 or p_limit <= 0 or p_cost <= 0 then
    raise exception 'invalid rate limit arguments';
  end if;
  v_window_start := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  insert into public.rate_limit_counters as c (key, window_start, hits)
  values (p_key, v_window_start, p_cost)
  on conflict (key, window_start) do update set hits = c.hits + p_cost
  returning c.hits into v_hits;
  return query select v_hits <= p_limit, greatest(p_limit - v_hits, 0),
    v_window_start + make_interval(secs => p_window_seconds);
end $$;

create or replace function public.rate_limit_cleanup() returns integer
language plpgsql as $$
declare v_count integer;
begin
  delete from public.rate_limit_counters where window_start < now() - interval '1 day';
  get diagnostics v_count = row_count;
  delete from public.discovery_misses where next_attempt_at < now() - interval '30 days';
  return v_count;
end $$;

-- ---------------------------------------------------------------- job queue functions
create or replace function public.enqueue_stale_assets(p_limit integer) returns integer
language plpgsql as $$
declare v_count integer;
begin
  with stale as (
    select a.id, a.identity_key, a.chain_id, a.contract_address, a.verification_status,
           a.asset_type, a.coingecko_id
    from public.assets a
    join public.chains c on c.chain_id = a.chain_id and c.is_active
    where a.next_refresh_at <= now() and a.verification_status <> 'rejected'
    order by (a.verification_status = 'verified') desc, a.next_refresh_at asc
    limit greatest(p_limit, 0)
  ), ins as (
    insert into public.refresh_jobs (asset_id, asset_key, chain_id, contract_address, job_type, priority)
    select id, identity_key, chain_id, contract_address, 'refresh',
      case when verification_status = 'verified' then 100
           when asset_type = 'native' or coingecko_id is not null then 50
           else 10 end
    from stale
    on conflict (asset_key) where status in ('pending', 'running') do nothing
    returning 1
  )
  select count(*) into v_count from ins;
  return v_count;
end $$;

create or replace function public.claim_refresh_jobs(p_limit integer, p_stuck_after_seconds integer default 600)
returns setof public.refresh_jobs
language plpgsql as $$
begin
  -- Jobs whose worker died (e.g. function timeout) are returned to the queue.
  update public.refresh_jobs
     set status = 'pending', last_error = 'reclaimed after worker timeout'
   where status = 'running' and started_at < now() - make_interval(secs => p_stuck_after_seconds);

  return query
  with picked as (
    select id from public.refresh_jobs
    where status = 'pending' and run_after <= now()
    order by priority desc, created_at asc
    limit greatest(p_limit, 0)
    for update skip locked
  )
  update public.refresh_jobs j
     set status = 'running', started_at = now(), attempts = j.attempts + 1
    from picked
   where j.id = picked.id
  returning j.*;
end $$;

-- ---------------------------------------------------------------- search
create or replace function public.search_assets(
  p_query text, p_chain_id bigint default null, p_limit integer default 20, p_offset integer default 0
) returns table (asset jsonb, total_count bigint)
language sql stable set search_path = public, extensions as $$
  with q as (
    select lower(trim(p_query)) as t,
           replace(replace(replace(lower(trim(p_query)), '\', '\\'), '%', '\%'), '_', '\_') as esc
  )
  select to_jsonb(a) as asset, count(*) over () as total_count
  from public.assets a
  cross join q
  where a.verification_status <> 'rejected'
    and exists (select 1 from public.chains c where c.chain_id = a.chain_id and c.is_active)
    and (p_chain_id is null or a.chain_id = p_chain_id)
    and (
      lower(a.symbol) = q.t
      or lower(a.symbol) like q.esc || '%'
      or lower(a.name) like '%' || q.esc || '%'
      or a.contract_address like q.esc || '%'
    )
  order by (lower(a.symbol) = q.t) desc,
           (a.verification_status = 'verified') desc,
           (lower(a.name) = q.t) desc,
           a.name asc nulls last, a.id asc
  limit least(greatest(p_limit, 1), 100) offset greatest(p_offset, 0)
$$;

-- ---------------------------------------------------------------- lock everything down
alter table public.chains enable row level security;
alter table public.assets enable row level security;
alter table public.asset_provider_mappings enable row level security;
alter table public.asset_overrides enable row level security;
alter table public.refresh_jobs enable row level security;
alter table public.discovery_misses enable row level security;
alter table public.provider_health enable row level security;
alter table public.api_keys enable row level security;
alter table public.audit_log enable row level security;
alter table public.rate_limit_counters enable row level security;

revoke all on function public.rate_limit_hit(text, integer, integer, integer) from public, anon, authenticated;
revoke all on function public.rate_limit_cleanup() from public, anon, authenticated;
revoke all on function public.enqueue_stale_assets(integer) from public, anon, authenticated;
revoke all on function public.claim_refresh_jobs(integer, integer) from public, anon, authenticated;
revoke all on function public.search_assets(text, bigint, integer, integer) from public, anon, authenticated;

-- ---------------------------------------------------------------- storage bucket for logos
-- Public read (objects are served via CDN); writes only happen with the service-role key.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('coin-logos', 'coin-logos', true, 1048576, array['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
