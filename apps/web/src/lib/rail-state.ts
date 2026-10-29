'use client';

import { useCallback, useEffect, useState } from 'react';

import { RAIL_MINI_KEY } from './rail-boot';

export const RAIL_GROUPS_KEY = 'flowboard-rail-groups';

const read = (key: string): string | null => { try { return localStorage.getItem(key); } catch { return null; } };
const write = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* private window or blocked storage: the choice just lasts for this visit */ } };

/** Icon-only rail. The width and labels follow html[data-rail], so React only mirrors it for aria and tooltips. */
export function useRailMini() {
  const [mini, setMini] = useState(false);
  useEffect(() => { setMini(document.documentElement.dataset.rail === 'mini'); }, []);
  const toggle = useCallback(() => {
    setMini((current) => {
      const next = !current;
      if (next) document.documentElement.dataset.rail = 'mini'; else delete document.documentElement.dataset.rail;
      write(RAIL_MINI_KEY, next ? '1' : '0');
      return next;
    });
  }, []);
  return [mini, toggle] as const;
}

/** Open/closed per sidebar group, remembered on this device. */
export function useRailGroups() {
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  useEffect(() => {
    try { const saved = JSON.parse(read(RAIL_GROUPS_KEY) ?? '{}'); if (saved && typeof saved === 'object') setClosed(saved as Record<string, boolean>); } catch { /* ignore a corrupt value */ }
  }, []);
  const toggle = useCallback((id: string) => {
    setClosed((current) => { const next = { ...current, [id]: !current[id] }; write(RAIL_GROUPS_KEY, JSON.stringify(next)); return next; });
  }, []);
  return [closed, toggle] as const;
}
