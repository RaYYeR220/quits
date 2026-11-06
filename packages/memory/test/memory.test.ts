import { describe, expect, it } from 'vitest';
import { createBucket } from '../src/bucket.ts';
import { createMockStore } from '../src/walrus.ts';
import { nsGroupRules as nsGroup, nsMember } from '../src/namespaces.ts';

describe('mock store', () => {
  it('remembers and recalls within a namespace', async () => {
    const m = createMockStore();
    const { jobId } = await m.remember(nsMember('ana'), 'Ana doesn’t drink, so leave her out of alcohol.');
    const s = await m.status(jobId);
    expect(s.state).toBe('done');
    expect(s.blobId).toBeTruthy();
    const hits = await m.recall(nsMember('ana'), 'alcohol wine dinner');
    expect(hits[0]?.text).toContain('alcohol');
    expect(await m.recall(nsGroup('flat'), 'alcohol')).toEqual([]);
  });

  it('keeps member-owned accounts apart from the operator', async () => {
    const m = createMockStore();
    await m.remember(nsMember('ana'), 'Ana is vegetarian', { accountId: '0xana' });
    expect(await m.recall(nsMember('ana'), 'vegetarian')).toEqual([]);
    expect((await m.recall(nsMember('ana'), 'vegetarian', { accountId: '0xana' }))[0]?.text).toBe('Ana is vegetarian');
  });

  it('writes in bulk and caps a batch at 20', async () => {
    const m = createMockStore();
    const r = await m.rememberBulk([
      { ns: nsGroup('flat'), text: 'Rent splits by room size.' },
      { ns: nsGroup('flat'), text: 'Ben always covers taxis.' },
    ]);
    expect(r.jobIds).toHaveLength(2);
    await expect(m.rememberBulk(Array.from({ length: 21 }, (_, i) => ({ ns: 'x', text: `t${i}` })))).rejects.toThrow(/20/);
  });
});

describe('bucket', () => {
  function clock() {
    let t = 0;
    return {
      now: () => t,
      sleep: async (ms: number) => {
        t += ms;
      },
      get t() {
        return t;
      },
    };
  }

  it('waits when the minute budget is spent', async () => {
    const c = clock();
    const b = createBucket({ perMin: 60, perHour: 500, now: c.now, sleep: c.sleep });
    for (let i = 0; i < 12; i++) await b.take(5);
    expect(c.t).toBe(0);
    await b.take(5);
    expect(c.t).toBeGreaterThanOrEqual(60_000);
  });

  it('respects the hourly budget', async () => {
    const c = clock();
    const b = createBucket({ perMin: 60, perHour: 100, now: c.now, sleep: c.sleep });
    for (let i = 0; i < 10; i++) await b.take(10);
    expect(b.available()).toBe(0);
    await b.take(10);
    expect(c.t).toBeGreaterThanOrEqual(3_600_000);
  });

  it('rejects a single request larger than a minute’s budget', async () => {
    const b = createBucket({ perMin: 10, perHour: 100 });
    await expect(b.take(11)).rejects.toThrow();
  });
});
