/** Current verified tab identity, only for pausing in-memory work between async stages. Server authorization remains mandatory. */
let actor:string|null=null;
export const currentSessionActor=()=>actor;
export function setCurrentSessionActor(id:string|null){actor=id;}
