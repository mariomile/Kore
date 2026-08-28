/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Build-target platform injected by the Tauri CLI (`darwin`, `windows`,
   * `linux`, `ios`, `android`). Absent in plain Vite builds and tests.
   */
  readonly TAURI_ENV_PLATFORM?: string
}

/** App version injected from the canonical Tauri configuration by Vite. */
declare const __REFLECT_VERSION__: string
