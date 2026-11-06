import { DEMO_TERMS } from '@/lib/mandates.ts';
import { SessionProvider, type Net } from '@/components/session.tsx';
import { AppShell } from '@/components/shell.tsx';
import { WalletProvider } from '@/components/wallet.tsx';
import type { MandateTerms } from '@/components/types.ts';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  // Explorer links point at the network the API settles on (mirrors lib/paydebt explorerTx).
  const net: Net = process.env.SUI_NETWORK?.trim() === 'localnet' ? 'localnet' : 'mainnet';
  // The bounds every demo mandate signs, straight from the server so the screen never drifts from them.
  const demoTerms: MandateTerms = {
    lifetimeCap: DEMO_TERMS.lifetimeCap.toString(),
    weeklyLimit: DEMO_TERMS.weeklyLimit.toString(),
    maxPerDebt: DEMO_TERMS.maxPerDebt.toString(),
    objectionWindowMs: DEMO_TERMS.objectionWindowMs,
    days: DEMO_TERMS.days,
  };
  return (
    <WalletProvider>
      <SessionProvider net={net} demoTerms={demoTerms}>
        <AppShell>{children}</AppShell>
      </SessionProvider>
    </WalletProvider>
  );
}
