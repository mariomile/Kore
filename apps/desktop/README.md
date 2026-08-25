# @reflect/desktop

The Tauri 2 app — a React + TypeScript frontend (`src/`, bundled by Vite)
embedded in a Rust native shell (`src-tauri/`, crate `reflect-open`). The
same package is also the iOS target; the mobile tree lives under
`src/mobile/`.

Ships as **Memento** (stable), **Memento Beta**, and **Memento Dev** — the
flavor overlays are the `tauri.{beta,dev,ios,ios.dev}.conf.json` files.

Common entry points (run from the repo root):

```bash
pnpm tauri dev        # full app with hot reload (stages the CLI sidecar)
pnpm tauri:dev        # the Dev flavor — coexists with an installed build
pnpm dev              # Vite only on http://localhost:1420
pnpm --filter @reflect/desktop e2e   # Chromium smoke, no Tauri shell
```

Start with [AGENTS.md](../../AGENTS.md) for layout, conventions, and the
development cycle; [docs/contributing/](../../docs/contributing/) for
walkthroughs (adding a command, adding a setting, editor architecture,
testing, the mobile simulator); [docs/macos-distribution.md](../../docs/macos-distribution.md)
and [docs/ios-testflight.md](../../docs/ios-testflight.md) for releases.
