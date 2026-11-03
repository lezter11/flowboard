import type { CommitImportInput, ImportRow, ImportState, ImportStatus } from '@flowboard/contracts';
import { formatPersonName } from './person-name.ts';
import { ApiError } from './api.ts';
import { createRetainedCommand } from './retained-command.ts';
import { setUnsaved } from './unsaved.ts';
export const importProcessing = (state:ImportState) => ['uploaded','validating','committing'].includes(state);
export function importStateText(state:ImportState) {return {uploaded:'Workbook uploaded. Waiting for validation.',validating:'Validating workbook. No cards created yet.',invalid:'Preview needs correction. No cards created.',ready:'Preview ready. Confirm explicitly to create new cards.',committing:'Import is being committed. Waiting for its actual result.',committed:'Import committed.',failed:'Import failed. Review its outcome before trying again.',cancelled:'Preview cancelled.',expired:'Preview expired. Upload the workbook again.'}[state];}
export function importRowsPage(status:ImportStatus,expected:Pick<ImportStatus,'id'|'version'|'state'|'previewDigest'>) {
  if(status.id!==expected.id || status.version!==expected.version || status.state!==expected.state || status.previewDigest!==expected.previewDigest) throw new ApiError(409,'STALE_CURSOR','The import changed. Reload its current preview.');
  return {data:status.rows.map((row)=>({...row,id:String(row.rowNumber)})),nextCursor:status.nextCursor};
}
export const importMappingValue=(mappings:Record<string,string>,source:string)=>Object.hasOwn(mappings,source)&&typeof mappings[source]==='string'?mappings[source]!:'';
export const unknownImportStatuses=(rows:ImportRow[])=>[...new Set(rows.filter((row)=>row.errors.some((e)=>e.code==='UNRECOGNIZED_STATUS')).map((row)=>row.status).filter((s):s is string=>!!s))];
export const importedCardHref=(boardId:string,row:Pick<ImportRow,'cardId'>)=>row.cardId?`/board?id=${encodeURIComponent(boardId)}&card=${encodeURIComponent(row.cardId)}`:null;
export const importRowLabel=(row:Pick<ImportRow,'title'|'rowNumber'|'contentRedacted'>)=>row.contentRedacted?`Open card from row ${row.rowNumber}`:row.title||`Untitled source row ${row.rowNumber}`;
export function createImportSessions(){
  const sessions=new Map<string,ReturnType<typeof make>>();
  function make(key:string){let draft:{mappings:Record<string,string>;commit:CommitImportInput|null}={mappings:{},commit:null};const listeners=new Set<()=>void>();const command=createRetainedCommand<CommitImportInput>();return {command,get:()=>draft,subscribe:(fn:()=>void)=>{listeners.add(fn);return()=>{listeners.delete(fn);};},update(patch:Partial<typeof draft>){draft={...draft,...structuredClone(patch)};setUnsaved(key,!!draft.commit||Object.keys(draft.mappings).length>0);listeners.forEach((fn)=>fn());}};}
  return {forBatch(actorId:string,id:string){const key=`import:${JSON.stringify([actorId,id])}`;let found=sessions.get(key);if(!found){found=make(key);sessions.set(key,found);}return found;}};
}
export const importSessions=createImportSessions();

export function importReceiptActors(status:ImportStatus){return {uploader:status.createdBy?formatPersonName(status.createdBy,'Former project member'):status.createdById?'Former project member':'Unknown uploader',confirmer:status.committedBy?formatPersonName(status.committedBy,'Former project member'):status.committedById?'Former project member':status.state==='committed'?'Unknown confirmer':null};}
