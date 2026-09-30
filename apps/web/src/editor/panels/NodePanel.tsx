import type { FlowNode, GraphDoc, InputParam, NodePatch, OnError, ToolDefinition } from '@agent-flow/core';
import { Plus, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Field, Input, Select, Textarea } from '../../components/ui';

interface Props {
  node: FlowNode;
  doc: GraphDoc;
  tools: ToolDefinition[];
  onSave: (patch: NodePatch) => Promise<unknown>;
  onDelete: () => void;
}

type Draft = Required<Pick<FlowNode, 'title' | 'instruction'>> & {
  inputs: InputParam[];
  toolName: string;
  argsHint: Record<string, string>;
  outputKey: string;
  onError: OnError;
  outcome: NonNullable<FlowNode['outcome']>;
};

const toDraft = (n: FlowNode): Draft => ({
  title: n.title,
  instruction: n.instruction,
  inputs: n.inputs ?? [],
  toolName: n.tool?.name ?? '',
  argsHint: n.tool?.argsHint ?? {},
  outputKey: n.outputKey ?? '',
  onError: n.onError ?? { strategy: 'stop' },
  outcome: n.outcome ?? 'completed',
});

function toPatch(node: FlowNode, d: Draft): NodePatch {
  const patch: NodePatch = { title: d.title.trim(), instruction: d.instruction };
  if (node.type === 'start') patch.inputs = d.inputs.filter((i) => i.name.trim());
  if (node.type === 'end') patch.outcome = d.outcome;
  if (node.type === 'tool') {
    const argsHint = Object.fromEntries(Object.entries(d.argsHint).filter(([, v]) => v.trim()));
    patch.tool = d.toolName ? { name: d.toolName, argsHint } : null;
    patch.outputKey = d.outputKey.trim() || null;
    patch.onError = d.onError.strategy === 'stop' ? null : d.onError;
  }
  return patch;
}

export function NodePanel({ node, doc, tools, onSave, onDelete }: Props) {
  const [draft, setDraft] = useState(() => toDraft(node));
  const [saving, setSaving] = useState(false);
  const snapshot = JSON.stringify(node);
  useEffect(() => setDraft(toDraft(node)), [snapshot]);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const dirty = JSON.stringify(toDraft(node)) !== JSON.stringify(draft);
  const tool = tools.find((t) => t.name === draft.toolName);

  const save = async () => {
    setSaving(true);
    await onSave(toPatch(node, draft));
    setSaving(false);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        <div className="flex items-center justify-between">
          <Badge tone={node.type === 'tool' ? 'indigo' : node.type === 'start' ? 'green' : 'amber'}>{node.type} node</Badge>
          <span className="font-mono text-[11px] text-slate-400">{node.id}</span>
        </div>

        <Field label="Title">
          <Input value={draft.title} onChange={(e) => set('title', e.target.value)} maxLength={120} />
        </Field>
        <Field label="Instruction for the agent" hint="What to do or watch out for at this step.">
          <Textarea value={draft.instruction} onChange={(e) => set('instruction', e.target.value)} rows={4} />
        </Field>

        {node.type === 'start' && <InputsEditor inputs={draft.inputs} onChange={(v) => set('inputs', v)} />}

        {node.type === 'end' && (
          <Field label="Run ends as" hint="Status the run gets when it reaches this node.">
            <Select value={draft.outcome} onChange={(e) => set('outcome', e.target.value as Draft['outcome'])}>
              <option value="completed">completed</option>
              <option value="stopped">stopped</option>
              <option value="failed">failed</option>
            </Select>
          </Field>
        )}

        {node.type === 'tool' && (
          <>
            <ToolPicker tools={tools} value={draft.toolName} onChange={(name) => set('toolName', name)} />
            {draft.toolName && !tool && <p className="text-xs text-red-600">"{draft.toolName}" is not in the tool catalog.</p>}
            {tool && <ArgsEditor tool={tool} value={draft.argsHint} onChange={(v) => set('argsHint', v)} />}
            <Field label="Save result as" hint="Later steps can refer to the result by this name.">
              <Input value={draft.outputKey} onChange={(e) => set('outputKey', e.target.value)} placeholder="e.g. new_user" className="font-mono" />
            </Field>
            <OnErrorEditor node={node} doc={doc} value={draft.onError} onChange={(v) => set('onError', v)} />
          </>
        )}
      </div>

      <div className="flex items-center gap-2 border-t border-slate-200 p-3">
        <Button variant="primary" onClick={save} disabled={!dirty || saving || !draft.title.trim()}>{saving ? 'Saving…' : 'Save'}</Button>
        <Button variant="ghost" onClick={() => setDraft(toDraft(node))} disabled={!dirty}>Discard</Button>
        {node.type !== 'start' && (
          <Button variant="danger" className="ml-auto" onClick={onDelete}><Trash2 size={14} />Delete</Button>
        )}
      </div>
    </div>
  );
}

function ToolPicker({ tools, value, onChange }: { tools: ToolDefinition[]; value: string; onChange: (name: string) => void }) {
  const groups = useMemo(() => {
    const map = new Map<string, ToolDefinition[]>();
    for (const t of tools) map.set(t.connector, [...(map.get(t.connector) ?? []), t]);
    return [...map.entries()];
  }, [tools]);
  const selected = tools.find((t) => t.name === value);

  return (
    <Field label="Tool" hint={selected?.description}>
      <Select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Choose a tool…</option>
        {value && !selected && <option value={value}>{value} (unknown)</option>}
        {groups.map(([connector, list]) => (
          <optgroup key={connector} label={connector}>
            {list.map((t) => <option key={t.name} value={t.name}>{t.name}{t.writes ? '  ✎' : ''}</option>)}
          </optgroup>
        ))}
      </Select>
    </Field>
  );
}

function ArgsEditor({ tool, value, onChange }: { tool: ToolDefinition; value: Record<string, string>; onChange: (v: Record<string, string>) => void }) {
  const required = new Set(tool.inputSchema.required ?? []);
  const params = Object.entries(tool.inputSchema.properties);
  const stale = Object.keys(value).filter((k) => !(k in tool.inputSchema.properties));

  return (
    <div>
      <div className="text-xs font-medium text-slate-600">Where each argument comes from</div>
      <p className="mb-2 text-[11px] text-slate-400">
        Use <code className="font-mono">{'{{input.name}}'}</code> for a run input or <code className="font-mono">{'{{result.field}}'}</code> for an earlier step's saved result; the runner fills these in. Anything else is guidance for the agent.
      </p>
      {params.length === 0 && <p className="text-xs text-slate-400">This tool takes no arguments.</p>}
      <div className="space-y-2">
        {params.map(([name, schema]) => (
          <div key={name}>
            <div className="mb-0.5 flex items-center gap-1 text-[11px]">
              <span className="font-mono text-slate-700">{name}</span>
              {required.has(name) && <span className="text-red-500">*</span>}
              {schema.type && <span className="text-slate-400">{String(schema.type)}</span>}
            </div>
            <Input value={value[name] ?? ''} onChange={(e) => onChange({ ...value, [name]: e.target.value })} placeholder={schema.description ?? 'e.g. {{input.ticket_id}}'} className="h-8 text-xs" />
          </div>
        ))}
      </div>
      {stale.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1 text-xs text-amber-700">
          Not parameters of this tool:
          {stale.map((k) => (
            <button key={k} type="button" className="inline-flex items-center gap-0.5 rounded bg-amber-50 px-1 font-mono" onClick={() => onChange(Object.fromEntries(Object.entries(value).filter(([key]) => key !== k)))}>
              {k}<X size={10} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function OnErrorEditor({ node, doc, value, onChange }: { node: FlowNode; doc: GraphDoc; value: OnError; onChange: (v: OnError) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <Field label="If the tool fails">
        <Select value={value.strategy} onChange={(e) => onChange({ strategy: e.target.value as OnError['strategy'], targetNodeId: value.targetNodeId })}>
          <option value="stop">stop the run</option>
          <option value="continue">continue</option>
          <option value="goto">jump to…</option>
        </Select>
      </Field>
      {value.strategy === 'goto' && (
        <Field label="Jump to">
          <Select value={value.targetNodeId ?? ''} onChange={(e) => onChange({ strategy: 'goto', targetNodeId: e.target.value || undefined })}>
            <option value="">Choose a node…</option>
            {doc.nodes.filter((n) => n.id !== node.id && n.type !== 'start').map((n) => <option key={n.id} value={n.id}>{n.title}</option>)}
          </Select>
        </Field>
      )}
    </div>
  );
}

function InputsEditor({ inputs, onChange }: { inputs: InputParam[]; onChange: (v: InputParam[]) => void }) {
  const update = (i: number, patch: Partial<InputParam>) => onChange(inputs.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <div>
      <div className="mb-1 text-xs font-medium text-slate-600">Run inputs</div>
      <div className="space-y-2">
        {inputs.map((input, i) => (
          <div key={i} className="rounded-md border border-slate-200 p-2">
            <div className="flex gap-2">
              <Input value={input.name} onChange={(e) => update(i, { name: e.target.value })} placeholder="name" className="h-8 font-mono text-xs" />
              <label className="flex shrink-0 items-center gap-1 text-xs text-slate-600">
                <input type="checkbox" checked={input.required} onChange={(e) => update(i, { required: e.target.checked })} />required
              </label>
              <Button variant="ghost" size="sm" onClick={() => onChange(inputs.filter((_, j) => j !== i))} aria-label="Remove input"><X size={14} /></Button>
            </div>
            <Input value={input.description} onChange={(e) => update(i, { description: e.target.value })} placeholder="description" className="mt-1.5 h-8 text-xs" />
          </div>
        ))}
      </div>
      <Button size="sm" variant="ghost" className="mt-2" onClick={() => onChange([...inputs, { name: '', description: '', required: true }])}><Plus size={14} />Add input</Button>
    </div>
  );
}
