import type { GraphDoc, Run, RunStatus, RunStep } from '@agent-flow/core';
import { ArrowLeft } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { Badge, Button, Empty, useConfirm, useToast } from '../../components/ui';
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

  if (selected) {
    const { run, steps } = selected;
    const title = (id: string | null) => (id && runDoc?.nodes.find((n) => n.id === id)?.title) || id || '';
    return (
      <div className="flex h-full flex-col">
        <div className="space-y-2 border-b border-slate-200 p-4">
          <Button size="sm" variant="ghost" onClick={() => onSelect(null)}><ArrowLeft size={14} />All runs</Button>
          <div className="flex items-center gap-2">
            <Badge tone={RUN_TONE[run.status]}>{run.status}</Badge>
            <span className="text-sm font-medium text-slate-800">v{run.version}</span>
            <span className="font-mono text-[11px] text-slate-400">{run.id}</span>
          </div>
          <div className="text-xs text-slate-500">Started by {run.startedBy} · {fullTime(run.createdAt)}</div>
          {run.status === 'running' && (
            <div className="flex items-center justify-between rounded-md bg-sky-50 px-2.5 py-2 text-xs text-sky-800">
              Waiting on: {title(run.currentNodeId)}
              <Button size="sm" variant="danger" onClick={cancel}>Cancel run</Button>
            </div>
          )}
          <Json label="Inputs" value={run.inputs} />
        </div>
        <ol className="flex-1 space-y-2 overflow-y-auto p-4">
          {steps.map((s) => (
            <li key={s.id} className="rounded-lg border border-slate-200 p-2.5">
              <div className="flex items-center gap-2">
                <span className="w-5 text-right text-[11px] text-slate-400">{s.seq}</span>
                <span className="flex-1 truncate text-sm text-slate-800">{title(s.nodeId)}</span>
                <Badge tone={s.status === 'failed' ? 'red' : 'green'}>{s.status}</Badge>
              </div>
              {s.toolName && <div className="mt-1 ml-7 font-mono text-[11px] text-slate-500">{s.toolName}</div>}
              {s.error && <div className="mt-1 ml-7 text-xs text-red-600">{s.error}</div>}
              <div className="ml-7">
                {s.args && <Json label="Arguments" value={s.args} />}
                {s.result !== null && s.result !== undefined && <Json label="Result" value={s.result} />}
              </div>
            </li>
          ))}
          {!steps.length && <Empty title="No steps yet" />}
        </ol>
      </div>
    );
  }

  if (runs && !runs.length) {
    return <Empty title="No runs yet">The agent starts runs with run_start over MCP once the flow is published.</Empty>;
  }
  return (
    <ul className="divide-y divide-slate-100">
      {runs?.map((run) => (
        <li key={run.id}>
          <button type="button" className="flex w-full items-center gap-2 px-4 py-3 text-left hover:bg-slate-50" onClick={() => open(run)}>
            <Badge tone={RUN_TONE[run.status]}>{run.status}</Badge>
            <span className="text-xs text-slate-500">v{run.version}</span>
            <span className="flex-1 truncate text-xs text-slate-500">{run.startedBy}</span>
            <span className="text-[11px] text-slate-400" title={fullTime(run.createdAt)}>{timeAgo(run.createdAt)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

const Json = ({ label, value }: { label: string; value: unknown }) => (
  <details className="mt-1 text-xs">
    <summary className="cursor-pointer text-slate-500 select-none">{label}</summary>
    <pre className="mt-1 max-h-48 overflow-auto rounded bg-slate-900 p-2 text-[11px] text-slate-100">{pretty(value)}</pre>
  </details>
);
