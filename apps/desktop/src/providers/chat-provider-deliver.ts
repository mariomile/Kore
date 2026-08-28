import type { Dispatch, RefObject, SetStateAction } from 'react'
import {
  aiApiKeyForConfig,
  appendEvent,
  buildHistory,
  errorMessage,
  hasBridge,
  listPrivateNotePaths,
  loadAgentContext,
  gitAgentSnapshot,
  gitChangedSince,
  withAgentRunLock,
  loadChatGraphContext,
  resolveMcpServers,
  mentionContextBlock,
  readNote,
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
  type ChatStreamEvent,
  type ChatTurn,
  type GraphInfo,
  type McpServer,
} from '@reflect/core'
import type { ChatAttachment } from '@/lib/chat-attachments'
import { todayIso } from '@/lib/dates'
import { isNativeShell } from '@/lib/platform'
import { isMobileSurface } from '@/lib/platform-surface'
import { providerFetch } from '@/lib/provider-fetch'
import { invalidateChatQueries } from '@/lib/query-client'
import type { QueuedChatMessage } from '@/providers/chat-context'
import { conversationTitle } from '@/providers/chat-title'

/** The in-flight send: its abort controller, session, and steering hook. */
export interface ActiveSend {
  controller: AbortController
  session: number
  /**
   * Delivers one more user message into the live turn (inject-capable
   * engines only — set once the run is spawned). Rejects when the run no
   * longer accepts input; the caller then queues instead.
   */
  steer?: (text: string) => Promise<void>
}

/**
 * Persist one turn into its conversation, best-effort: the generation it
 * was issued under gates the write in Rust (a stale save no-ops), deleted
 * conversations are never resurrected — the guard runs again when the
 * save's turn in the chain comes up, not just at enqueue time — and a
 * failure logs without touching the in-memory conversation.
 */
export function persistChatTurn(
  deps: {
    generationRef: RefObject<number | null>
    deletedConversationsRef: RefObject<Set<string>>
    pendingSavesRef: RefObject<Map<string, Promise<void>>>
  },
  conversation: ChatConversation,
  turn: ChatTurn,
  createdMs: number,
): void {
  const { generationRef, deletedConversationsRef, pendingSavesRef } = deps
  const generation = generationRef.current
  // Call-time check on purpose — saves fire from user actions, so they
  // read the live bridge state instead of a captured render value.
  if (!hasBridge() || generation === null || deletedConversationsRef.current.has(conversation.id)) {
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
}

/** Everything {@link deliverChatTurn} reads from the provider's render scope. */
export interface ChatDeliverDeps {
  /** The open graph — names the prompt's overview block. */
  graph: GraphInfo
  activeModelRef: RefObject<AiProviderConfig | null>
  activeSendRef: RefObject<ActiveSend | null>
  sessionRef: RefObject<number>
  lastSendSessionRef: RefObject<number>
  turnsRef: RefObject<ChatTurn[]>
  conversationIdRef: RefObject<string>
  instructionsRef: RefObject<string>
  chatSystemPromptRef: RefObject<string>
  chatAllowEditsRef: RefObject<boolean>
  activeAgentProfileRef: RefObject<string | null>
  memoryWriteApprovalRef: RefObject<boolean>
  mcpServersRef: RefObject<McpServer[]>
  semanticSearchEnabledRef: RefObject<boolean>
  queuedRef: RefObject<QueuedChatMessage[]>
  deliverRef: RefObject<((text: string, attached: ChatAttachment[]) => Promise<void>) | null>
  setTurns: Dispatch<SetStateAction<ChatTurn[]>>
  setQueue: (next: QueuedChatMessage[]) => void
  persistTurn: (conversation: ChatConversation, turn: ChatTurn, createdMs: number) => void
}

/** Run one user message as a streaming turn. Callers guard the busy slot. */
export async function deliverChatTurn(
  deps: ChatDeliverDeps,
  trimmed: string,
  attached: ChatAttachment[],
): Promise<void> {
  const {
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
    activeAgentProfileRef,
    memoryWriteApprovalRef,
    mcpServersRef,
    semanticSearchEnabledRef,
    queuedRef,
    deliverRef,
    setTurns,
    setQueue,
    persistTurn,
  } = deps
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
        // is deliberate for both null answers — a failed read and an index
        // that cannot answer yet are the same fact here, and running
        // without a complete deny list would drop the privacy hard block.
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
        const allowEdits = chatAllowEditsRef.current && cliProviderSupportsEdits(config.provider)
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
          message:
            'Couldn’t confirm which notes are private, so this run was refused. If the index is still building, try again in a moment.',
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
}
