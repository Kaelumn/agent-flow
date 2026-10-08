import type { FlowNode, Issue, StepStatus, ToolDefinition } from '@agent-flow/core';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { AlertCircle, AlertTriangle, Check, CircleCheck, CircleMinus, CircleX, CornerDownRight, Minus, PenLine, Play, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { cx } from '../../components/ui';
import { stepStyle } from '../connectors';
import { nodeSize } from '../layout';
import { NodeActionBar } from './NodeActions';

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
  /** One row per way out when the node branches; each row is where its connection leaves the card. */
  branches?: BranchRow[];
  onPickEdge?: (edgeId: string) => void;
}

export interface BranchRow {
  edgeId: string;
  /** The condition, or the fallback wording for a default path. */
  text: string;
  kind: 'if' | 'else' | 'missing';
  /** The card side the connection leaves from: towards its target. */
  side: 'left' | 'right';
  state?: 'selected' | 'invalid' | 'trace';
}

/** Handle id of the plain way out at the bottom of a card. */
export const OUT_HANDLE = 'out';

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
  return 'border-slate-200/90 hover:border-slate-300 hover:shadow-md';
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

const CARD = 'group relative rounded-2xl border bg-white p-3 shadow-[0_1px_3px_rgb(15_23_42/0.06)] transition-[border-color,box-shadow]';

/** Square icon at the head of a card. */
const IconSquare = ({ className, children }: { className: string; children: ReactNode }) => (
  <span className={cx('grid size-6 shrink-0 place-items-center rounded-lg text-white', className)}>{children}</span>
);

function CardHead({ icon, title, issues, sub }: { icon: ReactNode; title: string; issues: Issue[]; sub: ReactNode }) {
  return (
    <>
      <div className="flex items-center gap-2">
        {icon}
        <div className="min-w-0 flex-1 truncate text-[13px] font-semibold text-slate-900" title={title}>{title}</div>
        <Signals issues={issues} />
      </div>
      <div className="mt-1 flex min-w-0 items-center gap-1 pl-8 text-[11px] text-slate-400">{sub}</div>
    </>
  );
}

const ROW_STATE = {
  selected: 'bg-indigo-50 ring-1 ring-indigo-300',
  invalid: 'bg-rose-50 ring-1 ring-rose-200',
  trace: 'bg-emerald-50 ring-1 ring-emerald-200',
} as const;

/** The ways out of a branching node, one row each, with the connection leaving beside its row. */
function BranchRows({ rows, onPick }: { rows: BranchRow[]; onPick?: (edgeId: string) => void }) {
  return (
    <div className="mt-2 space-y-1">
      {rows.map((row) => (
        <div
          key={row.edgeId}
          title={row.text}
          onClick={(e) => {
            if (!onPick) return;
            e.stopPropagation();
            onPick(row.edgeId);
          }}
          className={cx('relative flex h-6 cursor-pointer items-center gap-1.5 rounded-md bg-slate-50 px-2 text-[11px] hover:bg-slate-100', row.state && ROW_STATE[row.state])}
        >
          <span className={cx('shrink-0 font-mono text-[10px] font-semibold', row.kind === 'else' ? 'text-slate-400' : 'text-indigo-600')}>{row.kind === 'else' ? 'ELSE' : 'IF'}</span>
          <span className={cx('truncate', row.kind === 'missing' ? 'text-rose-600' : 'text-slate-600')}>{row.text}</span>
          <Handle
            type="source"
            id={row.edgeId}
            position={row.side === 'left' ? Position.Left : Position.Right}
            className="af-branch"
            style={row.side === 'left' ? { left: -13 } : { right: -13 }}
          />
        </div>
      ))}
    </div>
  );
}

function ToolNode({ data, selected }: NodeProps<CanvasNode>) {
  const { node, tool } = data;
  const style = stepStyle(node, tool);
  const Icon = style.icon;
  const onError = node.onError?.strategy ?? 'stop';
  const hasErrors = data.issues.some((i) => i.severity === 'error');
  const instruction = node.instruction?.trim() ?? '';

  return (
    <div style={{ width: nodeSize('tool').width }} className={cx(CARD, frame(selected, data, hasErrors), data.motion && MOTION[data.motion])}>
      <Handle type="target" position={Position.Top} />
      <NodeActionBar node={node} selected={selected} />
      <RunBadge mark={data.runMark} />
      <CardHead
        icon={<IconSquare className={style.solid}><Icon size={14} strokeWidth={2} /></IconSquare>}
        title={node.title}
        issues={data.issues}
        sub={
          <>
            <span className="shrink-0">{style.label}</span>
            {style.detail && <span className="truncate font-mono">· {style.detail}</span>}
          </>
        }
      />
      {instruction && (
        <div className="mt-2 rounded-lg bg-slate-50 px-2 py-1.5 text-[11px] leading-[16px] text-slate-500">
          <div className="line-clamp-2">{instruction}</div>
        </div>
      )}
      {(tool?.writes || node.outputKey || onError !== 'stop') && (
        <div className="mt-2 flex flex-wrap gap-1">
          {tool?.writes && <Tag className="bg-amber-50 text-amber-700" title="Changes data in the target system" icon={<PenLine size={10} />}>Writes</Tag>}
          {node.outputKey && <Tag className="bg-slate-100 font-mono text-slate-600" title="Result saved for later steps" icon={<CornerDownRight size={10} />}>{node.outputKey}</Tag>}
          {onError === 'continue' && <Tag className="bg-slate-100 text-slate-500" title="The run continues if this step fails">Continues on error</Tag>}
          {onError === 'goto' && <Tag className="bg-rose-50 text-rose-600" title={`On error the run goes to "${data.errorTarget ?? node.onError?.targetNodeId}"`}>On error → {data.errorTarget ?? node.onError?.targetNodeId}</Tag>}
        </div>
      )}
      {data.branches && <BranchRows rows={data.branches} onPick={data.onPickEdge} />}
      <Handle type="source" id={OUT_HANDLE} position={Position.Bottom} />
    </div>
  );
}

function StartNode({ data, selected }: NodeProps<CanvasNode>) {
  const inputs = data.node.inputs ?? [];
  const hasErrors = data.issues.some((i) => i.severity === 'error');
  return (
    <div style={{ width: nodeSize('start').width }} className={cx(CARD, frame(selected, data, hasErrors), data.motion && MOTION[data.motion])}>
      <RunBadge mark={data.runMark} />
      <CardHead
        icon={<IconSquare className="bg-emerald-500"><Play size={12} fill="currentColor" className="ml-px" /></IconSquare>}
        title={data.node.title}
        issues={data.issues}
        sub={inputs.length ? <span className="truncate font-mono">{inputs.map((i) => i.name).join('  ')}</span> : 'No inputs'}
      />
      {data.branches && <BranchRows rows={data.branches} onPick={data.onPickEdge} />}
      <Handle type="source" id={OUT_HANDLE} position={Position.Bottom} />
      <NodeActionBar node={data.node} selected={selected} />
    </div>
  );
}

const OUTCOME = {
  completed: { icon: CircleCheck, solid: 'bg-emerald-500', label: 'Completed' },
  stopped: { icon: CircleMinus, solid: 'bg-amber-500', label: 'Stopped' },
  failed: { icon: CircleX, solid: 'bg-rose-500', label: 'Failed' },
} as const;

function EndNode({ data, selected }: NodeProps<CanvasNode>) {
  const outcome = OUTCOME[data.node.outcome ?? 'completed'];
  const Icon = outcome.icon;
  const hasErrors = data.issues.some((i) => i.severity === 'error');
  return (
    <div style={{ width: nodeSize('end').width, minHeight: nodeSize('end').height }} className={cx(CARD, 'flex items-center gap-2 py-2', frame(selected, data, hasErrors), data.motion && MOTION[data.motion])}>
      <Handle type="target" position={Position.Top} />
      <NodeActionBar node={data.node} selected={selected} />
      <RunBadge mark={data.runMark} />
      <IconSquare className={outcome.solid}><Icon size={14} strokeWidth={2.25} /></IconSquare>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-semibold text-slate-900">{data.node.title}</div>
        <div className="text-[11px] text-slate-400">{outcome.label}</div>
      </div>
      <Signals issues={data.issues} />
    </div>
  );
}

export const nodeTypes = { start: StartNode, tool: ToolNode, end: EndNode };
