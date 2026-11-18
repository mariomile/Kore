import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_VAULT_LAYOUT, setVaultLayout } from '@kore/core/graph/vault-layout'
import { fakeD1 } from './d1-fake'
import { NoteStore } from './store'
import { callTool } from './tools'

let store: NoteStore

beforeEach(async () => {
  store = new NoteStore(fakeD1().binding)
  await store.ensureSchema()
})

afterEach(() => {
  setVaultLayout(DEFAULT_VAULT_LAYOUT)
})

async function call(name: string, args: Record<string, unknown>) {
  const result = await callTool(store, name, args)
  const text = result.content[0]?.text ?? ''
  return {
    error: result.isError === true,
    text,
    value: (result.isError ? null : JSON.parse(text)) as unknown,
  }
}

describe('agent tools', () => {
  it('creates a note in the layout folder and refuses a duplicate title', async () => {
    const created = await call('create_note', {
      title: 'Pricing Ideas',
      body: 'Seats.',
      tags: ['#strategy'],
    })
    expect(created.value).toEqual({ path: 'notes/pricing-ideas.md', title: 'Pricing Ideas' })
    const again = await call('create_note', { title: 'pricing ideas' })
    expect(again.error).toBe(true)
  })

  it('names files after titles in an Obsidian-style layout and suffixes collisions', async () => {
    setVaultLayout({ ...DEFAULT_VAULT_LAYOUT, newNoteFolder: 'Inbox', noteFileNames: 'title' })
    await store.write({ path: 'Inbox/Plan.md', source: '# Something else\n', baseVersion: 0 })
    const created = await call('create_note', { title: 'Plan' })
    expect(created.value).toMatchObject({ path: 'Inbox/Plan 2.md' })
  })

  it('reads a note by date, path or title', async () => {
    await store.write({ path: 'daily/2026-11-09.md', source: 'Met Dana\n', baseVersion: 0 })
    await store.write({ path: 'notes/a.md', source: '# Alpha\n', baseVersion: 0 })
    expect((await call('read_note', { note: '2026-11-09' })).value).toMatchObject({
      content: 'Met Dana\n',
    })
    expect((await call('read_note', { note: 'notes/a' })).value).toMatchObject({ title: 'Alpha' })
    expect((await call('read_note', { note: 'alpha' })).value).toMatchObject({ path: 'notes/a.md' })
    expect((await call('read_note', { note: '../etc/passwd' })).error).toBe(true)
  })

  it('appends without losing text another writer added in between', async () => {
    await store.write({ path: 'n.md', source: '# N\n\nfrom the Mac\n', baseVersion: 0 })
    const result = await call('append_to_note', { note: 'n.md', markdown: 'from Claude' })
    expect(result.value).toEqual({ path: 'n.md', appended: true })
    expect((await store.get('n.md'))?.source).toBe('# N\n\nfrom the Mac\n\nfrom Claude\n')
  })

  it('edits one exact passage and refuses an ambiguous one', async () => {
    await store.write({
      path: 'n.md',
      source: '# N\n\n- [ ] call Dana\n- [ ] call Dana back\n',
      baseVersion: 0,
    })
    expect(
      (await call('edit_note', { note: 'n.md', oldText: 'call Dana', newText: 'x' })).error,
    ).toBe(true)
    await call('edit_note', {
      note: 'n.md',
      oldText: '- [ ] call Dana\n',
      newText: '- [x] call Dana\n',
    })
    expect((await store.get('n.md'))?.source).toBe('# N\n\n- [x] call Dana\n- [ ] call Dana back\n')
  })

  it('never writes a private note', async () => {
    await store.write({ path: 'n.md', source: '# N\n', baseVersion: 0 })
    const refused = await call('set_properties', { note: 'n.md', set: { private: true } })
    expect(refused.error).toBe(true)
    expect((await store.get('n.md'))?.source).toBe('# N\n')
    expect(
      (await call('create_note', { title: 'Secret', properties: { private: 'yes' } })).error,
    ).toBe(true)
  })

  it('returns the vault contract from vault_guide', async () => {
    await store.write({
      path: 'AGENTS.md',
      source: '# Rules\n\nMemory goes in Memory/.\n',
      baseVersion: 0,
    })
    const guide = await call('vault_guide', {})
    expect(guide.value).toMatchObject({
      contract: { path: 'AGENTS.md' },
      folders: [{ folder: '', notes: 1 }],
    })
  })

  it('searches and lists recent notes', async () => {
    await store.write({
      path: 'a.md',
      source: '# Alpha\n\nquarterly pricing review\n',
      baseVersion: 0,
    })
    const found = await call('search', { query: 'pricing' })
    expect(found.value).toMatchObject({ results: [{ path: 'a.md', title: 'Alpha' }] })
    expect((await call('recent_notes', { limit: 5 })).value).toEqual({
      notes: [expect.objectContaining({ path: 'a.md' })],
    })
    expect((await call('search', { query: 'x', limit: 0 })).error).toBe(true)
  })
})
