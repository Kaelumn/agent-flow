import type {
  Graph,
  GraphEvent,
  GraphOp,
  GraphSummary,
  GraphVersion,
  Issue,
  Run,
  RunStep,
  ToolDefinition,
} from '@agent-flow/core';
import { getToken, type Identity } from '../auth';

export type GraphWithIssues = Graph & { issues: Issue[] };
export type VersionSummary = Omit<GraphVersion, 'doc'>;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown, token = getToken()): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: { authorization: `Bearer ${token ?? ''}`, ...(body !== undefined && { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) window.dispatchEvent(new Event('agent-flow:unauthorized'));
    throw new ApiError(res.status, data.error ?? 'error', data.message ?? res.statusText, data.details);
  }
  return data as T;
}

export const api = {
  me: (token?: string) => request<Identity>('GET', '/me', undefined, token),
  tools: () => request<ToolDefinition[]>('GET', '/tools'),

  listGraphs: () => request<GraphSummary[]>('GET', '/graphs'),
  createGraph: (meta: { title: string; description?: string }) => request<GraphWithIssues>('POST', '/graphs', meta),
  getGraph: (id: string) => request<GraphWithIssues>('GET', `/graphs/${id}`),
  updateGraph: (id: string, meta: { title?: string; description?: string }) => request<GraphWithIssues>('PATCH', `/graphs/${id}`, meta),
  archiveGraph: (id: string) => request<void>('DELETE', `/graphs/${id}`),
  edit: (id: string, ops: GraphOp[], expectedRevision: number) =>
    request<{ graph: GraphWithIssues; createdNodeIds: string[]; createdEdgeIds: string[] }>('POST', `/graphs/${id}/ops`, { ops, expectedRevision }),

  publish: (id: string, note: string) => request<{ version: number }>('POST', `/graphs/${id}/publish`, { note }),
  versions: (id: string) => request<VersionSummary[]>('GET', `/graphs/${id}/versions`),
  version: (id: string, version: number) => request<GraphVersion>('GET', `/graphs/${id}/versions/${version}`),
  restore: (id: string, version: number) => request<GraphWithIssues>('POST', `/graphs/${id}/versions/${version}/restore`),
  history: (id: string) => request<GraphEvent[]>('GET', `/graphs/${id}/history`),

  runs: (graphId: string) => request<Run[]>('GET', `/graphs/${graphId}/runs`),
  run: (id: string) => request<{ run: Run; steps: RunStep[] }>('GET', `/runs/${id}`),
  cancelRun: (id: string) => request<Run>('POST', `/runs/${id}/cancel`),
};
