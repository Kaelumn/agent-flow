import type { GraphEvent } from '@agent-flow/core';
import { Bot, GitCompareArrows, History, Rocket, RotateCcw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, type GraphWithIssues, type VersionSummary } from '../../api/client';
import { Avatar, Badge, cx, Empty, IconButton, Section, useConfirm, useToast } from '../../components/ui';
import { fullTime, timeAgo } from '../../lib/format';

interface Props {
  graph: GraphWithIssues;
  versionSignal: number;
  onRestored: (graph: GraphWithIssues) => void;
}

/** How many lines of an entry show before "N more". */
const LINES_SHOWN = 3;

/** The ids the server adds after names are for agents: `added tool node "Check" (n_x1)` reads better without them. */
const readable = (line: string) => line.replace(/"\s\([\w-]+\)/g, '"');

/** Published versions and the change history of the draft. Publishing itself lives in the header. */
export function HistoryPanel({ graph, versionSignal, onRestored }: Props) {
  const { fail, notify } = useToast();
  const confirm = useConfirm();
  const [versions, setVersions] = useState<VersionSummary[] | null>(null);
  const [history, setHistory] = useState<GraphEvent[] | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    api.versions(graph.id).then(setVersions, fail);
  }, [graph.id, versionSignal]);
  useEffect(() => {
    api.history(graph.id).then(setHistory, fail);
  }, [graph.id, graph.revision, versionSignal]);

  // The version comparison is its own page; this is its address (see compare/ComparePage).
  const compare = (from: number, to: number | 'draft') => {
    location.hash = `/flows/${graph.id}/compare/${from}/${to}`;
  };

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
      <Section
        title="Published versions"
        action={graph.latestVersion ? <button type="button" onClick={() => compare(graph.latestVersion!, 'draft')} className="flex items-center gap-1 text-[11.5px] font-medium text-indigo-600 hover:text-indigo-500"><GitCompareArrows size={12} />Draft vs v{graph.latestVersion}</button> : undefined}
      >
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
                  {v.version > 1 && <IconButton label={`Compare v${v.version} with v${v.version - 1}`} onClick={() => compare(v.version - 1, v.version)} className="ml-auto opacity-0 group-hover:opacity-100"><GitCompareArrows size={13} /></IconButton>}
                  <IconButton label={`Restore v${v.version} into the draft`} onClick={() => restore(v.version)} className={cx('opacity-0 group-hover:opacity-100', v.version === 1 && 'ml-auto')}><RotateCcw size={13} /></IconButton>
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
        <ol className="-mt-1 divide-y divide-slate-100">
          {history?.map((e) => {
            const open = expanded.has(e.id);
            const lines = e.summary.map(readable);
            const shown = open ? lines : lines.slice(0, LINES_SHOWN);
            return (
              <li key={e.id} className="py-2 first:pt-0">
                <div className="flex items-center gap-1.5 text-[12px]">
                  {e.source === 'mcp' ? (
                    <span title="Changed by an agent" className="grid size-5 shrink-0 place-items-center rounded-full bg-indigo-100 text-indigo-600"><Bot size={11} /></span>
                  ) : (
                    <Avatar name={e.actor} className="!size-5 !text-[9px]" />
                  )}
                  <span className="font-semibold text-slate-800">{e.actor}</span>
                  {e.source === 'mcp' && <Badge tone="indigo">agent</Badge>}
                  <span className="ml-auto shrink-0 text-[11px] text-slate-400 tabular-nums" title={fullTime(e.createdAt)}>rev {e.revision} · {timeAgo(e.createdAt)}</span>
                </div>
                <ul className="mt-0.5 space-y-px pl-[26px]">
                  {shown.map((line, i) => <li key={i} className="text-[12px] leading-[17px] break-words text-slate-600">{line}</li>)}
                </ul>
                {lines.length > LINES_SHOWN && (
                  <button
                    type="button"
                    onClick={() => setExpanded((set) => { const next = new Set(set); if (!next.delete(e.id)) next.add(e.id); return next; })}
                    className="mt-0.5 pl-[26px] text-[11.5px] font-medium text-indigo-600 hover:text-indigo-500"
                  >
                    {open ? 'Show less' : `${lines.length - LINES_SHOWN} more`}
                  </button>
                )}
              </li>
            );
          })}
        </ol>
      </Section>
    </div>
  );
}
