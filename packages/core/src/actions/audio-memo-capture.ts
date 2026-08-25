import { errorMessage } from '../errors'
import { bytesToBase64 } from '../lib/base64'
import { writeAsset } from '../graph/commands'
import { writeAssetStreamed } from '../graph/assets'
import { hasBinaryIpc } from '../ipc/bridge'
import { audioMemoIdentity, audioMemoPartPath, type AudioMemoIdentity } from './audio-memo-identity'

/**
 * The capture leg of the audio-memo pipeline: persist recordings (whole memos
 * and session segments) into the graph. Local, instant, no network — see the
 * `audio-memo` module doc for how reconciliation enriches them later.
 */

export interface CaptureAudioMemoInput {
  /** The recording, as the recorder produced it. */
  audio: Blob
  /** The recording's MIME type, possibly with codec parameters. */
  mimeType: string
  /** When the recording stopped — names the asset and picks the daily note. */
  recordedAt: Date
  /** `GraphInfo.generation` — pins the write to the issuing graph. */
  generation: number
}

/** Expected failures are data: the caller retries with the same recording. */
export type CaptureAudioMemoOutcome =
  | { ok: true; memo: AudioMemoIdentity }
  | { ok: false; message: string }

/**
 * Persist one recording into the graph — the durable step, no network. The
 * transcription happens later, in {@link reconcileAudioMemos}.
 */
async function writeAudioMemoAsset(path: string, audio: Blob, generation: number): Promise<void> {
  if (hasBinaryIpc()) {
    await writeAssetStreamed(path, audio, generation)
    return
  }
  // Browser dev's in-memory bridge has no binary transport; recordings there
  // are short enough for the base64 JSON route.
  await writeAsset(path, bytesToBase64(new Uint8Array(await audio.arrayBuffer())), generation)
}

export async function captureAudioMemo(
  input: CaptureAudioMemoInput,
): Promise<CaptureAudioMemoOutcome> {
  const memo = audioMemoIdentity(input.recordedAt, input.mimeType)
  try {
    await writeAudioMemoAsset(memo.audioPath, input.audio, input.generation)
  } catch (cause) {
    return { ok: false, message: errorMessage(cause) }
  }
  return { ok: true, memo }
}

export interface CaptureAudioMemoPartInput {
  /** One finished segment, as the recorder produced it. */
  audio: Blob
  /** The segment's MIME type, possibly with codec parameters. */
  mimeType: string
  /** When the *session* started — every part shares the session identity. */
  recordedAt: Date
  /** 1-based position within the session. */
  part: number
  /** True on the session's final segment. */
  end: boolean
  /** `GraphInfo.generation` — pins the write to the issuing graph. */
  generation: number
}

/**
 * Persist one session segment at its exact part path — the durable step, no
 * network. Rotation calls this as each segment finishes, so a crash loses at
 * most the segment still being recorded.
 */
export async function captureAudioMemoPart(
  input: CaptureAudioMemoPartInput,
): Promise<CaptureAudioMemoOutcome> {
  const memo = audioMemoIdentity(input.recordedAt, input.mimeType)
  try {
    await writeAudioMemoAsset(
      audioMemoPartPath(memo, input.part, input.end),
      input.audio,
      input.generation,
    )
  } catch (cause) {
    return { ok: false, message: errorMessage(cause) }
  }
  return { ok: true, memo }
}
