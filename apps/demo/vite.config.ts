import { defineConfig } from 'vite';

/**
 * The demo deliberately has no React dependency and runs on its own port, so
 * it is a genuinely separate origin from apps/web. That separation is what
 * makes the cross-origin widget and submission behaviour testable from Stage 6
 * onward, rather than something only proven after deployment.
 */
export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: 5174,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
