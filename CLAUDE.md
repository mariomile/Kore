# Reflect - Claude Code Guide

See [AGENTS.md](AGENTS.md) for the full project overview, tech stack, database tables, code conventions, and development cycle.

Read ALL of it before starting ANY work. This is VERY important. You must read AGENTS.md in its entirety before continuing.

## Cutting a Lore release (bump)

When the user says **bump**, **fai bump**, or **fai partire il bump**, follow this
procedure. Do not diagnose Apple signing secrets, wait on TestFlight, or retry the
notarized **Release** workflow.

1. Confirm the work to ship is already on `origin/master`.
2. Confirm `version` in `apps/desktop/package.json` is the version to publish.
   If it still matches the last published `Lore v*` GitHub release, bump it
   there only (patch unless the user specifies otherwise), merge that to
   `master`, and continue. If a `chore: release X.Y.Z` PR is already open,
   merging it is equivalent. Never edit changelogs or `.github/release-please/`
   manifests as part of this step. Feature PRs must not touch the version.
3. Point the `release/dmg` branch at current `master`. It is a pointer, not
   history — `--force` is expected when previous pointer-retrigger commits sit
   on that branch:

   ```bash
   git fetch origin master
   git push --force origin origin/master:release/dmg
   ```

4. Watch the **Release DMG** workflow (`.github/workflows/release-dmg.yml`).
   That build publishes `Lore v<version>` (unsigned Apple Silicon DMG plus
   updater `latest.json`). That is the bump; it is done when that run succeeds.

Do not run `pnpm release:macos` or wait for `.github/workflows/release.yml`. See
[AGENTS.md — Cutting a Lore release (bump)](AGENTS.md#cutting-a-lore-release-bump)
for the same procedure.
