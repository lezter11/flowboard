'use client';
import { useEffect, useMemo, useState, useSyncExternalStore, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { SessionWorkspaceSummary } from '@flowboard/contracts';
import { api } from '@/lib/api';
import { validTimezone, workspaceDraftDirty, workspaceDrafts } from '@/lib/preferences-state';
import { ErrorNote } from './error-note';
import { useToast } from './toasts';

function WorkspaceForm({workspace,actorId}:{workspace:SessionWorkspaceSummary;actorId:string}){
  const session=useMemo(()=>workspaceDrafts.forWorkspace(actorId,workspace),[actorId,workspace.id]);
  const draft=useSyncExternalStore(session.subscribe,session.get,session.get);const client=useQueryClient();const toast=useToast();
  const [validation,setValidation]=useState('');
  useEffect(()=>session.observe(workspace),[workspace,session]);
  const dirty=workspaceDraftDirty(draft);const conflict=workspace.version!==draft.expectedVersion;
  const save=useMutation({mutationFn:()=>api.updateWorkspace(workspace.id,{name:draft.name.trim(),timezone:draft.timezone.trim(),expectedVersion:draft.expectedVersion}),onSuccess:async(response)=>{session.observe(response.data);await client.invalidateQueries();toast('Workspace preferences saved',{icon:'check'});},onError:()=>{void client.invalidateQueries({queryKey:['session']});}});
  const submit=(event:FormEvent)=>{event.preventDefault();if(save.isPending||conflict)return;if(!draft.name.trim()||draft.name.trim().length>100){setValidation('Enter a workspace name from 1 to 100 characters.');return;}if(!validTimezone(draft.timezone)){setValidation('Choose a supported timezone, such as Asia/Kolkata, America/New_York or UTC.');return;}setValidation('');save.mutate();};
  return <form className="settings-form" onSubmit={submit}>
    <div className="field"><label className="field-label" htmlFor="workspaceName">Workspace name</label><input className="control" id="workspaceName" maxLength={100} value={draft.name} disabled={save.isPending} onChange={(e)=>session.update({name:e.target.value})} /></div>
    <div className="field"><label className="field-label" htmlFor="workspaceTimezone">Timezone</label><input className="control" id="workspaceTimezone" list="workspaceTimezones" value={draft.timezone} disabled={save.isPending} aria-describedby="workspaceTimezoneHelp" onChange={(e)=>session.update({timezone:e.target.value})} /><datalist id="workspaceTimezones">{['UTC','Asia/Kolkata','America/New_York','America/Los_Angeles','Europe/London','Pacific/Kiritimati'].map((zone)=><option key={zone} value={zone} />)}</datalist><p className="field-help" id="workspaceTimezoneHelp">Use a supported timezone name. This changes what Today and Overdue mean for this workspace. A card due on November 4 stays due on November 4; its selected date is never rewritten.</p></div>
    {conflict&&<div className="note warn"><p>These preferences changed since you started editing. Your values are kept. Current server values: {workspace.name} · {workspace.timezone}.</p><button className="btn" type="button" onClick={()=>{session.useLatestVersion(workspace);save.reset();}}>Use latest version, keep my values</button></div>}
    {validation&&<ErrorNote text={validation} focusOnMount />}{save.error&&<ErrorNote error={save.error} focusOnMount />}
    <div className="form-actions"><span className="dirty-note">{dirty?'Unsaved workspace preferences':'No unsaved workspace preferences'}</span><button className="btn primary" type="submit" disabled={!dirty||conflict||save.isPending}>{save.isPending?'Saving…':'Save workspace preferences'}</button>{dirty&&<button className="btn" type="button" disabled={save.isPending} onClick={()=>{session.update({name:workspace.name,timezone:workspace.timezone,baseName:workspace.name,baseTimezone:workspace.timezone,expectedVersion:workspace.version});save.reset();setValidation('');}}>Discard workspace changes</button>}</div>
  </form>;
}
export function WorkspacePreferences({actorId,workspaces,currentWorkspaceId}:{actorId:string;workspaces:SessionWorkspaceSummary[];currentWorkspaceId?:string}){
  const [id,setId]=useState('');const selected=workspaces.find((w)=>w.id===(id||currentWorkspaceId))??workspaces[0];
  return <section className="panel" id="panel-workspace" role="tabpanel" aria-labelledby="tab-workspace"><div className="panel-head"><div className="panel-head-copy"><h2 className="panel-title">Workspace preferences</h2><p className="panel-sub">Only workspaces you own. Managing a shared project does not grant its workspace settings.</p></div></div><div className="panel-body stack">{!selected||!actorId?<p role="status">Sign in with the workspace Owner account to edit these preferences. Unsent values are kept in this tab.</p>:<><label htmlFor="preferenceWorkspace">Your workspace</label><select className="control" id="preferenceWorkspace" value={selected.id} onChange={(e)=>setId(e.target.value)}>{workspaces.map((w)=><option key={w.id} value={w.id}>{w.name}</option>)}</select><WorkspaceForm key={`${actorId}:${selected.id}`} actorId={actorId} workspace={selected} /></>}</div></section>;
}
