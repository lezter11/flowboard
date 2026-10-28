'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function HomePage() {
  const router = useRouter();
  useEffect(() => { router.replace('/projects'); }, [router]);
  return <div className="flex-1 p-12 text-sm text-muted">Loading...</div>;
}
