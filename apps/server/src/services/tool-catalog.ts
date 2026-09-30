import { readFile } from 'node:fs/promises';
import type { ToolDefinition } from '@agent-flow/core';
import { z } from 'zod';

/** Source of the tools a flow may bind. Swap the implementation to read from live MCP servers. */
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

export class StaticToolCatalog implements ToolCatalog {
  private constructor(private readonly tools: Map<string, ToolDefinition>) {}

  static async fromFile(path: string): Promise<StaticToolCatalog> {
    const file = CatalogFile.parse(JSON.parse(await readFile(path, 'utf8')));
    return new StaticToolCatalog(new Map(file.tools.map((t) => [t.name, t as ToolDefinition])));
  }

  list(filter: { query?: string; connector?: string } = {}): ToolDefinition[] {
    const terms = filter.query?.toLowerCase().split(/\s+/).filter(Boolean) ?? [];
    return [...this.tools.values()].filter((tool) => {
      if (filter.connector && tool.connector !== filter.connector) return false;
      const haystack = `${tool.name} ${tool.connector} ${tool.description}`.toLowerCase();
      return terms.every((t) => haystack.includes(t));
    });
  }

  get(name: string) {
    return this.tools.get(name);
  }
}
