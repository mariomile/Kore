import { vaultMediaKind, type VaultMediaKind } from '@kore/core'
import type { Node as ProseMirrorNode } from '@prosekit/pm/model'
import { Plugin, PluginKey, type EditorState, type Transaction } from '@prosekit/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@prosekit/pm/view'
import { memoByNode } from './node-memo'
import { claimPlayback, releasePlayback } from './playback'

/**
 * Vault video and audio in the live editor: a paragraph holding nothing but
 * an embedded media file (`![[demo.mp4]]`, `![](assets/memo.m4a)`) draws the
 * file's own player in front of it. The markdown keeps the embed, and the
 * paragraph (meowdown's file pill) hides until the caret is on it, the rule
 * link cards and callout markers follow. The player asks the vault only for
 * the file's first bytes (`preload="metadata"`) until it is played, and one
 * piece of media plays at a time across the note: vault files and link
 * players alike.
 */

export interface VaultMediaOptions {
  /** The URL the webview loads a vault file from, or null when it has none. */
  resolveUrl: (href: string) => string | null
}

interface VaultMediaState {
  readonly decorations: DecorationSet
  readonly focused: boolean
}

const vaultMediaKey = new PluginKey<VaultMediaState>('kore-vault-media')

const FILE_MARK = 'mdFile'

interface MediaParagraph {
  readonly href: string
  readonly name: string
  readonly kind: VaultMediaKind
}

/**
 * The media a paragraph plays, or null. Only a paragraph that is one file
 * embed qualifies: a file named inside a sentence stays a pill in it.
 */
export const paragraphMedia = memoByNode(mediaOf)

function mediaOf(paragraph: ProseMirrorNode): MediaParagraph | null {
  if (paragraph.type.name !== 'paragraph') {
    return null
  }
  let href: string | null = null
  let name = ''
  for (let index = 0; index < paragraph.childCount; index += 1) {
    const child = paragraph.child(index)
    if (!child.isText) {
      return null
    }
    if ((child.text ?? '').trim() === '') {
      continue
    }
    const mark = child.marks.find((candidate) => candidate.type.name === FILE_MARK)
    const markHref: unknown = mark?.attrs.href
    if (typeof markHref !== 'string' || (href !== null && href !== markHref)) {
      return null
    }
    const markName: unknown = mark?.attrs.name
    href = markHref
    name = typeof markName === 'string' && markName !== '' ? markName : markHref
  }
  const kind = href === null ? null : vaultMediaKind(href)
  return href === null || kind === null ? null : { href, name, kind }
}

/** Hand `media` the app's one playback slot whenever it plays. */
function playAlone(media: HTMLMediaElement): void {
  const pause = (): void => {
    media.pause()
  }
  media.addEventListener('play', () => {
    claimPlayback(pause)
  })
  media.addEventListener('pause', () => {
    releasePlayback(pause)
  })
}

function mediaElement(media: MediaParagraph, url: string): HTMLElement {
  const box = document.createElement('div')
  box.className = 'kore-vault-media'
  box.dataset.kind = media.kind
  box.contentEditable = 'false'
  const player = document.createElement(media.kind)
  player.className = 'kore-vault-media-player'
  player.src = url
  player.controls = true
  player.preload = 'metadata'
  if (player instanceof HTMLVideoElement) {
    player.playsInline = true
  }
  player.setAttribute('aria-label', media.name)
  playAlone(player)
  if (media.kind === 'audio') {
    const name = document.createElement('div')
    name.className = 'kore-vault-media-name'
    name.textContent = media.name
    box.append(name)
  }
  box.append(player)
  return box
}

function buildDecorations(
  state: EditorState,
  focused: boolean,
  options: VaultMediaOptions,
): DecorationSet {
  const { doc, selection } = state
  const decorations: Decoration[] = []
  const seen = new Map<string, number>()
  doc.descendants((node, pos) => {
    if (!node.isTextblock) {
      return true
    }
    const media = paragraphMedia(node)
    const url = media === null ? null : options.resolveUrl(media.href)
    if (media === null || url === null) {
      return false
    }
    // Keyed by file and copy, not position, so typing above a playing video
    // keeps it playing.
    const copy = seen.get(url) ?? 0
    seen.set(url, copy + 1)
    const end = pos + node.nodeSize
    const onLine = focused && selection.from <= end - 1 && selection.to >= pos + 1
    decorations.push(
      Decoration.widget(pos, () => mediaElement(media, url), {
        side: -1,
        ignoreSelection: true,
        stopEvent: () => true,
        key: `vault-media:${copy}:${url}`,
      }),
      Decoration.node(pos, end, {
        class: onLine ? 'kore-vault-media-source is-editing' : 'kore-vault-media-source',
      }),
    )
    return false
  })
  return DecorationSet.create(doc, decorations)
}

function readFocused(tr: Transaction): boolean | null {
  const meta: unknown = tr.getMeta(vaultMediaKey)
  return typeof meta === 'boolean' ? meta : null
}

function setFocused(view: EditorView, focused: boolean): boolean {
  if (vaultMediaKey.getState(view.state)?.focused !== focused) {
    view.dispatch(view.state.tr.setMeta(vaultMediaKey, focused))
  }
  return false
}

/** The ProseMirror plugin behind `VaultMedia`. */
export function createVaultMediaPlugin(options: VaultMediaOptions): Plugin<VaultMediaState> {
  return new Plugin<VaultMediaState>({
    key: vaultMediaKey,
    state: {
      init: (_config, state) => ({
        decorations: buildDecorations(state, false, options),
        focused: false,
      }),
      apply: (tr, previous, _oldState, newState) => {
        const meta = readFocused(tr)
        if (!tr.docChanged && !tr.selectionSet && meta === null) {
          return previous
        }
        const focused = meta ?? previous.focused
        return { decorations: buildDecorations(newState, focused, options), focused }
      },
    },
    view: (view) => {
      if (view.hasFocus()) {
        queueMicrotask(() => {
          if (!view.isDestroyed) setFocused(view, view.hasFocus())
        })
      }
      return {}
    },
    props: {
      decorations: (state) => vaultMediaKey.getState(state)?.decorations ?? DecorationSet.empty,
      handleDOMEvents: {
        focus: (view) => setFocused(view, true),
        blur: (view) => setFocused(view, false),
      },
    },
  })
}
