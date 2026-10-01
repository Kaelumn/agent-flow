import type { GraphDoc } from '@agent-flow/core';
import type { AnnotationTarget, Rect } from './targets';

/** One box on the canvas. Annotations live only in the browser until they are sent. */
export interface Annotation {
  id: string;
  box: Rect;
  note: string;
  target: AnnotationTarget;
}

/** Wire format, documented in docs/integration/canvas-annotations.md. Bump `version` on breaking changes. */
export interface AnnotationMessage {
  type: 'agent-flow.annotations';
  version: 1;
  id: string;
  text: string;
  flow: { id: string; title: string; revision: number };
  annotations: {
    index: number;
    note: string;
    scope: AnnotationTarget['scope'];
    nodes: { id: string; title: string }[];
    edges: { id: string; source: string; target: string; condition: string | null }[];
  }[];
}

const ACK = 'agent-flow.annotations.ack';
const ACK_TIMEOUT_MS = 3000;

/** Where an annotation points, in words the reviewer and the agent both read. */
export function describeTarget(target: AnnotationTarget, doc: GraphDoc) {
  if (target.scope === 'flow') return 'the whole flow';
  const title = (id: string) => doc.nodes.find((n) => n.id === id)?.title ?? id;
  const parts = [
    ...(target.nodeIds.length ? [`${target.nodeIds.length > 1 ? 'steps' : 'step'} ${target.nodeIds.map((id) => `"${title(id)}" (${id})`).join(', ')}`] : []),
    ...target.edgeIds.flatMap((id) => {
      const e = doc.edges.find((x) => x.id === id);
      const when = e?.condition ?? (e?.isDefault ? 'otherwise' : null);
      return e ? [`connection "${title(e.source)}" → "${title(e.target)}" (edge ${id}${when ? `, when: ${when}` : ''})`] : [];
    }),
  ];
  return `${target.scope === 'near' ? 'near ' : ''}${parts.join('; ')}`;
}

export function buildMessage(flow: AnnotationMessage['flow'], doc: GraphDoc, annotations: Annotation[]): AnnotationMessage {
  const title = (id: string) => doc.nodes.find((n) => n.id === id)?.title ?? id;
  const items = annotations.map((a, i) => ({
    index: i + 1,
    note: a.note,
    scope: a.target.scope,
    nodes: a.target.nodeIds.map((id) => ({ id, title: title(id) })),
    edges: a.target.edgeIds.flatMap((id) => {
      const e = doc.edges.find((x) => x.id === id);
      return e ? [{ id, source: e.source, target: e.target, condition: e.condition ?? (e.isDefault ? 'otherwise' : null) }] : [];
    }),
  }));

  const count = `${items.length} annotation${items.length > 1 ? 's' : ''}`;
  const text = [
    `[Agent Flow] ${count} on "${flow.title}" (flow ${flow.id}, draft revision ${flow.revision})`,
    ...annotations.flatMap((a, i) => [`${i + 1}. ${a.note}`, `   On: ${describeTarget(a.target, doc)}`]),
    'Read the flow with flow_get, apply the changes to the draft, then summarise what you changed for each annotation.',
    `If the flow's revision is now above ${flow.revision}, check that each target still exists before editing.`,
  ].join('\n');

  return { type: 'agent-flow.annotations', version: 1, id: crypto.randomUUID(), text, flow, annotations: items };
}

/**
 * Hands the message to the embedding page and waits for its receipt. Without a host, or without a receipt,
 * the text goes to the clipboard so the reviewer can paste it into the conversation.
 */
export async function deliver(message: AnnotationMessage, hostOrigin: string | null): Promise<'sent' | 'copied'> {
  if (hostOrigin && (await postToHost(message, hostOrigin))) return 'sent';
  await navigator.clipboard.writeText(message.text);
  return 'copied';
}

function postToHost(message: AnnotationMessage, origin: string) {
  return new Promise<boolean>((resolve) => {
    const done = (ok: boolean) => {
      clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      resolve(ok);
    };
    const onMessage = (e: MessageEvent) => {
      if (e.origin === origin && e.data?.type === ACK && e.data.id === message.id) done(true);
    };
    const timer = setTimeout(() => done(false), ACK_TIMEOUT_MS);
    window.addEventListener('message', onMessage);
    window.parent.postMessage(message, origin);
  });
}

/** The embedding page's origin, when the canvas runs in an allowed iframe. */
export function embeddingHost(allowed: string[]): string | null {
  if (window.parent === window) return null;
  const origin = location.ancestorOrigins?.[0] ?? (document.referrer ? new URL(document.referrer).origin : null);
  return origin && allowed.includes(origin) ? origin : null;
}
