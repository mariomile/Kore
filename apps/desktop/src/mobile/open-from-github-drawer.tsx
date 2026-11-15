import { useId, type KeyboardEvent, type ReactElement } from 'react'
import { OPEN_FROM_GITHUB_TOKEN_URL } from '@kore/core'
import { getIsComposing } from '@meowdown/core'
import { GithubMark } from '@/components/icons'
import { InlineAlert } from '@/components/inline-alert'
import { PublicRepoNotice } from '@/components/public-repo-notice'
import { Button } from '@/components/ui/button'
import { Drawer, DrawerBody, DrawerContent, DrawerTitle } from '@/components/ui/drawer'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { useOpenFromGithubForm } from '@/hooks/use-open-from-github-form'
import { openUrlSync } from '@/lib/open-url'
import { useGraph } from '@/providers/graph-provider'

interface OpenFromGithubDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const FIELD_LABEL_CLASS = 'text-xs font-medium text-text-secondary'

/**
 * Onboarding's "Open from GitHub" sheet: the same two fields as the desktop
 * chooser card (repository, token), one button. The vault is cloned onto
 * this iPhone and opened; it keeps syncing with the repository. The body
 * mounts per open, so a dismissed attempt never leaks into the next one.
 */
export function OpenFromGithubDrawer({
  open,
  onOpenChange,
}: OpenFromGithubDrawerProps): ReactElement {
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent aria-label="Open from GitHub">
        {open ? <OpenFromGithubSheet /> : null}
      </DrawerContent>
    </Drawer>
  )
}

function OpenFromGithubSheet(): ReactElement {
  const { completeOnboardingFromGithub } = useGraph()
  const form = useOpenFromGithubForm(completeOnboardingFromGithub)
  const repoId = useId()
  const tokenId = useId()

  function onEnter(event: KeyboardEvent): void {
    if (!getIsComposing() && event.key === 'Enter') {
      form.submit()
    }
  }

  return (
    <>
      <DrawerTitle>Open from GitHub</DrawerTitle>
      <DrawerBody>
        <p className="text-sm leading-6 text-text-secondary">
          Bring a vault you keep in a GitHub repository onto this iPhone. It stays in sync.
        </p>

        <div className="flex flex-col gap-1.5">
          <label htmlFor={repoId} className={FIELD_LABEL_CLASS}>
            Repository
          </label>
          <Input
            id={repoId}
            value={form.repo}
            placeholder="owner/repo"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="next"
            disabled={form.pending}
            onChange={(event) => form.setRepo(event.target.value)}
            onKeyDown={onEnter}
          />
        </div>

        {form.usingSavedToken ? (
          <p className="text-xs text-text-muted">
            Uses the GitHub token saved on this iPhone.{' '}
            <button
              type="button"
              className="min-h-11 font-medium text-text-secondary"
              onClick={form.pasteAnotherToken}
              disabled={form.pending}
            >
              Use another
            </button>
          </p>
        ) : (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <label htmlFor={tokenId} className={FIELD_LABEL_CLASS}>
                Token
              </label>
              <button
                type="button"
                className="-my-3 py-3 text-xs text-text-muted"
                onClick={() => openUrlSync(OPEN_FROM_GITHUB_TOKEN_URL)}
              >
                Get a token
              </button>
            </div>
            <Input
              id={tokenId}
              type="password"
              value={form.token}
              placeholder="github_pat_…"
              autoCapitalize="none"
              autoCorrect="off"
              autoComplete="off"
              spellCheck={false}
              enterKeyHint="go"
              disabled={form.pending}
              onChange={(event) => form.setToken(event.target.value)}
              onKeyDown={onEnter}
            />
            <p className="text-xs text-text-muted">Fine-grained, with Contents read and write.</p>
          </div>
        )}

        <Button size="lg" disabled={!form.canSubmit} onClick={form.submit}>
          {form.pending ? <Spinner /> : <GithubMark aria-hidden />}
          {form.pending ? 'Downloading your vault…' : 'Open'}
        </Button>

        <PublicRepoNotice form={form} />
        {form.error !== null ? <InlineAlert tone="error">{form.error}</InlineAlert> : null}
      </DrawerBody>
    </>
  )
}
