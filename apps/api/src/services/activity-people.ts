import type pg from 'pg';
import type { PersonDisplay, Role } from '@flowboard/contracts';
import { computeNameSuffixes, withNameSuffix } from './person-suffix.ts';

interface HistoryRow { project_id:string; actor_id:string; safe_changes:Record<string,unknown>|null }
const keyOf=(projectId:string,userId:string)=>JSON.stringify([projectId,userId]);

/** Only server-produced assignment fields can request display identities. */
export function activityAssigneeReferences(changes:Record<string,unknown>|null):string[]{
  if(!changes||changes.purged===true||changes.redacted===true)return[];
  const ids=new Set<string>();
  const take=(value:unknown)=>{if(Array.isArray(value))for(const id of value.slice(0,20))if(typeof id==='string'&&id.length>0&&id.length<=200)ids.add(id);};
  const delta=changes.assignees;
  if(delta&&typeof delta==='object'&&!Array.isArray(delta)){take((delta as Record<string,unknown>).added);take((delta as Record<string,unknown>).removed);}
  const legacy=changes.assigneeIds;
  if(Array.isArray(legacy))take(legacy);
  else if(legacy&&typeof legacy==='object'){take((legacy as Record<string,unknown>).old);take((legacy as Record<string,unknown>).new);}
  // At most20old+20new; malformed legacy combinations cannot increase the bound.
  return[...ids].slice(0,40);
}

/** Called only after the feed's current access check and bounded page selection.
 * Two database reads cover all actors/references, not one group per identity.
 */
export async function loadActivityPeople(db:pg.Pool|pg.ClientBase,rows:readonly HistoryRow[]){
  if(rows.length>100)throw new Error('Activity identity lookup requires a bounded page.');
  const requested=new Map<string,{project_id:string;user_id:string;is_actor:boolean}>();
  for(const row of rows){
    const actorKey=keyOf(row.project_id,row.actor_id);
    requested.set(actorKey,{project_id:row.project_id,user_id:row.actor_id,is_actor:true});
    for(const id of activityAssigneeReferences(row.safe_changes)){
      const key=keyOf(row.project_id,id);
      if(!requested.has(key))requested.set(key,{project_id:row.project_id,user_id:id,is_actor:false});
    }
  }
  const people=new Map<string,{person:PersonDisplay;referenceAllowed:boolean}>();
  if(requested.size){
    const identities=await db.query<{
      project_id:string;user_id:string;display_name:string;avatar_url:string|null;
      scoped_role:Role;active_in_project:boolean;reference_allowed:boolean;
    }>(`/* activity_people_batch */
      WITH requested AS (SELECT * FROM jsonb_to_recordset($1::jsonb)
        AS r(project_id text,user_id text,is_actor boolean))
      SELECT r.project_id,u.id AS user_id,u.display_name,u.avatar_url,
        CASE WHEN w.owner_id=u.id THEN 'owner' ELSE COALESCE(pm.role,'viewer') END AS scoped_role,
        (w.owner_id=u.id OR COALESCE(pm.status='active',FALSE)) AS active_in_project,
        (w.owner_id=u.id OR pm.user_id IS NOT NULL) AS reference_allowed
      FROM requested r JOIN projects p ON p.id=r.project_id
      JOIN workspaces w ON w.id=p.workspace_id JOIN users u ON u.id=r.user_id
      LEFT JOIN project_memberships pm ON pm.project_id=p.id AND pm.user_id=u.id
      WHERE r.is_actor OR w.owner_id=u.id OR pm.user_id IS NOT NULL`,[JSON.stringify([...requested.values()])]);
    const projects=[...new Set(rows.map(row=>row.project_id))];
    const names=await db.query<{project_id:string;user_id:string;display_name:string;is_owner:boolean;joined_at:Date}>(
      `/* activity_name_suffixes_batch */
       SELECT p.id AS project_id,u.id AS user_id,u.display_name,TRUE AS is_owner,w.created_at AS joined_at
       FROM projects p JOIN workspaces w ON w.id=p.workspace_id JOIN users u ON u.id=w.owner_id WHERE p.id=ANY($1::text[])
       UNION ALL
       SELECT pm.project_id,u.id,u.display_name,FALSE,pm.created_at
       FROM project_memberships pm JOIN projects p ON p.id=pm.project_id
       JOIN workspaces w ON w.id=p.workspace_id JOIN users u ON u.id=pm.user_id
       WHERE pm.project_id=ANY($1::text[]) AND pm.status='active' AND pm.user_id<>w.owner_id`,[projects]);
    const candidates=new Map<string,typeof names.rows>();
    for(const row of names.rows){const list=candidates.get(row.project_id)??[];list.push(row);candidates.set(row.project_id,list);}
    const suffixes=new Map([...candidates].map(([projectId,candidate])=>[projectId,computeNameSuffixes(candidate)]));
    for(const row of identities.rows){
      const writable=row.scoped_role==='owner'||row.scoped_role==='manager'||row.scoped_role==='member';
      const person:PersonDisplay={id:row.user_id,displayName:row.display_name,avatarUrl:row.avatar_url,
        activeInProject:row.active_in_project,scopedRole:row.scoped_role,
        assignable:row.active_in_project&&writable,mentionable:row.active_in_project};
      people.set(keyOf(row.project_id,row.user_id),{person:withNameSuffix(person,suffixes.get(row.project_id)??new Map()),referenceAllowed:row.reference_allowed});
    }
  }
  return{
    actor(projectId:string,userId:string,includeSuffix=true):PersonDisplay|undefined{
      const found=people.get(keyOf(projectId,userId));if(!found)return undefined;
      const person={...found.person};if(!includeSuffix)delete person.nameSuffix;return person;
    },
    references(row:HistoryRow):PersonDisplay[]{
      return activityAssigneeReferences(row.safe_changes).flatMap(id=>{
        const found=people.get(keyOf(row.project_id,id));
        return found?.referenceAllowed?[{...found.person,assignable:false,mentionable:false}]:[];
      });
    },
  };
}
