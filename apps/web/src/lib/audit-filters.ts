import type { ActivityFeedQuery } from '@flowboard/contracts';
export type AuditFilters={projectId:string;cardId:string;actorId:string;action:string;fromDate:string;toDate:string};
export const EMPTY_AUDIT_FILTERS:AuditFilters={projectId:'',cardId:'',actorId:'',action:'',fromDate:'',toDate:''};
export function auditServerFilters(input:AuditFilters):Partial<ActivityFeedQuery>{
  const output:Partial<ActivityFeedQuery>={};
  for(const key of ['projectId','cardId','actorId','action']as const)if(input[key].trim())output[key]=input[key].trim();
  if(input.fromDate)output.fromDate=`${input.fromDate}T00:00:00.000Z`;
  if(input.toDate)output.toDate=`${input.toDate}T23:59:59.999Z`;
  if(output.fromDate&&output.toDate&&output.fromDate>output.toDate)throw new Error('The through date must be on or after the from date.');
  return output;
}
