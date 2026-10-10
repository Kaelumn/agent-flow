import { diffGraphs, marksOf, type GraphDiff, type GraphDoc, type ToolDefinition } from '@agent-flow/core';
import { ArrowLeft, ArrowRight, ChevronDown, ChevronUp, Contrast, ListTree, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, type VersionSummary } from '../api/client';
import { Badge, Button, cx, IconButton, Segmented, Tooltip, useToast } from '../components/ui';
import { ChangeDetail, type Picked } from './ChangeDetail';
import { ChangeList, edgeKey, nodeKey } from './ChangeList';
import { ComparePane, type PaneInstance } from './ComparePane';
import { boundsOf, sharedLayout } from './layout';
import { VersionMenu, type VersionOption } from './VersionMenu';
import './compare.css';

export type Side = number | 'draft';

/** Below this width the two canvases do not fit side by side: one canvas with a switch between the versions. */
const SIDE_BY_SIDE = 900;
/** Below this the toolbar drops the words beside its icons. */
const ROOMY = 1040;
/** Zoom the canvases settle on when they fly to a change: large enough to read the cards. */
const READABLE_ZOOM = 0.85;

const name = (v: Side) => (v === 'draft' ? 'Draft' : `v${v}`);
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
  const [listOpen, setListOpen] = useState(false);
  const [side, setSide] = useState<'before' | 'after'>('after');
  const root = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1200);
  const panes = useRef<{ before?: PaneInstance; after?: PaneInstance }>({});
  const viewport = useRef<{ x: number; y: number; zoom: number } | null>(null);
  const [ready, setReady] = useState(0);
  const opened = useRef(false);
  /** Set once the person pans or zooms: from then on the view is theirs and is not re-centred. */
  const userMoved = useRef(false);

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
    setReady(0);
    opened.current = false;
    userMoved.current = false;
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

  const bounds = useMemo(() => (data && positions ? boundsOf(positions, data.before, data.after) : null), [data, positions]);
  const sideBySide = width >= SIDE_BY_SIDE;
  const roomy = width >= ROOMY;

  /** The canvases on screen: both side by side, otherwise the one being shown. Others may be left over from a wider layout. */
  const shown = () => (sideBySide ? [panes.current.before, panes.current.after] : [panes.current[side]]).filter((rf): rf is PaneInstance => !!rf);

  /** Moves the canvases to a flow point. */
  const flyTo = (x: number, y: number, duration = 300) => {
    for (const rf of shown()) void rf.setCenter(x, y, { zoom: Math.max(READABLE_ZOOM, rf.getZoom()), duration });
  };

  /** Selects a change and brings it into view on both canvases. */
  const select = (key: string | null, duration = 300) => {
    setSelected(key);
    if (!key || !diff || !positions) return;
    if (key.startsWith('n:')) {
      const at = positions[key.slice(2)];
      if (at) flyTo(at.x + 148, at.y + 40, duration);
    } else {
      const change = diff.edges[Number(key.slice(2))];
      const e = (change?.after ?? change?.before)!;
      const a = positions[e.source];
      const b = positions[e.target];
      if (a && b) flyTo((a.x + b.x) / 2 + 148, (a.y + b.y) / 2 + 40, duration);
    }
  };

  const selectedNow = useRef(selected);
  selectedNow.current = selected;

  // Frame the canvases: on the first change when there is one (the whole flow is too small to read at this size),
  // otherwise on the whole flow. This runs whenever a canvas starts or the width changes, because an embedded page is
  // sized after it loads and a window can be resized; once the person pans or zooms, the view is theirs.
  useEffect(() => {
    if (!data || !bounds || ready < (sideBySide ? 2 : 1) || userMoved.current) return;
    const timer = setTimeout(() => {
      if (userMoved.current) return;
      if (!opened.current && keys.length) {
        opened.current = true;
        select(keys[0]!, 0);
      } else if (selectedNow.current) select(selectedNow.current, 0);
      else for (const rf of shown()) void rf.fitBounds(bounds, { padding: 0.06 });
    }, 120);
    return () => clearTimeout(timer);
  }, [ready, width, data, bounds, sideBySide, side]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (listOpen) setListOpen(false);
      else if (selected) setSelected(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [listOpen, selected]);

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

  const total = diff.nodes.length + diff.edges.length;
  const index = selected ? keys.indexOf(selected) + 1 : 0;

  const step = (by: 1 | -1) => {
    if (!keys.length) return;
    const at = selected ? keys.indexOf(selected) : by === 1 ? -1 : 0;
    select(keys[(at + by + keys.length) % keys.length]!);
  };

  const edgeKeyOf = (id: string, which: 'beforeId' | 'afterId') => {
    const i = diff.edges.findIndex((c) => c[which] === id);
    return i < 0 ? null : edgeKey(i);
  };

  const sync = (origin: 'before' | 'after') => (vp: { x: number; y: number; zoom: number }) => {
    userMoved.current = true;
    viewport.current = vp;
    void panes.current[origin === 'before' ? 'after' : 'before']?.setViewport(vp);
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
          setReady((n) => n + 1);
        }}
        onMove={sync(which)}
      />
    );
  };

  const options = (withDraft: boolean): VersionOption[] => [
    ...(withDraft ? ([{ value: 'draft', name: 'Draft' }] as VersionOption[]) : []),
    ...data.versions.map((v) => ({ value: v.version, name: `v${v.version}`, note: v.note, createdAt: v.createdAt, live: v.version === data.latest })),
  ];
  const canSwap = to !== 'draft';

  return (
    <div ref={root} className="flex h-full min-w-0 flex-1 flex-col bg-white">
      <header className="relative z-20 flex h-12 shrink-0 items-center gap-2 border-b border-slate-200 bg-white px-3">
        <IconButton label="Back to the flow" onClick={() => (location.hash = `/flows/${graphId}`)}><ArrowLeft size={16} /></IconButton>
        <h1 className={cx('truncate text-[14px] font-semibold text-slate-900', roomy ? 'max-w-[32ch]' : 'max-w-[14ch]')} title={data.title}>{data.title}</h1>
        <Divider />
        <VersionMenu label="Compare from" value={from} options={options(false)} onChange={(v) => (location.hash = hashFor(graphId, v, to))} />
        {canSwap ? (
          <IconButton label="Swap the two versions" onClick={() => (location.hash = hashFor(graphId, to as number, from))}><ArrowRight size={15} /></IconButton>
        ) : (
          <ArrowRight size={15} className="mx-1 text-slate-300" />
        )}
        <VersionMenu label="Compare to" value={to} options={options(true)} onChange={(v) => (location.hash = hashFor(graphId, from, v))} />
        <Divider />
        <div className="flex items-center">
          <IconButton label="Previous change" onClick={() => step(-1)}><ChevronUp size={15} /></IconButton>
          <span className="min-w-[44px] text-center text-[12px] text-slate-500 tabular-nums">{total ? `${index || '–'} / ${total}` : '0'}</span>
          <IconButton label="Next change" onClick={() => step(1)}><ChevronDown size={15} /></IconButton>
        </div>
        <Divider />
        <Tooltip content="Dim everything that did not change, so only the changes stand out" side="bottom">
          <button
            type="button"
            role="switch"
            aria-checked={onlyChanges}
            onClick={() => setOnlyChanges((v) => !v)}
            className={cx('flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] font-medium transition-colors', onlyChanges ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-100')}
          >
            <Contrast size={15} />
            {roomy && 'Fade unchanged'}
          </button>
        </Tooltip>

        <div className="relative ml-auto">
          <button
            type="button"
            onClick={() => setListOpen((o) => !o)}
            aria-expanded={listOpen}
            className={cx('flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] font-medium transition-colors', listOpen ? 'bg-slate-200/70 text-slate-900' : 'bg-slate-100 text-slate-700 hover:bg-slate-200/70')}
          >
            <ListTree size={15} />
            {total ? `${total} change${total > 1 ? 's' : ''}` : 'No changes'}
          </button>
          {listOpen && (
            <div className="absolute top-full right-0 z-30 mt-1.5 flex max-h-[min(70vh,520px)] w-80 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl shadow-slate-900/10">
              <div className="flex shrink-0 items-center gap-1.5 border-b border-slate-100 px-3 py-2">
                <Summary diff={diff} />
                <IconButton label="Close the list" onClick={() => setListOpen(false)} className="ml-auto"><X size={14} /></IconButton>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">
                <ChangeList diff={diff} title={title} selected={selected} onPick={(k) => select(k)} />
              </div>
              {diff.movedNodes > 0 && <p className="shrink-0 border-t border-slate-100 px-3 py-2 text-[11.5px] text-slate-400">{diff.movedNodes} step{diff.movedNodes > 1 ? 's' : ''} only moved, not listed.</p>}
            </div>
          )}
        </div>
      </header>

      <main className="relative min-h-0 flex-1 bg-slate-50">
        {!sideBySide && (
          <div className="absolute top-3 left-1/2 z-10 w-56 -translate-x-1/2 rounded-lg bg-white shadow-sm ring-1 ring-slate-200">
            <Segmented value={side} onChange={setSide} options={[{ value: 'before', label: name(from) }, { value: 'after', label: name(to) }]} />
          </div>
        )}
        <div className="grid h-full" style={{ gridTemplateColumns: sideBySide ? '1fr 1fr' : '1fr' }}>
          {sideBySide ? (
            <>
              <Half tag={name(from)} live={from === data.latest}>{pane('before')}</Half>
              <Half tag={name(to)} live={to === data.latest} draft={to === 'draft'} divider>{pane('after')}</Half>
            </>
          ) : (
            <Half tag={name(side === 'before' ? from : to)} live={(side === 'before' ? from : to) === data.latest} hideTag>{pane(side)}</Half>
          )}
        </div>

        {picked && (
          <div className="absolute bottom-4 left-1/2 z-10 max-h-[46%] w-[min(680px,calc(100%-32px))] -translate-x-1/2 overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-xl shadow-slate-900/10">
            <ChangeDetail picked={picked} title={title} beforeLabel={name(from)} afterLabel={name(to)} onClose={() => setSelected(null)} />
          </div>
        )}
        {!total && (
          <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full border border-slate-200 bg-white px-4 py-1.5 text-[12.5px] text-slate-500 shadow-sm">
            These two versions are the same flow{diff.movedNodes ? `, apart from ${diff.movedNodes} moved step${diff.movedNodes > 1 ? 's' : ''}` : ''}.
          </div>
        )}
      </main>
    </div>
  );
}

const Divider = () => <span className="mx-1 h-5 w-px shrink-0 bg-slate-200" />;

/** One version's canvas. The two halves share one surface and are told apart by a thin line and a small tag. */
function Half({ tag, live, draft, divider, hideTag, children }: { tag: string; live?: boolean; draft?: boolean; divider?: boolean; hideTag?: boolean; children: ReactNode }) {
  return (
    <section className={cx('relative min-w-0 overflow-hidden', divider && 'border-l border-slate-300')}>
      {!hideTag && (
        <div className="pointer-events-none absolute top-3 left-3 z-10 flex items-center gap-1.5 rounded-full bg-white/95 py-0.5 pr-2.5 pl-2.5 text-[12px] font-medium text-slate-800 ring-1 ring-slate-200">
          {tag}
          {live && <Badge tone="green" dot>Live</Badge>}
          {draft && <span className="text-[11px] font-normal text-amber-700">unpublished</span>}
        </div>
      )}
      {children}
    </section>
  );
}

function Summary({ diff }: { diff: GraphDiff }) {
  const count = (list: { kind: string }[], kind: string) => list.filter((c) => c.kind === kind).length;
  const chip = (n: number, text: string, className: string) => n > 0 && <span key={text} className={cx('rounded-full px-2 py-0.5 text-[11.5px] font-medium', className)}>{n} {text}</span>;
  const steps = diff.nodes;
  return (
    <>
      {chip(count(steps, 'added'), 'added', 'bg-emerald-100 text-emerald-800')}
      {chip(count(steps, 'removed'), 'removed', 'bg-red-100 text-red-800')}
      {chip(count(steps, 'changed'), 'modified', 'bg-amber-100 text-amber-900')}
      {diff.edges.length > 0 && <span className="text-[11.5px] text-slate-500">{diff.edges.length} connection{diff.edges.length > 1 ? 's' : ''}</span>}
      {steps.length + diff.edges.length === 0 && <span className="text-[12px] text-slate-500">No differences</span>}
    </>
  );
}
