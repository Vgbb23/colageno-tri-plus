import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

function checkoutIndex() {
  const rewrite = (req: { url?: string }) => {
    const url = req.url?.split('?')[0] || '';
    if (url === '/checkout' || url === '/checkout/') {
      const query = req.url?.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
      req.url = '/checkout/index.html' + query;
    }
  };
  return {
    name: 'checkout-index',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        rewrite(req);
        next();
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, _res, next) => {
        rewrite(req);
        next();
      });
    },
  };
}

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [checkoutIndex(), react(), tailwindcss()],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      port: 5180,
      strictPort: true,
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      proxy: {
        '/api': {
          target: `http://localhost:${env.API_PORT || '3002'}`,
          changeOrigin: true,
        },
      },
    },
    preview: {
      proxy: {
        '/api': {
          target: `http://localhost:${env.API_PORT || '3002'}`,
          changeOrigin: true,
        },
      },
    },
  };
});
