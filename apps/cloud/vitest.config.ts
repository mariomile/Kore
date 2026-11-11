import { resolve } from 'node:path'
import { defineProject } from 'vitest/config'

export default defineProject({
  resolve: {
    alias: {
      'cloudflare:workers': resolve(import.meta.dirname, 'src/test-stubs/cloudflare-workers.ts'),
    },
  },
  test: {
    name: 'cloud',
    environment: 'node',
    include: ['src/**/*.test.ts', 'setup/**/*.test.ts'],
    // Inlined so the `cloudflare:workers` alias above reaches its import.
    server: { deps: { inline: ['@cloudflare/workers-oauth-provider'] } },
  },
})
