import type { GraphDoc } from '@agent-flow/core';
import { AlertCircle, ChevronRight, CircleCheck, Rocket } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, ApiError, type GraphWithIssues } from '../api/client';
import { Badge, Button, cx, Input, Popover, useToast } from '../components/ui';
import { sameFlow } from '../lib/compare';

interface Props {
  graph: GraphWithIssues;
  /** Bumped when a version is published elsewhere. */
  versionSignal: number;
  onShowProblems: () => void;
}

/** Title, publish state and the publish action. */
export function EditorHeader({ graph, versionSignal, onShowProblems }: Props) {
  const { fail, notify } = useToast();
  const [published, setPublished] = useState<GraphDoc | null>(null);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setPublished(null);
    if (graph.latestVersion) api.version(graph.id, graph.latestVersion).then((v) => setPublished(v.doc), fail);
  }, [graph.id, graph.latestVersion, versionSignal]);

  const errors = graph.issues.filter((i) => i.severity === 'error').length;
  const warnings = graph.issues.length - errors;
  const changed = !published || !sameFlow(published, graph.draft);
  const nextVersion = (graph.latestVersion ?? 0) + 1;

  const status = !graph.latestVersion
    ? { tone: 'amber' as const, label: 'Draft, never published' }
    : changed
      ? { tone: 'indigo' as const, label: `Unpublished changes · v${graph.latestVersion} is live` }
      : { tone: 'green' as const, label: `Published · v${graph.latestVersion}` };

  const publish = async () => {
    setBusy(true);
    try {
      const { version } = await api.publish(graph.id, note.trim());
      notify(`Published version ${version}`);
      setNote('');
      setOpen(false);
    } catch (err) {
      fail(err instanceof ApiError && err.code === 'conflict' ? new Error('Nothing to publish: the draft matches the latest version.') : err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4">
      <div className="flex min-w-0 items-center gap-1.5 text-[13px]">
        <span className="shrink-0 text-slate-400">Flows</span>
        <ChevronRight size={14} className="shrink-0 text-slate-300" />
        <h1 className="truncate font-semibold text-slate-900" title={graph.title}>{graph.title}</h1>
      </div>
      <Badge tone={status.tone} dot className="hidden lg:inline-flex">{status.label}</Badge>
      <span className="hidden text-[11px] text-slate-400 tabular-nums xl:inline" title="Draft revision">rev {graph.revision}</span>

      <div className="ml-auto flex shrink-0 items-center gap-2">
        {graph.issues.length > 0 && (
          <button type="button" onClick={onShowProblems} className={cx('flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium transition-colors', errors ? 'text-rose-600 hover:bg-rose-50' : 'text-amber-600 hover:bg-amber-50')}>
            <AlertCircle size={14} />
            {errors ? `${errors} error${errors > 1 ? 's' : ''}` : `${warnings} warning${warnings > 1 ? 's' : ''}`}
          </button>
        )}
        <Popover
          open={open}
          onClose={() => setOpen(false)}
          className="right-0 w-80"
          trigger={
            changed ? (
              <Button variant="primary" onClick={() => setOpen((o) => !o)}><Rocket size={14} />Publish</Button>
            ) : (
              <Button disabled className="disabled:text-emerald-700" title={`The draft matches v${graph.latestVersion}`}><CircleCheck size={14} />Up to date</Button>
            )
          }
        >
          <div className="p-4">
            <div className="text-[13px] font-semibold text-slate-900">Publish version {nextVersion}</div>
            <p className="mt-1 text-[12px] leading-relaxed text-slate-500">Runs always use the latest published version. The draft stays editable.</p>
            {errors > 0 ? (
              <div className="mt-3 rounded-lg bg-rose-50 px-3 py-2.5 text-[12px] text-rose-700">
                Fix {errors} error{errors > 1 ? 's' : ''} first.{' '}
                <button type="button" className="font-medium underline" onClick={() => { setOpen(false); onShowProblems(); }}>Show problems</button>
              </div>
            ) : (
              <>
                {warnings > 0 && <p className="mt-3 text-[12px] text-amber-700">{warnings} warning{warnings > 1 ? 's' : ''} remain; you can still publish.</p>}
                <Input className="mt-3" value={note} onChange={(e) => setNote(e.target.value)} placeholder="What changed? (optional)" maxLength={2000} autoFocus onKeyDown={(e) => e.key === 'Enter' && !busy && publish()} />
                <Button variant="primary" className="mt-3 w-full" onClick={publish} disabled={busy}>{busy ? 'Publishing…' : `Publish v${nextVersion}`}</Button>
              </>
            )}
          </div>
        </Popover>
      </div>
    </header>
  );
}
