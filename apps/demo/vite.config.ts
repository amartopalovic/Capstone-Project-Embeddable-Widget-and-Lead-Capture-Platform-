import { defineConfig } from 'vite';
import { securityHeaders } from '@lcp/config/vite-security-headers';
import {
  STATIC_SECURITY_HEADERS,
  sandboxCsp,
  serializeCsp,
  serializeCspForMeta,
} from '@lcp/contracts/security';

/**
 * Where the platform is.
 *
 * The sandbox installs its widgets the way a customer does - one script tag
 * fetched across an origin boundary - so its Content Security Policy has to
 * name that origin, and the page has to fetch from it. Those are two uses of
 * one fact, so it is one value: the policy below and `__PLATFORM_ORIGIN__` in
 * `src/demo.ts` are both built from this. A CSP that named a different origin
 * from the one the page actually calls would fail in the browser and nowhere
 * else.
 *
 * The local default is the web application's port rather than the API's,
 * because that is where the platform is reachable in development - Vite proxies
 * `/widget`, `/demo`, and `/api` from there, which reproduces blueprint 5.1's
 * production topology where one Render service serves all of them. A deployment
 * sets this to that service's own origin.
 *
 * This is the sole thing the demo takes from the platform at build time;
 * nothing from `@lcp/contracts` reaches the browser bundle, which still shares
 * no package with the product it demonstrates.
 */
const apiOrigin = process.env['VITE_API_ORIGIN'] ?? 'http://localhost:5173';

/**
 * The demo deliberately has no React dependency and runs on its own port, so
 * it is a genuinely separate origin from apps/web. That separation is what
 * makes the cross-origin widget and submission behaviour testable from Stage 6
 * onward, rather than something only proven after deployment - and from Stage
 * 12b it is also what blueprint 14.3 asks of the public sandbox, which must be
 * "hosted on a different provider subdomain from the API".
 */
export default defineConfig({
  define: { __PLATFORM_ORIGIN__: JSON.stringify(apiOrigin) },
  plugins: [
    securityHeaders({
      csp: serializeCsp(sandboxCsp({ apiOrigin })),
      devCsp: serializeCsp(sandboxCsp({ apiOrigin, devServer: true })),
      metaCsp: serializeCspForMeta(sandboxCsp({ apiOrigin })),
      devMetaCsp: serializeCspForMeta(sandboxCsp({ apiOrigin, devServer: true })),
      headers: STATIC_SECURITY_HEADERS,
    }),
  ],
  server: {
    host: '0.0.0.0',
    port: 5174,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    /**
     * Two pages, and they are for different audiences.
     *
     * `index.html` is the public sandbox a visitor sees. `fixture.html` is the
     * deliberately hostile host page the Stage 6 runtime tests need - global
     * `box-sizing` overrides, `!important` on every input, and a `.panel` class
     * that collides with the widget's own. The sandbox cannot be that page and
     * still be usable, and the tests cannot use the sandbox and still prove
     * isolation against a worst case, so they are two files.
     */
    rollupOptions: {
      input: {
        index: 'index.html',
        fixture: 'fixture.html',
      },
    },
  },
});
