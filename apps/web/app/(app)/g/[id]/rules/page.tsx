import type { Metadata } from 'next';
import { RulesView } from '@/components/rules-view.tsx';

export const metadata: Metadata = { title: 'What Quits has learned' };

export default async function RulesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <RulesView id={id} />;
}
