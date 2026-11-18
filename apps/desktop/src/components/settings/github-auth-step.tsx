import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { openUrl } from '@tauri-apps/plugin-opener'
import {
  isDeviceFlowConfigured,
  newRepoUrl,
  newSyncTokenUrl,
  saveGithubAuth,
  type GithubUser,
} from '@kore/core'
import { ExternalLink } from '@/components/icons'
import { InlineAlert } from '@/components/inline-alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAsyncAction } from '@/hooks/use-async-action'
import { useDeviceFlowAuth } from '@/hooks/use-device-flow-auth'
import { fetchSignedInUser } from '@/lib/github-account'
import { invalidateGithubAuth } from '@/lib/github-auth-state'

interface GithubAuthStepProps {
  /**
   * Fired with the verified identity once a credential is stored and GitHub
   * has confirmed it (or a valid one already was) — a mistyped token fails
   * right here, never at the first sync.
   */
  onAuthed: (user: GithubUser) => void
  /**
   * The backup repository the token should be scoped to, when the wizard
   * already knows it — the instructions name it instead of speaking
   * abstractly about "your backup repository".
   */
  repoName?: string | undefined
  /** The repository's owner when known (an existing `owner/name`) — the token's target. */
  repoOwner?: string | undefined
  /**
   * The wizard is creating a new repository. A fine-grained token can only
   * be scoped to repositories that already exist, so the token instructions
   * start with "create the repository" — in that order or the token can
   * never reach it.
   */
  createRepoFirst?: boolean | undefined
  /** Open on token entry even when the device flow is available (swapping a saved token). */
  startWithToken?: boolean | undefined
}

/**
 * The shared "sign in to GitHub" step (desktop's connect dialog and the
 * mobile connect drawer): the guided device flow when the GitHub App is
 * registered, fine-grained-PAT entry otherwise. Every path ends in a `GET /user` round-trip
 * ({@link fetchSignedInUser}), so the step only completes with a credential
 * GitHub actually accepts — and the caller learns *who* signed in, which the
 * wizard uses to connect `owner/name` without ever asking for the owner.
 */
export function GithubAuthStep({
  onAuthed,
  repoName,
  repoOwner,
  createRepoFirst = false,
  startWithToken = false,
}: GithubAuthStepProps): ReactElement {
  const deviceFlow = useDeviceFlowAuth()
  const pat = useAsyncAction()
  const [patValue, setPatValue] = useState('')
  // The device flow leads when the app is registered; the PAT path stays one
  // click away (some users prefer a scoped token; GHES needs it).
  const [usePat, setUsePat] = useState(startWithToken || !isDeviceFlowConfigured())
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  /** Opening the browser failed — show the URL, the only way left to get there. */
  const [openFailed, setOpenFailed] = useState(false)
  /** A token-step link the browser couldn't open — shown so the user can visit it by hand. */
  const [linkFailed, setLinkFailed] = useState<string | null>(null)
  const authedRef = useRef(false)

  // Auth can complete twice — the mount-time probe of a stored credential
  // racing a fresh sign-in — and the parent advances (and connects) on every
  // call, so completion must be single-shot.
  function reportAuthed(user: GithubUser): void {
    if (authedRef.current) {
      return
    }
    authedRef.current = true
    onAuthed(user)
  }

  // Already signed in with a working credential (e.g. connecting a second
  // graph) → skip the step. A stored-but-rejected credential is cleared by
  // fetchSignedInUser, so the step stays visible and explains itself.
  useEffect(() => {
    let cancelled = false
    void fetchSignedInUser()
      .then((user) => {
        if (!cancelled && user !== null) {
          reportAuthed(user)
        }
      })
      .catch(() => {
        // Leave the step visible; the user signs in fresh.
      })
    return () => {
      cancelled = true
    }
    // onAuthed is a parent callback; subscribing once on mount is intended.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function verifyAndFinish(): Promise<void> {
    const user = await fetchSignedInUser()
    if (user === null) {
      throw new Error('GitHub rejected that token — check it and try again.')
    }
    reportAuthed(user)
  }

  async function signIn(): Promise<void> {
    setCopyState('idle') // each attempt mints a fresh code
    setOpenFailed(false)
    if (await deviceFlow.signIn()) {
      await pat.run(verifyAndFinish)
    }
  }

  /**
   * The code goes to the clipboard *before* the browser opens — GitHub's
   * device page asks for it immediately, and once the browser has focus the
   * code in this dialog is out of sight. If copying isn't possible, hold the
   * handoff and have the user copy by hand first.
   */
  async function copyCodeAndOpen(flow: {
    userCode: string
    verificationUri: string
  }): Promise<void> {
    if (copyState !== 'failed') {
      try {
        await navigator.clipboard.writeText(flow.userCode)
        setCopyState('copied')
      } catch {
        setCopyState('failed')
        return
      }
    }
    setOpenFailed(false)
    const uri = flow.verificationUri
    if (uri.startsWith('https://') || uri.startsWith('http://')) {
      void openUrl(uri).catch(() => {
        setOpenFailed(true)
      })
    }
  }

  async function savePat(): Promise<void> {
    const token = patValue.trim()
    if (token.length === 0) {
      pat.setError('Paste a token first.')
      return
    }
    // Keychain writes can fail (locked keychain, denied access) and GitHub
    // can reject the token — the action envelope surfaces both inline.
    await pat.run(async () => {
      await saveGithubAuth({ kind: 'pat', token })
      invalidateGithubAuth()
      await verifyAndFinish()
    })
  }

  function openLink(url: string): void {
    setLinkFailed(null)
    void openUrl(url).catch(() => {
      setLinkFailed(url)
    })
  }

  const error = deviceFlow.error ?? pat.error
  const repoLabel = repoName !== undefined && repoName.length > 0 ? repoName : null
  const showCreateRepo = createRepoFirst && repoLabel !== null
  const flowView = deviceFlow.view

  return (
    <div className="flex flex-col gap-3">
      {flowView.view === 'idle' ? (
        !usePat ? (
          <>
            <Button
              onClick={() => void signIn()}
              disabled={deviceFlow.busy || pat.pending}
              size="sm"
            >
              Sign in with GitHub
            </Button>
            <button
              type="button"
              className="text-left text-xs text-text-muted underline"
              onClick={() => setUsePat(true)}
            >
              Use a personal access token instead
            </button>
          </>
        ) : (
          <>
            <ol className="flex flex-col gap-3">
              {showCreateRepo ? (
                <TokenStep
                  n={1}
                  title={`Create ${repoLabel} on GitHub`}
                  hint="Do this first: a token can only include repositories that already exist."
                >
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() => openLink(newRepoUrl(repoLabel))}
                  >
                    <ExternalLink aria-hidden />
                    Create repository
                  </Button>
                </TokenStep>
              ) : null}
              <TokenStep
                n={showCreateRepo ? 2 : 1}
                title="Create a token"
                hint={
                  <>
                    On GitHub, under Repository access, choose{' '}
                    <strong>Only select repositories</strong> →{' '}
                    {repoLabel !== null ? <strong>{repoLabel}</strong> : 'your sync repository'}.
                    Everything else is already filled in. It lasts a year.
                  </>
                }
              >
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() => openLink(newSyncTokenUrl({ owner: repoOwner, name: repoName }))}
                >
                  <ExternalLink aria-hidden />
                  Create token
                </Button>
              </TokenStep>
              <TokenStep
                n={showCreateRepo ? 3 : 2}
                title="Paste it here"
                hint="It stays in this Mac’s keychain, never in your vault."
              >
                <div className="flex w-full gap-2">
                  <Input
                    autoFocus
                    type="password"
                    aria-label="Personal access token"
                    value={patValue}
                    onChange={(event) => setPatValue(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                        void savePat()
                      }
                    }}
                    placeholder="github_pat_…"
                  />
                  <Button
                    onClick={() => void savePat()}
                    disabled={pat.pending}
                    size="sm"
                    className="shrink-0"
                  >
                    {pat.pending ? 'Checking…' : 'Save token'}
                  </Button>
                </div>
              </TokenStep>
            </ol>
            {linkFailed !== null ? (
              <p className="select-text text-xs text-text-muted">
                Couldn’t open the browser. Visit {linkFailed} yourself.
              </p>
            ) : null}
            {isDeviceFlowConfigured() ? (
              <button
                type="button"
                className="text-left text-xs text-text-muted underline"
                onClick={() => setUsePat(false)}
              >
                Sign in with GitHub instead
              </button>
            ) : null}
          </>
        )
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-text-muted">
            {copyState === 'copied'
              ? 'Code copied — paste it on the GitHub page:'
              : 'GitHub will ask for this one-time code:'}
          </p>
          <p className="select-text text-center font-mono text-xl tracking-[0.3em] text-text">
            {flowView.userCode}
          </p>
          <Button size="sm" onClick={() => void copyCodeAndOpen(flowView)}>
            {copyState === 'failed' ? 'Open GitHub' : 'Copy code and open GitHub'}
          </Button>
          {copyState === 'failed' ? (
            <p className="text-xs text-text-muted">
              Couldn’t copy automatically — select the code above and copy it first.
            </p>
          ) : null}
          {openFailed ? (
            <p className="select-text text-xs text-text-muted">
              Couldn’t open the browser — visit {flowView.verificationUri} yourself.
            </p>
          ) : null}
        </div>
      )}
      {error !== null ? <InlineAlert tone="error">{error}</InlineAlert> : null}
    </div>
  )
}

/** One numbered instruction of the token path, with its optional action. */
function TokenStep({
  n,
  title,
  hint,
  children,
}: {
  n: number
  title: string
  hint: ReactNode
  children?: ReactNode
}): ReactElement {
  return (
    <li className="flex gap-2.5">
      <span
        aria-hidden
        className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-2xs font-semibold text-text-secondary tabular-nums"
      >
        {n}
      </span>
      <div className="flex min-w-0 flex-1 flex-col items-start gap-1.5">
        <p className="text-sm font-medium text-text">{title}</p>
        <p className="text-xs text-text-muted">{hint}</p>
        {children}
      </div>
    </li>
  )
}
