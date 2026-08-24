import type { ReactElement } from 'react'
import { COMPANY_CHAT_PROMPTS } from '@reflect/core'
import { Button } from '@/components/ui/button'
import { useGraphRole } from '@/hooks/use-graph-role'
import { useChatSession } from '@/providers/chat-provider'

/**
 * Canned company-brain questions. Shown on an empty chat so a teammate can
 * ask the vault without inventing the query.
 */
export function CompanyChatPrompts(): ReactElement | null {
  const { role } = useGraphRole()
  const { turns, setDraft } = useChatSession()

  if (role !== 'company' || turns.length > 0) {
    return null
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-wrap justify-center gap-2 px-6 py-6">
      {COMPANY_CHAT_PROMPTS.map((entry) => (
        <Button
          key={entry.label}
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setDraft(entry.prompt)}
        >
          {entry.label}
        </Button>
      ))}
    </div>
  )
}
