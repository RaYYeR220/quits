export type CallSurface = 'grpc' | 'graphql' | 'data';

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
