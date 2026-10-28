'use client';

import { Suspense, useEffect } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';

/** Prototype screens/all-work.html: project work now opens in Board. Old links with ?board= or ?project= are forwarded. */
function AllWork() {
  const router = useRouter();
  const params = useSearchParams();
  const board = params.get('board');
  const project = params.get('project');
  const card = params.get('card');
  const target = board ? `/board?id=${encodeURIComponent(board)}${card ? `&card=${encodeURIComponent(card)}` : ''}` : project ? `/project?id=${encodeURIComponent(project)}` : null;
  useEffect(() => { if (target) router.replace(target); }, [target, router]);
  return (
    <main className="redirect-page" id="main" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
      <section className="redirect-card" aria-labelledby="redirectTitle" style={{ width: 'min(100%, 520px)', padding: 26, border: '1px solid var(--line)', borderRadius: 16, background: 'var(--surface)', boxShadow: 'var(--shadow-md)' }}>
        <p className="eyebrow">One Project workspace</p>
        <h1 id="redirectTitle" style={{ margin: '6px 0 8px', fontSize: 26, lineHeight: 1.15, letterSpacing: '-0.03em' }}>Project work now opens in Board</h1>
        <p style={{ color: 'var(--muted)', fontSize: 14, lineHeight: 1.55 }}>The full Board workspace shows every card from boards you can access within one project.</p>
        <div className="redirect-actions" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 18 }}>
          <Link className="btn primary" href={target ?? '/projects'}>Choose a project <span aria-hidden="true">→</span></Link>
          <Link className="btn" href="/projects">Browse projects</Link>
        </div>
      </section>
    </main>
  );
}

export default function AllWorkPage() {
  return <Suspense fallback={<div role="status" className="state-note">Loading…</div>}><AllWork /></Suspense>;
}
