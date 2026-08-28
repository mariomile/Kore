# `@reflect/design-system`

The tokens the app is built on: CSS custom properties for color, typography,
spacing, radii, shadow and motion, plus the Inter Variable webfont.

Consumers link one file, `styles.css`, which is an `@import` manifest over
`tokens/` plus a minimal base layer. Both apps do this:
`apps/desktop/src/styles/index.css` and
`apps/extension/entrypoints/popup/style.css`. `tokens/colors.css` is also read
directly by `apps/desktop/src/styles/theme-tokens.test.ts`, which pins the
theme's token set.

## What lives where

- `styles.css`: the entry point. Link this, not the individual files.
- `tokens/colors.css`: the indigo brand ramp, cool greys, and the semantic
  aliases (`--surface`, `--text`, `--accent`). Prefer the aliases.
- `tokens/typography.css`: the type scale, weights and leading.
- `tokens/spacing.css`: spacing, radii, shadow and motion.
- `tokens/fonts.css`: the `@font-face` rules for `assets/fonts/`.

## What this is not

It is not a component library. UI primitives are the shadcn components in
`apps/desktop/src/components/ui/`, and icons come from
`apps/desktop/src/components/icons/`. This package used to also carry an
upstream Reflect brand kit: React `.jsx` primitives, marketing specimen pages,
and a design skill for `reflect.app`. None of it was reachable, since the
package exported only `styles.css`, `tokens/*` and `assets/*`, and none of it
described this app. It was removed rather than maintained.
