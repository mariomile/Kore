# Dependency patches

## Base UI

`@base-ui/react@1.7.0`: backports [mui/base-ui#5645](https://github.com/mui/base-ui/pull/5645)
(merged 2026-09-09, not yet in a release as of 1.8.0). Without it a root menu
that has no `Menu.Trigger` (the block-handle menu opens on a virtual anchor)
never registers its floating node id, so its first submenu looks like a
sibling and closes the root with reason `sibling-open`. Drop the patch and its
`patchedDependencies` entry once Kore is on a Base UI release that contains
that PR and `note-editor.test.tsx` ("keeps the block menu open while the Turn
into submenu is hovered") still passes.

## Meowdown

Kore currently patches the exact installed Meowdown 0.65.6 packages:

- `@meowdown/core`: Adds the `insertMarkdown` `after-block` selection option.
- `@meowdown/react`: Adds the host `renderCodeBlock` callback, atomic `updateCode`,
  and the custom code-block presentation styles.

The patch payloads contain only built package files used by consumers: runtime
JavaScript, public declarations, and the React package stylesheet. They were
generated with `pnpm patch` / `pnpm patch-commit` from the 0.65.6 packages and
the corresponding built artifacts from
[Meowdown PR #546](https://github.com/prosekit/meowdown/pull/546), commit
`4e8c7fe36c409a0d05001cca0b1733c34c6d7b73` over base
`9d2f5afb23c08d3497f00768678c3b9746f4d75a`. The upstream snapshot workflow is
still awaiting maintainer approval, so Kore does not depend on an unpublished
snapshot version.

Delete both patch files and their `patchedDependencies` entries only after Kore
uses a released Meowdown version containing PR #546 and passes a frozen install,
the focused editor tests, `pnpm check`, and `pnpm build` without the patches.
