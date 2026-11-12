import Redis, { type RedisOptions } from 'ioredis';
import type { ReleaseTarget, Transport } from './transport';

const DEFAULT_KEY_PREFIX = 'dsemaphore:';

// Holders live in a sorted set: member = permit id, score = lease expiry (ms).
// `now` comes from the Redis server clock, so client clock skew can't break leases.
// Needs Redis/Valkey >= 5 (scripts may write after calling TIME).
const SERVER_NOW_MS = `
local t = redis.call('TIME')
local now = t[1] * 1000 + math.floor(t[2] / 1000)`;

// KEYS[1] = set, ARGV = id, limit, leaseMs. Returns 1 if granted, 0 if full.
const ACQUIRE_SCRIPT =
  SERVER_NOW_MS +
  `
local id, limit, leaseMs = ARGV[1], tonumber(ARGV[2]), tonumber(ARGV[3])
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now)
if redis.call('ZCARD', KEYS[1]) >= limit then return 0 end
redis.call('ZADD', KEYS[1], now + leaseMs, id)
-- the key must outlive the longest lease, not just this holder's
local latestExpiry = tonumber(redis.call('ZRANGE', KEYS[1], -1, -1, 'WITHSCORES')[2])
redis.call('PEXPIRE', KEYS[1], latestExpiry - now)
return 1`;

// KEYS[1] = set. Returns the number of unexpired holders.
const COUNT_SCRIPT =
  SERVER_NOW_MS +
  `
return redis.call('ZCOUNT', KEYS[1], '(' .. now, '+inf')`;

// KEYS[1] = set. Deletes it and returns the number of unexpired holders it had.
const RELEASE_ALL_SCRIPT =
  SERVER_NOW_MS +
  `
local live = redis.call('ZCOUNT', KEYS[1], '(' .. now, '+inf')
redis.call('DEL', KEYS[1])
return live`;

/** `Redis` plus the scripted commands registered by `RedisTransport`. */
type ScriptedRedis = Redis & {
  dsemAcquire(key: string, id: string, limit: number, leaseMs: number): Promise<number>;
  dsemCount(key: string): Promise<number>;
  dsemReleaseAll(key: string): Promise<number>;
};

export type RedisConnection = Redis | string | RedisOptions;

const isClient = (conn: Redis | RedisOptions): conn is Redis => 'defineCommand' in conn;

function resolveClient(conn: RedisConnection): { client: Redis; owned: boolean } {
  if (typeof conn === 'string') return { client: new Redis(conn), owned: true };
  if (isClient(conn)) return { client: conn, owned: false };
  return { client: new Redis(conn), owned: true };
}

/** Make a string match literally inside a SCAN MATCH glob. */
const escapeGlob = (s: string) => s.replace(/[\\*?[\]]/g, '\\$&');

class RedisTransport implements Transport {
  private readonly client: ScriptedRedis;
  private readonly ownsClient: boolean;

  constructor(conn: RedisConnection, private readonly keyPrefix: string) {
    const { client, owned } = resolveClient(conn);
    client.defineCommand('dsemAcquire', { numberOfKeys: 1, lua: ACQUIRE_SCRIPT });
    client.defineCommand('dsemCount', { numberOfKeys: 1, lua: COUNT_SCRIPT });
    client.defineCommand('dsemReleaseAll', { numberOfKeys: 1, lua: RELEASE_ALL_SCRIPT });
    this.client = client as ScriptedRedis;
    this.ownsClient = owned;
  }

  async tryAcquire(key: string, id: string, limit: number, leaseMs: number): Promise<boolean> {
    return (await this.client.dsemAcquire(this.redisKey(key), id, limit, leaseMs)) === 1;
  }

  async release(key: string, id: string): Promise<boolean> {
    return (await this.client.zrem(this.redisKey(key), id)) === 1;
  }

  count(key: string): Promise<number> {
    return this.client.dsemCount(this.redisKey(key));
  }

  async releaseAll(target: ReleaseTarget): Promise<number> {
    if ('key' in target) return this.client.dsemReleaseAll(this.redisKey(target.key));

    let freed = 0;
    const match = escapeGlob(this.redisKey(target.prefix)) + '*';
    for await (const keys of this.client.scanStream({ match, count: 100 })) {
      for (const key of keys as string[]) freed += await this.client.dsemReleaseAll(key);
    }
    return freed;
  }

  async close(): Promise<void> {
    if (this.ownsClient) await this.client.quit();
  }

  private redisKey(key: string): string {
    return this.keyPrefix + key;
  }
}

/**
 * Redis/Valkey transport. Pass an existing ioredis client (you keep ownership),
 * a connection URL (`redis://user:pass@host:6379/0`, `rediss://` for TLS), or ioredis options.
 */
export function redisTransport(conn: RedisConnection, keyPrefix = DEFAULT_KEY_PREFIX): Transport {
  return new RedisTransport(conn, keyPrefix);
}
