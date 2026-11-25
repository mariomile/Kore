import type { Dispatch, RefObject, SetStateAction } from 'react'
import {
  aiApiKeyForConfig,
  memoryWriteForChat,
  appendEvent,
  buildHistory,
  errorMessage,
  hasBridge,
  listPrivateNotePaths,
  loadAgentContext,
  loadChatGraphContext,
  persistChatAttachmentFile,
  readChatAttachmentDataUrl,
  resolveMcpServers,
  mentionContextBlock,
  recallContextBlock,
  recallForMessage,
  resolveNoteMentions,
  saveChatMessage,
  chatProviderCanSteer,
  chatModeAllowsEdits,
  isFileChatProvider,
  cliChatRunsKoreTools,
  streamChat,
  streamCliAgentChat,
  userMessage,
  type AiProviderConfig,
  type ChatAttachment as CoreChatAttachment,
  type ChatConversation,
  type ChatMode,
  type ChatStreamEvent,
  type ChatTurn,
  type GraphInfo,
  type McpServer,
} from '@kore/core'
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
   * Delivers one more user message into the live turn. Present from the
   * start on every steer-capable engine ({@link chatProviderCanSteer}): a
   * steer that arrives before the engine is live waits for it, then rides.
   * Rejects when the run no longer accepts input; the caller then queues
   * instead.
   */
  steer?: (text: string) => Promise<void>
}

interface SteerRelay {
  /**
   * Deliver one steer. Resolves once the engine has taken it (or once
   * {@link SteerRelay.unsent} handed it to the queue); rejects when the
   * engine refused it — the caller then queues it.
   */
  steer: (text: string) => Promise<void>
  /** Hook up the live engine; steers that waited ride now, in send order. */
  arm: (inject: (text: string) => Promise<void>, afterInject?: (text: string) => void) => void
  /**
   * Steers still waiting for an engine that never armed, for the queue.
   * Their callers are told the message rode — the queue now owns it.
   */
  unsent: () => string[]
}

/**
 * Bridges the composer's steer to the engine's inject function, which only
 * exists once the run is live: steers before that wait and are flushed on
 * arming, one after the other so they land in send order; steers after go
 * straight through. Whatever never rode (the run died before arming) is
 * handed back at settle time.
 */
function createSteerRelay(): SteerRelay {
  let deliver: ((text: string) => Promise<void>) | null = null
  let waiting: { text: string; resolve: () => void; reject: (cause: unknown) => void }[] = []
  return {
    steer: (text) => {
      const live = deliver
      if (live !== null) {
        return live(text)
      }
      return new Promise<void>((resolve, reject) => {
        waiting.push({ text, resolve, reject })
      })
    },
    arm: (inject, afterInject) => {
      const live = async (text: string): Promise<void> => {
        await inject(text)
        afterInject?.(text)
      }
      deliver = live
      const flush = waiting
      waiting = []
      void (async () => {
        for (const entry of flush) {
          try {
            await live(entry.text)
            entry.resolve()
          } catch (cause) {
            entry.reject(cause)
          }
        }
      })()
    },
    unsent: () => {
      const left = waiting
      waiting = []
      for (const entry of left) {
        entry.resolve()
      }
      return left.map((entry) => entry.text)
    },
  }
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
  /** The open index generation — pins attachment file writes and reads. */
  generationRef: RefObject<number | null>
  instructionsRef: RefObject<string>
  chatSystemPromptRef: RefObject<string>
  chatModeRef: RefObject<ChatMode>
  /** The conversation's external-tools opt-in (see chat context). */
  chatToolsRef: RefObject<boolean>
  activeAgentProfileRef: RefObject<string | null>
  memoryWriteApprovalRef: RefObject<boolean>
  mcpServersRef: RefObject<McpServer[]>
  semanticSearchEnabledRef: RefObject<boolean>
  queuedRef: RefObject<QueuedChatMessage[]>
  deliverRef: RefObject<((text: string, attached: ChatAttachment[]) => Promise<void>) | null>
  setTurns: Dispatch<SetStateAction<ChatTurn[]>>
  setQueue: (next: QueuedChatMessage[]) => void
  /** Whether the turn being started takes steers (its engine, not the picker's). */
  setLiveCanSteer: (canSteer: boolean) => void
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
    generationRef,
    instructionsRef,
    chatSystemPromptRef,
    chatModeRef,
    chatToolsRef,
    activeAgentProfileRef,
    memoryWriteApprovalRef,
    mcpServersRef,
    semanticSearchEnabledRef,
    queuedRef,
    deliverRef,
    setTurns,
    setQueue,
    setLiveCanSteer,
    persistTurn,
  } = deps
  const config = activeModelRef.current
  if (config === null || activeSendRef.current?.session === sessionRef.current) {
    return
  }

  const turnId = crypto.randomUUID()
  const generation = generationRef.current
  const history = turnsRef.current
  const chatMode = chatModeRef.current
  const chatTools = chatToolsRef.current
  const agentProfile = activeAgentProfileRef.current
  const memoryWriteApproval = memoryWriteApprovalRef.current
  const mcpServerSettings = mcpServersRef.current
  const semanticSearchEnabled = semanticSearchEnabledRef.current
  // The conversation's own instructions ride after the global prompt so a
  // per-chat tone or format override wins where the two disagree.
  const conversationInstructions = instructionsRef.current.trim()
  const modeInstruction =
    chatMode === 'plan'
      ? 'Plan mode: analyze the request and return a concrete plan. Do not make changes.'
      : chatMode === 'auto'
        ? 'Auto mode: decide whether the request needs explanation, planning, or direct changes. Make changes only when they are needed to complete the request.'
        : ''
  const customSystemPrompt = [
    chatSystemPromptRef.current.trim(),
    conversationInstructions,
    modeInstruction,
  ]
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
  const steerRelay = createSteerRelay()
  const canSteer = chatProviderCanSteer(config.provider)
  const activeSend: ActiveSend = {
    controller,
    session: sessionRef.current,
    ...(canSteer ? { steer: steerRelay.steer } : {}),
  }
  activeSendRef.current = activeSend
  setLiveCanSteer(canSteer)
  lastSendSessionRef.current = activeSend.session

  const run = async (): Promise<void> => {
    controller.signal.throwIfAborted()
    // Replace the initial inline attachment with a file-backed snapshot: the
    // next persisted row carries only the file path (the store strips the
    // dataUrl), while this in-memory copy keeps its dataUrl for the session's
    // rendering and provider payload. Best-effort per file — a failed write
    // keeps that attachment on the legacy inline persistence.
    const attachedWithFiles = await withPersistedAttachmentFiles(
      sendConversationId,
      attached,
      generation,
    )
    // Restored turns hold path-only attachments; every engine needs the
    // bytes back — BYOK as file parts, the CLIs as image/document blocks
    // (stateless runs resend earlier files for follow-up questions).
    const historyTurns = await withHydratedAttachmentHistory(history, generation)
    const messages = [...buildHistory(historyTurns), userMessage(trimmed, attachedWithFiles)]
    updateTurn((turn) => ({ ...turn, attachments: attachedWithFiles }))
    if (attached.length > 0) {
      persistTurn(conversationMeta(), localTurn, turnCreatedMs)
    }
    controller.signal.throwIfAborted()
    // [[Mentions]] resolve to the notes' current content at send time,
    // so the model grounds on what each note says *now*. Private notes
    // contribute their refusal only, and a failed resolution degrades
    // to a structured miss — the send always goes out. The block rides
    // the model-bound message alone: the bubble and the persisted turn
    // keep the text as typed.
    const mentions = await resolveNoteMentions(trimmed)
    const mentionBlock = mentionContextBlock(mentions)
    // Beside the explicit mentions, the vault's own memory: one ranked FTS
    // pass over the index surfaces the top passages touching this message,
    // with provenance. Mentioned notes are excluded (their full content
    // already rides the turn) and any failure degrades to no recall.
    const recalled = await recallForMessage(
      trimmed,
      mentions.map((mention) => mention.path),
    )
    const recallBlock = recallContextBlock(recalled)
    const contextBlock = [mentionBlock, recallBlock].filter((block) => block !== '').join('\n\n')
    if (contextBlock !== '') {
      const notes = [
        ...mentions.flatMap((mention) =>
          mention.path !== null && mention.content !== null
            ? [
                {
                  path: mention.path,
                  title: mention.title ?? mention.path,
                  excerpt: mention.content.slice(0, 280),
                  source: 'mention' as const,
                },
              ]
            : [],
        ),
        ...recalled.map((hit) => ({
          path: hit.path,
          title: hit.title,
          excerpt: (hit.snippet ?? hit.preview).slice(0, 280),
          source: 'recall' as const,
        })),
      ]
      if (notes.length > 0) {
        updateTurn((turn) => ({ ...turn, parts: [...turn.parts, { kind: 'context', notes }] }))
      }
      messages[messages.length - 1] = userMessage(
        `${trimmed}\n\n${contextBlock}`,
        attachedWithFiles,
      )
    }
    // The active agent's soul + memories ride into every provider's
    // prompt; a failed read degrades to "nothing", never a blocked turn.
    const agentContext = await loadAgentContext(agentProfile).catch(() => null)
    controller.signal.throwIfAborted()
    const events = await (async () => {
      if (isFileChatProvider(config.provider)) {
        // The file-tools engine (Cursor, read-only, no MCP): the CLI reads
        // the graph itself, so it needs the private-note deny list, not an
        // API key. Its steers queue, so the run gets no steering. Refusing
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
        return streamCliAgentChat(config.provider, {
          model: config.model,
          messages,
          today: todayIso(),
          customSystemPrompt,
          graphRoot: graph.root,
          graphName: graph.name,
          privateNotePaths,
          agentContext,
          memoryWriteApproval,
          signal: controller.signal,
        })
      }
      // The graph overview degrades to null (prompt without the block)
      // rather than blocking the turn — a cold index shouldn't kill chat.
      // Claude Code and Codex mount the user's MCP servers next to Kore's tools when
      // the conversation opted in (Tools toggle or Full Access).
      const mcpAllowed =
        cliChatRunsKoreTools(config.provider) && (chatMode === 'full-access' || chatTools)
      const [apiKey, context, memoryWriteFn, mcpServers] = await Promise.all([
        aiApiKeyForConfig(config),
        loadChatGraphContext(graph.name).catch((cause: unknown) => {
          console.error('chat graph context failed:', errorMessage(cause))
          return null
        }),
        // A cyber-brain vault's memory tools write through its own kit.
        memoryWriteForChat(agentContext, generation),
        mcpAllowed ? resolveMcpServers(mcpServerSettings).catch(() => []) : [],
      ])
      if (apiKey === null) {
        applyEvent({
          type: 'error',
          message: 'No API key found for this provider — re-add it in Settings → AI providers.',
          messages: [],
        })
        return null
      }
      controller.signal.throwIfAborted()
      return streamChat({
        config,
        apiKey,
        fetchFn: providerFetch,
        messages,
        today: todayIso(),
        semanticSearchEnabled: semanticSearchEnabled,
        customSystemPrompt,
        context,
        agentContext,
        // The write tool routes through the session-safe frontmatter
        // channel, pinned to the graph generation of this turn.
        allowEdits: chatModeAllowsEdits(chatMode),
        toolDeps: {
          // The embedded browser is a desktop capability: the typed
          // answer here is what makes the browse tools refuse honestly
          // on mobile and in the web harness.
          browsingAvailable: isNativeShell() && !isMobileSurface(),
          memoryWriteFn,
        },
        signal: controller.signal,
        // The engine cuts the leg in flight, keeps its partial output,
        // and continues on the combined history; it yields the `steer`
        // event itself, exactly where the reply split.
        steering: { onSteerReady: (inject) => steerRelay.arm(inject) },
        mcpServers,
      })
    })()
    if (events === null) {
      if (isFileChatProvider(config.provider)) {
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
  }

  try {
    await run()
  } catch (cause) {
    applyEvent(
      controller.signal.aborted
        ? { type: 'aborted', messages: [] }
        : { type: 'error', message: errorMessage(cause), messages: [] },
    )
  } finally {
    updateTurn((turn) => ({ ...turn, status: 'done' }))
    persistTurn(conversationMeta(), localTurn, turnCreatedMs)
    // Steers the run never took (it died before arming) settle now, whoever
    // owns the slot — their senders must not wait forever. They join the
    // queue only below, while this is still the live conversation; a turn
    // detached by New chat or a switch drops them, as New chat drops the
    // queue itself.
    const unsentSteers = steerRelay.unsent()
    // Only release the slot if it's still ours: a turn detached by New
    // chat must not, while winding down, unhook the controller a newer
    // turn has since registered — Stop and the unmount abort always have
    // to target the live stream.
    if (activeSendRef.current === activeSend) {
      activeSendRef.current = null
      // An unsent steer is not lost: it joins the queue ahead of anything
      // queued later — the user typed it first.
      if (unsentSteers.length > 0 && sessionRef.current === activeSend.session) {
        setQueue([
          ...unsentSteers.map((text) => ({ id: crypto.randomUUID(), text, attachments: [] })),
          ...queuedRef.current,
        ])
      }
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

/**
 * Persist fresh attachment bytes to their on-disk files (native shell with
 * an open index only — the dev bridge has no filesystem, and its rows keep
 * the inline dataUrl). Best-effort per attachment.
 */
async function withPersistedAttachmentFiles(
  conversationId: string,
  attachments: ChatAttachment[],
  generation: number | null,
): Promise<CoreChatAttachment[]> {
  if (!isNativeShell() || generation === null || attachments.length === 0) {
    return attachments
  }
  return await Promise.all(
    attachments.map(async (attachment) => {
      try {
        return await persistChatAttachmentFile(conversationId, attachment, generation)
      } catch (cause) {
        console.error('chat: persisting an attachment file failed:', errorMessage(cause))
        return attachment
      }
    }),
  )
}

/**
 * Hydrate path-only attachments (restored turns) back into `data:` URLs for
 * a provider payload. A failed read leaves the attachment path-only, and
 * `userMessage` then degrades that turn to its text.
 */
async function withHydratedAttachmentHistory(
  turns: ChatTurn[],
  generation: number | null,
): Promise<ChatTurn[]> {
  if (generation === null) {
    return turns
  }
  return await Promise.all(
    turns.map(async (turn) => {
      if (
        !turn.attachments.some(
          (attachment) => attachment.dataUrl === undefined && attachment.path !== undefined,
        )
      ) {
        return turn
      }
      const attachments = await Promise.all(
        turn.attachments.map(async (attachment) => {
          const path = attachment.path
          if (attachment.dataUrl !== undefined || path === undefined) {
            return attachment
          }
          try {
            const dataUrl = await readChatAttachmentDataUrl({ ...attachment, path }, generation)
            return { ...attachment, dataUrl }
          } catch (cause) {
            console.error('chat: reading an attachment file failed:', errorMessage(cause))
            return attachment
          }
        }),
      )
      return { ...turn, attachments }
    }),
  )
}
