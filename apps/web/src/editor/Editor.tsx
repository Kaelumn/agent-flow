import type { GraphDoc, GraphOp, NodeInput, Position } from '@agent-flow/core';
import { AlertCircle, Eye, History, PlayCircle, SlidersHorizontal } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client';
import { Badge, Button, Empty, useConfirm, useToast } from '../components/ui';
import { buildMessage, deliver, type Annotation } from './annotate/message';
import { centerOn, fitPadding, FlowCanvas, minimapSize, minimapSpace, type CanvasInstance, type RunTrace, type Selection } from './canvas/FlowCanvas';
import type { RunMark } from './canvas/nodes';
import { Dock, dockInsets, NARROW_WIDTH, type DockTab } from './Dock';
import { EditorHeader } from './EditorHeader';
import { autoLayout, makeRoomBefore, NODE_HEIGHT, NODE_WIDTH, resolvePositions, spotBelow } from './layout';
import { EdgePanel } from './panels/EdgePanel';
import { FlowPanel } from './panels/FlowPanel';
import { HistoryPanel } from './panels/HistoryPanel';
import { IssuesPanel } from './panels/IssuesPanel';
import { NodePanel } from './panels/NodePanel';
import { RUN_TONE, RunsPanel, type RunDetail } from './panels/RunsPanel';
import { useFlow } from './useFlow';

type Tab = 'inspect' | 'issues' | 'versions' | 'runs';

/** Uncovered canvas narrower than this gets the icon-only toolbar. */
const COMPACT_WIDTH = 560;
/** Rail, minimap and the icon-only toolbar side by side. */
const MINIMAP_MIN_WIDTH = 540;

interface Props {
  graphId: string;
  /** The MSPbots page embedding the canvas, which receives annotations; null when opened on its own. */
  hostOrigin: string | null;
  onGone: () => void;
  /** Back to the flow list; absent when embedded. */
  onBack?: () => void;
}

/**
 * The canvas fills the editor; the header, the panels and the run banner float over it. One layout serves the canvas
 * embedded beside the MSPbots conversation and opened on its own. Mounted with key={graphId}.
 */
export function Editor({ graphId, hostOrigin, onGone, onBack }: Props) {
  const flow = useFlow(graphId);
  const { graph, edit } = flow;
  const { fail, notify } = useToast();
  const confirm = useConfirm();
  const [selection, setSelection] = useState<Selection>(null);
  const [panel, setPanel] = useState<Tab | null>(null);
  const [rf, setRf] = useState<CanvasInstance | null>(null);
  const [runDetail, setRunDetail] = useState<RunDetail | null>(null);
  const [runDoc, setRunDoc] = useState<GraphDoc | null>(null);
  const [annotating, setAnnotating] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const measure = () => setSize({ width: el.clientWidth, height: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [!graph]);

  useEffect(() => {
    if (flow.missing) onGone();
  }, [flow.missing]);

  const runVersion = runDetail?.run.version;
  useEffect(() => {
    setRunDoc(null);
    if (runVersion) api.version(graphId, runVersion).then((v) => setRunDoc(v.doc), fail);
  }, [graphId, runVersion]);

  const viewingRun = !!runDetail && !!runDoc;
  const doc = viewingRun ? runDoc! : graph?.draft;
  const issues = viewingRun || !graph ? [] : graph.issues;
  const trace = useMemo(() => (runDetail ? traceOf(runDetail) : null), [runDetail]);
  const narrow = size.width < NARROW_WIDTH;
  const insets = dockInsets(!!panel && !annotating, narrow, size.height);
  // The minimap sits where the open panel would cover it, and needs the room of the icon-only toolbar beside it.
  const minimap = size.width >= MINIMAP_MIN_WIDTH && (!panel || annotating) ? minimapSize(size.width, size.height) : null;
  // What covers the bottom-right corner: the open side card, or the minimap. The rail sits at the top only.
  const bottomRight = panel && !annotating && !narrow ? insets.right : minimap ? minimapSpace(minimap) : 0;

  /** Centres a node in the part of the canvas the dock leaves free; `opening` when the dock is about to open for it. */
  const focusNode = (id: string, opening = false) => {
    const node = rf?.getNode(id);
    const free = opening ? dockInsets(true, narrow, size.height) : insets;
    if (rf && node) void centerOn(rf, node.position.x + NODE_WIDTH / 2, node.position.y + NODE_HEIGHT / 2, free, Math.max(rf.getZoom(), 0.8));
  };

  const startAnnotating = () => {
    setSelection(null);
    setPanel(null);
    setAnnotating(true);
  };

  // "A" starts annotating, as the toolbar button does; Escape closes the panel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && (e.target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName));
      if (typing || e.ctrlKey || e.metaKey || e.altKey || annotating) return;
      if (e.key.toLowerCase() === 'a' && !viewingRun) startAnnotating();
      if (e.key === 'Escape') setPanel(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Follow a run: keep the step it is waiting on in view.
  const runAt = viewingRun ? runDetail.run.currentNodeId : null;
  useEffect(() => {
    if (runAt) requestAnimationFrame(() => focusNode(runAt));
  }, [runAt, runDoc]);

  if (!graph || !doc) {
    return (
      <div ref={root} className="grid flex-1 place-items-center bg-slate-50 text-sm text-slate-400">
        Loading flow…
      </div>
    );
  }

  const selectedNode = selection?.kind === 'node' ? doc.nodes.find((n) => n.id === selection.id) : undefined;
  const selectedEdge = selection?.kind === 'edge' ? doc.edges.find((e) => e.id === selection.id) : undefined;
  const errorCount = graph.issues.filter((i) => i.severity === 'error').length;

  /** Selecting opens the inspector (unless runs are open); clicking empty canvas closes it. */
  const select = (s: Selection) => {
    setSelection(s);
    setPanel((p) => (s ? (p === 'runs' ? p : 'inspect') : p === 'inspect' ? null : p));
    if (s?.kind === 'node') focusNode(s.id, true);
  };

  /** Pins the on-screen spot of unplaced nodes whenever a position is saved, so nothing else jumps. */
  const placed = (ops: GraphOp[]): GraphOp[] => {
    const unplaced = graph.draft.nodes.filter((n) => !n.position);
    if (!unplaced.length) return ops;
    const shown = resolvePositions(graph.draft);
    return [{ op: 'moveNodes', positions: Object.fromEntries(unplaced.map((n) => [n.id, shown[n.id]!])) }, ...ops];
  };

  /** Applies ops that create node `id`, then selects and shows it. */
  const createStep = async (id: string, ops: GraphOp[]) => {
    if (!(await edit(placed(ops)))) return;
    setSelection({ kind: 'node', id });
    setPanel('inspect');
    requestAnimationFrame(() => focusNode(id, true));
  };

  const newId = () => {
    let id: string;
    do id = `n_${Math.random().toString(36).slice(2, 8)}`;
    while (graph.draft.nodes.some((n) => n.id === id));
    return id;
  };

  /** New nodes go under the selected node, or under the whole flow. */
  const addNode = (type: 'tool' | 'end') => {
    const shown = resolvePositions(graph.draft);
    const position = spotBelow(Object.values(shown), selectedNode ? shown[selectedNode.id] : undefined);
    const id = newId();
    const node: NodeInput = type === 'tool' ? { id, type, title: 'New step', position } : { id, type, title: 'End', outcome: 'completed', position };
    return createStep(id, [{ op: 'addNodes', nodes: [node] }]);
  };

  /** Splits an edge with a new step; the edge's condition stays on the first half. */
  const insertOnEdge = (edgeId: string) => {
    const edge = graph.draft.edges.find((e) => e.id === edgeId);
    if (!edge) return;
    const { spot, moved } = makeRoomBefore(graph.draft, resolvePositions(graph.draft), edge.target);
    const id = newId();
    return createStep(id, [
      { op: 'moveNodes', positions: moved },
      { op: 'addNodes', nodes: [{ id, type: 'tool', title: 'New step', position: spot }] },
      { op: 'removeEdge', edgeId },
      { op: 'addEdges', edges: [{ source: edge.source, target: id, condition: edge.condition, isDefault: edge.isDefault }, { source: id, target: edge.target }] },
    ]);
  };

  const connectToNew = (source: string, position: Position) => {
    const id = newId();
    return createStep(id, [
      { op: 'addNodes', nodes: [{ id, type: 'tool', title: 'New step', position }] },
      { op: 'addEdges', edges: [{ source, target: id }] },
    ]);
  };

  const remove = async (items: NonNullable<Selection>[]) => {
    const nodes = items.filter((i) => i.kind === 'node');
    if (nodes.length && !(await confirm({ title: 'Delete steps', message: `Delete ${nodes.length} step(s) and their connections?`, confirmLabel: 'Delete', danger: true }))) return;
    await edit(items.map((i) => (i.kind === 'node' ? { op: 'removeNode' as const, nodeId: i.id } : { op: 'removeEdge' as const, edgeId: i.id })));
    setSelection(null);
  };

  /** Annotations are not stored: they go to the conversation (or the clipboard) and are gone from here. */
  const sendAnnotations = async (items: Annotation[]) => {
    const message = buildMessage({ id: graph.id, title: graph.title, revision: graph.revision }, graph.draft, items);
    try {
      const outcome = await deliver(message, hostOrigin);
      const n = `${items.length} annotation${items.length > 1 ? 's' : ''}`;
      if (outcome === 'sent') notify(`Sent ${n} to the conversation`);
      else notify(hostOrigin ? `MSPbots did not confirm, so ${n} were copied. Paste them into the chat.` : `Copied ${n}. Paste them into your chat with the agent.`);
      setAnnotating(false);
    } catch (err) {
      fail(err);
    }
  };

  const layout = async () => {
    await edit([{ op: 'moveNodes', positions: autoLayout(graph.draft) }]);
    requestAnimationFrame(() => rf?.fitView({ padding: fitPadding(insets), maxZoom: 1, duration: 300 }));
  };

  const tabs: DockTab<Tab>[] = [
    { id: 'inspect', label: 'Inspect', icon: <SlidersHorizontal size={15} /> },
    { id: 'issues', label: 'Problems', icon: <AlertCircle size={15} />, count: graph.issues.length, tone: errorCount ? 'red' : 'amber' },
    { id: 'versions', label: 'History', icon: <History size={15} /> },
    { id: 'runs', label: 'Runs', icon: <PlayCircle size={15} /> },
  ];

  return (
    <div ref={root} className="relative min-w-0 flex-1 overflow-hidden bg-slate-50">
      <FlowCanvas
        doc={doc}
        issues={issues}
        toolsByName={flow.toolsByName}
        trace={trace}
        live={viewingRun ? null : flow.live}
        selection={selection}
        readOnly={viewingRun}
        insets={insets}
        compact={size.width - bottomRight < COMPACT_WIDTH}
        minimap={minimap}
        bottomRight={bottomRight}
        onSelect={select}
        onReady={setRf}
        onConnect={(source, target) => void edit([{ op: 'addEdges', edges: [{ source, target }] }])}
        onConnectToNew={(source, position) => void connectToNew(source, position)}
        onInsertOnEdge={(edgeId) => void insertOnEdge(edgeId)}
        onMove={(positions) => void edit(placed([{ op: 'moveNodes', positions }]))}
        onDelete={remove}
        onAddStep={() => void addNode('tool')}
        onAddEnd={() => void addNode('end')}
        onTidy={() => void layout()}
        onAnnotate={startAnnotating}
        annotate={annotating && !viewingRun ? { mode: hostOrigin ? 'send' : 'copy', onSend: sendAnnotations, onExit: () => setAnnotating(false) } : null}
      />

      <div className="absolute top-3 left-3 z-10 flex flex-col items-start gap-2" style={{ maxWidth: `calc(100% - ${insets.right + 24}px)` }}>
        <EditorHeader graph={graph} versionSignal={flow.signals.versions} onShowProblems={() => setPanel('issues')} onBack={onBack} />
        {viewingRun && (
          <div className="flex max-w-full items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50/95 py-1 pr-1 pl-3 text-[12px] text-indigo-900 shadow-lg shadow-slate-900/5 backdrop-blur">
            <Eye size={14} className="shrink-0 text-indigo-500" />
            <span className="truncate">
              Run <span className="font-mono text-[11px]">{runDetail.run.id}</span> · v{runDetail.run.version} · read-only
            </span>
            <Badge tone={RUN_TONE[runDetail.run.status]} dot>{runDetail.run.status}</Badge>
            <Button size="sm" onClick={() => setRunDetail(null)}>Back to draft</Button>
          </div>
        )}
      </div>

      {!annotating && (
        <Dock tabs={tabs} open={panel} narrow={narrow} onOpen={setPanel} onClose={() => setPanel(null)}>
          {panel === 'inspect' &&
            (viewingRun ? (
              <Empty title="Read-only view">You are looking at a published version. Go back to the draft to edit.</Empty>
            ) : selectedNode ? (
              <NodePanel
                node={selectedNode}
                doc={doc}
                tools={flow.tools}
                skills={flow.skills}
                issues={graph.issues.filter((i) => i.nodeId === selectedNode.id)}
                onSave={(patch) => edit([{ op: 'updateNode', nodeId: selectedNode.id, patch }])}
                onDelete={() => remove([{ kind: 'node', id: selectedNode.id }])}
              />
            ) : selectedEdge ? (
              <EdgePanel
                edge={selectedEdge}
                doc={doc}
                onSave={(patch) => edit([{ op: 'updateEdge', edgeId: selectedEdge.id, patch }])}
                onInsert={() => void insertOnEdge(selectedEdge.id)}
                onDelete={() => remove([{ kind: 'edge', id: selectedEdge.id }])}
              />
            ) : (
              <FlowPanel graph={graph} onSave={(meta) => api.updateGraph(graph.id, meta).then(flow.accept, fail)} />
            ))}
          {panel === 'issues' && <IssuesPanel issues={graph.issues} doc={graph.draft} onFocus={select} />}
          {panel === 'versions' && <HistoryPanel graph={graph} versionSignal={flow.signals.versions} onRestored={flow.accept} />}
          {panel === 'runs' && <RunsPanel graphId={graph.id} runSignal={flow.signals.runs} selected={runDetail} runDoc={runDoc} onSelect={setRunDetail} />}
        </Dock>
      )}
    </div>
  );
}

function traceOf({ run, steps }: RunDetail): RunTrace {
  const marks = new Map<string, RunMark>();
  for (const step of steps) marks.set(step.nodeId, step.status);
  const at = run.currentNodeId;
  if (at && run.status === 'running') marks.set(at, 'current');
  else if (at && !marks.has(at)) marks.set(at, 'passed'); // the end node that was reached
  return { marks, edges: new Set(steps.flatMap((s) => (s.edgeId ? [s.edgeId] : []))) };
}
