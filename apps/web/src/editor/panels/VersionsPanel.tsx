import type { GraphEvent } from '@agent-flow/core';
import { Bot, RotateCcw, User } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, ApiError, type GraphWithIssues, type VersionSummary } from '../../api/client';
import { Badge, Button, Empty, Input, useConfirm, useToast } from '../../components/ui';
import { fullTime, timeAgo } from '../../lib/format';

interface Props {
  graph: GraphWithIssues;
  versionSignal: number;
  onRestored: (graph: GraphWithIssues) => void;
}

export function VersionsPanel({ graph, versionSignal, onRestored }: Props) {
  const { fail, notify } = useToast();
  const confirm = useConfirm();
  const [versions, setVersions] = useState<VersionSummary[]>([]);
  const [history, setHistory] = useState<GraphEvent[]>([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.versions(graph.id).then(setVersions, fail);
  }, [graph.id, versionSignal]);
  useEffect(() => {
    api.history(graph.id).then(setHistory, fail);
  }, [graph.id, graph.revision, versionSignal]);

  const errors = graph.issues.filter((i) => i.severity === 'error').length;

  const publish = async () => {
    setBusy(true);
    try {
      const { version } = await api.publish(graph.id, note.trim());
      setNote('');
      notify(`Published version ${version}`);
    } catch (err) {
      fail(err instanceof ApiError && err.code === 'conflict' ? new Error('Nothing to publish: the draft matches the latest version.') : err);
    } finally {
      setBusy(false);
    }
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
      <section className="space-y-2 border-b border-slate-200 p-4">
        <h3 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Publish</h3>
        <p className="text-xs text-slate-500">Runs always use a published version. Publishing freezes the current draft.</p>
        <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What changed? (optional)" maxLength={2000} />
        <Button variant="primary" className="w-full" onClick={publish} disabled={busy || errors > 0}>
          {errors > 0 ? `Fix ${errors} error(s) to publish` : busy ? 'Publishing…' : `Publish as v${(graph.latestVersion ?? 0) + 1}`}
        </Button>
      </section>

      <section className="border-b border-slate-200 p-4">
        <h3 className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">Versions</h3>
        {!versions.length && <p className="text-sm text-slate-400">Not published yet.</p>}
        <ul className="space-y-2">
          {versions.map((v) => (
            <li key={v.version} className="flex items-start gap-2 rounded-lg border border-slate-200 p-2.5">
              <Badge tone={v.version === graph.latestVersion ? 'green' : 'slate'}>v{v.version}</Badge>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-slate-800">{v.note || <span className="text-slate-400">No note</span>}</div>
                <div className="text-[11px] text-slate-400" title={fullTime(v.createdAt)}>{v.createdBy} · {timeAgo(v.createdAt)}</div>
              </div>
              <Button size="sm" variant="ghost" onClick={() => restore(v.version)} title="Restore this version into the draft"><RotateCcw size={13} /></Button>
            </li>
          ))}
        </ul>
      </section>

      <section className="p-4">
        <h3 className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">Change history</h3>
        {!history.length && <Empty title="No changes yet" />}
        <ol className="space-y-3">
          {history.map((e) => (
            <li key={e.id} className="flex gap-2.5">
              <span className={`mt-0.5 grid size-6 shrink-0 place-items-center rounded-full ${e.source === 'mcp' ? 'bg-indigo-100 text-indigo-600' : 'bg-slate-100 text-slate-500'}`}>
                {e.source === 'mcp' ? <Bot size={13} /> : <User size={13} />}
              </span>
              <div className="min-w-0 text-sm">
                <div className="text-[11px] text-slate-400" title={fullTime(e.createdAt)}>
                  {e.actor}{e.source === 'mcp' && ' (agent)'} · rev {e.revision} · {timeAgo(e.createdAt)}
                </div>
                <ul className="mt-0.5 text-slate-700">
                  {e.summary.map((line, i) => <li key={i} className="break-words">{line}</li>)}
                </ul>
              </div>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
