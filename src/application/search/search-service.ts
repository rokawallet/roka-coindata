import type { AssetRepository, ChainRepository, Page } from '@/domain/ports';
import type { Asset } from '@/domain/types';
import { errors } from '@/errors';

/** Database-only search by name, symbol or contract address (prefix). Never calls providers. */
export class SearchService {
  constructor(
    private readonly assets: AssetRepository,
    private readonly chains: ChainRepository,
  ) {}

  /** `chain` may be a numeric chain id or a slug. */
  async search(query: string, chain: string | undefined, page: number, limit: number): Promise<Page<Asset>> {
    let chainId: number | null = null;
    if (chain) {
      const found = /^\d{1,15}$/.test(chain)
        ? await this.chains.findByChainId(Number(chain))
        : await this.chains.findBySlug(chain.toLowerCase());
      if (!found || !found.is_active) throw errors.invalidRequest('Unknown or inactive chain filter');
      chainId = found.chain_id;
    }
    return this.assets.search(query, chainId, page, limit);
  }
}
