import type { SessionWorkspaceSummary } from '@flowboard/contracts';
import { setUnsaved } from './unsaved.ts';
import { registerProtectedDraft } from './protected-drafts.ts';
export function safeGoogleAvatar(value:string|null|undefined):string|null {
  if(!value||value.length>2048)return null;
  try {const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password&&!url.port&&/^lh[3-6]\.googleusercontent\.com$/.test(url.hostname)?url.href:null;}catch{return null;}
}
export function validTimezone(value:string):boolean {if(!value.trim()||value.length>100)return false;try{new Intl.DateTimeFormat('en',{timeZone:value.trim()}).format();return true;}catch{return false;}}
export type WorkspaceDraft={name:string;timezone:string;expectedVersion:number;baseName:string;baseTimezone:string};
export const workspaceDraftDirty=(draft:WorkspaceDraft)=>draft.name.trim()!==draft.baseName||draft.timezone.trim()!==draft.baseTimezone;
export function createWorkspaceDrafts(){
  const entries=new Map<string,ReturnType<typeof make>>();
  function make(key:string,actorId:string,workspace:SessionWorkspaceSummary){let retained:Set<string>|null=null;let draft:WorkspaceDraft={name:workspace.name,timezone:workspace.timezone,expectedVersion:workspace.version,baseName:workspace.name,baseTimezone:workspace.timezone};const listeners=new Set<()=>void>();registerProtectedDraft(Symbol(key),{actorId,workspaceId:workspace.id},()=>{retained??=new Set([...(draft.name!==draft.baseName?['name']:[]),...(draft.timezone!==draft.baseTimezone?['timezone']:[])]);draft={...draft,name:retained.has('name')?draft.name:'',timezone:retained.has('timezone')?draft.timezone:'',baseName:'',baseTimezone:'',expectedVersion:0};setUnsaved(key,retained.size>0);listeners.forEach((fn)=>fn());});return {get:()=>draft,subscribe:(fn:()=>void)=>{listeners.add(fn);return()=>{listeners.delete(fn);};},update(patch:Partial<WorkspaceDraft>){draft={...draft,...patch};setUnsaved(key,workspaceDraftDirty(draft));listeners.forEach((fn)=>fn());},observe(next:SessionWorkspaceSummary){if(retained!==null){const changed=retained.size>0;this.update({name:retained.has('name')?draft.name:next.name,timezone:retained.has('timezone')?draft.timezone:next.timezone,baseName:next.name,baseTimezone:next.timezone,expectedVersion:changed?0:next.version});retained=null;return;}if(!workspaceDraftDirty(draft)||(draft.name.trim()===next.name&&draft.timezone.trim()===next.timezone))this.update({name:next.name,timezone:next.timezone,expectedVersion:next.version,baseName:next.name,baseTimezone:next.timezone});},useLatestVersion(next:SessionWorkspaceSummary){this.update({expectedVersion:next.version,baseName:next.name,baseTimezone:next.timezone});}};}
  return {forWorkspace(actorId:string,workspace:SessionWorkspaceSummary){const key=`workspace:${JSON.stringify([actorId,workspace.id])}`;let entry=entries.get(key);if(!entry){entry=make(key,actorId,workspace);entries.set(key,entry);}return entry;}};
}
export const workspaceDrafts=createWorkspaceDrafts();
