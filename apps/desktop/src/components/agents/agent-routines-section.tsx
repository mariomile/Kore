import { useState, type ReactElement } from 'react'
import { CalendarClock, History, Play, Trash } from '@/components/icons'
import {
  MEMORY_CURATOR_PRESET,
  ROUTINE_MAX_CONSECUTIVE_FAILURES,
  type AgentProfile,
  type AgentRoutine,
  type RoutineSchedule,
} from '@reflect/core'
import { ROUTINE_RUN_NOW_EVENT } from '@/components/agent-routines-runner'
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
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { useSettings } from '@/providers/settings-provider'
import { WEEKDAY_LABELS, scheduleLabel } from './agent-routine-schedule'

function lastRunLabel(lastRunMs: number | null): string {
  if (lastRunMs === null) {
    return 'never run'
  }
  const days = Math.floor((Date.now() - lastRunMs) / 86_400_000)
  if (days === 0) {
    return 'ran today'
  }
  return days === 1 ? 'ran yesterday' : `ran ${days} days ago`
}

interface AgentRoutinesSectionProps {
  /** The graph's profiles, for the "runs as" picker. */
  profiles: AgentProfile[]
}

/**
 * The Automations section of the Agents screen: scheduled agent runs over
 * the vault. Definitions live in settings; the workspace's
 * `AgentRoutinesRunner` executes due ones while the app is open. "Run now"
 * clears the routine's last-run stamp and pokes the runner, so it fires
 * within a second instead of at the next minute tick.
 */
export function AgentRoutinesSection({ profiles }: AgentRoutinesSectionProps): ReactElement {
  const { settings, updateSettingsWith } = useSettings()
  const [createOpen, setCreateOpen] = useState(false)
  const [historyId, setHistoryId] = useState<string | null>(null)
  const routines = settings.agentRoutines
  const historyRoutine = routines.find((routine) => routine.id === historyId) ?? null

  const patch = (id: string, change: Partial<AgentRoutine>): void => {
    updateSettingsWith((current) => ({
      agentRoutines: current.agentRoutines.map((routine) =>
        routine.id === id ? { ...routine, ...change } : routine,
      ),
    }))
  }

  const add = (routine: AgentRoutine): void => {
    updateSettingsWith((current) => ({ agentRoutines: [...current.agentRoutines, routine] }))
  }

  const remove = (id: string): void => {
    updateSettingsWith((current) => ({
      agentRoutines: current.agentRoutines.filter((routine) => routine.id !== id),
    }))
  }

  const runNow = (id: string): void => {
    // Fire by id, dueness ignored — the runner reads the routine from its
    // own live settings ref, so no state round-trip is needed first.
    window.dispatchEvent(new CustomEvent(ROUTINE_RUN_NOW_EVENT, { detail: id }))
  }

  const addCurator = (): void => {
    add({
      id: crypto.randomUUID(),
      name: MEMORY_CURATOR_PRESET.name,
      agentSlug: null,
      prompt: MEMORY_CURATOR_PRESET.prompt,
      script: null,
      schedule: MEMORY_CURATOR_PRESET.schedule,
      enabled: true,
      // Starts from the next occurrence; "Run now" is there for the eager.
      lastRunMs: Date.now(),
      lastChangedPaths: [],
      runs: [],
      consecutiveFailures: 0,
      retryAtMs: null,
      retryContext: null,
    })
  }

  const hasCurator = routines.some((routine) => routine.name === MEMORY_CURATOR_PRESET.name)

  return (
    <section className="mt-3 rounded-xl border border-border bg-surface p-4">
      <div className="flex items-center gap-3">
        <CalendarClock aria-hidden className="size-5 text-text-muted" />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-medium text-text">Automations</h2>
          <p className="text-xs text-text-muted">
            Scheduled agent runs — they work the vault in edit mode while the app is open, and
            journal what they did.
          </p>
        </div>
        {hasCurator ? null : (
          <Button type="button" variant="outline" size="sm" onClick={addCurator}>
            Add Memory curator
          </Button>
        )}
        <Button type="button" size="sm" onClick={() => setCreateOpen(true)}>
          New automation
        </Button>
      </div>

      {routines.length > 0 ? (
        <ul className="mt-3 space-y-2 border-t border-border pt-3">
          {routines.map((routine) => (
            <li
              key={routine.id}
              className="flex items-center gap-3 rounded-lg bg-surface-sunken p-3"
            >
              <div className="min-w-0 flex-1">
                <span className="text-sm font-medium text-text">{routine.name}</span>
                <p className="truncate text-xs text-text-muted">
                  {scheduleLabel(routine.schedule)} ·{' '}
                  {routine.agentSlug === null
                    ? 'default assistant'
                    : (profiles.find((profile) => profile.slug === routine.agentSlug)?.name ??
                      routine.agentSlug)}{' '}
                  · {lastRunLabel(routine.lastRunMs)}
                  {!routine.enabled &&
                  routine.consecutiveFailures >= ROUTINE_MAX_CONSECUTIVE_FAILURES
                    ? ' · paused after repeated failures'
                    : ''}
                  {routine.lastChangedPaths.length > 0
                    ? ` · last run edited ${routine.lastChangedPaths.length} note${
                        routine.lastChangedPaths.length === 1 ? '' : 's'
                      }`
                    : ''}
                </p>
              </div>
              {routine.runs.length > 0 ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Run history for ${routine.name}`}
                  onClick={() => setHistoryId(routine.id)}
                >
                  <History aria-hidden className="size-4" />
                </Button>
              ) : null}
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Run ${routine.name} now`}
                onClick={() => runNow(routine.id)}
              >
                <Play aria-hidden className="size-4" />
              </Button>
              <Switch
                aria-label={`${routine.name} enabled`}
                checked={routine.enabled}
                onCheckedChange={(checked) =>
                  // Re-enabling forgives the strikes that paused it —
                  // otherwise the next failure would pause it again at once.
                  patch(
                    routine.id,
                    checked
                      ? {
                          enabled: true,
                          consecutiveFailures: 0,
                          retryAtMs: null,
                          retryContext: null,
                        }
                      : { enabled: false },
                  )
                }
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Delete ${routine.name}`}
                className="text-text-muted hover:text-destructive"
                onClick={() => remove(routine.id)}
              >
                <Trash aria-hidden className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}

      <NewRoutineDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        profiles={profiles}
        onCreate={(routine) => {
          add(routine)
          setCreateOpen(false)
        }}
      />
      {historyRoutine !== null ? (
        <RunHistoryDialog
          routine={historyRoutine}
          onClose={() => {
            setHistoryId(null)
          }}
        />
      ) : null}
    </section>
  )
}

/** "21 Aug, 14:32" — compact but unambiguous within the 20-run window. */
function runTimeLabel(startedMs: number): string {
  return new Date(startedMs).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

interface RunHistoryDialogProps {
  routine: AgentRoutine
  onClose: () => void
}

/**
 * The routine's run log, newest first: when each run started, whether it
 * succeeded, the failure message when it didn't, and the notes it edited.
 */
function RunHistoryDialog({ routine, onClose }: RunHistoryDialogProps): ReactElement {
  return (
    <Dialog
      open
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose()
      }}
    >
      <DialogContent className="w-[28rem]">
        <DialogHeader>
          <DialogTitle>{routine.name} — run history</DialogTitle>
        </DialogHeader>
        <ul className="max-h-96 space-y-2 overflow-y-auto">
          {routine.runs.map((run) => (
            <li key={run.startedMs} className="rounded-lg bg-surface-sunken p-3">
              <div className="flex items-center gap-2">
                <span
                  aria-hidden
                  className={`size-1.5 rounded-full ${
                    run.status === 'ok'
                      ? 'bg-green-500'
                      : run.status === 'skipped'
                        ? 'bg-border'
                        : 'bg-red-500'
                  }`}
                />
                <span className="text-sm font-medium text-text">{runTimeLabel(run.startedMs)}</span>
                <span className="text-xs text-text-muted">
                  {run.status === 'ok'
                    ? 'completed'
                    : run.status === 'skipped'
                      ? 'skipped — nothing to do'
                      : 'failed'}
                  {run.changedPaths.length > 0
                    ? ` · ${run.changedPaths.length} note${run.changedPaths.length === 1 ? '' : 's'} edited`
                    : ''}
                </span>
              </div>
              {run.error !== null ? (
                <p className="mt-1 text-xs text-red-600 dark:text-red-400">{run.error}</p>
              ) : null}
              {run.changedPaths.length > 0 ? (
                <ul className="mt-1 space-y-0.5">
                  {run.changedPaths.map((path) => (
                    <li key={path} className="truncate font-mono text-xs text-text-muted">
                      {path}
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  )
}

interface NewRoutineDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  profiles: AgentProfile[]
  onCreate: (routine: AgentRoutine) => void
}

/** Name + prompt + agent + schedule → one settings-backed routine. */
function NewRoutineDialog({
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
