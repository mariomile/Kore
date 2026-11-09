import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import type { ToolExecutionOptions } from 'ai'
import { setBridge } from '../../ipc/bridge'
import {
  applyProjection,
  applyTagTypeRow,
  connectIndex,
  openMigratedIndex,
  project,
} from '../../indexing/flow-test-harness'
import { refreshTagTypeResolutions } from '../../indexing/resolved-tag-types'
import { buildNoteTools } from './tools'
import type { ListCollectionOutput } from './tools-io'

/**
 * The chat's list_collection against a real index (Plan 33 B2): a private
 * tag definition must not leak its fields, or its child tags' notes, to the
 * model through a public tag that builds on it.
 */
let database: DatabaseSync
const sources = new Map<string, string>()

const CALL: ToolExecutionOptions<Record<string, unknown>> = {
  toolCallId: 'call-1',
  messages: [],
  context: {},
}

beforeEach(() => {
  database = openMigratedIndex()
  connectIndex(database)
  sources.clear()
})

afterEach(() => {
  setBridge(null)
  database.close()
})

function addNote(path: string, source: string): void {
  sources.set(path, source)
  const indexed = project(path, source, 1000)
  applyProjection(database, indexed)
  applyTagTypeRow(database, indexed)
}

async function runCollection(tag: string): Promise<ListCollectionOutput> {
  const tools = buildNoteTools({ readNoteFn: async (path) => sources.get(path) ?? '' })
  const execute = tools.list_collection.execute
  if (execute === undefined) {
    throw new Error('list_collection has no execute')
  }
  return (await execute({ tag }, CALL)) as ListCollectionOutput
}

describe('list_collection with tag inheritance', () => {
  beforeEach(() => {
    addNote(
      'tags/contact.md',
      '---\nlore: tag\nprivate: true\nproperties:\n  - {name: Phone, key: phone, type: text}\n---\n',
    )
    addNote(
      'tags/client.md',
      '---\nlore: tag\nextends: contact\nproperties:\n  - {name: Contract, key: contract, type: text}\n---\n',
    )
    addNote(
      'tags/secret.md',
      '---\nlore: tag\nextends: client\nprivate: true\nproperties:\n  - {name: Codename, key: codename, type: text}\n---\n',
    )
    addNote('people/acme.md', '---\ncontract: yearly\n---\n# Acme\n\n#client')
    addNote('people/x.md', '# X\n\n#secret')
  })

  it('shows a public child without its private parent’s fields', async () => {
    await refreshTagTypeResolutions(1)
    const output = await runCollection('client')
    if (!output.ok) {
      throw new Error(`unexpected refusal: ${output.error}`)
    }
    expect(output.schema.map((property) => property.key)).toEqual(['contract'])
    expect(output.rows.map((row) => row.path)).toEqual(['people/acme.md'])
    expect(JSON.stringify(output)).not.toContain('Phone')
  })

  it('treats a private definition as untyped', async () => {
    await refreshTagTypeResolutions(1)
    const output = await runCollection('contact')
    expect(output.ok).toBe(false)
  })
})
