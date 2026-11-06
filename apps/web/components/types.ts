/** Client-side shapes of the Quits JSON API. Money is micro-USDC as a decimal string. */
export type Micro = string;

export interface GroupRef {
  id: string;
  name: string;
  code: string;
  defaultCurrency: string;
  isDemo: boolean;
}

export interface Me {
  user: { id: string; name: string; suiAddress: string | null; ownMemory: boolean; memwalAccountId: string | null } | null;
  demo: boolean;
  groups: GroupRef[];
  autoPayLimit: Micro;
}

export interface Member {
  id: string;
  name: string;
  suiAddress: string | null;
  ownMemory: boolean;
  autoSettle: boolean;
}

export interface Item {
  label: string;
  usdcMicro: Micro;
  tags: string[];
}

export interface Expense {
  id: string;
  groupId: string;
  payerId: string;
  usdcMicro: Micro;
  currency: string;
  amountMinor: string;
  category: string;
  items: Item[];
  participants: string[];
  description: string;
  occurredAt: string;
}

export type RuleState = 'stored' | 'saving' | 'cached';

export interface Why {
  ruleId: string;
  sentence: string;
  learnedAt: string;
  state: RuleState;
  scope: 'group' | 'member';
  blobId?: string;
  appliesTo: string[];
}

export interface Split {
  expense: Expense;
  shares: Record<string, Micro>;
  why: Why[];
  conflict: boolean;
  applied: { ruleId: string; target: 'expense' | number }[];
  memoriesRead: number;
  degraded?: 'cached';
}

export interface Proposal extends Split {
  draftId: string;
  fx: { rate: string; source: string } | null;
}

export type Missing = 'amount' | 'payer' | 'currency';

export type AddResult = { ok: true; proposal: Proposal } | { ok: false; missing: Missing[] } | { ok: false; fxUnavailable: string };

export type CorrectResult =
  | {
      ok: true;
      proposal: Proposal;
      learned: { ruleId: string; sentence: string; scope: 'group' | 'member' } | null;
      fixed?: { absent: string[]; payer?: string };
    }
  | { ok: false; clarify: string };

export type DebtStatus = 'open' | 'recorded' | 'settled_wallet' | 'settled_agent' | 'settled_external' | 'cancelled';

export interface Debt {
  id: string;
  groupId: string;
  debtorId: string;
  creditorId: string;
  usdcMicro: Micro;
  status: DebtStatus;
  mandateId: string | null;
  onchainDebtId: string | null;
  pullableAt: string | null;
  txDigest: string | null;
  createdAt: string;
  settledAt: string | null;
}

export interface HistoryEntry {
  expense: Expense;
  status: string;
  shares: Record<string, Micro>;
  applied: { ruleId: string; target: 'expense' | number }[];
  source: string;
  fx: { rate: string | null; source: string | null };
}

export interface GroupData {
  group: { id: string; name: string; code: string; defaultCurrency: string; createdBy: string; isDemo: boolean; createdAt: string };
  me: string;
  members: Member[];
  balances: Record<string, Micro>;
  debts: Debt[];
  expenses: HistoryEntry[];
}

export interface ListedRule {
  id: string;
  sentence: string;
  scope: 'group' | 'member';
  ownerId: string | null;
  kind: string;
  learnedAt: string;
  memoryState: 'queued' | 'submitted' | 'done' | 'failed' | null;
  blobId: string | null;
  status: 'active' | 'superseded' | 'revocation';
}

export interface X402Requirements {
  x402Version: number;
  error?: string;
  resource: { url: string; description: string; mimeType: string };
  accepts: { scheme: string; network: string; asset: string; amount: string; payTo: string; maxTimeoutSeconds: number; extra?: { debtId?: string; debtor?: string } }[];
}

export interface Receipt {
  settled: true;
  debtId: string;
  digest: string;
  explorer: string;
  via?: string;
  status?: DebtStatus;
}

export interface DemoPay {
  challenge: X402Requirements;
  receipt: Receipt | { error: string };
  status: number;
}

export interface MandateTerms {
  lifetimeCap: Micro;
  weeklyLimit: Micro;
  maxPerDebt: Micro;
  objectionWindowMs: number;
  days: number;
}

export interface Mandate {
  mandateObjectId: string;
  allowanceId: string;
  digest: string;
  terms: MandateTerms;
}

export interface ProofData {
  network: string;
  memoryBackend: string;
  package: string | null;
  tatum: {
    recent: { id: number; surface: string; method: string; ms: number; ok: boolean; at: string }[];
    byMethod: { surface: string; method: string; n: number; okN: number; avgMs: number }[];
  };
  /** Walrus Blob objects the memory account owns, read from chain through Tatum (mainnet only). */
  onchainMemory?:
    | null
    | { error: string }
    | {
        owner: string;
        agentId: string;
        count: number;
        latest: { objectId: string; blobId: string; size: string; endEpoch: number | null; namespace: string | null; agentId: string | null; owner: string | null; suiscan: string }[];
      };
  memories: {
    stored: number;
    latest: { ns: string; kind: string; blobId: string | null; storedAt: string | null; text: string; walruscan: string | null }[];
  };
  settlements: { id: string; usdcMicro: Micro; status: DebtStatus; digest: string; at: string | null; explorer: string }[];
}
