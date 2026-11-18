import { MAX_SOURCE_BYTES, byteLength, describeNote, isPrivateSource } from './note-rules'
import type { KoreCloud } from './client'

/**
 * The first upload of a vault's notes into Kore Cloud, over the Worker's own
 * `/sync/*` API with the owner key. It never overwrites a note already in
 * Kore Cloud: a note that is there with other text (an agent added to it, or
 * it changed on the Mac since the last setup) is left as it is and reported,
 * for app sync to reconcile. Private notes, hidden folders and notes over
 * 1 MB stay on the Mac.
 */

/** Writes per push: the Worker's cap for pushes that carry `meta`. */
export const PUSH_BATCH = 20

/** A vault note read from disk. */
export interface LocalNote {
  path: string
  source: string
}

export interface UploadReport {
  /** Notes sent to Kore Cloud now. */
  uploaded: number
  /** Notes already there with the same text. */
  unchanged: number
  /** Notes already there with other text, left as they are. */
  differs: string[]
  /** `private: true` notes, which never leave the Mac. */
  private: number
  /** Notes over 1 MB. */
  tooLarge: string[]
  /** Notes the Worker refused or that lost a race, with the reason. */
  failed: { path: string; reason: string }[]
}

/**
 * Send the notes Kore Cloud does not have yet, in pushes of {@link PUSH_BATCH}
 * with the app's own parse as `meta`. Call `setVaultLayout` with the vault's
 * layout first, so daily notes parse as they do in the app.
 */
export async function uploadNotes(
  cloud: KoreCloud,
  local: LocalNote[],
  onProgress: (sent: number, total: number) => void = () => {},
): Promise<UploadReport> {
  const report: UploadReport = {
    uploaded: 0,
    unchanged: 0,
    differs: [],
    private: 0,
    tooLarge: [],
    failed: [],
  }
  const remote = await cloud.notes()
  const pending: LocalNote[] = []
  for (const note of local) {
    if (isPrivateSource(note.source)) {
      report.private += 1
      continue
    }
    if (byteLength(note.source) > MAX_SOURCE_BYTES) {
      report.tooLarge.push(note.path)
      continue
    }
    const there = remote.get(note.path)
    if (there === undefined) {
      pending.push(note)
    } else if (there.source === note.source) {
      report.unchanged += 1
    } else {
      report.differs.push(note.path)
    }
  }
  for (let start = 0; start < pending.length; start += PUSH_BATCH) {
    const batch = pending.slice(start, start + PUSH_BATCH)
    const results = await cloud.push(
      batch.map((note) => {
        const { title, tags, text } = describeNote(note.path, note.source)
        return { path: note.path, source: note.source, baseVersion: 0, meta: { title, tags, text } }
      }),
    )
    for (const result of results) {
      if (result.status === 'ok') {
        report.uploaded += 1
      } else {
        report.failed.push({
          path: result.path,
          reason: result.reason ?? 'changed in Kore Cloud during the upload',
        })
      }
    }
    onProgress(Math.min(start + PUSH_BATCH, pending.length), pending.length)
  }
  return report
}
