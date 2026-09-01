import { defineConfig } from 'vite';

/**
 * GitHub Pages serves a project site from /<repo>/, so every asset URL and the
 * manifest's scope must carry that prefix. VITE_BASE is set by the deploy
 * workflow; it stays "/" for local dev and for a custom domain or user page.
 */
const base = process.env.VITE_BASE ?? '/';

export default defineConfig({
  base,
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'preact',
  },
  build: {
    target: 'es2022',
    // The overview route has a JS budget; fail loudly rather than drift past it.
    chunkSizeWarningLimit: 100,
    rollupOptions: {
      output: {
        // Asset detail and its chart are the only route that is not the overview,
        // but the whole app is small enough that a second chunk would cost a
        // round trip for less than it saves. One bundle, deliberately.
        manualChunks: undefined,
      },
    },
  },
});
