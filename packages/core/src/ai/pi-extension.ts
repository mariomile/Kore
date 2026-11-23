/**
 * The extension pi loads for a Kore run, as source text: the bridge writes
 * it to app data and passes its path with `-e` (see `./pi-cli`).
 *
 * It gives pi exactly one capability — Kore's own chat tools. Each tool the
 * app declares (JSON in the `KORE_PI_TOOLS` environment variable) is
 * registered with pi, and its `execute` asks the app for the answer over
 * pi's RPC dialog channel (`ctx.ui.input`, which surfaces as an
 * `extension_ui_request` on stdout and blocks until the app replies). The
 * extension never touches the filesystem or the network itself: with pi's
 * built-in tools switched off, everything the model can do in the vault goes
 * through the app, where the privacy gate lives.
 *
 * Plain JavaScript on purpose — pi loads it directly, with no build step.
 */
export const PI_EXTENSION_SOURCE = `const TITLE = 'kore-tool'

export default function koreExtension(pi) {
  const specs = JSON.parse(process.env.KORE_PI_TOOLS ?? '[]')
  for (const spec of specs) {
    pi.registerTool({
      name: spec.name,
      label: spec.name,
      description: spec.description,
      parameters: spec.parameters,
      async execute(toolCallId, params, signal, _onUpdate, ctx) {
        const request = JSON.stringify({ toolCallId, name: spec.name, input: params })
        const reply = await ctx.ui.input(TITLE, request, { signal })
        if (reply === undefined) {
          throw new Error('Kore did not answer the tool call.')
        }
        const answer = JSON.parse(reply)
        if (typeof answer.error === 'string') {
          throw new Error(answer.error)
        }
        return { content: [{ type: 'text', text: JSON.stringify(answer.output) }], details: {} }
      },
    })
  }
}
`
