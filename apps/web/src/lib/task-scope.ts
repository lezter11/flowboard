import type { SessionProjectSummary } from '@flowboard/contracts';
/** An explicit inaccessible project never falls back to another project's data. */
export function selectedTaskProject(projects:SessionProjectSummary[],explicit:string|null,current:string|null=null) {
  const active=projects.filter((p)=>!p.isArchived);
  if(explicit) return active.find((p)=>p.id===explicit)??null;
  return active.find((p)=>p.id===current)??active[0]??null;
}
