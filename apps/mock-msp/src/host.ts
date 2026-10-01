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
  aside { width: 360px; display: flex; flex-direction: column; border-right: 1px solid #e2e8f0; background: #f8fafc; }
  header { padding: 14px 16px; font-weight: 600; border-bottom: 1px solid #e2e8f0; }
  #log { flex: 1; overflow: auto; padding: 12px 16px; }
  .notice { margin: 0 0 10px; padding: 10px 12px; white-space: pre-wrap; font: 12px/1.5 ui-monospace, monospace; background: #fff7ed; border: 1px solid #fed7aa; border-radius: 8px; }
  .empty { color: #94a3b8; }
  iframe { flex: 1; border: 0; }
</style>
</head>
<body>
  <aside>
    <header>MSPbots conversation (mock)</header>
    <div id="log"><p class="empty">Annotations sent from the canvas appear here as system notices.</p></div>
  </aside>
  <iframe src="${canvasUrl}" allow="clipboard-write"></iframe>
  <script>
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
