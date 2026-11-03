import type { Card, MoveCardInput, UpdateCardInput } from '@flowboard/contracts';
import { reconcileDraft, type CardFields } from './draft-sync.ts';
import { createRetainedCommand } from './retained-command.ts';
import { setUnsaved } from './unsaved.ts';
import { registerProtectedDraft } from './protected-drafts.ts';
export interface CardDraft extends CardFields {priority:Card['priority']}
export const cardToDraft=(card:Card):CardDraft=>({title:card.title,description:card.description,priority:card.priority,dueDate:card.dueDate??'',assigneeIds:[...card.assigneeIds],columnId:card.columnId});
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
export const cardFieldsDirty=(draft:CardDraft,base:CardDraft)=>['title','description','priority','dueDate','assigneeIds'].some((key)=>!same(draft[key as keyof CardDraft],base[key as keyof CardDraft]));
export function cardFieldsInput(draft:CardDraft,version:number,override?:string[]):UpdateCardInput{return {title:draft.title.trim(),description:draft.description,priority:draft.priority,dueDate:draft.dueDate||null,assigneeIds:override??[...draft.assigneeIds],expectedVersion:version};}
export function originalUndoInput(version:number|undefined,structureVersion:number){return typeof version==='number'?{expectedVersion:version,expectedBoardVersion:structureVersion}:null;}
export function createCardDraftSessions(){
  const sessions=new Map<string,ReturnType<typeof make>>();
  function make(key:string,actorId:string,card:Card){
    const empty=():CardDraft=>({title:'',description:'',priority:'none',dueDate:'',assigneeIds:[],columnId:''});
    let retained:Partial<CardDraft>|null=null;
    let value={base:cardToDraft(card),draft:cardToDraft(card),version:card.version,conflict:false,fieldInput:null as UpdateCardInput|null,moveInput:null as MoveCardInput|null};const listeners=new Set<()=>void>();
    const fields=createRetainedCommand<UpdateCardInput>();const move=createRetainedCommand<MoveCardInput>();
    const emit=()=>{setUnsaved(key,cardFieldsDirty(value.draft,value.base)||value.draft.columnId!==value.base.columnId||!!value.fieldInput||!!value.moveInput);listeners.forEach((fn)=>fn());};
    registerProtectedDraft(Symbol(key),{actorId,projectId:card.projectId,boardId:card.boardId,cardId:card.id},()=>{
      if(retained===null){retained={};for(const field of Object.keys(value.draft) as Array<keyof CardDraft>)if(!same(value.draft[field],value.base[field]))Object.assign(retained,{[field]:structuredClone(value.draft[field])});}
      value={...value,base:empty(),draft:{...empty(),...retained},version:0,conflict:Object.keys(retained).length>0||fields.unresolved()||move.unresolved(),fieldInput:fields.unresolved()?value.fieldInput:null,moveInput:move.unresolved()?value.moveInput:null};emit();
    });
    return {fields,move,get:()=>value,subscribe:(fn:()=>void)=>{listeners.add(fn);return()=>{listeners.delete(fn);};},
      edit(patch:Partial<CardDraft>){value={...value,draft:{...value.draft,...structuredClone(patch)}};emit();},
      observe(next:Card){if(retained!==null){const base=cardToDraft(next);value={...value,base,draft:{...base,...retained},version:next.version,conflict:Object.keys(retained).length>0||fields.unresolved()||move.unresolved()};retained=null;emit();return;}if(next.version===value.version)return;const base=cardToDraft(next);const merged=reconcileDraft(value.base,base,value.draft);value={...value,base,draft:merged.draft,version:next.version,conflict:(value.conflict||merged.conflict)&&(cardFieldsDirty(merged.draft,base)||merged.draft.columnId!==base.columnId)};emit();},
      review(){value={...value,conflict:false};emit();},
      intent(patch:{fieldInput?:UpdateCardInput|null;moveInput?:MoveCardInput|null}){value={...value,...structuredClone(patch)};emit();},
      fieldsSaved(version?:number){const input=value.fieldInput;if(input && (version===undefined||version>=value.version)){const saved={...value.base,title:input.title??value.base.title,description:input.description??value.base.description,priority:input.priority??value.base.priority,dueDate:input.dueDate??'',assigneeIds:input.assigneeIds??value.base.assigneeIds};value={...value,base:saved,draft:{...saved,columnId:value.draft.columnId},version:version??value.version,conflict:false};}value={...value,fieldInput:null};emit();},
      moved(version?:number){const input=value.moveInput;if(input&&(version===undefined||version>=value.version)){value={...value,base:{...value.base,columnId:input.toColumnId},draft:{...value.draft,columnId:input.toColumnId},version:version??value.version,conflict:false};}value={...value,moveInput:null};emit();},
      discard(){if(fields.unresolved()||move.unresolved())return;value={...value,draft:structuredClone(value.base),conflict:false,fieldInput:null,moveInput:null};emit();},
    };
  }
  return {forCard(actorId:string,card:Card){const key=`card-fields:${JSON.stringify([actorId,card.id])}`;let session=sessions.get(key);if(!session){session=make(key,actorId,card);sessions.set(key,session);}return session;}};
}
export const cardDraftSessions=createCardDraftSessions();
