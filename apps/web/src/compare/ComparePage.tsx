import { diffGraphs, marksOf, type GraphDoc, type ToolDefinition } from '@agent-flow/core';
import { ArrowLeft, ArrowLeftRight, ChevronDown, ChevronUp } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, type VersionSummary } from '../api/client';
import { Badge, Button, cx, Segmented, Select, useToast } from '../components/ui';
import { ChangeDetail, type Picked } from './ChangeDetail';
import { ChangeList, edgeKey, nodeKey } from './ChangeList';
import { ComparePane, type PaneInstance } from './ComparePane';
import { boundsOf, sharedLayout } from './layout';
import './compare.css';

export type Side = number | 'draft';

/** Below this width the two canvases do not fit side by side: one canvas with a switch between the versions. */
const SIDE_BY_SIDE = 900;
/** The list of changes needs this much room beside the canvases. */
const WITH_LIST = 1180;

const label = (v: Side) => (v === 'draft' ? 'Draft' : `v${v}`);
const hashFor = (id: string, from: Side, to: Side) => `/flows/${id}/compare/${from}/${to}`;

interface Loaded {
  title: string;
  latest: number | null;
  versions: VersionSummary[];
  before: GraphDoc;
  after: GraphDoc;
  tools: ToolDefinition[];
}

interface Props {
  graphId: string;
  from: Side;
  to: Side;
}

/**
 * Two versions of a flow side by side on one shared layout, so what is in both stays in place and what changed
 * stands out. Everything here only reads: nothing on this page edits the flow.
 */
export default function ComparePage({ graphId, from, to }: Props) {
  const { fail } = useToast();
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [onlyChanges, setOnlyChanges] = useState(false);
  const [side, setSide] = useState<'before' | 'after'>('after');
  const root = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1200);
  const panes = useRef<{ before?: PaneInstance; after?: PaneInstance }>({});
  const viewport = useRef<{ x: number; y: number; zoom: number } | null>(null);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setData(null);
    setError(null);
    setSelected(null);
    viewport.current = null;
    let live = true;
    Promise.all([
      api.getGraph(graphId),
      api.versions(graphId),
      api.tools(),
      from === 'draft' ? null : api.version(graphId, from),
      to === 'draft' ? null : api.version(graphId, to),
    ]).then(
      ([graph, versions, tools, a, b]) => live && setData({ title: graph.title, latest: graph.latestVersion, versions, tools, before: a ? a.doc : graph.draft, after: b ? b.doc : graph.draft }),
      (err) => {
        if (!live) return;
        setError(err instanceof Error ? err.message : 'Could not load the versions');
        fail(err);
      },
    );
    return () => {
      live = false;
    };
  }, [graphId, from, to]);

  const diff = useMemo(() => (data ? diffGraphs(data.before, data.after) : null), [data]);
  const marks = useMemo(() => (data && diff ? marksOf(data.before, data.after, diff) : null), [data, diff]);
  const positions = useMemo(() => (data ? sharedLayout(data.before, data.after) : null), [data]);
  const toolsByName = useMemo(() => new Map((data?.tools ?? []).map((t) => [t.name, t])), [data]);

  /** Step titles by id, from whichever version still has the step. */
  const title = useMemo(() => {
    const titles = new Map<string, string>();
    for (const n of [...(data?.before.nodes ?? []), ...(data?.after.nodes ?? [])]) titles.set(n.id, n.title);
    return (id: string) => titles.get(id) ?? id;
  }, [data]);

  const keys = useMemo(() => (diff ? [...diff.nodes.map((c) => nodeKey(c.nodeId)), ...diff.edges.map((_, i) => edgeKey(i))] : []), [diff]);

  const picked = useMemo((): Picked | null => {
    if (!diff || !selected) return null;
    if (selected.startsWith('n:')) {
      const change = diff.nodes.find((c) => nodeKey(c.nodeId) === selected);
      return change ? { kind: 'node', change } : null;
    }
    const change = diff.edges[Number(selected.slice(2))];
    return change ? { kind: 'edge', change } : null;
  }, [diff, selected]);

  if (error) {
    return (
      <div className="grid flex-1 place-items-center bg-slate-50 p-6 text-center">
        <div>
          <p className="text-sm text-slate-600">{error}</p>
          <Button className="mt-3" onClick={() => (location.hash = `/flows/${graphId}`)}>Back to the flow</Button>
        </div>
      </div>
    );
  }
  if (!data || !diff || !marks || !positions) {
    return <div ref={root} className="grid flex-1 place-items-center bg-slate-50 text-sm text-slate-400">Loading versions…</div>;
  }

  const sideBySide = width >= SIDE_BY_SIDE;
  const showList = width >= WITH_LIST;
  const bounds = boundsOf(positions, data.before, data.after);

  /** Moves both canvases to a flow point. */
  const flyTo = (x: number, y: number) => {
    for (const rf of Object.values(panes.current)) void rf?.setCenter(x, y, { zoom: Math.max(0.7, rf.getZoom()), duration: 300 });
  };

  const select = (key: string | null) => {
    setSelected(key);
    if (!key) return;
    if (key.startsWith('n:')) {
      const at = positions[key.slice(2)];
      if (at) flyTo(at.x + 148, at.y + 40);
    } else {
      const change = diff.edges[Number(key.slice(2))];
      const e = (change?.after ?? change?.before)!;
      const a = positions[e.source];
      const b = positions[e.target];
      if (a && b) flyTo((a.x + b.x) / 2 + 148, (a.y + b.y) / 2 + 40);
    }
  };

  const step = (by: 1 | -1) => {
    if (!keys.length) return;
    const at = selected ? keys.indexOf(selected) : -1;
    select(keys[(at + by + keys.length) % keys.length]!);
  };

  const edgeKeyOf = (id: string, which: 'beforeId' | 'afterId') => {
    const i = diff.edges.findIndex((c) => c[which] === id);
    return i < 0 ? null : edgeKey(i);
  };

  const sync = (from: 'before' | 'after') => (vp: { x: number; y: number; zoom: number }) => {
    viewport.current = vp;
    const other = panes.current[from === 'before' ? 'after' : 'before'];
    void other?.setViewport(vp);
  };

  const pane = (which: 'before' | 'after') => {
    const doc = which === 'before' ? data.before : data.after;
    const idKey = which === 'before' ? 'beforeId' : 'afterId';
    const edgeChange = picked?.kind === 'edge' ? picked.change : null;
    return (
      <ComparePane
        key={`${from}-${to}-${which}`}
        doc={doc}
        other={which === 'before' ? data.after : data.before}
        positions={positions}
        nodeMarks={which === 'before' ? marks.before.nodes : marks.after.nodes}
        edgeMarks={which === 'before' ? marks.before.edges : marks.after.edges}
        toolsByName={toolsByName}
        selectedNode={picked?.kind === 'node' ? picked.change.nodeId : null}
        selectedEdge={edgeChange?.[idKey] ?? null}
        onlyChanges={onlyChanges}
        onSelectNode={(id) => setSelected(diff.nodes.some((c) => c.nodeId === id) ? nodeKey(id) : null)}
        onSelectEdge={(id) => setSelected(edgeKeyOf(id, idKey))}
        onClear={() => setSelected(null)}
        onInit={(rf) => {
          panes.current[which] = rf;
          if (viewport.current) void rf.setViewport(viewport.current);
          else void rf.fitBounds(bounds, { padding: 0.06 });
        }}
        onMove={sync(which)}
      />
    );
  };

  const versionOptions = data.versions.map((v) => v.version);
  const canSwap = to !== 'draft';

  return (
    <div ref={root} className="flex h-full min-w-0 flex-1 flex-col bg-slate-50">
      <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-slate-200 bg-white px-4 py-2.5">
        <Button variant="ghost" size="sm" onClick={() => (location.hash = `/flows/${graphId}`)}><ArrowLeft size={14} />Back</Button>
        <h1 className="max-w-[28ch] truncate text-[14px] font-semibold text-slate-900">{data.title}</h1>
        <div className="flex items-center gap-1.5">
          <Select className="!h-8 !w-auto" value={String(from)} onChange={(e) => (location.hash = hashFor(graphId, Number(e.target.value), to))} aria-label="Compare from">
            {versionOptions.map((v) => <option key={v} value={v}>v{v}</option>)}
          </Select>
          <Button variant="ghost" size="sm" disabled={!canSwap} onClick={() => (location.hash = hashFor(graphId, to as number, from))} aria-label="Swap the two versions"><ArrowLeftRight size={14} /></Button>
          <Select className="!h-8 !w-auto" value={String(to)} onChange={(e) => (location.hash = hashFor(graphId, from, e.target.value === 'draft' ? 'draft' : Number(e.target.value)))} aria-label="Compare to">
            {versionOptions.map((v) => <option key={v} value={v}>v{v}</option>)}
            <option value="draft">Draft</option>
          </Select>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Summary diff={diff} />
          {diff.movedNodes > 0 && <span className="text-[11.5px] text-slate-400">{diff.movedNodes} moved, not shown</span>}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <label className="flex cursor-pointer items-center gap-1.5 text-[12px] text-slate-600 select-none">
            <input type="checkbox" checked={onlyChanges} onChange={(e) => setOnlyChanges(e.target.checked)} className="size-3.5 accent-indigo-600" />
            Fade the rest
          </label>
          <div className="flex items-center">
            <Button variant="secondary" size="sm" onClick={() => step(-1)} disabled={!keys.length} aria-label="Previous change"><ChevronUp size={14} /></Button>
            <Button variant="secondary" size="sm" className="ml-1" onClick={() => step(1)} disabled={!keys.length} aria-label="Next change"><ChevronDown size={14} /></Button>
          </div>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          {!sideBySide && (
            <div className="shrink-0 px-4 pt-2.5">
              <Segmented value={side} onChange={setSide} options={[{ value: 'before', label: label(from) }, { value: 'after', label: label(to) }]} />
            </div>
          )}
          <div className="relative flex min-h-0 flex-1 gap-2 p-2">
            {sideBySide ? (
              <>
                <Frame title={label(from)} live={from === data.latest}>{pane('before')}</Frame>
                <Frame title={label(to)} live={to === data.latest} draft={to === 'draft'}>{pane('after')}</Frame>
              </>
            ) : (
              <Frame title={side === 'before' ? label(from) : label(to)} live={(side === 'before' ? from : to) === data.latest}>{pane(side)}</Frame>
            )}
          </div>
          <div className="max-h-[40%] min-h-[88px] shrink-0 overflow-y-auto border-t border-slate-200 bg-white">
            <ChangeDetail picked={picked} title={title} beforeLabel={label(from)} afterLabel={label(to)} />
          </div>
        </div>
        {showList && (
          <aside className="w-72 shrink-0 border-l border-slate-200 bg-white">
            <ChangeList diff={diff} title={title} selected={selected} onPick={select} />
          </aside>
        )}
      </div>
      <p className="sr-only">Both versions are drawn on one shared layout, so positions here are not the ones saved in the flow.</p>
    </div>
  );
}

function Frame({ title, live, draft, children }: { title: string; live?: boolean; draft?: boolean; children: ReactNode }) {
  return (
    <section className="relative min-w-0 flex-1 overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
      <div className="pointer-events-none absolute top-2.5 left-3 z-10 flex items-center gap-1.5 rounded-full border border-slate-200 bg-white/95 py-0.5 pr-2.5 pl-2.5 text-[12px] font-semibold text-slate-800 shadow-sm">
        {title}
        {live && <Badge tone="green" dot>Live</Badge>}
        {draft && <Badge tone="amber">unpublished</Badge>}
      </div>
      {children}
    </section>
  );
}

function Summary({ diff }: { diff: NonNullable<ReturnType<typeof diffGraphs>> }) {
  const n = (list: { kind: string }[], kind: string) => list.filter((c) => c.kind === kind).length;
  const chip = (count: number, text: string, className: string) => count > 0 && <span key={text} className={cx('rounded-full px-2 py-0.5 text-[11.5px] font-medium', className)}>{count} {text}</span>;
  const steps = diff.nodes;
  const links = diff.edges;
  return (
    <>
      {chip(n(steps, 'added'), 'added', 'bg-emerald-100 text-emerald-800')}
      {chip(n(steps, 'removed'), 'removed', 'bg-red-100 text-red-800')}
      {chip(n(steps, 'changed'), 'modified', 'bg-amber-100 text-amber-900')}
      {links.length > 0 && <span className="text-[11.5px] text-slate-500">{links.length} connection{links.length > 1 ? 's' : ''} changed</span>}
      {steps.length + links.length === 0 && <span className="text-[12px] text-slate-500">No differences</span>}
    </>
  );
}
