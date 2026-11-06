import { SuiGrpcClient } from '@mysten/sui/grpc';
import { RpcError, UnaryCall, type RpcOptions, type RpcTransport } from '@protobuf-ts/runtime-rpc';
import { describe, expect, it, vi } from 'vitest';
import { createMemoryCallLog } from '../src/calllog.ts';
import { createLimiter } from '../src/limiter.ts';
import { createTatumSui, meteredTransport } from '../src/tatum-grpc.ts';
import { meteredFetch } from '../src/tatum-graphql.ts';

function fakeTransport(respond: () => Promise<object>): RpcTransport {
  const unsupported = () => {
    throw new Error('not used');
  };
  return {
    mergeOptions: (options?: Partial<RpcOptions>) => ({ ...options }) as RpcOptions,
    unary(method, input, options) {
      const response = respond();
      return new UnaryCall(
        method,
        options.meta ?? {},
        input,
        Promise.resolve({}),
        response as Promise<never>,
        response.then(() => ({ code: 'OK', detail: '' })),
        Promise.resolve({}),
      );
    },
    serverStreaming: unsupported,
    clientStreaming: unsupported,
    duplex: unsupported,
  };
}

describe('metered grpc transport', () => {
  it('logs every unary call with its service method', async () => {
    const log = createMemoryCallLog();
    const transport = meteredTransport(fakeTransport(async () => ({})), { log, limiter: null });
    const client = new SuiGrpcClient({ network: 'mainnet', transport });

    await client.ledgerService.getServiceInfo({});

    expect(log.calls()).toEqual([
      expect.objectContaining({ surface: 'grpc', method: 'LedgerService.GetServiceInfo', ok: true }),
    ]);
  });

  it('logs a failed call with its status code and still rejects', async () => {
    const log = createMemoryCallLog();
    const transport = meteredTransport(
      fakeTransport(async () => {
        throw new RpcError('too many requests', 'RESOURCE_EXHAUSTED');
      }),
      { log, limiter: null },
    );
    const client = new SuiGrpcClient({ network: 'mainnet', transport });

    await expect(client.core.getBalance({ owner: '0x1' })).rejects.toThrow('too many requests');
    expect(log.calls()).toEqual([
      expect.objectContaining({ surface: 'grpc', method: 'StateService.GetBalance', ok: false, code: 'RESOURCE_EXHAUSTED' }),
    ]);
  });

  it('waits for the limiter before starting a call', async () => {
    vi.useFakeTimers();
    try {
      const limiter = createLimiter({ rps: 1 });
      const log = createMemoryCallLog();
      const transport = meteredTransport(fakeTransport(async () => ({})), { log, limiter });
      const client = new SuiGrpcClient({ network: 'mainnet', transport });

      const a = client.ledgerService.getServiceInfo({}).response;
      const b = client.ledgerService.getServiceInfo({}).response;
      await vi.advanceTimersByTimeAsync(0);
      expect(log.calls()).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1000);
      await Promise.all([a, b]);
      expect(log.calls()).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('metered graphql fetch', () => {
  it('names the call after the graphql operation', async () => {
    const log = createMemoryCallLog();
    const base = vi.fn(async () => new Response('{"data":{}}', { status: 200 }));
    const fetch = meteredFetch(base as typeof globalThis.fetch, { log, limiter: null });

    await fetch('https://example.test/graphql', {
      method: 'POST',
      body: JSON.stringify({ query: 'query getChainIdentifier { chainIdentifier }' }),
    });

    expect(log.calls()).toEqual([expect.objectContaining({ surface: 'graphql', method: 'getChainIdentifier', ok: true })]);
  });
});

describe('createTatumSui', () => {
  it('builds mainnet clients without touching the network', () => {
    const sui = createTatumSui({ apiKey: 'k', network: 'mainnet' });
    expect(sui.client).toBeInstanceOf(SuiGrpcClient);
    expect(sui.client.network).toBe('mainnet');
    expect(sui.graphql.network).toBe('mainnet');
  });
});
