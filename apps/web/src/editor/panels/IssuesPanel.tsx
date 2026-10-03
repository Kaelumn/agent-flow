import type { GraphDoc, Issue } from '@agent-flow/core';
import { AlertCircle, AlertTriangle, ArrowUpRight, CircleCheck } from 'lucide-react';
import { cx, Empty } from '../../components/ui';
import type { Selection } from '../canvas/FlowCanvas';

export function IssuesPanel({ issues, doc, onFocus }: { issues: Issue[]; doc: GraphDoc; onFocus: (selection: Selection) => void }) {
  if (!issues.length) {
    return (
      <Empty icon={<CircleCheck size={20} className="text-emerald-500" />} title="No problems found">
        Every step is connected, every tool exists and every reference can be filled. The flow is ready to publish.
      </Empty>
    );
  }

  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');
  const where = (i: Issue) => (i.nodeId ? doc.nodes.find((n) => n.id === i.nodeId)?.title : i.edgeId ? 'Connection' : undefined);

  return (
    <div className="h-full overflow-y-auto">
      <div className={cx('mx-5 mt-4 rounded-xl px-4 py-3 text-[12.5px] leading-relaxed', errors.length ? 'bg-rose-50 text-rose-800' : 'bg-amber-50 text-amber-800')}>
        {errors.length
          ? `${errors.length} error${errors.length > 1 ? 's' : ''} must be fixed before this flow can be published.`
          : 'No errors. Warnings do not block publishing, but check each one.'}
      </div>
      {[
        { title: 'Errors', items: errors, icon: <AlertCircle size={15} className="text-rose-500" /> },
        { title: 'Warnings', items: warnings, icon: <AlertTriangle size={15} className="text-amber-500" /> },
      ]
        .filter((g) => g.items.length)
        .map((group) => (
          <section key={group.title} className="px-4 pt-4">
            <h3 className="mb-2 flex items-center gap-2 text-[11px] font-semibold tracking-wider text-slate-400 uppercase">
              {group.title}
              <span className="rounded-full bg-slate-100 px-1.5 text-[10px] text-slate-500">{group.items.length}</span>
            </h3>
            <ul className="space-y-1.5">
              {group.items.map((issue, i) => {
                const target: Selection = issue.nodeId ? { kind: 'node', id: issue.nodeId } : issue.edgeId ? { kind: 'edge', id: issue.edgeId } : null;
                return (
                  <li key={i}>
                    <button
                      type="button"
                      disabled={!target}
                      onClick={() => onFocus(target)}
                      className="group flex w-full gap-2.5 rounded-xl border border-slate-200 px-3 py-2.5 text-left transition-colors hover:border-slate-300 hover:bg-slate-50 disabled:cursor-default"
                    >
                      <span className="mt-0.5 shrink-0">{group.icon}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[12.5px] leading-snug text-slate-800">{issue.message}</span>
                        {where(issue) && <span className="mt-1 inline-block max-w-full truncate rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">{where(issue)}</span>}
                      </span>
                      {target && <ArrowUpRight size={14} className="mt-0.5 shrink-0 text-slate-300 group-hover:text-slate-500" />}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      <div className="h-5" />
    </div>
  );
}
