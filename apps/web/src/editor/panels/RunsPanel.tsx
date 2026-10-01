import type { GraphDoc, Run, RunStatus, RunStep } from '@agent-flow/core';
import { ArrowLeft, Check, ChevronRight, Hourglass, Minus, PlayCircle, X } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { api } from '../../api/client';
import { Badge, Button, cx, Empty, StatusDot, useConfirm, useToast } from '../../components/ui';
import { fullTime, pretty, timeAgo } from '../../lib/format';

export interface RunDetail {
  run: Run;
  steps: RunStep[];
}

interface Props {
  graphId: string;
  runSignal: number;
  selected: RunDetail | null;
  /** Doc of the version the selected run uses, for node titles. */
  runDoc: GraphDoc | null;
  onSelect: (detail: RunDetail | null) => void;
}

export const RUN_TONE: Record<RunStatus, 'blue' | 'green' | 'amber' | 'red' | 'slate'> = {
  running: 'blue',
  completed: 'green',
  stopped: 'amber',
  failed: 'red',
  cancelled: 'slate',
};

const STEP_ICON: Record<RunStep['status'], { icon: ReactNode; className: string }> = {
  succeeded: { icon: <Check size={12} strokeWidth={3} />, className: 'bg-emerald-500 text-white' },
  passed: { icon: <Check size={12} strokeWidth={3} />, className: 'bg-emerald-100 text-emerald-700' },
  skipped: { icon: <Minus size={12} strokeWidth={3} />, className: 'bg-amber-500 text-white' },
  failed: { icon: <X size={12} strokeWidth={3} />, className: 'bg-rose-600 text-white' },
};

function duration(run: Run) {
  const ms = (run.endedAt ?? Date.now()) - run.createdAt;
  if (ms < 1000) return '<1s';
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  return `${Math.round(ms / 3_600_000)}h`;
}

export function RunsPanel({ graphId, runSignal, selected, runDoc, onSelect }: Props) {
  const { fail } = useToast();
  const confirm = useConfirm();
  const [runs, setRuns] = useState<Run[] | null>(null);

  useEffect(() => {
    api.runs(graphId).then(setRuns, fail);
    if (selected) api.run(selected.run.id).then(onSelect, fail);
  }, [graphId, runSignal]);

  const open = (run: Run) => api.run(run.id).then(onSelect, fail);
  const cancel = async () => {
    if (!selected || !(await confirm({ title: 'Cancel run', message: 'Cancel this run? The agent will not be able to continue it.', confirmLabel: 'Cancel run', danger: true }))) return;
    await api.cancelRun(selected.run.id).catch(fail);
  };

  if (selected) return <RunView detail={selected} runDoc={runDoc} onBack={() => onSelect(null)} onCancel={cancel} />;

  if (runs && !runs.length) {
    return (
      <Empty icon={<PlayCircle size={18} />} title="No runs yet">
        Once the flow is published, the agent starts runs with <code className="font-mono">run_start</code> over MCP. Each run appears here with every step it took.
      </Empty>
    );
  }
  return (
    <ul className="divide-y divide-slate-100">
      {runs?.map((run) => (
        <li key={run.id}>
          <button type="button" className="group flex w-full items-center gap-3 px-5 py-3 text-left hover:bg-slate-50" onClick={() => open(run)}>
            <StatusDot tone={RUN_TONE[run.status]} className={run.status === 'running' ? 'animate-pulse' : undefined} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-[13px]">
                <span className="font-medium text-slate-800 capitalize">{run.status}</span>
                <span className="text-[11px] text-slate-400">v{run.version}</span>
              </div>
              <div className="truncate text-[11.5px] text-slate-500">
                {run.startedBy} · {Object.values(run.inputs).map(String).join(', ') || 'no inputs'}
              </div>
            </div>
            <div className="text-right text-[11px] text-slate-400 tabular-nums">
              <div title={fullTime(run.createdAt)}>{timeAgo(run.createdAt)}</div>
              <div>{duration(run)}</div>
            </div>
            <ChevronRight size={14} className="text-slate-300 group-hover:text-slate-500" />
          </button>
        </li>
      ))}
    </ul>
  );
}

function RunView({ detail: { run, steps }, runDoc, onBack, onCancel }: { detail: RunDetail; runDoc: GraphDoc | null; onBack: () => void; onCancel: () => void }) {
  const title = (id: string | null) => (id && runDoc?.nodes.find((n) => n.id === id)?.title) || id || '';
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-slate-100 px-5 py-4">
        <button type="button" onClick={onBack} className="-ml-1 mb-3 flex items-center gap-1 rounded px-1 text-[12px] text-slate-500 hover:text-slate-800"><ArrowLeft size={13} />All runs</button>
        <div className="flex items-center gap-2">
          <Badge tone={RUN_TONE[run.status]} dot className="capitalize">{run.status}</Badge>
          <span className="text-[12px] text-slate-500">v{run.version} · {duration(run)}</span>
          <span className="ml-auto truncate font-mono text-[11px] text-slate-400">{run.id}</span>
        </div>
        <p className="mt-2 text-[12px] text-slate-500">Started by <span className="font-medium text-slate-700">{run.startedBy}</span> · {fullTime(run.createdAt)}</p>
        {Object.keys(run.inputs).length > 0 && (
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-lg bg-slate-50 px-3 py-2 text-[12px]">
            {Object.entries(run.inputs).map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="font-mono text-slate-500">{k}</dt>
                <dd className="truncate font-mono text-slate-800">{String(v)}</dd>
              </div>
            ))}
          </dl>
        )}
        {run.status === 'running' && (
          <div className="mt-3 flex items-center gap-2 rounded-lg bg-sky-50 px-3 py-2 text-[12px] text-sky-800">
            <Hourglass size={13} />
            <span className="min-w-0 flex-1 truncate">Waiting on <span className="font-medium">{title(run.currentNodeId)}</span></span>
            <Button size="sm" variant="danger" onClick={onCancel}>Cancel run</Button>
          </div>
        )}
      </div>

      <ol className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {steps.map((s, i) => {
          const mark = STEP_ICON[s.status];
          return (
            <li key={s.id} className="relative flex gap-3 pb-4">
              {i < steps.length - 1 && <span className="absolute top-6 bottom-0 left-[11px] w-px bg-slate-200" />}
              <span className={cx('relative grid size-6 shrink-0 place-items-center rounded-full ring-4 ring-white', mark.className)}>{mark.icon}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="truncate text-[13px] font-medium text-slate-800">{title(s.nodeId)}</span>
                  <span className="ml-auto shrink-0 text-[10.5px] text-slate-400 tabular-nums">#{s.seq}</span>
                </div>
                {s.toolName && <div className="font-mono text-[11px] text-slate-500">{s.toolName}</div>}
                {s.error && <div className={cx('mt-1.5 rounded-md px-2 py-1.5 text-[12px] leading-snug', s.status === 'skipped' ? 'bg-amber-50 text-amber-800' : 'bg-rose-50 text-rose-700')}>{s.error}</div>}
                <div className="mt-1 flex flex-wrap gap-x-3">
                  {s.args && <Json label="Arguments" value={s.args} />}
                  {s.result !== null && s.result !== undefined && <Json label="Result" value={s.result} />}
                </div>
              </div>
            </li>
          );
        })}
        {!steps.length && <Empty title="No steps yet" />}
      </ol>
    </div>
  );
}

function Json({ label, value }: { label: string; value: unknown }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={cx(open && 'w-full')}>
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex items-center gap-0.5 text-[11.5px] font-medium text-slate-500 hover:text-slate-800">
        <ChevronRight size={12} className={cx('transition-transform', open && 'rotate-90')} />{label}
      </button>
      {open && <pre className="mt-1 max-h-56 overflow-auto rounded-lg bg-slate-900 p-2.5 font-mono text-[11px] leading-relaxed text-slate-100">{pretty(value)}</pre>}
    </div>
  );
}
