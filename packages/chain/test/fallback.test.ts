import { describe, expect, it } from 'vitest';
import { UnaryCall, type MethodInfo, type RpcTransport } from '@protobuf-ts/runtime-rpc';
import { createMemoryCallLog } from '../src/calllog.ts';
import { isOutOfCredits, meteredTransport } from '../src/tatum-grpc.ts';

const method = { name: 'GetBalance', service: { typeName: 'sui.rpc.v2.StateService' } } as unknown as MethodInfo<object, object>;

function transport(answer: () => Promise<object>): RpcTransport & { calls: number } {
  const t = {
    calls: 0,
    mergeOptions: (o: object) => o,
    unary(m: MethodInfo<object, object>, input: object) {
      t.calls += 1;
      const response = answer();
      response.catch(() => {});
      return new UnaryCall(m, {}, input, Promise.resolve({}), response, Promise.resolve({ code: 'OK', detail: '' }), Promise.resolve({}));
    },
  };
  return t as unknown as RpcTransport & { calls: number };
}

const outOfCredits = () => Promise.reject(Object.assign(new Error('Received HTTP status code 403'), { code: 'PERMISSION_DENIED' }));

describe('gateway fallback', () => {
  it('answers from the public fullnode when the gateway is out of credits, and logs it', async () => {
    const log = createMemoryCallLog();
    const gateway = transport(outOfCredits);
    const fullnode = transport(() => Promise.resolve({ balance: 1 }));
    const t = meteredTransport(gateway, { log, limiter: null, fallback: fullnode });

    expect(await t.unary(method, {}, {}).response).toEqual({ balance: 1 });
    await new Promise((r) => setTimeout(r, 0));
    expect(log.calls().map((c) => [c.surface, c.ok, c.code ?? null])).toEqual([
      ['grpc', false, 'OUT_OF_CREDITS'],
      ['fallback', true, null],
    ]);

    // for a while after that it goes straight to the fullnode
    await t.unary(method, {}, {}).response;
    expect(gateway.calls).toBe(1);
    expect(fullnode.calls).toBe(2);
  });

  it('does not fall back on an ordinary node error', async () => {
    const log = createMemoryCallLog();
    const gateway = transport(() => Promise.reject(Object.assign(new Error('object not found'), { code: 'NOT_FOUND' })));
    const fullnode = transport(() => Promise.resolve({}));
    const t = meteredTransport(gateway, { log, limiter: null, fallback: fullnode });
    await expect(t.unary(method, {}, {}).response).rejects.toThrow('not found');
    expect(fullnode.calls).toBe(0);
  });

  it('tells credits apart from rate limits and timeouts', () => {
    expect(isOutOfCredits(Object.assign(new Error('x'), { code: 'PERMISSION_DENIED' }))).toBe(true);
    expect(isOutOfCredits(new Error('Received HTTP status code 402'))).toBe(true);
    expect(isOutOfCredits(new Error('Received HTTP status code 429'))).toBe(false);
    expect(isOutOfCredits(Object.assign(new Error('Deadline exceeded'), { code: 'DEADLINE_EXCEEDED' }))).toBe(false);
  });
});
