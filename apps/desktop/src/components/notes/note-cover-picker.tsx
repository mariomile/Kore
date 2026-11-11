import { useRef, useState, type DragEvent, type ReactElement, type ReactNode } from 'react'
import { parseNoteCover } from '@kore/core'
import { CloudUpload } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
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

interface NoteCoverPickerProps {
  onChange: (cover: string) => void
  upload: CoverUpload
  /** Accessible name of the trigger. */
  label: string
  /** What the trigger shows: an "Add cover" label or "Change". */
  children: ReactNode
  className?: string | undefined
}

/**
 * The note header's cover control: `children` as the trigger, opening a
 * panel to upload an image (copied into the vault), paste an https link, or
 * drop an image. The choice lands through `onChange`, which writes the
 * note's `cover:` frontmatter.
 */
export function NoteCoverPicker({
  onChange,
  upload,
  label,
  children,
  className,
}: NoteCoverPickerProps): ReactElement {
  const [open, setOpen] = useState(false)
  const [link, setLink] = useState('')
  const [linkInvalid, setLinkInvalid] = useState(false)
  const [busy, setBusy] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const changeOpen = (next: boolean): void => {
    setOpen(next)
    if (!next) {
      setLink('')
      setLinkInvalid(false)
      setDragOver(false)
    }
  }

  const uploadFile = async (file: File | null): Promise<void> => {
    if (file === null || busy) {
      return
    }
    setBusy(true)
    try {
      const path = await upload(file)
      if (path !== null) {
        onChange(path)
        changeOpen(false)
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
    onChange(value)
    changeOpen(false)
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
    <Popover open={open} onOpenChange={changeOpen}>
      <PopoverTrigger aria-label={label} className={className}>
        {children}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 gap-3">
        <div
          data-testid="cover-drop-zone"
          onDragOver={(event) => {
            if (dragHasFiles(event)) {
              event.preventDefault()
              setDragOver(true)
            }
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          className={cn(
            'flex flex-col items-center gap-2 rounded-lg border border-dashed border-input px-3 py-4 text-center transition-colors',
            dragOver && 'border-border-focus bg-surface-hover',
          )}
        >
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => fileInput.current?.click()}
          >
            <CloudUpload aria-hidden />
            {busy ? 'Uploading…' : 'Upload image'}
          </Button>
          <span className="text-xs text-text-muted">or drop an image here</span>
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
              aria-invalid={linkInvalid || undefined}
              onChange={(event) => {
                setLink(event.target.value)
                setLinkInvalid(false)
              }}
            />
            <Button type="submit" variant="secondary" disabled={link.trim() === ''}>
              Use link
            </Button>
          </div>
          {linkInvalid ? (
            <span role="alert" className="text-xs text-destructive">
              Use an https link to an image.
            </span>
          ) : null}
        </form>
      </PopoverContent>
    </Popover>
  )
}
