import { useCallback, useEffect, useRef } from 'react'
import {
  collectResourceFile,
  collectResourceLink,
  errorMessage,
  parseFrontmatter,
  splitFrontmatter,
} from '@reflect/core'
import { startOperation } from '@/lib/operations'
import { appendResourceSource } from '@/lib/resource-sources'

/** Collect resources using the issuing editor's live privacy header and graph generation. */
export function useResourceCollection(
  generation: number | null,
  path: string,
  header: string,
  saveFile: (file: File) => Promise<string | null>,
): { saveFile: (file: File) => Promise<string | null>; saveUrl: (url: string) => void } {
  const sessionEpoch = useRef(0)
  useEffect(() => {
    return () => {
      sessionEpoch.current += 1
    }
  }, [generation, path])
  const frontmatter = parseFrontmatter(splitFrontmatter(header).raw)
  const isPrivate = frontmatter.warning !== undefined || frontmatter.data.private === true
  const collectFile = useCallback(
    async (file: File): Promise<string | null> => {
      if (generation === null) return null
      const epoch = sessionEpoch.current
      const isStale = (): boolean => sessionEpoch.current !== epoch
      let uploaded: string | null = null
      try {
        const target = await collectResourceFile(
          file,
          {
            generation,
            sourcePath: path,
            private: isPrivate,
            updateSources: (cardPath, sourceLink, forGeneration) =>
              appendResourceSource(cardPath, sourceLink, forGeneration, isStale),
          },
          async () => {
            if (isStale()) return null
            uploaded = await saveFile(file)
            return uploaded
          },
        )
        return isStale() ? null : target
      } catch (cause) {
        if (isStale()) return null
        startOperation('Collecting file').fail(errorMessage(cause))
        // If the binary landed, preserve the editor insertion even when its card failed.
        return uploaded
      }
    },
    [generation, path, isPrivate, saveFile],
  )
  const saveUrl = useCallback(
    (url: string): void => {
      if (generation === null) return
      const epoch = sessionEpoch.current
      const isStale = (): boolean => sessionEpoch.current !== epoch
      void collectResourceLink(url, new URL(url).hostname, {
        generation,
        sourcePath: path,
        private: isPrivate,
        updateSources: (cardPath, sourceLink, forGeneration) =>
          appendResourceSource(cardPath, sourceLink, forGeneration, isStale),
      }).catch((cause) => {
        if (!isStale()) startOperation('Collecting link').fail(errorMessage(cause))
      })
    },
    [generation, path, isPrivate],
  )
  return { saveFile: collectFile, saveUrl }
}
