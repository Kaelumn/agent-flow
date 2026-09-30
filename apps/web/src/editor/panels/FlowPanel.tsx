import { useEffect, useState } from 'react';
import type { GraphWithIssues } from '../../api/client';
import { Button, Field, Input, Textarea } from '../../components/ui';
import { fullTime } from '../../lib/format';

interface Props {
  graph: GraphWithIssues;
  onSave: (meta: { title: string; description: string }) => Promise<unknown>;
}

export function FlowPanel({ graph, onSave }: Props) {
  const [title, setTitle] = useState(graph.title);
  const [description, setDescription] = useState(graph.description);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setTitle(graph.title);
    setDescription(graph.description);
  }, [graph.title, graph.description]);

  const tools = graph.draft.nodes.filter((n) => n.type === 'tool').length;
  const dirty = title !== graph.title || description !== graph.description;

  const save = async () => {
    setSaving(true);
    await onSave({ title: title.trim(), description });
    setSaving(false);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        <p className="text-xs text-slate-500">Select a step or connection on the canvas to edit it. Drag from a node's bottom handle to connect.</p>
        <Field label="Flow name">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
        </Field>
        <Field label="Description" hint="The agent reads this before building or running the flow: purpose, scope and fixed parameters.">
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={8} />
        </Field>
        <dl className="grid grid-cols-2 gap-3 rounded-lg bg-slate-50 p-3 text-xs">
          <Stat label="Tool steps" value={tools} />
          <Stat label="Connections" value={graph.draft.edges.length} />
          <Stat label="Draft revision" value={graph.revision} />
          <Stat label="Published" value={graph.latestVersion ? `v${graph.latestVersion}` : 'never'} />
          <div className="col-span-2 text-slate-400">Last change {fullTime(graph.updatedAt)}</div>
        </dl>
      </div>
      <div className="border-t border-slate-200 p-3">
        <Button variant="primary" onClick={save} disabled={!dirty || saving || !title.trim()}>{saving ? 'Saving…' : 'Save'}</Button>
      </div>
    </div>
  );
}

const Stat = ({ label, value }: { label: string; value: string | number }) => (
  <div>
    <dt className="text-slate-400">{label}</dt>
    <dd className="mt-0.5 font-medium text-slate-800">{value}</dd>
  </div>
);
