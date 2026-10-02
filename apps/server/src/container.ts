import { EventBus } from './common/event-bus.js';
import type { Database } from './db/database.js';
import { GraphRepository } from './repositories/graph-repository.js';
import { RunRepository } from './repositories/run-repository.js';
import { GraphService } from './services/graph-service.js';
import { RunService } from './services/run-service.js';
import type { SkillCatalog } from './services/skill-catalog.js';
import type { ToolCatalog } from './services/tool-catalog.js';

export interface Services {
  events: EventBus;
  tools: ToolCatalog;
  skills: SkillCatalog;
  graphs: GraphService;
  runs: RunService;
}

export function createServices(db: Database, tools: ToolCatalog, skills: SkillCatalog): Services {
  const events = new EventBus();
  const graphs = new GraphService(new GraphRepository(db), tools, skills, events);
  return {
    events,
    tools,
    skills,
    graphs,
    runs: new RunService(new RunRepository(db), graphs, tools, skills, events),
  };
}
