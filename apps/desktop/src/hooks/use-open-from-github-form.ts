import { useState } from 'react'
import type { GithubRepoRef } from '@kore/core'
import { useAsyncAction } from '@/hooks/use-async-action'
import { useGithubConnected } from '@/hooks/use-github-connected'
import { parseRepoInput } from '@/lib/github-repos'

export interface OpenFromGithubForm {
  repo: string
  setRepo: (value: string) => void
  /** The typed repository, or null while the field isn't `owner/name` (or a URL). */
  ref: GithubRepoRef | null
  token: string
  setToken: (value: string) => void
  /**
   * A token is already stored on this device and the form will use it — the
   * token field is replaced by a "use another" affordance.
   */
  usingSavedToken: boolean
  /** Drop the saved token for this attempt and show the token field. */
  pasteAnotherToken: () => void
  canSubmit: boolean
  submit: () => void
  pending: boolean
  error: string | null
}

/**
 * The "Open from GitHub" form state shared by the desktop chooser card and
 * the iPhone onboarding sheet: a repository, a token (or the one already
 * saved on this device), one submit. `open` does the work — clone and open —
 * and throws for the form to show.
 */
export function useOpenFromGithubForm(
  open: (ref: GithubRepoRef, token: string | null) => Promise<unknown>,
): OpenFromGithubForm {
  const [repo, setRepo] = useState('')
  const [token, setToken] = useState('')
  const [anotherToken, setAnotherToken] = useState(false)
  const hasSavedToken = useGithubConnected()
  const action = useAsyncAction()

  const ref = parseRepoInput(repo)
  const usingSavedToken = hasSavedToken && !anotherToken
  const canSubmit = ref !== null && (usingSavedToken || token.trim().length > 0) && !action.pending

  function submit(): void {
    if (action.pending) {
      return
    }
    if (ref === null) {
      action.setError('Type the repository as owner/name.')
      return
    }
    if (!usingSavedToken && token.trim().length === 0) {
      action.setError('Paste a GitHub token first.')
      return
    }
    void action.run(async () => {
      await open(ref, usingSavedToken ? null : token.trim())
    })
  }

  return {
    repo,
    setRepo: (value) => {
      setRepo(value)
      action.setError(null)
    },
    ref,
    token,
    setToken: (value) => {
      setToken(value)
      action.setError(null)
    },
    usingSavedToken,
    pasteAnotherToken: () => setAnotherToken(true),
    canSubmit,
    submit,
    pending: action.pending,
    error: action.error,
  }
}
