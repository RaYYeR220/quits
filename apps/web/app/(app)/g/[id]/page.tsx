import type { Metadata } from 'next';
import { GroupView } from '@/components/group-view.tsx';

export const metadata: Metadata = { title: 'Group' };

export default async function GroupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <GroupView id={id} />;
}
