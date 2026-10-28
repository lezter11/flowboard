import type { Metadata } from 'next';
import Link from 'next/link';
import { Wordmark } from '@/components/ui/wordmark';

export const metadata: Metadata = { title: 'Accept invitation — Flowboard' };

export default function Page() {
  return (
    <main className="state-note" style={{ marginTop: 96 }}>
      <Wordmark inline />
      <h1>Accept invitation</h1>
      <p>Accepting invitations is coming soon. Nothing was granted to your account.</p>
      <Link className="btn" href="/signin">Go to sign in</Link>
    </main>
  );
}
