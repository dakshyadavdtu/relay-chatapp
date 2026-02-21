import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const backendPort = env.VITE_BACKEND_PORT || '8000';
  // Only place backend URL is allowed: server-side proxy. Frontend must use same-origin /api and /ws.
  const apiTarget = `http://localhost:${backendPort}`;
  const wsTarget = `ws://localhost:${backendPort}`;
  console.log('[vite-proxy]', { VITE_BACKEND_PORT: backendPort, apiTarget, wsTarget });

  const proxyConfig = {
    '/api': {
      target: apiTarget,
      changeOrigin: true,
      secure: false,
      configure: (proxy) => {
        proxy.on('proxyReq', (proxyReq, req) => {
          console.log('[vite-proxy] forwarding', req.method, req.url, '->', apiTarget);
        });
      },
    },
    '/uploads': {
      target: apiTarget,
      changeOrigin: true,
      secure: false,
    },
    '/ws': {
      target: wsTarget,
      ws: true,
      changeOrigin: true,
      secure: false,
    },
  };

  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      proxy: proxyConfig,
    },
    preview: {
      proxy: proxyConfig,
    },
  };
});
