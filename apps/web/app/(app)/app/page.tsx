import type { Metadata } from 'next';
import { GroupsView } from '@/components/groups-view.tsx';

export const metadata: Metadata = { title: 'Groups' };

export default function GroupsPage() {
  return <GroupsView />;
}
