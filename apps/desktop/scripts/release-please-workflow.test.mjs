import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'vitest'

const scriptsDirectory = import.meta.dirname
const repoRoot = join(scriptsDirectory, '..', '..', '..')
const workflow = readFileSync(join(repoRoot, '.github', 'workflows', 'release-please.yml'), 'utf8')
const releaseDmg = readFileSync(join(repoRoot, '.github', 'workflows', 'release-dmg.yml'), 'utf8')
const stableConfig = JSON.parse(
  readFileSync(join(repoRoot, '.github', 'release-please', 'config.stable.json'), 'utf8'),
)
const manifest = JSON.parse(
  readFileSync(join(repoRoot, '.github', 'release-please', 'manifest.stable.json'), 'utf8'),
)
const packageVersion = JSON.parse(
  readFileSync(join(repoRoot, 'apps', 'desktop', 'package.json'), 'utf8'),
).version

test('there is a single release channel', () => {
  // A second release-please component tracking the same branch only produced a
  // duplicate ledger: both Release PRs listed the same commits, and neither
  // published anything. One channel, one changelog.
  for (const path of [
    ['.github', 'release-please', 'config.beta.json'],
    ['.github', 'release-please', 'manifest.beta.json'],
    ['apps', 'desktop', 'CHANGELOG.beta.md'],
  ]) {
    expect(existsSync(join(repoRoot, ...path))).toBe(false)
  }
  expect(workflow).not.toContain('config.beta.json')
  expect(stableConfig.packages['.'].component).toBeUndefined()
  expect(stableConfig.packages['.']['package-name']).toBe('reflect-open')
})

test('release-please tags nothing and publishes nothing', () => {
  // Publishing belongs to release-dmg.yml. When release-please also created
  // releases they landed as untagged, asset-less drafts that the in-app
  // updater could resolve as "latest".
  expect(stableConfig['skip-github-release']).toBe(true)
  expect(stableConfig.draft).toBeUndefined()
  expect(stableConfig['force-tag-creation']).toBeUndefined()
  expect(workflow).not.toContain('uses: ./.github/workflows/release.yml')
  expect(workflow).not.toContain('uses: ./.github/workflows/testflight.yml')
})

test('the Release PR is the bump', () => {
  // Merging it must move the one place the app version lives, so a published
  // version can never lack its changelog entry.
  expect(stableConfig['include-component-in-tag']).toBe(false)
  expect(stableConfig.packages['.']['changelog-path']).toBe('apps/desktop/CHANGELOG.md')
  expect(stableConfig.packages['.']['extra-files']).toContainEqual({
    type: 'json',
    path: 'apps/desktop/package.json',
    jsonpath: '$.version',
  })
})

test('the manifest tracks the version the app actually ships', () => {
  // A manifest behind package.json makes the next Release PR propose a version
  // that renames releases already published, and re-lists their commits.
  expect(manifest['.']).toBe(packageVersion)
})

test('the tags release-please skips are created by the publish workflow', () => {
  // skip-github-release still expects the releases to be tagged by something.
  expect(releaseDmg).toContain('tagName: v__VERSION__')
})

test('release runs queue instead of cancelling', () => {
  expect(workflow).toContain('group: release-please')
  expect(workflow).toContain('cancel-in-progress: false')
})
