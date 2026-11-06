import type { Metadata } from 'next';
import { ProofView } from '@/components/proof-view.tsx';

export const metadata: Metadata = { title: 'Proof' };

export default function ProofPage() {
  return <ProofView />;
}
