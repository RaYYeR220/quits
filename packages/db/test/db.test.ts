import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { memoryDb } from '../src/client.ts';
import { debts, groups, users } from '../src/schema.ts';

describe('database', () => {
  it('applies migrations on an in-process Postgres', async () => {
    const db = await memoryDb();
    await db.insert(users).values({ id: 'u1', name: 'Ana', authProvider: 'demo' });
    await db.insert(groups).values({ id: 'g1', name: 'Flat 5B', code: 'FLAT5B', createdBy: 'u1' });
    const rows = await db.select().from(groups).where(eq(groups.id, 'g1'));
    expect(rows[0]?.name).toBe('Flat 5B');
    expect(rows[0]?.defaultCurrency).toBe('USD');
  });

  it('stores micro-USDC as bigint and refuses a reused settlement digest', async () => {
    const db = await memoryDb();
    await db.insert(users).values({ id: 'u1', name: 'Ana', authProvider: 'demo' });
    await db.insert(groups).values({ id: 'g1', name: 'Flat 5B', code: 'F', createdBy: 'u1' });
    await db.insert(debts).values({ id: 'd1', groupId: 'g1', debtorId: 'u1', creditorId: 'u2', usdcMicro: 12_340_000n, txDigest: 'abc' });
    const [d] = await db.select().from(debts);
    expect(d?.usdcMicro).toBe(12_340_000n);
    await expect(
      db.insert(debts).values({ id: 'd2', groupId: 'g1', debtorId: 'u1', creditorId: 'u2', usdcMicro: 1n, txDigest: 'abc' }),
    ).rejects.toThrow();
  });
});
