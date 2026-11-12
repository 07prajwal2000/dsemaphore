<p align="center">
  <img src="assets/logo.svg" alt="dsemaphore logo" width="96" height="96">
</p>

# dsemaphore

[![npm version](https://img.shields.io/npm/v/dsemaphore.svg)](https://www.npmjs.com/package/dsemaphore)
[![CI](https://github.com/07prajwal2000/dsemaphore/actions/workflows/ci.yml/badge.svg)](https://github.com/07prajwal2000/dsemaphore/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/dsemaphore.svg)](https://github.com/07prajwal2000/dsemaphore/blob/main/LICENSE)
[![types](https://img.shields.io/npm/types/dsemaphore.svg)](https://www.npmjs.com/package/dsemaphore)

**A distributed counting semaphore for Node.js and TypeScript.** Like C#'s `SemaphoreSlim`, but the limit holds across every process and machine that shares it. Redis and Valkey work out of the box, and the storage backend is pluggable.

[npm](https://www.npmjs.com/package/dsemaphore) · [Documentation](https://07prajwal2000.github.io/dsemaphore/) · [API reference](https://07prajwal2000.github.io/dsemaphore/modules.html) · [GitHub](https://github.com/07prajwal2000/dsemaphore)

## Why

An in-process semaphore stops working the moment you run more than one instance. If ten pods share a rate-limited API, a database, or a GPU, each pod needs to know how many *other* pods are already using it. `dsemaphore` keeps that count in Redis (or any other backend you plug in), so "at most 5 at a time" means 5 across the whole fleet.

- `acquire`, `tryAcquire`, `release` and `currentCount`, mirroring `SemaphoreSlim`
- Atomic and safe under concurrency (a single Lua script on the server)
- Crash-safe: slots are leases, so a dead holder can't leak a permit
- Timeouts and `AbortSignal` cancellation
- Written in TypeScript; type definitions are included
- Works with Redis and Valkey, via [ioredis](https://github.com/redis/ioredis)
- Transport is an interface, so other backends can be added without changing the API

## Install

```sh
npm install dsemaphore
```

```sh
yarn add dsemaphore
pnpm add dsemaphore
```

Requires Node.js 20 or later and Redis or Valkey 5 or later. `ioredis` is installed as a dependency.

## Quick start

```ts
import { DSemaphore, redisTransport } from 'dsemaphore';

const transport = redisTransport('redis://localhost:6379');
const sem = new DSemaphore({ name: 'image-resize', limit: 5, transport });

const permit = await sem.acquire({ timeoutMs: 10_000 });
try {
  // at most 5 of these run at once, across all processes
} finally {
  await permit.release();
}

await transport.close();
```

Every process that uses the same `name` and the same Redis shares the same 5 slots. Always release in a `finally`.

## API at a glance

| Call | What it does |
| --- | --- |
| `new DSemaphore({ name, limit, transport, leaseMs?, pollMs? })` | Creates a semaphore. `limit` is the maximum number of concurrent holders. |
| `await sem.acquire({ timeoutMs?, signal? })` | Waits for a slot and returns a `Permit`. Rejects with `TimeoutError` or the signal's reason. |
| `await sem.tryAcquire()` | Never waits. Returns a `Permit`, or `null` if the semaphore is full. |
| `await sem.release(permit)` / `await permit.release()` | Frees the slot. |
| `await sem.currentCount()` | Free slots right now (a snapshot, like `SemaphoreSlim.CurrentCount`). |

## Connecting to Redis or Valkey

```ts
redisTransport('redis://user:password@host:6379/0');            // URL (rediss:// for TLS)
redisTransport({ host: 'host', port: 6379, password: 'secret' }); // ioredis options
redisTransport(existingIoredisClient);                           // reuse your own client
```

The transport only closes connections it created itself. Valkey needs no special handling.

## How it works

Holders live in a Redis sorted set, scored by lease expiry. Acquiring runs one Lua script that removes expired holders, checks the count against `limit`, and adds the new holder, all atomically. Expiry is judged by the Redis server clock, so skewed client clocks don't matter.

A slot is a lease (`leaseMs`, default 30 seconds). If a holder crashes without releasing, the slot returns after the lease. The flip side is that work running longer than `leaseMs` loses its slot, so set the lease comfortably above your longest critical section.

## Custom transports

`DSemaphore` talks to a `Transport` interface (`tryAcquire`, `release`, `count`, `close`), never to Redis directly. To support another backend, implement the interface and run the shared contract tests in `test/contract.ts` against it. See [Custom transports](https://07prajwal2000.github.io/dsemaphore/documents/Custom_transports.html).

## Documentation

- [Getting started](https://07prajwal2000.github.io/dsemaphore/documents/Getting_started.html): install, run Redis, your first semaphore
- [Guide](https://07prajwal2000.github.io/dsemaphore/documents/Guide.html): leases, waiting, errors, connection options
- [Custom transports](https://07prajwal2000.github.io/dsemaphore/documents/Custom_transports.html): add a new backend
- [API reference](https://07prajwal2000.github.io/dsemaphore/modules.html): generated from the source

## License

[MIT](https://github.com/07prajwal2000/dsemaphore/blob/main/LICENSE)
