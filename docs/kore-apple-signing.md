# Kore: Apple identity & signing checklist

Kore carries its own Apple-facing identity, distinct from upstream Reflect:

| What | Value |
| --- | --- |
| macOS bundle ids | `app.lore.desktop` / `.beta` / `.dev` |
| iOS bundle ids | `app.lore.ios` / `.dev` (+ `.share`, `.widgets` extensions) |
| iCloud container | `iCloud.app.lore` (shown as **Kore** in Files/Finder) |
| App Group | `group.app.lore` / `group.app.lore.dev` |
| Product names | Kore / Kore Beta / Kore Dev |
| Keychain service | `lore` |

Everything builds and runs **without any Apple account**: unsigned/dev builds
simply report iCloud as unavailable, and GitHub sync works regardless. The
steps below are only needed for iCloud sync and for installing on an iPhone.

## One-time setup with your Apple Developer account

1. **Join the Apple Developer Program** (developer.apple.com, 99 $/year).
2. **Replace the development team.** In
   `apps/desktop/src-tauri/tauri.conf.json`, set
   `bundle.iOS.developmentTeam` to *your* Team ID (upstream's `789ULN5MZB`
   is still in place and will not sign for you).
3. **iOS: let Xcode do the rest.** The first entitled build with automatic
   signing (open `gen/apple/reflect-open.xcodeproj`, select your team)
   registers the App IDs, the `iCloud.app.lore` container, and the
   `group.app.lore` App Group on your team automatically.
4. **macOS iCloud (optional, for signed distribution builds):** upstream's
   committed `Reflect.provisionprofile` / `Reflect-beta.provisionprofile`
   are bound to their Developer ID and *your* builds will refuse them
   loudly. Generate your own Developer ID provisioning profiles for
   `app.lore.desktop` / `.beta` with the iCloud capability, drop them in
   `apps/desktop/src-tauri/` under the same file names, and follow
   [macos-distribution.md](macos-distribution.md). Plain `pnpm tauri build`
   for personal use needs none of this.
5. **Auto-updates:** live. Kore has its own updater keypair — the public
   key sits in `tauri.conf.json`, the private key belongs in the repo's
   Actions secrets (`TAURI_SIGNING_PRIVATE_KEY` +
   `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`) — and the `Release DMG` workflow
   (`.github/workflows/release-dmg.yml`) builds an unsigned DMG plus
   signed updater artifacts on every `v*` tag, publishing them to the
   GitHub release the in-app updater polls
   (`releases/latest/download/latest.json`). Apple signing is *not*
   required for self-update; it only removes the one-time Gatekeeper
   quarantine on fresh installs (recent macOS calls the unsigned app
   "damaged" — cleared with `xattr -cr /Applications/Kore.app`). For a
   prompt-free install, use release.yml, the signed + notarized pipeline.

## What deliberately did NOT change

- `reflect://` deep-link scheme, the `reflect` CLI name, the `.reflect/`
  index directory, and `@reflect/*` package names — internal identifiers;
  renaming them buys nothing and risks breaking links, graphs, and scripts.
- `app.reflect.capture` — the Chrome native-messaging host name, paired
  with the browser extension's allowlist on both sides.
- Config-dir name `reflect-open` (recents/settings/capture pointer paths).
- Apple technical identity: bundle ids `app.lore.*`, iCloud container key
  `iCloud.app.lore`, App Group `group.app.lore`, and keychain service `lore`.
- Desktop bundle name `Kore.app` (`productName` in `tauri.conf.json`).

## Publishing a Kore release

The publish path is a bump followed by a build:

1. Merge the work that should ship to `master`.
2. Merge the open `chore: release X.Y.Z` **Release PR**. That is the bump: it
   moves `version` in `apps/desktop/package.json`, prepends
   `apps/desktop/CHANGELOG.md`, and advances
   `.github/release-please/manifest.stable.json` together. Only when no Release
   PR is open (nothing since the last release carried a `feat:`/`fix:` title)
   hand-bump `version` in `apps/desktop/package.json` and merge that — never
   hand-edit the changelog or the manifest.
3. Fast-forward the `release/dmg` pointer:
   `git push origin origin/master:release/dmg`.
4. The **Release DMG** workflow (`.github/workflows/release-dmg.yml`) builds an
   unsigned DMG plus signed updater artifacts from that pointer, creates the
   `v<version>` tag, and publishes the GitHub release the in-app updater polls.

Step 3 is not optional: merging the Release PR publishes nothing on its own —
release-please runs with `skip-github-release` here precisely so it cannot leave
a tagless, asset-less draft release that the updater might resolve as "latest".

Feature PRs must not touch the version, the changelog, or the manifest.

See also [Cutting a release](macos-distribution.md#cutting-a-release-release-prs)
in the distribution guide.
