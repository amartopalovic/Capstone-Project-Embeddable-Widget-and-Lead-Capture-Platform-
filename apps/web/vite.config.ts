import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { securityHeaders } from '@lcp/config/vite-security-headers';
import {
  STATIC_SECURITY_HEADERS,
  dashboardCsp,
  serializeCsp,
  serializeCspForMeta,
} from '@lcp/contracts/security';

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
 * `/demo` in Stage 12b is the public sandbox's own read-only endpoints, which
 * the demo application on 5174 fetches cross-origin - the one place in this
 * product where that is deliberate rather than incidental.
 *
 * Stage 13 adds the security headers and the Content Security Policy from
 * blueprint 17. The policy is the one in `@lcp/contracts/security`, shared with
 * the API rather than restated here. Development is allowed exactly two things
 * deployment is not - an inline script, because the React plugin's refresh
 * preamble cannot be hashed, and a WebSocket, because that is how HMR talks -
 * and both are named in one place so the difference is legible rather than
 * buried in a header string.
 *
 * `/api-reference` in Stage 12a is Swagger UI, served by the API from the
 * OpenAPI document it generates about itself. It is NOT under `/docs`, which
 * this application owns for the written guides - in production both sit on one
 * Render service, and a shared prefix would have one shadowing the other.
 */
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    securityHeaders({
      csp: serializeCsp(dashboardCsp()),
      devCsp: serializeCsp(dashboardCsp({ devServer: true })),
      metaCsp: serializeCspForMeta(dashboardCsp()),
      devMetaCsp: serializeCspForMeta(dashboardCsp({ devServer: true })),
      headers: STATIC_SECURITY_HEADERS,
    }),
  ],
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
      '/demo': {
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
      '/demo': {
        target: process.env['VITE_API_TARGET'] ?? 'http://localhost:3000',
        changeOrigin: false,
      },
    },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
