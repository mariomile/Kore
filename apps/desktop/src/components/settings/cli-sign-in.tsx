import { useEffect, useRef, useState, type ReactElement } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { errorMessage } from '@kore/core'
import { CheckCircle } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { openUrlSync } from '@/lib/open-url'
import type { CliSignInFlow } from './cli-sign-in-flows'

interface CliSignInProps {
  flow: CliSignInFlow
}

/**
 * In-app sign-in for a subscription CLI (Claude Code, Codex): shows whether
 * the local CLI holds the user's own login and runs the CLI's OAuth flow
 * from a button. The CLI starts its localhost callback server, the browser
 * (where the user's account session already lives) completes it, and the
 * status re-checks when the flow resolves. Credentials stay with the CLI;
 * the app never sees or stores them.
 */
export function CliSignIn({ flow }: CliSignInProps): ReactElement {
  const queryClient = useQueryClient()
  const status = useQuery({
    queryKey: flow.queryKey,
    queryFn: flow.status,
    retry: false,
    staleTime: 10_000,
  })
  const [pending, setPending] = useState(false)
  const [authUrl, setAuthUrl] = useState<string | null>(null)
  const [flowError, setFlowError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  // A pending login must not outlive the view: the CLI would keep its
  // callback server (and the port) alive headless.
  useEffect(
    () => () => {
      abortRef.current?.abort()
    },
    [],
  )

  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: flow.queryKey })
  }

  const signIn = (): void => {
    setPending(true)
    setAuthUrl(null)
    setFlowError(null)
    const controller = new AbortController()
    abortRef.current = controller
    void flow
      .login({
        onAuthUrl: (url) => {
          setAuthUrl(url)
          if (!flow.cliOpensBrowser) {
            openUrlSync(url)
          }
        },
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
    void flow
      .logout()
      .catch(() => {})
      .finally(() => {
        setPending(false)
        refresh()
      })
  }

  if (status.isPending) {
    return <p className="text-xs text-text-muted">Checking {flow.cliName} sign-in…</p>
  }
  if (status.isError) {
    const detail = errorMessage(status.error)
    const missing = /was not found/i.test(detail)
    return (
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 text-xs text-text-muted">
          {missing
            ? `${flow.cliName} isn’t installed.`
            : `Couldn’t run ${flow.cliName}${detail === '' ? '' : ` (${detail})`}.`}{' '}
          Install it with <code className="whitespace-nowrap">{flow.installCommand}</code> in
          Terminal.
        </p>
        <Button type="button" variant="outline" size="sm" onClick={refresh}>
          Check again
        </Button>
      </div>
    )
  }

  if (pending) {
    return (
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 text-xs text-text-secondary">
          Finish signing in with {flow.accountName} in your browser…
        </p>
        {flow.cliOpensBrowser && authUrl !== null ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => openUrlSync(authUrl)}>
            Open page
          </Button>
        ) : null}
        <Button type="button" variant="outline" size="sm" onClick={cancel}>
          Cancel
        </Button>
      </div>
    )
  }

  if (status.data.loggedIn) {
    return (
      <div className="flex items-center gap-2">
        <CheckCircle aria-hidden className="size-4 shrink-0 text-accent" />
        <p className="min-w-0 flex-1 truncate text-xs text-text-secondary">
          {status.data.detail === '' ? `Signed in with ${flow.accountName}.` : status.data.detail}
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
          Not signed in. Chat uses your {flow.accountName} subscription through {flow.cliName}.
        </p>
        <Button type="button" size="sm" onClick={signIn}>
          Sign in with {flow.accountName}
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
