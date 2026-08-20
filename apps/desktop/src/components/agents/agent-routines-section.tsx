import { useState, type ReactElement } from 'react'
import { CalendarClock, Play, Trash2 } from 'lucide-react'
import {
  MEMORY_CURATOR_PRESET,
  type AgentProfile,
  type AgentRoutine,
  type RoutineSchedule,
} from '@reflect/core'
import { ROUTINES_CHECK_EVENT } from '@/components/agent-routines-runner'
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

const WEEKDAY_LABELS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
]

function scheduleLabel(schedule: RoutineSchedule): string {
  return schedule.kind === 'daily'
    ? `Daily at ${schedule.time}`
    : `${WEEKDAY_LABELS[schedule.weekday]}s at ${schedule.time}`
}

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
  const routines = settings.agentRoutines

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
    patch(id, { lastRunMs: null, enabled: true })
    window.dispatchEvent(new Event(ROUTINES_CHECK_EVENT))
  }

  const addCurator = (): void => {
    add({
      id: crypto.randomUUID(),
      name: MEMORY_CURATOR_PRESET.name,
      agentSlug: null,
      prompt: MEMORY_CURATOR_PRESET.prompt,
      schedule: MEMORY_CURATOR_PRESET.schedule,
      enabled: true,
      // Starts from the next occurrence; "Run now" is there for the eager.
      lastRunMs: Date.now(),
      lastChangedPaths: [],
    })
  }

  const hasCurator = routines.some((routine) => routine.name === MEMORY_CURATOR_PRESET.name)

  return (
    <section className="mt-3 rounded-xl border border-border bg-surface p-4">
      <div className="flex items-center gap-3">
        <CalendarClock aria-hidden strokeWidth={1.75} className="size-5 text-text-muted" />
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
                  {routine.lastChangedPaths.length > 0
                    ? ` · last run edited ${routine.lastChangedPaths.length} note${
                        routine.lastChangedPaths.length === 1 ? '' : 's'
                      }`
                    : ''}
                </p>
              </div>
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
                onCheckedChange={(checked) => patch(routine.id, { enabled: checked })}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Delete ${routine.name}`}
                className="text-text-muted hover:text-destructive"
                onClick={() => remove(routine.id)}
              >
                <Trash2 aria-hidden className="size-4" />
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
    </section>
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
  const [agentSlug, setAgentSlug] = useState('none')
  const [kind, setKind] = useState<'daily' | 'weekly'>('daily')
  const [weekday, setWeekday] = useState('1')
  const [time, setTime] = useState('08:00')

  const create = (): void => {
    if (name.trim() === '' || prompt.trim() === '' || !/^\d{2}:\d{2}$/.test(time)) {
      return
    }
    const schedule: RoutineSchedule =
      kind === 'daily' ? { kind, time } : { kind, weekday: Number(weekday), time }
    onCreate({
      id: crypto.randomUUID(),
      name: name.trim(),
      agentSlug: agentSlug === 'none' ? null : agentSlug,
      prompt: prompt.trim(),
      schedule,
      enabled: true,
      lastRunMs: Date.now(),
      lastChangedPaths: [],
    })
    setName('')
    setPrompt('')
    setAgentSlug('none')
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
                setKind(value === 'weekly' ? 'weekly' : 'daily')
              }}
            >
              <SelectTrigger aria-label="Schedule" className="flex-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="daily">Daily</SelectItem>
                <SelectItem value="weekly">Weekly</SelectItem>
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
            <Input
              type="time"
              value={time}
              onChange={(event) => setTime(event.target.value)}
              aria-label="Time"
              className="w-28"
            />
          </div>
          <p className="text-xs text-text-muted">
            Runs through your Claude Code or Codex provider in edit mode, with the chosen agent’s
            soul and memory. The app must be open at (or after) the scheduled time.
          </p>
          <Button type="submit" disabled={name.trim() === '' || prompt.trim() === ''}>
            Create automation
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
