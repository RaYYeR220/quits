import { normalizeSuiAddress } from '@mysten/sui/utils';
import { describe, expect, it } from 'vitest';
import { USDC_MAINNET } from '../src/config.ts';
import { gaslessUsdcTx } from '../src/usdc.ts';

describe('gaslessUsdcTx', () => {
  const to = '0x' + 'b'.repeat(64);

  it('is a bare send-funds PTB with zero gas price and no gas payment', () => {
    const data = gaslessUsdcTx({ to, amount: 10_000n }).getData();

    expect(data.gasData).toMatchObject({ price: '0', budget: '0', payment: [] });
    expect(data.commands.map((c) => `${normalizeSuiAddress(c.MoveCall!.package)}::${c.MoveCall!.module}::${c.MoveCall!.function}`)).toEqual([
      `${normalizeSuiAddress('0x2')}::balance::redeem_funds`,
      `${normalizeSuiAddress('0x2')}::balance::send_funds`,
    ]);
    expect(data.commands.every((c) => c.MoveCall!.typeArguments.length === 1)).toBe(true);
    expect(data.inputs[0]).toMatchObject({ $kind: 'FundsWithdrawal' });
    expect(data.commands[0]!.MoveCall!.typeArguments[0]).toContain('::usdc::USDC');
    expect(USDC_MAINNET).toContain('::usdc::USDC');
  });

  it('refuses amounts under the 0.01 USDC gasless floor', () => {
    expect(() => gaslessUsdcTx({ to, amount: 9_999n })).toThrow(RangeError);
  });
});
