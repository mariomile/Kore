import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { setBridge } from '../ipc/bridge'
import { countOpenTasksForNotes, getOpenTasksForNote } from './queries-tasks'
import { applyProjection, connectIndex, openMigratedIndex, project } from './flow-test-harness'

/**
 * The note's Tasks panel read over a real migrated index: tasks written in
 * the note, plus tasks anywhere whose own line wiki-links it — resolution
 * through the production `backlinks` view, line containment over the same
 * UTF-16 offsets the parser emits.
 */

let database: ReturnType<typeof openMigratedIndex>

beforeEach(() => {
  database = openMigratedIndex()
  connectIndex(database)
})

afterEach(() => {
  setBridge(null)
  database.close()
})

const PROJECT_SOURCE = ['# Casa Nuova', '', '+ [ ] own task in the note', ''].join('\n')

describe('getOpenTasksForNote', () => {
  it('returns own tasks first, then tasks whose line links the note', async () => {
    applyProjection(database, project('notes/casa-nuova.md', PROJECT_SOURCE, 1))
    applyProjection(
      database,
      project(
        'daily/2026-08-30.md',
        [
          '+ [ ] chiama il geometra [[Casa Nuova]]',
          '+ [ ] unrelated errand',
          'Prose that mentions [[Casa Nuova]] outside any task.',
        ].join('\n'),
        2,
      ),
    )

    const tasks = await getOpenTasksForNote('notes/casa-nuova.md')

    // `text` is the display form — wiki links already stripped to their words.
    expect(tasks.map((task) => [task.text, task.linked])).toEqual([
      ['own task in the note', false],
      ['chiama il geometra Casa Nuova', true],
    ])
    expect(tasks[1]!.notePath).toBe('daily/2026-08-30.md')
  })

  it('keeps the containment honest across astral characters', async () => {
    applyProjection(database, project('notes/casa-nuova.md', '# Casa Nuova\n', 1))
    applyProjection(
      database,
      project('notes/log.md', '# Log\n\n+ [ ] 🚀 ship the plan [[Casa Nuova]]\n', 2),
    )

    const tasks = await getOpenTasksForNote('notes/casa-nuova.md')

    expect(tasks).toHaveLength(1)
    expect(tasks[0]!.linked).toBe(true)
  })

  it('ignores completed tasks and collapses a line that links the note twice', async () => {
    applyProjection(database, project('notes/casa-nuova.md', '# Casa Nuova\n', 1))
    applyProjection(
      database,
      project(
        'notes/log.md',
        [
          '# Log',
          '',
          '+ [x] already done [[Casa Nuova]]',
          '+ [ ] compare [[Casa Nuova]] with [[Casa Nuova|the house]]',
        ].join('\n'),
        2,
      ),
    )

    const tasks = await getOpenTasksForNote('notes/casa-nuova.md')

    expect(tasks.map((task) => task.text)).toEqual(['compare Casa Nuova with Casa Nuova the house'])
  })

  it('treats a calendar link as a due date, never a reference', async () => {
    // The daily note exists, so `[[2026-09-01]]` resolves to it — but a task
    // due that day is not a task *about* that day's note.
    applyProjection(database, project('daily/2026-09-01.md', 'Day note.\n', 1))
    applyProjection(database, project('notes/casa-nuova.md', '# Casa Nuova\n', 2))
    applyProjection(
      database,
      project('notes/log.md', '+ [ ] pay the deposit [[2026-09-01]] [[Casa Nuova]]\n', 3),
    )

    await expect(getOpenTasksForNote('daily/2026-09-01.md')).resolves.toEqual([])
    const projectTasks = await getOpenTasksForNote('notes/casa-nuova.md')
    expect(projectTasks.map((task) => [task.dueDate, task.linked])).toEqual([['2026-09-01', true]])
  })
})

describe('countOpenTasksForNotes', () => {
  it('counts own and linked open tasks per note, by the same membership rule', async () => {
    applyProjection(database, project('notes/casa-nuova.md', PROJECT_SOURCE, 1))
    applyProjection(database, project('notes/lavoro.md', '# Lavoro\n', 2))
    applyProjection(database, project('daily/2026-09-01.md', 'Day note.\n', 3))
    applyProjection(
      database,
      project(
        'daily/2026-08-30.md',
        [
          '+ [ ] chiama il geometra [[Casa Nuova]]',
          '+ [ ] report [[Lavoro]] entro [[2026-09-01]]',
          '+ [x] già fatto [[Lavoro]]',
          '+ [ ] commissione senza progetto',
        ].join('\n'),
        4,
      ),
    )

    const counts = await countOpenTasksForNotes([
      'notes/casa-nuova.md',
      'notes/lavoro.md',
      'daily/2026-09-01.md',
      'notes/missing.md',
    ])

    // Casa Nuova: one own checkbox + one linked; Lavoro: one linked (the
    // completed one excluded); the daily note counts nothing — its link is
    // a due date; absent notes are simply absent.
    expect(counts).toEqual({ 'notes/casa-nuova.md': 2, 'notes/lavoro.md': 1 })
  })
})
