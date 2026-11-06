import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Quits — the group tab that learns your unwritten rules',
  description: 'Split shared expenses the way your group actually does. Quits remembers every correction in Walrus Memory and settles debts in USDC on Sui.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
