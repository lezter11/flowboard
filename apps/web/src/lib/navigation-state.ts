export function sameDraftScope(current:string,target:string):boolean {
  const a=new URL(current,'http://local'),b=new URL(target,a);
  return a.origin===b.origin&&a.pathname===b.pathname&&['id','board','boards','project','import'].every((key)=>a.searchParams.get(key)===b.searchParams.get(key));
}
export function createNavigationGuard(){
  let pending:{href:string;proceed:()=>void}|null=null;const listeners=new Set<()=>void>();const emit=()=>listeners.forEach((fn)=>fn());
  return {get:()=>pending,subscribe:(fn:()=>void)=>{listeners.add(fn);return()=>{listeners.delete(fn);};},request(current:string,href:string,dirty:boolean,proceed:()=>void){if(!dirty||sameDraftScope(current,href)){proceed();return;}pending={href,proceed};emit();},stay(){pending=null;emit();},leave(){const next=pending;pending=null;emit();next?.proceed();}};
}
export const navigationGuard=createNavigationGuard();
