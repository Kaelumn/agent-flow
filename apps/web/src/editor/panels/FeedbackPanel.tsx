import type { Feedback, FeedbackKind, GraphDoc } from '@agent-flow/core';
import { Bot, CircleCheck, HelpCircle, MessageSquare, PencilLine, RotateCcw, Send, TriangleAlert } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { api } from '../../api/client';
import { Avatar, Badge, Button, cx, Empty, Segmented, Textarea, useToast } from '../../components/ui';
import { timeAgo } from '../../lib/format';

interface Props {
  graphId: string;
  doc: GraphDoc;
  items: Feedback[];
  selectedNodeId: string | null;
  onFocusNode: (nodeId: string) => void;
  onChanged: () => void;
}

const KIND: Record<FeedbackKind, { label: string; short: string; icon: ReactNode; tone: 'indigo' | 'blue' | 'red' }> = {
  directive: { label: 'Change request', short: 'Change', icon: <PencilLine size={12} />, tone: 'indigo' },
  question: { label: 'Question', short: 'Question', icon: <HelpCircle size={12} />, tone: 'blue' },
  issue: { label: 'Problem', short: 'Problem', icon: <TriangleAlert size={12} />, tone: 'red' },
};

export function FeedbackPanel({ graphId, doc, items, selectedNodeId, onFocusNode, onChanged }: Props) {
  const { fail } = useToast();
  const [kind, setKind] = useState<FeedbackKind>('directive');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<'open' | 'all'>('open');

  const title = (id: string | null) => (id ? doc.nodes.find((n) => n.id === id)?.title ?? id : 'Whole flow');
  const visible = items.filter((f) => filter === 'all' || f.status !== 'resolved');

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
      <div className="border-b border-slate-100 px-5 py-4">
        <div className="rounded-xl border border-slate-200 bg-white shadow-xs focus-within:border-indigo-500 focus-within:ring-3 focus-within:ring-indigo-500/15">
          <div className="flex items-center gap-1.5 border-b border-slate-100 px-3 py-2 text-[11.5px] text-slate-500">
            <span>On</span>
            <span className="truncate rounded bg-slate-100 px-1.5 py-0.5 font-medium text-slate-700">{title(selectedNodeId)}</span>
            {!selectedNodeId && <span className="truncate text-slate-400">· select a step to target it</span>}
          </div>
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === 'Enter' && text.trim() && !busy && submit()}
            rows={3}
            placeholder="Tell the agent what to change, or ask it a question…"
            className="border-0 shadow-none ring-0 hover:border-0 focus:ring-0"
          />
          <div className="flex items-center gap-2 px-2 pb-2">
            <div className="flex-1">
              <Segmented value={kind} onChange={setKind} options={(Object.keys(KIND) as FeedbackKind[]).map((k) => ({ value: k, label: KIND[k].short }))} />
            </div>
            <Button variant="primary" size="sm" onClick={submit} disabled={busy || !text.trim()} title="Send (Ctrl+Enter)"><Send size={12} />Send</Button>
          </div>
        </div>
        <p className="mt-2 text-[11px] text-slate-400">The agent reads feedback over MCP, applies it and replies here.</p>
      </div>

      <div className="flex items-center justify-between px-5 pt-3">
        <div className="w-40"><Segmented value={filter} onChange={setFilter} options={[{ value: 'open', label: 'Open' }, { value: 'all', label: 'All' }]} /></div>
        <span className="text-[11px] text-slate-400 tabular-nums">{visible.length} item{visible.length === 1 ? '' : 's'}</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {!visible.length && (
          <Empty icon={<MessageSquare size={18} />} title={filter === 'open' ? 'Nothing open' : 'No feedback yet'}>
            Leave a note on a step and the agent will pick it up.
          </Empty>
        )}
        <ul className="space-y-3 px-5 py-4">
          {visible.map((f) => (
            <li key={f.id} className={cx('rounded-xl border p-3.5', f.status === 'resolved' ? 'border-slate-100 bg-slate-50/60' : 'border-slate-200 bg-white')}>
              <div className="flex items-start gap-2.5">
                <Avatar name={f.author} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 text-[12px]">
                    <span className="font-semibold text-slate-800">{f.author}</span>
                    <span className="text-slate-400">· {timeAgo(f.createdAt)}</span>
                    <span className="ml-auto">
                      {f.status === 'resolved' ? <Badge tone="green" dot>Resolved</Badge> : f.status === 'answered' ? <Badge tone="blue" dot>Answered</Badge> : <Badge tone="amber" dot>Open</Badge>}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <Badge tone={KIND[f.kind].tone}>{KIND[f.kind].icon}{KIND[f.kind].label}</Badge>
                    {f.nodeId ? (
                      <button type="button" onClick={() => onFocusNode(f.nodeId!)} className="truncate rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600 hover:bg-slate-200">{title(f.nodeId)}</button>
                    ) : (
                      <span className="text-[11px] text-slate-400">Whole flow</span>
                    )}
                  </div>
                  <p className="mt-2 text-[13px] leading-relaxed whitespace-pre-wrap text-slate-800">{f.text}</p>

                  {f.answer && (
                    <div className="mt-3 flex gap-2.5 border-l-2 border-indigo-200 pl-3">
                      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-indigo-100 text-indigo-600"><Bot size={13} /></span>
                      <div className="min-w-0">
                        <div className="text-[11.5px] font-semibold text-slate-700">{f.answeredBy}</div>
                        <p className="mt-0.5 text-[12.5px] leading-relaxed whitespace-pre-wrap text-slate-700">{f.answer}</p>
                      </div>
                    </div>
                  )}

                  <div className="mt-2.5 flex justify-end">
                    {f.status === 'resolved' ? (
                      <Button size="sm" variant="ghost" onClick={() => setStatus(f.id, 'open')}><RotateCcw size={12} />Reopen</Button>
                    ) : (
                      <Button size="sm" variant="ghost" onClick={() => setStatus(f.id, 'resolved')}><CircleCheck size={12} />Resolve</Button>
                    )}
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
