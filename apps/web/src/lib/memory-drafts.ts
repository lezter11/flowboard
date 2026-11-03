import { createRetainedCommand } from './retained-command.ts';
import { setUnsaved } from './unsaved.ts';
import { registerProtectedDraft, type DraftResource } from './protected-drafts.ts';
type ProtectedField={scope:readonly unknown[];base:()=>unknown;empty:unknown};
export function createMemoryDrafts(){
  const values=new Map<string,unknown>();const references=new Map<string,{current:unknown}>();const commands=new Map<string,unknown>();
  const protections=new Map<string,{fields:Record<string,ProtectedField>;reset:()=>void;retained:Set<string>|null;readonly redacted:boolean;restore:(next:Record<string,unknown>)=>{retained:boolean}|null}>();
  const keyFor=(scope:readonly unknown[])=>`memory:${JSON.stringify(scope)}`;
  return {
    value<T>(scope:readonly unknown[],initial:()=>T){const key=keyFor(scope);let entry=values.get(key) as {get:()=>T;set:(value:T|((old:T)=>T))=>void;subscribe:(fn:()=>void)=>()=>void}|undefined;if(!entry){let value=initial();const listeners=new Set<()=>void>();entry={get:()=>value,set(next){value=typeof next==='function'?(next as (old:T)=>T)(value):next;listeners.forEach((fn)=>fn());},subscribe(fn){listeners.add(fn);return()=>{listeners.delete(fn);};}};values.set(key,entry);}return entry;},
    ref<T>(scope:readonly unknown[],initial:()=>T){const key=keyFor(scope);let entry=references.get(key);if(!entry){entry={current:initial()};references.set(key,entry);}return entry as {current:T};},
    command<T>(scope:readonly unknown[]){const key=keyFor(scope);let command=commands.get(key) as ReturnType<typeof createRetainedCommand<T>>|undefined;if(!command){command=createRetainedCommand<T>();commands.set(key,command);}return command;},
    protectFields(scope:readonly unknown[],resource:DraftResource,fields:Record<string,ProtectedField>,reset:()=>void){
      const key=keyFor(scope);let group=protections.get(key);
      if(!group){group={fields,reset,retained:null,get redacted(){return this.retained!==null;},restore(next){if(this.retained===null)return null;const retained=this.retained.size>0;for(const [field,config] of Object.entries(this.fields))if(!this.retained.has(field))(values.get(keyFor(config.scope)) as {set:(value:unknown)=>void}|undefined)?.set(next[field]);this.retained=null;return {retained};}};protections.set(key,group);}
      group.fields=fields;group.reset=reset;
      const current=group;
      registerProtectedDraft(current,resource,()=>{
        if(current.retained===null){current.retained=new Set();for(const [field,config] of Object.entries(current.fields)){const entry=values.get(keyFor(config.scope)) as {get:()=>unknown;set:(value:unknown)=>void}|undefined;if(entry&&JSON.stringify(entry.get())!==JSON.stringify(config.base()))current.retained.add(field);}}
        for(const [field,config] of Object.entries(current.fields))if(!current.retained.has(field))(values.get(keyFor(config.scope)) as {set:(value:unknown)=>void}|undefined)?.set(config.empty);
        current.reset();
        setUnsaved(keyFor([...scope,'dirty']),current.retained.size>0);
      });
      return current;
    },
    mark(scope:readonly unknown[],dirty:boolean){setUnsaved(keyFor(scope),dirty);},
  };
}
export const memoryDrafts=createMemoryDrafts();
