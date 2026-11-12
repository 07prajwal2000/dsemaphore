import { describe, expect, it } from 'vitest';
import { DSemaphore, TimeoutError } from '../../src';
import { sleep } from '../../src/sleep';
import { MemoryTransport } from '../memory-transport';

const make = (limit: number, extra: object = {}) =>
  new DSemaphore({ name: 'test', limit, transport: new MemoryTransport(), pollMs: 5, ...extra });

describe('DSemaphore', () => {
  it('rejects invalid options', () => {
    expect(() => make(0)).toThrow(RangeError);
    expect(() => make(1.5)).toThrow(RangeError);
    expect(() => make(1, { leaseMs: 0 })).toThrow(RangeError);
  });

  it('tryAcquire returns permits until full, then null', async () => {
    const s = make(2);
    const [a, b] = [await s.tryAcquire(), await s.tryAcquire()];
    expect(a && b).toBeTruthy();
    expect(await s.tryAcquire()).toBeNull();
    await s.release(a!);
    expect(await s.tryAcquire()).not.toBeNull();
  });

  it('currentCount tracks free slots', async () => {
    const s = make(2);
    expect(await s.currentCount()).toBe(2);
    const p = (await s.tryAcquire())!;
    expect(await s.currentCount()).toBe(1);
    await s.tryAcquire();
    expect(await s.currentCount()).toBe(0);
    await p.release();
    expect(await s.currentCount()).toBe(1);
  });

  it('permit.release() frees the slot and is idempotent', async () => {
    const s = make(1);
    const p = (await s.tryAcquire())!;
    expect(await p.release()).toBe(true);
    expect(await p.release()).toBe(false);
    expect(await s.tryAcquire()).not.toBeNull();
  });

  it('acquire waits until a slot is released', async () => {
    const s = make(1);
    const held = (await s.tryAcquire())!;
    let got = false;
    const waiting = s.acquire().then((p) => ((got = true), p));
    await sleep(30);
    expect(got).toBe(false);
    await held.release();
    await waiting;
    expect(got).toBe(true);
  });

  it('acquire rejects with TimeoutError', async () => {
    const s = make(1);
    await s.tryAcquire();
    await expect(s.acquire({ timeoutMs: 30 })).rejects.toBeInstanceOf(TimeoutError);
  });

  it('acquire honours AbortSignal (before and while waiting)', async () => {
    const s = make(1);
    await s.tryAcquire();
    await expect(s.acquire({ signal: AbortSignal.abort(new Error('nope')) })).rejects.toThrow('nope');
    const ac = new AbortController();
    const waiting = s.acquire({ signal: ac.signal });
    setTimeout(() => ac.abort(new Error('stop')), 20);
    await expect(waiting).rejects.toThrow('stop');
  });

  it('a crashed holder is recovered after leaseMs', async () => {
    const s = make(1, { leaseMs: 50 });
    await s.tryAcquire(); // never released
    const p = await s.acquire({ timeoutMs: 1_000 });
    expect(p).toBeTruthy();
  });

  it('never runs more than `limit` critical sections at once', async () => {
    const s = make(3);
    let active = 0, peak = 0;
    await Promise.all(
      Array.from({ length: 20 }, async () => {
        const p = await s.acquire();
        peak = Math.max(peak, ++active);
        await sleep(10);
        active--;
        await p.release();
      }),
    );
    expect(peak).toBe(3);
  });
});
