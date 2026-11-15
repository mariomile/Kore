import { useState } from 'react'
import { openUrl } from '@tauri-apps/plugin-opener'
import {
  clearGithubAuth,
  FINE_GRAINED_TOKENS_URL,
  githubAppInstallUrl,
  loadGithubAuth,
  newRepoUrl,
  type GithubRepoRef,
  type GithubUser,
} from '@kore/core'
import { useAsyncAction } from '@/hooks/use-async-action'
import { usePoll } from '@/hooks/use-poll'
import { invalidateGithubAuth } from '@/lib/github-auth-state'
import { parseRepoInput } from '@/lib/github-repos'
import { useSync } from '@/providers/sync-provider'

export type ConnectWizardStep = 'repo' | 'auth' | 'finish'

/** Which credential the sign-in stored — decides the can't-find-repo remedy. */
export type ConnectAuthKind = 'app' | 'pat' | null

/**
 * What the finish step shows — exactly one at a time, precedence encoded
 * here so no shell can order the branches differently. `publicConfirm` is
 * the consent gate for a public repo; `createGuide` is the github.com/new
 * handoff (a poll connects once the repo exists); `grantAccess` is the
 * GitHub-App installation handoff (same poll); `connecting` is the in-flight
 * connect; `idle` is where a failure's inline error (and its escape back to
 * the repo step) renders.
 */
export type ConnectFinishView =
  | { kind: 'publicConfirm'; repo: GithubRepoRef }
  | { kind: 'createGuide'; owner: string; name: string }
  | { kind: 'grantAccess'; repo: GithubRepoRef }
  | { kind: 'connecting' }
  | { kind: 'idle' }

export interface ConnectGithubWizardOptions {
  /** A suggested name for a newly created backup repo. */
  suggestedRepoName: string
  /** Called once the repository is connected (the surface dismisses itself). */
  onClose: () => void
  /** Delay between repo-existence polls on the create/grant handoffs (test hook). */
  pollIntervalMs?: number
  /**
   * The repository this vault already points at (an `origin` remote with no
   * sign-in yet): the wizard opens on "Use an existing repository" with it
   * filled in, so resuming never re-points the vault at a new repo.
   */
  initialRepo?: GithubRepoRef | null | undefined
}

export interface ConnectGithubWizard {
  step: ConnectWizardStep
  mode: 'create' | 'existing'
  setMode: (mode: 'create' | 'existing') => void
  repoName: string
  setRepoName: (name: string) => void
  existingRepo: string
  setExistingRepo: (value: string) => void
  /** The verified sign-in shown on the finish step; null before auth. */
  user: GithubUser | null
  authKind: ConnectAuthKind
  /** The finish step's current view — shells render it, never re-derive it. */
  finishView: ConnectFinishView
  pending: boolean
  error: string | null
  /** Validate the repo step and advance to sign-in. */
  continueFromRepo: () => void
  /** Wire to {@link GithubAuthStep}'s `onAuthed` — advances and connects. */
  onAuthed: (user: GithubUser) => void
  /** The public-repo consent button: retry the connect with consent given. */
  confirmPublic: () => void
  /** Back to the repo step — every finish-step dead end must offer this. */
  backToRepo: () => void
  /** Open the prefilled github.com/new page for the chosen name. */
  openCreatePage: () => void
  /** Open the GitHub App installation page (grant repository access). */
  openInstallPage: () => void
  /**
   * The repository the sign-in step's token instructions name: owner when
   * known (an existing `owner/name`), and whether it still has to be created
   * first (a fine-grained token can only include existing repositories).
   */
  tokenTarget: { owner: string | undefined; name: string | undefined; createFirst: boolean }
  /** Open the user's fine-grained tokens, where the saved token's repositories are edited. */
  openTokensPage: () => void
  /**
   * Forget the saved token and return to the sign-in step to paste another.
   * The credential is machine-wide, so this replaces it for every vault.
   */
  switchToken: () => void
}

/**
 * The "Connect GitHub" wizard state machine: repository first (creating one
 * needs no credential), then the sign-in (whose instructions can name that
 * exact repository), then the connection — built from the verified sign-in,
 * so the owner is never asked for. Extracted from rendering so desktop's
 * dialog and mobile's drawer drive the identical flow.
 *
 * Tokens that can create repositories (classic PATs, app tokens) connect in
 * one step: the finish step API-creates silently. Tokens that can't are
 * handed the prefilled github.com/new page while the wizard polls for the
 * repository and connects the moment it exists — there is no "I created it"
 * button to click. Connecting a public repo demands explicit confirmation:
 * every note in the graph, including `private: true` ones, would be
 * world-readable.
 *
 * Granting repository access is a first-class step, not an error. A GitHub App
 * user token only reaches repositories the app is installed on (authorization
 * ≠ installation), and a fresh install is on zero repos — so an app sign-in
 * that can't yet see the repo lands on a plain "grant access" step that polls
 * and connects the moment access is granted (no retry button to press). The
 * step is skipped whenever the repo is already visible, so a graph whose repo
 * the install already covers connects with no detour. A personal token
 * reaches repos by its own repository list instead, so the same step tells
 * the user to add the repo to that token (or paste a different one).
 */
export function useConnectGithubWizard({
  suggestedRepoName,
  onClose,
  pollIntervalMs = 3000,
  initialRepo = null,
}: ConnectGithubWizardOptions): ConnectGithubWizard {
  const { connectNewRepo, connectExistingRepo } = useSync()
  const action = useAsyncAction()
  const [step, setStep] = useState<ConnectWizardStep>('repo')
  const [mode, setMode] = useState<'create' | 'existing'>(
    initialRepo !== null ? 'existing' : 'create',
  )
  const [repoName, setRepoName] = useState(suggestedRepoName)
  const [existingRepo, setExistingRepo] = useState(
    initialRepo !== null ? `${initialRepo.owner}/${initialRepo.name}` : '',
  )
  const [user, setUser] = useState<GithubUser | null>(null)
  const [authKind, setAuthKind] = useState<ConnectAuthKind>(null)
  const [publicConfirm, setPublicConfirm] = useState<GithubRepoRef | null>(null)
  const [showCreateGuide, setShowCreateGuide] = useState(false)
  const [showGrantAccess, setShowGrantAccess] = useState(false)

  function targetRef(forUser: GithubUser): GithubRepoRef | null {
    if (mode === 'existing') {
      return parseRepoInput(existingRepo)
    }
    const name = repoName.trim()
    return name.length === 0 ? null : { owner: forUser.login, name }
  }

  // The repo we're trying to reach, resolved from the verified sign-in (the
  // owner is never typed). Drives both the poll and the grant-access copy.
  const targetForUser = user !== null ? targetRef(user) : null

  // While the create handoff or the grant-access step is showing, poll for the
  // repository instead of making the user click a button: the connect fires the
  // moment the repo exists and the app can see it. A 404 just keeps waiting; a
  // public repo stops the poll for consent.
  const pollTarget =
    (showCreateGuide || showGrantAccess) && publicConfirm === null ? targetForUser : null
  usePoll(pollTarget !== null, pollIntervalMs, async () => {
    if (pollTarget === null) {
      return 'stop'
    }
    const result = await connectExistingRepo(pollTarget, { allowPublic: false })
    if (result === 'connected') {
      onClose()
      return 'stop'
    }
    if (result === 'needsPublicConfirm') {
      setPublicConfirm(pollTarget)
      return 'stop'
    }
    return 'continue'
  })

  async function finish(
    forUser: GithubUser,
    options: { allowPublic?: boolean } = {},
  ): Promise<void> {
    await action.run(async () => {
      // Each attempt re-derives the guidance from its own outcome — a stale
      // create guide or grant-access step from an earlier path must not outlive
      // the detour (e.g. consent → choose another repo).
      setShowCreateGuide(false)
      setShowGrantAccess(false)
      const ref = publicConfirm ?? targetRef(forUser)
      if (ref === null) {
        action.setError(
          mode === 'existing'
            ? 'Enter the repository as owner/name or a GitHub URL.'
            : 'Name the repository.',
        )
        setStep('repo')
        return
      }
      const result = await connectExistingRepo(ref, { allowPublic: options.allowPublic ?? false })
      if (result === 'connected') {
        onClose()
        return
      }
      if (result === 'needsPublicConfirm') {
        setPublicConfirm(ref)
        return
      }
      if (mode === 'existing') {
        // GitHub's 404 can't distinguish "doesn't exist" from "no access". App
        // sign-ins almost always mean the latter — the app isn't installed on
        // the repo yet — so granting access is the expected next step, not an
        // error: show it plainly and let the poll connect the moment access
        // lands. A token likewise reaches repositories by its own repository list, which the
        // user edits on GitHub — the same wait-and-poll step, with token copy
        // (the finish step words it by `authKind`) and a way to swap tokens.
        setShowGrantAccess(true)
        return
      }
      // A new repo that doesn't exist yet: create it — by API when the token
      // can, by the guided handoff (plus polling) otherwise.
      const created = await connectNewRepo(ref.name)
      if (created === 'connected') {
        onClose()
        return
      }
      setShowCreateGuide(true)
    })
  }

  function continueFromRepo(): void {
    action.setError(null)
    if (mode === 'create' && repoName.trim().length === 0) {
      action.setError('Name the repository.')
      return
    }
    if (mode === 'existing' && parseRepoInput(existingRepo) === null) {
      action.setError('Enter the repository as owner/name or a GitHub URL.')
      return
    }
    setStep('auth')
  }

  function onAuthed(authedUser: GithubUser): void {
    setUser(authedUser)
    setStep('finish')
    void loadGithubAuth().then((auth) => {
      const kind = auth?.kind ?? null
      setAuthKind(kind)
      return finish(authedUser)
    })
  }

  function confirmPublic(): void {
    if (user !== null) {
      void finish(user, { allowPublic: true })
    }
  }

  function backToRepo(): void {
    action.setError(null)
    setPublicConfirm(null)
    setShowCreateGuide(false)
    setShowGrantAccess(false)
    setStep('repo')
  }

  /** Open in the browser; an opener failure surfaces the URL to visit by hand. */
  function openExternal(url: string): void {
    void openUrl(url).catch(() => {
      action.setError(`Couldn’t open the browser — visit ${url} yourself.`)
    })
  }

  function tokenTarget(): ConnectGithubWizard['tokenTarget'] {
    if (mode === 'existing') {
      const ref = parseRepoInput(existingRepo)
      return { owner: ref?.owner, name: ref?.name, createFirst: false }
    }
    const name = repoName.trim()
    return { owner: undefined, name: name.length > 0 ? name : undefined, createFirst: true }
  }

  // The parked handoffs outrank the transient states: a consent question or
  // an open poll must never be painted over by "Connecting…".
  const finishView: ConnectFinishView =
    publicConfirm !== null
      ? { kind: 'publicConfirm', repo: publicConfirm }
      : showCreateGuide && user !== null
        ? { kind: 'createGuide', owner: user.login, name: repoName.trim() }
        : showGrantAccess && targetForUser !== null
          ? { kind: 'grantAccess', repo: targetForUser }
          : action.pending
            ? { kind: 'connecting' }
            : { kind: 'idle' }

  return {
    step,
    mode,
    setMode,
    repoName,
    setRepoName,
    existingRepo,
    setExistingRepo,
    user,
    authKind,
    finishView,
    pending: action.pending,
    error: action.error,
    continueFromRepo,
    onAuthed,
    confirmPublic,
    backToRepo,
    openCreatePage: () => openExternal(newRepoUrl(repoName.trim())),
    openInstallPage: () => openExternal(githubAppInstallUrl()),
    tokenTarget: tokenTarget(),
    openTokensPage: () => openExternal(FINE_GRAINED_TOKENS_URL),
    switchToken: () => {
      void action.run(async () => {
        await clearGithubAuth()
        invalidateGithubAuth()
        setPublicConfirm(null)
        setShowCreateGuide(false)
        setShowGrantAccess(false)
        setUser(null)
        setAuthKind(null)
        setStep('auth')
      })
    },
  }
}
