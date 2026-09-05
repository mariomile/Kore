import { useCallback } from 'react'
import {
  collectResourceFile,
  collectResourceLink,
  errorMessage,
  parseFrontmatter,
  splitFrontmatter,
} from '@reflect/core'
import { startOperation } from '@/lib/operations'

/** Collect resources using the issuing editor's live privacy header and graph generation. */
export function useResourceCollection(
  generation: number | null,
  path: string,
  header: string,
  saveFile: (file: File) => Promise<string | null>,
): { saveFile: (file: File) => Promise<string | null>; saveUrl: (url: string) => void } {
  const frontmatter = parseFrontmatter(splitFrontmatter(header).raw)
  const isPrivate = frontmatter.warning !== undefined || frontmatter.data.private === true
  const collectFile = useCallback(
    async (file: File): Promise<string | null> => {
      if (generation === null) return null
      let uploaded: string | null = null
      try {
        return await collectResourceFile(
          file,
          { generation, sourcePath: path, private: isPrivate },
          async () => {
            uploaded = await saveFile(file)
            return uploaded
          },
        )
      } catch (cause) {
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
      void collectResourceLink(url, new URL(url).hostname, {
        generation,
        sourcePath: path,
        private: isPrivate,
      }).catch((cause) => startOperation('Collecting link').fail(errorMessage(cause)))
    },
    [generation, path, isPrivate],
  )
  return { saveFile: collectFile, saveUrl }
}
