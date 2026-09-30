import type { GraphDoc, Issue } from '@agent-flow/core';
import { AlertCircle, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Empty } from '../../components/ui';
import type { Selection } from '../canvas/FlowCanvas';

export function IssuesPanel({ issues, doc, onFocus }: { issues: Issue[]; doc: GraphDoc; onFocus: (selection: Selection) => void }) {
  if (!issues.length) {
    return (
      <div className="flex flex-col items-center px-6 py-10 text-center">
        <CheckCircle2 className="text-emerald-500" />
        <Empty title="No problems found">The flow is ready to publish.</Empty>
      </div>
    );
  }
  const where = (i: Issue) =>
    i.nodeId ? doc.nodes.find((n) => n.id === i.nodeId)?.title : i.edgeId ? 'Connection' : 'Flow';
  const sorted = [...issues].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1));

  return (
    <ul className="divide-y divide-slate-100">
      {sorted.map((issue, i) => (
        <li key={i}>
          <button
            type="button"
            className="flex w-full gap-2.5 px-4 py-3 text-left hover:bg-slate-50"
            onClick={() => onFocus(issue.nodeId ? { kind: 'node', id: issue.nodeId } : issue.edgeId ? { kind: 'edge', id: issue.edgeId } : null)}
          >
            {issue.severity === 'error' ? <AlertCircle size={16} className="mt-0.5 shrink-0 text-red-500" /> : <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-500" />}
            <span>
              <span className="block text-sm text-slate-800">{issue.message}</span>
              <span className="text-xs text-slate-400">{where(issue)} · {issue.code}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
