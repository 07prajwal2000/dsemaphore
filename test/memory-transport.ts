import type { Transport } from '../src';

/** In-process transport for unit tests — also proves the core works with any backend. */
export class MemoryTransport implements Transport {
  private readonly keys = new Map<string, Map<string, number>>();

  async tryAcquire(key: string, id: string, limit: number, leaseMs: number) {
    const now = Date.now();
    const holders = this.keys.get(key) ?? new Map<string, number>();
    this.keys.set(key, holders);
    for (const [h, expiry] of holders) if (expiry <= now) holders.delete(h);
    if (holders.size >= limit) return false;
    holders.set(id, now + leaseMs);
    return true;
  }

  async release(key: string, id: string) {
    return this.keys.get(key)?.delete(id) ?? false;
  }

  async count(key: string) {
    const now = Date.now();
    return [...(this.keys.get(key)?.values() ?? [])].filter((e) => e > now).length;
  }

  async close() {}
}
