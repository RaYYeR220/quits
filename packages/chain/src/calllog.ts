/** `fallback`: the public Sui fullnode answered because the gateway refused for credits. */
export type CallSurface = 'grpc' | 'graphql' | 'data' | 'fallback';

export interface CallRecord {
  surface: CallSurface;
  /** `LedgerService.GetObject`, a GraphQL operation name, or a Data API path. */
  method: string;
  ms: number;
  ok: boolean;
  /** gRPC status or HTTP status of a failed call. */
  code?: string;
}

/** Sink for every Tatum call (backs the `tatum_calls` table and the live proof panel). */
export interface CallLog {
  record(call: CallRecord): void | Promise<void>;
}

/**
 * Codes where the gateway did its job and gave a definite answer: the object or
 * transaction isn't there (yet), or the node rejected the request on its merits.
 * Everything else (rate limits, timeouts, unavailable, internal) is a failure.
 */
const DEFINITE_GRPC = new Set(['NOT_FOUND', 'INVALID_ARGUMENT', 'FAILED_PRECONDITION', 'ALREADY_EXISTS', 'OUT_OF_RANGE', 'CANCELLED']);

export function answered(call: Pick<CallRecord, 'ok' | 'code'>): boolean {
  if (call.ok) return true;
  if (!call.code) return false;
  if (DEFINITE_GRPC.has(call.code)) return true;
  const http = Number(call.code);
  return Number.isInteger(http) && http >= 400 && http < 500 && http !== 408 && http !== 429;
}

/** The same rule in SQL, for aggregating the `tatum_calls` table. */
export const DEFINITE_CODES = [...DEFINITE_GRPC, ...Array.from({ length: 100 }, (_, i) => String(400 + i)).filter((c) => c !== '408' && c !== '429')];

export const noopCallLog: CallLog = { record() {} };

/** Keeps the most recent calls in memory. */
export function createMemoryCallLog(limit = 500): CallLog & { calls(): CallRecord[] } {
  const calls: CallRecord[] = [];
  return {
    record(call) {
      calls.push(call);
      if (calls.length > limit) calls.shift();
    },
    calls: () => [...calls],
  };
}

/** Telemetry must never break the call it describes, so sink failures are dropped. */
export function recordCall(log: CallLog, call: CallRecord): void {
  try {
    void Promise.resolve(log.record(call)).catch(() => {});
  } catch {
    // ignored on purpose, see above
  }
}

export function elapsedSince(t0: number): number {
  return Math.round(performance.now() - t0);
}
