import { useState } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import {
  buildObsidianConversion,
  convertObsidianVault,
  readObsidianImportSource,
  type ConversionProgress,
  type ConversionResult,
  type GraphInfo,
  type ImportMapping,
} from '@reflect/core'
import { dirtyOpenPaths, flushOpenDocuments } from '@/editor/open-documents'
import { canonicalizeImportBody } from '@/editor/roundtrip'
import { useAsyncAction } from '@/hooks/use-async-action'

export interface ObsidianConversionState {
  /** Pick an empty folder and convert the open vault into it. */
  readonly convert: (mapping: ImportMapping) => void
  readonly pending: boolean
  readonly progress: ConversionProgress | null
  readonly result: ConversionResult | null
  readonly error: string | null
}

/**
 * Converting the open Obsidian vault into a copy (Plan 31, slice 2). The
 * vault is read again right before converting, after open notes are saved, so
 * the copy carries what is on disk now rather than what the preview read.
 * The open vault is never written.
 */
export function useObsidianConversion(graph: GraphInfo | null): ObsidianConversionState {
  const action = useAsyncAction()
  const [progress, setProgress] = useState<ConversionProgress | null>(null)
  const [result, setResult] = useState<ConversionResult | null>(null)

  const convert = (mapping: ImportMapping): void => {
    if (graph === null) {
      return
    }
    void action.run(async () => {
      const destination = await open({
        directory: true,
        multiple: false,
        title: 'Choose an empty folder for the converted copy',
      })
      if (typeof destination !== 'string') {
        return
      }
      setResult(null)
      await flushOpenDocuments()
      if (dirtyOpenPaths().length > 0) {
        throw new Error(
          'Some notes could not be saved. Resolve their save errors before converting.',
        )
      }
      try {
        setProgress({ phase: 'copying', done: 0, total: 0 })
        const source = await readObsidianImportSource(graph.generation)
        if (source === null) {
          throw new Error('This vault has no Obsidian settings, so there is nothing to convert.')
        }
        const conversion = buildObsidianConversion({
          mapping,
          source,
          convert: canonicalizeImportBody,
        })
        setResult(
          await convertObsidianVault({
            generation: graph.generation,
            destination,
            conversion,
            onProgress: setProgress,
          }),
        )
      } finally {
        setProgress(null)
      }
    })
  }

  return { convert, pending: action.pending, progress, result, error: action.error }
}
