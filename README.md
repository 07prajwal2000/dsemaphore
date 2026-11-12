# dsemaphore

Distributed counting semaphore for Node/TS — like C#'s `SemaphoreSlim`, but the limit holds across processes and machines. Redis/Valkey out of the box; the storage backend is pluggable.

```ts
import { DSemaphore, redisTransport } from 'dsemaphore';

const transport = redisTransport('redis://user:pass@localhost:6379'); // or ioredis options, or an existing ioredis client
const sem = new DSemaphore({ name: 'image-resize', limit: 5, transport });

const permit = await sem.acquire({ timeoutMs: 10_000 }); // waits; throws TimeoutError
try { /* at most 5 of these run at once, cluster-wide */ }
finally { await sem.release(permit); } // or permit.release()

await sem.currentCount(); // free slots right now (snapshot, like SemaphoreSlim.CurrentCount)

const p = await sem.tryAcquire(); // never waits: Permit | null
await transport.close(); // only quits connections the transport created itself
```

- `leaseMs` (default 30s): a holder that crashes loses its slot after this long. Work running longer than the lease can exceed `limit` — size the lease generously.
- `acquire` polls (default ~50ms, jittered) and accepts an `AbortSignal`.
- Redis/Valkey >= 5. Time is judged by the server, so client clock skew is harmless.

## Custom transport

Implement `Transport` (`tryAcquire`, `release`, `count`, `close`, see `src/transport.ts`) and run `test/contract.ts` against it. `DSemaphore` doesn't change.

## Tests

`npm run test:unit` (in-memory transport) · `npm run test:integration` (needs Docker; starts Redis and Valkey containers) · `npm test` (both).
