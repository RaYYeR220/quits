import { and, eq } from 'drizzle-orm';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import {
  createTatumData,
  createTatumSui,
  USDC_MAINNET,
  SUI_TYPE,
  type CallLog,
  type QuitsChainConfig,
  type SuiNetwork,
  type TatumSui,
} from '@quits/chain';
import { connectDb, memoryDb, paymentClaims, tatumCalls, type Db } from '@quits/db';
import { createLlm } from '@quits/llm';
import { createMockStore, createWalrusStore, type MemoryStore } from '@quits/memory';
import type { SettlementStore } from '@quits/pay';
import { createQuits, DEMO_MEMBERS, type Quits } from '@quits/service';

const env = (k: string) => process.env[k]?.trim() || undefined;

export const network = (env('SUI_NETWORK') ?? 'mainnet') as SuiNetwork;

let dbP: Promise<Db> | null = null;
export function getDb(): Promise<Db> {
  dbP ??= (async () => {
    const url = env('DATABASE_URL');
    return url ? connectDb(url, { migrate: env('DB_MIGRATE') === '1' }) : memoryDb();
  })();
  return dbP;
}

/** Every Tatum call is written to `tatum_calls` so the proof page can show live traffic. */
function dbCallLog(): CallLog {
  return {
    record(c) {
      void getDb()
        .then((db) => db.insert(tatumCalls).values({ surface: c.surface, method: c.method.slice(0, 120), ms: Math.round(c.ms), ok: c.ok }))
        .catch(() => {});
    },
  };
}

let sui: TatumSui | null = null;
export function getSui(): TatumSui {
  sui ??= createTatumSui({ apiKey: env('TATUM_API_KEY'), network, log: dbCallLog() });
  return sui;
}
export const getSuiGraphql = () => getSui().graphql;

export function memoryStore(): MemoryStore {
  const key = env('MEMWAL_DELEGATE_KEY');
  const accountId = env('MEMWAL_ACCOUNT_ID');
  return key && accountId ? createWalrusStore({ key, accountId, ...(env('MEMWAL_SERVER_URL') ? { serverUrl: env('MEMWAL_SERVER_URL') } : {}) }) : createMockStore();
}

let quitsP: Promise<Quits> | null = null;
export function getQuits(): Promise<Quits> {
  quitsP ??= (async () => {
    const db = await getDb();
    const data = createTatumData({ apiKey: env('TATUM_API_KEY') ?? '', log: dbCallLog() });
    return createQuits({
      db,
      memory: memoryStore(),
      llm: createLlm({ apiKey: env('LLM_API_KEY') ?? '', baseUrl: env('LLM_BASE_URL') ?? 'https://api.venice.ai/api/v1', model: env('LLM_MODEL') ?? 'mercury-3' }),
      fx: { usdcPerFiat: (fiat) => data.usdcPerFiat(fiat) },
    });
  })();
  return quitsP;
}

export function chainConfig(): QuitsChainConfig {
  const pkg = env('QUITS_PACKAGE_ID');
  const configId = env('QUITS_CONFIG_ID');
  if (!pkg || !configId) throw new Error('QUITS_PACKAGE_ID and QUITS_CONFIG_ID must be set');
  return { pkg, configId, usdcType: network === 'localnet' ? SUI_TYPE : USDC_MAINNET };
}

const keypair = (name: string) => {
  const k = env(name);
  return k ? Ed25519Keypair.fromSecretKey(k) : null;
};
export const agentSigner = () => keypair('QUITS_AGENT_KEY');
export const operatorSigner = () => keypair('QUITS_OPERATOR_KEY');
export const agentAddress = () => agentSigner()?.toSuiAddress() ?? env('QUITS_AGENT_ADDRESS') ?? '';

/** Server-held wallet of a demo member (`demo-ana` …), used only in demo sessions. */
export function demoSigner(uid: string) {
  const m = DEMO_MEMBERS.find((x) => x.id === uid);
  return m ? keypair(`QUITS_DEMO_${m.key}_KEY`) : null;
}

export async function ensureDemo(): Promise<void> {
  const q = await getQuits();
  const addresses = Object.fromEntries(
    DEMO_MEMBERS.flatMap((m) => {
      const kp = keypair(`QUITS_DEMO_${m.key}_KEY`);
      return kp ? [[m.key, kp.toSuiAddress()]] : [];
    }),
  );
  await q.seedDemo(addresses);
}

/** x402 idempotency on Postgres: one reservation per digest and per debt. */
export async function settlementStore(): Promise<SettlementStore> {
  const db = await getDb();
  return {
    async settledDigest(debtId) {
      const [r] = await db.select().from(paymentClaims).where(and(eq(paymentClaims.debtId, debtId), eq(paymentClaims.settled, true))).limit(1);
      return r?.digest ?? null;
    },
    async settledDebt(digest) {
      const [r] = await db.select().from(paymentClaims).where(and(eq(paymentClaims.digest, digest), eq(paymentClaims.settled, true))).limit(1);
      return r?.debtId ?? null;
    },
    async claim(digest, debtId) {
      const rows = await db.insert(paymentClaims).values({ digest, debtId }).onConflictDoNothing().returning({ digest: paymentClaims.digest });
      return rows.length === 1;
    },
    async confirm(digest, debtId) {
      await db.update(paymentClaims).set({ settled: true }).where(and(eq(paymentClaims.digest, digest), eq(paymentClaims.debtId, debtId)));
    },
    async release(digest, debtId) {
      await db.delete(paymentClaims).where(and(eq(paymentClaims.digest, digest), eq(paymentClaims.debtId, debtId), eq(paymentClaims.settled, false)));
    },
  };
}
