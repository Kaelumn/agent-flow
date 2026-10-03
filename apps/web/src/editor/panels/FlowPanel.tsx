import { MousePointerClick, Workflow } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { GraphWithIssues } from '../../api/client';
import { Field, Input, PanelHead, SaveBar, Section, Textarea } from '../../components/ui';
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
        <PanelHead
          icon={<Workflow size={16} strokeWidth={1.75} />}
          tile="bg-indigo-50 text-indigo-600 ring-indigo-100"
          title="Flow settings"
          subtitle={<span title={fullTime(graph.updatedAt)}>Edited {timeAgo(graph.updatedAt)}</span>}
        />

        <div className="mx-4 mt-3 flex gap-2 rounded-lg bg-slate-50 px-3 py-2 text-[11.5px] leading-snug text-slate-500">
          <MousePointerClick size={14} className="mt-px shrink-0 text-slate-400" />
          Select a step or connection on the canvas to edit it.
        </div>

        <Section title="About">
          <Field label="Name">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
          </Field>
          <Field label="Description" hint="Purpose, scope and fixed values (addresses, mappings). The agent reads it first.">
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={7} />
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

      <SaveBar dirty={dirty} saving={saving} disabled={!title.trim()} onSave={save} onDiscard={() => { setTitle(graph.title); setDescription(graph.description); }} />
    </div>
  );
}

const Stat = ({ label, value }: { label: string; value: string | number }) => (
  <div className="rounded-lg border border-slate-200 px-3 py-2">
    <dd className="text-lg font-semibold text-slate-900 tabular-nums">{value}</dd>
    <dt className="text-[11px] text-slate-500">{label}</dt>
  </div>
);
