# Dependency patches

## Base UI

`@base-ui/react@1.8.0`: backports [mui/base-ui#5645](https://github.com/mui/base-ui/pull/5645)
(merged 2026-09-09, not yet in a release as of 1.8.0). The same two hunks
applied unchanged when moving from 1.7.0, which Meowdown 0.73's `^1.8.0`
requirement forced: one patched copy now serves Kore and Meowdown. Without it a root menu
that has no `Menu.Trigger` (the block-handle menu opens on a virtual anchor)
never registers its floating node id, so its first submenu looks like a
sibling and closes the root with reason `sibling-open`. Drop the patch and its
`patchedDependencies` entry once Kore is on a Base UI release that contains
that PR and `note-editor.test.tsx` ("keeps the block menu open while the Turn
into submenu is hovered") still passes.

## Meowdown

Kore patches the exact installed `@meowdown/core@0.74.1` and
`@meowdown/react@0.73.1` packages:

- `@meowdown/core`: Adds the `insertMarkdown` `after-block` selection option.
- `@meowdown/react`: Adds the host `renderCodeBlock` callback, atomic `updateCode`,
  and the custom code-block presentation styles.

Both come from [Meowdown PR #612](https://github.com/prosekit/meowdown/pull/612)
(the rebase of #546), head `671687c`, whose base is `7fd9427`, the commit that
published core 0.74.1 and react 0.73.1. The patch payloads are the built
`dist/` files of that head, diffed against the published packages.
Upstream's `CodeBlockView` prop (#548) is not a replacement: it swaps the whole
code-block view, and the default one is not exported.

To regenerate: build `@meowdown/core` and `@meowdown/react` at the base and at
the PR head, then copy the PR head's `dist/index.js`, `dist/index.d.ts` and
(react) `dist/style.css` into `pnpm patch` edit directories and
`pnpm patch-commit` them. CSS-module class hashes depend on the build path, so
rewrite the local hashes to the published ones first: a local build of the
base, with its hashes mapped, must equal the npm tarball byte for byte.

Delete both patch files and their `patchedDependencies` entries only after Kore
uses a released Meowdown version containing PR #612 and passes a frozen install,
the focused editor tests, `pnpm check`, and `pnpm build` without the patches.
