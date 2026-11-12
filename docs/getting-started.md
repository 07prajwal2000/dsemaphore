---
title: Getting started
---

# Getting started

This page takes you from zero to a working distributed semaphore in a few minutes.

## 1. Install

Package: [dsemaphore on npm](https://www.npmjs.com/package/dsemaphore).

```sh
npm install dsemaphore
# or
yarn add dsemaphore
pnpm add dsemaphore
```

Requirements:

- Node.js 20 or later
- A Redis or Valkey server, version 5 or later (`ioredis` is installed for you)

TypeScript types are bundled; there is nothing extra to install.

## 2. Start Redis

If you don't have one handy, run it with Docker:

```sh
docker run --rm -p 6379:6379 redis:7-alpine
```

Valkey works the same way (`valkey/valkey:8-alpine`).

## 3. Your first semaphore

Save this as `demo.mts`:

```ts
import { DSemaphore, redisTransport } from 'dsemaphore';

const transport = redisTransport('redis://localhost:6379');
const sem = new DSemaphore({ name: 'demo', limit: 2, transport });

async function job(id: number) {
  const permit = await sem.acquire();
  try {
    console.log(`job ${id} started`);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    console.log(`job ${id} done`);
  } finally {
    await permit.release();
  }
}

await Promise.all([1, 2, 3, 4, 5, 6].map(job));
await transport.close();
```

Run it:

```sh
npx tsx demo.mts
```

Six jobs start at once, but only two run at a time: you will see two `started` lines, then two `done` lines, and so on.

## 4. See it work across processes

Open two terminals and run `npx tsx demo.mts` in both at the same moment. All twelve jobs now share the same two slots, so you still never see more than two running, even though they are in different processes. That is the difference from an in-process semaphore.

The only things that tie the processes together are the semaphore `name` (`'demo'`) and the Redis server.

## Common patterns

### Wrap work in a helper

```ts
import type { DSemaphore } from 'dsemaphore';

async function withPermit<T>(sem: DSemaphore, work: () => Promise<T>): Promise<T> {
  const permit = await sem.acquire();
  try {
    return await work();
  } finally {
    await permit.release();
  }
}

const result = await withPermit(sem, () => callRateLimitedApi());
```

### Skip work when the semaphore is full

`tryAcquire` never waits. It returns `null` when there is no free slot, which is handy for shedding load:

```ts
const permit = await sem.tryAcquire();
if (!permit) return respondBusy(); // try again later

try {
  await doWork();
} finally {
  await permit.release();
}
```

### Give up after a timeout, or cancel

```ts
import { TimeoutError } from 'dsemaphore';

try {
  const permit = await sem.acquire({ timeoutMs: 5_000 });
  // ...
} catch (err) {
  if (err instanceof TimeoutError) {
    // waited 5 seconds, no slot became free
  } else {
    throw err;
  }
}
```

You can also pass an `AbortSignal` (`sem.acquire({ signal })`). When it aborts, `acquire` rejects with the signal's reason.

### Check how many slots are free

```ts
const free = await sem.currentCount(); // like SemaphoreSlim.CurrentCount
```

This is a snapshot for monitoring and logging. Another process can take the slot right after you read it, so use `tryAcquire` when you need a guarantee.

### Shut down cleanly

```ts
await transport.close();
```

This closes the Redis connection if the transport created it. If you passed in your own ioredis client, closing it stays your responsibility.

## Choosing `leaseMs`

Every slot is a lease that lasts `leaseMs` (default 30 seconds). If a process crashes while holding a slot, the slot comes back after the lease ends. Set it comfortably longer than your longest critical section: work that outlives its lease loses the slot, and the semaphore may then admit more than `limit` callers.

```ts
new DSemaphore({ name: 'reports', limit: 3, transport, leaseMs: 5 * 60_000 });
```

## Next steps

- [Guide](./guide.md): leases, waiting behaviour, errors, connection options
- [Custom transports](./custom-transport.md): back the semaphore with something other than Redis
- The API reference, generated from the source, is linked from the sidebar
