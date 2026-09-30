import { EventBus } from './common/event-bus.js';
import type { Database } from './db/database.js';
import { FeedbackRepository } from './repositories/feedback-repository.js';
import { GraphRepository } from './repositories/graph-repository.js';
import { RunRepository } from './repositories/run-repository.js';
import { FeedbackService } from './services/feedback-service.js';
import { GraphService } from './services/graph-service.js';
import { RunService } from './services/run-service.js';
import type { ToolCatalog } from './services/tool-catalog.js';

export interface Services {
  events: EventBus;
  tools: ToolCatalog;
  graphs: GraphService;
  feedback: FeedbackService;
  runs: RunService;
}

export function createServices(db: Database, tools: ToolCatalog): Services {
  const events = new EventBus();
  const graphs = new GraphService(new GraphRepository(db), tools, events);
  return {
    events,
    tools,
    graphs,
    feedback: new FeedbackService(new FeedbackRepository(db), graphs, events),
    runs: new RunService(new RunRepository(db), graphs, tools, events),
  };
}
