/**
 * Constants the Worker and its tests share. They live outside `worker.ts`
 * because workerd treats every named export of the main module as an
 * entrypoint and refuses to start on one that is not a handler.
 */

/** The Worker's own version, reported on `/info`; bump with any API change. */
export const WORKER_VERSION = '0.2.0'

/**
 * Dynamic client registrations allowed per day. Registration is open (the
 * MCP spec requires it) and each one writes to KV, whose free tier allows
 * 1,000 writes a day: a cap far above a person's own agents keeps a stranger
 * with the URL from spending that budget and blocking sign-ins.
 */
export const MAX_REGISTRATIONS_PER_DAY = 25
