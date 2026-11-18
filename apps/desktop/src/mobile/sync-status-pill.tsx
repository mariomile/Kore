import type { ReactElement } from 'react'
import { AlertTriangle, CloudOff, Refresh, type Icon } from '@/components/icons'
import { cn } from '@/lib/utils'
import { useKeyboardVisible } from '@/mobile/use-keyboard'
import { useMobileSyncStatus } from '@/mobile/use-sync-status'
import type { MobileSyncStatus } from '@/mobile/sync-status'
import { useRouter } from '@/routing/router'

type VisibleKind = Exclude<MobileSyncStatus['kind'], 'synced'>

/**
 * One glyph per state, told apart by shape first and color second: the
 * arrows turn while notes move, the cloud is crossed out while there is no
 * connection, and the triangle is amber for a note edited on two devices,
 * red when sync failed. The same quiet-signal language as the desktop
 * sidebar footer dot.
 */
const GLYPHS: Record<VisibleKind, { icon: Icon; className: string }> = {
  syncing: {
    icon: Refresh,
    className: 'text-text-secondary motion-safe:animate-spin motion-safe:[animation-duration:1.6s]',
  },
  offline: { icon: CloudOff, className: 'text-warning' },
  review: { icon: AlertTriangle, className: 'text-warning' },
  error: { icon: AlertTriangle, className: 'text-danger' },
}

/**
 * The sync indicator (Plan 19, step 10): a small round icon that appears
 * only while sync has something to say, and nothing in the quiet `Synced`
 * state. No words on screen; the label is its accessible name and the
 * detail lives in Settings → Sync, which a tap opens. Positioning above the
 * tab bar belongs to {@link MobileStatusLayer}; the keyboard check here
 * backstops the layer's, keeping it correct if ever mounted alone.
 */
export function SyncStatusPill(): ReactElement | null {
  const status = useMobileSyncStatus()
  const keyboardVisible = useKeyboardVisible()

  if (status === null || status.kind === 'synced' || keyboardVisible) {
    return null
  }
  return <SyncIndicator kind={status.kind} label={status.label} />
}

/** The visible chip; split out so the router is only read while it shows. */
function SyncIndicator({ kind, label }: { kind: VisibleKind; label: string }): ReactElement {
  const { navigate } = useRouter()
  const glyph = GLYPHS[kind]
  const Glyph = glyph.icon
  return (
    <div role="status">
      <button
        type="button"
        onClick={() => navigate({ kind: 'settings' })}
        className={cn(
          // 30px chip, 44px hit area (HIG) via the invisible inset ring.
          'pointer-events-auto relative grid size-[30px] place-items-center rounded-full border border-border bg-surface shadow-sm',
          "before:absolute before:-inset-[7px] before:content-['']",
          'active:scale-95 motion-safe:transition-transform',
        )}
      >
        <Glyph aria-hidden size={16} strokeWidth={1.75} className={glyph.className} />
        <span className="sr-only">{label}</span>
      </button>
    </div>
  )
}
