import type { GraphDoc } from '@agent-flow/core';
import { AlertCircle, ArrowLeft, CircleCheck, Rocket } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, ApiError, type GraphWithIssues } from '../api/client';
import { Button, cx, IconButton, Input, Popover, StatusDot, Tooltip, useToast } from '../components/ui';
import { sameFlow } from '../lib/compare';

interface Props {
  graph: GraphWithIssues;
  /** Bumped when a version is published elsewhere. */
  versionSignal: number;
  onShowProblems: () => void;
  /** Back to the flow list; absent when embedded, where the conversation picks the flow. */
  onBack?: () => void;
}

/** Floating bar over the canvas: title, publish state and the publish action. */
export function EditorHeader({ graph, versionSignal, onShowProblems, onBack }: Props) {
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
    ? { tone: 'amber' as const, label: 'Draft', detail: 'Never published' }
    : changed
      ? { tone: 'indigo' as const, label: 'Unpublished changes', detail: `v${graph.latestVersion} is live · draft revision ${graph.revision}` }
      : { tone: 'green' as const, label: `v${graph.latestVersion}`, detail: `Published · draft revision ${graph.revision}` };

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
    <header className="flex h-11 max-w-full min-w-0 items-center gap-1 rounded-xl border border-slate-200 bg-white/95 py-1 pr-1 pl-1 shadow-lg shadow-slate-900/5 backdrop-blur">
      {onBack ? <IconButton label="All flows" onClick={onBack}><ArrowLeft size={15} /></IconButton> : <span className="w-2" />}
      <h1 className="min-w-0 truncate pr-1 text-[13.5px] font-semibold text-slate-900" title={graph.title}>{graph.title}</h1>
      <Tooltip content={status.detail}>
        <span className="flex shrink-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-[11.5px] font-medium whitespace-nowrap text-slate-500">
          <StatusDot tone={status.tone} />
          {status.label}
        </span>
      </Tooltip>

      {graph.issues.length > 0 && (
        <Tooltip content={errors ? `${errors} error${errors > 1 ? 's' : ''} block publishing` : `${warnings} warning${warnings > 1 ? 's' : ''}`}>
          <button type="button" onClick={onShowProblems} className={cx('flex h-7 shrink-0 items-center gap-1 rounded-lg px-1.5 text-xs font-semibold tabular-nums transition-colors', errors ? 'text-rose-600 hover:bg-rose-50' : 'text-amber-600 hover:bg-amber-50')}>
            <AlertCircle size={14} />
            {errors || warnings}
          </button>
        </Tooltip>
      )}

      <span className="mx-1 h-5 w-px shrink-0 bg-slate-200" />
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        className="right-0 w-72"
        trigger={
          changed ? (
            <Button variant="primary" size="sm" onClick={() => setOpen((o) => !o)}><Rocket size={13} />Publish</Button>
          ) : (
            <Button size="sm" variant="ghost" disabled className="disabled:text-emerald-700" title={`The draft matches v${graph.latestVersion}`}><CircleCheck size={13} />Up to date</Button>
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
    </header>
  );
}
