import type { Metadata } from 'next';
import { DemoPicker } from '@/components/demo-picker.tsx';

export const metadata: Metadata = { title: 'Try the demo' };

export default function DemoPage() {
  return <DemoPicker />;
}
