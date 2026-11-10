import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { buildIndexedNote, parseNote, setBridge } from '@reflect/core'
import { createDevIndexDb, type DevIndexDb } from '@/dev/dev-index-db'
import '@/test-utils/locator'
import { BlockZoom } from './block-zoom'
import { MoveBranch } from './move-branch-picker'
import { moveBranchFromLastFocused } from './move-branch-opener'
import { NoteEditor, type NoteEditorHandle } from './note-editor'

const TODAY = ['# Today', '', '- Idee ^idee1', '  - voice agent', '- Call Luca', ''].join('\n')
const DEEPAGENT = ['# DeepAgent', '', 'Notes.', ''].join('\n')
const OTHER = ['# Other', '', 'See [[Today#^idee1]] and [[Today#^call1]].', ''].join('\n')

const mod = /Mac|iPhone|iPad/.test(navigator.platform) ? 'Meta' : 'Control'
const pmRoot = page.locate('.ProseMirror')

let files: Map<string, string>
let db: DevIndexDb
let failWrites: boolean

function index(path: string): void {
  const source = files.get(path)!
  db.applyNote(buildIndexedNote(parseNote({ path, source }), { fileHash: path, mtime: 1, source }))
}

beforeEach(async () => {
  files = new Map([
    ['notes/today.md', TODAY],
    ['notes/deepagent.md', DEEPAGENT],
    ['notes/other.md', OTHER],
  ])
  failWrites = false
  db = await createDevIndexDb()
  for (const path of files.keys()) {
    index(path)
  }
  setBridge({
    invoke: async (command, args) => {
      const record = args as Record<string, unknown>
      switch (command) {
        case 'db_query':
          return db.query(String(record['sql']), (record['params'] as readonly unknown[]) ?? [])
        case 'note_read':
          return files.get(String(record['path'])) ?? null
        case 'note_write':
          if (failWrites) {
            throw new Error('disk full')
          }
          files.set(String(record['path']), String(record['contents']))
          return 1
        default:
          return null
      }
    },
    listen: async () => () => {},
  })
})

afterEach(() => {
  setBridge(null)
})

async function renderToday(): Promise<NoteEditorHandle> {
  let handle: NoteEditorHandle | null = null
  await render(
    <NoteEditor
      initialContent={TODAY}
      handleRef={(grabbed) => {
        handle = grabbed
      }}
    >
      <BlockZoom />
      <MoveBranch notePath="notes/today.md" linkTarget="Today" generation={1} />
    </NoteEditor>,
  )
  await expect.element(pmRoot.getByText('voice agent')).toBeVisible()
  return handle!
}

describe('move a branch to another note', () => {
  it('⌘⇧M moves the list item with its children to the end of the picked note', async () => {
    const handle = await renderToday()
    await pmRoot.getByText('Idee').click()
    await userEvent.keyboard(`{${mod}>}{Shift>}m{/Shift}{/${mod}}`)
    const input = page.getByPlaceholder('Move to…')
    await expect.element(input).toBeVisible()
    await userEvent.keyboard('Deep')
    await expect.element(page.getByRole('option', { name: 'DeepAgent' })).toBeVisible()
    await userEvent.keyboard('{Enter}')

    await expect
      .poll(() => files.get('notes/deepagent.md'))
      .toBe('# DeepAgent\n\nNotes.\n\n- Idee ^idee1\n  - voice agent\n')
    expect(handle.getMarkdown()).not.toContain('voice agent')
    expect(handle.getMarkdown()).toContain('- Call Luca')
    // The link to the moved line follows it; the one to a line that stayed does not.
    await expect
      .poll(() => files.get('notes/other.md'))
      .toBe('# Other\n\nSee [[DeepAgent#^idee1]] and [[Today#^call1]].\n')
  })

  it('never offers the note the branch is already in', async () => {
    await renderToday()
    await pmRoot.getByText('Call Luca').click()
    expect(moveBranchFromLastFocused()).toBe(true)
    await expect.element(page.getByPlaceholder('Move to…')).toBeVisible()
    await userEvent.keyboard('Today')
    await expect.element(page.getByText('No notes found')).toBeVisible()
  })

  it('puts the branch back when the other note cannot be written', async () => {
    const handle = await renderToday()
    failWrites = true
    await pmRoot.getByText('Idee').click()
    await userEvent.keyboard(`{${mod}>}{Shift>}m{/Shift}{/${mod}}`)
    await userEvent.keyboard('Deep')
    await expect.element(page.getByRole('option', { name: 'DeepAgent' })).toBeVisible()
    await userEvent.keyboard('{Enter}')
    await expect.element(pmRoot.getByText('voice agent')).toBeVisible()
    expect(handle.getMarkdown()).toBe(TODAY)
    expect(files.get('notes/deepagent.md')).toBe(DEEPAGENT)
  })
})
