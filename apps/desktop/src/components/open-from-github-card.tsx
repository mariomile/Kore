import {
  useEffect,
  useId,
  useState,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from 'react'
import { documentDir, join } from '@tauri-apps/api/path'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { OPEN_FROM_GITHUB_TOKEN_URL } from '@kore/core'
import { getIsComposing } from '@meowdown/core'
import { GithubMark } from '@/components/icons'
import { InlineAlert } from '@/components/inline-alert'
import { PublicRepoNotice } from '@/components/public-repo-notice'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { useHomeDir } from '@/hooks/use-home-dir'
import { useOpenFromGithubForm } from '@/hooks/use-open-from-github-form'
import { displayGraphPath } from '@/lib/graph-path-display'
import { openUrlSync } from '@/lib/open-url'
import { useGraph } from '@/providers/graph-provider'

const FIELD_LABEL_CLASS = 'text-xs font-medium text-text-secondary'

/** The parent folder a clone lands in until the user picks another. */
function useDefaultParent(): string | null {
  const [parent, setParent] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    void documentDir().then(
      (dir) => {
        if (active) {
          setParent(dir)
        }
      },
      () => {
        // No Documents folder to suggest: the card asks for a location.
      },
    )
    return () => {
      active = false
    }
  }, [])
  return parent
}

/**
 * The chooser's third path (F2 of the setup map): a vault that already lives
 * in a GitHub repository — another Mac's, or one an agent writes to. Type the
 * repository, paste a token (or reuse the one saved on this Mac), and Kore
 * clones it into Documents and opens it; sync is on from the first second
 * because `origin` already points at the repo.
 */
export function OpenFromGithubCard({
  header,
}: {
  /** The chooser's shared icon-chip header, rendered with this card's copy. */
  header: (props: { icon: ReactNode; title: string; children: ReactNode }) => ReactElement
}): ReactElement {
  const { openFromGithub } = useGraph()
  const home = useHomeDir()
  const defaultParent = useDefaultParent()
  const [pickedParent, setPickedParent] = useState<string | null>(null)
  const parent = pickedParent ?? defaultParent
  const repoId = useId()
  const tokenId = useId()

  const form = useOpenFromGithubForm(async (ref, token, options) => {
    if (parent === null) {
      throw new Error('Choose where to save the vault first.')
    }
    await openFromGithub(ref, token, await join(parent, ref.name), options)
  })

  async function chooseParent(): Promise<void> {
    const picked = await openDialog({
      directory: true,
      multiple: false,
      title: 'Choose where to save the vault',
      ...(parent === null ? {} : { defaultPath: parent }),
    })
    if (typeof picked === 'string') {
      setPickedParent(picked)
    }
  }

  function onEnter(event: KeyboardEvent): void {
    if (!getIsComposing() && event.key === 'Enter') {
      form.submit()
    }
  }

  const where =
    form.ref !== null && parent !== null
      ? displayGraphPath(`${parent}/${form.ref.name}`, home ?? undefined)
      : null

  return (
    <section className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-5 shadow-sm">
      {header({
        icon: <GithubMark aria-hidden className="size-4" />,
        title: 'GitHub',
        children: 'Open a vault you keep in a GitHub repository. It stays in sync.',
      })}

      <div className="mt-auto flex flex-col gap-3">
        <div className="space-y-1.5">
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
            disabled={form.pending}
            onChange={(event) => form.setRepo(event.target.value)}
            onKeyDown={onEnter}
          />
        </div>

        {form.usingSavedToken ? (
          <p className="text-xs text-text-muted">
            Uses the GitHub token saved on this Mac.{' '}
            <button
              type="button"
              className="font-medium text-text-secondary transition-colors hover:text-text"
              onClick={form.pasteAnotherToken}
              disabled={form.pending}
            >
              Use another
            </button>
          </p>
        ) : (
          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <label htmlFor={tokenId} className={FIELD_LABEL_CLASS}>
                Token
              </label>
              <button
                type="button"
                className="text-xs text-text-muted transition-colors hover:text-text-secondary"
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
              autoComplete="off"
              spellCheck={false}
              disabled={form.pending}
              onChange={(event) => form.setToken(event.target.value)}
              onKeyDown={onEnter}
            />
            <p className="text-xs text-text-muted">Fine-grained, with Contents read and write.</p>
          </div>
        )}

        <Button
          type="button"
          variant="outline"
          className="w-full"
          disabled={!form.canSubmit}
          onClick={form.submit}
        >
          {form.pending ? <Spinner /> : <GithubMark aria-hidden />}
          {form.pending ? 'Downloading…' : 'Open'}
        </Button>

        {form.ref !== null ? (
          <p className="flex min-w-0 items-center justify-center gap-1 text-xs text-text-muted">
            {where !== null ? (
              <>
                <span className="truncate" title={where}>
                  Saved to {where}
                </span>
                <span aria-hidden>·</span>
              </>
            ) : null}
            <button
              type="button"
              className="shrink-0 font-medium text-text-secondary transition-colors hover:text-text"
              onClick={() => void chooseParent()}
              disabled={form.pending}
            >
              {where !== null ? 'Change' : 'Choose where to save it'}
            </button>
          </p>
        ) : null}

        <PublicRepoNotice form={form} />
        {form.error !== null ? <InlineAlert tone="error">{form.error}</InlineAlert> : null}
      </div>
    </section>
  )
}
