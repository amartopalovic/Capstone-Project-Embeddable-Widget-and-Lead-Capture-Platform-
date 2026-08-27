import { defineConfig } from 'vite';

/**
 * Library build for the framework-free widget runtime.
 *
 * No dashboard framework may ever enter this bundle (blueprint section 8.3), so
 * this workspace deliberately has no React dependency. CI bundle-size tracking
 * is wired in Stage 6, when there is a real runtime to measure.
 */
export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    lib: {
      entry: 'src/index.ts',
      name: 'LcpWidgetRuntime',
      formats: ['es', 'iife'],
      fileName: (format) => (format === 'es' ? 'widget-runtime.js' : 'widget-runtime.iife.js'),
    },
  },
});
