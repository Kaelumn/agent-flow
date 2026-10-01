import { MousePointerClick, Workflow } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { GraphWithIssues } from '../../api/client';
import { Button, Field, Input, Section, Textarea } from '../../components/ui';
import { fullTime, timeAgo } from '../../lib/format';

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

  const steps = graph.draft.nodes.filter((n) => n.type === 'tool').length;
  const branches = graph.draft.nodes.filter((n) => graph.draft.edges.filter((e) => e.source === n.id).length > 1).length;
  const dirty = title !== graph.title || description !== graph.description;

  const save = async () => {
    setSaving(true);
    await onSave({ title: title.trim(), description });
    setSaving(false);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-4">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-indigo-50 text-indigo-600 ring-1 ring-indigo-100"><Workflow size={18} strokeWidth={1.75} /></span>
          <div className="min-w-0">
            <div className="text-[14px] font-semibold text-slate-900">Flow settings</div>
            <div className="text-[11.5px] text-slate-500" title={fullTime(graph.updatedAt)}>Edited {timeAgo(graph.updatedAt)}</div>
          </div>
        </div>

        <div className="mx-5 mt-4 flex gap-2.5 rounded-xl bg-slate-50 px-3 py-2.5 text-[12px] leading-relaxed text-slate-600">
          <MousePointerClick size={15} className="mt-0.5 shrink-0 text-slate-400" />
          Select a step or connection on the canvas to edit it. Drag from a step's handle to connect it, or drop on empty canvas to add a step.
        </div>

        <Section title="About">
          <Field label="Name">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
          </Field>
          <Field label="Description" hint="The agent reads this before building or running the flow: purpose, scope and fixed parameters such as addresses and mappings.">
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={9} />
          </Field>
        </Section>

        <Section title="Overview">
          <dl className="grid grid-cols-3 gap-2">
            <Stat label="Tool steps" value={steps} />
            <Stat label="Branches" value={branches} />
            <Stat label="Published" value={graph.latestVersion ? `v${graph.latestVersion}` : '—'} />
          </dl>
        </Section>
      </div>

      <div className="flex items-center gap-2 border-t border-slate-200 bg-white px-5 py-3">
        <Button variant="primary" onClick={save} disabled={!dirty || saving || !title.trim()}>{saving ? 'Saving…' : 'Save changes'}</Button>
        {dirty && <span className="text-[11px] text-amber-600">Unsaved</span>}
      </div>
    </div>
  );
}

const Stat = ({ label, value }: { label: string; value: string | number }) => (
  <div className="rounded-xl border border-slate-200 px-3 py-2.5">
    <dd className="text-lg font-semibold text-slate-900 tabular-nums">{value}</dd>
    <dt className="text-[11px] text-slate-500">{label}</dt>
  </div>
);
