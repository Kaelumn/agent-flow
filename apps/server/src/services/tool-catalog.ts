import { readFile } from 'node:fs/promises';
import type { ToolDefinition, ToolInputSchema } from '@agent-flow/core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { z } from 'zod';
import type { Config } from '../config.js';

/** Source of the tools a flow may bind: a static file or live MCP servers. */
export interface ToolCatalog {
  list(filter?: { query?: string; connector?: string }): ToolDefinition[];
  get(name: string): ToolDefinition | undefined;
}

const Property: z.ZodType<unknown> = z.lazy(() =>
  z.object({
    type: z.union([z.string(), z.array(z.string())]).optional(),
    description: z.string().optional(),
    enum: z.array(z.unknown()).optional(),
    items: Property.optional(),
    properties: z.record(z.string(), Property).optional(),
  }),
);

const CatalogFile = z.object({
  tools: z.array(
    z.object({
      name: z.string().min(1),
      connector: z.string().min(1),
      description: z.string(),
      writes: z.boolean(),
      inputSchema: z.object({
        type: z.literal('object'),
        properties: z.record(z.string(), Property),
        required: z.array(z.string()).optional(),
      }),
    }),
  ),
});

const matches = (tool: ToolDefinition, { query, connector }: { query?: string; connector?: string }) => {
  if (connector && tool.connector !== connector) return false;
  const haystack = `${tool.name} ${tool.connector} ${tool.description}`.toLowerCase();
  return (query?.toLowerCase().split(/\s+/).filter(Boolean) ?? []).every((t) => haystack.includes(t));
};

export class StaticToolCatalog implements ToolCatalog {
  private constructor(private readonly tools: Map<string, ToolDefinition>) {}

  static async fromFile(path: string): Promise<StaticToolCatalog> {
    const file = CatalogFile.parse(JSON.parse(await readFile(path, 'utf8')));
    return new StaticToolCatalog(new Map(file.tools.map((t) => [t.name, t as ToolDefinition])));
  }

  list(filter: { query?: string; connector?: string } = {}): ToolDefinition[] {
    return [...this.tools.values()].filter((tool) => matches(tool, filter));
  }

  get(name: string) {
    return this.tools.get(name);
  }
}

export const McpServersFile = z.object({
  mcpServers: z.record(z.string(), z.object({ url: z.string().url(), headers: z.record(z.string(), z.string()).optional() })),
});

const REFRESH_MS = 5 * 60_000;

/**
 * Reads the tools of live MCP servers; the server name becomes the connector.
 * `readOnlyHint: false` (or no hint) marks a tool as writing. A server that fails a refresh keeps its last tools.
 */
export class McpToolCatalog implements ToolCatalog {
  private byServer = new Map<string, ToolDefinition[]>();
  private tools = new Map<string, ToolDefinition>();

  private constructor(
    private readonly servers: z.infer<typeof McpServersFile>['mcpServers'],
    private readonly onError: (server: string, err: unknown) => void,
  ) {}

  static async fromFile(path: string, onError: (server: string, err: unknown) => void): Promise<McpToolCatalog> {
    const { mcpServers } = McpServersFile.parse(JSON.parse(await readFile(path, 'utf8')));
    const catalog = new McpToolCatalog(mcpServers, onError);
    await catalog.refresh();
    setInterval(() => void catalog.refresh(), REFRESH_MS).unref();
    return catalog;
  }

  async refresh() {
    await Promise.all(
      Object.entries(this.servers).map(async ([name, { url, headers }]) => {
        const client = new Client({ name: 'agent-flow-catalog', version: '0.1.0' });
        try {
          await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: headers ?? {} } }));
          const { tools } = await client.listTools();
          this.byServer.set(
            name,
            tools.map((t) => ({
              name: t.name,
              connector: name,
              description: t.description ?? '',
              writes: t.annotations?.readOnlyHint !== true,
              inputSchema: t.inputSchema as ToolInputSchema,
            })),
          );
        } catch (err) {
          this.onError(name, err);
        } finally {
          await client.close().catch(() => {});
        }
      }),
    );
    this.tools = new Map([...this.byServer.values()].flat().map((t) => [t.name, t]));
  }

  list(filter: { query?: string; connector?: string } = {}): ToolDefinition[] {
    return [...this.tools.values()].filter((tool) => matches(tool, filter));
  }

  get(name: string) {
    return this.tools.get(name);
  }
}

/** Live MCP servers when configured, otherwise the static file. */
export function loadToolCatalog(config: Pick<Config, 'TOOL_SERVERS_CONFIG' | 'TOOL_CATALOG_PATH'>): Promise<ToolCatalog> {
  return config.TOOL_SERVERS_CONFIG
    ? McpToolCatalog.fromFile(config.TOOL_SERVERS_CONFIG, (server, err) => console.error(`tool catalog: cannot read tools of "${server}": ${(err as Error).message}`))
    : StaticToolCatalog.fromFile(config.TOOL_CATALOG_PATH);
}
