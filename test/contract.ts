import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Transport } from '../src';
import { sleep } from '../src/sleep';

const take = (t: Transport, key: string, limit: number, lease = 5_000) => t.tryAcquire(key, randomUUID(), limit, lease);

/** Behaviour every Transport implementation must satisfy. */
export function transportContract(name: string, make: () => Transport | Promise<Transport>) {
  describe(`Transport contract: ${name}`, () => {
    let t: Transport;
    beforeAll(async () => {
      t = await make();
    });
    afterAll(async () => t?.close());
    const key = () => `k-${randomUUID()}`;

    it('grants up to limit, then refuses', async () => {
      const k = key();
      expect([await take(t, k, 2), await take(t, k, 2), await take(t, k, 2)]).toEqual([true, true, false]);
    });

    it('release frees a slot; unknown id releases nothing', async () => {
      const k = key();
      await t.tryAcquire(k, 'a', 1, 5_000);
      expect(await take(t, k, 1)).toBe(false);
      expect(await t.release(k, 'nope')).toBe(false);
      expect(await t.release(k, 'a')).toBe(true);
      expect(await take(t, k, 1)).toBe(true);
    });

    it('expired leases free their slot', async () => {
      const k = key();
      await take(t, k, 1, 100);
      expect(await take(t, k, 1)).toBe(false);
      await sleep(250);
      expect(await take(t, k, 1)).toBe(true);
    });

    it('a short lease never shortens another holder\'s longer lease', async () => {
      const k = key();
      await take(t, k, 2, 3_000);
      await take(t, k, 2, 100);
      await sleep(300);
      expect(await take(t, k, 2)).toBe(true); // short one expired -> 1 free
      expect(await take(t, k, 2)).toBe(false); // long one still holds
    });

    it('count reports live holders only', async () => {
      const k = key();
      expect(await t.count(k)).toBe(0);
      await t.tryAcquire(k, 'a', 3, 5_000);
      await t.tryAcquire(k, 'b', 3, 100);
      expect(await t.count(k)).toBe(2);
      await sleep(250);
      expect(await t.count(k)).toBe(1);
      await t.release(k, 'a');
      expect(await t.count(k)).toBe(0);
    });

    it('keys are independent', async () => {
      expect(await take(t, key(), 1)).toBe(true);
    });

    it('never exceeds limit under concurrent acquires', async () => {
      const k = key();
      const results = await Promise.all(Array.from({ length: 50 }, () => take(t, k, 5)));
      expect(results.filter(Boolean)).toHaveLength(5);
    });
  });
}
