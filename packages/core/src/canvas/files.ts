import { listAttachments, readAsset } from '../graph/commands'
import { isCanvasPath } from './canvas-file'

/** The UTF-8 text of a `.canvas` file, pinned to the graph `generation`. */
export async function readCanvasFile(path: string, generation: number): Promise<string> {
  const base64 = await readAsset(path, generation)
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

/** Every `.canvas` file in the vault, by path. */
export async function listCanvasFiles(generation?: number): Promise<string[]> {
  const files = await listAttachments(generation)
  return files
    .map((file) => file.path)
    .filter(isCanvasPath)
    .sort((left, right) => left.localeCompare(right))
}
