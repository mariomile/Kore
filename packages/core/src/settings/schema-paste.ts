import { z } from 'zod'

/**
 * Whether pasting into a note also files what was pasted as a resource card
 * (`notes/resource-….md`) in its collection: Links, Images, PDFs or Files.
 * Off by default (Mario, 2026-11-10): a paste is just a paste until the user
 * opts a kind in. Deliberate captures (share sheet, extension, `kore
 * capture`) always save, since saving is their whole intent.
 */
export const pasteCollectLinksSchema = z.boolean().catch(false)
export const pasteCollectImagesSchema = z.boolean().catch(false)
export const pasteCollectPdfsSchema = z.boolean().catch(false)
export const pasteCollectFilesSchema = z.boolean().catch(false)

/**
 * Whether a collected link card also keeps the page's text or the video's
 * transcript. It is an outbound fetch, so it can be switched off on its own;
 * it only applies while links are collected.
 */
export const pasteSaveLinkTextSchema = z.boolean().catch(true)

export interface PasteCollectSettings {
  pasteCollectLinks: boolean
  pasteCollectImages: boolean
  pasteCollectPdfs: boolean
  pasteCollectFiles: boolean
}

/** Whether a pasted resource of this kind gets a collection card. */
export function pasteCollects(
  settings: PasteCollectSettings,
  kind: 'link' | 'image' | 'pdf' | 'file',
): boolean {
  switch (kind) {
    case 'link':
      return settings.pasteCollectLinks
    case 'image':
      return settings.pasteCollectImages
    case 'pdf':
      return settings.pasteCollectPdfs
    case 'file':
      return settings.pasteCollectFiles
  }
}
