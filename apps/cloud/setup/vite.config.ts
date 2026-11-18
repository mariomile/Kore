import { defineConfig } from 'vite'

/**
 * Bundles `kore cloud setup` (`setup/main.ts`) into one self-contained Node
 * script, `dist/kore-cloud.mjs`, with the Worker bundle (built first by
 * `wrangler deploy --dry-run`) inlined as text, so the script needs only Node.
 */
export default defineConfig({
  build: {
    ssr: 'setup/main.ts',
    outDir: 'dist',
    emptyOutDir: false,
    target: 'node22',
    minify: false,
    rollupOptions: {
      output: { entryFileNames: 'kore-cloud.mjs', format: 'es' },
    },
  },
  ssr: { noExternal: true, target: 'node' },
})
