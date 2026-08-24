import type { ReactElement } from 'react'
import { InlineAlert } from '@/components/inline-alert'
import { Button } from '@/components/ui/button'
import { useGraphRole } from '@/hooks/use-graph-role'
import { useSync } from '@/providers/sync-provider'
import { useRouter } from '@/routing/router'

/**
 * Nudge on a company graph that is not backing up: teammates only share
 * this vault once GitHub (or another git remote) is connected. Lock does
 * not hide notes from sync.
 */
export function CompanySyncBanner(): ReactElement | null {
  const { role } = useGraphRole()
  const { backup } = useSync()
  const { navigate } = useRouter()

  if (role !== 'company' || backup.phase !== 'disconnected') {
    return null
  }

  return (
    <InlineAlert className="mx-4 mt-3 mb-0 flex flex-wrap items-center gap-x-3 gap-y-2">
      <span className="min-w-0 flex-1">
        Connect GitHub so the team shares this graph. Lock keeps a note out of AI — it does not hide
        it from sync.
      </span>
      <Button size="sm" variant="outline" onClick={() => navigate({ kind: 'settings' })}>
        Connect GitHub
      </Button>
    </InlineAlert>
  )
}
