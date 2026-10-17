import { describe, expect, it } from 'vitest'
import { mcpClientSetup } from './agent-skill'

describe('mcpClientSetup', () => {
  it('pins the bundled CLI to the graph and quotes paths with spaces for the shell', () => {
    const setup = mcpClientSetup({
      cliPath: '/Applications/Kore.app/Contents/MacOS/reflect',
      graphRoot: "/Users/me/Library/Mobile Documents/Mario's Kore",
      readOnly: true,
    })
    expect(JSON.parse(setup.configJson)).toEqual({
      mcpServers: {
        kore: {
          command: '/Applications/Kore.app/Contents/MacOS/reflect',
          args: [
            '--graph',
            "/Users/me/Library/Mobile Documents/Mario's Kore",
            'mcp',
            '--read-only',
          ],
        },
      },
    })
    expect(setup.claudeCodeCommand).toBe(
      String.raw`claude mcp add kore -- /Applications/Kore.app/Contents/MacOS/reflect --graph '/Users/me/Library/Mobile Documents/Mario'\''s Kore' mcp --read-only`,
    )
  })
})
