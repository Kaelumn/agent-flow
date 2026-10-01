import { EventBus } from './common/event-bus.js';
import type { Database } from './db/database.js';
import { GraphRepository } from './repositories/graph-repository.js';
import { RunRepository } from './repositories/run-repository.js';
import { GraphService } from './services/graph-service.js';
import { RunService } from './services/run-service.js';
import type { ToolCatalog } from './services/tool-catalog.js';

export interface Services {
  events: EventBus;
  tools: ToolCatalog;
  graphs: GraphService;
  runs: RunService;
}

export function createServices(db: Database, tools: ToolCatalog): Services {
  const events = new EventBus();
  const graphs = new GraphService(new GraphRepository(db), tools, events);
  return {
    events,
    tools,
    graphs,
    runs: new RunService(new RunRepository(db), graphs, tools, events),
  };
}
