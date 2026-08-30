import { render } from 'vitest-browser-react'
import { page } from 'vitest/browser'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_SETTINGS,
  untitledNotePath,
  type ChatConversation,
  type GraphInfo,
  type PinnedNote,
  type Settings,
} from '@reflect/core'
import type { CommandContext } from '@/lib/commands/types'
import type { NoteRoute, Route } from '@/routing/route'
import type { ReactElement } from 'react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { UpdateProvider } from '@/providers/update-provider'
import { RouterProvider, useRouter } from '@/routing/router'
import { expectLocatorToHaveCount } from '@/test-utils/expect'

const getPinnedNotes = vi.hoisted(() => vi.fn<() => Promise<PinnedNote[]>>(async () => []))
const listChatConversations = vi.hoisted(() =>
  vi.fn<() => Promise<ChatConversation[]>>(async () => []),
)
const openConversation = vi.hoisted(() => vi.fn(async () => {}))
const deleteConversation = vi.hoisted(() => vi.fn(async () => {}))
const newChat = vi.hoisted(() => vi.fn(() => 'chat-new'))
const listNoteTags = vi.hoisted(() =>
  vi.fn<() => Promise<{ tag: string; count: number }[]>>(async () => []),
)
const revealItemInDir = vi.hoisted(() => vi.fn<(path: string) => Promise<void>>(async () => {}))
const openRouteInNewWindow = vi.hoisted(() => vi.fn<(route: NoteRoute) => Promise<boolean>>())
const openRecent = vi.hoisted(() => vi.fn())
const pickAndOpen = vi.hoisted(() => vi.fn())
const chooseGraph = vi.hoisted(() => vi.fn())
interface NativeContextMenuItemForTest {
  text: string
  action: () => void
}

interface NativeContextMenuOptionsForTest {
  items: NativeContextMenuItemForTest[]
}

const openNativeContextMenu = vi.hoisted(() =>
  vi.fn(async (options: NativeContextMenuOptionsForTest) => {
    options.items[0]?.action()
  }),
)
const unpinNote = vi.hoisted(() => vi.fn(async () => {}))
const updateSettingsWith = vi.hoisted(() =>
  vi.fn<(updater: (current: Settings) => Partial<Settings>) => void>(),
)

vi.mock('@reflect/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@reflect/core')>()),
  hasBridge: () => true,
  getPinnedNotes,
  listNoteTags,
  listChatConversations,
  vaultScanStats: async () => ({ notes: 50, attachments: 0, skipped: 0 }),
}))
vi.mock('@/providers/chat-provider', () => ({
  useOptionalChatSession: () => null,
  useChatSession: () => ({
    activeConversationId: 'active-conversation',
    openConversation,
    deleteConversation,
    newChat,
  }),
}))
vi.mock('@tauri-apps/plugin-opener', () => ({ revealItemInDir }))
vi.mock('@/lib/windows/open-in-new-window', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/windows/open-in-new-window')>()),
  openRouteInNewWindow,
}))
vi.mock('@/lib/native-menu/context-menu', () => ({ openNativeContextMenu }))
vi.mock('@/lib/note-pin', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/note-pin')>()),
  unpinNote,
}))
vi.mock('@/providers/graph-provider', () => ({
  useGraph: () => ({
    graph: GRAPH,
    indexGeneration: 1,
    recents: [
      { root: '/notes', name: 'Notes', openedMs: 2 },
      {
        root: '/Users/mario/Library/Mobile Documents/iCloud~app~lore/Documents/Work',
        name: 'Work',
        openedMs: 1,
      },
    ],
    indexing: false,
    openRecent,
    pickAndOpen,
    chooseGraph,
  }),
}))
vi.mock('@/providers/settings-provider', () => ({
  useSettings: () => ({
    settings: { dateFormat: 'mdy', graphColors: {}, collectionSorts: {} },
    updateSettings: () => {},
    updateSettingsWith,
  }),
}))
vi.mock('@/providers/sync-provider', () => ({
  useSync: () => ({
    backup: { phase: 'disconnected' },
    connectNewRepo: async () => {},
    connectExistingRepo: async () => 'connected',
    disconnectGraph: async () => {},
    signOut: async () => {},
    backUpNow: async () => {},
  }),
}))

const audioMemo = vi.hoisted(() => ({
  phase: 'idle' as const,
  elapsedMs: 0,
  stream: null,
  available: true,
  unavailableReason: null as string | null,
  error: null,
  canRetry: false,
  toggle: vi.fn(),
  cancel: vi.fn(),
  retry: vi.fn(),
  discard: vi.fn(),
}))
vi.mock('@/providers/audio-memo-provider', () => ({
  useAudioMemo: () => audioMemo,
}))

const GRAPH: GraphInfo = { root: '/notes', name: 'Notes', generation: 1 }

// Import after the core mock so the command registry sees the mocked module.
const { Sidebar } = await import('./sidebar')
const { readSidebarSurface } = await import('./sidebar-surface')
const { registerAppCommands } = await import('@/lib/commands/app-commands')
registerAppCommands()

beforeEach(() => {
  // The selected surface persists in sessionStorage — reset it so a test
  // that switched to Chat or Meetings can't leak its rail into the next.
  window.sessionStorage.clear()
  // The hoisted mock is shared module state — restore it so mic-related cases
  // can't inherit mutations from earlier tests.
  getPinnedNotes.mockReset().mockResolvedValue([])
  listChatConversations.mockReset().mockResolvedValue([])
  openConversation.mockClear()
  deleteConversation.mockClear()
  newChat.mockClear()
  listNoteTags.mockReset().mockResolvedValue([])
  audioMemo.available = true
  audioMemo.unavailableReason = null
  audioMemo.toggle.mockReset()
  revealItemInDir.mockClear()
  openRouteInNewWindow.mockReset().mockResolvedValue(true)
  openRecent.mockClear()
  pickAndOpen.mockClear()
  chooseGraph.mockClear()
  openNativeContextMenu.mockClear()
  unpinNote.mockClear()
})

/**
 * The sidebar's Chat and Meetings rails navigate through the live router
 * (like the pinned rows), not the command context — this exposes the routed
 * kind so those clicks can be asserted.
 */
function RouteProbe(): ReactElement {
  const { route } = useRouter()
  return <div data-testid="route-probe">{route.kind}</div>
}

async function renderSidebar(overrides?: Partial<CommandContext>, initialRoute?: Route) {
  const navigate = vi.fn()
  const openPalette = vi.fn()
  const context: CommandContext = {
    navigate,
    route: () => ({ kind: 'today' }),
    notePath: () => null,
    back: vi.fn(),
    forward: vi.fn(),
    clearScrollState: vi.fn(),
    toggleTheme: vi.fn(),
    toggleSidebar: vi.fn(),
    toggleContextSidebar: vi.fn(),
    newChat: vi.fn(() => 'chat-new'),
    openNoteFind: vi.fn(),
    findNextInNote: vi.fn(),
    findPreviousInNote: vi.fn(),
    switchGraph: vi.fn(),
    toggleAudioMemo: vi.fn(),
    generation: () => 1,
    graphRoot: () => '/notes',
    openPalette,
    openShortcuts: vi.fn(),
    openVaultReplace: vi.fn(),
    openTemplatePicker: vi.fn(),
    openTemplateCreate: vi.fn(),
    enableSemanticSearch: vi.fn(),
    summarizeNote: vi.fn(),
    nextTab: vi.fn(),
    previousTab: vi.fn(),
    closeActiveTab: vi.fn(),
    ...overrides,
  }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  // The app constrains the sidebar to its rail width; without it the graph
  // menu's anchor spans the viewport and popper pushes the submenu off-screen.
  const view = await render(
    <div style={{ width: 260, height: 560 }}>
      <TooltipProvider>
        <QueryClientProvider client={client}>
          <UpdateProvider autoCheck={false}>
            <RouterProvider initialRoute={initialRoute}>
              <Sidebar graph={GRAPH} context={context} />
              <RouteProbe />
            </RouterProvider>
          </UpdateProvider>
        </QueryClientProvider>
      </TooltipProvider>
    </div>,
  )
  return { view, navigate, openPalette, context }
}

describe('Sidebar', () => {
  it('lists tags with counts and opens the tag page', async () => {
    listNoteTags.mockResolvedValue([
      { tag: 'book', count: 3 },
      { tag: 'person', count: 1 },
    ])
    const { view } = await renderSidebar()

    const tagRow = view.getByRole('button', { name: /#book\s*3/i })
    await expect.element(tagRow).toBeVisible()
    await expect.element(view.getByRole('button', { name: /#person\s*1/i })).toBeVisible()

    // Navigation happens through the live router: the routed tag is the
    // tag's own page, so its row carries the highlight and the All notes
    // nav row stays quiet.
    await tagRow.click()
    await expect.element(view.getByTestId('route-probe')).toHaveTextContent('allNotes')
    await expect
      .element(view.getByRole('button', { name: /all notes/i }))
      .not.toHaveAttribute('aria-current')
  })

  it('hides the Tags section while the graph has no tags', async () => {
    const { view } = await renderSidebar()
    await vi.waitFor(() => expect(listNoteTags).toHaveBeenCalled())
    expect(view.container.querySelector('[aria-label="Tags"]')).toBeNull()
  })

  it('nav rows navigate, with Daily notes always re-anchoring to today', async () => {
    const { view, navigate } = await renderSidebar(undefined, { kind: 'settings' })

    // The Daily row shares the ⌘D capture command: omitting
    // `restoreSurfaceScroll` makes even an off-surface return discard the
    // stream's saved position and re-anchor on today.
    await view.getByRole('button', { name: /daily notes/i }).click()
    await vi.waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({ kind: 'today' }, { focusEditor: true }),
    )

    await view.getByRole('button', { name: /settings/i }).click()
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith({ kind: 'settings' }))

    await view.getByRole('button', { name: /chat/i }).click()
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith({ kind: 'chat' }))
  })

  it('New note runs its command and shows active while the placeholder note is open', async () => {
    // The route a ⌘N/new-note click lands on: a fresh ULID placeholder path.
    const { view, navigate } = await renderSidebar(undefined, {
      kind: 'note',
      path: untitledNotePath(),
    })
    const newNote = view.getByRole('button', { name: /new note/i })

    // Active like every other row whose route is current — until the birth
    // rename moves the note onto a title slug.
    await expect.element(newNote).toHaveAttribute('aria-current', 'page')

    await newNote.click()
    await vi.waitFor(() =>
      expect(navigate).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'note', path: expect.stringMatching(/^notes\/.+\.md$/) }),
      ),
    )
  })

  it('New note is inactive on slug-named note routes', async () => {
    const { view } = await renderSidebar(undefined, { kind: 'note', path: 'notes/meeting.md' })
    await expect
      .element(view.getByRole('button', { name: /new note/i }))
      .not.toHaveAttribute('aria-current')
  })

  it('All notes stays active while editing a slug-named note', async () => {
    const { view } = await renderSidebar(undefined, { kind: 'note', path: 'notes/meeting.md' })
    await expect
      .element(view.getByRole('button', { name: /all notes/i }))
      .toHaveAttribute('aria-current', 'page')
  })

  it('All notes goes quiet on a routed tag — that is the tag page, not All', async () => {
    const { view } = await renderSidebar(undefined, { kind: 'allNotes', tag: 'book' })
    await expect
      .element(view.getByRole('button', { name: /all notes/i }))
      .not.toHaveAttribute('aria-current')
  })

  it('only "New note" — not "All notes" — lights for the untitled placeholder', async () => {
    // A brand-new note is still an untitled placeholder, so the two rows must
    // never light at once.
    const { view } = await renderSidebar(undefined, { kind: 'note', path: untitledNotePath() })
    await expect
      .element(view.getByRole('button', { name: /new note/i }))
      .toHaveAttribute('aria-current', 'page')
    await expect
      .element(view.getByRole('button', { name: /all notes/i }))
      .not.toHaveAttribute('aria-current')
  })

  it('the search affordance is a lens icon that opens the palette', async () => {
    const { view, openPalette } = await renderSidebar()
    expect(view.getByText('Search anything...').query()).toBeNull()
    await view.getByRole('button', { name: 'Search' }).click()
    expect(openPalette).toHaveBeenCalled()
  })

  it('primary nav icons sit in liquid-glass tiles', async () => {
    const { view } = await renderSidebar()
    const daily = view.getByRole('button', { name: /daily notes/i })
    expect(daily.element().querySelector('.sidebar-icon-slot')).not.toBeNull()
  })

  it('offers Terminal after Graph on desktop', async () => {
    const { view } = await renderSidebar()
    await expect.element(view.getByRole('button', { name: /graph/i })).toBeVisible()
    await expect.element(view.getByRole('button', { name: /terminal/i })).toBeVisible()
  })

  it('the mic button starts an audio memo', async () => {
    const { view } = await renderSidebar()
    await view.getByRole('button', { name: /record audio memo/i }).click()
    expect(audioMemo.toggle).toHaveBeenCalled()
  })

  it('the mic button disables (without vanishing) when no provider can transcribe', async () => {
    audioMemo.available = false
    audioMemo.unavailableReason = 'Add an OpenAI or Gemini model in Settings to record audio memos'
    const { view } = await renderSidebar()
    const micButton = view.getByRole('button', { name: /record audio memo/i })
    await expect.element(micButton).toHaveAttribute('aria-disabled', 'true')
    // `aria-disabled` fails Playwright's enabled actionability check, but the
    // element still receives real clicks — force past the check.
    await micButton.click({ force: true })
    expect(audioMemo.toggle).not.toHaveBeenCalled()
  })

  it('pinned notes render their own section', async () => {
    getPinnedNotes.mockResolvedValue([
      { path: 'notes/roadmap.md', title: 'Roadmap', dailyDate: null },
    ])
    const { view } = await renderSidebar()

    const pinnedSection = view.getByRole('region', { name: /pinned notes/i })
    await expect.element(pinnedSection).toHaveTextContent('Roadmap')
    await expectLocatorToHaveCount(view.getByRole('button', { name: 'Roadmap' }), 1)

    const roadmap = pinnedSection.getByRole('button', { name: 'Roadmap' })
    await expect.element(roadmap).toBeInTheDocument()
    const roadmapPreview = roadmap.element().firstElementChild
    expect(roadmapPreview?.getAttribute('class')).toContain('hover:bg-surface-hover')
    expect(roadmapPreview?.getAttribute('class')).toContain('hover:text-text')
    await roadmap.click()
    await expect.element(roadmap).toHaveAttribute('aria-current', 'page')
  })

  it('modifier-click opens a pinned note in a new window without changing routes', async () => {
    getPinnedNotes.mockResolvedValue([
      { path: 'notes/roadmap.md', title: 'Roadmap', dailyDate: null },
    ])
    const { view } = await renderSidebar()
    const roadmap = view.getByRole('button', { name: 'Roadmap' })

    await roadmap.click({ modifiers: ['ControlOrMeta'] })

    await vi.waitFor(() =>
      expect(openRouteInNewWindow).toHaveBeenCalledWith({
        kind: 'note',
        path: 'notes/roadmap.md',
      }),
    )
    expect(openRouteInNewWindow).toHaveBeenCalledTimes(1)
    await expect.element(roadmap).not.toHaveAttribute('aria-current')
  })

  it('renders wiki links in pinned note titles as display text', async () => {
    getPinnedNotes.mockResolvedValue([
      { path: 'notes/meeting.md', title: 'Meeting with [[Ada Lovelace|Ada]]', dailyDate: null },
    ])
    const { view } = await renderSidebar()

    const pinnedSection = view.getByRole('region', { name: /pinned notes/i })
    await expect.element(pinnedSection).toHaveTextContent('Meeting with Ada')
    expect(pinnedSection.element().textContent).not.toContain('[[Ada Lovelace|Ada]]')
    await expect.element(view.getByRole('button', { name: 'Meeting with Ada' })).toBeInTheDocument()
  })

  it('All notes is inactive while the active note is pinned', async () => {
    getPinnedNotes.mockResolvedValue([
      { path: 'notes/roadmap.md', title: 'Roadmap', dailyDate: null },
    ])
    const { view } = await renderSidebar(undefined, { kind: 'note', path: 'notes/roadmap.md' })

    const roadmap = view.getByRole('button', { name: 'Roadmap' })
    await expect.element(roadmap).toHaveAttribute('aria-current', 'page')
    await expect
      .element(view.getByRole('button', { name: /all notes/i }))
      .not.toHaveAttribute('aria-current')
  })

  it('the pinned section is hidden while nothing is pinned', async () => {
    getPinnedNotes.mockResolvedValue([])
    const { view } = await renderSidebar()
    await vi.waitFor(() => expect(getPinnedNotes).toHaveBeenCalled())
    expect(view.getByRole('region', { name: /pinned notes/i }).query()).toBeNull()
  })

  it('right-click unpins a pinned row through the native context menu', async () => {
    getPinnedNotes.mockResolvedValue([{ path: 'notes/rust.md', title: 'Rust', dailyDate: null }])
    const { view } = await renderSidebar()
    const rust = view.getByRole('button', { name: 'Rust' })

    await rust.click({ button: 'right' })

    await vi.waitFor(() =>
      expect(openNativeContextMenu).toHaveBeenCalledWith({
        items: [
          expect.objectContaining({
            text: 'Unpin Note',
          }),
        ],
      }),
    )
    await expectLocatorToHaveCount(view.getByRole('button', { name: 'Rust' }), 0)
    expect(unpinNote).toHaveBeenCalledWith('notes/rust.md', 1)
  })

  it('restores an optimistically removed pinned row when unpin fails', async () => {
    unpinNote.mockRejectedValueOnce(new Error('disk failed'))
    getPinnedNotes.mockResolvedValue([{ path: 'notes/rust.md', title: 'Rust', dailyDate: null }])
    const { view } = await renderSidebar()
    const rust = view.getByRole('button', { name: 'Rust' })

    await rust.click({ button: 'right' })

    await vi.waitFor(() => expect(unpinNote).toHaveBeenCalledWith('notes/rust.md', 1))
    await expect.element(view.getByRole('button', { name: 'Rust' })).toBeInTheDocument()
  })

  it('the graph footer switches to another recent graph', async () => {
    const { view } = await renderSidebar()

    await view.getByRole('button', { name: /Notes/ }).click()
    const work = page.getByRole('menuitem', { name: 'Work' })
    await expect.element(work).toBeVisible()
    expect(
      [...work.element().querySelectorAll('kbd')].map((keycap) => keycap.textContent),
    ).toContain('2')
    await work.hover()
    await expect.element(page.getByText('iCloud Drive › Kore › Work')).toBeVisible()
    await work.click()
    expect(openRecent).toHaveBeenCalledWith(
      '/Users/mario/Library/Mobile Documents/iCloud~app~lore/Documents/Work',
    )

    await view.getByRole('button', { name: /Notes/ }).click()
    await page.getByRole('menuitem', { name: /open another graph/i }).click()
    expect(chooseGraph).toHaveBeenCalled()
    expect(pickAndOpen).not.toHaveBeenCalled()
  })

  it('the graph footer opens Insights from the graph menu', async () => {
    const { view, navigate } = await renderSidebar()

    await view.getByRole('button', { name: /Notes/ }).click()
    await page.getByRole('menuitem', { name: /insights/i }).click()

    await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith({ kind: 'insights' }))
  })

  it('the graph footer opens user settings from the graph menu', async () => {
    const { view, navigate } = await renderSidebar()

    await view.getByRole('button', { name: /Notes/ }).click()
    await page.getByRole('menuitem', { name: /user settings/i }).click()

    await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith({ kind: 'settings' }))
  })

  it('the graph footer opens the current graph in the system file manager', async () => {
    const { view } = await renderSidebar()

    await view.getByRole('button', { name: /Notes/ }).click()
    await page.getByRole('menuitem', { name: /reveal graph in finder/i }).click()

    expect(revealItemInDir).toHaveBeenCalledWith('/notes')
  })

  it('defaults to the Home rail and switches rails via the top-level rows', async () => {
    const { view } = await renderSidebar()
    await expect.element(view.getByRole('button', { name: /daily notes/i })).toBeVisible()

    await view.getByRole('button', { name: 'Meetings' }).click()
    expect(view.getByRole('button', { name: /daily notes/i }).query()).toBeNull()

    await view.getByRole('button', { name: 'Home' }).click()
    await expect.element(view.getByRole('button', { name: /daily notes/i })).toBeVisible()
  })

  it('picking Chat opens the chat screen alongside its rail', async () => {
    const { view, navigate } = await renderSidebar()

    await view.getByRole('button', { name: /^chat/i }).click()

    await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith({ kind: 'chat' }))
    await expect.element(view.getByRole('button', { name: /new chat/i })).toBeVisible()
    expect(view.getByRole('button', { name: /daily notes/i }).query()).toBeNull()
  })

  it('the Chat rail lists past conversations and opens one into the chat screen', async () => {
    listChatConversations.mockResolvedValue([
      { id: 'active-conversation', title: 'Roadmap questions', createdMs: 1, updatedMs: 2 },
      { id: 'older', title: 'Older chat', createdMs: 1, updatedMs: 1 },
    ])
    const { view } = await renderSidebar()
    await view.getByRole('button', { name: 'Chat' }).click()

    await view.getByRole('button', { name: /^older chat/i }).click()

    await vi.waitFor(() => expect(openConversation).toHaveBeenCalledWith('older'))
    await expect.element(view.getByTestId('route-probe')).toHaveTextContent('chat')
  })

  it('the Chat rail starts a fresh conversation from New chat', async () => {
    const { view } = await renderSidebar()
    await view.getByRole('button', { name: 'Chat' }).click()

    await view.getByRole('button', { name: /new chat/i }).click()

    expect(newChat).toHaveBeenCalled()
    await expect.element(view.getByTestId('route-probe')).toHaveTextContent('chat')
  })

  it('the Chat rail deletes a conversation from its hover affordance', async () => {
    listChatConversations.mockResolvedValue([
      { id: 'older', title: 'Older chat', createdMs: 1, updatedMs: 1 },
    ])
    const { view } = await renderSidebar()
    await view.getByRole('button', { name: 'Chat' }).click()

    await view.getByRole('button', { name: /delete “older chat”/i }).click({ force: true })

    await vi.waitFor(() => expect(deleteConversation).toHaveBeenCalledWith('older'))
  })

  it('the Meetings rail points at Settings while the integration is off', async () => {
    const { view } = await renderSidebar()
    await view.getByRole('button', { name: 'Meetings' }).click()

    await expect.element(view.getByText(/connect your calendar/i)).toBeVisible()
    // Exact case: the graph footer's gear is "Open settings", the rail's
    // call-to-action "Open Settings".
    await view.getByRole('button', { name: 'Open Settings', exact: true }).click()

    await expect.element(view.getByTestId('route-probe')).toHaveTextContent('settings')
  })

  it('the picked rail persists for the session', async () => {
    const { view } = await renderSidebar()
    await view.getByRole('button', { name: 'Meetings' }).click()

    // What the next mount reads back — the round-trip the rail restores from.
    await vi.waitFor(() => expect(readSidebarSurface()).toBe('meetings'))
  })

  it('the graph footer recolors the current graph', async () => {
    const { view } = await renderSidebar()

    await view.getByRole('button', { name: /Notes/ }).click()
    await page.getByRole('menuitem', { name: 'Graph color' }).click()
    await page.getByRole('menuitem', { name: 'Teal' }).click()
    await vi.waitFor(() => expect(updateSettingsWith).toHaveBeenCalled())

    // The patch composes over the latest settings at apply time — feed the
    // updater a document and check the record it builds.
    const updater = updateSettingsWith.mock.lastCall?.[0]
    expect(updater?.(DEFAULT_SETTINGS)).toEqual({ graphColors: { '/notes': 'teal' } })
  })
})
