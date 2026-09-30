import type { GraphSummary } from '@agent-flow/core';
import { Archive, LogOut, Plus, Workflow } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { api } from './api/client';
import { subscribe } from './api/events';
import type { Identity } from './auth';
import { Button, cx, Empty, Field, Input, Modal, Textarea, useConfirm, useToast } from './components/ui';
import { Editor } from './editor/Editor';
import { timeAgo } from './lib/format';

const routeId = () => location.hash.match(/^#\/flows\/([\w-]+)/)?.[1] ?? null;
const navigate = (id: string | null) => {
  location.hash = id ? `/flows/${id}` : '';
};

export function App({ identity, signOut }: { identity: Identity; signOut: () => void }) {
  const { fail } = useToast();
  const confirm = useConfirm();
  const [flows, setFlows] = useState<GraphSummary[] | null>(null);
  const [current, setCurrent] = useState(routeId);
  const [creating, setCreating] = useState(false);

  const reload = () => api.listGraphs().then(setFlows, fail);

  useEffect(() => {
    void reload();
    const onHash = () => setCurrent(routeId());
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
      <aside className="flex w-52 shrink-0 flex-col border-r border-slate-200 bg-slate-900 text-slate-300 xl:w-64">
        <div className="flex h-14 items-center gap-2 px-4 text-white">
          <Workflow size={18} className="text-indigo-400" />
          <span className="font-semibold">Agent Flow</span>
        </div>
        <div className="px-3 pb-2">
          <Button variant="primary" className="w-full" onClick={() => setCreating(true)}><Plus size={15} />New flow</Button>
        </div>
        <nav className="flex-1 overflow-y-auto px-2 pb-2">
          {flows?.length === 0 && <p className="px-2 py-4 text-xs text-slate-500">No flows yet. Create one, or ask your agent to build one over MCP.</p>}
          {flows?.map((f) => (
            <div key={f.id} className={cx('group flex items-center rounded-md', f.id === current ? 'bg-slate-800 text-white' : 'hover:bg-slate-800/60')}>
              <a href={`#/flows/${f.id}`} className="min-w-0 flex-1 px-2.5 py-2">
                <div className="truncate text-sm">{f.title}</div>
                <div className="text-[11px] text-slate-500">{f.latestVersion ? `v${f.latestVersion}` : 'draft'} · {timeAgo(f.updatedAt)}</div>
              </a>
              <button type="button" title="Archive" className="mr-1 hidden rounded p-1.5 text-slate-500 hover:bg-slate-700 hover:text-slate-200 group-hover:block" onClick={() => archive(f)}>
                <Archive size={14} />
              </button>
            </div>
          ))}
        </nav>
        <div className="flex items-center gap-2 border-t border-slate-800 px-4 py-3 text-xs">
          <div className="min-w-0 flex-1">
            <div className="truncate text-slate-200">{identity.actor}</div>
            <div className="truncate text-slate-500">{identity.workspaceId}</div>
          </div>
          <button type="button" title="Sign out" className="rounded p-1.5 hover:bg-slate-800" onClick={signOut}><LogOut size={14} /></button>
        </div>
      </aside>

      {current ? (
        <Editor key={current} graphId={current} onGone={() => navigate(null)} />
      ) : (
        <main className="grid flex-1 place-items-center bg-slate-50">
          <Empty title="Choose a flow">Pick a flow on the left, create one, or let your agent build it through the MCP endpoint at <code className="font-mono">/mcp</code>.</Empty>
        </main>
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
    <Modal title="New flow" onClose={onClose}>
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
