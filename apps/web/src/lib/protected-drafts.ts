/** Protected fetched baselines live outside QueryClient too. Keep only a person's own unsent work on access loss. */
export interface DraftResource { actorId:string; projectId?:string; boardId?:string; cardId?:string; workspaceId?:string }
const resources=new Map<unknown,{resource:DraftResource;redact:()=>void}>();
export function registerProtectedDraft(key:unknown,resource:DraftResource,redact:()=>void){resources.set(key,{resource,redact});}
export function redactProtectedDrafts(scope:Partial<DraftResource>={}){
  for(const {resource,redact} of resources.values())if(Object.entries(scope).every(([key,value])=>resource[key as keyof DraftResource]===value))redact();
}
/** Match existing actual query keys, never derive access from a cached person's role. */
export function redactRefusedDrafts(key:readonly unknown[]){
  if((key[0]==='card'||key[0]==='comments')&&typeof key[1]==='string')redactProtectedDrafts({cardId:key[1],...(typeof key[2]==='string'?{actorId:key[2]}:{})});
  if((key[0]==='board'||key[0]==='board-stats')&&typeof key[1]==='string')redactProtectedDrafts({boardId:key[1]});
  if(key[0]==='project'&&typeof key[1]==='string')redactProtectedDrafts({projectId:key[1]});
}

/** An unrelated project addition is a scope gain; it must not erase still-authorized forms. */
export function redactSessionDraftTransition(previous:string,next:string){
  if(previous===next||previous==='signedOut')return;
  const [actorId,projects]=JSON.parse(previous) as [string,Array<[string,string,boolean]>];
  if(next==='signedOut'){redactProtectedDrafts({actorId});return;}
  const [nextActor,nextProjects]=JSON.parse(next) as [string,Array<[string,string,boolean]>];
  if(actorId!==nextActor){redactProtectedDrafts({actorId});return;}
  const current=new Map(nextProjects.map(([id,role,archived])=>[id,{role,archived}]));
  for(const [projectId,role,archived] of projects){const now=current.get(projectId);if(!now||now.role!==role||now.archived!==archived)redactProtectedDrafts({actorId,projectId});}
}
