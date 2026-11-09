import { z, type ZodType } from 'zod';

export interface Usage {
  prompt: number;
  completion: number;
}

/** The only thing Quits asks of a language model: one JSON answer to one prompt. */
export interface Llm {
  raw(system: string, user: string, opts?: { name?: string; schema?: unknown }): Promise<{ content: string; usage: Usage }>;
}

export class LlmSchemaError extends Error {
  constructor(public readonly issues: string) {
    super(`model output did not match the schema: ${issues}`);
  }
}

export interface LlmConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  /** Used once if the provider says `model` no longer exists. */
  fallbackModel?: string;
  timeoutMs?: number;
  onUsage?: (u: Usage) => void;
}

/** Chat-completions client that asks for JSON-schema answers. */
export function createLlm(cfg: LlmConfig): Llm {
  const isVenice = cfg.baseUrl.includes('venice.ai');
  return {
    async raw(system, user, opts) {
      const call = (withSchema: boolean, model = cfg.model) => fetch(`${cfg.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { authorization: `Bearer ${cfg.apiKey}`, 'content-type': 'application/json' },
        signal: AbortSignal.timeout(cfg.timeoutMs ?? 45_000),
        body: JSON.stringify({
          model,
          temperature: 0,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          ...(withSchema && opts?.schema
            ? { response_format: { type: 'json_schema', json_schema: { name: opts.name ?? 'answer', schema: opts.schema, strict: false } } }
            : { response_format: { type: 'json_object' } }),
          ...(isVenice ? { venice_parameters: { include_venice_system_prompt: false } } : {}),
        }),
      });
      let res = await call(true);
      // Providers retire models without notice; a model that no longer exists falls back to the second one.
      if (res.status === 404 && cfg.fallbackModel && cfg.fallbackModel !== cfg.model) {
        const body = await res.text();
        if (!/model/i.test(body)) throw new Error(`llm: HTTP 404 ${body.slice(0, 200)}`);
        res = await call(true, cfg.fallbackModel);
        if (!res.ok && opts?.schema && res.status >= 400) res = await call(false, cfg.fallbackModel);
        if (!res.ok) throw new Error(`llm: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
      }
      // Some providers reject richer JSON schemas; fall back to plain JSON mode and validate locally.
      if (!res.ok && opts?.schema && res.status >= 400) res = await call(false);
      if (!res.ok) throw new Error(`llm: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
      const body = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const usage = { prompt: body.usage?.prompt_tokens ?? 0, completion: body.usage?.completion_tokens ?? 0 };
      cfg.onUsage?.(usage);
      return { content: body.choices?.[0]?.message?.content ?? '', usage };
    },
  };
}

function extractJson(content: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/u.exec(content);
  return JSON.parse((fenced?.[1] ?? content).trim());
}

/** Asks for JSON matching `schema`; retries once on malformed output, then throws `LlmSchemaError`. */
export async function askJson<T>(llm: Llm, name: string, system: string, user: string, schema: ZodType<T>): Promise<T> {
  const jsonSchema = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' });
  let lastIssues = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const { content } = await llm.raw(system, user, { name, schema: jsonSchema });
    try {
      const parsed = schema.safeParse(extractJson(content));
      if (parsed.success) return parsed.data;
      lastIssues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    } catch (e) {
      lastIssues = e instanceof Error ? e.message : String(e);
    }
  }
  throw new LlmSchemaError(lastIssues);
}
