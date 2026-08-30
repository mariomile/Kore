import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react'
import {
  chatModelOptions,
  deleteChatConversation,
  errorMessage,
  hasBridge,
  loadChatMessages,
  resolveChatModel,
  type AiProviderConfig,
  type ChatConversation,
  type ChatModelSelection,
  type ChatTurn,
  type GraphInfo,
} from '@reflect/core'
import { useBridgeReady } from '@/hooks/use-bridge-ready'
import { toChatAttachment, type ChatAttachment } from '@/lib/chat-attachments'
import { emitChatConversationDeleted } from '@/lib/chat-events'
import { isMobileSurface } from '@/lib/platform-surface'
import { invalidateChatQueries } from '@/lib/query-client'
import {
  ChatContext,
  type ChatContextValue,
  type ChatStatus,
  type QueuedChatMessage,
} from '@/providers/chat-context'
import {
  deliverChatTurn,
  persistChatTurn,
  type ActiveSend,
} from '@/providers/chat-provider-deliver'
import { useGraph } from '@/providers/graph-provider'
import { useSettings } from '@/providers/settings-provider'
import { useChatConversationRestore } from '@/providers/use-chat-conversation-restore'

/**
 * One chat session per open graph (Plan 10): the conversation lives here, not
 * in the screen, so navigating away and back keeps it. The state is just
 * {@link ChatTurn}s — what each turn renders and what it contributed to the
 * model history are one record, and the history a new turn resends is derived
 * from them.
 *
 * Conversations persist to the graph's index DB (`@reflect/core`'s chat
 * store): each turn is saved when sent (the user half) and again when it
 * settles, so a relaunch restores the conversation exactly. On mount the
 * latest conversation is resumed unless it has been idle past
 * {@link CHAT_IDLE_CUTOFF_MS} — then a fresh one starts and the old one stays
 * in the history. Persistence is best-effort: a failed save logs and the
 * in-memory conversation carries on.
 */

export { useChatSession, useOptionalChatSession, type ChatStatus } from '@/providers/chat-context'

interface ChatProviderProps {
  /** The open graph — names the prompt's overview block. */
  graph: GraphInfo
  children: ReactNode
}

export function ChatProvider({ graph, children }: ChatProviderProps): ReactElement {
  const { settings, updateSettings } = useSettings()
  const { indexGeneration } = useGraph()
  const bridgeReady = useBridgeReady()
  const [turns, setTurns] = useState<ChatTurn[]>([])
  const [draft, setDraft] = useState('')
  const [attachments, setAttachments] = useState<ChatAttachment[]>([])
  const [conversationId, setConversationId] = useState<string>(() => crypto.randomUUID())
  // Extra instructions for THIS conversation, layered on the global system
  // prompt. Session state by design: the chat store's schema stays untouched,
  // and a restored conversation starts from the global prompt alone.
  const [instructions, setInstructions] = useState('')
  // Whether THIS conversation may use the configured MCP servers in read-only
  // chat. Session state like `instructions` by design: never persisted, reset
  // by New chat and by opening a past conversation, so tools are re-armed
  // only by an explicit user action each time.
  const [chatTools, setChatTools] = useState(false)
  // Messages composed while a turn streams, waiting to ride after it. Ref
  // and state move together through `setQueue`: the auto-drain fires from a
  // stream's `finally`, which can run before React has re-rendered state.
  const queuedRef = useRef<QueuedChatMessage[]>([])
  const [queued, setQueued] = useState<QueuedChatMessage[]>([])
  const setQueue = useCallback((next: QueuedChatMessage[]) => {
    queuedRef.current = next
    setQueued(next)
  }, [])

  const status: ChatStatus = turns.at(-1)?.status === 'streaming' ? 'streaming' : 'idle'

  const providers = settings.aiProviders
  const modelOptions = useMemo(() => chatModelOptions(providers), [providers])
  // The picker's choice lives in the settings document, not session state, so
  // the model used last is the one the next session starts on.
  const activeModel = resolveChatModel(
    { providers, defaultProviderId: settings.defaultAiProviderId },
    settings.chatModelSelection,
  )

  // Read at call time, not captured: send() can fire long after the render
  // that created it.
  const turnsRef = useRef(turns)
  const attachmentsRef = useRef(attachments)
  const activeModelRef = useRef<AiProviderConfig | null>(activeModel)
  const conversationIdRef = useRef(conversationId)
  const generationRef = useRef<number | null>(indexGeneration)
  // Semantic search never runs on the mobile surface — the embed runtime is
  // desktop-only (Plan 23, contract 3) — and the tool must *say* it is
  // lexical, not lean on hybrid's degrade-on-error to absorb the missing
  // runtime. The settings document syncs no further than the device, but a
  // stray enabled flag must still lose to the platform here.
  const semanticSearchEnabled = settings.semanticSearchEnabled && !isMobileSurface()
  const semanticSearchEnabledRef = useRef(semanticSearchEnabled)
  const chatSystemPromptRef = useRef(settings.chatSystemPrompt)
  const chatAllowEditsRef = useRef(settings.chatAllowEdits)
  const activeAgentProfileRef = useRef(settings.activeAgentProfile)
  const memoryWriteApprovalRef = useRef(settings.memoryWriteApproval)
  const mcpServersRef = useRef(settings.mcpServers)
  const instructionsRef = useRef(instructions)
  const chatToolsRef = useRef(chatTools)
  useEffect(() => {
    turnsRef.current = turns
    attachmentsRef.current = attachments
    activeModelRef.current = activeModel
    conversationIdRef.current = conversationId
    generationRef.current = indexGeneration
    semanticSearchEnabledRef.current = semanticSearchEnabled
    chatSystemPromptRef.current = settings.chatSystemPrompt
    chatAllowEditsRef.current = settings.chatAllowEdits
    activeAgentProfileRef.current = settings.activeAgentProfile
    memoryWriteApprovalRef.current = settings.memoryWriteApproval
    mcpServersRef.current = settings.mcpServers
    instructionsRef.current = instructions
    chatToolsRef.current = chatTools
  })

  // The in-flight send, tracked synchronously — the no-concurrent-sends
  // guard can't ride on rendered state, which only reflects a send after
  // the next render. `session` ties a send to its conversation: New chat
  // bumps the counter, so a detached send winding down no longer counts as
  // "this conversation is busy" and never clears a successor's slot.
  const sessionRef = useRef(0)
  const activeSendRef = useRef<ActiveSend | null>(null)
  // The session of the most recent send — unlike `activeSendRef` this is not
  // cleared when the turn settles, so a pending conversation switch can tell
  // that the on-screen conversation received a message even after the stream
  // finished.
  const lastSendSessionRef = useRef(-1)

  // Conversations deleted this session: a settle-time save landing after its
  // conversation was deleted would re-create the row via the upsert.
  const deletedConversationsRef = useRef(new Set<string>())
  // The tail of each conversation's save chain. Saves are serialized per
  // conversation so a delete can wait for in-flight saves to land first —
  // two independent IPC commands carry no ordering guarantee in Rust.
  const pendingSavesRef = useRef(new Map<string, Promise<void>>())

  // The workspace tree is keyed by graph root, so switching graphs unmounts
  // this provider — an in-flight turn must die with it, or its tools would
  // keep reading whichever graph Rust has open *now* and ship that content
  // to the provider under the old conversation.
  useEffect(() => {
    return () => {
      activeSendRef.current?.controller.abort()
    }
  }, [])

  // Persist one turn into its conversation, best-effort — see persistChatTurn.
  const persistTurn = useCallback(
    (conversation: ChatConversation, turn: ChatTurn, createdMs: number) => {
      persistChatTurn(
        { generationRef, deletedConversationsRef, pendingSavesRef },
        conversation,
        turn,
        createdMs,
      )
    },
    [],
  )

  useChatConversationRestore({
    bridgeReady,
    indexGeneration,
    sessionRef,
    turnsRef,
    setConversationId,
    setTurns,
  })

  // Self-reference for the auto-drain: `deliver`'s finally hands the next
  // queued message back to `deliver` itself, which a useCallback closure
  // can't name directly.
  const deliverRef = useRef<((text: string, attached: ChatAttachment[]) => Promise<void>) | null>(
    null,
  )

  /** Run one user message as a streaming turn. Callers guard the busy slot. */
  const deliver = useCallback(
    (trimmed: string, attached: ChatAttachment[]): Promise<void> =>
      deliverChatTurn(
        {
          graph,
          activeModelRef,
          activeSendRef,
          sessionRef,
          lastSendSessionRef,
          turnsRef,
          conversationIdRef,
          instructionsRef,
          chatSystemPromptRef,
          chatAllowEditsRef,
          chatToolsRef,
          activeAgentProfileRef,
          memoryWriteApprovalRef,
          mcpServersRef,
          semanticSearchEnabledRef,
          queuedRef,
          deliverRef,
          setTurns,
          setQueue,
          persistTurn,
        },
        trimmed,
        attached,
      ),
    [graph.name, persistTurn, setQueue],
  )
  useEffect(() => {
    deliverRef.current = deliver
  }, [deliver])

  const send = useCallback(
    async (text: string): Promise<void> => {
      const trimmed = text.trim()
      const attached = attachmentsRef.current
      if ((trimmed === '' && attached.length === 0) || activeModelRef.current === null) {
        return
      }
      // The composer clears on both paths — an enqueued message has left
      // the textarea just as surely as a delivered one.
      setDraft('')
      setAttachments([])
      if (activeSendRef.current?.session === sessionRef.current) {
        // A turn is streaming: queue instead of silently dropping the
        // message. It rides when the turn settles (or via its card).
        setQueue([
          ...queuedRef.current,
          { id: crypto.randomUUID(), text: trimmed, attachments: attached },
        ])
        return
      }
      await deliver(trimmed, attached)
    },
    [deliver, setQueue],
  )

  const steer = useCallback(
    async (text: string): Promise<void> => {
      const trimmed = text.trim()
      if (trimmed === '') {
        return
      }
      const active = activeSendRef.current
      if (active !== null && active.session === sessionRef.current && active.steer !== undefined) {
        setDraft('')
        try {
          await active.steer(trimmed)
          return
        } catch {
          // The run settled or stopped between the check and the write —
          // fall through: the message queues like any busy-time send.
        }
      }
      await send(trimmed)
    },
    [send],
  )

  const removeQueued = useCallback(
    (id: string) => {
      setQueue(queuedRef.current.filter((entry) => entry.id !== id))
    },
    [setQueue],
  )

  const sendQueuedNow = useCallback(
    async (id: string): Promise<void> => {
      if (activeSendRef.current?.session === sessionRef.current) {
        return
      }
      const entry = queuedRef.current.find((candidate) => candidate.id === id)
      if (entry === undefined) {
        return
      }
      setQueue(queuedRef.current.filter((candidate) => candidate.id !== id))
      await deliver(entry.text, entry.attachments)
    },
    [deliver, setQueue],
  )

  const stop = useCallback(() => {
    activeSendRef.current?.controller.abort()
  }, [])

  const newChat = useCallback((): string => {
    activeSendRef.current?.controller.abort()
    sessionRef.current += 1
    setTurns([])
    setAttachments([])
    setInstructions('')
    setChatTools(false)
    setQueue([])
    const nextConversationId = crypto.randomUUID()
    conversationIdRef.current = nextConversationId
    setConversationId(nextConversationId)
    return nextConversationId
  }, [setQueue])

  const openConversation = useCallback(
    async (id: string): Promise<void> => {
      if (id === conversationIdRef.current) {
        return
      }
      activeSendRef.current?.controller.abort()
      sessionRef.current += 1
      const session = sessionRef.current
      setAttachments([])
      setInstructions('')
      setChatTools(false)
      setQueue([])
      try {
        const restored = await loadChatMessages(id)
        // Superseded by another switch or New chat — or by a send: a message
        // composed while the rows loaded belongs to the conversation that was
        // on screen, so the user's turn must not be swapped out from under it.
        // Checked via the last send's session (not the in-flight slot, which
        // is cleared on settle) — a turn that finished streaming before the
        // rows arrived still anchors the switch to the conversation it's in.
        if (session !== sessionRef.current || lastSendSessionRef.current === session) {
          return
        }
        setConversationId(id)
        setTurns(restored)
      } catch (cause) {
        console.error('chat: opening the conversation failed:', errorMessage(cause))
      }
    },
    [setQueue],
  )

  const deleteConversation = useCallback(
    async (id: string): Promise<void> => {
      deletedConversationsRef.current.add(id)
      const generation = generationRef.current
      if (hasBridge() && generation !== null) {
        // Let any in-flight save for this conversation land first — the
        // delete and a dispatched save are independent commands, so issuing
        // the delete now could be overtaken in Rust and the save's upsert
        // would resurrect the row. (The chain never rejects.)
        await pendingSavesRef.current.get(id)
        try {
          await deleteChatConversation(id, generation)
        } catch (cause) {
          console.error('chat: deleting the conversation failed:', errorMessage(cause))
        }
        invalidateChatQueries()
      }
      if (id === conversationIdRef.current) {
        newChat()
      }
      emitChatConversationDeleted(id)
    },
    [newChat],
  )

  const selectModel = useCallback(
    (next: ChatModelSelection | null) => {
      updateSettings({ chatModelSelection: next })
    },
    [updateSettings],
  )

  const attachImages = useCallback(async (files: File[]): Promise<void> => {
    // Reading files is async: a drop still in flight when New chat clears
    // the session must not land in the fresh composer afterwards.
    const session = sessionRef.current
    const queued = await Promise.all(files.map(toChatAttachment))
    if (session !== sessionRef.current) {
      return
    }
    setAttachments((current) => [...current, ...queued])
  }, [])

  const removeAttachment = useCallback((id: string) => {
    setAttachments((current) => current.filter((attachment) => attachment.id !== id))
  }, [])

  const value = useMemo<ChatContextValue>(
    () => ({
      turns,
      status,
      providers,
      modelOptions,
      activeModel,
      selectModel,
      draft,
      setDraft,
      attachments,
      attachImages,
      removeAttachment,
      send,
      steer,
      queued,
      removeQueued,
      sendQueuedNow,
      stop,
      newChat,
      instructions,
      setInstructions,
      chatTools,
      setChatTools,
      activeConversationId: conversationId,
      openConversation,
      deleteConversation,
    }),
    [
      turns,
      status,
      providers,
      modelOptions,
      activeModel,
      selectModel,
      draft,
      attachments,
      attachImages,
      removeAttachment,
      send,
      steer,
      queued,
      removeQueued,
      sendQueuedNow,
      stop,
      newChat,
      instructions,
      chatTools,
      conversationId,
      openConversation,
      deleteConversation,
    ],
  )
  return <ChatContext value={value}>{children}</ChatContext>
}
