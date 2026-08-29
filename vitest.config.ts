import { defineConfig } from 'vitest/config'

export default defineConfig({
  root: import.meta.dirname,
  test: {
    retry: process.env.CI ? 3 : 0,
    slowTestThreshold: 10_000,
    // Deliberately NOT set here. In Vitest 4 this option is root-scoped, so a
    // root-level `false` serialized ~250 pure-Node files for a constraint that
    // belongs to one project: the desktop browser suite drives real keyboard
    // focus, which is a per-page global. That project sets it itself.
    projects: [
      './apps/desktop/vitest.*.config.ts',
      './apps/extension',
      './packages/core/vitest.*.config.ts',
      './packages/db',
      './packages/utils',
    ],
  },
})
