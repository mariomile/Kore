import { useCallback, useEffect, useRef } from 'react'
import {
  collectResourceFile,
  collectResourceLink,
  errorMessage,
  parseFrontmatter,
  pasteCollects,
  resourceFileKind,
  saveLinkText,
  splitFrontmatter,
} from '@kore/core'
import { startOperation } from '@/lib/operations'
import { appendResourceSource } from '@/lib/resource-sources'
import { useSettings } from '@/providers/settings-provider'

/**
 * Collect resources using the issuing editor's live privacy header and graph
 * generation. Each kind is filed only when its Settings › Notes › Pasted links
 * & files switch is on; otherwise a paste is just a paste (the file still
 * uploads, the link still lands in the note, no card is made).
 */
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
  const { settings } = useSettings()
  const collectLinks = settings.pasteCollectLinks
  const saveText = settings.pasteSaveLinkText
  const collectImages = settings.pasteCollectImages
  const collectPdfs = settings.pasteCollectPdfs
  const collectFiles = settings.pasteCollectFiles
  const collectFile = useCallback(
    async (file: File): Promise<string | null> => {
      if (generation === null) return null
      const epoch = sessionEpoch.current
      const isStale = (): boolean => sessionEpoch.current !== epoch
      let uploaded: string | null = null
      const kinds = {
        pasteCollectLinks: collectLinks,
        pasteCollectImages: collectImages,
        pasteCollectPdfs: collectPdfs,
        pasteCollectFiles: collectFiles,
      }
      if (!pasteCollects(kinds, resourceFileKind(file))) {
        if (isStale()) return null
        return await saveFile(file)
      }
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
    [generation, path, isPrivate, saveFile, collectLinks, collectImages, collectPdfs, collectFiles],
  )
  const saveUrl = useCallback(
    (url: string): void => {
      if (generation === null || !collectLinks) return
      const epoch = sessionEpoch.current
      const isStale = (): boolean => sessionEpoch.current !== epoch
      void collectResourceLink(url, new URL(url).hostname, {
        generation,
        sourcePath: path,
        private: isPrivate,
        updateSources: (cardPath, sourceLink, forGeneration) =>
          appendResourceSource(cardPath, sourceLink, forGeneration, isStale),
      })
        .then(async (cardPath) => {
          // Keeping the page's words is an outbound fetch: never for a private note.
          if (!isPrivate && saveText) await saveLinkText(cardPath, generation)
        })
        .catch((cause) => {
          if (!isStale()) startOperation('Collecting link').fail(errorMessage(cause))
        })
    },
    [generation, path, isPrivate, collectLinks, saveText],
  )
  return { saveFile: collectFile, saveUrl }
}
