import type { SessionData } from '@flowboard/contracts';
export type SessionState = {status:'loading'} | {status:'signedOut'} | {status:'error';message:string} | {status:'ready';session:SessionData};
/** A refused refresh invalidates the old authenticated answer even if the query still has stale data. */
export function sessionState(data:SessionData|undefined,error:unknown,isError:boolean,errorText:string):SessionState {
  if(isError && typeof error==='object' && error!==null && 'status' in error && error.status===401) return {status:'signedOut'};
  if(data) return {status:'ready',session:data};
  if(isError) return {status:'error',message:errorText};
  return {status:'loading'};
}
export function accessFingerprint(state:SessionState):string|null {
  if(state.status==='signedOut') return 'signedOut';
  if(state.status!=='ready') return null;
  return JSON.stringify([state.session.actor.id,state.session.accessibleProjects.map((p)=>[p.id,p.role,p.isArchived]).sort((a,b)=>String(a[0]).localeCompare(String(b[0])))]);
}
