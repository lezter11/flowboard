import type { Metadata } from 'next';
import Link from 'next/link';
import { Wordmark } from '@/components/ui/wordmark';

export const metadata: Metadata = { title: 'Invitation — Flowboard' };

export default function Page() {
  return (
    <main className="state-note" style={{ marginTop: 96 }}>
      <Wordmark inline />
      <h1>Invitation</h1>
      <p>Invitations are coming soon. Ask a project owner or manager to add you once they are available.</p>
      <Link className="btn" href="/signin">Go to sign in</Link>
    </main>
  );
}
