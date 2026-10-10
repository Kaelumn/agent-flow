import type { GraphDiff } from '@agent-flow/core';
import { cx } from '../components/ui';
import { NODE_FIELD_LABEL } from './format';

export const nodeKey = (id: string) => `n:${id}`;
export const edgeKey = (index: number) => `e:${index}`;

const DOT = { added: 'bg-emerald-500', removed: 'bg-red-500', changed: 'bg-amber-400' } as const;
const WORD = { added: 'Added', removed: 'Removed', changed: 'Modified' } as const;

/** Every change in one list; picking one selects it on both canvases. Steps first, then connections. */
export function ChangeList({ diff, title, selected, onPick }: { diff: GraphDiff; title: (id: string) => string; selected: string | null; onPick: (key: string) => void }) {
  const item = (key: string, kind: keyof typeof DOT, label: string, detail?: string) => (
    <li key={key}>
      <button
        type="button"
        onClick={() => onPick(key)}
        className={cx('flex w-full items-start gap-2 rounded-lg px-2.5 py-1.5 text-left hover:bg-slate-100', selected === key && 'bg-indigo-50 hover:bg-indigo-50')}
      >
        <span className={cx('mt-[7px] size-2 shrink-0 rounded-full', DOT[kind])} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12.5px] font-medium text-slate-800">{label}</span>
          <span className="block truncate text-[11px] text-slate-400">{detail ?? WORD[kind]}</span>
        </span>
      </button>
    </li>
  );

  return (
    <div className="h-full overflow-y-auto px-2 py-3">
      {diff.nodes.length > 0 && (
        <>
          <h3 className="px-2.5 pb-1 text-[11px] font-semibold tracking-wider text-slate-400 uppercase">Steps · {diff.nodes.length}</h3>
          <ul>{diff.nodes.map((c) => item(nodeKey(c.nodeId), c.kind, c.node.title, c.kind === 'changed' ? `Modified · ${c.fields.map((f) => NODE_FIELD_LABEL[f.field]).join(', ')}` : undefined))}</ul>
        </>
      )}
      {diff.edges.length > 0 && (
        <>
          <h3 className="px-2.5 pt-3 pb-1 text-[11px] font-semibold tracking-wider text-slate-400 uppercase">Connections · {diff.edges.length}</h3>
          <ul>
            {diff.edges.map((c, i) => {
              const e = (c.after ?? c.before)!;
              return item(edgeKey(i), c.kind, `${title(e.source)} → ${title(e.target)}`, c.kind === 'changed' ? `Modified · ${c.fields.map((f) => f.field === 'isDefault' ? 'default path' : f.field).join(', ')}` : undefined);
            })}
          </ul>
        </>
      )}
      {diff.nodes.length + diff.edges.length === 0 && <p className="px-2.5 py-4 text-[12.5px] text-slate-400">These two versions are the same flow.{diff.movedNodes ? ` ${diff.movedNodes} step${diff.movedNodes > 1 ? 's were' : ' was'} moved.` : ''}</p>}
    </div>
  );
}
