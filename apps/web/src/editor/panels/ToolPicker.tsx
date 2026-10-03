import type { ToolDefinition } from '@agent-flow/core';
import { Check, ChevronsUpDown, PenLine, Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { cx, Popover } from '../../components/ui';
import { connectorStyle } from '../connectors';

interface Props {
  tools: ToolDefinition[];
  value: string;
  onChange: (name: string) => void;
}

/** Searchable, grouped tool list. The trigger shows the chosen tool as a card. */
export function ToolPicker({ tools, value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const selected = tools.find((t) => t.name === value);

  const matches = useMemo(() => {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    return tools
      .filter((t) => terms.every((term) => `${t.name} ${t.description} ${connectorStyle(t.connector).label}`.toLowerCase().includes(term)))
      .sort((a, b) => a.connector.localeCompare(b.connector) || a.name.localeCompare(b.name));
  }, [tools, query]);

  useEffect(() => setActive(0), [query, open]);
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const choose = (tool: ToolDefinition) => {
    onChange(tool.name);
    setOpen(false);
    setQuery('');
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') setActive((i) => Math.min(i + 1, matches.length - 1));
    else if (e.key === 'ArrowUp') setActive((i) => Math.max(i - 1, 0));
    else if (e.key === 'Enter' && matches[active]) choose(matches[active]);
    else return;
    e.preventDefault();
  };

  const style = connectorStyle(selected?.connector);
  const Icon = style.icon;

  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      className="inset-x-0"
      trigger={
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className={cx('flex w-full items-center gap-2.5 rounded-md border px-2.5 py-2 text-left transition-colors', open ? 'border-indigo-400 bg-white ring-3 ring-indigo-500/15' : 'border-transparent bg-slate-100/80 hover:bg-slate-100')}
        >
          {selected ? (
            <>
              <span className={cx('grid size-7 shrink-0 place-items-center rounded-md ring-1', style.tile)}><Icon size={14} strokeWidth={1.75} /></span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-mono text-[12.5px] font-medium text-slate-900">{selected.name}</span>
                <span className="block truncate text-[11.5px] text-slate-500">{style.label}{selected.writes && ' · writes data'}</span>
              </span>
            </>
          ) : (
            <span className={cx('flex-1 text-[13px]', value ? 'font-mono text-rose-600' : 'text-slate-400')}>{value ? `${value} (not in the catalog)` : 'Choose a tool…'}</span>
          )}
          <ChevronsUpDown size={15} className="shrink-0 text-slate-400" />
        </button>
      }
    >
      <div className="flex items-center gap-2 border-b border-slate-100 px-3">
        <Search size={14} className="text-slate-400" />
        <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={onKey} placeholder="Search tools…" className="h-10 flex-1 bg-transparent text-[13px] placeholder:text-slate-400 focus:outline-none" />
        <span className="text-[11px] text-slate-400 tabular-nums">{matches.length}</span>
      </div>
      <div ref={list} className="max-h-80 overflow-y-auto p-1.5">
        {!matches.length && <p className="px-3 py-6 text-center text-[12.5px] text-slate-500">No tool matches “{query}”.</p>}
        {matches.map((tool, i) => {
          const s = connectorStyle(tool.connector);
          const ItemIcon = s.icon;
          const header = i === 0 || matches[i - 1]!.connector !== tool.connector;
          return (
            <div key={tool.name}>
              {header && <div className="px-2 pt-2 pb-1 text-[10.5px] font-semibold tracking-wider text-slate-400 uppercase">{s.label}</div>}
              <button
                type="button"
                data-index={i}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(tool)}
                className={cx('flex w-full items-start gap-2.5 rounded-lg px-2 py-2 text-left', i === active && 'bg-slate-100')}
              >
                <span className={cx('mt-0.5 grid size-6 shrink-0 place-items-center rounded-md ring-1', s.tile)}><ItemIcon size={13} strokeWidth={1.75} /></span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate font-mono text-[12px] font-medium text-slate-900">{tool.name}</span>
                    {tool.writes && <PenLine size={11} className="shrink-0 text-amber-500" aria-label="writes" />}
                  </span>
                  <span className="line-clamp-2 text-[11.5px] leading-snug text-slate-500">{tool.description}</span>
                </span>
                {tool.name === value && <Check size={14} className="mt-1 shrink-0 text-indigo-600" />}
              </button>
            </div>
          );
        })}
      </div>
    </Popover>
  );
}
