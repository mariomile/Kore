import type { ReactElement, ReactNode } from 'react'
import { dailyFormatProblem, type ImportMapping } from '@kore/core'
import { Close } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

/** Select value for "no folder has this role"; folders are graph-relative, never this. */
const NONE = '\u{0}none'

interface FolderSelectProps {
  readonly label: string
  readonly value: string | null
  readonly folders: readonly string[]
  readonly noneLabel: string
  readonly onChange: (folder: string | null) => void
}

function FolderSelect({
  label,
  value,
  folders,
  noneLabel,
  onChange,
}: FolderSelectProps): ReactElement {
  // The vault's settings can name a folder that holds no file yet; keep it pickable.
  const options = value === null || folders.includes(value) ? folders : [value, ...folders]
  const items = [
    { value: NONE, label: noneLabel },
    ...options.map((folder) => ({ value: folder, label: folder === '' ? 'Vault root' : folder })),
  ]
  return (
    <Select
      value={value ?? NONE}
      items={items}
      onValueChange={(next) => onChange(next === null || next === NONE ? null : next)}
    >
      <SelectTrigger aria-label={label} className="w-56 min-w-0">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

interface RowProps {
  readonly role: string
  readonly target: string
  readonly children: ReactNode
}

function Row({ role, target, children }: RowProps): ReactElement {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2">
      <div className="w-28 shrink-0 text-xs text-text">{role}</div>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">{children}</div>
      <div className="shrink-0 text-xs text-text-muted">→ {target}</div>
    </div>
  )
}

export interface ObsidianImportMappingProps {
  readonly mapping: ImportMapping
  readonly folders: readonly string[]
  readonly onChange: (mapping: ImportMapping) => void
}

/**
 * Which folder of the vault plays which role in Kore's layout, read from the
 * vault's Obsidian settings and editable before anything is converted. Every
 * other folder keeps its notes where they are.
 */
export function ObsidianImportMapping({
  mapping,
  folders,
  onChange,
}: ObsidianImportMappingProps): ReactElement {
  const formatProblem = mapping.daily === null ? null : dailyFormatProblem(mapping.daily.format)
  const excludable = folders.filter((folder) => !mapping.exclude.includes(folder))
  return (
    <div role="group" aria-label="Folder mapping" className="flex flex-col py-1">
      <Row role="Daily notes" target="daily/YYYY-MM-DD">
        <FolderSelect
          label="Daily notes folder"
          value={mapping.daily?.folder ?? null}
          folders={folders}
          noneLabel="No daily notes"
          onChange={(folder) =>
            onChange({
              ...mapping,
              daily:
                folder === null ? null : { folder, format: mapping.daily?.format ?? 'YYYY-MM-DD' },
            })
          }
        />
        {mapping.daily === null ? null : (
          <Input
            aria-label="Daily note file name format"
            aria-invalid={formatProblem !== null}
            value={mapping.daily.format}
            onChange={(event) =>
              onChange({
                ...mapping,
                daily: { folder: mapping.daily?.folder ?? '', format: event.target.value },
              })
            }
            className="h-7 w-36 text-xs"
          />
        )}
      </Row>
      {formatProblem === null ? null : (
        <p role="alert" className="px-4 pb-1 text-[11px] text-destructive">
          {formatProblem}
        </p>
      )}
      <Row role="Attachments" target="assets/">
        <FolderSelect
          label="Attachments folder"
          value={mapping.attachments}
          folders={folders}
          noneLabel="Leave in place"
          onChange={(attachments) => onChange({ ...mapping, attachments })}
        />
      </Row>
      <Row role="Templates" target="templates/">
        <FolderSelect
          label="Templates folder"
          value={mapping.templates}
          folders={folders}
          noneLabel="Leave in place"
          onChange={(templates) => onChange({ ...mapping, templates })}
        />
      </Row>
      <Row role="Leave out" target="not copied">
        {mapping.exclude.map((folder) => (
          <span
            key={folder}
            className="inline-flex items-center gap-1 rounded-md bg-surface-2 py-0.5 pr-0.5 pl-2 text-xs text-text"
          >
            {folder}
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={`Include ${folder} again`}
              onClick={() =>
                onChange({ ...mapping, exclude: mapping.exclude.filter((item) => item !== folder) })
              }
            >
              <Close aria-hidden />
            </Button>
          </span>
        ))}
        <Select
          value={null}
          items={excludable.map((folder) => ({ value: folder, label: folder }))}
          onValueChange={(folder) => {
            if (folder !== null) {
              onChange({ ...mapping, exclude: [...mapping.exclude, folder].sort() })
            }
          }}
        >
          <SelectTrigger aria-label="Leave out a folder" className="w-40 min-w-0">
            <SelectValue placeholder="Add a folder…" />
          </SelectTrigger>
          <SelectContent>
            {excludable.map((folder) => (
              <SelectItem key={folder} value={folder}>
                {folder}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Row>
    </div>
  )
}
