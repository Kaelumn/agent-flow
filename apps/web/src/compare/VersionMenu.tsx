import { Check, ChevronDown } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Badge, cx } from '../components/ui';
import { timeAgo } from '../lib/format';

export interface VersionOption {
  value: number | 'draft';
  name: string;
  note?: string;
  createdAt?: number;
  live?: boolean;
}

interface Props {
  label: string;
  value: number | 'draft';
  options: VersionOption[];
  onChange: (value: number | 'draft') => void;
}

/** Picks a version: its name, whether it is live, and the release note it was published with. */
export function VersionMenu({ label, value, options, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', key);
    };
  }, [open]);

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cx('flex h-8 items-center gap-1.5 rounded-lg pr-1.5 pl-3 text-[13px] font-medium text-slate-800 transition-colors hover:bg-slate-200/70', open ? 'bg-slate-200/70' : 'bg-slate-100')}
      >
        {current?.name ?? String(value)}
        <ChevronDown size={14} className="text-slate-400" />
      </button>
      {open && (
        <div role="listbox" aria-label={label} className="absolute top-full left-0 z-30 mt-1.5 w-72 rounded-xl border border-slate-200 bg-white p-1 shadow-xl shadow-slate-900/10">
          <div className="px-2.5 pt-1.5 pb-1 text-[11px] font-medium text-slate-400">{label}</div>
          {options.map((o) => (
            <button
              key={String(o.value)}
              type="button"
              role="option"
              aria-selected={o.value === value}
              onClick={() => {
                setOpen(false);
                if (o.value !== value) onChange(o.value);
              }}
              className="flex w-full items-start gap-2 rounded-lg px-2.5 py-1.5 text-left hover:bg-slate-100"
            >
              <Check size={14} className={cx('mt-0.5 shrink-0', o.value === value ? 'text-indigo-600' : 'text-transparent')} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 text-[13px] font-medium text-slate-900">
                  {o.name}
                  {o.live && <Badge tone="green" dot>Live</Badge>}
                </span>
                <span className="block truncate text-[11.5px] text-slate-500">
                  {o.value === 'draft' ? 'Not published yet' : o.note || 'No release note'}
                  {o.createdAt ? ` · ${timeAgo(o.createdAt)}` : ''}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
