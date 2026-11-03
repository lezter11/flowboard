/** Date-only helpers ported from design/flowboard-ui/data.js. Due dates are calendar dates, not instants. */
const DAY = 86_400_000;

function startOfToday(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

export function parseDateOnly(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parts = value.split('-').map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return null;
  return new Date(parts[0]!, parts[1]! - 1, parts[2]!);
}

function dateOrdinal(value:string|null|undefined):number|null {
  if(!value||!/^\d{4}-\d{2}-\d{2}$/.test(value))return null;
  const date=new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value?date.getTime()/DAY:null;
}
export function daysUntil(value: string | null | undefined, asOfDate?:string|null): number | null {
  if(asOfDate!==undefined){const due=dateOrdinal(value),today=dateOrdinal(asOfDate);return due===null||today===null?null:due-today;}
  const due=parseDateOnly(value);return due?Math.round((due.getTime()-startOfToday().getTime())/DAY):null;
}

export function formatShort(value: string | null | undefined): string {
  const day=dateOrdinal(value);
  return day!==null?new Date(day*DAY).toLocaleDateString(undefined,{month:'short',day:'numeric',timeZone:'UTC'}):'';
}

export type DueInfo = { label: string; state: 'done' | 'overdue' | 'soon' | 'normal'; detail?: string };

export function dueInfo(due: string | null | undefined, done: boolean, asOfDate?:string|null): DueInfo | null {
  if (!due) return null;
  const days = daysUntil(due,asOfDate);
  if (days === null) return {label:`${done?'Done':'Due'} · ${formatShort(due)}`,state:done?'done':'normal'};
  if (done) return { label: `Done · ${formatShort(due)}`, state: 'done' };
  if (days < 0) {
    const n = Math.abs(days);
    return { label: `Overdue · ${formatShort(due)}`, state: 'overdue', detail: `${n} day${n === 1 ? '' : 's'} overdue` };
  }
  if (days === 0) return { label: 'Due today', state: 'soon' };
  if (days === 1) return { label: 'Due tomorrow', state: 'soon' };
  if (days <= 7) return { label: `Due ${formatShort(due)}`, state: 'soon' };
  return { label: `Due ${formatShort(due)}`, state: 'normal' };
}

export function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
