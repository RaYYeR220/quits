import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { isNotNull } from 'drizzle-orm';
import { createTatumData, createTatumSui, SUI_TYPE, USDC_MAINNET, type SuiNetwork } from '@quits/chain';
import { connectDb, memoryDb, tatumCalls, users } from '@quits/db';
import { createLlm } from '@quits/llm';
import { createBucket, createMockStore, createWalrusStore } from '@quits/memory';
import { createQuits } from '@quits/service';
import { autoSettleOnce } from './autosettle.ts';
import { followCheckpoints } from './stream.ts';
import { createTelegramBot } from './telegram.ts';
import { matchExternalPayment } from './watcher.ts';
import { rebalanceDemoWallets } from './demo-wallets.ts';

const env = (k: string) => process.env[k]?.trim() || undefined;
const log = (msg: string, extra: Record<string, unknown> = {}) => console.log(JSON.stringify({ t: new Date().toISOString(), msg, ...extra }));

const network = (env('SUI_NETWORK') ?? 'mainnet') as SuiNetwork;
const usdcType = network === 'localnet' ? SUI_TYPE : USDC_MAINNET;
const db = env('DATABASE_URL') ? await connectDb(env('DATABASE_URL')!, { migrate: true }) : await memoryDb();
const callLog = {
  record(c: { surface: 'grpc' | 'graphql' | 'data' | 'fallback'; method: string; ms: number; ok: boolean; code?: string }) {
    void db.insert(tatumCalls).values({ surface: c.surface, method: c.method.slice(0, 120), ms: Math.round(c.ms), ok: c.ok, code: c.code ?? null }).catch(() => {});
  },
};
const tatumKey = env('TATUM_API_KEY_WORKER') ?? env('TATUM_API_KEY');
const sui = createTatumSui({ apiKey: tatumKey, network, log: callLog });
const data = createTatumData({ apiKey: tatumKey ?? '', log: callLog });

const memKey = env('MEMWAL_DELEGATE_KEY');
const memAccount = env('MEMWAL_ACCOUNT_ID');
const memory = memKey && memAccount ? createWalrusStore({ key: memKey, accountId: memAccount }) : createMockStore();

const q = createQuits({
  db,
  memory,
  llm: createLlm({ apiKey: env('LLM_API_KEY') ?? '', baseUrl: env('LLM_BASE_URL') ?? 'https://api.venice.ai/api/v1', model: env('LLM_MODEL') ?? 'google-gemma-4-26b-a4b-it', fallbackModel: env('LLM_FALLBACK_MODEL') ?? 'google-gemma-4-26b-a4b-it' }),
  fx: { usdcPerFiat: (fiat) => data.usdcPerFiat(fiat) },
});

const stop = new AbortController();
process.on('SIGINT', () => stop.abort());
process.on('SIGTERM', () => stop.abort());

async function every(name: string, ms: number, fn: () => Promise<unknown>) {
  while (!stop.signal.aborted) {
    try {
      const r = await fn();
      if (r && typeof r === 'object' && Object.values(r).some((v) => typeof v === 'number' && v > 0)) log(name, r as Record<string, unknown>);
    } catch (e) {
      log(`${name} failed`, { error: e instanceof Error ? e.message : String(e) });
    }
    // wake early on shutdown so systemd doesn't have to kill us mid-sleep
    await new Promise<void>((r) => {
      const t = setTimeout(r, ms);
      stop.signal.addEventListener('abort', () => (clearTimeout(t), r()), { once: true });
    });
  }
}

const bucket = createBucket({ perMin: 55, perHour: 480 });
// With the in-process stand-in the web app drains its own memory; the worker only writes to Walrus.
const jobs: Promise<unknown>[] = memory.kind === 'walrus' ? [every('memory', 5_000, () => q.drainMemory({ bucket }))] : [];

const pkg = env('QUITS_PACKAGE_ID');
const configId = env('QUITS_CONFIG_ID');
const webUrl = env('QUITS_WEB_URL');
const operatorKey = env('QUITS_OPERATOR_KEY');
const agentKey = env('QUITS_AGENT_KEY');
if (pkg && configId && webUrl && operatorKey && agentKey) {
  const deps = {
    q,
    client: sui.client,
    cfg: { pkg, configId, usdcType },
    registrar: Ed25519Keypair.fromSecretKey(operatorKey),
    agent: Ed25519Keypair.fromSecretKey(agentKey),
    webUrl,
    log,
  };
  jobs.push(every('autosettle', 15_000, () => autoSettleOnce(deps)));
} else log('autosettle off: chain config incomplete');

// Tatum bills every message a checkpoint stream delivers, and the free plan's credits are one-time, so the
// watcher for direct transfers is opt-in. Payments made through Quits (x402, MPP, the agent) don't need it.
if (env('QUITS_CHECKPOINT_STREAM') === 'on') jobs.push(
  followCheckpoints({
    client: sui.client,
    usdcType,
    signal: stop.signal,
    log,
    addresses: async () => (await db.select({ a: users.suiAddress }).from(users).where(isNotNull(users.suiAddress))).map((r) => r.a!),
    onTx: async (tx) => {
      const hit = await matchExternalPayment(q, tx).catch((e) => {
        log('match failed', { digest: tx.digest, error: String(e) });
        return null;
      });
      if (hit) log('external payment matched', { digest: tx.digest, debt: hit.debtId });
    },
  }),
);

const demoKeys = ['ANA', 'BEN', 'CLARA', 'DAN'].map((m) => env(`QUITS_DEMO_${m}_KEY`)).filter((k): k is string => Boolean(k));
// Demo payments top up the paying wallet from the pool when it's short, so periodic rebalancing is opt-in too.
if (demoKeys.length === 4 && network === 'mainnet' && env('QUITS_DEMO_REBALANCE') === 'on') {
  const wallets = demoKeys.map((k) => Ed25519Keypair.fromSecretKey(k));
  jobs.push(every('demo wallets', 300_000, () => rebalanceDemoWallets(sui.client, wallets, usdcType).then((r) => ({ ...r, moved: Number(r.moved) }))));
}

const tg = env('TELEGRAM_BOT_TOKEN');
if (tg) {
  const bot = createTelegramBot(tg, q, webUrl ?? 'https://quits.app');
  jobs.push(bot.start({ onStart: (me) => log('telegram up', { bot: me.username }) }));
  stop.signal.addEventListener('abort', () => void bot.stop());
}

log('worker up', { network, memory: memory.kind });
await Promise.allSettled(jobs);
log('worker stopped');
// open sockets (database pool, gRPC channel) would otherwise keep the process alive
process.exit(0);
