---
title: Guide
---

# Guide

`dsemaphore` limits how many callers, across any number of processes or machines, can be inside a critical section at once. It mirrors C#'s `SemaphoreSlim`: a fixed number of slots, `acquire` waits for one, `tryAcquire` doesn't.

## Install

```sh
npm install dsemaphore
```

Requires Node 20+ and, for the built-in transport, Redis or Valkey 5+.

## Acquire and release

```ts
import { DSemaphore, redisTransport } from 'dsemaphore';

const transport = redisTransport('redis://localhost:6379');
const sem = new DSemaphore({ name: 'image-resize', limit: 5, transport });

const permit = await sem.acquire();
try {
  // at most 5 of these run at once, cluster-wide
} finally {
  await permit.release(); // or: await sem.release(permit)
}
```

Every process that uses the same `name` (and the same Redis) shares the same 5 slots. Always release in a `finally`.

- {@link DSemaphore.acquire | acquire} waits for a slot. Pass `timeoutMs` to give up with a {@link TimeoutError}, and/or an `AbortSignal` to cancel.
- {@link DSemaphore.tryAcquire | tryAcquire} never waits: it returns a {@link Permit}, or `null` when the semaphore is full.
- {@link DSemaphore.currentCount | currentCount} returns the number of free slots, like `SemaphoreSlim.CurrentCount`. It is a snapshot; another process can take the slot right after you read it. Use `tryAcquire` when you need a guarantee.

## Connecting to Redis or Valkey

{@link redisTransport} accepts any of:

```ts
redisTransport('redis://user:password@host:6379/0'); // URL (rediss:// for TLS)
redisTransport({ host: 'host', port: 6379, password: 'secret' }); // ioredis options
redisTransport(existingIoredisClient); // reuse your own client
```

The transport only closes a connection it created itself. With a client you passed in, closing it stays your job. Valkey needs no special handling.

Keys are stored as `dsemaphore:<name>`; pass a second argument to change the prefix.

## Leases: what happens when a holder crashes

Every slot is a lease. If a process dies without releasing, its slot is given back after `leaseMs` (default 30 seconds), so permits can't leak forever.

The flip side: **work that runs longer than `leaseMs` loses its slot**, and the semaphore may then admit more than `limit` callers. Set `leaseMs` comfortably above your longest critical section. There is no automatic renewal.

Expiry is judged by the Redis server clock, so skewed client clocks don't matter.

## Waiting behaviour

`acquire` retries every `pollMs` (default 50 ms, with jitter) until a slot frees up. Waiters are not served in FIFO order. For very high contention, raise `pollMs` to reduce load on Redis.

## Errors

| Thrown | When |
| --- | --- |
| `RangeError` | constructor given a non-integer or `< 1` `limit`, or a non-positive `leaseMs`/`pollMs` |
| {@link TimeoutError} | `acquire` hit `timeoutMs` |
| the signal's `reason` | `acquire`'s `AbortSignal` aborted |
| ioredis errors | the connection to Redis failed; they propagate unchanged |

## Using another backend

The storage layer is the {@link Transport} interface. See [Custom transports](./custom-transport.md).
