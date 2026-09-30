import type { Feedback, FeedbackKind, FeedbackStatus } from '@agent-flow/core';
import type { EventBus } from '../common/event-bus.js';
import { invalid, notFound } from '../common/errors.js';
import { newId } from '../common/ids.js';
import type { Principal } from '../common/principal.js';
import type { FeedbackRepository } from '../repositories/feedback-repository.js';
import type { GraphService } from './graph-service.js';

export class FeedbackService {
  constructor(
    private readonly feedback: FeedbackRepository,
    private readonly graphs: GraphService,
    private readonly events: EventBus,
  ) {}

  async list(p: Principal, graphId: string, statuses?: FeedbackStatus[]) {
    await this.graphs.require(p, graphId);
    return this.feedback.list(graphId, statuses);
  }

  async create(p: Principal, graphId: string, input: { nodeId?: string | null; kind: FeedbackKind; text: string }): Promise<Feedback> {
    const graph = await this.graphs.require(p, graphId);
    if (input.nodeId && !graph.draft.nodes.some((n) => n.id === input.nodeId)) throw invalid(`node "${input.nodeId}" is not in this flow`);
    const now = Date.now();
    const item: Feedback = {
      id: newId('fb'),
      graphId,
      nodeId: input.nodeId ?? null,
      kind: input.kind,
      text: input.text,
      author: p.actor,
      status: 'open',
      answer: null,
      answeredBy: null,
      createdAt: now,
      updatedAt: now,
    };
    await this.feedback.insert(item);
    this.changed(p, item);
    return item;
  }

  async answer(p: Principal, id: string, answer: string): Promise<Feedback> {
    const item = await this.require(p, id);
    await this.feedback.update(id, { status: 'answered', answer, answeredBy: p.actor }, Date.now());
    return this.changed(p, { ...item, status: 'answered', answer, answeredBy: p.actor });
  }

  async setStatus(p: Principal, id: string, status: 'open' | 'resolved'): Promise<Feedback> {
    const item = await this.require(p, id);
    await this.feedback.update(id, { status }, Date.now());
    return this.changed(p, { ...item, status });
  }

  private async require(p: Principal, id: string) {
    const item = await this.feedback.find(id);
    if (!item) throw notFound(`feedback ${id}`);
    await this.graphs.require(p, item.graphId);
    return item;
  }

  private changed(p: Principal, item: Feedback) {
    this.events.publish({ type: 'feedback.changed', workspaceId: p.workspaceId, graphId: item.graphId, feedbackId: item.id });
    return item;
  }
}
