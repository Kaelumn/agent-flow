import type { GraphSummary } from '@agent-flow/core';
import { Archive, ChevronRight, LogOut, Plus, Search, Workflow } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Identity } from './auth';
import { Avatar, Button, cx, Empty, IconButton, StatusDot } from './components/ui';
import { fullTime, timeAgo } from './lib/format';

interface Props {
  flows: GraphSummary[] | null;
  identity: Identity;
  onOpen: (id: string) => void;
  onCreate: () => void;
  onArchive: (flow: GraphSummary) => void;
  onSignOut: () => void;
}

const GROUPS = [
  { id: 'published', title: 'Published', match: (f: GraphSummary) => f.latestVersion !== null },
  { id: 'drafts', title: 'Drafts', match: (f: GraphSummary) => f.latestVersion === null },
] as const;

/** The flow list, shown when no flow is open. Embedded canvases open a flow directly and never see it. */
export function FlowsHome({ flows, identity, onOpen, onCreate, onArchive, onSignOut }: Props) {
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
    <main className="flex-1 overflow-y-auto bg-slate-50">
      <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-10">
        <header className="flex items-center gap-3">
          <span className="grid size-8 place-items-center rounded-lg bg-indigo-600 text-white shadow-sm shadow-indigo-600/30"><Workflow size={16} /></span>
          <h1 className="text-[17px] font-semibold tracking-tight text-slate-900">Flows</h1>
          <div className="ml-auto flex items-center gap-2">
            <Avatar name={identity.actor} />
            <span className="hidden text-[12.5px] text-slate-600 sm:inline">{identity.actor}</span>
            <IconButton label="Sign out" onClick={onSignOut}><LogOut size={14} /></IconButton>
          </div>
        </header>

        <div className="mt-6 flex items-center gap-2">
          <label className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-slate-400 shadow-xs focus-within:border-indigo-500 focus-within:ring-3 focus-within:ring-indigo-500/15">
            <Search size={14} />
            <input ref={search} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search flows" className="min-w-0 flex-1 bg-transparent text-[13px] text-slate-900 placeholder:text-slate-400 focus:outline-none" />
            {!query && <kbd className="rounded border border-slate-200 px-1 font-sans text-[10px] text-slate-400">/</kbd>}
          </label>
          <Button variant="primary" onClick={onCreate}><Plus size={15} />New flow</Button>
        </div>

        {flows?.length === 0 && (
          <div className="mt-16">
            <Empty icon={<Workflow size={18} />} title="No flows yet">
              Create one, or ask your agent to build one through the MCP endpoint at <code className="font-mono">/mcp</code>.
            </Empty>
          </div>
        )}
        {flows && flows.length > 0 && !filtered.length && <p className="mt-10 text-center text-[13px] text-slate-500">No flow matches “{query}”.</p>}

        {GROUPS.map((group) => {
          const items = filtered.filter(group.match);
          if (!items.length) return null;
          const closed = collapsed.has(group.id) && !query;
          return (
            <section key={group.id} className="mt-6">
              <button type="button" onClick={() => toggle(group.id)} className="flex items-center gap-1 py-1 text-[11px] font-semibold tracking-wider text-slate-500 uppercase hover:text-slate-800">
                <ChevronRight size={12} className={cx('transition-transform', !closed && 'rotate-90')} />
                {group.title}
                <span className="ml-1 font-normal tabular-nums">{items.length}</span>
              </button>
              {!closed && (
                <ul className="mt-2 divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
                  {items.map((f) => (
                    <li key={f.id} className="group flex items-center hover:bg-slate-50">
                      <button type="button" onClick={() => onOpen(f.id)} className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left">
                        <StatusDot tone={f.latestVersion ? 'green' : 'amber'} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13.5px] font-medium text-slate-900">{f.title}</span>
                          {f.description && <span className="mt-0.5 block truncate text-[12px] text-slate-500">{f.description}</span>}
                        </span>
                        <span className="shrink-0 text-right text-[11.5px] text-slate-400 tabular-nums" title={fullTime(f.updatedAt)}>
                          {f.latestVersion ? `v${f.latestVersion}` : 'Draft'} · {timeAgo(f.updatedAt)}
                        </span>
                      </button>
                      <IconButton label="Archive" onClick={() => onArchive(f)} className="mr-2 opacity-0 group-hover:opacity-100 focus-visible:opacity-100">
                        <Archive size={14} />
                      </IconButton>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </main>
  );
}
