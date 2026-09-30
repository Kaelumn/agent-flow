import type { FlowNode, Issue, StepStatus, ToolDefinition } from '@agent-flow/core';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { AlertTriangle, CircleStop, MessageSquare, Pencil, Play, Wrench } from 'lucide-react';
import { cx } from '../../components/ui';
import { NODE_HEIGHT, NODE_WIDTH } from '../layout';

export type RunMark = StepStatus | 'current';

export interface FlowNodeData extends Record<string, unknown> {
  node: FlowNode;
  tool?: ToolDefinition;
  issues: Issue[];
  openFeedback: number;
  runMark?: RunMark;
}

export type CanvasNode = Node<FlowNodeData>;

const RUN_RING: Record<RunMark, string> = {
  current: 'ring-4 ring-indigo-500 ring-offset-2',
  succeeded: 'ring-2 ring-emerald-400',
  passed: 'ring-2 ring-emerald-300',
  failed: 'ring-4 ring-red-400',
};

const OUTCOME_STYLE = {
  completed: { bar: 'border-l-emerald-500', text: 'text-emerald-700' },
  stopped: { bar: 'border-l-amber-500', text: 'text-amber-700' },
  failed: { bar: 'border-l-red-500', text: 'text-red-700' },
} as const;

function Shell({ data, selected, className, children }: { data: FlowNodeData; selected: boolean; className: string; children: React.ReactNode }) {
  const errors = data.issues.filter((i) => i.severity === 'error').length;
  const warnings = data.issues.length - errors;
  return (
    <div
      style={{ width: NODE_WIDTH, minHeight: NODE_HEIGHT }}
      className={cx(
        'relative rounded-xl border bg-white px-3 py-2.5 shadow-sm transition-shadow',
        selected ? 'border-indigo-500 shadow-md ring-2 ring-indigo-200' : errors ? 'border-red-300' : 'border-slate-200',
        data.runMark && RUN_RING[data.runMark],
        className,
      )}
    >
      {children}
      {data.runMark === 'current' && (
        <span className="absolute -top-2.5 left-3 rounded-full bg-indigo-600 px-2 py-px text-[10px] font-semibold text-white shadow">waiting here</span>
      )}
      <div className="absolute -top-2 right-2 flex gap-1">
        {errors > 0 && <Pill className="bg-red-600 text-white" title={`${errors} error(s)`}><AlertTriangle size={10} />{errors}</Pill>}
        {warnings > 0 && <Pill className="bg-amber-400 text-amber-950" title={`${warnings} warning(s)`}><AlertTriangle size={10} />{warnings}</Pill>}
        {data.openFeedback > 0 && <Pill className="bg-sky-600 text-white" title="Open feedback"><MessageSquare size={10} />{data.openFeedback}</Pill>}
      </div>
    </div>
  );
}

const Pill = ({ className, title, children }: { className: string; title: string; children: React.ReactNode }) => (
  <span title={title} className={cx('flex items-center gap-0.5 rounded-full px-1.5 py-px text-[10px] font-semibold shadow', className)}>{children}</span>
);

function StartNode({ data, selected }: NodeProps<CanvasNode>) {
  const inputs = data.node.inputs ?? [];
  return (
    <Shell data={data} selected={selected} className="border-l-4 border-l-emerald-500">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-emerald-700 uppercase"><Play size={12} />Start</div>
      <div className="mt-1 text-sm font-medium text-slate-900">{data.node.title}</div>
      <div className="mt-1 truncate text-xs text-slate-500">{inputs.length ? `Inputs: ${inputs.map((i) => i.name).join(', ')}` : 'No inputs'}</div>
      <Handle type="source" position={Position.Bottom} />
    </Shell>
  );
}

function ToolNode({ data, selected }: NodeProps<CanvasNode>) {
  const { node, tool } = data;
  const onError = node.onError?.strategy ?? 'stop';
  return (
    <Shell data={data} selected={selected} className="border-l-4 border-l-indigo-500">
      <Handle type="target" position={Position.Top} />
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-slate-500">
          <Wrench size={12} className="shrink-0" />
          <span className="truncate font-mono">{node.tool?.name ?? 'no tool'}</span>
        </span>
        {tool?.writes && <span className="flex shrink-0 items-center gap-0.5 rounded bg-amber-50 px-1 text-[10px] font-medium text-amber-700"><Pencil size={9} />writes</span>}
      </div>
      <div className="mt-1 text-sm font-medium leading-snug text-slate-900">{node.title}</div>
      <div className="mt-1 flex flex-wrap gap-x-2 text-[11px] whitespace-nowrap text-slate-400">
        {tool && <span>{tool.connector}</span>}
        {node.outputKey && <span className="font-mono">→ {node.outputKey}</span>}
        {onError !== 'stop' && <span>on error: {onError === 'goto' ? `jump to ${node.onError?.targetNodeId}` : 'continue'}</span>}
      </div>
      <Handle type="source" position={Position.Bottom} />
    </Shell>
  );
}

function EndNode({ data, selected }: NodeProps<CanvasNode>) {
  const outcome = data.node.outcome ?? 'completed';
  const style = OUTCOME_STYLE[outcome];
  return (
    <Shell data={data} selected={selected} className={cx('border-l-4', style.bar)}>
      <Handle type="target" position={Position.Top} />
      <div className={cx('flex items-center gap-1.5 text-[11px] font-semibold tracking-wide uppercase', style.text)}><CircleStop size={12} />End · {outcome}</div>
      <div className="mt-1 text-sm font-medium text-slate-900">{data.node.title}</div>
    </Shell>
  );
}

export const nodeTypes = { start: StartNode, tool: ToolNode, end: EndNode };
