import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { Agent, fetch as undiciFetch } from 'undici';
import type { ImageDownloader } from '@/domain/ports';
import { assertSafeHttpsUrl, guardedLookup } from '@/security/url-guard';
import { sniffImage } from '@/security/image';

export class ImageDownloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImageDownloadError';
  }
}

export interface DownloaderOptions {
  maxBytes: number;
  timeoutMs: number;
  maxRedirects?: number;
}

/**
 * Downloads images from untrusted URLs.
 * Defences: https only; DNS answers validated at connect time (no private/loopback/metadata ranges);
 * redirects followed manually and re-validated; hard size cap while streaming; total timeout;
 * format decided by magic bytes (png/jpeg/gif/webp only).
 */
export class SafeImageDownloader implements ImageDownloader {
  private readonly agent = new Agent({ connect: { lookup: guardedLookup, timeout: 5000 } });

  constructor(private readonly options: DownloaderOptions) {}

  async download(sourceUrl: string): Promise<{ bytes: Uint8Array; contentType: string; extension: string }> {
    const signal = AbortSignal.timeout(this.options.timeoutMs);
    const maxRedirects = this.options.maxRedirects ?? 3;
    let current = assertSafeHttpsUrl(sourceUrl);

    for (let hop = 0; hop <= maxRedirects; hop++) {
      const response = await undiciFetch(current, {
        dispatcher: this.agent,
        redirect: 'manual',
        signal,
        headers: { accept: 'image/png,image/jpeg,image/webp,image/gif', 'user-agent': 'roka-coins-data/1.0' },
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        await response.body?.cancel();
        if (!location) throw new ImageDownloadError('Redirect without location');
        current = assertSafeHttpsUrl(new URL(location, current).toString());
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new ImageDownloadError(`Image host responded with HTTP ${response.status}`);
      }

      const declared = Number(response.headers.get('content-length'));
      if (Number.isFinite(declared) && declared > this.options.maxBytes) {
        await response.body?.cancel();
        throw new ImageDownloadError('Image is too large');
      }
      const bytes = await this.readCapped(response.body);
      const type = sniffImage(bytes);
      if (!type) throw new ImageDownloadError('Unsupported or invalid image format');
      return { bytes, contentType: type.contentType, extension: type.extension };
    }
    throw new ImageDownloadError('Too many redirects');
  }

  private async readCapped(body: NodeReadableStream<Uint8Array> | null): Promise<Uint8Array> {
    if (!body) throw new ImageDownloadError('Empty response body');
    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > this.options.maxBytes) {
        await reader.cancel();
        throw new ImageDownloadError('Image is too large');
      }
      chunks.push(value);
    }
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return out;
  }
}
