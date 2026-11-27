import { ProviderRateLimitedError, ProviderUnavailableError } from '@/domain/providers';
import { sleep } from '@/utils/async';

export interface JsonRequestOptions {
  headers?: Record<string, string>;
  timeoutMs: number;
  /** Maximum retries for network errors, timeouts and 5xx. Rate limits (429) are never retried. */
  retries: number;
}

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

/**
 * GET JSON with timeout and bounded retries. Returns null on HTTP 404.
 * Throws ProviderRateLimitedError on 429 (no retry) and ProviderUnavailableError otherwise.
 */
export async function getJson(
  url: string,
  options: JsonRequestOptions,
  fetchImpl: typeof fetch = fetch,
): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    let failure = new ProviderUnavailableError('Upstream request failed', true);
    try {
      const response = await fetchImpl(url, {
        method: 'GET',
        headers: { accept: 'application/json', ...options.headers },
        signal: AbortSignal.timeout(options.timeoutMs),
        redirect: 'error',
        cache: 'no-store',
      });
      if (response.status === 404) return null;
      if (response.status === 429) throw new ProviderRateLimitedError(parseRetryAfter(response.headers.get('retry-after')));
      if (response.ok) return await readJson(response);
      failure = new ProviderUnavailableError(`Upstream responded with HTTP ${response.status}`, response.status >= 500);
    } catch (error) {
      if (error instanceof ProviderRateLimitedError) throw error;
      if (error instanceof ProviderUnavailableError) failure = error;
    }
    if (!failure.retryable || attempt >= options.retries) throw failure;
    await sleep(250 * 2 ** attempt + Math.floor(Math.random() * 100));
  }
}

async function readJson(response: Response): Promise<unknown> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    throw new ProviderUnavailableError('Upstream response too large', false);
  }
  const text = await response.text();
  if (text.length > MAX_RESPONSE_BYTES) throw new ProviderUnavailableError('Upstream response too large', false);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ProviderUnavailableError('Upstream returned invalid JSON', false);
  }
}
