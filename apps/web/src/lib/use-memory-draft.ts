'use client';
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { memoryDrafts } from './memory-drafts';
export function useMemoryValue<T>(scope:readonly unknown[],initial:T|(()=>T)){
  const signature=JSON.stringify(scope);
  const entry=useMemo(()=>memoryDrafts.value<T>(JSON.parse(signature),()=>typeof initial==='function'?(initial as ()=>T)():initial),[signature]);
  const value=useSyncExternalStore(entry.subscribe,entry.get,entry.get);
  return [value,entry.set] as const;
}
export function useMemoryRef<T>(scope:readonly unknown[],initial:()=>T){const signature=JSON.stringify(scope);return useMemo(()=>memoryDrafts.ref<T>(JSON.parse(signature),initial),[signature]);}
export function useMemoryCommand<T>(scope:readonly unknown[]){const signature=JSON.stringify(scope);return useMemo(()=>memoryDrafts.command<T>(JSON.parse(signature)),[signature]);}
/** The marker belongs to the stored draft, so unmounting the form must not clear it. */
export function useMemoryDirty(scope:readonly unknown[],dirty:boolean){const signature=JSON.stringify(scope);useEffect(()=>memoryDrafts.mark(JSON.parse(signature),dirty),[signature,dirty]);return ()=>memoryDrafts.mark(JSON.parse(signature),false);}
