import type { CreateCardInput } from '@flowboard/contracts';
import { createRetainedCommand } from './retained-command.ts';
import { setUnsaved } from './unsaved.ts';
export type QuickDrafts=Record<string,{title:string;priority:string}>;
export function createQuickAddSessions(){
  const sessions=new Map<string,ReturnType<typeof make>>();
  function make(key:string){let value:{drafts:QuickDrafts;unresolved:string|null}={drafts:{},unresolved:null};const listeners=new Set<()=>void>();const commands=new Map<string,ReturnType<typeof createRetainedCommand<{boardId:string;input:CreateCardInput}>>>();const emit=()=>{setUnsaved(key,value.unresolved!==null||Object.values(value.drafts).some((d)=>!!d.title||!!d.priority));listeners.forEach((fn)=>fn());};return {commands,get:()=>value,subscribe:(fn:()=>void)=>{listeners.add(fn);return()=>{listeners.delete(fn);};},setDrafts(next:QuickDrafts|((old:QuickDrafts)=>QuickDrafts)){value={...value,drafts:structuredClone(typeof next==='function'?next(value.drafts):next)};emit();},setUnresolved(id:string|null){value={...value,unresolved:id};emit();}};}
  return {forBoards(actorId:string,boardIds:string[]){const key=`quick-add:${JSON.stringify([actorId,[...boardIds].sort()])}`;let found=sessions.get(key);if(!found){found=make(key);sessions.set(key,found);}return found;}};
}
export const quickAddSessions=createQuickAddSessions();
