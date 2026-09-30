import { readFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

/**
 * Minimal MCP client for shells and test agents.
 *   MCP_CONFIG=servers.json tsx src/cli.ts <server> list
 *   MCP_CONFIG=servers.json tsx src/cli.ts <server> <tool> '<json arguments>'
 * servers.json uses the usual shape: { "mcpServers": { "<name>": { "url": "...", "headers": { ... } } } }
 */
const [serverName, toolName, rawArgs = '{}'] = process.argv.slice(2);
const configPath = process.env.MCP_CONFIG;
if (!serverName || !toolName || !configPath) {
  console.error('usage: MCP_CONFIG=servers.json cli <server> list | <server> <tool> [json]');
  process.exit(2);
}

const { mcpServers } = JSON.parse(readFileSync(configPath, 'utf8')) as { mcpServers: Record<string, { url: string; headers?: Record<string, string> }> };
const entry = mcpServers[serverName];
if (!entry) {
  console.error(`unknown server "${serverName}"; configured: ${Object.keys(mcpServers).join(', ')}`);
  process.exit(2);
}

const client = new Client({ name: 'mcp-cli', version: '0.1.0' });
await client.connect(new StreamableHTTPClientTransport(new URL(entry.url), { requestInit: { headers: entry.headers ?? {} } }));
try {
  if (toolName === 'list') {
    const { tools } = await client.listTools();
    const instructions = client.getInstructions();
    if (instructions) console.log(`# ${serverName}\n${instructions}\n`);
    for (const t of tools) console.log(`${t.name}: ${t.description}\n  input: ${JSON.stringify(t.inputSchema.properties ?? {})}`);
  } else {
    const result = (await client.callTool({ name: toolName, arguments: JSON.parse(rawArgs) })) as { isError?: boolean; content: { type: string; text?: string }[] };
    const text = result.content.map((c) => c.text ?? '').join('\n');
    console.log(result.isError ? `ERROR: ${text}` : text);
    process.exitCode = result.isError ? 1 : 0;
  }
} finally {
  await client.close();
}
