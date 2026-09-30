import type { Feedback, FeedbackKind, GraphDoc } from '@agent-flow/core';
import { useState } from 'react';
import { api } from '../../api/client';
import { Badge, Button, Empty, Select, Textarea, useToast } from '../../components/ui';
import { timeAgo } from '../../lib/format';

interface Props {
  graphId: string;
  doc: GraphDoc;
  items: Feedback[];
  selectedNodeId: string | null;
  onFocusNode: (nodeId: string) => void;
  onChanged: () => void;
}

const KIND_TONE = { question: 'blue', directive: 'indigo', issue: 'red' } as const;
const STATUS_TONE = { open: 'amber', answered: 'blue', resolved: 'green' } as const;

export function FeedbackPanel({ graphId, doc, items, selectedNodeId, onFocusNode, onChanged }: Props) {
  const { fail } = useToast();
  const [kind, setKind] = useState<FeedbackKind>('directive');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [showResolved, setShowResolved] = useState(false);

  const title = (id: string | null) => (id ? doc.nodes.find((n) => n.id === id)?.title ?? id : 'Whole flow');
  const visible = items.filter((f) => showResolved || f.status !== 'resolved');

  const submit = async () => {
    setBusy(true);
    try {
      await api.addFeedback(graphId, { nodeId: selectedNodeId, kind, text: text.trim() });
      setText('');
      onChanged();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };
  const setStatus = (id: string, status: 'open' | 'resolved') => api.setFeedbackStatus(id, status).then(onChanged, fail);

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-2 border-b border-slate-200 p-4">
        <div className="text-xs text-slate-500">
          New feedback on <span className="font-medium text-slate-700">{title(selectedNodeId)}</span>
          {!selectedNodeId && ' (select a step to target it)'}
        </div>
        <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder="Ask the agent a question or tell it what to change" />
        <div className="flex gap-2">
          <Select value={kind} onChange={(e) => setKind(e.target.value as FeedbackKind)} className="w-36">
            <option value="directive">Change request</option>
            <option value="question">Question</option>
            <option value="issue">Problem</option>
          </Select>
          <Button variant="primary" onClick={submit} disabled={busy || !text.trim()} className="ml-auto">Send</Button>
        </div>
      </div>

      <div className="flex items-center justify-between px-4 pt-3 text-xs text-slate-500">
        <span>{visible.length} item(s)</span>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} />show resolved
        </label>
      </div>

      <div className="flex-1 overflow-y-auto">
        {!visible.length && <Empty title="No feedback yet">Feedback you leave here is picked up by the agent through MCP.</Empty>}
        <ul className="space-y-3 p-4">
          {visible.map((f) => (
            <li key={f.id} className="rounded-lg border border-slate-200 p-3">
              <div className="flex items-center gap-1.5">
                <Badge tone={KIND_TONE[f.kind]}>{f.kind}</Badge>
                <Badge tone={STATUS_TONE[f.status]}>{f.status}</Badge>
                {f.nodeId ? (
                  <button type="button" className="truncate text-xs text-indigo-600 hover:underline" onClick={() => onFocusNode(f.nodeId!)}>{title(f.nodeId)}</button>
                ) : (
                  <span className="text-xs text-slate-400">Whole flow</span>
                )}
              </div>
              <p className="mt-2 text-sm whitespace-pre-wrap text-slate-800">{f.text}</p>
              <div className="mt-1 text-[11px] text-slate-400">{f.author} · {timeAgo(f.createdAt)}</div>
              {f.answer && (
                <div className="mt-2 rounded-md bg-slate-50 p-2 text-sm text-slate-700">
                  <div className="mb-0.5 text-[11px] text-slate-400">{f.answeredBy} replied</div>
                  <p className="whitespace-pre-wrap">{f.answer}</p>
                </div>
              )}
              <div className="mt-2 flex justify-end">
                {f.status === 'resolved' ? (
                  <Button size="sm" variant="ghost" onClick={() => setStatus(f.id, 'open')}>Reopen</Button>
                ) : (
                  <Button size="sm" variant="ghost" onClick={() => setStatus(f.id, 'resolved')}>Resolve</Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
