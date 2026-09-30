import { EventEmitter } from 'node:events';

export type DomainEvent =
  | { type: 'graph.changed'; workspaceId: string; graphId: string; revision: number; actor: string; source: string }
  | { type: 'graph.published'; workspaceId: string; graphId: string; version: number }
  | { type: 'graph.archived'; workspaceId: string; graphId: string }
  | { type: 'feedback.changed'; workspaceId: string; graphId: string; feedbackId: string }
  | { type: 'run.changed'; workspaceId: string; graphId: string; runId: string; status: string; currentNodeId: string | null };

/** In-process pub/sub. Replace with Redis pub/sub when running more than one instance. */
export class EventBus {
  private readonly emitter = new EventEmitter().setMaxListeners(0);

  publish(event: DomainEvent) {
    this.emitter.emit('event', event);
  }

  subscribe(listener: (event: DomainEvent) => void): () => void {
    this.emitter.on('event', listener);
    return () => this.emitter.off('event', listener);
  }
}
