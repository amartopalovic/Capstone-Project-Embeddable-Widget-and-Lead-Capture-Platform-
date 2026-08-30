import { defineConfig } from 'vite';

/**
 * The demo deliberately has no React dependency and runs on its own port, so
 * it is a genuinely separate origin from apps/web. That separation is what
 * makes the cross-origin widget and submission behaviour testable from Stage 6
 * onward, rather than something only proven after deployment - and from Stage
 * 12b it is also what blueprint 14.3 asks of the public sandbox, which must be
 * "hosted on a different provider subdomain from the API".
 */
export default defineConfig({
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
