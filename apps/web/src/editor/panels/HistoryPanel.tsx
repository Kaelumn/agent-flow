import type { GraphEvent } from '@agent-flow/core';
import { Bot, History, Rocket, RotateCcw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, type GraphWithIssues, type VersionSummary } from '../../api/client';
import { Avatar, Badge, cx, Empty, IconButton, Section, useConfirm, useToast } from '../../components/ui';
import { fullTime, timeAgo } from '../../lib/format';

interface Props {
  graph: GraphWithIssues;
  versionSignal: number;
  onRestored: (graph: GraphWithIssues) => void;
}

/** Published versions and the change history of the draft. Publishing itself lives in the header. */
export function HistoryPanel({ graph, versionSignal, onRestored }: Props) {
  const { fail, notify } = useToast();
  const confirm = useConfirm();
  const [versions, setVersions] = useState<VersionSummary[] | null>(null);
  const [history, setHistory] = useState<GraphEvent[] | null>(null);

  useEffect(() => {
    api.versions(graph.id).then(setVersions, fail);
  }, [graph.id, versionSignal]);
  useEffect(() => {
    api.history(graph.id).then(setHistory, fail);
  }, [graph.id, graph.revision, versionSignal]);

  const restore = async (version: number) => {
    if (!(await confirm({ title: `Restore version ${version}`, message: `Replace the current draft with version ${version}? The change history is kept.`, confirmLabel: 'Restore' }))) return;
    try {
      onRestored(await api.restore(graph.id, version));
      notify(`Draft restored from version ${version}`);
    } catch (err) {
      fail(err);
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <Section title="Published versions">
        {versions && !versions.length && <p className="text-[12.5px] text-slate-500">Not published yet. Use Publish in the header when the flow has no errors.</p>}
        <ol className="relative space-y-1">
          {versions?.map((v, i) => (
            <li key={v.version} className="group relative flex gap-3 pb-3">
              {i < versions.length - 1 && <span className="absolute top-8 bottom-0 left-[15px] w-px bg-slate-200" />}
              <span className={cx('relative grid size-8 shrink-0 place-items-center rounded-full ring-4 ring-white', v.version === graph.latestVersion ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-500')}>
                <Rocket size={14} />
              </span>
              <div className="min-w-0 flex-1 pt-0.5">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-semibold text-slate-900">v{v.version}</span>
                  {v.version === graph.latestVersion && <Badge tone="green" dot>Live</Badge>}
                  <IconButton label={`Restore v${v.version} into the draft`} onClick={() => restore(v.version)} className="ml-auto opacity-0 group-hover:opacity-100"><RotateCcw size={13} /></IconButton>
                </div>
                <p className="text-[12.5px] leading-snug text-slate-600">{v.note || <span className="text-slate-400">No release note</span>}</p>
                <p className="mt-0.5 text-[11px] text-slate-400" title={fullTime(v.createdAt)}>{v.createdBy} · {timeAgo(v.createdAt)}</p>
              </div>
            </li>
          ))}
        </ol>
      </Section>

      <Section title="Changes to the draft">
        {history && !history.length && <Empty icon={<History size={18} />} title="No changes yet" />}
        <ol className="space-y-4">
          {history?.map((e) => (
            <li key={e.id} className="flex gap-3">
              {e.source === 'mcp' ? (
                <span title="Changed by an agent" className="grid size-7 shrink-0 place-items-center rounded-full bg-indigo-100 text-indigo-600"><Bot size={14} /></span>
              ) : (
                <Avatar name={e.actor} />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-[12px]">
                  <span className="font-semibold text-slate-800">{e.actor}</span>
                  {e.source === 'mcp' && <Badge tone="indigo">agent</Badge>}
                  <span className="ml-auto shrink-0 text-[11px] text-slate-400 tabular-nums" title={fullTime(e.createdAt)}>rev {e.revision} · {timeAgo(e.createdAt)}</span>
                </div>
                <ul className="mt-1 space-y-0.5">
                  {e.summary.slice(0, 6).map((line, i) => <li key={i} className="text-[12.5px] leading-snug break-words text-slate-600">{line}</li>)}
                  {e.summary.length > 6 && <li className="text-[11.5px] text-slate-400">and {e.summary.length - 6} more change{e.summary.length - 6 > 1 ? 's' : ''}</li>}
                </ul>
              </div>
            </li>
          ))}
        </ol>
      </Section>
    </div>
  );
}
