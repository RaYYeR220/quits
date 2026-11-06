// Writes one memory to Walrus Memory on mainnet, waits for it, and recalls it back.
// Usage: MEMWAL_DELEGATE_KEY=... MEMWAL_ACCOUNT_ID=... pnpm tsx scripts/memwal-smoke.ts
import { createWalrusStore, blobUrl } from '@quits/memory';

const key = process.env.MEMWAL_DELEGATE_KEY;
const accountId = process.env.MEMWAL_ACCOUNT_ID;
if (!key || !accountId) throw new Error('set MEMWAL_DELEGATE_KEY and MEMWAL_ACCOUNT_ID');

const store = createWalrusStore({ key, accountId, serverUrl: process.env.MEMWAL_SERVER_URL });
const ns = 'quits:smoke';

console.log('health', await store.health());
const text = `Smoke test at ${new Date().toISOString()}: Ana doesn't drink.`;
const { jobId } = await store.remember(ns, text);
console.log('job', jobId);

const started = Date.now();
for (;;) {
  const s = await store.status(jobId);
  if (s.state === 'done') {
    console.log('stored', s.blobId, blobUrl(s.blobId ?? ''), `${Math.round((Date.now() - started) / 1000)}s`);
    break;
  }
  if (s.state === 'failed' || s.state === 'not_found') throw new Error(`write ${s.state}: ${s.error ?? ''}`);
  await new Promise((r) => setTimeout(r, 3000));
}

const hits = await store.recall(ns, 'does Ana drink', { topK: 3 });
console.log('recall', hits.map((h) => ({ text: h.text, blobId: h.blobId, distance: h.distance })));
