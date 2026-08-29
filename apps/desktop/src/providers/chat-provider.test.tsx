import { renderHook } from 'vitest-browser-react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import type {
  AiProviderConfig,
  ChatConversation,
  ChatModelSelection,
  ChatStreamEvent,
  ChatTurn,
  GraphInfo,
  Settings,
  StreamChatOptions,
} from '@reflect/core'
import { NO_REPLY_NOTICE } from '@reflect/core'
import { setPlatformSurface } from '@/lib/platform-surface'
import { ChatProvider, useChatSession } from '@/providers/chat-provider'

/**
 * The provider's persistence lifecycle over a fully scripted store: resuming
 * the latest conversation (and not resuming a stale one), the send/settle
 * save pair, conversation switching, and the deleted-conversation guard.
 * The engine (`streamChat`) and the store functions are mocks — the Rust
 * round-trip is covered by the store and `db` tests.
 */

const core = vi.hoisted(() => ({
  streamChat: vi.fn<(options: StreamChatOptions) => AsyncGenerator<ChatStreamEvent>>(),
  streamCliAgentChat:
    vi.fn<(id: string, options: Record<string, unknown>) => AsyncGenerator<ChatStreamEvent>>(),
  listPrivateNotePaths: vi.fn<() => Promise<string[] | null>>(),
  loadAgentContext: vi.fn<(slug: string | null) => Promise<null>>(),
  aiApiKeyForConfig: vi.fn<(config: AiProviderConfig) => Promise<string | null>>(),
  getSecret: vi.fn<(name: string) => Promise<string | null>>(),
  hasBridge: vi.fn<() => boolean>(),
  loadChatGraphContext: vi.fn<(graphName: string) => Promise<null>>(),
  listChatConversations: vi.fn<(limit?: number) => Promise<ChatConversation[]>>(),
  loadChatMessages: vi.fn<(id: string) => Promise<ChatTurn[]>>(),
  saveChatMessage: vi.fn<(input: unknown) => Promise<void>>(),
  deleteChatConversation: vi.fn<(id: string, generation: number) => Promise<void>>(),
}))
vi.mock('@reflect/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@reflect/core')>()),
  ...core,
}))

const settingsState = vi.hoisted(() => ({
  models: [] as AiProviderConfig[],
  defaultId: null as string | null,
  selection: null as ChatModelSelection | null,
  semanticSearchEnabled: false,
  chatSystemPrompt: '',
}))
const updateSettings = vi.hoisted(() => vi.fn<(patch: Partial<Settings>) => void>())
// Stateful like the real provider: a chatModelSelection patch re-renders with
// the new value, so selectModel applies instantly here too.
vi.mock('@/providers/settings-provider', async () => {
  const { useState } = await import('react')
  return {
    useSettings: () => {
      const [selection, setSelection] = useState(settingsState.selection)
      return {
        settings: {
          aiProviders: settingsState.models,
          defaultAiProviderId: settingsState.defaultId,
          chatModelSelection: selection,
          semanticSearchEnabled: settingsState.semanticSearchEnabled,
          chatSystemPrompt: settingsState.chatSystemPrompt,
        },
        updateSettings: (patch: Partial<Settings>) => {
          updateSettings(patch)
          if (patch.chatModelSelection !== undefined) {
            setSelection(patch.chatModelSelection)
          }
        },
      }
    },
  }
})

vi.mock('@/providers/graph-provider', () => ({
  useGraph: () => ({ indexGeneration: 7, graph: { root: '/g' } }),
}))

vi.mock('@/lib/provider-fetch', () => ({ providerFetch: vi.fn() }))

const MODEL: AiProviderConfig = { id: 'm1', provider: 'openai', model: 'gpt-5.4', keyHint: '12345' }

const RESTORED_TURN: ChatTurn = {
  id: 'turn-old',
  userText: 'what did I write yesterday?',
  attachments: [],
  parts: [{ kind: 'text', text: 'Three notes.' }],
  responseMessages: [{ role: 'assistant', content: 'Three notes.' }],
  status: 'done',
}

function conversation(overrides: Partial<ChatConversation> = {}): ChatConversation {
  return {
    id: 'conv-1',
    title: 'what did I write yesterday?',
    createdMs: 1,
    updatedMs: Date.now(),
    ...overrides,
  }
}

let session: ReturnType<typeof useChatSession> | null = null

const GRAPH: GraphInfo = { root: '/g', name: 'test-graph', generation: 1 }

function renderProvider() {
  session = null
  return renderHook(
    () => {
      session = useChatSession()
      return session
    },
    {
      wrapper: ({ children }: { children: ReactNode }) => (
        <ChatProvider graph={GRAPH}>{children}</ChatProvider>
      ),
    },
  )
}

function scriptTurn(events: ChatStreamEvent[]) {
  core.streamChat.mockImplementation(function script() {
    return (async function* () {
      yield* events
    })()
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  settingsState.models = [MODEL]
  settingsState.defaultId = 'm1'
  settingsState.selection = null
  settingsState.semanticSearchEnabled = false
  settingsState.chatSystemPrompt = ''
  core.hasBridge.mockReturnValue(true)
  core.aiApiKeyForConfig.mockResolvedValue('sk-test')
  core.getSecret.mockResolvedValue('sk-test')
  core.loadChatGraphContext.mockResolvedValue(null)
  core.listChatConversations.mockResolvedValue([])
  core.loadChatMessages.mockResolvedValue([RESTORED_TURN])
  core.saveChatMessage.mockResolvedValue(undefined)
  core.deleteChatConversation.mockResolvedValue(undefined)
  core.listPrivateNotePaths.mockResolvedValue([])
  core.loadAgentContext.mockResolvedValue(null)
})

describe('ChatProvider persistence', () => {
  it('resumes the latest conversation when it is fresh enough', async () => {
    core.listChatConversations.mockResolvedValue([conversation()])
    await renderProvider()

    await vi.waitFor(() => expect(session?.turns).toEqual([RESTORED_TURN]))
    expect(session?.activeConversationId).toBe('conv-1')
    expect(core.loadChatMessages).toHaveBeenCalledWith('conv-1')
  })

  it('starts fresh when the latest conversation idled past the cutoff', async () => {
    core.listChatConversations.mockResolvedValue([
      conversation({ updatedMs: Date.now() - 7 * 60 * 60 * 1000 }),
    ])
    await renderProvider()

    await vi.waitFor(() => expect(core.listChatConversations).toHaveBeenCalled())
    expect(core.loadChatMessages).not.toHaveBeenCalled()
    expect(session?.turns).toEqual([])
    expect(session?.activeConversationId).not.toBe('conv-1')
  })

  it('saves the user half at send and the settled turn after the stream', async () => {
    scriptTurn([
      { type: 'text-delta', text: 'Hi.' },
      { type: 'complete', messages: [{ role: 'assistant', content: 'Hi.' }] },
    ])
    const { act } = await renderProvider()
    await vi.waitFor(() => expect(core.listChatConversations).toHaveBeenCalled())

    await act(() => session?.send('hello there'))

    expect(core.saveChatMessage).toHaveBeenCalledTimes(2)
    const first = core.saveChatMessage.mock.calls[0]![0]
    const second = core.saveChatMessage.mock.calls[1]![0]
    expect(first).toMatchObject({
      generation: 7,
      conversation: { id: session?.activeConversationId, title: 'hello there' },
      turn: { userText: 'hello there', responseMessages: [] },
    })
    expect(second).toMatchObject({
      turn: {
        status: 'done',
        responseMessages: [{ role: 'assistant', content: 'Hi.' }],
        parts: [{ kind: 'text', text: 'Hi.' }],
      },
    })
  })

  it('backstops a reply-less turn with a notice, on screen and in the save', async () => {
    // Regression: the forced final step can still yield no text. The provider
    // must fold `complete` so a turn that ends on tool activity shows a notice
    // instead of silent chips — and persists it, not a notice-less parts list.
    scriptTurn([
      { type: 'tool-call', call: { tool: 'read', toolCallId: 't1', paths: ['notes/a.md'] } },
      {
        type: 'tool-result',
        result: {
          tool: 'read',
          toolCallId: 't1',
          notes: [{ path: 'notes/a.md', title: 'A', error: null }],
        },
      },
      { type: 'complete', messages: [{ role: 'assistant', content: 'noop' }] },
    ])
    const { act } = await renderProvider()
    await vi.waitFor(() => expect(core.listChatConversations).toHaveBeenCalled())

    await act(() => session?.send('summarize my notes'))

    const notice = { kind: 'notice', tone: 'info', text: NO_REPLY_NOTICE }
    expect(session?.turns.at(-1)?.parts.at(-1)).toEqual(notice)
    const saved = core.saveChatMessage.mock.calls.at(-1)![0] as { turn: ChatTurn }
    expect(saved.turn.parts.at(-1)).toEqual(notice)
  })

  it('saves later turns into the restored conversation', async () => {
    core.listChatConversations.mockResolvedValue([conversation()])
    scriptTurn([{ type: 'complete', messages: [{ role: 'assistant', content: 'More.' }] }])
    const { act } = await renderProvider()
    await vi.waitFor(() => expect(session?.turns).toHaveLength(1))

    await act(() => session?.send('and today?'))

    expect(core.saveChatMessage.mock.calls[0]![0]).toMatchObject({
      conversation: { id: 'conv-1', title: 'what did I write yesterday?' },
      turn: { userText: 'and today?' },
    })
  })

  it('passes the semantic search setting into chat turns', async () => {
    settingsState.semanticSearchEnabled = true
    scriptTurn([{ type: 'complete', messages: [{ role: 'assistant', content: 'Hi.' }] }])
    const { act } = await renderProvider()
    await vi.waitFor(() => expect(core.listChatConversations).toHaveBeenCalled())

    await act(() => session?.send('hello'))

    expect(core.streamChat).toHaveBeenCalledWith(
      expect.objectContaining({ semanticSearchEnabled: true }),
    )
  })

  it('passes the latest configured system prompt into the next chat turn', async () => {
    const { act, rerender } = await renderProvider()
    await vi.waitFor(() => expect(core.listChatConversations).toHaveBeenCalled())
    settingsState.chatSystemPrompt = 'Answer like a rigorous research partner.'
    await rerender()
    scriptTurn([{ type: 'complete', messages: [{ role: 'assistant', content: 'Hi.' }] }])

    await act(() => session?.send('hello'))

    expect(core.streamChat).toHaveBeenCalledWith(
      expect.objectContaining({
        customSystemPrompt: 'Answer like a rigorous research partner.',
      }),
    )
  })

  it('forces lexical search on the mobile surface, over an enabled setting', async () => {
    settingsState.semanticSearchEnabled = true
    setPlatformSurface({ mobileApp: true })
    try {
      scriptTurn([{ type: 'complete', messages: [{ role: 'assistant', content: 'Hi.' }] }])
      const { act } = await renderProvider()
      await vi.waitFor(() => expect(core.listChatConversations).toHaveBeenCalled())

      await act(() => session?.send('hello'))

      expect(core.streamChat).toHaveBeenCalledWith(
        expect.objectContaining({ semanticSearchEnabled: false }),
      )
    } finally {
      setPlatformSurface({ mobileApp: false })
    }
  })

  it('holds the composer draft and clears it when a send goes through', async () => {
    scriptTurn([{ type: 'complete', messages: [{ role: 'assistant', content: 'Hi.' }] }])
    const { act } = await renderProvider()
    await vi.waitFor(() => expect(core.listChatConversations).toHaveBeenCalled())

    await act(() => session?.setDraft('half-typed question'))
    expect(session?.draft).toBe('half-typed question')

    await act(() => session?.send('half-typed question'))
    expect(session?.draft).toBe('')
    expect(session?.turns.at(-1)?.userText).toBe('half-typed question')
  })

  it('opens a past conversation and switches the active id', async () => {
    const { act } = await renderProvider()
    await vi.waitFor(() => expect(core.listChatConversations).toHaveBeenCalled())

    await act(() => session?.openConversation('conv-9'))

    expect(core.loadChatMessages).toHaveBeenCalledWith('conv-9')
    expect(session?.activeConversationId).toBe('conv-9')
    expect(session?.turns).toEqual([RESTORED_TURN])
  })

  it('abandons a switch when a send settled while the rows loaded', async () => {
    // The send both starts AND finishes during the load — the in-flight slot
    // is already clear when the rows arrive, but the switch must still be
    // abandoned: swapping the transcript would hide the turn the user just
    // streamed into the on-screen conversation.
    let releaseLoad: (turns: ChatTurn[]) => void = () => {}
    core.loadChatMessages.mockImplementation(
      () =>
        new Promise<ChatTurn[]>((resolve) => {
          releaseLoad = resolve
        }),
    )
    scriptTurn([{ type: 'complete', messages: [{ role: 'assistant', content: 'Hi.' }] }])
    const { act } = await renderProvider()
    await vi.waitFor(() => expect(core.listChatConversations).toHaveBeenCalled())
    const homeConversation = session?.activeConversationId

    let openDone: Promise<void> | undefined
    await act(async () => {
      openDone = session?.openConversation('conv-9')
      await Promise.resolve()
    })
    await act(() => session?.send('hello'))
    expect(session?.turns.at(-1)?.status).toBe('done')

    releaseLoad([RESTORED_TURN])
    await act(async () => {
      await openDone
    })

    expect(session?.activeConversationId).toBe(homeConversation)
    expect(session?.turns.map((turn) => turn.userText)).toEqual(['hello'])
  })

  it('deleting the active conversation starts a fresh chat', async () => {
    core.listChatConversations.mockResolvedValue([conversation()])
    const { act } = await renderProvider()
    await vi.waitFor(() => expect(session?.activeConversationId).toBe('conv-1'))

    await act(() => session?.deleteConversation('conv-1'))

    expect(core.deleteChatConversation).toHaveBeenCalledWith('conv-1', 7)
    expect(session?.turns).toEqual([])
    expect(session?.activeConversationId).not.toBe('conv-1')
  })

  it('never saves into a conversation deleted mid-stream', async () => {
    let releaseStream: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      releaseStream = resolve
    })
    core.streamChat.mockImplementation(function script() {
      return (async function* () {
        yield { type: 'text-delta', text: 'Half…' } satisfies ChatStreamEvent
        await gate
        yield {
          type: 'complete',
          messages: [{ role: 'assistant', content: 'Done.' }],
        } satisfies ChatStreamEvent
      })()
    })
    const { act } = await renderProvider()
    await vi.waitFor(() => expect(core.listChatConversations).toHaveBeenCalled())

    let sendDone: Promise<void> | undefined
    await act(async () => {
      sendDone = session?.send('hello')
      await Promise.resolve()
    })
    const sentInto = core.saveChatMessage.mock.calls[0]![0] as { conversation: { id: string } }

    // Delete the conversation while the turn is streaming, then let it settle:
    // the settle-time save must not resurrect the deleted row.
    await act(() => session?.deleteConversation(sentInto.conversation.id))
    releaseStream()
    await act(async () => {
      await sendDone
    })

    expect(core.saveChatMessage).toHaveBeenCalledTimes(1)
  })

  it('lets an in-flight save land before deleting its conversation', async () => {
    // The delete and a dispatched save are independent IPC commands with no
    // ordering guarantee — the provider must hold the delete until the
    // conversation's save chain settles, or the upsert could resurrect it.
    let releaseSave: () => void = () => {}
    core.saveChatMessage.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          releaseSave = resolve
        }),
    )
    scriptTurn([{ type: 'complete', messages: [{ role: 'assistant', content: 'Hi.' }] }])
    const { act } = await renderProvider()
    await vi.waitFor(() => expect(core.listChatConversations).toHaveBeenCalled())

    await act(() => session?.send('hello'))
    const sentInto = core.saveChatMessage.mock.calls[0]![0] as { conversation: { id: string } }

    let deleteDone: Promise<void> | undefined
    await act(async () => {
      deleteDone = session?.deleteConversation(sentInto.conversation.id)
      await Promise.resolve()
    })
    expect(core.deleteChatConversation).not.toHaveBeenCalled()

    releaseSave()
    await act(async () => {
      await deleteDone
    })
    expect(core.deleteChatConversation).toHaveBeenCalledWith(sentInto.conversation.id, 7)
  })
})

describe('ChatProvider message queue', () => {
  function gatedFirstTurn() {
    // The first turn streams until released; later turns settle instantly.
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let first = true
    core.streamChat.mockImplementation(function script() {
      const held = first
      first = false
      return (async function* () {
        if (held) {
          await gate
        }
        yield {
          type: 'complete',
          messages: [{ role: 'assistant', content: 'Done.' }],
        } satisfies ChatStreamEvent
      })()
    })
    return () => release()
  }

  it('queues a message sent mid-stream and drains it when the turn settles', async () => {
    const release = gatedFirstTurn()
    const { act } = await renderProvider()
    await vi.waitFor(() => expect(core.listChatConversations).toHaveBeenCalled())

    let firstDone: Promise<void> | undefined
    await act(async () => {
      firstDone = session?.send('first question')
      await Promise.resolve()
    })
    await act(() => session?.send('second question'))

    // Not dropped, not streamed — parked, with the composer cleared.
    expect(session?.queued.map((entry) => entry.text)).toEqual(['second question'])
    expect(session?.turns.map((turn) => turn.userText)).toEqual(['first question'])
    expect(core.streamChat).toHaveBeenCalledTimes(1)

    release()
    await act(async () => {
      await firstDone
    })

    await vi.waitFor(() => {
      expect(session?.turns.map((turn) => turn.userText)).toEqual([
        'first question',
        'second question',
      ])
      expect(session?.turns.at(-1)?.status).toBe('done')
    })
    expect(session?.queued).toEqual([])
    expect(core.streamChat).toHaveBeenCalledTimes(2)
  })

  it('parks the queue on Stop, then a card sends by hand', async () => {
    const release = gatedFirstTurn()
    const { act } = await renderProvider()
    await vi.waitFor(() => expect(core.listChatConversations).toHaveBeenCalled())

    let firstDone: Promise<void> | undefined
    await act(async () => {
      firstDone = session?.send('first question')
      await Promise.resolve()
    })
    await act(() => session?.send('second question'))
    await act(() => session?.stop())
    release()
    await act(async () => {
      await firstDone
    })

    // An aborted turn never auto-drains — the message waits as a card.
    expect(core.streamChat).toHaveBeenCalledTimes(1)
    expect(session?.queued.map((entry) => entry.text)).toEqual(['second question'])

    const queuedId = session?.queued[0]?.id ?? ''
    await act(() => session?.sendQueuedNow(queuedId))

    expect(session?.queued).toEqual([])
    expect(core.streamChat).toHaveBeenCalledTimes(2)
    expect(session?.turns.map((turn) => turn.userText)).toEqual([
      'first question',
      'second question',
    ])
  })

  it('discards a card on demand and clears the queue on New chat', async () => {
    const release = gatedFirstTurn()
    const { act } = await renderProvider()
    await vi.waitFor(() => expect(core.listChatConversations).toHaveBeenCalled())

    let firstDone: Promise<void> | undefined
    await act(async () => {
      firstDone = session?.send('first question')
      await Promise.resolve()
    })
    await act(() => session?.send('second question'))
    await act(() => session?.send('third question'))
    expect(session?.queued).toHaveLength(2)

    const secondId = session?.queued[0]?.id ?? ''
    await act(() => session?.removeQueued(secondId))
    expect(session?.queued.map((entry) => entry.text)).toEqual(['third question'])

    let newConversationId: string | undefined
    await act(() => {
      newConversationId = session?.newChat()
    })
    expect(session?.queued).toEqual([])
    expect(newConversationId).toBe(session?.activeConversationId)

    // The detached turn settles into a changed session: still no drain.
    release()
    await act(async () => {
      await firstDone
    })
    expect(core.streamChat).toHaveBeenCalledTimes(1)
  })
})

describe('ChatProvider mid-turn steering', () => {
  const CLAUDE: AiProviderConfig = {
    id: 'c1',
    provider: 'claude-cli',
    model: 'default',
    keyHint: '',
  }

  /**
   * A CLI turn that hands out its steer function and only settles when the
   * test says so — the shape `streamAgentCliTurn` gives an inject engine.
   */
  function scriptSteerableTurn() {
    const state = {
      steers: [] as string[],
      release: () => {},
      /** Set to reject, mimicking a run that no longer accepts input. */
      refuse: false,
    }
    core.streamCliAgentChat.mockImplementation((_id, options) => {
      const steering = options['steering'] as
        | { onSteerReady: (steer: (text: string) => Promise<void>) => void }
        | undefined
      steering?.onSteerReady(async (text: string) => {
        if (state.refuse) {
          throw new Error('the run is no longer accepting input')
        }
        state.steers.push(text)
      })
      return (async function* (): AsyncGenerator<ChatStreamEvent> {
        yield { type: 'text-delta', text: 'Working…' }
        await new Promise<void>((resolve) => {
          state.release = resolve
        })
        yield { type: 'complete', messages: [{ role: 'assistant', content: 'Done.' }] }
      })()
    })
    return state
  }

  it('injects into the live turn instead of queueing, and shows it in the transcript', async () => {
    settingsState.models = [CLAUDE]
    settingsState.defaultId = 'c1'
    const cli = scriptSteerableTurn()
    const { act } = await renderProvider()
    await vi.waitFor(() => expect(core.listChatConversations).toHaveBeenCalled())

    let sendDone: Promise<void> | undefined
    await act(async () => {
      sendDone = session?.send('start the work')
      await Promise.resolve()
    })
    await vi.waitFor(() => expect(core.streamCliAgentChat).toHaveBeenCalled())

    await act(() => session?.steer('actually, do it differently'))

    // Delivered into the running process — not queued, no second run.
    expect(cli.steers).toEqual(['actually, do it differently'])
    expect(session?.queued).toEqual([])
    expect(core.streamCliAgentChat).toHaveBeenCalledTimes(1)
    // And visible in the turn, where the reply splits around it.
    expect(session?.turns.at(-1)?.parts).toContainEqual({
      kind: 'steer',
      text: 'actually, do it differently',
    })

    cli.release()
    await act(async () => {
      await sendDone
    })
    expect(session?.turns.at(-1)?.status).toBe('done')
  })

  it('falls back to the queue when the run refuses the steer', async () => {
    settingsState.models = [CLAUDE]
    settingsState.defaultId = 'c1'
    const cli = scriptSteerableTurn()
    const { act } = await renderProvider()
    await vi.waitFor(() => expect(core.listChatConversations).toHaveBeenCalled())

    let sendDone: Promise<void> | undefined
    await act(async () => {
      sendDone = session?.send('start the work')
      await Promise.resolve()
    })
    await vi.waitFor(() => expect(core.streamCliAgentChat).toHaveBeenCalled())

    // The run settled or stopped between the check and the write.
    cli.refuse = true
    await act(() => session?.steer('too late for this one'))

    expect(cli.steers).toEqual([])
    expect(session?.queued.map((entry) => entry.text)).toEqual(['too late for this one'])
    expect(session?.turns.at(-1)?.parts).not.toContainEqual({
      kind: 'steer',
      text: 'too late for this one',
    })

    cli.release()
    await act(async () => {
      await sendDone
    })
  })
})

describe('ChatProvider model selection', () => {
  it('starts on the persisted model selection', async () => {
    settingsState.selection = { configId: 'm1', modelId: 'gpt-5.5' }
    await renderProvider()
    await vi.waitFor(() => expect(core.listChatConversations).toHaveBeenCalled())

    expect(session?.activeModel).toEqual({ ...MODEL, model: 'gpt-5.5' })
  })

  it('persists a picked model and applies it to the session', async () => {
    const { act } = await renderProvider()
    await vi.waitFor(() => expect(core.listChatConversations).toHaveBeenCalled())
    expect(session?.activeModel).toEqual(MODEL)

    await act(() => session?.selectModel({ configId: 'm1', modelId: 'gpt-5.5' }))

    expect(updateSettings).toHaveBeenCalledWith({
      chatModelSelection: { configId: 'm1', modelId: 'gpt-5.5' },
    })
    expect(session?.activeModel).toEqual({ ...MODEL, model: 'gpt-5.5' })
  })

  it('falls back to the default model when the persisted selection dangles', async () => {
    settingsState.selection = { configId: 'gone', modelId: 'gpt-5.5' }
    await renderProvider()
    await vi.waitFor(() => expect(core.listChatConversations).toHaveBeenCalled())

    expect(session?.activeModel).toEqual(MODEL)
  })
})

describe('ChatProvider private-note deny list', () => {
  const CLAUDE: AiProviderConfig = {
    id: 'c1',
    provider: 'claude-cli',
    model: 'default',
    keyHint: '',
  }

  it('refuses a CLI turn when the index cannot say which notes are private', async () => {
    settingsState.models = [CLAUDE]
    settingsState.defaultId = 'c1'
    // `null` is the rebuild window: the projection is wiped and refilling, so
    // an empty list would be a partial answer wearing a complete answer's
    // shape. The run must not start.
    core.listPrivateNotePaths.mockResolvedValue(null)
    const { act } = await renderProvider()
    await vi.waitFor(() => expect(core.listChatConversations).toHaveBeenCalled())

    await act(async () => {
      await session?.send('summarise my week')
    })

    expect(core.streamCliAgentChat).not.toHaveBeenCalled()
    expect(session?.turns.at(-1)?.parts).toContainEqual({
      kind: 'notice',
      tone: 'error',
      text: 'Couldn’t confirm which notes are private, so this run was refused. If the index is still building, try again in a moment.',
    })
  })

  it('starts the run and forwards the deny list once the index can answer', async () => {
    settingsState.models = [CLAUDE]
    settingsState.defaultId = 'c1'
    core.listPrivateNotePaths.mockResolvedValue(['notes/diary.md'])
    core.streamCliAgentChat.mockImplementation(() =>
      (async function* (): AsyncGenerator<ChatStreamEvent> {
        yield { type: 'complete', messages: [{ role: 'assistant', content: 'Done.' }] }
      })(),
    )
    const { act } = await renderProvider()
    await vi.waitFor(() => expect(core.listChatConversations).toHaveBeenCalled())

    await act(async () => {
      await session?.send('summarise my week')
    })

    expect(core.streamCliAgentChat).toHaveBeenCalledTimes(1)
    expect(core.streamCliAgentChat.mock.lastCall?.[1]['privateNotePaths']).toEqual([
      'notes/diary.md',
    ])
  })

  it('runs on a clean vault, where an empty list is a complete answer', async () => {
    settingsState.models = [CLAUDE]
    settingsState.defaultId = 'c1'
    core.listPrivateNotePaths.mockResolvedValue([])
    core.streamCliAgentChat.mockImplementation(() =>
      (async function* (): AsyncGenerator<ChatStreamEvent> {
        yield { type: 'complete', messages: [{ role: 'assistant', content: 'Done.' }] }
      })(),
    )
    const { act } = await renderProvider()
    await vi.waitFor(() => expect(core.listChatConversations).toHaveBeenCalled())

    await act(async () => {
      await session?.send('summarise my week')
    })

    expect(core.streamCliAgentChat).toHaveBeenCalledTimes(1)
  })
})
