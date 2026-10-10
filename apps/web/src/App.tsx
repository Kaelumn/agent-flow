import type { GraphSummary } from '@agent-flow/core';
import { lazy, Suspense, useEffect, useState, type FormEvent } from 'react';
import { api } from './api/client';
import { subscribe } from './api/events';
import type { Identity } from './auth';
import { Button, Field, Input, Modal, Textarea, useConfirm, useToast } from './components/ui';
import { embeddingHost } from './editor/annotate/message';
import { Editor } from './editor/Editor';
import { FlowsHome } from './FlowsHome';

// The version comparison loads only when it is opened.
const ComparePage = lazy(() => import('./compare/ComparePage'));

const routeId = () => location.hash.match(/^#\/flows\/([\w-]+)/)?.[1] ?? null;
/** #/flows/:id/compare/:from/:to, where each version is a number and `to` may be "draft". */
const routeCompare = () => {
  const m = location.hash.match(/^#\/flows\/([\w-]+)\/compare\/(\d+)\/(\d+|draft)/);
  return m ? { id: m[1]!, from: Number(m[2]), to: m[3] === 'draft' ? ('draft' as const) : Number(m[3]) } : null;
};
const navigate = (id: string | null) => {
  location.hash = id ? `/flows/${id}` : '';
};

export function App({ identity, signOut }: { identity: Identity; signOut: () => void }) {
  const { fail } = useToast();
  const confirm = useConfirm();
  const [flows, setFlows] = useState<GraphSummary[] | null>(null);
  const [current, setCurrent] = useState(routeId);
  const [compare, setCompare] = useState(routeCompare);
  const [creating, setCreating] = useState(false);
  const [hostOrigin] = useState(() => embeddingHost(identity.embedOrigins));

  const reload = () => api.listGraphs().then(setFlows, fail);

  useEffect(() => {
    void reload();
    const onHash = () => {
      setCurrent(routeId());
      setCompare(routeCompare());
    };
    window.addEventListener('hashchange', onHash);
    const unsubscribe = subscribe(null, (e) => {
      if (e.type === 'graph.changed' || e.type === 'graph.archived' || e.type === 'graph.published') void reload();
    }, reload);
    return () => {
      window.removeEventListener('hashchange', onHash);
      unsubscribe();
    };
  }, []);

  const archive = async (flow: GraphSummary) => {
    if (!(await confirm({ title: 'Archive flow', message: `Archive "${flow.title}"? It disappears from the list and can no longer be run.`, confirmLabel: 'Archive', danger: true }))) return;
    await api.archiveGraph(flow.id).catch(fail);
    if (flow.id === current) navigate(null);
  };

  return (
    <div className="flex h-full">
      {compare ? (
        <Suspense fallback={<div className="grid flex-1 place-items-center bg-slate-50 text-sm text-slate-400">Loading…</div>}>
          <ComparePage key={compare.id} graphId={compare.id} from={compare.from} to={compare.to} />
        </Suspense>
      ) : current ? (
        <Editor key={current} graphId={current} hostOrigin={hostOrigin} onGone={() => navigate(null)} onBack={hostOrigin ? undefined : () => navigate(null)} />
      ) : (
        <FlowsHome flows={flows} identity={identity} onOpen={navigate} onCreate={() => setCreating(true)} onArchive={archive} onSignOut={signOut} />
      )}

      {creating && (
        <NewFlowDialog
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            navigate(id);
          }}
        />
      )}
    </div>
  );
}

function NewFlowDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const { fail } = useToast();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      onCreated((await api.createGraph({ title: title.trim(), description })).id);
    } catch (err) {
      fail(err);
      setBusy(false);
    }
  };

  return (
    <Modal title="New flow" description="Start empty and add steps on the canvas, or let your agent build it." onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Name">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. New-employee onboarding" maxLength={120} autoFocus required />
        </Field>
        <Field label="Description" hint="Purpose, scope and fixed parameters. The agent reads this.">
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={busy || !title.trim()}>Create</Button>
        </div>
      </form>
    </Modal>
  );
}
