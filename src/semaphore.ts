import { randomUUID } from 'node:crypto';
import { sleep } from './sleep';
import type { Transport } from './transport';

const DEFAULT_LEASE_MS = 30_000;
const DEFAULT_POLL_MS = 50;

export class TimeoutError extends Error {
  override name = 'TimeoutError';
}

/** A held slot. Keep it and release it when done. */
export interface Permit {
  readonly id: string;
  release(): Promise<boolean>;
}

export interface DSemaphoreOptions {
  /** Semaphore identity; every process using the same name shares the same slots. */
  name: string;
  /** Max concurrent holders across all processes (SemaphoreSlim's maxCount). */
  limit: number;
  transport: Transport;
  /** A holder that never releases (crash) loses its slot after this long. Default 30s. */
  leaseMs?: number;
  /** Base retry interval while waiting in `acquire`. Default 50ms. */
  pollMs?: number;
}

export interface AcquireOptions {
  /** Reject with TimeoutError after this long. Default: wait forever. */
  timeoutMs?: number;
  signal?: AbortSignal;
}

export class DSemaphore {
  private readonly name: string;
  private readonly limit: number;
  private readonly transport: Transport;
  private readonly leaseMs: number;
  private readonly pollMs: number;

  constructor({ name, limit, transport, leaseMs = DEFAULT_LEASE_MS, pollMs = DEFAULT_POLL_MS }: DSemaphoreOptions) {
    if (!Number.isInteger(limit) || limit < 1) throw new RangeError('limit must be an integer >= 1');
    if (!(leaseMs > 0)) throw new RangeError('leaseMs must be > 0');
    if (!(pollMs > 0)) throw new RangeError('pollMs must be > 0');
    this.name = name;
    this.limit = limit;
    this.transport = transport;
    this.leaseMs = leaseMs;
    this.pollMs = pollMs;
  }

  /** Take a slot now, or resolve null if the semaphore is full. */
  async tryAcquire(): Promise<Permit | null> {
    const id = randomUUID();
    const granted = await this.transport.tryAcquire(this.name, id, this.limit, this.leaseMs);
    return granted ? this.toPermit(id) : null;
  }

  /** Wait for a slot. Rejects with TimeoutError / the signal's reason. */
  async acquire({ timeoutMs, signal }: AcquireOptions = {}): Promise<Permit> {
    const deadline = timeoutMs === undefined ? Infinity : Date.now() + timeoutMs;
    for (;;) {
      signal?.throwIfAborted();
      const permit = await this.tryAcquire();
      if (permit) return permit;

      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) throw new TimeoutError(`could not acquire "${this.name}" within ${timeoutMs}ms`);
      await sleep(Math.min(this.pollDelayMs(), remainingMs), signal);
    }
  }

  /** Slots currently free (like SemaphoreSlim.CurrentCount). A snapshot: may be stale by the time you act on it. */
  async currentCount(): Promise<number> {
    const held = await this.transport.count(this.name);
    return Math.max(0, this.limit - held);
  }

  /** Free a permit (same as `permit.release()`). */
  release(permit: Permit): Promise<boolean> {
    return permit.release();
  }

  private toPermit(id: string): Permit {
    return { id, release: () => this.transport.release(this.name, id) };
  }

  // ponytail: polling with jitter; add pub/sub wakeups in the transport if latency/load matters
  private pollDelayMs(): number {
    return this.pollMs * (0.5 + Math.random());
  }
}
