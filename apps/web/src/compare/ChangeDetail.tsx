import { EDGE_FIELDS, NODE_FIELDS, type EdgeChange, type EdgeField, type FieldChange, type NodeChange, type NodeField } from '@agent-flow/core';
import { X } from 'lucide-react';
import { cx, IconButton } from '../components/ui';
import { EDGE_FIELD_LABEL, NODE_FIELD_LABEL, showValue } from './format';
import { wordDiff, type Piece } from './textDiff';

export type Picked = { kind: 'node'; change: NodeChange } | { kind: 'edge'; change: EdgeChange };

const KIND = {
  added: { text: 'Added', className: 'bg-emerald-100 text-emerald-800' },
  removed: { text: 'Removed', className: 'bg-red-100 text-red-800' },
  changed: { text: 'Modified', className: 'bg-amber-100 text-amber-900' },
} as const;

/** Text fields are compared word by word; everything else is shown as it reads. */
const TEXT_FIELDS = new Set<string>(['title', 'instruction', 'condition']);

function Pieces({ pieces, tone }: { pieces: Piece[]; tone: 'del' | 'ins' }) {
  return (
    <>
      {pieces.map((p, i) => (
        <span key={i} className={cx(p.kind !== 'same' && (tone === 'del' ? 'rounded-sm bg-red-100 text-red-900' : 'rounded-sm bg-emerald-100 text-emerald-900'))}>
          {p.text}
        </span>
      ))}
    </>
  );
}

function Row({ label, before, after, text }: { label: string; before: string; after: string; text: boolean }) {
  const words = text && before !== '—' && after !== '—' ? wordDiff(before, after) : null;
  return (
    <div className="grid grid-cols-[110px_minmax(0,1fr)_minmax(0,1fr)] gap-3 border-t border-slate-100 py-2 first:border-t-0">
      <div className="pt-0.5 text-[11.5px] font-medium text-slate-500">{label}</div>
      <div className="rounded-md bg-red-50/60 px-2 py-1 text-[12.5px] leading-snug whitespace-pre-wrap text-slate-700">{words ? <Pieces pieces={words.before} tone="del" /> : before}</div>
      <div className="rounded-md bg-emerald-50/60 px-2 py-1 text-[12.5px] leading-snug whitespace-pre-wrap text-slate-700">{words ? <Pieces pieces={words.after} tone="ins" /> : after}</div>
    </div>
  );
}

interface Props {
  picked: Picked | null;
  /** Step title by id, looked up in whichever version has it. */
  title: (id: string) => string;
  beforeLabel: string;
  afterLabel: string;
  onClose: () => void;
}

/** What exactly changed in the selected step or connection: each field, before and after. */
export function ChangeDetail({ picked, title, beforeLabel, afterLabel, onClose }: Props) {
  if (!picked) return null;

  const { change } = picked;
  const kind = KIND[change.kind];
  const heading =
    picked.kind === 'node' ? (
      <span className="truncate font-semibold text-slate-900">{picked.change.node.title}</span>
    ) : (
      <span className="truncate font-semibold text-slate-900">
        {title((picked.change.after ?? picked.change.before)!.source)} → {title((picked.change.after ?? picked.change.before)!.target)}
      </span>
    );

  const rows: { field: NodeField | EdgeField; label: string; before: string; after: string }[] = [];
  if (change.kind === 'changed') {
    for (const f of change.fields as FieldChange<NodeField | EdgeField>[]) {
      rows.push({
        field: f.field,
        label: picked.kind === 'node' ? NODE_FIELD_LABEL[f.field as NodeField] : EDGE_FIELD_LABEL[f.field as EdgeField],
        before: showValue(f.field, f.before, title),
        after: showValue(f.field, f.after, title),
      });
    }
  } else {
    // Added or removed: show what the step or connection consists of.
    const side = change.kind === 'added' ? 'after' : 'before';
    const fields = picked.kind === 'node' ? NODE_FIELDS.filter((f) => f !== 'type') : EDGE_FIELDS;
    for (const f of fields) {
      const raw = (picked.kind === 'node' ? (picked.change.node as unknown as Record<string, unknown>) : ((picked.change[side] ?? {}) as Record<string, unknown>))[f];
      const text = showValue(f, raw, title);
      if (text === '—' || (f === 'isDefault' && !raw)) continue;
      rows.push({
        field: f,
        label: picked.kind === 'node' ? NODE_FIELD_LABEL[f as NodeField] : EDGE_FIELD_LABEL[f as EdgeField],
        before: side === 'before' ? text : '—',
        after: side === 'after' ? text : '—',
      });
    }
  }

  return (
    <div className="px-4 py-3">
      <div className="mb-2 flex items-center gap-2 text-[13px]">
        <span className={cx('shrink-0 rounded-full px-2 py-px text-[10.5px] font-semibold', kind.className)}>{kind.text}</span>
        {picked.kind === 'edge' && <span className="shrink-0 text-[11.5px] text-slate-400">connection</span>}
        {heading}
        <IconButton label="Close" onClick={onClose} className="ml-auto"><X size={14} /></IconButton>
      </div>
      <div className="grid grid-cols-[110px_minmax(0,1fr)_minmax(0,1fr)] gap-3 pb-1 text-[11px] font-semibold tracking-wide text-slate-400 uppercase">
        <span />
        <span>{beforeLabel}</span>
        <span>{afterLabel}</span>
      </div>
      {rows.length ? rows.map((r) => <Row key={r.field} label={r.label} before={r.before} after={r.after} text={TEXT_FIELDS.has(r.field)} />) : <p className="text-[12.5px] text-slate-400">Nothing to show beyond the change itself.</p>}
    </div>
  );
}
