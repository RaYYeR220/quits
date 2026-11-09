import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLlm } from '../src/client.ts';

const ok = (content: string) => new Response(JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }), { status: 200 });

afterEach(() => vi.unstubAllGlobals());

describe('createLlm', () => {
  it('retries once on the fallback model when the provider retired the configured one', async () => {
    const models: string[] = [];
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      const { model } = JSON.parse(String(init.body)) as { model: string };
      models.push(model);
      return model === 'retired' ? new Response('{"error":"Specified model not found: retired"}', { status: 404 }) : ok('{"a":1}');
    });
    const llm = createLlm({ apiKey: 'k', baseUrl: 'https://example.test/v1', model: 'retired', fallbackModel: 'current' });
    const r = await llm.raw('s', 'u', { name: 'x', schema: { type: 'object' } });
    expect(r.content).toBe('{"a":1}');
    expect(models).toEqual(['retired', 'current']);
  });

  it('does not switch models on a 404 that is not about the model', async () => {
    const models: string[] = [];
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      models.push((JSON.parse(String(init.body)) as { model: string }).model);
      return new Response('not here', { status: 404 });
    });
    const llm = createLlm({ apiKey: 'k', baseUrl: 'https://example.test/v1', model: 'm', fallbackModel: 'other' });
    await expect(llm.raw('s', 'u')).rejects.toThrow(/404/);
    expect(models).toEqual(['m']);
  });
});
