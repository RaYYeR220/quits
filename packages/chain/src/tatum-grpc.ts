import { ChannelCredentials } from '@grpc/grpc-js';
import { GrpcWebFetchTransport, SuiGrpcClient } from '@mysten/sui/grpc';
import { GrpcTransport } from '@protobuf-ts/grpc-transport';
import {
  UnaryCall,
  type ClientStreamingCall,
  type DuplexStreamingCall,
  type MethodInfo,
  type RpcOptions,
  type RpcTransport,
  type ServerStreamingCall,
} from '@protobuf-ts/runtime-rpc';
import type { SuiGraphQLClient } from '@mysten/sui/graphql';
import { elapsedSince, noopCallLog, recordCall, type CallLog } from './calllog.ts';
import { LOCALNET_RPC_URL, TATUM_GRPC_HOST, type SuiNetwork } from './config.ts';
import { sharedLimiter, type Limiter } from './limiter.ts';
import { createTatumGraphQL } from './tatum-graphql.ts';

export interface MeterOptions {
  log: CallLog;
  /** `null` disables throttling (localnet, tests). */
  limiter: Limiter | null;
}

export interface TatumSuiOptions {
  apiKey?: string;
  network: SuiNetwork;
  log?: CallLog;
  /** Defaults to the shared 3 RPS limiter for `apiKey`; localnet is not throttled. */
  limiter?: Limiter | null;
  /** Localnet only: overrides `http://127.0.0.1:9000`. */
  rpcUrl?: string;
  /** Localnet only: overrides the local GraphQL endpoint. */
  graphqlUrl?: string;
}

export interface TatumSui {
  client: SuiGrpcClient;
  graphql: SuiGraphQLClient;
}

/**
 * Sui clients for Tatum's gateway. Mainnet and testnet use the native gRPC
 * transport (Tatum answers gRPC-web requests with plain gRPC framing, which the
 * SDK's default transport rejects), so this only runs server-side.
 */
export function createTatumSui({ apiKey, network, log = noopCallLog, limiter, rpcUrl, graphqlUrl }: TatumSuiOptions): TatumSui {
  const throttle = limiter !== undefined ? limiter : network === 'localnet' ? null : sharedLimiter(apiKey ?? '');
  const meter = { log, limiter: throttle };

  const inner: RpcTransport =
    network === 'localnet'
      ? new GrpcWebFetchTransport({ baseUrl: rpcUrl ?? LOCALNET_RPC_URL })
      : new GrpcTransport({
          host: TATUM_GRPC_HOST[network],
          channelCredentials: ChannelCredentials.createSsl(),
          meta: apiKey ? { 'x-api-key': apiKey } : {},
        });

  return {
    client: new SuiGrpcClient({ network, transport: meteredTransport(inner, meter) }),
    graphql: createTatumGraphQL({ apiKey, network, url: graphqlUrl, ...meter }),
  };
}

/** Wraps a transport so every call waits for the limiter and lands in the call log. */
export function meteredTransport(inner: RpcTransport, { log, limiter }: MeterOptions): RpcTransport {
  return {
    mergeOptions: (options) => inner.mergeOptions(options),

    unary<I extends object, O extends object>(method: MethodInfo<I, O>, input: I, options: RpcOptions): UnaryCall<I, O> {
      const name = methodName(method);
      let t0 = 0;
      const call = (limiter ? limiter.take() : Promise.resolve()).then(() => {
        t0 = performance.now();
        return inner.unary(method, input, options);
      });
      const response = call.then((c) => c.response);
      response.then(
        () => recordCall(log, { surface: 'grpc', method: name, ms: elapsedSince(t0), ok: true }),
        (err: unknown) => recordCall(log, { surface: 'grpc', method: name, ms: t0 ? elapsedSince(t0) : 0, ok: false, code: errorCode(err) }),
      );
      return new UnaryCall(
        method,
        options.meta ?? {},
        input,
        quiet(call.then((c) => c.headers)),
        quiet(response),
        quiet(call.then((c) => c.status)),
        quiet(call.then((c) => c.trailers)),
      );
    },

    serverStreaming<I extends object, O extends object>(method: MethodInfo<I, O>, input: I, options: RpcOptions): ServerStreamingCall<I, O> {
      // Long-lived subscriptions open once, so they bypass the limiter and are logged when they end.
      const t0 = performance.now();
      const call = inner.serverStreaming(method, input, options);
      call.status.then(
        () => recordCall(log, { surface: 'grpc', method: methodName(method), ms: elapsedSince(t0), ok: true }),
        (err: unknown) => recordCall(log, { surface: 'grpc', method: methodName(method), ms: elapsedSince(t0), ok: false, code: errorCode(err) }),
      );
      return call;
    },

    clientStreaming<I extends object, O extends object>(method: MethodInfo<I, O>, options: RpcOptions): ClientStreamingCall<I, O> {
      return inner.clientStreaming(method, options);
    },

    duplex<I extends object, O extends object>(method: MethodInfo<I, O>, options: RpcOptions): DuplexStreamingCall<I, O> {
      return inner.duplex(method, options);
    },
  };
}

function methodName(method: MethodInfo): string {
  const service = method.service.typeName.split('.').pop() ?? method.service.typeName;
  return `${service}.${method.name}`;
}

function errorCode(err: unknown): string | undefined {
  if (err && typeof err === 'object' && 'code' in err) return String((err as { code: unknown }).code);
  return undefined;
}

/** Marks a promise as handled; whoever awaits it still sees the rejection. */
function quiet<T>(p: Promise<T>): Promise<T> {
  p.catch(() => {});
  return p;
}
