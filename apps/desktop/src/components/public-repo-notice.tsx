import type { ReactElement } from 'react'
import { InlineAlert } from '@/components/inline-alert'
import { Button } from '@/components/ui/button'
import type { OpenFromGithubForm } from '@/hooks/use-open-from-github-form'

/**
 * The public-repository question both "Open from GitHub" surfaces ask before
 * cloning: syncing there publishes every note, `private: true` ones included.
 */
export function PublicRepoNotice({ form }: { form: OpenFromGithubForm }): ReactElement | null {
  if (form.publicRepo === null) {
    return null
  }
  return (
    <InlineAlert tone="warning" className="flex flex-col gap-2">
      <span>
        <strong>{form.publicRepo}</strong> is public. Anyone can read the notes Kore syncs there,
        including ones marked private.
      </span>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="self-start"
        disabled={form.pending}
        onClick={form.openPublicAnyway}
      >
        Open anyway
      </Button>
    </InlineAlert>
  )
}
