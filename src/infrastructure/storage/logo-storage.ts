import type { SupabaseClient } from '@supabase/supabase-js';
import type { LogoStorage } from '@/domain/ports';
import { InfrastructureError } from '@/errors';

export class SupabaseLogoStorage implements LogoStorage {
  constructor(
    private readonly db: SupabaseClient,
    private readonly bucket: string,
  ) {}

  async put(path: string, bytes: Uint8Array, contentType: string): Promise<string> {
    const { error } = await this.db.storage
      .from(this.bucket)
      .upload(path, bytes, { contentType, upsert: true, cacheControl: '31536000' });
    if (error) throw new InfrastructureError(`storage.upload: ${error.message}`);
    return this.db.storage.from(this.bucket).getPublicUrl(path).data.publicUrl;
  }

  async remove(path: string): Promise<void> {
    const { error } = await this.db.storage.from(this.bucket).remove([path]);
    if (error) throw new InfrastructureError(`storage.remove: ${error.message}`);
  }
}
