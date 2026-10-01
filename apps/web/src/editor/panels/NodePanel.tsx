import type { FlowNode, GraphDoc, InputParam, Issue, NodePatch, OnError, ToolDefinition } from '@agent-flow/core';
import { AlertCircle, AlertTriangle, CircleCheck, CircleMinus, CircleX, Copy, Play, Plus, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button, cx, Field, IconButton, Input, Section, Segmented, Select, Switch, Textarea, useToast } from '../../components/ui';
import { connectorStyle } from '../connectors';
import { availableRefs } from '../refs';
import { RefInput } from './RefInput';
import { ToolPicker } from './ToolPicker';

interface Props {
  node: FlowNode;
  doc: GraphDoc;
  tools: ToolDefinition[];
  issues: Issue[];
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

const TYPE_LABEL = { start: 'Start', tool: 'Tool step', end: 'End' } as const;

export function NodePanel({ node, doc, tools, issues, onSave, onDelete }: Props) {
  const { notify } = useToast();
  const [draft, setDraft] = useState(() => toDraft(node));
  const [saving, setSaving] = useState(false);
  const snapshot = JSON.stringify(node);
  useEffect(() => setDraft(toDraft(node)), [snapshot]);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const dirty = JSON.stringify(toDraft(node)) !== JSON.stringify(draft);
  const tool = tools.find((t) => t.name === draft.toolName);
  const refs = availableRefs(doc, node.id);

  const save = async () => {
    setSaving(true);
    await onSave(toPatch(node, draft));
    setSaving(false);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <PanelHeader node={node} tool={tool} onCopyId={() => navigator.clipboard.writeText(node.id).then(() => notify(`Copied "${node.id}"`))} />
        {issues.length > 0 && <NodeIssues issues={issues} />}

        <Section title="Step">
          <Field label="Title">
            <Input value={draft.title} onChange={(e) => set('title', e.target.value)} maxLength={120} />
          </Field>
          <Field label="Instruction for the agent" hint="What to do or watch out for at this step. References are filled in when the run reaches it.">
            <RefInput multiline rows={4} value={draft.instruction} onChange={(v) => set('instruction', v)} refs={refs} placeholder="e.g. Only continue when the ticket is a new-hire request" />
          </Field>
        </Section>

        {node.type === 'start' && (
          <Section title="Run inputs">
            <InputsEditor inputs={draft.inputs} onChange={(v) => set('inputs', v)} />
          </Section>
        )}

        {node.type === 'end' && (
          <Section title="Outcome">
            <Segmented
              value={draft.outcome}
              onChange={(v) => set('outcome', v)}
              options={[
                { value: 'completed', label: <><CircleCheck size={13} />Completed</>, activeClass: 'text-emerald-700' },
                { value: 'stopped', label: <><CircleMinus size={13} />Stopped</>, activeClass: 'text-amber-700' },
                { value: 'failed', label: <><CircleX size={13} />Failed</>, activeClass: 'text-rose-700' },
              ]}
            />
            <p className="text-[11.5px] text-slate-500">The status a run gets when it reaches this node.</p>
          </Section>
        )}

        {node.type === 'tool' && (
          <>
            <Section title="Tool">
              <ToolPicker tools={tools} value={draft.toolName} onChange={(name) => set('toolName', name)} />
              {tool && <p className="text-[12px] leading-relaxed text-slate-500">{tool.description}</p>}
            </Section>

            {tool && (
              <Section title="Arguments" action={<span className="text-[11px] text-slate-400">{Object.keys(tool.inputSchema.properties).length} parameters</span>}>
                <ArgsEditor tool={tool} value={draft.argsHint} refs={refs} onChange={(v) => set('argsHint', v)} />
              </Section>
            )}

            <Section title="Result">
              <Field label="Save the result as" hint="Later steps use it as {{name.field}}. Leave empty if nothing needs it.">
                <Input value={draft.outputKey} onChange={(e) => set('outputKey', e.target.value)} placeholder="e.g. new_user" className="font-mono" />
              </Field>
            </Section>

            <Section title="If the tool fails">
              <Segmented
                value={draft.onError.strategy}
                onChange={(strategy) => set('onError', { strategy, targetNodeId: draft.onError.targetNodeId })}
                options={[
                  { value: 'stop', label: 'Stop the run' },
                  { value: 'continue', label: 'Continue' },
                  { value: 'goto', label: 'Jump to…' },
                ]}
              />
              {draft.onError.strategy === 'goto' && (
                <Select value={draft.onError.targetNodeId ?? ''} onChange={(e) => set('onError', { strategy: 'goto', targetNodeId: e.target.value || undefined })}>
                  <option value="">Choose the step to jump to…</option>
                  {doc.nodes.filter((n) => n.id !== node.id && n.type !== 'start').map((n) => <option key={n.id} value={n.id}>{n.title}</option>)}
                </Select>
              )}
              <p className="text-[11.5px] text-slate-500">
                {draft.onError.strategy === 'stop' && 'The run ends as failed. Use this when later steps depend on this one.'}
                {draft.onError.strategy === 'continue' && 'The failure is recorded and the run takes the next edge as usual.'}
                {draft.onError.strategy === 'goto' && 'Typically a step that notifies someone, followed by a failed end.'}
              </p>
            </Section>
          </>
        )}
      </div>

      <div className="flex items-center gap-2 border-t border-slate-200 bg-white px-5 py-3">
        <Button variant="primary" onClick={save} disabled={!dirty || saving || !draft.title.trim()}>{saving ? 'Saving…' : 'Save changes'}</Button>
        <Button variant="ghost" onClick={() => setDraft(toDraft(node))} disabled={!dirty}>Discard</Button>
        {dirty && <span className="text-[11px] text-amber-600">Unsaved</span>}
        {node.type !== 'start' && (
          <IconButton label="Delete this step" onClick={onDelete} className="ml-auto text-slate-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 size={15} /></IconButton>
        )}
      </div>
    </div>
  );
}

function PanelHeader({ node, tool, onCopyId }: { node: FlowNode; tool?: ToolDefinition; onCopyId: () => void }) {
  const style = connectorStyle(tool?.connector);
  const Icon = node.type === 'start' ? Play : node.type === 'end' ? CircleCheck : style.icon;
  const tile = node.type === 'start' ? 'bg-emerald-500 text-white ring-emerald-500' : node.type === 'end' ? 'bg-slate-100 text-slate-500 ring-slate-200' : style.tile;
  return (
    <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-4">
      <span className={cx('grid size-10 shrink-0 place-items-center rounded-xl ring-1', tile)}><Icon size={18} strokeWidth={1.75} /></span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14px] font-semibold text-slate-900">{node.title}</div>
        <div className="flex items-center gap-1.5 text-[11.5px] text-slate-500">
          <span>{TYPE_LABEL[node.type]}{tool && ` · ${style.label}`}</span>
          <button type="button" onClick={onCopyId} title="Copy node id" className="flex items-center gap-1 rounded px-1 font-mono text-slate-400 hover:bg-slate-100 hover:text-slate-600">
            {node.id}<Copy size={10} />
          </button>
        </div>
      </div>
    </div>
  );
}

function NodeIssues({ issues }: { issues: Issue[] }) {
  return (
    <ul className="space-y-1.5 border-b border-slate-100 px-5 py-3">
      {issues.map((issue, i) => (
        <li key={i} className={cx('flex gap-2 rounded-lg px-2.5 py-2 text-[12px] leading-snug', issue.severity === 'error' ? 'bg-rose-50 text-rose-800' : 'bg-amber-50 text-amber-800')}>
          {issue.severity === 'error' ? <AlertCircle size={14} className="mt-px shrink-0" /> : <AlertTriangle size={14} className="mt-px shrink-0" />}
          <span>{issue.message}</span>
        </li>
      ))}
    </ul>
  );
}

function ArgsEditor({ tool, value, refs, onChange }: { tool: ToolDefinition; value: Record<string, string>; refs: ReturnType<typeof availableRefs>; onChange: (v: Record<string, string>) => void }) {
  const required = new Set(tool.inputSchema.required ?? []);
  const params = Object.entries(tool.inputSchema.properties).sort(([a], [b]) => Number(required.has(b)) - Number(required.has(a)));
  const stale = Object.keys(value).filter((k) => !(k in tool.inputSchema.properties));

  if (!params.length) return <p className="text-[12px] text-slate-500">This tool takes no arguments.</p>;
  return (
    <div className="space-y-3.5">
      <p className="-mt-1 text-[11.5px] leading-relaxed text-slate-500">
        Say where each value comes from. Use <BracesHint /> to insert run inputs or earlier results; anything else is guidance for the agent.
      </p>
      {params.map(([name, schema]) => (
        <div key={name}>
          <div className="mb-1 flex items-center gap-1.5">
            <span className="font-mono text-[12px] font-medium text-slate-800">{name}</span>
            {required.has(name) ? <span className="text-[10px] font-semibold text-rose-500">required</span> : <span className="text-[10px] text-slate-400">optional</span>}
            {schema.type && <span className="ml-auto rounded bg-slate-100 px-1 font-mono text-[10px] text-slate-500">{String(schema.type)}</span>}
          </div>
          <RefInput value={value[name] ?? ''} onChange={(v) => onChange({ ...value, [name]: v })} refs={refs} placeholder={schema.description ?? 'Where does this value come from?'} className="h-8 text-[12.5px]" />
        </div>
      ))}
      {stale.length > 0 && (
        <div className="rounded-lg bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
          Not parameters of this tool:
          <div className="mt-1.5 flex flex-wrap gap-1">
            {stale.map((k) => (
              <button key={k} type="button" className="inline-flex items-center gap-1 rounded bg-white px-1.5 py-0.5 font-mono text-[11px] ring-1 ring-amber-200 hover:bg-amber-100" onClick={() => onChange(Object.fromEntries(Object.entries(value).filter(([key]) => key !== k)))}>
                {k}<X size={10} />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const BracesHint = () => <code className="rounded bg-slate-100 px-1 font-mono text-[11px] text-slate-600">{'{ }'}</code>;

function InputsEditor({ inputs, onChange }: { inputs: InputParam[]; onChange: (v: InputParam[]) => void }) {
  const update = (i: number, patch: Partial<InputParam>) => onChange(inputs.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <div className="space-y-2.5">
      {!inputs.length && <p className="text-[12px] text-slate-500">Values the run is started with, such as a ticket id. Steps use them as {'{{input.name}}'}.</p>}
      {inputs.map((input, i) => (
        <div key={i} className="rounded-xl border border-slate-200 p-3">
          <div className="flex items-center gap-2">
            <Input value={input.name} onChange={(e) => update(i, { name: e.target.value })} placeholder="name" className="h-8 font-mono text-[12.5px]" />
            <IconButton label="Remove input" onClick={() => onChange(inputs.filter((_, j) => j !== i))}><X size={14} /></IconButton>
          </div>
          <Textarea value={input.description} onChange={(e) => update(i, { description: e.target.value })} placeholder="What it is" rows={1} className="mt-2 min-h-8 py-1.5 text-[12.5px]" />
          <div className="mt-2.5">
            <Switch checked={input.required} onChange={(required) => update(i, { required })} label="Required" description="The run cannot start without it." />
          </div>
        </div>
      ))}
      <Button size="sm" onClick={() => onChange([...inputs, { name: '', description: '', required: true }])}><Plus size={13} />Add input</Button>
    </div>
  );
}
