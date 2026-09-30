import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const API = process.env.AGENT_FLOW_API ?? 'http://127.0.0.1:3100';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        // Libraries change rarely; keep them in their own long-cached chunks.
        manualChunks: (id) => {
          if (!id.includes('node_modules')) return undefined;
          if (/[\/](@xyflow|@dagrejs|d3-[a-z]+)[\/]/.test(id)) return 'canvas';
          if (/[\/](react|react-dom|scheduler)[\/]/.test(id)) return 'react';
          return 'vendor';
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: { '/api': API, '/mcp': API },
  },
});
