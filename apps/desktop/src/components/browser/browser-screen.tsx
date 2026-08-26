import { useState, type FormEvent, type ReactElement } from 'react'
import { errorMessage, openBrowserWindow } from '@reflect/core'
import { urlForInput } from '@/components/browser/browser-url'
import { Globe } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { startOperation } from '@/lib/operations'
import { useSettings } from '@/providers/settings-provider'

/**
 * The Browser tab's page: a new-tab empty state with a URL/search field.
 * Pages themselves still load in the isolated native window (no IPC, http(s)
 * only) so arbitrary web content never shares the notes webview. Submitting
 * here raises that window; closing the Browser tab closes those windows.
 */
export function BrowserScreen(): ReactElement {
  const { settings } = useSettings()
  const [draft, setDraft] = useState('')

  const handleSubmit = (event: FormEvent): void => {
    event.preventDefault()
    const url = urlForInput(draft, settings.browserSearchEngine)
    if (url === null) {
      return
    }
    void openBrowserWindow(url).catch((cause: unknown) => {
      startOperation('Open page').fail(errorMessage(cause))
    })
  }

  return (
    <div
      className="flex h-full flex-col items-center justify-center px-6"
      data-testid="browser-screen"
    >
      <Globe aria-hidden className="size-8 text-text-muted" />
      <h1 className="mt-4 text-xl font-semibold tracking-tight text-text">Browser</h1>
      <p className="mt-1 max-w-sm text-center text-sm text-text-muted">
        Search the web or enter a URL. Pages open in a separate window, away from your notes.
      </p>
      <form onSubmit={handleSubmit} className="mt-6 flex w-full max-w-md gap-2">
        <Input
          type="text"
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value)
          }}
          placeholder="Search or enter a URL"
          aria-label="Search or enter a URL"
          autoFocus
        />
        <Button type="submit" disabled={draft.trim() === ''}>
          Open
        </Button>
      </form>
    </div>
  )
}
