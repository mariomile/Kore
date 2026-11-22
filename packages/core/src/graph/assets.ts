import { z } from 'zod'
import { echoLocalWrite } from '../indexing/local-write-echo'
import { call, callBinary } from '../ipc/invoke'
import { blobChunks } from '../lib/blob'
import { noteAttachmentAdded } from './attachment-index'
import { getVaultLayout } from './vault-layout'

/** Commands that return `()` from Rust serialize as `null` over IPC. */
const voidSchema = z.null()

/**
 * Upload chunk size. Big enough that a large file doesn't drown in IPC
 * round-trips, small enough that webview memory holds one chunk — never the
 * whole file (the point of streaming over the old base64-the-lot route).
 */
const CHUNK_BYTES = 4 * 1024 * 1024

/** The header carrying the upload id on raw-body append calls. */
const UPLOAD_ID_HEADER = 'x-upload-id'

/**
 * Where pasted and imported files land: the vault's own attachment folder
 * when its layout names one (an Obsidian vault's `attachmentFolderPath`),
 * otherwise Rust's default `assets/` (sent as `null`).
 */
function attachmentDir(): string | null {
  return getVaultLayout().attachmentFolder
}

/**
 * Stream a pasted/dropped file's bytes into the graph's `assets/` folder (or
 * the vault's own attachment folder, see {@link attachmentDir}) as
 * `desiredName` — or the first free `-2`-suffixed variant; Rust decides the
 * final name race-free and returns it as a graph-relative `assets/…` path.
 * Bytes travel as raw binary IPC bodies in {@link CHUNK_BYTES} chunks staged
 * under `.kore/tmp/`, so neither webview memory nor the file watcher ever
 * sees the whole file in flight. `generation` pins the write to the graph it
 * was issued for; a failure aborts the upload (best-effort) and rethrows.
 */
export async function createAsset(
  desiredName: string,
  contents: Blob,
  generation: number,
): Promise<string> {
  const id = await call('asset_upload_begin', { generation }, z.string())
  try {
    for (const chunk of blobChunks(contents, CHUNK_BYTES)) {
      await callBinary(
        'asset_upload_append',
        new Uint8Array(await chunk.arrayBuffer()),
        { [UPLOAD_ID_HEADER]: id },
        voidSchema,
      )
    }
    const path = await call(
      'asset_upload_commit',
      { id, desiredName, generation, dir: attachmentDir() },
      z.string(),
    )
    echoLocalWrite({ path, kind: 'upsert', modifiedMs: Date.now() })
    noteAttachmentAdded(path)
    return path
  } catch (error) {
    // Best-effort cleanup of the staged temp file; the original error is the
    // one worth surfacing.
    await call('asset_upload_abort', { id }, voidSchema).catch(() => {})
    throw error
  }
}

/**
 * Stream a blob's bytes to an **exact graph-relative path** — the audio-memo
 * intake, where the path is the memo's identity and collision renaming would
 * corrupt it. Same transport as {@link createAsset}: raw binary IPC bodies in
 * {@link CHUNK_BYTES} chunks staged under `.kore/tmp/`, so neither webview
 * IPC nor the file watcher ever sees the whole file in flight. Requires a
 * binary-capable bridge (see `hasBinaryIpc`); hosts without one use the
 * base64 `writeAsset` fallback instead.
 */
export async function writeAssetStreamed(
  path: string,
  contents: Blob,
  generation: number,
): Promise<void> {
  const id = await call('asset_upload_begin', { generation }, z.string())
  try {
    for (const chunk of blobChunks(contents, CHUNK_BYTES)) {
      await callBinary(
        'asset_upload_append',
        new Uint8Array(await chunk.arrayBuffer()),
        { [UPLOAD_ID_HEADER]: id },
        voidSchema,
      )
    }
    await call('asset_upload_commit_path', { id, path, generation }, voidSchema)
    echoLocalWrite({ path, kind: 'upsert', modifiedMs: Date.now() })
  } catch (error) {
    await call('asset_upload_abort', { id }, voidSchema).catch(() => {})
    throw error
  }
}

/**
 * The shared tail of every file-to-file import: Rust lands `source` in the
 * attachment folder as `desiredName` (or its first free variant) and answers
 * the graph-relative path, which is then echoed and announced like any other
 * new attachment.
 */
async function importAttachment(
  command: string,
  source: Record<string, string>,
  desiredName: string,
  generation: number,
): Promise<string> {
  const path = await call(
    command,
    { ...source, desiredName, generation, dir: attachmentDir() },
    z.string(),
  )
  echoLocalWrite({ path, kind: 'upsert', modifiedMs: Date.now() })
  noteAttachmentAdded(path)
  return path
}

/**
 * Copy a file the OS handed us a real path for (file picker) into the graph's
 * `assets/` folder as `desiredName`, with the same collision policy and
 * return value as {@link createAsset}. The copy happens file-to-file in Rust;
 * the bytes never enter webview memory.
 */
export async function importAsset(
  sourcePath: string,
  desiredName: string,
  generation: number,
): Promise<string> {
  return await importAttachment('asset_import', { sourcePath }, desiredName, generation)
}

/**
 * Copy a file the capture inbox holds (one the iOS share sheet spooled) into
 * the vault's attachment folder as `desiredName`, with the same collision
 * policy and return value as {@link createAsset}. File-to-file in Rust, like
 * {@link importAsset}; the spooled copy stays until the drain removes it, so
 * a crash between the two only ever costs a retry.
 */
export async function importCaptureSpool(
  spoolName: string,
  desiredName: string,
  generation: number,
): Promise<string> {
  return await importAttachment('capture_inbox_import', { spoolName }, desiredName, generation)
}

/**
 * Fetch a remote image (a saved post's photo) and keep it in the vault's
 * attachment folder as `desiredName`, with the same collision policy and
 * return value as {@link createAsset}; asking again for an image already
 * kept under that name returns it. Fetched and written in Rust (bounded:
 * https, raster images, a byte cap), so the bytes never enter the webview.
 */
export async function importRemoteImage(
  url: string,
  desiredName: string,
  generation: number,
): Promise<string> {
  return await importAttachment('capture_image_fetch', { url }, desiredName, generation)
}
