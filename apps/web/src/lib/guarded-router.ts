'use client';
import { useMemo } from 'react';
import { useRouter as useNextRouter } from 'next/navigation';
import { hasUnsaved } from './unsaved';
import { navigationGuard } from './navigation-state';
/** Same-view card/filter changes keep drafts; crossing route context requires an explicit navigation choice. */
export function useRouter(){const router=useNextRouter();return useMemo(()=>({...router,push:(...args:Parameters<typeof router.push>)=>navigationGuard.request(window.location.href,args[0],hasUnsaved(),()=>router.push(...args)),replace:(...args:Parameters<typeof router.replace>)=>navigationGuard.request(window.location.href,args[0],hasUnsaved(),()=>router.replace(...args))}),[router]);}
