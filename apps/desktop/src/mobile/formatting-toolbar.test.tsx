import { cleanup, render } from 'vitest-browser-react'
import { page } from 'vitest/browser'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearFormattingToolbar,
  publishFormattingToolbar,
  type FormattingToolbar,
} from '@/editor/formatting-toolbar-store'
import { pickFiles } from '@/lib/pick-files'
import { fireEvent } from '@/test-utils/fire-event'
import { MobileFormattingToolbar } from './formatting-toolbar'
import { act } from '@/test-utils/act'

vi.mock('@/mobile/haptics', () => ({ hapticImpactLight: vi.fn() }))
vi.mock('@/lib/pick-files', () => ({ pickFiles: vi.fn(async () => []) }))
const memo = vi.hoisted(() => ({ available: true, toggle: vi.fn() }))
vi.mock('@/mobile/audio-memo-provider', () => ({ useMobileAudioMemo: () => memo }))

function makeToolbar(
  capabilities: Partial<FormattingToolbar['capabilities']> = {},
): FormattingToolbar {
  return {
    capabilities: {
      canIndent: true,
      canDedent: true,
      canMoveUp: true,
      canMoveDown: true,
      canAttachFiles: true,
      blockKind: 'text',
      canUndo: true,
      ...capabilities,
    },
    commands: {
      cycleBulletOrderedList: vi.fn(),
      cycleCheckableList: vi.fn(),
      indent: vi.fn(),
      dedent: vi.fn(),
      moveUp: vi.fn(),
      moveDown: vi.fn(),
      insertTrigger: vi.fn(),
      setBlockKind: vi.fn(),
      undo: vi.fn(),
      dismissKeyboard: vi.fn(),
      attachFiles: vi.fn(),
      scrollCaretIntoView: vi.fn(),
    },
  }
}

const owner = Symbol('toolbar-test')

afterEach(() => {
  cleanup()
  clearFormattingToolbar(owner)
  vi.clearAllMocks()
})

describe('MobileFormattingToolbar', () => {
  it('renders nothing while no editor is focused (the search keyboard case)', async () => {
    const view = await render(<MobileFormattingToolbar />)
    expect(view.container.firstChild).toBeNull()
  })

  it('renders the block pills over the capsule, with canExec-driven enablement', async () => {
    const toolbar = makeToolbar({ blockKind: 'bullet', canDedent: false, canUndo: false })
    await render(<MobileFormattingToolbar />)
    await act(() => publishFormattingToolbar(owner, toolbar))

    const buttons = page.getByRole('button').elements()
    expect(
      buttons.map((button) => button.getAttribute('aria-label') ?? button.textContent),
    ).toEqual([
      'Text',
      'Heading',
      '• List',
      '○ To-do',
      '❝ Quote',
      'Link note',
      'Add type',
      'Outdent',
      'Indent',
      'Dictate',
      'Undo',
      // No image button on a list line: the capsule would overflow and
      // push Undo out of sight.
      'Hide keyboard',
    ])
    await expect
      .element(page.getByRole('button', { name: '• List' }))
      .toHaveAttribute('aria-pressed', 'true')
    await expect.element(page.getByRole('button', { name: 'Outdent' })).toBeDisabled()
    await expect.element(page.getByRole('button', { name: 'Undo' })).toBeDisabled()
    await expect.element(page.getByRole('button', { name: 'Indent' })).toBeEnabled()
  })

  it('offers the image button and no indent controls on a text line', async () => {
    await render(<MobileFormattingToolbar />)
    await act(() => publishFormattingToolbar(owner, makeToolbar({ blockKind: 'text' })))

    await expect.element(page.getByRole('button', { name: 'Insert image' })).toBeVisible()
    expect(page.getByRole('button', { name: 'Indent' }).query()).toBeNull()
  })

  it('never lets a tap move focus out of the editor', async () => {
    await render(<MobileFormattingToolbar />)
    await act(() => publishFormattingToolbar(owner, makeToolbar()))

    // fireEvent returns false when a handler called preventDefault — the
    // contract that keeps the editor focused (and the keyboard up) mid-tap.
    for (const name of ['Link note', 'Heading']) {
      const button = page.getByRole('button', { name, exact: true })
      expect(fireEvent.pointerDown(button)).toBe(false)
      expect(fireEvent.mouseDown(button)).toBe(false)
    }
  })

  it('routes taps to the published commands', async () => {
    const toolbar = makeToolbar()
    await render(<MobileFormattingToolbar />)
    await act(() => publishFormattingToolbar(owner, toolbar))

    fireEvent.click(page.getByRole('button', { name: '○ To-do' }))
    expect(toolbar.commands.setBlockKind).toHaveBeenCalledWith('task')

    fireEvent.click(page.getByRole('button', { name: 'Heading' }))
    expect(toolbar.commands.setBlockKind).toHaveBeenCalledWith('heading')

    fireEvent.click(page.getByRole('button', { name: 'Link note' }))
    expect(toolbar.commands.insertTrigger).toHaveBeenCalledWith('[[')

    fireEvent.click(page.getByRole('button', { name: 'Add type' }))
    expect(toolbar.commands.insertTrigger).toHaveBeenCalledWith('#')

    fireEvent.click(page.getByRole('button', { name: 'Undo' }))
    expect(toolbar.commands.undo).toHaveBeenCalledOnce()

    fireEvent.click(page.getByRole('button', { name: 'Dictate' }))
    expect(memo.toggle).toHaveBeenCalledOnce()

    fireEvent.click(page.getByRole('button', { name: 'Hide keyboard' }))
    expect(toolbar.commands.dismissKeyboard).toHaveBeenCalledOnce()
  })

  it('hides the image button for an editor that cannot persist files', async () => {
    await render(<MobileFormattingToolbar />)
    await act(() => publishFormattingToolbar(owner, makeToolbar({ canAttachFiles: false })))

    expect(page.getByRole('button', { name: 'Insert image' }).query()).toBeNull()
  })

  it('hands the picked images to the editor', async () => {
    const picked = [new File(['png'], 'photo.png', { type: 'image/png' })]
    vi.mocked(pickFiles).mockResolvedValueOnce(picked)
    const toolbar = makeToolbar()
    await render(<MobileFormattingToolbar />)
    await act(() => publishFormattingToolbar(owner, toolbar))

    fireEvent.click(page.getByRole('button', { name: 'Insert image' }))

    expect(pickFiles).toHaveBeenCalledWith({ accept: 'image/*', multiple: true })
    await vi.waitFor(() => {
      expect(toolbar.commands.attachFiles).toHaveBeenCalledWith(picked)
    })
  })
})
