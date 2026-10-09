/**
 * The AI SDK (`ai`) and its provider packages (`@ai-sdk/*`) weigh about
 * 550 KB of minified JavaScript, and only an AI action needs them. Loading
 * them here, on first use, keeps them out of the bundle the app parses at
 * startup. Modules reachable from startup take only *type* imports from those
 * packages; the `no-restricted-imports` rule in `eslint.config.js` enforces it.
 */
export function loadAiSdk(): Promise<typeof import('ai')> {
  return import('ai')
}
