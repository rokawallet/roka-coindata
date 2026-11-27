# Deployment (Vercel + Supabase)

1. **Supabase**: create a project. Apply migrations (`supabase link` + `supabase db push`). Confirm the `coin-logos` bucket exists (public).
2. **Secrets**: generate `API_KEY_PEPPER` and `CRON_SECRET` (`openssl rand -hex 32`).
3. **GitHub**: push this repo.
4. **Vercel**: import the repo (framework: Next.js, package manager pnpm). Add every variable from `.env.example`
   (Production + Preview). Set `APP_BASE_URL` to the production URL. Choose a function region close to your Supabase region.
5. **Cron**: `vercel.json` registers `/api/cron/refresh` daily at 03:00 UTC (the Hobby plan only allows daily crons).
   On Pro, change `schedule` (e.g. `*/15 * * * *`). Vercel sends `Authorization: Bearer $CRON_SECRET` automatically when `CRON_SECRET` is set.
   Each run is bounded by `REFRESH_BATCH_SIZE` and `REFRESH_TIME_BUDGET_MS` (< 60 s `maxDuration`).
6. **API keys**: locally, with `.env.local` pointing at the project: `pnpm create-api-key -- --name "RokaWallet" --scopes read`
   and `pnpm create-api-key -- --name "ops" --scopes admin`. Keys are shown once.
7. **Smoke test**: `BASE_URL=https://<app>.vercel.app ./scripts/smoke-test.sh`.

Notes: no local-disk state is used; rate limits and jobs live in Postgres. `x-real-ip` (set by Vercel) is used for client IPs.
CDN caching (`s-maxage`) applies only to fresh cache hits and the chain list.
