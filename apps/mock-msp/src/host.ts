/**
 * Stand-in for the MSPbots conversation page: embeds the canvas and turns its annotations into system notices,
 * following docs/integration/canvas-annotations.md. Lets the embedding be tried without MSPbots.
 */
export function hostPage(canvasUrl: string) {
  const canvasOrigin = new URL(canvasUrl).origin;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Mock MSPbots conversation</title>
<style>
  body { margin: 0; display: flex; height: 100vh; font: 13px/1.5 system-ui, sans-serif; color: #0f172a; }
  aside { flex: 3; min-width: 0; display: flex; flex-direction: column; border-right: 1px solid #e2e8f0; background: #f8fafc; }
  header { padding: 14px 16px; font-weight: 600; border-bottom: 1px solid #e2e8f0; }
  #log { flex: 1; overflow: auto; padding: 12px 16px; }
  .notice { margin: 0 0 10px; padding: 10px 12px; white-space: pre-wrap; font: 12px/1.5 ui-monospace, monospace; background: #fff7ed; border: 1px solid #fed7aa; border-radius: 8px; }
  .empty { color: #94a3b8; }
  .msg { max-width: 85%; margin: 0 0 10px; padding: 8px 12px; border-radius: 12px; white-space: pre-wrap; }
  .msg.user { margin-left: auto; background: #4f46e5; color: #fff; border-bottom-right-radius: 4px; }
  .msg.agent { background: #fff; border: 1px solid #e2e8f0; border-bottom-left-radius: 4px; }
  iframe { flex: 2; min-width: 0; border: 0; border-left: 1px solid #e2e8f0; }
</style>
</head>
<body>
  <aside>
    <header>MSPbots conversation (mock)</header>
    <div id="log"><p class="empty">Annotations sent from the canvas appear here as system notices.</p></div>
  </aside>
  <iframe src="${canvasUrl}" allow="clipboard-write"></iframe>
  <script>
    // Demo conversation, posted to /chat by whoever plays the agent.
    let shown = 0;
    setInterval(async () => {
      const chat = await fetch('/chat').then((r) => r.json());
      const log = document.getElementById('log');
      for (const m of chat.slice(shown)) {
        log.querySelector('.empty')?.remove();
        const bubble = document.createElement('div');
        bubble.className = 'msg ' + m.role;
        bubble.textContent = m.text;
        log.append(bubble);
        log.scrollTop = log.scrollHeight;
      }
      shown = chat.length;
    }, 800);

    window.addEventListener('message', (e) => {
      if (e.origin !== ${JSON.stringify(canvasOrigin)} || e.data?.type !== 'agent-flow.annotations') return;
      const log = document.getElementById('log');
      log.querySelector('.empty')?.remove();
      const notice = document.createElement('pre');
      notice.className = 'notice';
      notice.textContent = e.data.text;
      log.append(notice);
      e.source.postMessage({ type: 'agent-flow.annotations.ack', id: e.data.id }, e.origin);
    });
  </script>
</body>
</html>`;
}
