/** Collapses concurrent calls with the same key into one in-flight promise (per instance). */
export class InflightMap<T> {
  private readonly pending = new Map<string, Promise<T>>();

  run(key: string, task: () => Promise<T>): Promise<T> {
    const existing = this.pending.get(key);
    if (existing) return existing;
    const promise = task().finally(() => this.pending.delete(key));
    this.pending.set(key, promise);
    return promise;
  }
}

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
