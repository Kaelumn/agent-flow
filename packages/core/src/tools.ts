export interface JsonSchemaProperty {
  type?: string | string[];
  description?: string;
  enum?: unknown[];
  items?: JsonSchemaProperty;
  properties?: Record<string, JsonSchemaProperty>;
}

export interface ToolInputSchema {
  type: 'object';
  properties: Record<string, JsonSchemaProperty>;
  required?: string[];
}

export interface ToolDefinition {
  name: string;
  /** System the tool acts on, e.g. "microsoft-graph", "autotask". */
  connector: string;
  description: string;
  /** Whether the tool changes state in the target system. */
  writes: boolean;
  inputSchema: ToolInputSchema;
}

export type ToolLookup = (name: string) => ToolDefinition | undefined;
