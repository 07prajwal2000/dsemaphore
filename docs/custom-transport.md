---
title: Custom transports
---

# Custom transports

{@link DSemaphore} never talks to Redis directly. It talks to a {@link Transport}, so you can back it with another store (Postgres, etcd, DynamoDB, ...) without changing any calling code.

## The interface

```ts
interface Transport {
  tryAcquire(key: string, id: string, limit: number, leaseMs: number): Promise<boolean>;
  release(key: string, id: string): Promise<boolean>;
  count(key: string): Promise<number>;
  close(): Promise<void>;
}
```

## Rules an implementation must follow

1. **`tryAcquire` is atomic.** Concurrent callers must never push live holders above `limit`. Use a transaction, a script, or a conditional write.
2. **Slots expire.** A holder that never calls `release` loses its slot after `leaseMs`.
3. **One clock.** Judge expiry with the store's clock, not each client's.
4. **`count` ignores expired holders**, even ones not yet purged.
5. **`release` of an unknown id** resolves `false` and does nothing.
6. **`close` frees only what the transport created itself.**

## Prove it with the contract tests

The repository ships `test/contract.ts`, a shared suite that every transport must pass: limits, release, lease expiry, concurrent acquires, counting. Run it against your implementation:

```ts
import { transportContract } from '../contract';

transportContract('MyTransport', () => new MyTransport(/* ... */));
```

The built-in in-memory test transport and the Redis/Valkey transport run this same suite, so a new backend that passes it behaves identically to them.

## Using it

```ts
const sem = new DSemaphore({ name: 'jobs', limit: 5, transport: new MyTransport() });
```
