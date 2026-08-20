import { useEffect, useRef, useState, type ReactElement } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { codexLoginStatus, codexLogout, errorMessage, runCodexLogin } from '@reflect/core'
import { CircleCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { openUrlSync } from '@/lib/open-url'

const STATUS_QUERY_KEY = ['codex-auth-status']

/**
 * ChatGPT sign-in for the Codex provider, in-app: shows whether the local
 * CLI holds credentials, and runs the whole OAuth flow from a button — the
 * CLI starts its localhost callback server, we open the URL it prints in
 * the OS browser (where the user's ChatGPT session already lives), and the
 * flow resolves when the browser round-trip completes. Credentials stay
 * with the CLI; the app never sees or stores them.
 */
export function CodexSignIn(): ReactElement {
  const queryClient = useQueryClient()
  const status = useQuery({
    queryKey: STATUS_QUERY_KEY,
    queryFn: codexLoginStatus,
    retry: false,
    staleTime: 10_000,
  })
  const [pending, setPending] = useState(false)
  const [flowError, setFlowError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  // A pending login must not outlive the dialog — the CLI would keep its
  // callback server (and the port) alive headless.
  useEffect(
    () => () => {
      abortRef.current?.abort()
    },
    [],
  )

  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: STATUS_QUERY_KEY })
  }

  const signIn = (): void => {
    setPending(true)
    setFlowError(null)
    const controller = new AbortController()
    abortRef.current = controller
    void runCodexLogin({
      onAuthUrl: openUrlSync,
      signal: controller.signal,
    })
      .then((outcome) => {
        if (controller.signal.aborted) {
          return
        }
        if (!outcome.success) {
          setFlowError(outcome.message ?? 'Sign-in didn’t complete.')
        }
      })
      .catch((cause: unknown) => {
        setFlowError(errorMessage(cause))
      })
      .finally(() => {
        setPending(false)
        abortRef.current = null
        refresh()
      })
  }

  const cancel = (): void => {
    abortRef.current?.abort()
    abortRef.current = null
    setPending(false)
    refresh()
  }

  const signOut = (): void => {
    setPending(true)
    void codexLogout()
      .catch(() => {})
      .finally(() => {
        setPending(false)
        refresh()
      })
  }

  if (status.isPending) {
    return <p className="text-xs text-text-muted">Checking Codex sign-in…</p>
  }
  if (status.isError) {
    return (
      <p className="text-xs text-text-muted">
        Couldn’t check the Codex CLI — make sure <code>codex</code> is installed, then reopen this
        dialog.
      </p>
    )
  }

  if (pending) {
    return (
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 text-xs text-text-secondary">
          Finish signing in with ChatGPT in your browser…
        </p>
        <Button type="button" variant="outline" size="sm" onClick={cancel}>
          Cancel
        </Button>
      </div>
    )
  }

  if (status.data.loggedIn) {
    return (
      <div className="flex items-center gap-2">
        <CircleCheck aria-hidden strokeWidth={1.75} className="size-4 shrink-0 text-accent" />
        <p className="min-w-0 flex-1 text-xs text-text-secondary">
          {status.data.detail === '' ? 'Signed in with ChatGPT.' : status.data.detail}
        </p>
        <Button type="button" variant="outline" size="sm" onClick={signOut}>
          Sign out
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 text-xs text-text-secondary">
          Not signed in — chat needs the CLI’s ChatGPT credentials.
        </p>
        <Button type="button" size="sm" onClick={signIn}>
          Sign in with ChatGPT
        </Button>
      </div>
      {flowError !== null ? (
        <p role="alert" className="text-xs text-destructive">
          {flowError}
        </p>
      ) : null}
    </div>
  )
}
