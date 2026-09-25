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

To regenerate:

1. In a Meowdown clone, `pnpm install` and build `@meowdown/core` and
   `@meowdown/react` at the base commit, then at the PR head.
2. CSS-module class names (`meow_<Name>_<hash>`) carry a hash of the build
   path, so a local build differs from npm only in those hashes. Pair the
   hashes of the local base build's `react/dist/style.css` with the npm
   tarball's `style.css`, in document order: each local hash maps to exactly
   one published hash. Applying the map to the local base build's
   `index.js` and `style.css` must reproduce the tarball byte for byte;
   then apply it to the PR head's files.
3. `pnpm patch @meowdown/<pkg>@<version> --edit-dir <dir>`, copy the mapped
   PR head `dist/index.js`, `dist/index.d.ts` and (react) `dist/style.css`
   over it, and `pnpm patch-commit <dir>`.

The react patch also renames `Fragment$1` to `Fragment$2` at a few call
sites: the bundler's import numbering shifted in the PR build. It is not a
behavior change.

Delete both patch files and their `patchedDependencies` entries only after Kore
uses a released Meowdown version containing PR #612 and passes a frozen install,
the focused editor tests, `pnpm check`, and `pnpm build` without the patches.
