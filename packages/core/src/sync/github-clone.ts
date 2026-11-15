import { KoreError, isAppError } from '../errors'
import { gitClone } from './commands'
import type { FetchFn } from './github-api'
import { getAuthenticatedUser, getGithubToken, saveGithubAuth } from './github-auth'
import { getGithubRepo, githubRemoteUrl, type GithubRepo, type GithubRepoRef } from './github-repos'

/**
 * Where to make a fine-grained token for opening a vault: GitHub's own form.
 * The token needs Contents read/write on the vault's repository — read to
 * clone, write so the opened vault keeps syncing back.
 */
export const OPEN_FROM_GITHUB_TOKEN_URL = 'https://github.com/settings/personal-access-tokens/new'

export interface CloneGithubVaultOptions {
  /** The repository that holds the vault. */
  readonly ref: GithubRepoRef
  /**
   * A token the user just pasted, or `null` to use the one already stored on
   * this machine. A pasted token is saved (it becomes the machine's GitHub
   * credential, so the opened vault syncs) only after the clone succeeds.
   */
  readonly token: string | null
  /** Absolute path the vault is cloned into; must not exist or be empty. */
  readonly destination: string
  readonly fetchFn?: FetchFn
}

/**
 * "Open from GitHub": check the token and the repository up front (so a
 * wrong token or name gets a plain answer before any download starts), then
 * clone the repository into `destination`. The caller opens the result as a
 * vault — `origin` already points at the repo, so sync starts on its own.
 */
export async function cloneGithubVault(options: CloneGithubVaultOptions): Promise<GithubRepo> {
  const fetchFn = options.fetchFn ?? fetch
  const typed = options.token?.trim() ?? ''
  const token = typed.length > 0 ? typed : await getGithubToken(fetchFn)
  if (token === null) {
    throw new KoreError('auth', 'Paste a GitHub token to open this repository.')
  }
  const fullName = `${options.ref.owner}/${options.ref.name}`
  try {
    await getAuthenticatedUser(token, fetchFn)
  } catch (err) {
    if (isAppError(err) && err.kind === 'auth') {
      throw new KoreError(
        'auth',
        'GitHub didn’t accept this token. Check that you copied all of it.',
      )
    }
    throw err
  }
  const repo = await getGithubRepo(token, options.ref, fetchFn).catch((err: unknown) => {
    if (isAppError(err) && err.kind === 'auth') {
      return null // a token without access to the repo reads the same as a missing repo
    }
    throw err
  })
  if (repo === null) {
    throw new KoreError(
      'notFound',
      `Couldn’t find ${fullName}. Check the name, and that the token can access it.`,
    )
  }
  try {
    await gitClone(githubRemoteUrl(options.ref), options.destination, token)
  } catch (err) {
    if (isAppError(err) && /exists and is not an empty directory/i.test(err.message)) {
      throw new KoreError(
        'io',
        `A folder named “${options.ref.name}” already exists there. Choose another location.`,
      )
    }
    throw err
  }
  if (typed.length > 0) {
    await saveGithubAuth({ kind: 'pat', token: typed })
  }
  return repo
}
