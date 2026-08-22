import { fileURLToPath } from 'node:url'
import { sentryVitePlugin } from '@sentry/vite-plugin'
import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'
// The single version source; tauri.conf.json's `version` also points here.
import pkg from './package.json'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'

const host: string | undefined = process.env.TAURI_DEV_HOST

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    babel({
      presets: [reactCompilerPreset()],
    }),

    tailwindcss(),
    sentryVitePlugin({
      authToken: process.env.SENTRY_AUTH_TOKEN,
      org: 'reflect-64',
      project: 'reflect-open',
      telemetry: false,
      release: {
        name: `reflect@${pkg.version}`,
      },
      sourcemaps: {
        filesToDeleteAfterUpload: ['./dist/**/*.map'],
      },
    }),
  ],

  define: {
    __REFLECT_VERSION__: JSON.stringify(pkg.version),
  },

  // If the target is below Safari 17.5, Lightning CSS downlevels `light-dark()` to a broken polyfill.
  build: { cssTarget: 'safari17.5', sourcemap: 'hidden' },

  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },

  // Expose the Tauri CLI's build-time TAURI_ENV_* vars (e.g. the target
  // platform, which gates desktop-only surfaces like the updater).
  envPrefix: ['VITE_', 'TAURI_ENV_'],

  // The dev bridge's SQLite (dev-only, behind `?platform=ios`) locates its
  // .wasm relative to its own module URL; esbuild pre-bundling would relocate
  // the module into .vite/deps and break that lookup.
  optimizeDeps: {
    exclude: ['@sqlite.org/sqlite-wasm'],
    // Base UI ships one entry point per component and Vite pre-bundles each
    // subpath as its own chunk, discovered from the import graph. A subpath
    // that only appears behind an interaction is discovered *late*, and the
    // re-optimization hands that chunk a second copy of React — "Invalid hook
    // call" the first time a right-click mounts the menu. Declaring it keeps
    // it in the first pass with everything else.
    include: ['@base-ui/react/context-menu'],
  },

  // Vite options tailored for Tauri development, applied in `tauri dev`/`tauri build`.
  //
  // 1. prevent Vite from obscuring Rust errors
  clearScreen: false,
  // 2. Tauri expects a fixed port; fail if it is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ['**/src-tauri/**'],
    },
    forwardConsole: {
      unhandledErrors: true,
      logLevels: ['error', 'warn', 'info', 'log', 'debug'],
    },
  },
})
