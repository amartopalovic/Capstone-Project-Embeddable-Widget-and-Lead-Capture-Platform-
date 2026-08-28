import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * Tailwind CSS v4 is wired through its Vite plugin, using the v4 CSS-first
 * entry point. Design tokens live in `src/index.css` under `@theme`.
 *
 * `/api` is proxied to the Express server so the browser sees ONE origin in
 * development. That matters for auth: the session cookie is SameSite=Lax and
 * host-scoped, so a cross-origin dev setup would silently drop it.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': {
        target: process.env['VITE_API_TARGET'] ?? 'http://localhost:3000',
        changeOrigin: false,
      },
    },
  },
  preview: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': {
        target: process.env['VITE_API_TARGET'] ?? 'http://localhost:3000',
        changeOrigin: false,
      },
    },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
