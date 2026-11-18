import { describe, expect, it } from 'vitest'
import type { BackupState } from '@/lib/backup-controller'
import { mobileSyncStatus } from './sync-status'

/**
 * The plain-language mapping (Plan 19, step 10): engine product states plus
 * the conflicted-note count become the words mobile shows — never git terms.
 */

type Connected = Extract<BackupState, { phase: 'connected' }>

function connected(status: Connected['status'], progress?: Connected['progress']): BackupState {
  return {
    phase: 'connected',
    remoteUrl: 'https://github.com/alex/notes.git',
    repo: { owner: 'alex', name: 'notes' },
    status,
    ...(progress === undefined ? {} : { progress }),
  }
}

describe('mobileSyncStatus', () => {
  it('has nothing to say without a configured backup', () => {
    expect(mobileSyncStatus({ phase: 'loading' }, 0)).toBeNull()
    expect(mobileSyncStatus({ phase: 'disconnected' }, 0)).toBeNull()
  })

  it('rests on Synced — the quiet tone the pill hides on', () => {
    const status = mobileSyncStatus(connected({ state: 'idle' }), 0)
    expect(status).toEqual({ kind: 'synced', label: 'Synced', tone: 'ok', detail: null })
  })

  it('shows Syncing while a cycle runs — even with conflicts pending', () => {
    const status = mobileSyncStatus(connected({ state: 'syncing' }), 2)
    expect(status?.label).toBe('Syncing')
    expect(status?.tone).toBe('active')
  })

  it('names the step a cycle is on and since when, so a stuck sync is diagnosable', () => {
    const since = new Date(2026, 10, 17, 8, 41).getTime()
    const status = mobileSyncStatus(
      connected({ state: 'syncing' }, { step: 'downloading', since }),
      0,
    )
    const clock = new Date(since).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    expect(status?.label).toBe('Syncing')
    expect(status?.detail).toBe(`Downloading changes since ${clock}.`)
  })

  it('headlines Needs review while any note carries conflict markers', () => {
    const one = mobileSyncStatus(connected({ state: 'idle' }), 1)
    expect(one?.label).toBe('Needs review')
    expect(one?.tone).toBe('attention')
    expect(one?.detail).toMatch(/open it to choose what to keep/i)

    const many = mobileSyncStatus(connected({ state: 'idle' }), 3)
    expect(many?.detail).toMatch(/^3 notes/)
    expect(many?.detail).toMatch(/open them to choose what to keep/i)
  })

  it('conflicts outrank a failed cycle (the actionable state leads)', () => {
    const status = mobileSyncStatus(
      connected({ state: 'error', errorKind: 'other', message: 'boom' }),
      1,
    )
    expect(status?.label).toBe('Needs review')
  })

  it('surfaces errors as Needs attention with the engine message', () => {
    const status = mobileSyncStatus(
      connected({ state: 'error', errorKind: 'auth', message: 'Sign in again' }),
      0,
    )
    expect(status?.label).toBe('Needs attention')
    expect(status?.detail).toBe('Sign in again')
  })

  it('surfaces offline plainly — changes are safe locally', () => {
    const status = mobileSyncStatus(
      connected({ state: 'offline', message: 'Offline — changes are saved locally' }),
      0,
    )
    expect(status?.label).toBe('Offline')
    expect(status?.tone).toBe('attention')
    expect(status?.detail).toMatch(/saved locally/)
  })
})
