import type { ReactElement } from 'react'
import { Sparkles } from '@/components/icons'
import { InlineAlert } from '@/components/inline-alert'
import { Button } from '@/components/ui/button'
import { useGraphRole } from '@/hooks/use-graph-role'
import { isMobileSurface } from '@/lib/platform-surface'
import { useSettings } from '@/providers/settings-provider'

/**
 * One-tap embeddings opt-in on a company graph. Semantic search stays off
 * globally by default (~90MB download); company recall is the place to ask.
 * Mobile stays lexical — the model does not run on iOS.
 */
export function CompanySemanticBanner(): ReactElement | null {
  const { role } = useGraphRole()
  const { settings, updateSettings } = useSettings()

  if (role !== 'company' || settings.semanticSearchEnabled) {
    return null
  }

  if (isMobileSurface()) {
    return (
      <InlineAlert className="mx-auto mt-4 max-w-2xl">
        Semantic search runs on Mac. This phone searches by words; ask about #decision and #person
        notes and chat will still cite them.
      </InlineAlert>
    )
  }

  return (
    <InlineAlert className="mx-auto mt-4 flex max-w-2xl flex-wrap items-center gap-x-3 gap-y-2">
      <span className="min-w-0 flex-1">
        Turn on semantic search so “what did we decide?” can find meaning, not just keywords.
        Downloads a small on-device model (~90 MB) once.
      </span>
      <Button
        size="sm"
        variant="outline"
        onClick={() => updateSettings({ semanticSearchEnabled: true })}
      >
        <Sparkles aria-hidden className="size-3.5" />
        Enable semantic search
      </Button>
    </InlineAlert>
  )
}
