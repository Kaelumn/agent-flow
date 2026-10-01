import type { GraphSummary } from '@agent-flow/core';
import { Archive, ChevronRight, LogOut, Plus, Search, Workflow } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Identity } from './auth';
import { Avatar, cx, StatusDot } from './components/ui';
import { fullTime, timeAgo } from './lib/format';

interface Props {
  flows: GraphSummary[] | null;
  current: string | null;
  identity: Identity;
  onCreate: () => void;
  onArchive: (flow: GraphSummary) => void;
  onSignOut: () => void;
}

const GROUPS = [
  { id: 'published', title: 'Published', match: (f: GraphSummary) => f.latestVersion !== null },
  { id: 'drafts', title: 'Drafts', match: (f: GraphSummary) => f.latestVersion === null },
] as const;

export function Sidebar({ flows, current, identity, onCreate, onArchive, onSignOut }: Props) {
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const search = useRef<HTMLInputElement>(null);

  // "/" focuses search, as in most tools.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName);
      if (e.key === '/' && !typing) {
        e.preventDefault();
        search.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (flows ?? []).filter((f) => !q || f.title.toLowerCase().includes(q) || f.description.toLowerCase().includes(q));
  }, [flows, query]);

  const toggle = (id: string) =>
    setCollapsed((c) => {
      const next = new Set(c);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <aside className="flex w-60 shrink-0 flex-col bg-slate-950 text-slate-300 xl:w-64">
      <div className="flex h-14 items-center gap-2.5 px-4">
        <span className="grid size-7 place-items-center rounded-lg bg-indigo-500 text-white shadow-sm shadow-indigo-500/40"><Workflow size={15} /></span>
        <span className="text-[14px] font-semibold tracking-tight text-white">Agent Flow</span>
      </div>

      <div className="space-y-2 px-3 pb-3">
        <button type="button" onClick={onCreate} className="flex h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-indigo-500 text-[13px] font-medium text-white shadow-sm shadow-indigo-500/30 transition-colors hover:bg-indigo-400">
          <Plus size={15} />New flow
        </button>
        <label className="flex h-8 items-center gap-2 rounded-lg bg-white/5 px-2.5 text-slate-400 ring-1 ring-white/10 focus-within:ring-indigo-400/60">
          <Search size={13} />
          <input ref={search} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search flows" className="min-w-0 flex-1 bg-transparent text-[12.5px] text-slate-100 placeholder:text-slate-500 focus:outline-none" />
          {!query && <kbd className="rounded border border-white/10 px-1 font-sans text-[10px] text-slate-500">/</kbd>}
        </label>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {flows?.length === 0 && <p className="px-3 py-4 text-[12px] leading-relaxed text-slate-500">No flows yet. Create one, or ask your agent to build one over MCP.</p>}
        {flows && flows.length > 0 && !filtered.length && <p className="px-3 py-4 text-[12px] text-slate-500">No flow matches “{query}”.</p>}
        {GROUPS.map((group) => {
          const items = filtered.filter(group.match);
          if (!items.length) return null;
          const closed = collapsed.has(group.id) && !query;
          return (
            <div key={group.id} className="mt-2 first:mt-0">
              <button type="button" onClick={() => toggle(group.id)} className="flex w-full items-center gap-1 px-2 py-1.5 text-[10.5px] font-semibold tracking-wider text-slate-500 uppercase hover:text-slate-300">
                <ChevronRight size={12} className={cx('transition-transform', !closed && 'rotate-90')} />
                {group.title}
                <span className="ml-auto font-normal tabular-nums">{items.length}</span>
              </button>
              {!closed &&
                items.map((f) => (
                  <div key={f.id} className={cx('group relative flex items-center rounded-lg', f.id === current ? 'bg-white/10 text-white' : 'hover:bg-white/5')}>
                    {f.id === current && <span className="absolute top-2 bottom-2 left-0 w-0.5 rounded-full bg-indigo-400" />}
                    <a href={`#/flows/${f.id}`} className="flex min-w-0 flex-1 items-center gap-2.5 px-2.5 py-2">
                      <StatusDot tone={f.latestVersion ? 'green' : 'amber'} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px]">{f.title}</span>
                        <span className="block text-[11px] text-slate-500" title={fullTime(f.updatedAt)}>
                          {f.latestVersion ? `v${f.latestVersion}` : 'Draft'} · {timeAgo(f.updatedAt)}
                        </span>
                      </span>
                    </a>
                    <button type="button" title="Archive" onClick={() => onArchive(f)} className="mr-1.5 hidden rounded-md p-1.5 text-slate-500 hover:bg-white/10 hover:text-slate-200 group-hover:block">
                      <Archive size={13} />
                    </button>
                  </div>
                ))}
            </div>
          );
        })}
      </nav>

      <div className="flex items-center gap-2.5 border-t border-white/10 px-4 py-3">
        <Avatar name={identity.actor} className="bg-indigo-500/20 text-indigo-200" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12.5px] font-medium text-slate-200">{identity.actor}</div>
          <div className="truncate text-[11px] text-slate-500">{identity.workspaceId}</div>
        </div>
        <button type="button" title="Sign out" onClick={onSignOut} className="rounded-md p-1.5 text-slate-500 hover:bg-white/10 hover:text-slate-200"><LogOut size={14} /></button>
      </div>
    </aside>
  );
}
