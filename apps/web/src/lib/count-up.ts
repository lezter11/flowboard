'use client';

import { useEffect, useRef, useState } from 'react';

/** Counts from the previous value to `target` in about 450 ms; shows the number at once under prefers-reduced-motion. */
export function useCountUp(target: number, duration = 450): number {
  const [value, setValue] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    if (typeof window === 'undefined' || window.matchMedia('(prefers-reduced-motion: reduce)').matches || target === from.current) {
      from.current = target; setValue(target); return;
    }
    const start = performance.now();
    const origin = from.current;
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - t) ** 3;
      setValue(Math.round(origin + (target - origin) * eased));
      if (t < 1) frame = requestAnimationFrame(tick); else from.current = target;
    };
    frame = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(frame); from.current = target; };
  }, [target, duration]);
  return value;
}
