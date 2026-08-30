import { afterEach, describe, expect, it, vi } from 'vitest'
import { setBridge } from '../../ipc/bridge'
import type { ChatAttachment } from './transcript'
import {
  deleteChatAttachmentFiles,
  persistChatAttachmentFile,
  readChatAttachmentDataUrl,
} from './attachment-files'

afterEach(() => {
  setBridge(null)
})

function bridgeWith<T extends (command: string, args: Record<string, unknown>) => Promise<unknown>>(
  invoke: T,
): T {
  setBridge({ invoke, invokeBinary: async () => null, listen: async () => () => {} })
  return invoke
}

const fresh: ChatAttachment = {
  id: 'att-1',
  name: 'cat.png',
  mediaType: 'image/png',
  dataUrl: 'data:image/png;base64,iVBORw==',
}

describe('persistChatAttachmentFile', () => {
  it('writes the base64 payload and returns the attachment with its path', async () => {
    const invoke = bridgeWith(vi.fn(async () => '.reflect/chat-attachments/conv-1/att-1.png'))

    const persisted = await persistChatAttachmentFile('conv-1', fresh, 7)

    expect(invoke).toHaveBeenCalledWith('chat_attachment_write', {
      conversationId: 'conv-1',
      fileName: 'att-1.png',
      bytesBase64: 'iVBORw==',
      generation: 7,
    })
    expect(persisted).toEqual({ ...fresh, path: '.reflect/chat-attachments/conv-1/att-1.png' })
  })

  it('leaves unknown media types, byte-less, and already-persisted attachments alone', async () => {
    const invoke = bridgeWith(vi.fn(async () => 'unused'))

    const tiff = { ...fresh, mediaType: 'image/tiff', dataUrl: 'data:image/tiff;base64,AA==' }
    const pathOnly = { ...fresh, dataUrl: undefined, path: 'already/there.png' }
    const byteless = { ...fresh, dataUrl: undefined }
    expect(await persistChatAttachmentFile('conv-1', tiff, 7)).toBe(tiff)
    expect(await persistChatAttachmentFile('conv-1', pathOnly, 7)).toBe(pathOnly)
    expect(await persistChatAttachmentFile('conv-1', byteless, 7)).toBe(byteless)
    expect(invoke).not.toHaveBeenCalled()
  })
})

describe('readChatAttachmentDataUrl', () => {
  it('rebuilds the data URL from the read-back bytes', async () => {
    bridgeWith(vi.fn(async () => 'iVBORw=='))

    const dataUrl = await readChatAttachmentDataUrl(
      { ...fresh, dataUrl: undefined, path: '.reflect/chat-attachments/conv-1/att-1.png' },
      7,
    )

    expect(dataUrl).toBe('data:image/png;base64,iVBORw==')
  })
})

describe('deleteChatAttachmentFiles', () => {
  it('deletes by conversation id', async () => {
    const invoke = bridgeWith(vi.fn(async () => null))

    await deleteChatAttachmentFiles('conv-1', 7)

    expect(invoke).toHaveBeenCalledWith('chat_attachments_delete', {
      conversationId: 'conv-1',
      generation: 7,
    })
  })
})
