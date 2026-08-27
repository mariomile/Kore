import { render } from 'vitest-browser-react'
import { page } from 'vitest/browser'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { setBridge } from '@reflect/core'
import { MemoryField } from './memory-field'

interface HelperPayload {
  pid: number
  parentPid: number
  rssKb: number
  command: string
}

let rssKb: number
let helpers: HelperPayload[]
let failure: string | null

function installFakeBridge(): void {
  setBridge({
    invoke: async (command) => {
      if (command !== 'memory_report') {
        throw new Error(`unexpected command ${command}`)
      }
      if (failure !== null) {
        throw new Error(failure)
      }
      return {
        pid: 100,
        rssKb,
        helpers,
        helpersRssKb: helpers.reduce((total, helper) => total + helper.rssKb, 0),
      }
    },
    listen: async () => () => {},
  })
}

async function renderField(): Promise<void> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  await render(
    <QueryClientProvider client={queryClient}>
      <MemoryField />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  rssKb = 512 * 1024
  helpers = []
  failure = null
  installFakeBridge()
})

afterEach(() => {
  setBridge(null)
})

describe('MemoryField', () => {
  it('reports the app footprint on mount', async () => {
    await renderField()

    await expect.element(page.getByText('512 MB')).toBeInTheDocument()
    await expect.element(page.getByText('No helper processes.')).toBeInTheDocument()
  })

  it('names each helper process and the footprint they add up to', async () => {
    helpers = [
      { pid: 201, parentPid: 100, rssKb: 900 * 1024, command: '/usr/local/bin/node' },
      { pid: 202, parentPid: 201, rssKb: 124 * 1024, command: '/bin/zsh' },
    ]
    await renderField()

    await expect.element(page.getByText('2 helper processes')).toBeInTheDocument()
    await expect.element(page.getByText('1.0 GB')).toBeInTheDocument()
    await expect.element(page.getByText('node #201')).toBeInTheDocument()
    await expect.element(page.getByText('zsh #202')).toBeInTheDocument()
  })

  it('re-reads the process table on demand', async () => {
    await renderField()
    await expect.element(page.getByText('512 MB')).toBeInTheDocument()

    rssKb = 700 * 1024
    await page.getByRole('button', { name: /refresh/i }).click()

    await expect.element(page.getByText('700 MB')).toBeInTheDocument()
  })

  it('says so when the process table cannot be read', async () => {
    failure = 'ps is unavailable'
    await renderField()

    await expect.element(page.getByText(/ps is unavailable/)).toBeInTheDocument()
  })
})
