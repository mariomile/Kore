import type { ReactElement } from 'react'
import { errorMessage } from '@reflect/core'
import { InlineAlert } from '@/components/inline-alert'
import { Button } from '@/components/ui/button'
import { useGraphRole } from '@/hooks/use-graph-role'
import { logCompanyCapture } from '@/lib/company-capture'
import { startOperation } from '@/lib/operations'
import { useGraph } from '@/providers/graph-provider'
import { useRouter } from '@/routing/router'

/**
 * Company graphs must not treat `daily/` as a shared diary. Shown on today's
 * stream row so a teammate who opens the day is pointed at named notes.
 */
export function CompanyDailyBanner(): ReactElement | null {
  const { role } = useGraphRole()
  const { graph } = useGraph()
  const { navigate } = useRouter()

  if (role !== 'company' || graph === null) {
    return null
  }

  const generation = graph.generation

  async function logDecision(): Promise<void> {
    try {
      const path = await logCompanyCapture('decision', generation)
      navigate({ kind: 'note', path })
    } catch (cause) {
      startOperation('Log a decision').fail(errorMessage(cause))
    }
  }

  return (
    <InlineAlert className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
      <span className="min-w-0 flex-1">
        This is a company graph. Capture as a named note — several people
        writing the same daily file will conflict.
      </span>
      <Button size="sm" variant="outline" onClick={() => void logDecision()}>
        Log a decision
      </Button>
    </InlineAlert>
  )
}
