import type { GraphDoc, GraphOp, NodeInput } from '@agent-flow/core';
import { AlertCircle, CircleStop, Eye, LayoutGrid, Plus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import { Badge, Button, cx, Empty, useConfirm, useToast } from '../components/ui';
import { FlowCanvas, type CanvasInstance, type RunTrace, type Selection } from './canvas/FlowCanvas';
import type { RunMark } from './canvas/nodes';
import { autoLayout, NODE_HEIGHT, NODE_WIDTH, resolvePositions, spotBelow } from './layout';
import { EdgePanel } from './panels/EdgePanel';
import { FeedbackPanel } from './panels/FeedbackPanel';
import { FlowPanel } from './panels/FlowPanel';
import { IssuesPanel } from './panels/IssuesPanel';
import { NodePanel } from './panels/NodePanel';
import { RUN_TONE, RunsPanel, type RunDetail } from './panels/RunsPanel';
import { VersionsPanel } from './panels/VersionsPanel';
import { useFlow } from './useFlow';

type Tab = 'inspect' | 'issues' | 'feedback' | 'versions' | 'runs';

/** Mounted with key={graphId}, so all state starts fresh when switching flows. */
export function Editor({ graphId, onGone }: { graphId: string; onGone: () => void }) {
  const flow = useFlow(graphId);
  const { graph, edit } = flow;
  const { fail } = useToast();
  const confirm = useConfirm();
  const [selection, setSelection] = useState<Selection>(null);
  const [tab, setTab] = useState<Tab>('inspect');
  const [rf, setRf] = useState<CanvasInstance | null>(null);
  const [runDetail, setRunDetail] = useState<RunDetail | null>(null);
  const [runDoc, setRunDoc] = useState<GraphDoc | null>(null);

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
  const openFeedbackByNode = useMemo(() => {
    const counts = new Map<string, number>();
    for (const f of flow.feedback) if (f.nodeId && f.status === 'open') counts.set(f.nodeId, (counts.get(f.nodeId) ?? 0) + 1);
    return counts;
  }, [flow.feedback]);

  // Follow a run: keep the step it is waiting on in view.
  const runAt = viewingRun ? runDetail.run.currentNodeId : null;
  useEffect(() => {
    if (runAt) requestAnimationFrame(() => focusNode(rf, runAt));
  }, [runAt, runDoc]);

  if (!graph || !doc) return <div className="grid flex-1 place-items-center text-sm text-slate-400">Loading flow…</div>;

  const selectedNode = selection?.kind === 'node' ? doc.nodes.find((n) => n.id === selection.id) : undefined;
  const selectedEdge = selection?.kind === 'edge' ? doc.edges.find((e) => e.id === selection.id) : undefined;
  const errorCount = graph.issues.filter((i) => i.severity === 'error').length;
  const openFeedback = flow.feedback.filter((f) => f.status === 'open').length;

  const select = (s: Selection) => {
    setSelection(s);
    if (s && tab !== 'feedback' && tab !== 'runs') setTab('inspect');
    if (s?.kind === 'node') focusNode(rf, s.id);
  };

  /** Pins the on-screen spot of unplaced nodes whenever a position is saved, so nothing else jumps. */
  const placed = (ops: GraphOp[]): GraphOp[] => {
    const unplaced = graph.draft.nodes.filter((n) => !n.position);
    if (!unplaced.length) return ops;
    const shown = resolvePositions(graph.draft);
    return [{ op: 'moveNodes', positions: Object.fromEntries(unplaced.map((n) => [n.id, shown[n.id]!])) }, ...ops];
  };

  /** New nodes go under the selected node, or under the whole flow. */
  const addNode = async (type: 'tool' | 'end') => {
    const shown = resolvePositions(graph.draft);
    const anchor = selectedNode ? shown[selectedNode.id] : undefined;
    const position = spotBelow(Object.values(shown), anchor);
    const node: NodeInput = type === 'tool' ? { type, title: 'New step', position } : { type, title: 'End', outcome: 'completed', position };
    const result = await edit(placed([{ op: 'addNodes', nodes: [node] }]));
    const id = result?.createdNodeIds[0];
    if (id) {
      setSelection({ kind: 'node', id });
      setTab('inspect');
      requestAnimationFrame(() => focusNode(rf, id));
    }
  };

  const remove = async (items: NonNullable<Selection>[]) => {
    const nodes = items.filter((i) => i.kind === 'node');
    if (nodes.length && !(await confirm({ title: 'Delete steps', message: `Delete ${nodes.length} step(s) and their connections?`, confirmLabel: 'Delete', danger: true }))) return;
    await edit(items.map((i) => (i.kind === 'node' ? { op: 'removeNode' as const, nodeId: i.id } : { op: 'removeEdge' as const, edgeId: i.id })));
    setSelection(null);
  };

  const layout = async () => {
    await edit([{ op: 'moveNodes', positions: autoLayout(graph.draft) }]);
    requestAnimationFrame(() => rf?.fitView({ padding: 0.2, duration: 300 }));
  };

  const tabs: { id: Tab; label: string; count?: number; tone?: 'red' | 'amber' }[] = [
    { id: 'inspect', label: 'Inspect' },
    { id: 'issues', label: 'Problems', count: graph.issues.length, tone: errorCount ? 'red' : 'amber' },
    { id: 'feedback', label: 'Feedback', count: openFeedback, tone: 'amber' },
    { id: 'versions', label: 'Publish' },
    { id: 'runs', label: 'Runs' },
  ];

  return (
    <div className="flex min-w-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-slate-200 bg-white px-3 xl:px-4">
          <h1 className="min-w-0 truncate text-sm font-semibold text-slate-900" title={graph.title}>{graph.title}</h1>
          <Badge className="shrink-0">rev {graph.revision}</Badge>
          {graph.latestVersion ? <Badge tone="green" className="shrink-0">v{graph.latestVersion}</Badge> : <Badge tone="amber" className="shrink-0">not published</Badge>}
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            {errorCount > 0 && (
              <Button size="sm" variant="ghost" className="text-red-600" onClick={() => setTab('issues')}><AlertCircle size={14} />{errorCount}<span className="hidden xl:inline"> error(s)</span></Button>
            )}
            <Button size="sm" onClick={() => addNode('tool')} disabled={viewingRun} title="Add a step"><Plus size={14} /><span className="hidden xl:inline">Step</span></Button>
            <Button size="sm" onClick={() => addNode('end')} disabled={viewingRun} title="Add an end"><CircleStop size={14} /><span className="hidden xl:inline">End</span></Button>
            <Button size="sm" onClick={layout} disabled={viewingRun} title="Tidy up the layout"><LayoutGrid size={14} /><span className="hidden xl:inline">Tidy up</span></Button>
          </div>
        </header>

        {viewingRun && (
          <div className="flex items-center gap-2 border-b border-sky-200 bg-sky-50 px-4 py-2 text-xs text-sky-900">
            <Eye size={14} />
            Showing run <span className="font-mono">{runDetail.run.id}</span> on published v{runDetail.run.version}.
            <Badge tone={RUN_TONE[runDetail.run.status]}>{runDetail.run.status}</Badge>
            <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setRunDetail(null)}>Back to draft</Button>
          </div>
        )}

        <div className="relative min-h-0 flex-1 bg-slate-50">
          <FlowCanvas
            doc={doc}
            issues={issues}
            toolsByName={flow.toolsByName}
            openFeedbackByNode={openFeedbackByNode}
            trace={trace}
            selection={selection}
            readOnly={viewingRun}
            onSelect={select}
            onReady={setRf}
            onConnect={(source, target) => void edit([{ op: 'addEdges', edges: [{ source, target }] }])}
            onMove={(positions) => void edit(placed([{ op: 'moveNodes', positions }]))}
            onDelete={remove}
          />
        </div>
      </div>

      <aside className="flex w-80 shrink-0 flex-col border-l border-slate-200 bg-white xl:w-96">
        <nav className="flex h-14 shrink-0 items-end gap-1 border-b border-slate-200 px-2">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cx('flex items-center gap-1 border-b-2 px-1.5 pb-2.5 text-xs xl:px-2 xl:text-[13px]', tab === t.id ? 'border-indigo-600 font-medium text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-800')}
            >
              {t.label}
              {!!t.count && <span className={cx('rounded-full px-1.5 text-[10px] font-semibold text-white', t.tone === 'red' ? 'bg-red-500' : 'bg-amber-500')}>{t.count}</span>}
            </button>
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
                onSave={(patch) => edit([{ op: 'updateNode', nodeId: selectedNode.id, patch }])}
                onDelete={() => remove([{ kind: 'node', id: selectedNode.id }])}
              />
            ) : selectedEdge ? (
              <EdgePanel
                edge={selectedEdge}
                doc={doc}
                onSave={(patch) => edit([{ op: 'updateEdge', edgeId: selectedEdge.id, patch }])}
                onDelete={() => remove([{ kind: 'edge', id: selectedEdge.id }])}
              />
            ) : (
              <FlowPanel graph={graph} onSave={(meta) => api.updateGraph(graph.id, meta).then(flow.accept, fail)} />
            ))}
          {tab === 'issues' && <IssuesPanel issues={graph.issues} doc={graph.draft} onFocus={select} />}
          {tab === 'feedback' && (
            <FeedbackPanel graphId={graph.id} doc={graph.draft} items={flow.feedback} selectedNodeId={selectedNode?.id ?? null} onFocusNode={(id) => select({ kind: 'node', id })} onChanged={flow.reloadFeedback} />
          )}
          {tab === 'versions' && <VersionsPanel graph={graph} versionSignal={flow.signals.versions} onRestored={flow.accept} />}
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
