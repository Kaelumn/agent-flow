# Agent Flow

SOP flowcharts that an agent builds with people and then follows step by step.

- **Build**: your agent creates and edits flows over MCP; people review and edit the same flow on a canvas and leave feedback on nodes for the agent.
- **Run**: the agent executes a published version. At each step the server tells it which tool to call and which edges it may take, and rejects steps out of order or edges that do not exist.

Design and rules: [docs/DESIGN.md](docs/DESIGN.md).

## Layout

```
packages/core   Domain model, edit operations, validator, run transitions (shared by server and web)
apps/server     Fastify: REST /api, SSE /api/events, MCP /mcp; Kysely repositories (MySQL now, PostgreSQL ready)
apps/web        React + React Flow canvas
```

## Getting started

Requirements: Node 22+, MySQL 5.7.8+ (or PostgreSQL 13+).

```bash
npm install
```

```bash
cp .env.example .env
```

Edit `.env`: set `DATABASE_URL` and replace the tokens in `AUTH_TOKENS` with long random values (`token:workspace:actor`, one per person or agent). Create the database, then:

```bash
npm run db:migrate
```

```bash
npm run db:seed
```

The seed adds the built-in *Focus ITS new-employee onboarding* template.

Development (API on :3100, web on :5173 with a proxy to the API):

```bash
npm run dev:server
```

```bash
npm run dev:web
```

Production (one process serves the web app, REST and MCP on `PORT`):

```bash
npm run build
```

```bash
npm start -w @agent-flow/server
```

Open the web app and sign in with a token from `AUTH_TOKENS`.

## Connecting your agent

The MCP endpoint is `http://<host>:3100/mcp` (streamable HTTP, stateless). Authenticate with a bearer token:

```json
{
  "mcpServers": {
    "agent-flow": {
      "type": "http",
      "url": "http://127.0.0.1:3100/mcp",
      "headers": { "Authorization": "Bearer <agent token>" }
    }
  }
}
```

The server sends usage instructions on connect. Tools:

| Group | Tools |
|---|---|
| Catalog | `tools_search` |
| Build | `flow_list`, `flow_create`, `flow_get`, `flow_update`, `flow_add_nodes`, `flow_update_node`, `flow_remove_node`, `flow_add_edges`, `flow_update_edge`, `flow_remove_edge`, `flow_validate`, `flow_publish` |
| Feedback | `feedback_list`, `feedback_answer`, `feedback_resolve` |
| Run | `run_start`, `run_current`, `run_submit`, `run_cancel`, `run_get` |

A run loop for the agent's skill:

1. `run_start(flowId, inputs)` returns the first step.
2. Call the tool named in the step yourself, using `argsHint`, the run inputs and the context.
3. `run_submit(runId, nodeId, outcome, edgeId?)` with the result, choosing the edge whose condition holds.
4. Repeat until the returned run status is no longer `running`.

## Tool catalog

Flows may only bind tools from the catalog.

- **Live** (recommended): set `TOOL_SERVERS_CONFIG` to a JSON file in the usual `{ "mcpServers": { "<connector>": { "url", "headers" } } }` shape. The server lists the tools of each MCP server at startup and every 5 minutes; the server name becomes the connector, and a tool is marked as writing unless it declares `readOnlyHint: true`. A relative path is resolved from `apps/server`.
- **Static**: without `TOOL_SERVERS_CONFIG`, tools come from `TOOL_CATALOG_PATH` (default `apps/server/data/tool-catalog.json`). Tests use this.

## Mock MSP tools

`apps/mock-msp` is a stateful fake of the customer systems (Microsoft Graph, Autotask, MSPbots Teams) with onboarding test tickets, for demos and agent tests. Each port is an independent tenant:

```bash
npm start -w @agent-flow/mock-msp -- 4100-4109
```

- MCP: `http://127.0.0.1:<port>/mcp/{autotask|microsoft-graph|mspbots}`
- For verification only: `GET /log` (every tool call), `GET /state`, `POST /reset`.
- `apps/mock-msp/catalog-servers.json` points the live catalog at port 4100: `TOOL_SERVERS_CONFIG=../mock-msp/catalog-servers.json`.
- A shell MCP client: `MCP_CONFIG=servers.json npx tsx apps/mock-msp/src/cli.ts <server> list|<tool> '<json>'`.

The generic agent skill that follows any published flow is in [examples/flow-runner-skill/SKILL.md](examples/flow-runner-skill/SKILL.md).

## Switching to PostgreSQL

Set `DB_DIALECT=postgres` and a `postgres://` `DATABASE_URL`, then run `npm run db:migrate`. Migrations and repositories are dialect-neutral; the driver setup lives only in `apps/server/src/db/database.ts`.

## Tests

```bash
npm test
```

Core tests are pure. Server tests are end-to-end over real HTTP and MCP against the database in `.env`, inside a throwaway workspace that is removed afterwards.
