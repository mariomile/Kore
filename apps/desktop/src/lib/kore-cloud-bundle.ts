/**
 * The Kore Cloud Worker that Settings uploads into the user's Cloudflare
 * account (Plan 34), loaded only when someone turns Kore Cloud on: it is a
 * large module the rest of the app never needs. `pnpm build` builds it first
 * (`@kore/cloud`'s own build, ordered by turbo through the workspace
 * dependency); in plain dev run `pnpm --filter @kore/cloud build` once.
 *
 * A glob rather than a plain dynamic import, so a checkout that never built
 * the Worker (the test runners, a fresh dev clone) still compiles: the glob
 * is simply empty there and turning Kore Cloud on says what to run.
 */
const worker = import.meta.glob<string>('../../../cloud/dist/worker/worker.js', {
  query: '?raw',
  import: 'default',
})

export async function loadKoreCloudWorker(): Promise<string> {
  const load = Object.values(worker)[0]
  if (load === undefined) {
    throw new Error(
      'This build of Kore does not include Kore Cloud. Run `pnpm --filter @kore/cloud build` and restart.',
    )
  }
  return await load()
}
