import { Braces } from 'lucide-react';
import { useRef, useState } from 'react';
import { cx, IconButton, Input, Popover, Textarea } from '../../components/ui';
import type { AvailableRef } from '../refs';

interface Props {
  value: string;
  onChange: (value: string) => void;
  refs: AvailableRef[];
  multiline?: boolean;
  placeholder?: string;
  rows?: number;
  className?: string;
}

/** A text field with a menu that inserts {{references}} at the caret. */
export function RefInput({ value, onChange, refs, multiline, placeholder, rows, className }: Props) {
  const field = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const [open, setOpen] = useState(false);

  const insert = (item: AvailableRef) => {
    const el = field.current;
    const at = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? at;
    const next = value.slice(0, at) + item.ref + value.slice(end);
    onChange(next);
    setOpen(false);
    const caret = at + item.ref.length - item.caretBack;
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(caret, caret);
    });
  };

  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      className="right-0 w-72"
      trigger={
        <div className="relative">
          {multiline ? (
            <Textarea ref={field} value={value} rows={rows} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className={cx('pr-9', className)} />
          ) : (
            <Input ref={field} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className={cx('pr-9', className)} />
          )}
          <IconButton label="Insert a reference" onClick={() => setOpen((o) => !o)} className={cx('absolute right-1', multiline ? 'top-1' : 'top-1/2 -translate-y-1/2', open && 'bg-indigo-50 text-indigo-600')}>
            <Braces size={14} />
          </IconButton>
        </div>
      }
    >
      <div className="border-b border-slate-100 px-3 py-2 text-[11.5px] text-slate-500">Insert data this step can use</div>
      <div className="max-h-64 overflow-y-auto p-1.5">
        {!refs.length && <p className="px-2 py-4 text-center text-[12px] leading-relaxed text-slate-500">Nothing yet. Add run inputs to the start node, or give an earlier step a result name.</p>}
        {refs.map((r) => (
          <button key={r.ref} type="button" onClick={() => insert(r)} className="flex w-full items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left hover:bg-slate-100">
            <span className="truncate font-mono text-[12px] text-indigo-700">{r.ref.replace(/\.\}\}$/, '.…}}')}</span>
            <span className="shrink-0 truncate text-[11px] text-slate-400">{r.source}</span>
          </button>
        ))}
      </div>
    </Popover>
  );
}
