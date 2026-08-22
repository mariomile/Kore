import { fileURLToPath } from 'node:url'
import { defineProject, type ViteUserConfig } from 'vitest/config'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'

export function defineDesktopProject(project: {
  plugins?: ViteUserConfig['plugins']
  test: NonNullable<ViteUserConfig['test']>
}): ViteUserConfig {
  return defineProject({
    plugins: [
      react(),
      babel({
        presets: [reactCompilerPreset()],
      }),
      ...(project.plugins ?? []),
    ],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    optimizeDeps: {
      // Base UI ships one entry point per component and Vite pre-bundles each
      // subpath as its own chunk, discovered from the import graph. A subpath
      // that only appears behind an interaction is discovered *late*, and the
      // re-optimization hands that chunk a second copy of React — "Invalid hook
      // call" the first time a right-click mounts the menu. Declaring it keeps
      // it in the first pass with everything else.
      include: ['@base-ui/react/context-menu'],
    },
    test: {
      globals: false,
      maxConcurrency: 1,
      retry: process.env.CI ? 3 : 0,
      setupFiles: ['./src/test-utils/setup-console.ts'],
      slowTestThreshold: 10_000,
      ...project.test,
    },
  })
}
