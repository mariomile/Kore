import { z } from 'zod'
import { KoreError } from '../errors'
import { apiHeaders, readJson, type FetchFn } from './github-api'

export interface GithubRepoRef {
  owner: string
  name: string
}

/** The description stamped on backup repos we create or prefill. */
export const BACKUP_REPO_DESCRIPTION = 'Kore notes backup'

/**
 * The prefilled github.com/new URL — the universal "create the repo on the
 * user's behalf" path. `POST /user/repos` only works with classic PATs and
 * OAuth tokens, **not** fine-grained PATs.
 */
export function newRepoUrl(name: string): string {
  const params = new URLSearchParams({
    name,
    visibility: 'private',
    description: BACKUP_REPO_DESCRIPTION,
  })
  return `https://github.com/new?${params.toString()}`
}

/** Days a sync token prefilled by {@link newSyncTokenUrl} stays valid (GitHub's maximum). */
export const SYNC_TOKEN_EXPIRY_DAYS = 366

/**
 * The prefilled "new fine-grained token" page for syncing one repository:
 * name, description, owner, a year's expiry (GitHub's default is 30 days,
 * after which sync silently stops), and Contents read/write (Metadata read
 * comes with it). GitHub can't prefill *which* repositories the token
 * reaches — the user still picks "Only select repositories" → this one, so
 * the repository must already exist.
 */
export function newSyncTokenUrl(repo: {
  owner?: string | undefined
  name?: string | undefined
}): string {
  const name = repo.name?.trim() ?? ''
  const params = new URLSearchParams({
    name: (name.length > 0 ? `Kore sync ${name}` : 'Kore sync').slice(0, 40),
    description: name.length > 0 ? `Kore syncs this vault with ${name}.` : 'Kore vault sync.',
    expires_in: String(SYNC_TOKEN_EXPIRY_DAYS),
    contents: 'write',
  })
  const owner = repo.owner?.trim() ?? ''
  if (owner.length > 0) {
    params.set('target_name', owner)
  }
  return `https://github.com/settings/personal-access-tokens/new?${params.toString()}`
}

/** The user's fine-grained tokens list — where an existing token's repository access is edited. */
export const FINE_GRAINED_TOKENS_URL = 'https://github.com/settings/personal-access-tokens'

/** Parse `https://github.com/owner/repo(.git)` → ref, or `null` for any other remote. */
export function parseGithubRemote(url: string): GithubRepoRef | null {
  const match = /^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(url)
  if (match === null) {
    return null
  }
  return { owner: match[1]!, name: match[2]! }
}

/** The canonical HTTPS remote URL for a repo (token never embedded). */
export function githubRemoteUrl(ref: GithubRepoRef): string {
  return `https://github.com/${ref.owner}/${ref.name}.git`
}

export interface GithubRepo {
  fullName: string
  /** Backups must default private; a public repo needs explicit confirmation. */
  isPrivate: boolean
  defaultBranch: string
  htmlUrl: string
}

const repoResponseSchema = z.object({
  full_name: z.string(),
  private: z.boolean(),
  default_branch: z.string(),
  html_url: z.string(),
})

function toRepo(parsed: z.infer<typeof repoResponseSchema>): GithubRepo {
  return {
    fullName: parsed.full_name,
    isPrivate: parsed.private,
    defaultBranch: parsed.default_branch,
    htmlUrl: parsed.html_url,
  }
}

/**
 * Create a repo for the signed-in user (private by default — the backup
 * norm). Returns `null` when the token *type* cannot create repositories.
 */
export async function createGithubRepo(
  token: string,
  name: string,
  options: { isPrivate?: boolean; fetchFn?: FetchFn } = {},
): Promise<GithubRepo | null> {
  const fetchFn = options.fetchFn ?? fetch
  const response = await fetchFn('https://api.github.com/user/repos', {
    method: 'POST',
    headers: { ...apiHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      private: options.isPrivate ?? true,
      description: BACKUP_REPO_DESCRIPTION,
      auto_init: false,
    }),
  })
  if (response.status === 403) {
    const body = (await response.text()).toLowerCase()
    if (body.includes('not accessible')) {
      return null
    }
    throw new KoreError('auth', 'GitHub rejected the token (403)')
  }
  if (response.status === 401) {
    throw new KoreError('auth', 'GitHub rejected the token (401)')
  }
  if (!response.ok) {
    const body = await response.text()
    throw new KoreError('io', `creating the repo failed (${response.status}): ${body}`)
  }
  return toRepo(await readJson(response, repoResponseSchema, 'repo creation'))
}

/** Look up a repo (visibility check before connecting); `null` when missing. */
export async function getGithubRepo(
  token: string,
  ref: GithubRepoRef,
  fetchFn: FetchFn = fetch,
): Promise<GithubRepo | null> {
  const response = await fetchFn(`https://api.github.com/repos/${ref.owner}/${ref.name}`, {
    headers: apiHeaders(token),
  })
  if (response.status === 404) {
    return null
  }
  if (response.status === 401 || response.status === 403) {
    throw new KoreError('auth', `GitHub rejected the token (${response.status})`)
  }
  if (!response.ok) {
    throw new KoreError('io', `looking up the repo failed (${response.status})`)
  }
  return toRepo(await readJson(response, repoResponseSchema, 'repo lookup'))
}
