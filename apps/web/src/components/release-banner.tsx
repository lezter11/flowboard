'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createReleaseStatusController } from '@/lib/release-status';

/** Public release notice, independent of identity and the application shell. */
export function ReleaseBanner() {
  const [active, setActive] = useState(false);
  const banner = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const controller = createReleaseStatusController({ fetcher: window.fetch.bind(window),
      isVisible: () => document.visibilityState === 'visible', onActive: setActive });
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
  }, [active]);
  return <div ref={banner} className="release-banner" role="status" aria-live="polite" aria-atomic="true">
    {active && <><strong>Update in progress</strong><span>We’re updating Flowboard. You can keep this page open.</span></>}
  </div>;
}
