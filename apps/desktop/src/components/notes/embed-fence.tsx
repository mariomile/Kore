import type { ReactElement } from 'react'
import type { EmbedBlock } from '@kore/core'
import { useFenceSourceCaret } from '@/editor/fence-source-caret'
import { EmbeddedMedia } from './embedded-media'

interface EmbedFenceProps {
  block: EmbedBlock
  privateNote: boolean
}

/**
 * An ` ```embed ` fence drawn in place by the editor's `renderCodeBlock`, so
 * a link card sits on the line where the link was written, not under the
 * note. A press on the card (outside its buttons) puts the caret in the
 * fence, which reveals the URL to edit, the same as a diagram.
 */
export function EmbedFence({ block, privateNote }: EmbedFenceProps): ReactElement {
  const editSource = useFenceSourceCaret()
  return (
    <div data-kore-embed="" data-testid="embed-fence" onMouseDown={editSource}>
      <EmbeddedMedia block={block} privateNote={privateNote} />
    </div>
  )
}
