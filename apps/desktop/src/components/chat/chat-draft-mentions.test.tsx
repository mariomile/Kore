import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import type { NoteMentionPreview } from '@reflect/core'
import { TooltipProvider } from '@/components/ui/tooltip'

/**
 * The composer's mention chips: what the send will actually attach, resolved
 * from the draft before the message goes out.
 */

const previewNoteMentions = vi.hoisted(() =>
  vi.fn<(text: string) => Promise<NoteMentionPreview[]>>(),
)
vi.mock('@reflect/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@reflect/core')>()),
  previewNoteMentions,
}))
vi.mock('@/hooks/use-bridge-ready', () => ({ useBridgeReady: () => true }))
vi.mock('@/providers/graph-provider', () => ({
  useGraph: () => ({ graph: { root: '/graphs/test' }, indexGeneration: 1 }),
}))

const { ChatDraftMentions } = await import('./chat-draft-mentions')

function hooked(overrides: Partial<NoteMentionPreview>): NoteMentionPreview {
  return {
    target: 'Atlas',
    path: 'notes/atlas.md',
    title: 'Atlas',
    preview: 'Ships in June.',
    isPrivate: false,
    ...overrides,
  }
}

function renderChips(draft: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <ChatDraftMentions draft={draft} />
      </TooltipProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  previewNoteMentions.mockReset().mockResolvedValue([])
})

describe('ChatDraftMentions', () => {
  it('names the note a mention resolved to', async () => {
    previewNoteMentions.mockResolvedValue([hooked({ target: 'atlas', title: 'Project Atlas' })])
    const view = await renderChips('tell me about [[atlas]]')

    await expect.element(view.getByText('Project Atlas')).toBeVisible()
  })

  it('falls back to the typed target when nothing resolves', async () => {
    previewNoteMentions.mockResolvedValue([
      hooked({ target: 'Nope', path: null, title: null, preview: '' }),
    ])
    const view = await renderChips('see [[Nope]]')

    await expect.element(view.getByText('Nope')).toBeVisible()
  })

  it('renders nothing while the draft carries no mention', async () => {
    const view = await renderChips('plain text')

    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(view.getByText('plain text').query()).toBeNull()
    expect(previewNoteMentions).not.toHaveBeenCalled()
  })
})
