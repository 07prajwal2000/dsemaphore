/**
 * Storage backend for DSemaphore. Implement this to support a new backend
 * (Postgres, etcd, DynamoDB, ...) — the public DSemaphore API never changes.
 *
 * Contract:
 * - `tryAcquire` is atomic: concurrent callers never push live holders above `limit`.
 * - A held slot expires on its own after `leaseMs` (so crashed holders can't leak permits).
 * - Time must be judged by one authority (e.g. the server), not by each client's clock.
 */
export interface Transport {
  /** Take a slot for `id` if fewer than `limit` live holders exist. */
  tryAcquire(key: string, id: string, limit: number, leaseMs: number): Promise<boolean>;
  /** Free `id`'s slot. Resolves true if a slot was freed. */
  release(key: string, id: string): Promise<boolean>;
  /** Number of live (unexpired) holders. */
  count(key: string): Promise<number>;
  /** Free resources the transport owns (connections etc.). */
  close(): Promise<void>;
}
