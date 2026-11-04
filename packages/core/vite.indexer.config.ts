import { defineConfig } from 'vite'

/**
 * Bundles the headless indexer (`src/headless/index-graph.ts`) into one
 * self-contained Node script, `dist/kore-indexer.mjs`, that `kore index`
 * runs. Every dependency is inlined so the script needs only Node itself.
 */
export default defineConfig({
  build: {
    ssr: 'src/headless/index-graph.ts',
    outDir: 'dist',
    emptyOutDir: false,
    target: 'node22',
    minify: false,
    rollupOptions: {
      output: { entryFileNames: 'kore-indexer.mjs', format: 'es' },
    },
  },
  ssr: { noExternal: true, target: 'node' },
})
