export const events: Array<Record<string,unknown>>=[];
let mark=0;
export function event(value:Record<string,unknown>){events.push(value);}
export function stage(name:string){mark=performance.now();}
export function stamp(name:string){events.push({kind:'stage',name,ms:performance.now()-mark});mark=performance.now();}
export function reset(){events.length=0;mark=performance.now();}
