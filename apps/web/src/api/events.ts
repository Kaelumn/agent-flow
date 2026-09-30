import { getToken } from '../auth';

export type ServerEvent =
  | { type: 'graph.changed'; graphId: string; revision: number; actor: string; source: string }
  | { type: 'graph.published'; graphId: string; version: number }
  | { type: 'graph.archived'; graphId: string }
  | { type: 'feedback.changed'; graphId: string; feedbackId: string }
  | { type: 'run.changed'; graphId: string; runId: string; status: string; currentNodeId: string | null };

const RETRY_MS = 3000;
/** The server sends a heartbeat every 15s; silence beyond this means a dead connection. */
const STALE_MS = 40_000;

/**
 * Server-sent events over fetch, so the token travels in a header rather than the URL.
 * Reconnects until the returned function is called. `onResync` runs after every reconnect,
 * because events sent while disconnected are lost.
 */
export function subscribe(graphId: string | null, onEvent: (event: ServerEvent) => void, onResync?: () => void): () => void {
  const stopped = new AbortController();

  const connect = async () => {
    for (let attempt = 0; !stopped.signal.aborted; attempt++) {
      const connection = new AbortController();
      const abort = () => connection.abort();
      stopped.signal.addEventListener('abort', abort);
      let watchdog = setTimeout(abort, STALE_MS);
      const alive = () => {
        clearTimeout(watchdog);
        watchdog = setTimeout(abort, STALE_MS);
      };

      try {
        const query = graphId ? `?graphId=${encodeURIComponent(graphId)}` : '';
        const res = await fetch(`/api/events${query}`, { headers: { authorization: `Bearer ${getToken() ?? ''}` }, signal: connection.signal });
        if (!res.ok || !res.body) throw new Error(`events: ${res.status}`);
        if (attempt > 0) onResync?.();

        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
        let buffer = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          alive();
          buffer += value;
          let boundary: number;
          while ((boundary = buffer.indexOf('\n\n')) >= 0) {
            const event = parse(buffer.slice(0, boundary));
            buffer = buffer.slice(boundary + 2);
            if (event) onEvent(event);
          }
        }
      } catch {
        // Dropped, refused or timed out: retry below.
      } finally {
        clearTimeout(watchdog);
        stopped.signal.removeEventListener('abort', abort);
      }
      if (!stopped.signal.aborted) await new Promise((r) => setTimeout(r, RETRY_MS));
    }
  };
  void connect();
  return () => stopped.abort();
}

function parse(block: string): ServerEvent | null {
  let type = '';
  let data = '';
  for (const line of block.split('\n')) {
    if (line.startsWith('event: ')) type = line.slice(7);
    else if (line.startsWith('data: ')) data += line.slice(6);
  }
  return type && data ? ({ type, ...JSON.parse(data) } as ServerEvent) : null;
}
