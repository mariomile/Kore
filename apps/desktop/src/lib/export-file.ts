import { errorMessage, exportWrite } from '@reflect/core'
import { save } from '@tauri-apps/plugin-dialog'
import { startOperation } from '@/lib/operations'

/**
 * The one export-to-file flow (styled note HTML, collection CSV): ask where
 * to save, build the document, write it through the export channel. Both
 * sharp edges live here once — cancelling the dialog is a silent no-op, and
 * every failure (before or after the dialog) lands on the operations status
 * line like other background work.
 */

/** A save-dialog default the OS accepts: `base` with path characters out. */
export function exportFileName(base: string, fallback: string, extension: string): string {
  const safe = base.replaceAll(/[\\/:]/g, '-').trim()
  return `${safe === '' ? fallback : safe}.${extension}`
}

export interface FileExportOptions {
  /** Operations-line label ("Exporting note"). */
  operation: string
  /** The dialog's suggested name — async when deriving it can fail/IO. */
  defaultPath: string | (() => Promise<string>)
  /** The dialog's type filter. */
  filter: { name: string; extensions: string[] }
  /** Produce the document contents once a target is chosen. */
  build: () => Promise<string> | string
}

/** Run one export: dialog → build → write, with the shared error handling. */
export async function runFileExport(options: FileExportOptions): Promise<void> {
  let target: string | null = null
  try {
    const defaultPath =
      typeof options.defaultPath === 'string' ? options.defaultPath : await options.defaultPath()
    target = await save({ defaultPath, filters: [options.filter] })
  } catch (cause) {
    startOperation(options.operation).fail(errorMessage(cause))
    return
  }
  if (target === null) {
    return
  }
  const operation = startOperation(options.operation)
  try {
    await exportWrite(target, await options.build())
    operation.done()
  } catch (cause) {
    operation.fail(errorMessage(cause))
  }
}
