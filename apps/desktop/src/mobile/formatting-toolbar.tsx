import type { ReactElement } from 'react'
import {
  ChevronDown,
  Hash,
  Image as ImageIcon,
  IndentDecrease,
  IndentIncrease,
  Microphone,
  Undo,
  WikiLink,
} from '@/components/icons'
import { useFormattingToolbar, type FormattingBlockKind } from '@/editor/formatting-toolbar-store'
import { cn } from '@/lib/utils'
import { useMobileAudioMemo } from '@/mobile/audio-memo-provider'
import { pickFiles } from '@/lib/pick-files'
import { hapticImpactLight } from '@/mobile/haptics'

/**
 * The webview-drawn formatting toolbar (Plan 19, decision 8 — V1's native
 * accessory bar deliberately not ported). It takes the tab bar's slot at the
 * bottom of the shell root while the keyboard is up, which with the root
 * sized to `calc(100dvh - var(--keyboard-height))` puts it exactly on the
 * keyboard's top edge: no fixed positioning, no safe-area math (the keyboard
 * covers the home-indicator region), and hardware keyboards suppress it for
 * free because the plugin reports their overlap as 0.
 *
 * Item set and order are V1's toolbar spec (the porting doc's requirements
 * list) minus AI prediction, which has no v2 substrate yet — plus a dismiss
 * button, which V1 never needed because iOS gives a `contenteditable` no
 * Done key. Renders nothing while no editor is focused: the All-tab search
 * field raises the keyboard too, and formatting buttons would be dead weight
 * there.
 *
 * The dismiss button is pinned outside the scrollable region so it stays
 * visible even when the formatting buttons overflow on narrow screens.
 */
export function MobileFormattingToolbar(): ReactElement | null {
  const toolbar = useFormattingToolbar()
  const memo = useMobileAudioMemo()
  if (toolbar === null) {
    return null
  }
  const { capabilities, commands } = toolbar
  const inList = capabilities.blockKind === 'bullet' || capabilities.blockKind === 'task'
  return (
    // iPhone design pass (2026-11): a row of block-type pills
    // that says what the caret's block is and switches it in one tap, over a
    // floating glass capsule with ink-weight icons, dictation and undo.
    <div role="toolbar" aria-label="Formatting" className="shrink-0 space-y-1.5 px-2 pt-1.5 pb-2">
      <div className="flex gap-1.5 overflow-x-auto [scrollbar-width:none]">
        {BLOCK_PILLS.map((pill) => (
          <button
            key={pill.kind}
            type="button"
            aria-pressed={capabilities.blockKind === pill.kind}
            onPointerDown={(event) => event.preventDefault()}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              hapticImpactLight()
              commands.setBlockKind(pill.kind)
            }}
            className={cn(
              'flex h-8 shrink-0 items-center rounded-full px-3 text-[14px] font-medium shadow-[0_0_0_0.5px_rgb(0_0_0/0.08),0_2px_8px_rgb(0_0_0/0.05)] transition-[transform,background-color] duration-150 active:scale-95 motion-reduce:transition-none',
              capabilities.blockKind === pill.kind
                ? 'bg-foreground text-background'
                : 'bg-background/90 text-text',
            )}
          >
            {pill.label}
          </button>
        ))}
      </div>
      <div className="mobile-nav-capsule flex h-[52px] items-center px-1">
        <div className="flex min-w-0 flex-1 items-center overflow-x-auto [scrollbar-width:none]">
          <ToolbarButton
            label="Link note"
            icon={<WikiLink className="size-[22px]" />}
            onPress={() => commands.insertTrigger('[[')}
          />
          <ToolbarButton
            label="Add type"
            icon={<Hash className="size-[22px]" />}
            onPress={() => commands.insertTrigger('#')}
          />
          {inList ? (
            <>
              <ToolbarButton
                label="Outdent"
                icon={<IndentDecrease className="size-[22px]" />}
                disabled={!capabilities.canDedent}
                onPress={commands.dedent}
              />
              <ToolbarButton
                label="Indent"
                icon={<IndentIncrease className="size-[22px]" />}
                disabled={!capabilities.canIndent}
                onPress={commands.indent}
              />
            </>
          ) : null}
          <span aria-hidden className="mx-1 h-6 w-px shrink-0 bg-border" />
          <ToolbarButton
            label="Dictate"
            icon={<Microphone className="size-[22px]" />}
            disabled={!memo.available}
            onPress={memo.toggle}
          />
          <ToolbarButton
            label="Undo"
            icon={<Undo className="size-[22px]" />}
            disabled={!capabilities.canUndo}
            onPress={commands.undo}
          />
          {capabilities.canAttachFiles && !inList ? (
            <ToolbarButton
              label="Insert image"
              icon={<ImageIcon className="size-[22px]" />}
              // `commands` is read here, not after the picker returns: the
              // sheet takes focus from the editor, which clears the published
              // toolbar, but the command still holds its own editor.
              onPress={() =>
                void pickFiles({ accept: 'image/*', multiple: true }).then(commands.attachFiles)
              }
            />
          ) : null}
        </div>
        <ToolbarButton
          label="Hide keyboard"
          icon={<ChevronDown className="size-[22px]" />}
          onPress={commands.dismissKeyboard}
        />
      </div>
    </div>
  )
}

const BLOCK_PILLS: { kind: FormattingBlockKind; label: string }[] = [
  { kind: 'text', label: 'Text' },
  { kind: 'heading', label: 'Heading' },
  { kind: 'bullet', label: '• List' },
  { kind: 'task', label: '☐ To-do' },
  { kind: 'quote', label: '❝ Quote' },
]

function ToolbarButton({
  label,
  icon,
  disabled = false,
  onPress,
}: {
  label: string
  icon: ReactElement
  disabled?: boolean
  onPress: () => void
}): ReactElement {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      // Focus must never leave the editor: cancelling pointerdown (and the
      // compatibility mousedown) stops the tap from moving focus, so the
      // keyboard — and with it this toolbar — can't dismiss mid-tap. The
      // dismiss button drops the keyboard explicitly via `editor.blur()`.
      onPointerDown={(event) => event.preventDefault()}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => {
        hapticImpactLight()
        onPress()
      }}
      className="flex size-11 shrink-0 items-center justify-center rounded-full text-text transition-transform duration-150 active:scale-90 active:bg-foreground/5 disabled:opacity-30 motion-reduce:transition-none"
    >
      {icon}
    </button>
  )
}
