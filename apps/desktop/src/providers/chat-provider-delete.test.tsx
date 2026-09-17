import { renderHook } from 'vitest-browser-react'
import { beforeEach, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import type { ChatTurn, GraphInfo } from '@reflect/core'
import { ChatProvider, useChatSession } from './chat-provider'

const mocks = vi.hoisted(() => ({
  deleteChatConversation: vi.fn<(id: string, generation: number) => Promise<void>>(),
  deleteChatAttachmentFiles: vi.fn<() => Promise<void>>(),
  saveChatMessage: vi.fn<() => Promise<void>>(),
  loadChatMessages: vi.fn<() => Promise<ChatTurn[]>>(),
  emitDeleted: vi.fn(),
  invalidate: vi.fn(),
  toast: vi.fn(),
}))

vi.mock('@reflect/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@reflect/core')>()),
  hasBridge: () => true,
  listChatConversations: async () => [
    { id: 'conv-1', title: 'A saved chat', createdMs: 1, updatedMs: Date.now() },
  ],
  loadChatMessages: mocks.loadChatMessages,
  deleteChatConversation: mocks.deleteChatConversation,
  deleteChatAttachmentFiles: mocks.deleteChatAttachmentFiles,
  saveChatMessage: mocks.saveChatMessage,
}))
vi.mock('@/providers/graph-provider', () => ({
  useGraph: () => ({ indexGeneration: 7, graph: { root: '/g' } }),
}))
vi.mock('@/providers/settings-provider', () => ({
  useSettings: () => ({
    settings: { aiProviders: [], defaultAiProviderId: null, chatModelSelection: null },
    updateSettings: vi.fn(),
  }),
}))
vi.mock('@/lib/platform', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/platform')>()),
  isNativeShell: () => true,
}))
vi.mock('@/lib/chat-events', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/chat-events')>()),
  emitChatConversationDeleted: mocks.emitDeleted,
}))
vi.mock('@/lib/query-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/query-client')>()),
  invalidateChatQueries: mocks.invalidate,
}))
vi.mock('@/components/ui/toast', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/ui/toast')>()),
  toast: { add: mocks.toast },
}))

const GRAPH: GraphInfo = { root: '/g', name: 'test', generation: 1 }
const TURN: ChatTurn = {
  id: 'turn-1',
  userText: 'Edit this note',
  attachments: [
    { id: 'image', name: 'image.png', mediaType: 'image/png', path: '.reflect/chat-attachments/conv-1/image.png' },
  ],
  parts: [{
    kind: 'tool',
    call: { tool: 'editNote', toolCallId: 'proposal', path: 'notes/test.md' },
    result: {
      tool: 'editNote', toolCallId: 'proposal', path: 'notes/test.md',
      oldText: 'before', newText: 'after', error: null, decision: 'pending',
    },
    error: null,
  }],
  responseMessages: [],
  status: 'done',
}
let session: ReturnType<typeof useChatSession> | null = null

beforeEach(() => {
  vi.clearAllMocks()
  mocks.loadChatMessages.mockResolvedValue([TURN])
  mocks.saveChatMessage.mockResolvedValue(undefined)
  mocks.deleteChatConversation.mockResolvedValue(undefined)
  mocks.deleteChatAttachmentFiles.mockResolvedValue(undefined)
})

async function mount() {
  session = null
  const rendered = await renderHook(() => {
    session = useChatSession()
    return session
  }, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <ChatProvider graph={GRAPH}>{children}</ChatProvider>
    ),
  })
  await vi.waitFor(() => expect(session?.activeConversationId).toBe('conv-1'))
  return rendered
}

it('keeps files and queued saves after a failed delete and allows retry', async () => {
  const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
  let rejectDelete: (error: Error) => void = () => {}
  mocks.deleteChatConversation.mockImplementationOnce(() => new Promise((_, reject) => {
    rejectDelete = reject
  }))
  const { act } = await mount()
  let deleting: Promise<void> | undefined
  await act(async () => {
    deleting = session?.deleteConversation('conv-1')
    await Promise.resolve()
  })
  await vi.waitFor(() => expect(mocks.deleteChatConversation).toHaveBeenCalledTimes(1))
  // A review decision persists through the real persistChatTurn path while
  // deletion owns the same conversation's queue.
  await act(() => session?.bindNoteEditDecision('proposal')?.('accepted'))
  expect(mocks.saveChatMessage).not.toHaveBeenCalled()
  await act(async () => {
    rejectDelete(new Error('database is busy'))
    await deleting
  })
  await vi.waitFor(() => expect(mocks.saveChatMessage).toHaveBeenCalledTimes(1))
  expect(session?.activeConversationId).toBe('conv-1')
  expect(session?.turns[0]?.attachments).toEqual(TURN.attachments)
  expect(mocks.deleteChatAttachmentFiles).not.toHaveBeenCalled()
  expect(mocks.emitDeleted).not.toHaveBeenCalled()
  expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }))
  expect(errorLog).toHaveBeenCalledTimes(1)
  errorLog.mockRestore()
  await act(() => session?.deleteConversation('conv-1'))
  expect(mocks.deleteChatAttachmentFiles).toHaveBeenCalledTimes(1)
  expect(mocks.emitDeleted).toHaveBeenCalledWith('conv-1')
  expect(session?.activeConversationId).not.toBe('conv-1')
})

it('does not let a queued save resurrect a successfully deleted conversation', async () => {
  let finishDelete: () => void = () => {}
  mocks.deleteChatConversation.mockImplementationOnce(() => new Promise((resolve) => {
    finishDelete = resolve
  }))
  const { act } = await mount()
  let deleting: Promise<void> | undefined
  await act(async () => {
    deleting = session?.deleteConversation('conv-1')
    await Promise.resolve()
  })
  await vi.waitFor(() => expect(mocks.deleteChatConversation).toHaveBeenCalledTimes(1))
  await act(() => session?.bindNoteEditDecision('proposal')?.('accepted'))
  await act(async () => {
    finishDelete()
    await deleting
  })
  expect(mocks.saveChatMessage).not.toHaveBeenCalled()
  expect(mocks.deleteChatAttachmentFiles).toHaveBeenCalledTimes(1)
  expect(mocks.emitDeleted).toHaveBeenCalledWith('conv-1')
  expect(session?.turns).toEqual([])
})
