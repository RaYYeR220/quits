import Link from 'next/link';

export default function Home() {
  return (
    <main className="p-10 text-xl">
      Quits{' '}
      <Link href="/demo" className="link text-base">
        Try the demo
      </Link>
    </main>
  );
}
