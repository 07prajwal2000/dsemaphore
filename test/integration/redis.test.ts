import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DSemaphore, redisTransport } from '../../src';
import { sleep } from '../../src/sleep';
import { transportContract } from '../contract';

// Same suite against Redis and Valkey.
describe.each(['redis:7-alpine', 'valkey/valkey:8-alpine'])('%s', (image) => {
  let container: StartedTestContainer;
  let url: string;

  beforeAll(async () => {
    container = await new GenericContainer(image)
      .withExposedPorts(6379)
      .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
      .start();
    url = `redis://${container.getHost()}:${container.getMappedPort(6379)}`;
  }, 120_000);
  afterAll(async () => {
    await container?.stop();
  });

  // Parent beforeAll (container start) runs before the contract's own beforeAll.
  transportContract(`redisTransport (${image})`, () => redisTransport(url));

  describe('connection forms', () => {
    it('accepts a URL', async () => {
      const t = redisTransport(url);
      expect(await t.tryAcquire(`u-${randomUUID()}`, 'a', 1, 1_000)).toBe(true);
      await t.close();
    });

    it('accepts ioredis options', async () => {
      const t = redisTransport({ host: container.getHost(), port: container.getMappedPort(6379) });
      expect(await t.tryAcquire(`o-${randomUUID()}`, 'a', 1, 1_000)).toBe(true);
      await t.close();
    });

    it('accepts an existing client and does not close it', async () => {
      const client = new Redis(url);
      const t = redisTransport(client);
      expect(await t.tryAcquire(`c-${randomUUID()}`, 'a', 1, 1_000)).toBe(true);
      await t.close();
      expect(await client.ping()).toBe('PONG');
      client.disconnect();
    });
  });

  describe('DSemaphore over Redis', () => {
    it('limits concurrency across independent clients (simulated processes)', async () => {
      const name = `shared-${randomUUID()}`;
      const sems = Array.from({ length: 4 }, () => new DSemaphore({ name, limit: 3, transport: redisTransport(url), pollMs: 10 }));
      let active = 0, peak = 0;
      await Promise.all(
        Array.from({ length: 24 }, async (_, i) => {
          const p = await sems[i % sems.length].acquire();
          peak = Math.max(peak, ++active);
          await sleep(20);
          active--;
          await p.release();
        }),
      );
      expect(peak).toBe(3);
    }, 30_000);

    it('keys are namespaced and the key expires once empty', async () => {
      const name = `ttl-${randomUUID()}`;
      const client = new Redis(url);
      const s = new DSemaphore({ name, limit: 1, transport: redisTransport(client), leaseMs: 200 });
      await s.tryAcquire();
      expect(await client.exists(`dsemaphore:${name}`)).toBe(1);
      await sleep(400);
      expect(await client.exists(`dsemaphore:${name}`)).toBe(0);
      client.disconnect();
    });
  });
});
