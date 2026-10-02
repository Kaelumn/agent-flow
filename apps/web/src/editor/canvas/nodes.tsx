import type { FlowNode, Issue, StepStatus, ToolDefinition } from '@agent-flow/core';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { AlertCircle, AlertTriangle, Check, CircleCheck, CircleMinus, CircleX, CornerDownRight, Minus, PenLine, Play, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { cx } from '../../components/ui';
import { connectorStyle } from '../connectors';
import { nodeSize } from '../layout';

export type RunMark = StepStatus | 'current';

export interface FlowNodeData extends Record<string, unknown> {
  node: FlowNode;
  tool?: ToolDefinition;
  issues: Issue[];
  runMark?: RunMark;
  /** Title of the node the run jumps to when this step fails. */
  errorTarget?: string;
  /** Live playback of someone else's change. */
  motion?: 'enter' | 'leave' | 'flash';
}

export type CanvasNode = Node<FlowNodeData>;

/** Border and badge per run state; the run trace should read like a status board. */
const RUN_STATE: Record<RunMark, { border: string; badge: string; icon: ReactNode; label: string }> = {
  current: { border: 'border-indigo-500 ring-4 ring-indigo-500/15', badge: 'bg-indigo-600 text-white', icon: <span className="size-1.5 animate-ping rounded-full bg-white" />, label: 'Waiting here' },
  succeeded: { border: 'border-emerald-400', badge: 'bg-emerald-500 text-white', icon: <Check size={11} strokeWidth={3} />, label: 'Succeeded' },
  passed: { border: 'border-emerald-300', badge: 'bg-emerald-500 text-white', icon: <Check size={11} strokeWidth={3} />, label: 'Passed' },
  skipped: { border: 'border-amber-400', badge: 'bg-amber-500 text-white', icon: <Minus size={11} strokeWidth={3} />, label: 'Skipped' },
  failed: { border: 'border-rose-500 ring-4 ring-rose-500/10', badge: 'bg-rose-600 text-white', icon: <X size={11} strokeWidth={3} />, label: 'Failed' },
};

const MOTION = { enter: 'af-enter', leave: 'af-leave', flash: 'af-flash' } as const;

function frame(selected: boolean, data: FlowNodeData, hasErrors: boolean) {
  if (selected) return 'border-indigo-500 ring-4 ring-indigo-500/15 shadow-md';
  if (data.runMark) return RUN_STATE[data.runMark].border;
  if (hasErrors) return 'border-rose-300';
  return 'border-slate-200 hover:border-slate-300 hover:shadow-md';
}

function RunBadge({ mark }: { mark?: RunMark }) {
  if (!mark) return null;
  const state = RUN_STATE[mark];
  return (
    <span title={state.label} className={cx('absolute -top-2 -left-2 grid size-5 place-items-center rounded-full shadow ring-2 ring-white', state.badge)}>
      {state.icon}
    </span>
  );
}

/** Problems, drawn inside the card so they never collide with neighbours. */
function Signals({ issues }: Pick<FlowNodeData, 'issues'>) {
  const errors = issues.filter((i) => i.severity === 'error').length;
  const warnings = issues.length - errors;
  if (!errors && !warnings) return null;
  return (
    <div className="flex shrink-0 items-center gap-1.5 text-[11px] font-semibold tabular-nums">
      {errors > 0 && <span title={`${errors} error(s)`} className="flex items-center gap-0.5 text-rose-600"><AlertCircle size={13} />{errors}</span>}
      {warnings > 0 && <span title={`${warnings} warning(s)`} className="flex items-center gap-0.5 text-amber-600"><AlertTriangle size={13} />{warnings}</span>}
    </div>
  );
}

const Tag = ({ className, title, icon, children }: { className: string; title?: string; icon?: ReactNode; children: ReactNode }) => (
  <span title={title} className={cx('inline-flex max-w-full items-center gap-1 rounded-md px-1.5 py-0.5 text-[10.5px] font-medium', className)}>
    {icon}
    <span className="truncate">{children}</span>
  </span>
);

function ToolNode({ data, selected }: NodeProps<CanvasNode>) {
  const { node, tool } = data;
  const style = connectorStyle(tool?.connector);
  const Icon = style.icon;
  const onError = node.onError?.strategy ?? 'stop';
  const hasErrors = data.issues.some((i) => i.severity === 'error');

  return (
    <div style={{ width: nodeSize('tool').width, minHeight: nodeSize('tool').height }} className={cx('group relative rounded-xl border bg-white px-3 py-2.5 shadow-sm transition-[border-color,box-shadow]', frame(selected, data, hasErrors), data.motion && MOTION[data.motion])}>
      <Handle type="target" position={Position.Top} />
      <RunBadge mark={data.runMark} />
      <div className="flex gap-3">
        <div className={cx('grid size-9 shrink-0 place-items-center rounded-lg ring-1', style.tile)}>
          <Icon size={18} strokeWidth={1.75} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="line-clamp-2 text-[13px] leading-snug font-semibold text-slate-900">{node.title}</div>
            <Signals issues={data.issues} />
          </div>
          <div className="mt-0.5 flex min-w-0 items-center gap-1 text-[11px] text-slate-500">
            <span className="shrink-0">{tool ? style.label : 'No tool'}</span>
            {node.tool && <span className="truncate font-mono text-slate-400">· {node.tool.name}</span>}
          </div>
        </div>
      </div>
      {(tool?.writes || node.outputKey || onError !== 'stop') && (
        <div className="mt-2 flex flex-wrap gap-1 pl-12">
          {tool?.writes && <Tag className="bg-amber-50 text-amber-700" title="Changes data in the target system" icon={<PenLine size={10} />}>Writes</Tag>}
          {node.outputKey && <Tag className="bg-slate-100 font-mono text-slate-600" title="Result saved for later steps" icon={<CornerDownRight size={10} />}>{node.outputKey}</Tag>}
          {onError === 'continue' && <Tag className="bg-slate-100 text-slate-500" title="The run continues if this step fails">Continues on error</Tag>}
          {onError === 'goto' && <Tag className="bg-rose-50 text-rose-600" title={`On error the run goes to "${data.errorTarget ?? node.onError?.targetNodeId}"`}>On error → {data.errorTarget ?? node.onError?.targetNodeId}</Tag>}
        </div>
      )}
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

function StartNode({ data, selected }: NodeProps<CanvasNode>) {
  const inputs = data.node.inputs ?? [];
  const hasErrors = data.issues.some((i) => i.severity === 'error');
  return (
    <div style={{ width: nodeSize('start').width, minHeight: nodeSize('start').height }} className={cx('relative flex items-center gap-3 rounded-full border bg-white py-2 pr-4 pl-2 shadow-sm transition-[border-color,box-shadow]', frame(selected, data, hasErrors), data.motion && MOTION[data.motion])}>
      <RunBadge mark={data.runMark} />
      <div className="grid size-10 shrink-0 place-items-center rounded-full bg-emerald-500 text-white shadow-sm shadow-emerald-500/30">
        <Play size={16} fill="currentColor" className="ml-0.5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-[13px] font-semibold text-slate-900">{data.node.title}</span>
          <Signals issues={data.issues} />
        </div>
        <div className="truncate text-[11px] text-slate-500">
          {inputs.length ? inputs.map((i) => <span key={i.name} className="mr-1 font-mono">{i.name}</span>) : 'No inputs'}
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

const OUTCOME = {
  completed: { icon: CircleCheck, tint: 'bg-emerald-50 text-emerald-600', label: 'Completed' },
  stopped: { icon: CircleMinus, tint: 'bg-amber-50 text-amber-600', label: 'Stopped' },
  failed: { icon: CircleX, tint: 'bg-rose-50 text-rose-600', label: 'Failed' },
} as const;

function EndNode({ data, selected }: NodeProps<CanvasNode>) {
  const outcome = OUTCOME[data.node.outcome ?? 'completed'];
  const Icon = outcome.icon;
  const hasErrors = data.issues.some((i) => i.severity === 'error');
  return (
    <div style={{ width: nodeSize('end').width, minHeight: nodeSize('end').height }} className={cx('relative flex items-center gap-2.5 rounded-full border bg-white py-1.5 pr-4 pl-1.5 shadow-sm transition-[border-color,box-shadow]', frame(selected, data, hasErrors), data.motion && MOTION[data.motion])}>
      <Handle type="target" position={Position.Top} />
      <RunBadge mark={data.runMark} />
      <div className={cx('grid size-9 shrink-0 place-items-center rounded-full', outcome.tint)}>
        <Icon size={18} strokeWidth={2} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12.5px] font-semibold text-slate-900">{data.node.title}</div>
        <div className="text-[10px] font-semibold tracking-wider text-slate-400 uppercase">{outcome.label}</div>
      </div>
      <Signals issues={data.issues} />
    </div>
  );
}

export const nodeTypes = { start: StartNode, tool: ToolNode, end: EndNode };
