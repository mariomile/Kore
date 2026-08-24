import type { ReactElement } from 'react'
import { errorMessage, isDaily } from '@reflect/core'
import { Button } from '@/components/ui/button'
import { useGraphRole } from '@/hooks/use-graph-role'
import { useNoteRow } from '@/hooks/use-note-row'
import { logCompanyCapture } from '@/lib/company-capture'
import { startOperation } from '@/lib/operations'
import { useGraph } from '@/providers/graph-provider'
import { useRouter } from '@/routing/router'
import { SidebarSection } from './sidebar-section'

interface CompanyApplySectionProps {
  /** The open note to distill into a decision or person. */
  path: string
}

/**
 * One Apply after a meeting (or any named note) on a company graph: write a
 * #decision or #person that links back. Daily notes stay off this path.
 */
export function CompanyApplySection({ path }: CompanyApplySectionProps): ReactElement | null {
  const { role } = useGraphRole()
  const { graph } = useGraph()
  const note = useNoteRow(path)
  const { navigate } = useRouter()

  if (role !== 'company' || graph === null || isDaily(path)) {
    return null
  }

  const title = note?.title?.trim() || 'Untitled'
  const generation = graph.generation

  async function apply(kind: 'decision' | 'person'): Promise<void> {
    const label = kind === 'decision' ? 'Save as a decision' : 'Save as a person'
    try {
      const created = await logCompanyCapture(
        kind,
        generation,
        kind === 'decision' ? `Decision: ${title}` : title,
        `From [[${title}]]`,
      )
      navigate({ kind: 'note', path: created })
    } catch (cause) {
      startOperation(label).fail(errorMessage(cause))
    }
  }

  return (
    <SidebarSection storageKey="company-apply" title="Company brain">
      <div className="flex flex-col gap-1.5 px-3">
        <Button type="button" variant="outline" size="sm" onClick={() => void apply('decision')}>
          Save as a decision
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => void apply('person')}>
          Save as a person
        </Button>
      </div>
    </SidebarSection>
  )
}
