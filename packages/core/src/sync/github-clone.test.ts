import { afterEach, describe, expect, it } from 'vitest'
import { setBridge } from '../ipc/bridge'
import { cloneGithubVault } from './github-clone'

afterEach(() => {
  setBridge(null)
})

interface FakeHost {
  secrets: Map<string, string>
  clones: { url: string; path: string; token: string | null }[]
}

/** Keychain + git_clone over the bridge; `cloneError` makes the clone fail. */
function fakeHost(options: { secrets?: Record<string, string>; cloneError?: unknown } = {}) {
  const host: FakeHost = { secrets: new Map(Object.entries(options.secrets ?? {})), clones: [] }
  setBridge({
    invoke: async (command, args) => {
      switch (command) {
        case 'secret_get':
          return host.secrets.get(args['name'] as string) ?? null
        case 'secret_set':
          host.secrets.set(args['name'] as string, args['value'] as string)
          return null
        case 'git_clone':
          if (options.cloneError !== undefined) {
            throw options.cloneError
          }
          host.clones.push({
            url: args['url'] as string,
            path: args['path'] as string,
            token: (args['token'] as string | null) ?? null,
          })
          return null
        default:
          throw new Error(`unexpected command ${command}`)
      }
    },
    listen: async () => () => {},
  })
  return host
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const REPO = {
  full_name: 'alex/brain',
  private: true,
  default_branch: 'main',
  html_url: 'https://github.com/alex/brain',
}

/** GitHub stand-in: `/user` answers per `user`, the repo lookup per `repo`. */
function github(user: number, repo: number): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.endsWith('/user')) {
      return user === 200 ? json({ login: 'alex' }) : json({ message: 'Bad credentials' }, user)
    }
    return repo === 200 ? json(REPO) : json({ message: 'Not Found' }, repo)
  }) as typeof fetch
}

const REF = { owner: 'alex', name: 'brain' }

describe('cloneGithubVault', () => {
  it('clones with a pasted token and saves it only after the clone', async () => {
    const host = fakeHost()
    const repo = await cloneGithubVault({
      ref: REF,
      token: '  github_pat_abc  ',
      destination: '/Users/alex/Documents/brain',
      fetchFn: github(200, 200),
    })

    expect(repo.fullName).toBe('alex/brain')
    expect(host.clones).toEqual([
      {
        url: 'https://github.com/alex/brain.git',
        path: '/Users/alex/Documents/brain',
        token: 'github_pat_abc',
      },
    ])
    expect(JSON.parse(host.secrets.get('github-auth')!)).toEqual({
      kind: 'pat',
      token: 'github_pat_abc',
    })
  })

  it('uses the saved token when none is pasted, leaving it as it was', async () => {
    const saved = JSON.stringify({ kind: 'pat', token: 'saved' })
    const host = fakeHost({ secrets: { 'github-auth': saved } })
    await cloneGithubVault({ ref: REF, token: null, destination: '/d', fetchFn: github(200, 200) })

    expect(host.clones[0]?.token).toBe('saved')
    expect(host.secrets.get('github-auth')).toBe(saved)
  })

  it('asks for a token when none is pasted or saved', async () => {
    fakeHost()
    await expect(
      cloneGithubVault({ ref: REF, token: '', destination: '/d', fetchFn: github(200, 200) }),
    ).rejects.toThrow('Paste a GitHub token')
  })

  it('names a rejected token before downloading anything', async () => {
    const host = fakeHost()
    await expect(
      cloneGithubVault({ ref: REF, token: 'bad', destination: '/d', fetchFn: github(401, 200) }),
    ).rejects.toThrow('GitHub didn’t accept this token')
    expect(host.clones).toEqual([])
    expect(host.secrets.size).toBe(0)
  })

  it('reads a missing repo and one the token cannot reach the same way', async () => {
    for (const status of [404, 403]) {
      const host = fakeHost()
      await expect(
        cloneGithubVault({ ref: REF, token: 't', destination: '/d', fetchFn: github(200, status) }),
      ).rejects.toThrow('Couldn’t find alex/brain')
      expect(host.clones).toEqual([])
    }
  })

  it('explains a destination that already holds files, and keeps the token unsaved', async () => {
    const host = fakeHost({
      cloneError: {
        kind: 'io',
        message: "'/Users/alex/Documents/brain' exists and is not an empty directory",
      },
    })
    await expect(
      cloneGithubVault({ ref: REF, token: 't', destination: '/d', fetchFn: github(200, 200) }),
    ).rejects.toThrow('A folder named “brain” already exists there')
    expect(host.secrets.size).toBe(0)
  })
})
