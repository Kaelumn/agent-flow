import type { EdgePatch, FlowEdge, GraphDoc } from '@agent-flow/core';
import { ArrowDown, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button, Field, Textarea } from '../../components/ui';

interface Props {
  edge: FlowEdge;
  doc: GraphDoc;
  onSave: (patch: EdgePatch) => Promise<unknown>;
  onDelete: () => void;
}

export function EdgePanel({ edge, doc, onSave, onDelete }: Props) {
  const [condition, setCondition] = useState(edge.condition);
  const [isDefault, setIsDefault] = useState(edge.isDefault);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setCondition(edge.condition);
    setIsDefault(edge.isDefault);
  }, [edge.condition, edge.isDefault]);

  const title = (id: string) => doc.nodes.find((n) => n.id === id)?.title ?? id;
  const siblings = doc.edges.filter((e) => e.source === edge.source);
  const dirty = condition !== edge.condition || isDefault !== edge.isDefault;

  const save = async () => {
    setSaving(true);
    await onSave({ condition, isDefault });
    setSaving(false);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        <div className="rounded-lg bg-slate-50 p-3 text-sm">
          <div className="font-medium text-slate-800">{title(edge.source)}</div>
          <ArrowDown size={14} className="my-1 text-slate-400" />
          <div className="font-medium text-slate-800">{title(edge.target)}</div>
        </div>

        <Field
          label="Condition"
          hint={siblings.length > 1 ? `"${title(edge.source)}" branches ${siblings.length} ways; the agent follows the edge whose condition holds.` : 'Only needed when the step branches.'}
        >
          <Textarea value={condition} onChange={(e) => setCondition(e.target.value)} rows={3} placeholder="e.g. the account already exists" />
        </Field>
        <label className="flex items-start gap-2 text-sm text-slate-700">
          <input type="checkbox" className="mt-0.5" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />
          <span>
            Default path
            <span className="block text-xs text-slate-400">Taken when no other condition holds. At most one per step.</span>
          </span>
        </label>
      </div>
      <div className="flex items-center gap-2 border-t border-slate-200 p-3">
        <Button variant="primary" onClick={save} disabled={!dirty || saving}>{saving ? 'Saving…' : 'Save'}</Button>
        <Button variant="danger" className="ml-auto" onClick={onDelete}><Trash2 size={14} />Delete</Button>
      </div>
    </div>
  );
}
