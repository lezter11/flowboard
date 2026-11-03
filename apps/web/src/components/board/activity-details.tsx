import type { ActivityItem } from '@flowboard/contracts';
import { activityDetails } from '@/lib/activity';

function HistoryValue({ value }: { value: string }) {
  const style = { whiteSpace:'pre-wrap', overflowWrap:'anywhere', maxHeight:'12rem', overflow:'auto' } as const;
  if (value.length > 240) return <details><summary>{value.slice(0,160)}… <span className="hint">Show full value</span></summary><div style={style}>{value}</div></details>;
  return <span style={style}>{value}</span>;
}

/** Text nodes keep historical values inert, including strings that look like HTML. */
export function ActivityDetails({ item }: { item: ActivityItem }) {
  const rows = activityDetails(item);
  if (!rows.length) return null;
  return <dl aria-label="Change details">{rows.map((row,index) => <div key={`${row.label}-${index}`}>
    <dt><strong>{row.label}</strong></dt>
    <dd style={{ marginInlineStart:0 }}>
      {row.value !== undefined ? <HistoryValue value={row.value} /> : <>
        <div><span className="hint">Before: </span><HistoryValue value={row.before!} /></div>
        <div><span className="hint">After: </span><HistoryValue value={row.after!} /></div>
      </>}
    </dd>
  </div>)}</dl>;
}
