'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createReleaseStatusController, type ReleaseNotice } from '@/lib/release-status';

const copy = {
  update: ['Update in progress', 'We’re updating Flowboard. You can keep this page open.'],
  'planned-maintenance': ['Planned maintenance', 'Flowboard will be unavailable for about 2 hours. Timing to be announced.'],
};

/** Public release notice, independent of identity and the application shell. */
export function ReleaseBanner() {
  const [notice, setNotice] = useState<ReleaseNotice>(null);
  const banner = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const controller = createReleaseStatusController({ fetcher: window.fetch.bind(window),
      isVisible: () => document.visibilityState === 'visible', onNotice: setNotice });
    document.addEventListener('visibilitychange', controller.visibilityChanged);
    controller.start();
    return () => { document.removeEventListener('visibilitychange', controller.visibilityChanged); controller.stop(); };
  }, []);
  useLayoutEffect(() => {
    const node = banner.current;
    if (!node) return;
    const measure = () => document.documentElement.style.setProperty('--release-banner-height', `${Math.ceil(node.getBoundingClientRect().height)}px`);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => { observer.disconnect(); document.documentElement.style.removeProperty('--release-banner-height'); };
  }, [notice]);
  return <div ref={banner} className="release-banner" role="status" aria-live="polite" aria-atomic="true">
    {notice && <><strong>{copy[notice][0]}</strong><span>{copy[notice][1]}</span></>}
  </div>;
}
