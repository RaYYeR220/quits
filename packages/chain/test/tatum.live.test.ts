import { describe, expect, it } from 'vitest';
import { createMemoryCallLog } from '../src/calllog.ts';
import { USDC_MAINNET } from '../src/config.ts';
import { createTatumSui } from '../src/tatum-grpc.ts';

describe.skipIf(!process.env.TATUM_LIVE)('Tatum mainnet gateway', () => {
  it('answers over native gRPC and every call is logged', async () => {
    const log = createMemoryCallLog();
    const { client } = createTatumSui({ apiKey: process.env.TATUM_API_KEY, network: 'mainnet', log });

    const { chainIdentifier } = await client.core.getChainIdentifier();
    const { coinMetadata } = await client.core.getCoinMetadata({ coinType: USDC_MAINNET });

    expect(chainIdentifier).toBe('4btiuiMPvEENsttpZC7CZ53DruC3MAgfznDbASZ7DR6S');
    expect(coinMetadata?.decimals).toBe(6);
    expect(log.calls().every((c) => c.surface === 'grpc' && c.ok)).toBe(true);
    expect(log.calls().length).toBeGreaterThanOrEqual(2);
  });
});
