import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * Tailwind CSS v4 is wired through its Vite plugin, with the stylesheet using
 * the v4 CSS-first entry point (@import "tailwindcss"). No theme, palette, or
 * design tokens are defined yet - those belong to the stages that build real UI.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '0.0.0.0',
    port: 5173,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
