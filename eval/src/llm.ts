import { createLlm, type Llm, type Usage } from '@quits/llm';
import { fakeLlm } from './fakeLlm.ts';

export interface LlmSetup {
  llm: Llm;
  model: string;
  provider: string;
}

const TRANSIENT = /HTTP (408|409|425|429|5\d\d)|fetch failed|timeout|aborted|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket/i;

/** Retries rate limits, 5xx and network hiccups with exponential backoff. */
export function withRetry(llm: Llm, o: { tries?: number; baseMs?: number; onRetry?: (e: Error, attempt: number) => void } = {}): Llm {
  const tries = o.tries ?? 6;
  const base = o.baseMs ?? 1000;
  return {
    async raw(system, user, opts) {
      for (let attempt = 1; ; attempt++) {
        try {
          return await llm.raw(system, user, opts);
        } catch (e) {
          const err = e instanceof Error ? e : new Error(String(e));
          if (attempt >= tries || !TRANSIENT.test(`${err.name} ${err.message}`)) throw err;
          o.onRetry?.(err, attempt);
          await new Promise((r) => setTimeout(r, base * 2 ** (attempt - 1) * (0.75 + Math.random() / 2)));
        }
      }
    },
  };
}

/** Caps the number of requests in flight across every system sharing this client. */
export function withLimit(llm: Llm, max: number): Llm {
  let active = 0;
  const waiting: (() => void)[] = [];
  return {
    async raw(system, user, opts) {
      if (active >= max) await new Promise<void>((r) => waiting.push(r));
      active += 1;
      try {
        return await llm.raw(system, user, opts);
      } finally {
        active -= 1;
        waiting.shift()?.();
      }
    },
  };
}

export interface Meter {
  llm: Llm;
  take(): { calls: number; errors: number } & Usage;
}

/** Counts calls and tokens since the last `take()`. */
export function metered(llm: Llm): Meter {
  let calls = 0;
  let errors = 0;
  let prompt = 0;
  let completion = 0;
  return {
    llm: {
      async raw(system, user, opts) {
        calls += 1;
        try {
          const r = await llm.raw(system, user, opts);
          prompt += r.usage.prompt;
          completion += r.usage.completion;
          return r;
        } catch (e) {
          errors += 1;
          throw e;
        }
      },
    },
    take() {
      const out = { calls, errors, prompt, completion };
      calls = errors = prompt = completion = 0;
      return out;
    },
  };
}

/** `EVAL_LLM=fake` for CI; otherwise any chat-completions endpoint (Venice by default). */
export function llmFromEnv(env: NodeJS.ProcessEnv, o: { model?: string; concurrency: number; log?: (s: string) => void }): LlmSetup {
  if (env.EVAL_LLM === 'fake') return { llm: fakeLlm(), model: 'fake', provider: 'fake' };
  const apiKey = env.LLM_API_KEY ?? env.VENICE_API_KEY;
  if (!apiKey) throw new Error('set LLM_API_KEY (or EVAL_LLM=fake for an offline run)');
  const baseUrl = env.LLM_BASE_URL ?? 'https://api.venice.ai/api/v1';
  const model = o.model ?? env.LLM_MODEL ?? 'mercury-3';
  const llm = createLlm({ apiKey, baseUrl, model, timeoutMs: 180_000 });
  const retrying = withRetry(llm, { onRetry: (e, n) => o.log?.(`  retry ${n}: ${e.message.slice(0, 120)}`) });
  return { llm: withLimit(retrying, o.concurrency), model, provider: new URL(baseUrl).host };
}
