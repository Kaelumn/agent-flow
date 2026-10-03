import type { EdgePatch, FlowEdge, GraphDoc } from '@agent-flow/core';
import { ArrowDown, GitBranch, SquarePlus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Field, IconButton, PanelHead, SaveBar, Section, Switch, Textarea } from '../../components/ui';

interface Props {
  edge: FlowEdge;
  doc: GraphDoc;
  onSave: (patch: EdgePatch) => Promise<unknown>;
  onInsert: () => void;
  onDelete: () => void;
}

export function EdgePanel({ edge, doc, onSave, onInsert, onDelete }: Props) {
  const [condition, setCondition] = useState(edge.condition);
  const [isDefault, setIsDefault] = useState(edge.isDefault);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setCondition(edge.condition);
    setIsDefault(edge.isDefault);
  }, [edge.condition, edge.isDefault]);

  const title = (id: string) => doc.nodes.find((n) => n.id === id)?.title ?? id;
  const siblings = doc.edges.filter((e) => e.source === edge.source);
  const branches = siblings.length > 1;
  const dirty = condition !== edge.condition || isDefault !== edge.isDefault;

  const save = async () => {
    setSaving(true);
    await onSave({ condition, isDefault });
    setSaving(false);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <PanelHead
          icon={<GitBranch size={16} strokeWidth={1.75} />}
          tile="bg-slate-100 text-slate-500 ring-slate-200"
          title="Connection"
          subtitle={branches ? `One of ${siblings.length} ways out of this step` : 'The only way out of this step'}
        />

        <Section title="Path">
          <div className="rounded-md bg-slate-100/80 p-1">
            <div className="truncate rounded-md bg-white px-2.5 py-1.5 text-[12.5px] font-medium text-slate-800 shadow-xs">{title(edge.source)}</div>
            <ArrowDown size={13} className="mx-auto my-0.5 text-slate-400" />
            <div className="truncate rounded-md bg-white px-2.5 py-1.5 text-[12.5px] font-medium text-slate-800 shadow-xs">{title(edge.target)}</div>
          </div>
        </Section>

        <Section title="When to take it">
          <Field label="Condition" hint={branches ? 'Plain language; the agent judges it from the data at this step.' : 'Only needed once the step branches.'}>
            <Textarea value={condition} onChange={(e) => setCondition(e.target.value)} rows={3} placeholder="e.g. the account already exists" />
          </Field>
          <Switch checked={isDefault} onChange={setIsDefault} label="Default path" description="Taken when no other condition holds. At most one per step." />
        </Section>
      </div>

      <SaveBar dirty={dirty} saving={saving} onSave={save} onDiscard={() => { setCondition(edge.condition); setIsDefault(edge.isDefault); }}>
        <IconButton label="Insert a step on this connection" onClick={onInsert}><SquarePlus size={15} /></IconButton>
        <IconButton label="Delete this connection" onClick={onDelete} className="text-slate-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 size={15} /></IconButton>
      </SaveBar>
    </div>
  );
}
