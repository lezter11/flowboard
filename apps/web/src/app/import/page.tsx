'use client';

import { Suspense, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useRouter } from '@/lib/guarded-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ImportRow, ImportStatus } from '@flowboard/contracts';
import { api, ApiError } from '@/lib/api';
import { can, normalizeRole } from '@/lib/roles';
import { useProjectBoards } from '@/lib/portfolio';
import { useSession } from '@/lib/session';
import { useCursorFeed } from '@/lib/cursor-feed';
import { discardRefusedRows } from '@/lib/feed-state';
import { importReceiptActors, importProcessing, importMappingValue, importRowsPage, importSessions, importedCardHref, importRowLabel, importStateText, unknownImportStatuses } from '@/lib/import-state';
import { useMemoryValue, useMemoryDirty } from '@/lib/use-memory-draft';
import { usePollKeys } from '@/components/polling';
import { Icon } from '@/components/ui/icon';
import { DialogLayer } from '@/components/ui/dialog-layer';
import { ErrorNote } from '@/components/ui/error-note';
import { FeedControls } from '@/components/ui/feed-controls';
import { useToast } from '@/components/ui/toasts';

const MAX_BYTES=5*1024*1024;
const reportName='flowboard-import-report.csv';
function Counts({status}:{status:ImportStatus}){return <div className="preview-summary">{([['Nonempty rows',status.counts.total],['New',status.counts.new],['Already imported',status.counts.existing],['Invalid',status.counts.invalid],['Conflicts',status.counts.conflict],['Created',status.counts.created],['Skipped',status.counts.skipped]] as const).map(([label,count])=><div className="preview-stat" key={label}><span className="label">{label}</span><span className="value">{count}</span></div>)}</div>;}

function ImportScreen(){
  const params=useSearchParams(); const router=useRouter();const queryClient=useQueryClient();const toast=useToast();const {state}=useSession();
  const actorId=state.status==='ready'?state.session.actor.id:'';
  const projects=state.status==='ready'?state.session.accessibleProjects:[];
  const adminProjects=projects.filter((p)=>can(normalizeRole(p.role),'manageBoard'));
  const targetScope=['import-target',actorId,params.get('project')??'',params.get('board')??''];
  const [projectId,setProjectId]=useMemoryValue([...targetScope,'project'],params.get('project')??'');
  const project=projectId?adminProjects.find((p)=>p.id===projectId):adminProjects.find((p)=>!p.isArchived);
  const boards=useProjectBoards(project?.id??null);
  const boardList=(boards.data??[]).filter((b)=>!b.isArchived);
  const [boardId,setBoardId]=useMemoryValue([...targetScope,'board'],params.get('board')??'');
  const board=boardId?boardList.find((b)=>b.id===boardId):boardList[0];
  const snapshot=useQuery({queryKey:['board',board?.id],queryFn:({signal})=>api.getBoardSnapshot(board!.id,{cardLimitPerColumn:1},signal).then((r)=>r.data),enabled:!!board&&!!actorId});
  const columns=[...(snapshot.data?.columns??[])].sort((a,b)=>a.position-b.position);
  const [columnId,setColumnId]=useMemoryValue([...targetScope,'column'],'');const column=columns.find((c)=>c.id===columnId)??columns[0];
  const [batchId,setBatchId]=useState(params.get('import')??'');
  const statusKey=useMemo(()=>['import-status',batchId,actorId] as const,[batchId,actorId]);
  const statusQuery=useQuery({queryKey:statusKey,queryFn:({signal})=>api.getImportStatus(batchId,{signal}).then((r)=>r.data),enabled:!!batchId&&!!actorId&&!!adminProjects.length,retry:false,refetchInterval:(query)=>query.state.data&&importProcessing(query.state.data.state)?1500:false});
  usePollKeys([statusKey],!!batchId&&!!actorId&&!!adminProjects.length);
  useEffect(()=>{discardRefusedRows(queryClient,statusKey,statusQuery.error);},[queryClient,statusKey,statusQuery.error]);
  const refused=statusQuery.error instanceof ApiError&&[401,403,404].includes(statusQuery.error.status);
  const candidate=statusQuery.data;
  const batchProject=candidate?adminProjects.find((p)=>p.id===candidate.projectId):null;
  const status=!refused&&actorId&&batchProject?candidate:undefined;
  useEffect(()=>{if(status){setProjectId(status.projectId);setBoardId(status.boardId);}},[status?.id,status?.projectId,status?.boardId]);
  const batchSession=useMemo(()=>importSessions.forBatch(actorId,batchId),[actorId,batchId]);
  const draft=useSyncExternalStore(batchSession.subscribe,batchSession.get,batchSession.get);
  const rowsKey=useMemo(()=>['import-rows',batchId,actorId,status?.version,status?.state,status?.previewDigest] as const,[batchId,actorId,status?.version,status?.state,status?.previewDigest]);
  const rowFeed=useCursorFeed<ImportRow & {id:string}>(rowsKey,async(cursor,signal)=>importRowsPage((await api.getImportStatus(batchId,{cursor,signal})).data,status!),!!status&&!importProcessing(status.state));
  const rows=rowFeed.items;const unknown=unknownImportStatuses(rows);
  const [file,setFile]=useMemoryValue<File|null>(['import-file',actorId,project?.id??'',board?.id??''],null);const [fileError,setFileError]=useState('');const input=useRef<HTMLInputElement>(null);
  const [confirm,setConfirm]=useState(false);const [downloadError,setDownloadError]=useState<unknown>(null);const [downloading,setDownloading]=useState(false);
  const clearFileDirty=useMemoryDirty(['import-file',actorId,project?.id??'',board?.id??'','dirty'],!!file&&!batchId);
  const live=useRef({actorId});live.current={actorId};
  const writable=!!status&&!batchProject?.isArchived&&!refused&&!!actorId&&board?.id===status.boardId&&snapshot.data?.board.id===status.boardId&&!snapshot.error;
  const commit=useMutation({mutationFn:async()=>{
    const original=batchSession.get().commit??(status?.previewDigest?{previewDigest:status.previewDigest,defaultColumnId:status.defaultColumnId,expectedVersion:status.version}:null);
    if(!original)throw new Error('Reload a ready preview before confirming.');
    batchSession.update({commit:original});return batchSession.command.run(original,(body,key)=>api.commitImport(batchId,body,key));
  },onSuccess:(response)=>{batchSession.update({commit:null,mappings:{}});setConfirm(false);queryClient.setQueryData(statusKey,response.data);if(response.data.state==='committed')toast(`${response.data.counts.created} cards created · ${response.data.counts.skipped} skipped`,{icon:'check-circle'});else void statusQuery.refetch();void queryClient.invalidateQueries({queryKey:['board']});},onError:()=>{if(!batchSession.command.unresolved())batchSession.update({commit:null});setConfirm(false);void statusQuery.refetch();}});
  const locked=commit.isPending||batchSession.command.unresolved()||!!status&&importProcessing(status.state);
  const upload=useMutation({mutationFn:()=>{if(!file||!board||!column||project?.isArchived)throw new Error('Choose an active authorized board, column and workbook.');return api.createImport(board.id,file,column.id);},onSuccess:(response)=>{if(live.current.actorId!==actorId)return;const next=response.data;queryClient.setQueryData(['import-status',next.id,actorId],next);setBatchId(next.id);setProjectId(next.projectId);setBoardId(next.boardId);setFile(null);clearFileDirty();router.replace(`/import?project=${encodeURIComponent(next.projectId)}&board=${encodeURIComponent(next.boardId)}&import=${encodeURIComponent(next.id)}`);}});
  const mapping=useMutation({mutationFn:()=>{if(!status)throw new Error('Reload the preview.');return api.updateImportMappings(batchId,{mappings:draft.mappings,expectedVersion:status.version});},onSuccess:(response)=>{batchSession.update({mappings:{}});queryClient.setQueryData(statusKey,response.data);},onError:()=>{void statusQuery.refetch();}});
  const cancel=useMutation({mutationFn:()=>api.cancelImport(batchId),onSuccess:()=>{toast('Preview cancelled',{icon:'check'});void statusQuery.refetch();},onError:()=>{void statusQuery.refetch();}});
  const choose=(picked:File|undefined)=>{setFileError('');if(!picked)return;if(!/\.xlsx$/i.test(picked.name)){setFileError('Choose an .xlsx workbook.');return;}if(!picked.size||picked.size>MAX_BYTES){setFileError('Choose a nonempty workbook no larger than 5 MiB.');return;}setFile(picked);};
  const startAnother=()=>{if(locked)return;batchSession.update({mappings:{},commit:null});setBatchId('');setFile(null);router.replace(`/import${project?`?project=${encodeURIComponent(project.id)}`:''}`);};
  const report=async()=>{setDownloading(true);setDownloadError(null);try{const blob=await api.getImportReport(batchId);const url=URL.createObjectURL(blob);const anchor=document.createElement('a');anchor.href=url;anchor.download=reportName;document.body.appendChild(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(error){setDownloadError(error);}finally{setDownloading(false);}};

  if(state.status==='ready'&&!adminProjects.length)return <section className="ph-empty"><Icon name="lock" /><h1>Import is unavailable</h1><p>Only project Owners and Managers can import cards.</p><Link className="btn" href="/projects">Browse projects</Link></section>;
  return <div id="importContent">
    <div className="page-head"><div className="page-head-copy"><p className="eyebrow">{status?batchProject?.name:project?.name??'Project'} <span className="badge">Create-only XLSX</span></p><h1>Import cards</h1><p className="page-sub">Seven template columns · 200 nonempty rows · 5 MiB · atomic commit</p></div><div className="page-actions">{(status?.boardId??board?.id)&&<Link className="btn" href={`/board?id=${encodeURIComponent(status?.boardId??board!.id)}`}>Back to board</Link>}{!batchId&&board&&<a className="btn ghost" href={`/api/v1/boards/${encodeURIComponent(board.id)}/import-template`} download>Download template</a>}</div></div>
    <div className="review-bar"><Icon name="shield" /><span><strong>Preview creates no cards.</strong> Review every row, map statuses if needed, then confirm the whole batch explicitly. Existing unchanged rows skip; one invalid or conflicting row blocks all new cards.</span></div>
    {!batchId?<section className="panel" aria-labelledby="uploadTitle"><div className="panel-head"><h2 id="uploadTitle">Upload a workbook</h2></div><div className="panel-body stack">
      <div className="form-grid"><div className="field"><label htmlFor="importProject">Project</label><select className="control" id="importProject" value={project?.id??''} disabled={upload.isPending} onChange={(e)=>{setProjectId(e.target.value);setBoardId('');setColumnId('');}}>{!project&&<option value="">Choose an active project</option>}{adminProjects.filter((p)=>!p.isArchived).map((p)=><option key={p.id} value={p.id}>{p.name}</option>)}</select></div><div className="field"><label htmlFor="importBoard">Destination board</label><select className="control" id="importBoard" value={board?.id??''} disabled={upload.isPending} onChange={(e)=>{setBoardId(e.target.value);setColumnId('');}}>{!board&&<option value="">Choose a board</option>}{boardList.map((b)=><option key={b.id} value={b.id}>{b.name}</option>)}</select></div><div className="field"><label htmlFor="importColumn">Default column for blank Status</label><select className="control" id="importColumn" value={column?.id??''} disabled={upload.isPending} onChange={(e)=>setColumnId(e.target.value)}>{columns.map((c)=><option key={c.id} value={c.id}>{c.name}</option>)}</select></div></div>
      {boards.error&&<ErrorNote error={boards.error} />}{snapshot.error&&<ErrorNote error={snapshot.error} />}{project?.isArchived&&<p role="status">This project is archived. Choose an active project.</p>}
      <label htmlFor="importFile">Workbook (.xlsx)</label><input id="importFile" ref={input} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={upload.isPending} onChange={(e)=>choose(e.target.files?.[0])} />
      <div className="dropzone" onDragOver={(e)=>e.preventDefault()} onDrop={(e)=>{e.preventDefault();if(!upload.isPending)choose(e.dataTransfer.files[0]);}}><Icon name="upload" /><span>{file?`${file.name} · ${file.size} bytes`:'Choose or drop a workbook here.'}</span></div>{fileError&&<ErrorNote text={fileError} />}
      {upload.error&&<><ErrorNote error={upload.error} /><p className="hint">The workbook is kept. An upload creates a preview only; if its response was lost, an explicit retry may create another temporary preview. No cards are created before confirmation.</p></>}
      <div className="form-actions"><button className="btn primary" type="button" disabled={!file||!board||!column||!!project?.isArchived||upload.isPending||!!snapshot.error} onClick={()=>upload.mutate()}>{upload.isPending?'Validating…':'Validate workbook'}</button>{file&&!upload.isPending&&<button className="btn" type="button" onClick={()=>setFile(null)}>Discard selected file</button>}</div>
    </div></section>:<>
      {statusQuery.isPending&&<p role="status">Loading batch status…</p>}{statusQuery.error&&<ErrorNote error={statusQuery.error} onRetry={()=>void statusQuery.refetch()} />}
      {candidate&&!batchProject&&<p role="status">This batch is unavailable with your current project role. Your own unsent mapping choices remain in this tab.</p>}
      {status&&<section className="panel" aria-labelledby="previewTitle"><div className="panel-head"><div className="panel-head-copy"><h2 id="previewTitle">{status.state==='committed'?'Import receipt':'Batch preview'}</h2><p className="panel-sub">Batch <span className="mono">{status.id}</span> · version {status.version} · {status.state}</p></div></div><div className="panel-body stack">
        <p role="status">{importStateText(status.state)}</p><p className="field-help">Uploaded by {importReceiptActors(status).uploader}{status.createdAt?` · ${new Date(status.createdAt).toLocaleString()}`:''}{importReceiptActors(status).confirmer?` · Confirmed by ${importReceiptActors(status).confirmer}`:''}{status.committedAt?` · ${new Date(status.committedAt).toLocaleString()}`:''}</p><Counts status={status} /><p className="field-help">Source: XLSX import · project {batchProject?.name} · board {status.boardId}. {status.expiresAt?`Preview deadline ${new Date(status.expiresAt).toLocaleString()}.`:''}</p>
        {batchProject?.isArchived&&<p role="status">Project archived. Import changes are disabled.</p>}
        {status.error&&<ErrorNote error={new ApiError(422,status.error.code,'Import failed.')} />}
        {(commit.error||mapping.error||cancel.error)&&<ErrorNote error={commit.error??mapping.error??cancel.error} />}
        {batchSession.command.unresolved()&&<p className="hint" role="status">The confirmation may have succeeded. Retry its original digest, version and request before starting another operation. <button className="btn" type="button" disabled={commit.isPending||!writable} onClick={()=>commit.mutate()}>Retry original confirmation</button></p>}
        {!!unknown.length&&<fieldset disabled={!writable||locked||mapping.isPending}><legend>Map unrecognized Status values to existing columns</legend>{unknown.map((source)=><div className="field" key={source}><label htmlFor={`map-${encodeURIComponent(source)}`}>{source}</label><select id={`map-${encodeURIComponent(source)}`} className="control" value={importMappingValue(draft.mappings,source)} onChange={(e)=>batchSession.update({mappings:{...draft.mappings,[source]:e.target.value}})}><option value="">Choose a column</option>{columns.map((c)=><option key={c.id} value={c.id}>{c.name}</option>)}</select></div>)}<button className="btn" type="button" disabled={!unknown.every((source)=>!!importMappingValue(draft.mappings,source))} onClick={()=>mapping.mutate()}>{mapping.isPending?'Revalidating…':'Save mappings and revalidate'}</button><p className="field-help">Only status labels are mapped. Fix other field errors in the workbook and upload a corrected file. {rowFeed.hasNextPage?'Load all rows to find further unrecognized statuses.':''}</p></fieldset>}
        {rows.some(row=>row.contentRedacted)&&<p className="field-help">Original row content has been removed under the retention policy. Row outcomes and available card links remain.</p>}
        <div className="table-wrap"><table className="data-table preview-table"><thead><tr><th>Row</th><th>External ID</th><th>Title</th><th>Priority</th><th>Due date</th><th>Assignees</th><th>Status</th><th>Outcome / messages</th></tr></thead><tbody>{rows.map((row)=>{const href=importedCardHref(status.boardId,row);return <tr key={row.rowNumber}><td>{row.rowNumber}</td><td className="mono">{row.contentRedacted?'Removed':row.externalId||'Missing'}</td><td>{href?<Link href={href}>{importRowLabel(row)}</Link>:row.contentRedacted?'Content removed':importRowLabel(row)}</td><td>{row.contentRedacted?'Removed':row.priority}</td><td>{row.contentRedacted?'Removed':row.dueDate??'—'}</td><td>{row.contentRedacted?'Removed':row.assigneeIds.length?row.assigneeIds.join(', '):'—'}</td><td>{row.contentRedacted?'Removed':row.status??'Default column'}</td><td><strong>{row.outcome.replaceAll('_',' ')}</strong>{row.errors.map((error,index)=><p className="row-message" key={`${error.field}-${index}`}>Row {row.rowNumber} · {error.field}: {error.message}</p>)}</td></tr>;})}</tbody></table></div>
        <FeedControls name="import rows" queryKey={rowsKey} feed={rowFeed} loaded={rows.length} />
        {rowFeed.error instanceof ApiError&&rowFeed.error.code==='STALE_CURSOR'&&<button className="btn" type="button" onClick={()=>void statusQuery.refetch()}>Reload batch status</button>}
        {status.state==='committed'&&<div className="note success"><Icon name="check-circle" /><span><strong>{status.counts.created} cards created, {status.counts.skipped} skipped.</strong> The server committed this batch atomically. Created card links above open the original board. Comments/images are not imported.</span></div>}
        <div className="form-actions"><button className="btn" type="button" disabled={downloading} onClick={()=>void report()}>{downloading?'Downloading…':'Download safe CSV report'}</button>
          {status.canCommit&&<button className="btn primary" type="button" disabled={!writable||locked||mapping.isPending||cancel.isPending||!!Object.keys(draft.mappings).length||rowFeed.hasNextPage||rowFeed.isPending||rowFeed.isError} onClick={()=>setConfirm(true)}>Review and confirm import</button>}
          {status.cancellationAllowed&&<button className="btn" type="button" disabled={!writable||locked||mapping.isPending||cancel.isPending} onClick={()=>cancel.mutate()}>{cancel.isPending?'Cancelling…':'Cancel preview'}</button>}
          {!status.cancellationAllowed&&!importProcessing(status.state)&&<button className="btn" type="button" disabled={locked} onClick={startAnother}>Import another workbook</button>}
        </div>{downloadError!=null&&<ErrorNote error={downloadError} />}
      </div></section>}
    </>}
    <DialogLayer open={confirm&&!!status} onClose={()=>{if(!commit.isPending)setConfirm(false);}} labelledBy="commitTitle" className="wide"><div className="dialog-head"><h2 id="commitTitle">Create the new cards in this batch?</h2></div><div className="dialog-body">{status&&<><Counts status={status} /><p>No cards have been created by this preview. Existing unchanged rows skip. The server rechecks current access, digest, expiry, columns and assignees; one conflict prevents every new row.</p><p>Batch {status.id} · preview version {status.version}</p></>}</div><footer className="dialog-foot"><button className="btn" type="button" disabled={commit.isPending} onClick={()=>setConfirm(false)}>Keep reviewing</button><button className="btn primary" type="button" disabled={!writable||locked} onClick={()=>commit.mutate()}>Confirm import</button></footer></DialogLayer>
  </div>;
}
export default function ImportPage(){return <Suspense fallback={<p role="status">Loading import…</p>}><ImportScreen /></Suspense>;}
