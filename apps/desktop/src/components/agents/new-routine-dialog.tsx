import { useState, type ReactElement } from 'react'
import type { AgentProfile, AgentRoutine, RoutineSchedule } from '@reflect/core'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { WEEKDAY_LABELS } from './agent-routine-schedule'

interface NewRoutineDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  profiles: AgentProfile[]
  onCreate: (routine: AgentRoutine) => void
}

/** Name + prompt + agent + schedule → one settings-backed routine. */
export function NewRoutineDialog({
  open,
  onOpenChange,
  profiles,
  onCreate,
}: NewRoutineDialogProps): ReactElement {
  const [name, setName] = useState('')
  const [prompt, setPrompt] = useState('')
  const [script, setScript] = useState('')
  const [agentSlug, setAgentSlug] = useState('none')
  const [kind, setKind] = useState<'daily' | 'weekly' | 'event'>('daily')
  const [weekday, setWeekday] = useState('1')
  const [time, setTime] = useState('08:00')
  const [eventKind, setEventKind] = useState<'row-created' | 'row-updated'>('row-created')
  const [tag, setTag] = useState('')

  const create = (): void => {
    if (name.trim() === '' || prompt.trim() === '') {
      return
    }
    let schedule: RoutineSchedule
    if (kind === 'event') {
      if (tag.trim() === '') {
        return
      }
      schedule = { kind: 'event', event: eventKind, tag: tag.trim() }
    } else if (!/^\d{2}:\d{2}$/.test(time)) {
      return
    } else {
      schedule = kind === 'daily' ? { kind, time } : { kind, weekday: Number(weekday), time }
    }
    onCreate({
      id: crypto.randomUUID(),
      name: name.trim(),
      agentSlug: agentSlug === 'none' ? null : agentSlug,
      prompt: prompt.trim(),
      script: script.trim() === '' ? null : script.trim(),
      schedule,
      enabled: true,
      lastRunMs: Date.now(),
      lastChangedPaths: [],
      runs: [],
      consecutiveFailures: 0,
      retryAtMs: null,
      retryContext: null,
    })
    setName('')
    setPrompt('')
    setScript('')
    setAgentSlug('none')
    setKind('daily')
    setTag('')
    setEventKind('row-created')
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[28rem]">
        <DialogHeader>
          <DialogTitle>New automation</DialogTitle>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            create()
          }}
        >
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Name — e.g. Morning brief"
            aria-label="Automation name"
            autoFocus
          />
          <Textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="What should the agent do on each run?"
            aria-label="Automation prompt"
            rows={4}
            className="text-sm"
          />
          <Select
            value={agentSlug}
            onValueChange={(value) => {
              setAgentSlug(value ?? 'none')
            }}
          >
            <SelectTrigger aria-label="Runs as">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Default assistant</SelectItem>
              {profiles.map((profile) => (
                <SelectItem key={profile.slug} value={profile.slug}>
                  {profile.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex items-center gap-2">
            <Select
              value={kind}
              onValueChange={(value) => {
                setKind(value === 'weekly' ? 'weekly' : value === 'event' ? 'event' : 'daily')
              }}
            >
              <SelectTrigger aria-label="Schedule" className="flex-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="daily">Daily</SelectItem>
                <SelectItem value="weekly">Weekly</SelectItem>
                <SelectItem value="event">On collection event</SelectItem>
              </SelectContent>
            </Select>
            {kind === 'weekly' ? (
              <Select value={weekday} onValueChange={(value) => setWeekday(value ?? '1')}>
                <SelectTrigger aria-label="Weekday" className="flex-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WEEKDAY_LABELS.map((label, index) => (
                    <SelectItem key={label} value={String(index)}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
            {kind === 'event' ? (
              <>
                <Select
                  value={eventKind}
                  onValueChange={(value) => {
                    setEventKind(value === 'row-updated' ? 'row-updated' : 'row-created')
                  }}
                >
                  <SelectTrigger aria-label="Collection event" className="flex-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="row-created">Row created</SelectItem>
                    <SelectItem value="row-updated">Row updated</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  value={tag}
                  onChange={(change) => setTag(change.target.value)}
                  placeholder="tag — e.g. books"
                  aria-label="Collection tag"
                  className="w-32"
                />
              </>
            ) : (
              <Input
                type="time"
                value={time}
                onChange={(change) => setTime(change.target.value)}
                aria-label="Time"
                className="w-28"
              />
            )}
          </div>
          <Textarea
            value={script}
            onChange={(event) => setScript(event.target.value)}
            placeholder={'Gate script (optional) — e.g. git log --since=yesterday --oneline'}
            aria-label="Automation gate script"
            rows={2}
            className="font-mono text-xs"
          />
          <p className="text-xs text-text-muted">
            Runs through your Claude Code or Codex provider in edit mode, with the chosen agent’s
            soul and memory. Clock schedules need the app open at (or after) the time; collection
            events fire while the app is open when a tagged row is created or updated. With a gate
            script, each tick runs the script first in the vault folder: no output means nothing to
            do — the tick is skipped silently and no AI runs — while output wakes the agent with it
            as context.
          </p>
          <Button
            type="submit"
            disabled={
              name.trim() === '' || prompt.trim() === '' || (kind === 'event' && tag.trim() === '')
            }
          >
            Create automation
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
