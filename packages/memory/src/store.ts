export type JobState = 'pending' | 'running' | 'uploaded' | 'done' | 'failed' | 'not_found';

export interface Recalled {
  text: string;
  blobId: string;
  distance: number;
  createdAt?: string;
}

export interface WriteTarget {
  /** Write into this MemWal account instead of the operator's (member-owned memory). */
  accountId?: string;
}

/** What Quits needs from a memory backend. */
export interface MemoryStore {
  readonly kind: 'walrus' | 'mock';
  remember(ns: string, text: string, o?: WriteTarget): Promise<{ jobId: string }>;
  rememberBulk(items: { ns: string; text: string }[], o?: WriteTarget): Promise<{ jobIds: string[] }>;
  status(jobId: string, o?: WriteTarget): Promise<{ state: JobState; blobId?: string; error?: string }>;
  recall(ns: string, query: string, o?: WriteTarget & { topK?: number; sort?: 'relevance' | 'recent' }): Promise<Recalled[]>;
  health(o?: WriteTarget): Promise<boolean>;
}

/** Points the hosted relayer charges per call. */
export const COST = { remember: 5, bulk: 10, recall: 1 } as const;
