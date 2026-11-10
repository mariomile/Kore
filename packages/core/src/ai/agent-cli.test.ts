import { afterEach, describe, expect, it } from 'vitest'
import { setBridge } from '../ipc/bridge'
import type { ChatStreamEvent } from './chat/stream-chat'
import { streamAgentCliTurn } from './agent-cli'

afterEach(() => {
  setBridge(null)
})

async function collect(stream: AsyncGenerator<ChatStreamEvent>): Promise<ChatStreamEvent[]> {
  const events: ChatStreamEvent[] = []
  for await (const event of stream) {
    events.push(event)
  }
  return events
}

function turn(signal: AbortSignal): AsyncGenerator<ChatStreamEvent> {
  return streamAgentCliTurn({
    binary: 'claude',
    args: [],
    prompt: 'hi',
    cwd: '/vault',
    parseLine: () => [],
    startFailureMessage: 'could not start',
    signal,
  })
}

describe('streamAgentCliTurn stop', () => {
  it('never spawns the CLI when Stop lands while the listener registers', async () => {
    const controller = new AbortController()
    const invoked: string[] = []
    setBridge({
      invoke: async (command) => {
        invoked.push(command)
        return null
      },
      listen: async () => {
        controller.abort()
        return () => {}
      },
    })

    const events = await collect(turn(controller.signal))

    expect(events).toEqual([{ type: 'aborted', messages: [] }])
    expect(invoked).toEqual([])
  })

  it('repeats a Stop that arrived before the child existed', async () => {
    const controller = new AbortController()
    const invoked: string[] = []
    let emit: (payload: unknown) => void = () => {}
    setBridge({
      invoke: async (command, args) => {
        invoked.push(command)
        if (command === 'agent_cli_run') {
          // Stop pressed mid-spawn: this first stop finds no child.
          controller.abort()
        }
        if (command === 'agent_cli_stop' && invoked.includes('agent_cli_run')) {
          const stops = invoked.filter((name) => name === 'agent_cli_stop').length
          if (stops === 2) {
            const { requestId } = args as { requestId: string }
            emit({ kind: 'done', requestId, code: null })
          }
        }
        return null
      },
      listen: async (_event, handler) => {
        emit = handler
        return () => {}
      },
    })

    const events = await collect(turn(controller.signal))

    expect(events).toEqual([{ type: 'aborted', messages: [] }])
    expect(invoked.slice(0, 3)).toEqual(['agent_cli_run', 'agent_cli_stop', 'agent_cli_stop'])
  })
})
