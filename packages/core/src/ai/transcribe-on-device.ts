import { KoreError } from '../errors'
import { transcribeOnDevice } from '../ipc/recording-plugin'
import { bytesToBase64 } from '../lib/base64'
import type { SegmentTranscriber } from '../actions/audio-memo-session'

/**
 * Keyless audio-memo transcription: the host's OS speech engine, on the
 * device. Today that is iOS (Apple's on-device recognizer, through the
 * recording plugin); the host decides availability and passes the engine to
 * the reconciler, because only the host knows which platform it runs on.
 */

/**
 * The device can't transcribe right now: speech access is off, or there is
 * no on-device model for the language. Not a failure of the recording, so a
 * pass stops on it as a self-healing `config` stop and the memo stays
 * pending.
 */
export class OnDeviceTranscriptionUnavailableError extends KoreError {
  constructor(message: string) {
    super('unknown', message)
    this.name = 'OnDeviceTranscriptionUnavailableError'
  }
}

/** Type guard for {@link OnDeviceTranscriptionUnavailableError}. */
export function isOnDeviceTranscriptionUnavailable(
  value: unknown,
): value is OnDeviceTranscriptionUnavailableError {
  return value instanceof OnDeviceTranscriptionUnavailableError
}

/** The iOS engine: the recording plugin's `transcribe_on_device` command. */
export const nativeOnDeviceTranscriber: SegmentTranscriber = async (audio, mimeType) => {
  const response = await transcribeOnDevice(bytesToBase64(audio), mimeType)
  if (response.status === 'unavailable') {
    throw new OnDeviceTranscriptionUnavailableError(response.reason)
  }
  return response.text.trim()
}
