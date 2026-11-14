import type { Card, CardDocumentLink, MoveCardInput, UpdateCardInput } from '@flowboard/contracts';
import { reconcileDraft, type CardFields } from './draft-sync.ts';
import { createRetainedCommand } from './retained-command.ts';
import { acknowledgeUnsaved, setUnsaved } from './unsaved.ts';
import { registerProtectedDraft } from './protected-drafts.ts';
export interface CardDraft extends CardFields {priority:Card['priority'];documentLinks:CardDocumentLink[]}
export const cardToDraft=(card:Card):CardDraft=>({title:card.title,description:card.description,priority:card.priority,dueDate:card.dueDate??'',assigneeIds:[...card.assigneeIds],columnId:card.columnId,documentLinks:(card.documentLinks??[]).map(({title,url})=>({title,url}))});
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
export const cardFieldsDirty=(draft:CardDraft,base:CardDraft)=>['title','description','priority','dueDate','assigneeIds','documentLinks'].some((key)=>!same(draft[key as keyof CardDraft],base[key as keyof CardDraft]));
export function cardFieldsInput(draft:CardDraft,version:number,override?:string[],base?:CardDraft):UpdateCardInput {
  return {
    title:draft.title.trim(),description:draft.description,priority:draft.priority,
    dueDate:draft.dueDate||null,assigneeIds:override??[...draft.assigneeIds],expectedVersion:version,
    ...(base && !same(draft.documentLinks,base.documentLinks) ? {documentLinks:draft.documentLinks} : {}),
  };
}
export function originalUndoInput(version:number|undefined,structureVersion:number){return typeof version==='number'?{expectedVersion:version,expectedBoardVersion:structureVersion}:null;}
export function createCardDraftSessions(){
  const sessions=new Map<string,ReturnType<typeof make>>();
  function make(key:string,actorId:string,card:Card){
    const empty=():CardDraft=>({title:'',description:'',priority:'none',dueDate:'',assigneeIds:[],columnId:'',documentLinks:[]});
    let retained:Partial<CardDraft>|null=null;
    let value={base:cardToDraft(card),draft:cardToDraft(card),version:card.version,conflict:false,fieldInput:null as UpdateCardInput|null,moveInput:null as MoveCardInput|null,movingTo:null as string|null};const listeners=new Set<()=>void>();
    const fields=createRetainedCommand<UpdateCardInput>();const move=createRetainedCommand<MoveCardInput>();
    const emit = (edited = false) => {
      const dirty = cardFieldsDirty(value.draft, value.base) || !!value.fieldInput || (!!value.moveInput && !value.movingTo);
      setUnsaved(key, dirty || value.movingTo !== null, edited, dirty);
      listeners.forEach((fn) => fn());
    };
    registerProtectedDraft(Symbol(key),{actorId,projectId:card.projectId,boardId:card.boardId,cardId:card.id},()=>{
      if(retained===null){retained={};for(const field of Object.keys(value.draft) as Array<keyof CardDraft>)if(!same(value.draft[field],value.base[field]))Object.assign(retained,{[field]:structuredClone(value.draft[field])});}
      value={...value,base:empty(),draft:{...empty(),...retained},version:0,conflict:Object.keys(retained).length>0||fields.unresolved()||move.unresolved(),fieldInput:fields.unresolved()?value.fieldInput:null,moveInput:move.unresolved()?value.moveInput:null};emit();
    });
    return {fields,move,get:()=>value,subscribe:(fn:()=>void)=>{listeners.add(fn);return()=>{listeners.delete(fn);};},
      edit(patch:Partial<Omit<CardDraft, 'columnId'>>){const next={...value.draft,...structuredClone(patch)};const edited=cardFieldsDirty(value.draft,next);value={...value,draft:next};emit(edited);},
      observe(next:Card){if(retained!==null){const base=cardToDraft(next);value={...value,base,draft:{...base,...retained},version:next.version,conflict:Object.keys(retained).length>0||fields.unresolved()||move.unresolved()};retained=null;emit();return;}if(next.version<=value.version)return;const base=cardToDraft(next);const merged=reconcileDraft(value.base,base,value.draft);value={...value,base,draft:merged.draft,version:next.version,conflict:(value.conflict||merged.conflict)&&cardFieldsDirty(merged.draft,base)};emit();},
      review(){value={...value,conflict:false};emit();},
      intent(patch:{fieldInput?:UpdateCardInput|null;moveInput?:MoveCardInput|null}){value={...value,...structuredClone(patch)};emit();},
      fieldsSaved(version?:number, documentLinks?:CardDocumentLink[]){const input=value.fieldInput;if(input && (version===undefined||version>=value.version)){const saved={...value.base,title:input.title??value.base.title,description:input.description??value.base.description,priority:input.priority??value.base.priority,dueDate:input.dueDate??'',assigneeIds:input.assigneeIds??value.base.assigneeIds,documentLinks:(documentLinks??input.documentLinks??value.base.documentLinks).map(({title,url})=>({title,url}))};value={...value,base:saved,draft:structuredClone(saved),version:version??value.version,conflict:false};}value={...value,fieldInput:null};emit();},
      beginMove(columnId: string) {
        value = { ...value, movingTo: columnId };
        emit();
      },
      moved(version?: number) {
        const destination = value.moveInput?.toColumnId;
        const acknowledged = destination !== undefined && (version === undefined || version >= value.version);
        const base = acknowledged ? { ...value.base, columnId: destination } : value.base;
        value = { ...value, base, draft: { ...value.draft, columnId: base.columnId }, moveInput: null, movingTo: null,
          version: acknowledged ? version ?? value.version : value.version,
          conflict: value.conflict && cardFieldsDirty(value.draft, base) };
        emit();
      },
      moveFailed() {
        value = { ...value, movingTo: null, moveInput: move.unresolved() ? value.moveInput : null };
        emit(move.unresolved());
      },
      discard(){if(fields.unresolved()||move.unresolved())return;value={...value,draft:structuredClone(value.base),conflict:false,fieldInput:null,moveInput:null};emit();},
    };
  }
  return {
    acknowledge(actorId: string, cardId: string) { acknowledgeUnsaved([`card-fields:${JSON.stringify([actorId, cardId])}`]); },
    forCard(actorId:string,card:Card){const key=`card-fields:${JSON.stringify([actorId,card.id])}`;let session=sessions.get(key);if(!session){session=make(key,actorId,card);sessions.set(key,session);}return session;}};
}
export const cardDraftSessions=createCardDraftSessions();
