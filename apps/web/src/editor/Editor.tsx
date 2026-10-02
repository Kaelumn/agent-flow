import type { GraphDoc, GraphOp, NodeInput, Position } from '@agent-flow/core';
import { AlertCircle, Eye, History, PlayCircle, SlidersHorizontal } from 'lucide-react';
import type { ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import { Badge, Button, cx, Empty, Tooltip, useConfirm, useToast } from '../components/ui';
import { buildMessage, deliver, type Annotation } from './annotate/message';
import { FlowCanvas, type CanvasInstance, type RunTrace, type Selection } from './canvas/FlowCanvas';
import type { RunMark } from './canvas/nodes';
import { autoLayout, makeRoomBefore, NODE_HEIGHT, NODE_WIDTH, resolvePositions, spotBelow } from './layout';
import { EdgePanel } from './panels/EdgePanel';
import { FlowPanel } from './panels/FlowPanel';
import { IssuesPanel } from './panels/IssuesPanel';
import { NodePanel } from './panels/NodePanel';
import { RUN_TONE, RunsPanel, type RunDetail } from './panels/RunsPanel';
import { HistoryPanel } from './panels/HistoryPanel';
import { EditorHeader } from './EditorHeader';
import { useFlow } from './useFlow';

type Tab = 'inspect' | 'issues' | 'versions' | 'runs';

/**
 * Mounted with key={graphId}, so all state starts fresh when switching flows.
 * `hostOrigin` is the MSPbots page embedding the canvas, which receives annotations; null when opened on its own.
 */
export function Editor({ graphId, hostOrigin, onGone }: { graphId: string; hostOrigin: string | null; onGone: () => void }) {
  const flow = useFlow(graphId);
  const { graph, edit } = flow;
  const { fail, notify } = useToast();
  const confirm = useConfirm();
  const [selection, setSelection] = useState<Selection>(null);
  const [tab, setTab] = useState<Tab>('inspect');
  const [rf, setRf] = useState<CanvasInstance | null>(null);
  const [runDetail, setRunDetail] = useState<RunDetail | null>(null);
  const [runDoc, setRunDoc] = useState<GraphDoc | null>(null);
  const [annotating, setAnnotating] = useState(false);

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

  const startAnnotating = () => {
    setSelection(null);
    setAnnotating(true);
  };

  // "A" starts annotating, as the toolbar button does.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && (e.target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName));
      if (e.key.toLowerCase() === 'a' && !e.ctrlKey && !e.metaKey && !e.altKey && !typing && !viewingRun) startAnnotating();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Follow a run: keep the step it is waiting on in view.
  const runAt = viewingRun ? runDetail.run.currentNodeId : null;
  useEffect(() => {
    if (runAt) requestAnimationFrame(() => focusNode(rf, runAt));
  }, [runAt, runDoc]);

  if (!graph || !doc) return <div className="grid flex-1 place-items-center text-sm text-slate-400">Loading flow…</div>;

  const selectedNode = selection?.kind === 'node' ? doc.nodes.find((n) => n.id === selection.id) : undefined;
  const selectedEdge = selection?.kind === 'edge' ? doc.edges.find((e) => e.id === selection.id) : undefined;
  const errorCount = graph.issues.filter((i) => i.severity === 'error').length;

  const select = (s: Selection) => {
    setSelection(s);
    if (s && tab !== 'runs') setTab('inspect');
    if (s?.kind === 'node') focusNode(rf, s.id);
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
    setTab('inspect');
    requestAnimationFrame(() => focusNode(rf, id));
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
    requestAnimationFrame(() => rf?.fitView({ padding: 0.2, duration: 300 }));
  };

  const tabs: { id: Tab; label: string; icon: ReactNode; count?: number; tone?: 'red' | 'amber' | 'blue' }[] = [
    { id: 'inspect', label: 'Inspect', icon: <SlidersHorizontal size={14} /> },
    { id: 'issues', label: 'Problems', icon: <AlertCircle size={14} />, count: graph.issues.length, tone: errorCount ? 'red' : 'amber' },
    { id: 'versions', label: 'History', icon: <History size={14} /> },
    { id: 'runs', label: 'Runs', icon: <PlayCircle size={14} /> },
  ];

  return (
    <div className="flex min-w-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <EditorHeader graph={graph} versionSignal={flow.signals.versions} onShowProblems={() => setTab('issues')} />

        {viewingRun && (
          <div className="flex items-center gap-2.5 border-b border-indigo-100 bg-indigo-50/70 px-4 py-2 text-[12.5px] text-indigo-900">
            <Eye size={14} className="text-indigo-500" />
            <span>
              Viewing run <span className="font-mono text-[11.5px]">{runDetail.run.id}</span> on published v{runDetail.run.version} · read-only
            </span>
            <Badge tone={RUN_TONE[runDetail.run.status]} dot>{runDetail.run.status}</Badge>
            <Button size="sm" className="ml-auto" onClick={() => setRunDetail(null)}>Back to draft</Button>
          </div>
        )}

        <div className="relative min-h-0 flex-1 bg-slate-50">
          <FlowCanvas
            doc={doc}
            issues={issues}
            toolsByName={flow.toolsByName}
            trace={trace}
            live={viewingRun ? null : flow.live}
            selection={selection}
            readOnly={viewingRun}
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
        </div>
      </div>

      <aside className="flex w-[340px] shrink-0 flex-col border-l border-slate-200 bg-white xl:w-[400px]">
        <nav className="flex h-14 shrink-0 items-end gap-0.5 overflow-hidden border-b border-slate-200 px-3">
          {tabs.map((t) => (
            <Tooltip key={t.id} content={t.label} side="bottom">
              <button
                type="button"
                onClick={() => setTab(t.id)}
                aria-label={t.label}
                className={cx(
                  'relative flex h-10 items-center gap-1.5 rounded-t-md px-2 text-[12.5px] font-medium transition-colors',
                  tab === t.id ? 'text-slate-900 after:absolute after:inset-x-1 after:-bottom-px after:h-0.5 after:rounded-full after:bg-indigo-600' : 'text-slate-500 hover:text-slate-800',
                )}
              >
                <span className={tab === t.id ? 'text-indigo-600' : 'text-slate-400'}>{t.icon}</span>
                {/* Only the active tab spells out its name, so five tabs always fit. */}
                {tab === t.id && <span>{t.label}</span>}
                {!!t.count && (
                  <span className={cx('min-w-4 rounded-full px-1 text-center text-[10px] leading-4 font-semibold tabular-nums', t.tone === 'red' ? 'bg-rose-100 text-rose-700' : t.tone === 'blue' ? 'bg-sky-100 text-sky-700' : 'bg-amber-100 text-amber-700')}>{t.count}</span>
                )}
              </button>
            </Tooltip>
          ))}
        </nav>

        <div className="min-h-0 flex-1">
          {tab === 'inspect' &&
            (viewingRun ? (
              <Empty title="Read-only view">You are looking at a published version. Go back to the draft to edit.</Empty>
            ) : selectedNode ? (
              <NodePanel
                node={selectedNode}
                doc={doc}
                tools={flow.tools}
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
          {tab === 'issues' && <IssuesPanel issues={graph.issues} doc={graph.draft} onFocus={select} />}
          {tab === 'versions' && <HistoryPanel graph={graph} versionSignal={flow.signals.versions} onRestored={flow.accept} />}
          {tab === 'runs' && <RunsPanel graphId={graph.id} runSignal={flow.signals.runs} selected={runDetail} runDoc={runDoc} onSelect={setRunDetail} />}
        </div>
      </aside>
    </div>
  );
}

function focusNode(rf: CanvasInstance | null, id: string) {
  const node = rf?.getNode(id);
  if (rf && node) rf.setCenter(node.position.x + NODE_WIDTH / 2, node.position.y + NODE_HEIGHT / 2, { zoom: Math.max(rf.getZoom(), 0.8), duration: 300 });
}

function traceOf({ run, steps }: RunDetail): RunTrace {
  const marks = new Map<string, RunMark>();
  for (const step of steps) marks.set(step.nodeId, step.status);
  const at = run.currentNodeId;
  if (at && run.status === 'running') marks.set(at, 'current');
  else if (at && !marks.has(at)) marks.set(at, 'passed'); // the end node that was reached
  return { marks, edges: new Set(steps.flatMap((s) => (s.edgeId ? [s.edgeId] : []))) };
}
