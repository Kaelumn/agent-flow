/** JSON columns are written and read as strings; see db/database.ts. */
type Json = string;
/** Epoch milliseconds, stored as bigint. */
type Millis = number;

export interface GraphsTable {
  id: string;
  workspace_id: string;
  title: string;
  description: string;
  draft: Json;
  revision: number;
  latest_version: number | null;
  created_at: Millis;
  updated_at: Millis;
  archived_at: Millis | null;
}

export interface GraphVersionsTable {
  graph_id: string;
  version: number;
  doc: Json;
  note: string;
  created_by: string;
  created_at: Millis;
}

export interface GraphEventsTable {
  id: string;
  graph_id: string;
  revision: number;
  actor: string;
  source: string;
  summary: Json;
  created_at: Millis;
}

export interface FeedbackTable {
  id: string;
  graph_id: string;
  node_id: string | null;
  kind: string;
  text: string;
  author: string;
  status: string;
  answer: string | null;
  answered_by: string | null;
  created_at: Millis;
  updated_at: Millis;
}

export interface RunsTable {
  id: string;
  workspace_id: string;
  graph_id: string;
  version: number;
  status: string;
  current_node_id: string | null;
  inputs: Json;
  context: Json;
  started_by: string;
  created_at: Millis;
  updated_at: Millis;
  ended_at: Millis | null;
}

export interface RunStepsTable {
  id: string;
  run_id: string;
  seq: number;
  node_id: string;
  edge_id: string | null;
  status: string;
  tool_name: string | null;
  args: Json | null;
  result: Json | null;
  error: string | null;
  created_at: Millis;
}

export interface DB {
  graphs: GraphsTable;
  graph_versions: GraphVersionsTable;
  graph_events: GraphEventsTable;
  feedback: FeedbackTable;
  runs: RunsTable;
  run_steps: RunStepsTable;
}
