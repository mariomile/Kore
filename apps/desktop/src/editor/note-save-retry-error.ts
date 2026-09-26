/** An edit retained in the live note after a failed save. Retry persistence,
 * never the original transform, because it has already been applied. */
export class NoteSaveRetryError extends Error {
  readonly retrySave: () => Promise<void>

  constructor(message: string, retrySave: () => Promise<void>) {
    super(`${message}. The edit is still in the note. Retry saving without applying it again.`)
    this.name = 'NoteSaveRetryError'
    this.retrySave = retrySave
  }
}
