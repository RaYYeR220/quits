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

/** Process-wide singletons. Route bundles each load this module, so state lives on globalThis. */
const g = globalThis as typeof globalThis & {
  __quitsDb?: Promise<Db>;
  __quitsService?: Promise<Quits>;
  __quitsSui?: TatumSui;
  __quitsDrain?: ReturnType<typeof setInterval>;
};

/** Caches a startup promise but forgets it if it fails, so the next request retries. */
function once<T>(key: '__quitsDb' | '__quitsService', make: () => Promise<T>): Promise<T> {
  const cached = g[key] as Promise<T> | undefined;
  if (cached) return cached;
  const p = make().catch((e) => {
    delete g[key];
    throw e;
  });
  (g as Record<string, unknown>)[key] = p;
  return p;
}

export function getDb(): Promise<Db> {
  return once('__quitsDb', async () => {
    const url = env('DATABASE_URL');
    return url ? connectDb(url, { migrate: env('DB_MIGRATE') === '1', max: Number(env('DB_POOL_MAX') ?? 3) }) : memoryDb();
  });
}

/** Every Tatum call is written to `tatum_calls` so the proof page can show live traffic. */
function dbCallLog(): CallLog {
  return {
    record(c) {
      void getDb()
        .then((db) => db.insert(tatumCalls).values({ surface: c.surface, method: c.method.slice(0, 120), ms: Math.round(c.ms), ok: c.ok, code: c.code ?? null }))
        .catch(() => {});
    },
  };
}

export function getSui(): TatumSui {
  g.__quitsSui ??= createTatumSui({ apiKey: env('TATUM_API_KEY'), network, log: dbCallLog() });
  return g.__quitsSui;
}
export const getSuiGraphql = () => getSui().graphql;

export function memoryStore(): MemoryStore {
  const key = env('MEMWAL_DELEGATE_KEY');
  const accountId = env('MEMWAL_ACCOUNT_ID');
  return key && accountId ? createWalrusStore({ key, accountId, ...(env('MEMWAL_SERVER_URL') ? { serverUrl: env('MEMWAL_SERVER_URL') } : {}) }) : createMockStore();
}

/** Local development without a Tatum key: `QUITS_FX_FIXED=PLN:0.25,EUR:1.16`. Recorded as source `fixed-dev`. */
function fixedRates() {
  const spec = env('QUITS_FX_FIXED');
  if (!spec || env('TATUM_API_KEY')) return null;
  const rates = Object.fromEntries(spec.split(',').map((p) => p.split(':').map((x) => x.trim()) as [string, string]));
  return {
    async usdcPerFiat(fiat: string) {
      const rate = rates[fiat.toUpperCase()];
      if (!rate) throw new Error(`no fixed rate for ${fiat}`);
      return { rate, source: 'fixed-dev', at: new Date().toISOString() };
    },
  };
}

export function getQuits(): Promise<Quits> {
  return once('__quitsService', async () => {
    const db = await getDb();
    const data = createTatumData({ apiKey: env('TATUM_API_KEY') ?? '', log: dbCallLog() });
    const memory = memoryStore();
    const q = createQuits({
      db,
      memory,
      llm: createLlm({ apiKey: env('LLM_API_KEY') ?? '', baseUrl: env('LLM_BASE_URL') ?? 'https://api.venice.ai/api/v1', model: env('LLM_MODEL') ?? 'google-gemma-4-26b-a4b-it', fallbackModel: env('LLM_FALLBACK_MODEL') ?? 'google-gemma-4-26b-a4b-it' }),
      fx: fixedRates() ?? { usdcPerFiat: (fiat) => data.usdcPerFiat(fiat) },
    });
    // The in-process memory stand-in lives in this process only, so it is drained here.
    if (memory.kind === 'mock' && !g.__quitsDrain) g.__quitsDrain = setInterval(() => void q.drainMemory().catch(() => {}), 2_000);
    g.__quitsDrain?.unref?.();
    return q;
  });
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
