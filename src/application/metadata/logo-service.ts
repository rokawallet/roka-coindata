import { createHash } from 'node:crypto';
import type { ImageDownloader, LogoStorage } from '@/domain/ports';
import type { Logger } from '@/infrastructure/logging/logger';
import { serializeError } from '@/infrastructure/logging/logger';

export interface LogoState {
  logo_url: string | null;
  logo_path: string | null;
  logo_source_url: string | null;
}

export const EMPTY_LOGO: LogoState = { logo_url: null, logo_path: null, logo_source_url: null };

/**
 * Mirrors logos into Supabase Storage at deterministic paths: `{chain_id}/{address|native}.{ext}`.
 * An existing valid logo is never replaced unless the source URL changed and the new image
 * downloaded and validated successfully; failures keep the current logo.
 */
export class LogoService {
  constructor(
    private readonly downloader: ImageDownloader,
    private readonly storage: LogoStorage,
    private readonly logger: Logger,
  ) {}

  async ensure(args: {
    chainId: number;
    identifier: string;
    sourceUrl: string | null;
    current: LogoState;
  }): Promise<LogoState> {
    const { sourceUrl, current } = args;
    if (!sourceUrl) return current;
    if (current.logo_url && current.logo_source_url === sourceUrl) return current;

    try {
      const image = await this.downloader.download(sourceUrl);
      const path = `${args.chainId}/${args.identifier}.${image.extension}`;
      const publicUrl = await this.storage.put(path, image.bytes, image.contentType);
      const version = createHash('sha256').update(image.bytes).digest('hex').slice(0, 10);
      if (current.logo_path && current.logo_path !== path) {
        await this.storage.remove(current.logo_path).catch((error: unknown) => {
          this.logger.warn('failed to remove replaced logo', serializeError(error));
        });
      }
      return { logo_url: `${publicUrl}?v=${version}`, logo_path: path, logo_source_url: sourceUrl };
    } catch (error) {
      this.logger.warn('logo mirroring failed; keeping current logo', {
        chain_id: args.chainId,
        identifier: args.identifier,
        ...serializeError(error),
      });
      return current;
    }
  }
}
