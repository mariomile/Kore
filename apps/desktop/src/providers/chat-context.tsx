import { createContext, use } from 'react'
import type {
  AiProviderConfig,
  ChatModelOption,
  ChatModelSelection,
  ChatTurn,
  NoteEditDecision,
} from '@reflect/core'
import type { ChatAttachment } from '@/lib/chat-attachments'

/**
 * The chat session's public surface — the context `ChatProvider` fills and
 * every chat component (desktop screen and mobile tab alike) consumes via
 * {@link useChatSession}. Split from the provider so the contract reads on
 * its own; the session semantics live with the provider.
 */

export type ChatStatus = 'idle' | 'streaming'

/** Records one decision on a bound note edit (see {@link ChatContextValue.bindNoteEditDecision}). */
export type NoteEditDecisionRecorder = (decision: Exclude<NoteEditDecision, 'pending'>) => void

/** A message composed while a turn was streaming, waiting its turn. */
export interface QueuedChatMessage {
  id: string
  text: string
  attachments: ChatAttachment[]
}

export interface ChatContextValue {
  turns: ChatTurn[]
  status: ChatStatus
  /** Configured provider entries (empty → the add-a-provider CTA). */
  providers: AiProviderConfig[]
  /** Every model the picker offers: each provider's full curated list. */
  modelOptions: ChatModelOption[]
  /**
   * The provider entry + model the next turn calls (`model` already carries
   * the picker's choice) — the persisted last pick or the settings default.
   */
  activeModel: AiProviderConfig | null
  /**
   * Pick the chat model. Persisted (`chatModelSelection` in the settings
   * document), so later sessions start on it; null returns to the app
   * default.
   */
  selectModel: (selection: ChatModelSelection | null) => void
  /**
   * The composer's unsent text. Provider state, not composer state, so it
   * survives the screen unmounting — on mobile every tab switch unmounts the
   * chat screen (Plan 23, contract 7). Cleared by a send that goes through.
   */
  draft: string
  /** Replace the composer draft (the composer's onChange). */
  setDraft: (text: string) => void
  /** Images queued for the next message (dropped or pasted onto the chat). */
  attachments: ChatAttachment[]
  /** Queue image files for the next message. */
  attachImages: (files: File[]) => Promise<void>
  /** Drop one queued image. */
  removeAttachment: (id: string) => void
  /**
   * Send one user message (text, queued images, or both). Nothing
   * streaming: the message starts a turn. A turn streaming: the message
   * *steers* it when the engine can ({@link ChatContextValue.canSteer}) —
   * delivered into the live reply now, the partial output kept, and shown
   * in the transcript where the reply split around it. Otherwise (a
   * queue-only engine, an image attached, or the run refused it) the
   * message queues — see {@link ChatContextValue.queued}.
   */
  send: (text: string) => Promise<void>
  /**
   * Whether a message sent while the current model streams reaches the
   * live reply (BYOK engines, Claude Code, Codex) rather than waiting for
   * it to finish (Cursor CLI). Drives what the composer promises.
   */
  canSteer: boolean
  /**
   * Hold one user message for after the reply (⌘-Enter): the explicit
   * alternative to steering. Nothing streaming: same as
   * {@link ChatContextValue.send}.
   */
  queue: (text: string) => Promise<void>
  /**
   * Messages held for after the streaming turn, in send order. Each
   * delivers automatically when the streaming turn settles naturally;
   * stopping the turn parks them instead — every card can then be sent or
   * discarded by hand. Cleared by New chat and by opening a past
   * conversation.
   */
  queued: QueuedChatMessage[]
  /** Discard one queued message. */
  removeQueued: (id: string) => void
  /** Deliver one queued message immediately. No-op while a turn streams. */
  sendQueuedNow: (id: string) => Promise<void>
  /** Abort the in-flight turn (partial text stays in the transcript). */
  stop: () => void
  /**
   * Bind a recorder for the user's decision on the proposed note edit
   * `toolCallId` (the review card's Accept / Reject). Binding resolves the
   * edit's turn and conversation *now*, so a decision recorded after an
   * async write still lands in the right conversation even if the user
   * switched away meanwhile; the recorder updates the turn on screen and
   * persists it, so a restored conversation shows what happened instead of
   * offering the patch again. Null when no settled turn carries the edit.
   * The write to the note itself is the card's job.
   */
  bindNoteEditDecision: (toolCallId: string) => NoteEditDecisionRecorder | null
  /** Leave the conversation in history, start a fresh one, and return its id. */
  newChat: () => string
  /**
   * Extra instructions layered on the global system prompt for THIS
   * conversation only. Session state: cleared by New chat and by opening a
   * past conversation, never persisted.
   */
  instructions: string
  /** Replace the conversation's instructions (the composer's popover). */
  setInstructions: (text: string) => void
  /**
   * Whether THIS conversation may use the configured MCP servers in
   * read-only chat (edit mode always may). Session state like
   * {@link ChatContextValue.instructions}: cleared by New chat and by
   * opening a past conversation, never persisted, so a conversation never
   * silently re-arms external tools.
   */
  chatTools: boolean
  /** Flip the conversation's external-tools opt-in (the composer's toggle). */
  setChatTools: (enabled: boolean) => void
  /** The persisted conversation the transcript belongs to. */
  activeConversationId: string
  /** Load a past conversation from the history. */
  openConversation: (id: string) => Promise<void>
  /** Delete a conversation; deleting the active one starts a fresh chat. */
  deleteConversation: (id: string) => Promise<void>
}

export const ChatContext = createContext<ChatContextValue | null>(null)

/** Read the chat session when a host may intentionally omit ChatProvider. */
export function useOptionalChatSession(): ChatContextValue | null {
  return use(ChatContext)
}

/** Access the chat session. Use within a ChatProvider. */
export function useChatSession(): ChatContextValue {
  const context = useOptionalChatSession()
  if (!context) {
    throw new Error('useChatSession must be used within a ChatProvider')
  }
  return context
}
