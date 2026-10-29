'use client';

import { useEffect } from 'react';
import { api } from '@/lib/api';

let lastSent = '';
let timer: number | undefined;

/**
 * Tells the API which project/board the user is looking at, so the next visit can start there.
 * Called only after a page has loaded its data. Fire and forget: debounced, sent once per change,
 * never retried, and errors are ignored (the pointer is a convenience, not state).
 */
export function useRememberLocation(projectId: string | null | undefined, boardId: string | null) {
  useEffect(() => {
    if (!projectId) return;
    const key = `${projectId}|${boardId ?? ''}`;
    if (key === lastSent) return;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      lastSent = key;
      api.putLastLocation(projectId, boardId).catch(() => {});
    }, 800);
    return () => window.clearTimeout(timer);
  }, [projectId, boardId]);
}
