import { createRetainedCommand } from './retained-command.ts';
import { setUnsaved } from './unsaved.ts';
export type UndoInput={expectedVersion:number;expectedBoardVersion:number};
export type UndoRequest={cardId:string;boardId:string;input:UndoInput;command:ReturnType<typeof createRetainedCommand<UndoInput>>};
export function createUndoSessions(){const sessions=new Map<string,ReturnType<typeof make>>();function make(key:string){let request:UndoRequest|null=null;const listeners=new Set<()=>void>();return {get:()=>request,subscribe:(fn:()=>void)=>{listeners.add(fn);return()=>{listeners.delete(fn);};},set(next:UndoRequest|null){request=next;setUnsaved(key,!!request);listeners.forEach((fn)=>fn());}};}return {forBoards(actorId:string,ids:string[]){const key=`undo:${JSON.stringify([actorId,[...ids].sort()])}`;let session=sessions.get(key);if(!session){session=make(key);sessions.set(key,session);}return session;}};}
export const undoSessions=createUndoSessions();
