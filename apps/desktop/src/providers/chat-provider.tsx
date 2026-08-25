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
  aiApiKeyForConfig,
  appendEvent,
  buildHistory,
  chatModelOptions,
  deleteChatConversation,
  errorMessage,
  hasBridge,
  listChatConversations,
  listPrivateNotePaths,
  loadAgentContext,
  gitAgentSnapshot,
  gitChangedSince,
  withAgentRunLock,
  loadChatGraphContext,
  resolveMcpServers,
  loadChatMessages,
  mentionContextBlock,
  readNote,
  resolveChatModel,
  resolveNoteMentions,
  saveChatMessage,
  scanChangedMemoryPaths,
  cliProviderSteerMode,
  cliProviderSupportsEdits,
  isCliAgentProvider,
  streamChat,
  streamCliAgentChat,
  userMessage,
  type AiProviderConfig,
  type ChatConversation,
  type ChatModelSelection,
  type ChatStreamEvent,
  type ChatTurn,
  type GraphInfo,
} from '@reflect/core'
import { useBridgeReady } from '@/hooks/use-bridge-ready'
import { toChatAttachment, type ChatAttachment } from '@/lib/chat-attachments'
import { todayIso } from '@/lib/dates'
import { isNativeShell } from '@/lib/platform'
import { isMobileSurface } from '@/lib/platform-surface'
import { providerFetch } from '@/lib/provider-fetch'
import { invalidateChatQueries } from '@/lib/query-client'
import {
  ChatContext,
  type ChatContextValue,
  type ChatStatus,
  type QueuedChatMessage,
} from '@/providers/chat-context'
import { conversationTitle } from '@/providers/chat-title'
import { useGraph } from '@/providers/graph-provider'
import { useSettings } from '@/providers/settings-provider'

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

export { useChatSession, type ChatStatus } from '@/providers/chat-context'

/** Resume the latest conversation within this window; otherwise start fresh. */
const CHAT_IDLE_CUTOFF_MS = 6 * 60 * 60 * 1000

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
  })

  // The in-flight send, tracked synchronously — the no-concurrent-sends
  // guard can't ride on rendered state, which only reflects a send after
  // the next render. `session` ties a send to its conversation: New chat
  // bumps the counter, so a detached send winding down no longer counts as
  // "this conversation is busy" and never clears a successor's slot.
  const sessionRef = useRef(0)
  const activeSendRef = useRef<{
    controller: AbortController
    session: number
    /**
     * Delivers one more user message into the live turn (inject-capable
     * engines only — set once the run is spawned). Rejects when the run no
     * longer accepts input; the caller then queues instead.
     */
    steer?: (text: string) => Promise<void>
  } | null>(null)
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

  /**
   * Persist one turn into its conversation, best-effort: the generation it
   * was issued under gates the write in Rust (a stale save no-ops), deleted
   * conversations are never resurrected — the guard runs again when the
   * save's turn in the chain comes up, not just at enqueue time — and a
   * failure logs without touching the in-memory conversation.
   */
  const persistTurn = useCallback(
    (conversation: ChatConversation, turn: ChatTurn, createdMs: number) => {
      const generation = generationRef.current
      // Call-time check on purpose — saves fire from user actions, so they
      // read the live bridge state instead of a captured render value.
      if (
        !hasBridge() ||
        generation === null ||
        deletedConversationsRef.current.has(conversation.id)
      ) {
        return
      }
      const queue = pendingSavesRef.current
      const chained = (queue.get(conversation.id) ?? Promise.resolve())
        .then(() => {
          if (deletedConversationsRef.current.has(conversation.id)) {
            return
          }
          return saveChatMessage({ conversation, turn, createdMs, generation }).then(
            invalidateChatQueries,
          )
        })
        .catch((cause) => {
          console.error('chat: saving the turn failed:', errorMessage(cause))
        })
      queue.set(conversation.id, chained)
    },
    [],
  )

  // Resume the latest conversation on mount — unless it has been idle past
  // the cutoff (then the next message starts a fresh one and the old chat
  // stays in the history). Guarded against races: by the time the rows
  // arrive the user may have started typing into the fresh conversation.
  useEffect(() => {
    if (!bridgeReady || indexGeneration === null) {
      return
    }
    const session = sessionRef.current
    let active = true
    void (async () => {
      try {
        const [latest] = await listChatConversations(1)
        if (latest === undefined || Date.now() - latest.updatedMs > CHAT_IDLE_CUTOFF_MS) {
          return
        }
        const restored = await loadChatMessages(latest.id)
        if (!active || session !== sessionRef.current || turnsRef.current.length > 0) {
          return
        }
        setConversationId(latest.id)
        setTurns(restored)
      } catch (cause) {
        console.error('chat: restoring the last conversation failed:', errorMessage(cause))
      }
    })()
    return () => {
      active = false
    }
  }, [bridgeReady, indexGeneration])

  // Self-reference for the auto-drain: `deliver`'s finally hands the next
  // queued message back to `deliver` itself, which a useCallback closure
  // can't name directly.
  const deliverRef = useRef<((text: string, attached: ChatAttachment[]) => Promise<void>) | null>(
    null,
  )

  /** Run one user message as a streaming turn. Callers guard the busy slot. */
  const deliver = useCallback(
    async (trimmed: string, attached: ChatAttachment[]): Promise<void> => {
      const config = activeModelRef.current
      if (config === null || activeSendRef.current?.session === sessionRef.current) {
        return
      }

      const turnId = crypto.randomUUID()
      const messages = [...buildHistory(turnsRef.current), userMessage(trimmed, attached)]
      // The conversation's own instructions ride after the global prompt so a
      // per-chat tone or format override wins where the two disagree.
      const conversationInstructions = instructionsRef.current.trim()
      const customSystemPrompt = [chatSystemPromptRef.current.trim(), conversationInstructions]
        .filter((part) => part !== '')
        .join('\n\n')
      // Everything the settle-time save needs, captured now: a turn detached
      // by New chat (or a conversation switch) still persists into the
      // conversation it was sent under.
      const sendConversationId = conversationIdRef.current
      const turnCreatedMs = Date.now()
      const title = conversationTitle(turnsRef.current[0]?.userText ?? trimmed)
      const conversationMeta = (): ChatConversation => ({
        id: sendConversationId,
        title,
        createdMs: turnCreatedMs,
        updatedMs: Date.now(),
      })
      // The turn is folded locally alongside the rendered state — the settle
      // save must not depend on the turn still being mounted in `turns`.
      let localTurn: ChatTurn = {
        id: turnId,
        userText: trimmed,
        attachments: attached,
        parts: [],
        responseMessages: [],
        status: 'streaming',
      }

      const updateTurn = (updater: (turn: ChatTurn) => ChatTurn) => {
        localTurn = updater(localTurn)
        setTurns((current) => current.map((turn) => (turn.id === turnId ? updater(turn) : turn)))
      }
      const applyEvent = (event: ChatStreamEvent) => {
        updateTurn((turn) => ({ ...turn, parts: appendEvent(turn.parts, event) }))
      }

      // Snapshot the turn as first rendered. This add runs at React's next
      // flush, by which point `localTurn` may already point at folded state;
      // closing over the mutable binding would add that folded turn and then
      // re-fold it through updateTurn, duplicating appended parts.
      const initialTurn = localTurn
      setTurns((current) => [...current, initialTurn])
      // The user half lands immediately, so a crash mid-stream keeps the
      // question (restored with an empty response, which the model history
      // derivation already omits).
      persistTurn(conversationMeta(), localTurn, turnCreatedMs)

      const controller = new AbortController()
      const activeSend: NonNullable<typeof activeSendRef.current> = {
        controller,
        session: sessionRef.current,
      }
      activeSendRef.current = activeSend
      lastSendSessionRef.current = activeSend.session

      // The activity ledger's baseline: before an edit-mode agent run,
      // commit whatever is pending so the run's touches diff cleanly against
      // a restorable version. Best-effort — no snapshot, no ledger, but the
      // turn itself still runs.
      const editRun =
        isCliAgentProvider(config.provider) &&
        cliProviderSupportsEdits(config.provider) &&
        chatAllowEditsRef.current
          ? { generation: graph.generation }
          : null
      // Edit-mode runs are serialized across the app (chat and automations
      // share one FIFO lock): overlapping runs would cross-attribute each
      // other's changes in the activity ledger. `releaseRunLock` resolves
      // the promise the next queued run awaits; the finally below releases.
      let releaseRunLock: () => void = () => {}
      if (editRun) {
        await new Promise<void>((acquired) => {
          void withAgentRunLock(
            () =>
              new Promise<void>((resolve) => {
                releaseRunLock = resolve
                acquired()
              }),
          )
        })
      }
      const snapshot = editRun ? await gitAgentSnapshot(editRun.generation).catch(() => null) : null

      try {
        // [[Mentions]] resolve to the notes' current content at send time,
        // so the model grounds on what each note says *now*. Private notes
        // contribute their refusal only, and a failed resolution degrades
        // to a structured miss — the send always goes out. The block rides
        // the model-bound message alone: the bubble and the persisted turn
        // keep the text as typed.
        const mentionBlock = mentionContextBlock(await resolveNoteMentions(trimmed))
        if (mentionBlock !== '') {
          messages[messages.length - 1] = userMessage(`${trimmed}\n\n${mentionBlock}`, attached)
        }
        // The active agent's soul + memories ride into every provider's
        // prompt; a failed read degrades to "nothing", never a blocked turn.
        const agentContext = await loadAgentContext(activeAgentProfileRef.current).catch(() => null)
        const events = await (async () => {
          if (isCliAgentProvider(config.provider)) {
            // The subscription engines: the CLI reads the graph itself, so
            // they need the private-note deny list, not an API key. Refusing
            // on a failed read is deliberate — running without the deny list
            // would drop the privacy hard block.
            const privateNotePaths = await listPrivateNotePaths().catch((cause: unknown) => {
              console.error('private-note list failed:', errorMessage(cause))
              return null
            })
            if (privateNotePaths === null) {
              return null
            }
            // MCP tools ride only edit-mode runs: read-only chat stays a
            // zero-egress surface. Secrets resolve from the keychain here,
            // per run — never stored anywhere else.
            // Cursor never joins edit mode (its write path is unverified),
            // so the toggle silently means read-only there.
            const allowEdits =
              chatAllowEditsRef.current && cliProviderSupportsEdits(config.provider)
            const mcpServers = allowEdits
              ? await resolveMcpServers(mcpServersRef.current).catch(() => [])
              : []
            return streamCliAgentChat(config.provider, {
              model: config.model,
              messages,
              today: todayIso(),
              customSystemPrompt,
              graphRoot: graph.root,
              graphName: graph.name,
              privateNotePaths,
              allowEdits,
              mcpServers,
              agentContext,
              memoryWriteApproval: memoryWriteApprovalRef.current,
              signal: controller.signal,
              // Inject-capable engines expose mid-turn steering: the steer
              // lands in the live session AND in the transcript as its own
              // part, right where the reply text splits around it.
              steering:
                cliProviderSteerMode(config.provider) === 'inject'
                  ? {
                      onSteerReady: (inject) => {
                        activeSend.steer = async (steerText: string) => {
                          await inject(steerText)
                          updateTurn((turn) => ({
                            ...turn,
                            parts: [...turn.parts, { kind: 'steer', text: steerText }],
                          }))
                        }
                      },
                    }
                  : undefined,
            })
          }
          // The graph overview degrades to null (prompt without the block)
          // rather than blocking the turn — a cold index shouldn't kill chat.
          const [apiKey, context] = await Promise.all([
            aiApiKeyForConfig(config),
            loadChatGraphContext(graph.name).catch((cause: unknown) => {
              console.error('chat graph context failed:', errorMessage(cause))
              return null
            }),
          ])
          if (apiKey === null) {
            applyEvent({
              type: 'error',
              message: 'No API key found for this provider — re-add it in Settings → AI providers.',
              messages: [],
            })
            return null
          }
          return streamChat({
            config,
            apiKey,
            fetchFn: providerFetch,
            messages,
            today: todayIso(),
            semanticSearchEnabled: semanticSearchEnabledRef.current,
            customSystemPrompt,
            context,
            agentContext,
            // The write tool routes through the session-safe frontmatter
            // channel, pinned to the graph generation of this turn.
            allowEdits: chatAllowEditsRef.current,
            toolDeps: {
              // The embedded browser is a desktop capability: the typed
              // answer here is what makes the browse tools refuse honestly
              // on mobile and in the web harness.
              browsingAvailable: isNativeShell() && !isMobileSurface(),
            },
            signal: controller.signal,
          })
        })()
        if (events === null) {
          if (isCliAgentProvider(config.provider)) {
            applyEvent({
              type: 'error',
              message: 'Couldn’t read the private-note list — try again in a moment.',
              messages: [],
            })
          }
          return
        }
        for await (const event of events) {
          // Every terminal event carries the turn's messages — for a stopped or
          // failed turn that's the completed steps plus partial text, so the
          // derived history matches what stayed on screen.
          if (event.type === 'complete' || event.type === 'aborted' || event.type === 'error') {
            updateTurn((turn) => ({ ...turn, responseMessages: event.messages }))
          }
          // `complete` is folded too: appendEvent backstops a reply-less turn
          // with a notice, so the chips never settle into silence.
          applyEvent(event)
        }
      } catch (cause) {
        // streamChat normalizes its own failures; this guards the seams around
        // it (keychain read, event application) so the UI never sticks.
        applyEvent({ type: 'error', message: errorMessage(cause), messages: [] })
      } finally {
        // Close the ledger: whatever differs from the pre-run snapshot is
        // what this run touched. Shown in the turn and persisted with it.
        if (editRun && snapshot !== null) {
          const changed = await gitChangedSince(snapshot, editRun.generation).catch(() => [])
          const paths = changed.filter((path) => path.toLowerCase().endsWith('.md'))
          if (paths.length > 0) {
            updateTurn((turn) => ({ ...turn, parts: [...turn.parts, { kind: 'changes', paths }] }))
          }
          // The memory-write scanner: prompts forbid storing instructions
          // and secrets in memory, this checks what actually landed there.
          // A finding is a review pointer for the user, never a rollback.
          const warnings = await scanChangedMemoryPaths(paths, readNote).catch(() => [])
          if (warnings.length > 0) {
            updateTurn((turn) => ({
              ...turn,
              parts: [
                ...turn.parts,
                {
                  kind: 'notice',
                  tone: 'error',
                  text: `Memory write check — review these lines:\n${warnings.join('\n')}`,
                },
              ],
            }))
          }
        }
        releaseRunLock()
        updateTurn((turn) => ({ ...turn, status: 'done' }))
        persistTurn(conversationMeta(), localTurn, turnCreatedMs)
        // Only release the slot if it's still ours: a turn detached by New
        // chat must not, while winding down, unhook the controller a newer
        // turn has since registered — Stop and the unmount abort always have
        // to target the live stream.
        if (activeSendRef.current === activeSend) {
          activeSendRef.current = null
          // Auto-drain the queue only when the turn settled naturally in
          // this conversation. A Stop (or New chat / a switch, which also
          // abort) means the user changed their mind — queued messages stay
          // parked as cards to send or discard by hand.
          if (!controller.signal.aborted && sessionRef.current === activeSend.session) {
            const [next, ...rest] = queuedRef.current
            if (next !== undefined) {
              setQueue(rest)
              void deliverRef.current?.(next.text, next.attachments)
            }
          }
        }
      }
    },
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

  const newChat = useCallback(() => {
    activeSendRef.current?.controller.abort()
    sessionRef.current += 1
    setTurns([])
    setAttachments([])
    setInstructions('')
    setQueue([])
    setConversationId(crypto.randomUUID())
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
      conversationId,
      openConversation,
      deleteConversation,
    ],
  )
  return <ChatContext value={value}>{children}</ChatContext>
}
