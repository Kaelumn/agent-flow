import { createServer, type IncomingMessage } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { hostPage } from './host.js';
import { Tenant } from './tenant.js';
import { buildServers, type CallLog } from './tools.js';

/**
 * Usage: tsx src/main.ts [ports]   e.g. "4100" or "4101-4108" (default 4100)
 * Each port is an independent tenant:
 *   POST /mcp/{autotask|microsoft-graph|mspbots}   MCP (streamable HTTP, stateless)
 *   GET  /log     every tool call so far          (for test verification, not for agents)
 *   GET  /state   the tenant's current data
 *   POST /reset   back to the fixtures
 *   GET|POST /chat   the mock conversation shown on /host ({ role: 'user' | 'agent', text }), for demos
 *   GET  /host?flow=<id>   a mock MSPbots conversation embedding the canvas (CANVAS_URL, default http://localhost:5173)
 */
const spec = process.argv[2] ?? process.env.PORT ?? '4100';
const [from, to = from] = spec.split('-').map(Number);
const canvasUrl = process.env.CANVAS_URL ?? 'http://localhost:5173';

for (let port = from!; port <= to!; port++) {
  let tenant = new Tenant();
  let log: CallLog[] = [];
  let chat: { role: 'user' | 'agent'; text: string }[] = [];

  createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const json = (status: number, body: unknown) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body, null, 2));

    if (req.method === 'GET' && url.pathname === '/log') return json(200, log);
    if (req.method === 'GET' && url.pathname === '/state') return json(200, tenant);
    if (url.pathname === '/chat') {
      if (req.method === 'POST') chat.push(await readJson(req));
      return json(200, chat);
    }
    if (req.method === 'GET' && url.pathname === '/host') return res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(hostPage(`${canvasUrl}/#/flows/${encodeURIComponent(url.searchParams.get('flow') ?? '')}`));
    if (req.method === 'POST' && url.pathname === '/reset') {
      tenant = new Tenant();
      log = [];
      chat = [];
      return json(200, { ok: true });
    }

    const connector = url.pathname.match(/^\/mcp\/([\w-]+)$/)?.[1];
    const server = connector && buildServers(tenant, log)[connector as keyof ReturnType<typeof buildServers>];
    if (!server) return json(404, { error: `unknown path ${url.pathname}` });
    if (req.method !== 'POST') return json(405, { error: 'stateless server: use POST' });

    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, await readJson(req));
  }).listen(port, '127.0.0.1', () => console.log(`mock MSP tenant on http://127.0.0.1:${port}`));
}

async function readJson(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : undefined;
}
