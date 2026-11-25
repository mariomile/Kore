import { listAttachments, readAsset, writeAsset } from '../graph/commands'
import { base64ToBytes, bytesToBase64 } from '../lib/base64'
import { isCanvasPath } from './canvas-file'

/** The UTF-8 text of a `.canvas` file, pinned to the graph `generation`. */
export async function readCanvasFile(path: string, generation: number): Promise<string> {
  return new TextDecoder().decode(base64ToBytes(await readAsset(path, generation)))
}

/** Every `.canvas` file in the vault, by path. */
export async function listCanvasFiles(generation?: number): Promise<string[]> {
  const files = await listAttachments(generation)
  return files
    .map((file) => file.path)
    .filter(isCanvasPath)
    .sort((left, right) => left.localeCompare(right))
}

/** Atomically replace a `.canvas` file with `source` (UTF-8 JSON). */
export async function writeCanvasFile(
  path: string,
  source: string,
  generation: number,
): Promise<void> {
  await writeAsset(path, bytesToBase64(new TextEncoder().encode(source)), generation)
}
