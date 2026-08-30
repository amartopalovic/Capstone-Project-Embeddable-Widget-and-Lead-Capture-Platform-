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
 *
 * `/widget` is proxied for the same reason, from Stage 6. In production
 * blueprint 5.1 puts the API, the React app, and the widget assets on ONE
 * Render service, so an embed snippet naturally points at the same origin as
 * the dashboard. Proxying here reproduces that topology locally, which is what
 * lets a customer-facing snippet be tested without inventing a second base URL
 * that production would never use.
 *
 * `/public` joins them in Stage 11: the unsubscribe, opt-in, and privacy pages
 * are served by this app but post to the API, and they are reached by people
 * with no session at all. Same origin, same reason.
 *
 * `/api-reference` in Stage 12a is Swagger UI, served by the API from the
 * OpenAPI document it generates about itself. It is NOT under `/docs`, which
 * this application owns for the written guides - in production both sit on one
 * Render service, and a shared prefix would have one shadowing the other.
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
      '/widget': {
        target: process.env['VITE_API_TARGET'] ?? 'http://localhost:3000',
        changeOrigin: false,
      },
      '/public': {
        target: process.env['VITE_API_TARGET'] ?? 'http://localhost:3000',
        changeOrigin: false,
      },
      '/api-reference': {
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
      '/widget': {
        target: process.env['VITE_API_TARGET'] ?? 'http://localhost:3000',
        changeOrigin: false,
      },
      '/public': {
        target: process.env['VITE_API_TARGET'] ?? 'http://localhost:3000',
        changeOrigin: false,
      },
      '/api-reference': {
        target: process.env['VITE_API_TARGET'] ?? 'http://localhost:3000',
        changeOrigin: false,
      },
    },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
