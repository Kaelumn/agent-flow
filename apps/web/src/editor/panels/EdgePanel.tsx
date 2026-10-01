import type { EdgePatch, FlowEdge, GraphDoc } from '@agent-flow/core';
import { ArrowDown, GitBranch, SquarePlus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button, Field, IconButton, Section, Switch, Textarea } from '../../components/ui';

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
        <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-4">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-500 ring-1 ring-slate-200"><GitBranch size={18} strokeWidth={1.75} /></span>
          <div className="min-w-0">
            <div className="text-[14px] font-semibold text-slate-900">Connection</div>
            <div className="text-[11.5px] text-slate-500">{branches ? `One of ${siblings.length} ways out of this step` : 'The only way out of this step'}</div>
          </div>
        </div>

        <Section title="Path">
          <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-1">
            <div className="rounded-lg bg-white px-3 py-2 text-[13px] font-medium text-slate-800 shadow-xs">{title(edge.source)}</div>
            <ArrowDown size={14} className="mx-auto my-1 text-slate-400" />
            <div className="rounded-lg bg-white px-3 py-2 text-[13px] font-medium text-slate-800 shadow-xs">{title(edge.target)}</div>
          </div>
        </Section>

        <Section title="When to take it">
          <Field label="Condition" hint={branches ? 'The agent follows the connection whose condition holds, judged from the data at this step.' : 'Only needed once the step branches.'}>
            <Textarea value={condition} onChange={(e) => setCondition(e.target.value)} rows={3} placeholder="e.g. the account already exists" />
          </Field>
          <Switch checked={isDefault} onChange={setIsDefault} label="Default path" description="Taken when no other condition holds. At most one per step." />
        </Section>
      </div>

      <div className="flex items-center gap-2 border-t border-slate-200 bg-white px-5 py-3">
        <Button variant="primary" onClick={save} disabled={!dirty || saving}>{saving ? 'Saving…' : 'Save changes'}</Button>
        <Button onClick={onInsert}><SquarePlus size={14} />Insert step</Button>
        <IconButton label="Delete this connection" onClick={onDelete} className="ml-auto text-slate-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 size={15} /></IconButton>
      </div>
    </div>
  );
}
