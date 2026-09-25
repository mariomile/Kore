// Console output a test may emit without asserting it. Everything else must
// be expected explicitly (`vi.spyOn(console, …)`) by the test that causes it.
// PRs may only shrink this list; a new entry needs a stated reason.
export const ALLOWED_CONSOLE_PATTERNS: RegExp[] = [
  // A benign browser artifact, not app output: the skipped notifications are
  // delivered on the next frame.
  /^(?:Error: )?ResizeObserver loop completed with undelivered notifications/,
  // Deliberate product output (`syncIndex` in packages/core indexing): every
  // test that opens a fresh index takes the one-time rebuild it announces.
  /^index: stored projection version /,
]
