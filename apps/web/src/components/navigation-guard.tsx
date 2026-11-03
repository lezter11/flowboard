'use client';
import { useEffect, useSyncExternalStore } from 'react';
import { useRouter as useNextRouter } from 'next/navigation';
import { hasUnsaved } from '@/lib/unsaved';
import { navigationGuard, sameDraftScope } from '@/lib/navigation-state';
import { DialogLayer } from './ui/dialog-layer';

export function NavigationGuard(){
  const router=useNextRouter();const pending=useSyncExternalStore(navigationGuard.subscribe,navigationGuard.get,()=>null);
  useEffect(()=>{const click=(event:MouseEvent)=>{if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.altKey||event.shiftKey||!hasUnsaved())return;const anchor=event.target instanceof Element?event.target.closest('a[href]'):null;if(!(anchor instanceof HTMLAnchorElement)||anchor.download||anchor.target&&anchor.target!=='_self')return;const url=new URL(anchor.href,window.location.href);if(url.origin!==window.location.origin||sameDraftScope(window.location.href,url.href))return;event.preventDefault();event.stopImmediatePropagation();navigationGuard.request(window.location.href,url.href,true,()=>router.push(url.pathname+url.search+url.hash));};document.addEventListener('click',click,true);return()=>document.removeEventListener('click',click,true);},[router]);
  return <DialogLayer open={!!pending} onClose={()=>navigationGuard.stay()} labelledBy="navigationTitle" describedBy="navigationCopy" role="alertdialog"><div className="dialog-head"><h2 id="navigationTitle">Leave with unsaved changes?</h2></div><div className="dialog-body"><p id="navigationCopy">Your unsaved forms, card and comment drafts, and selected import file stay in this tab when you return. In-progress uploads may stop when you leave. Reloading or closing the tab can lose all drafts.</p></div><footer className="dialog-foot"><button className="btn primary" type="button" data-autofocus onClick={()=>navigationGuard.stay()}>Stay and finish</button><button className="btn" type="button" onClick={()=>navigationGuard.leave()}>Leave this view</button></footer></DialogLayer>;
}
