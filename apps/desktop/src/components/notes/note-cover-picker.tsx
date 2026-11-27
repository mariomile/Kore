import { useRef, useState, type DragEvent, type ReactElement, type ReactNode } from 'react'
import { parseNoteCover } from '@kore/core'
import { CloudUpload } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { HintedTrigger } from './hinted-trigger'
import { cn } from '@/lib/utils'

/**
 * Copies an image into the vault's attachment folder and returns its
 * vault-relative path, or null when the copy failed (the host reports why).
 */
export type CoverUpload = (file: File) => Promise<string | null>

const HTTPS_RE = /^https:\/\//i

/** The first image among dropped or picked files, if any. */
export function firstImageFile(files: FileList | null | undefined): File | null {
  for (const file of files ?? []) {
    if (file.type.startsWith('image/')) {
      return file
    }
  }
  return null
}

/**
 * An https image link as the `cover:` value, else null. Plain http and other
 * schemes are refused here even though the parser renders http: a cover is
 * fetched every time the note opens.
 */
export function coverLinkValue(text: string): string | null {
  const trimmed = text.trim()
  if (!HTTPS_RE.test(trimmed)) {
    return null
  }
  return parseNoteCover(trimmed)
}

/**
 * Whether a drag carries files. Only the types are readable until the drop,
 * so a dragged non-image still lights the target; the drop then ignores it.
 */
export function dragHasFiles(event: DragEvent): boolean {
  return event.dataTransfer.types.includes('Files')
}

interface NoteCoverPanelProps {
  /** A picked, uploaded, or linked cover, as the `cover:` value. */
  onPick: (cover: string) => void
  upload: CoverUpload
  /**
   * Sized for a finger (44pt controls) and without the drop hint, since
   * nothing can be dropped on a phone.
   */
  touch?: boolean
}

/**
 * The body of the cover chooser, shared by the Mac's popover and the
 * iPhone's sheet: upload an image (copied into the vault), paste an https
 * link, or drop an image.
 */
export function NoteCoverPanel({
  onPick,
  upload,
  touch = false,
}: NoteCoverPanelProps): ReactElement {
  const [link, setLink] = useState('')
  const [linkInvalid, setLinkInvalid] = useState(false)
  const [busy, setBusy] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const uploadFile = async (file: File | null): Promise<void> => {
    if (file === null || busy) {
      return
    }
    setBusy(true)
    try {
      const path = await upload(file)
      if (path !== null) {
        onPick(path)
      }
    } finally {
      setBusy(false)
    }
  }

  const submitLink = (): void => {
    const value = coverLinkValue(link)
    if (value === null) {
      setLinkInvalid(true)
      return
    }
    onPick(value)
  }

  const onDrop = (event: DragEvent): void => {
    if (!dragHasFiles(event)) {
      return
    }
    event.preventDefault()
    setDragOver(false)
    void uploadFile(firstImageFile(event.dataTransfer.files))
  }

  return (
    <>
      <div
        data-testid="cover-drop-zone"
        onDragOver={(event) => {
          if (!touch && dragHasFiles(event)) {
            event.preventDefault()
            setDragOver(true)
          }
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={touch ? undefined : onDrop}
        className={cn(
          'flex flex-col items-center gap-2 rounded-lg border border-dashed border-input px-3 py-4 text-center transition-colors',
          dragOver && 'border-border-focus bg-surface-hover',
        )}
      >
        <Button
          variant="outline"
          size={touch ? 'lg' : 'sm'}
          className={cn(touch && 'h-11 px-4 text-base')}
          disabled={busy}
          onClick={() => fileInput.current?.click()}
        >
          <CloudUpload aria-hidden />
          {busy ? 'Uploading…' : 'Upload image'}
        </Button>
        {touch ? null : <span className="text-xs text-text-muted">or drop an image here</span>}
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          aria-label="Cover image file"
          className="hidden"
          onChange={(event) => {
            const file = firstImageFile(event.currentTarget.files)
            event.currentTarget.value = ''
            void uploadFile(file)
          }}
        />
      </div>
      <form
        className="flex flex-col gap-1"
        onSubmit={(event) => {
          event.preventDefault()
          submitLink()
        }}
      >
        <div className="flex gap-1.5">
          <Input
            aria-label="Cover image link"
            placeholder="Paste an image link…"
            value={link}
            className={cn(touch && 'h-11 text-base')}
            aria-invalid={linkInvalid || undefined}
            onChange={(event) => {
              setLink(event.target.value)
              setLinkInvalid(false)
            }}
          />
          <Button
            type="submit"
            variant="secondary"
            className={cn(touch && 'h-11 px-4 text-base')}
            disabled={link.trim() === ''}
          >
            Use link
          </Button>
        </div>
        {linkInvalid ? (
          <span role="alert" className="text-xs text-destructive">
            Use an https link to an image.
          </span>
        ) : null}
      </form>
    </>
  )
}

interface NoteCoverPickerProps {
  onChange: (cover: string) => void
  upload: CoverUpload
  /** Accessible name of the trigger. */
  label: string
  /** What the trigger shows: an "Add cover" label or "Change". */
  children: ReactNode
  className?: string | undefined
  /** Show {@link label} as a tooltip too, for an icon-only trigger. */
  hinted?: boolean
  /** Which edge of the trigger the panel lines up with. */
  align?: 'start' | 'end'
}

/**
 * The note header's cover control: `children` as the trigger, opening
 * {@link NoteCoverPanel}. The choice lands through `onChange`, which writes
 * the note's `cover:` frontmatter. The panel mounts per opening, so a closed
 * picker forgets a half-typed link.
 */
export function NoteCoverPicker({
  onChange,
  upload,
  label,
  children,
  className,
  hinted = false,
  align = 'start',
}: NoteCoverPickerProps): ReactElement {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <HintedTrigger hint={hinted ? label : undefined}>
        <PopoverTrigger aria-label={label} className={className}>
          {children}
        </PopoverTrigger>
      </HintedTrigger>
      <PopoverContent align={align} className="w-80 gap-3">
        <NoteCoverPanel
          upload={upload}
          onPick={(cover) => {
            onChange(cover)
            setOpen(false)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}
