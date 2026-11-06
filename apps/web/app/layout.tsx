import type { Metadata, Viewport } from 'next';
import { Geist_Mono, Manrope } from 'next/font/google';
import './globals.css';

const manrope = Manrope({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-manrope', display: 'swap' });
const geistMono = Geist_Mono({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-geist-mono', display: 'swap' });

export const metadata: Metadata = {
  title: { default: 'Quits — the group tab that learns your unwritten rules', template: '%s · Quits' },
  description: 'Split shared expenses the way your group actually does. Quits remembers every correction in Walrus Memory and settles debts in USDC on Sui.',
};

export const viewport: Viewport = { themeColor: '#17120d', colorScheme: 'dark' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${manrope.variable} ${geistMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
