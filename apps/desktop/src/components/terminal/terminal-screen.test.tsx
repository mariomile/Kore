import { cleanup, render } from 'vitest-browser-react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

interface PtyDataEvent {
  id: string
  data: string
}

interface PtyExitEvent {
  id: string
  code: number | null
}

const mocks = vi.hoisted(() => ({
  ptyOpen: vi.fn(async () => ({ id: 'pty-1' })),
  ptyWrite: vi.fn(async () => undefined),
  ptyResize: vi.fn(async () => undefined),
  ptyClose: vi.fn(async () => undefined),
  unsubscribeData: vi.fn(),
  unsubscribeExit: vi.fn(),
  disposeInput: vi.fn(),
  disposeTerminal: vi.fn(),
  dataHandler: null as ((event: PtyDataEvent) => void) | null,
  exitHandler: null as ((event: PtyExitEvent) => void) | null,
}))

const terminal = vi.hoisted(() => ({
  element: undefined as HTMLElement | undefined,
  cols: 80,
  rows: 24,
  loadAddon: vi.fn(),
  onData: vi.fn(() => ({ dispose: mocks.disposeInput })),
  write: vi.fn(),
  writeln: vi.fn(),
  focus: vi.fn(),
  dispose: mocks.disposeTerminal,
  open: vi.fn((host: HTMLElement) => {
    terminal.element = document.createElement('div')
    host.appendChild(terminal.element)
  }),
}))

const fit = vi.hoisted(() => ({ fit: vi.fn() }))

vi.mock('@reflect/core', () => ({
  ptyOpen: mocks.ptyOpen,
  ptyWrite: mocks.ptyWrite,
  ptyResize: mocks.ptyResize,
  ptyClose: mocks.ptyClose,
  subscribePtyData: vi.fn(async (handler: (event: PtyDataEvent) => void) => {
    mocks.dataHandler = handler
    return mocks.unsubscribeData
  }),
  subscribePtyExit: vi.fn(async (handler: (event: PtyExitEvent) => void) => {
    mocks.exitHandler = handler
    return mocks.unsubscribeExit
  }),
}))

vi.mock('@xterm/xterm', () => ({
  Terminal: vi.fn(function TerminalMock() {
    return terminal
  }),
}))

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: vi.fn(function FitAddonMock() {
    return fit
  }),
}))

vi.mock('@/lib/platform-surface', () => ({
  isMobileSurface: () => false,
}))

const { resetTerminalSessionForTests, TerminalScreen } = await import('./terminal-screen')

beforeEach(() => {
  vi.clearAllMocks()
  terminal.element = undefined
  mocks.dataHandler = null
  mocks.exitHandler = null
})

afterEach(() => {
  resetTerminalSessionForTests()
  cleanup()
})

describe('TerminalScreen', () => {
  it('releases PTY listeners and input handlers when the shell exits', async () => {
    const view = await render(<TerminalScreen />)
    await vi.waitFor(() => expect(mocks.exitHandler).not.toBeNull())

    mocks.dataHandler?.({ id: 'pty-1', data: 'hello' })
    expect(terminal.write).toHaveBeenCalledWith('hello')

    mocks.exitHandler?.({ id: 'pty-1', code: 0 })

    expect(mocks.unsubscribeData).toHaveBeenCalledOnce()
    expect(mocks.unsubscribeExit).toHaveBeenCalledOnce()
    expect(mocks.disposeInput).toHaveBeenCalledOnce()
    await view.unmount()
  })
})
