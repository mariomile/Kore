import type { HostToolRunner } from './host-tools'
import type { NoteToolCall } from './tools-activity'

/** A one-tool catalog (`read_note`) whose runs the test scripts. */
export function fakeHostTools(run: HostToolRunner['run']): HostToolRunner {
  return {
    specs: [{ name: 'read_note', description: 'Read a note', parameters: { type: 'object' } }],
    describe: async (request) =>
      ({ id: request.toolCallId, kind: 'read' }) as unknown as NoteToolCall,
    run,
  }
}
