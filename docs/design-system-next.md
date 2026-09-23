# Kore Design System 2

**Status:** proposal, 2026-09-23. Nothing here changes the app yet. The token
contract is [`design-system/tokens/next.css`](../design-system/tokens/next.css),
which `styles.css` does not import. [docs/design.md](design.md) stays the rulebook
for today's code until the migration below lands.

## Verdict

Kore does not need a new design language. It already has a good one: one accent,
hairlines instead of boxes, state as tone, the note as the hero, nine themes and
sixteen accents driven from root scopes. What it has is drift. The token layer
promises things the code does not keep (4.5:1 secondary text, one radius ramp,
DS-tier shadows only), and the app reaches for roles the tokens never defined
(success, warning, a content rule, media controls, an 11px step), so those roles
got filled with raw Tailwind palette classes and literals.

Design System 2 is therefore a contract, not a restyle: three token tiers, the
missing roles, a split between accent-as-ink and accent-as-fill, one radius ramp,
and contrast values that pass. A rewrite with new names would touch roughly 1,200
call sites for no visible gain; this touches the roughly 250 that are actually off-rule.

## Part 1: what the codebase uses today

Counts are non-test `.tsx`/`.ts` under `apps/desktop/src`, taken 2026-09-23 on
master `6bb57f6`.

### Token sources

| Layer                       | File                                  | Holds                                                                                                                               |
| --------------------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Primitives + semantic color | `design-system/tokens/colors.css`     | indigo and cool-grey ramps, marketing purples, semantic aliases, 9 theme scopes, 16 accent scopes, the shadow ladder                |
| Type                        | `design-system/tokens/typography.css` | families, 12 size steps (3 marketing), weights, leading, tracking                                                                   |
| Space, radius, motion       | `design-system/tokens/spacing.css`    | 4px spacing scale, radius ramp with 3 hand-written `data-radius` tables, density, layout widths, easing and durations               |
| App bridge                  | `apps/desktop/src/styles/index.css`   | Tailwind `@theme inline` mapping, shadcn vocabulary bridged onto DS tokens, popover glass, editor typography, Liquid Glass and Flat |
| Rules                       | `docs/design.md`                      | principles, states, focus, overlays, motion, do/don't                                                                               |

### Color

- **Themes (9):** light, ash, paper (light family); dark, graphite, ink, space,
  midnight, codex (dark family). Each re-declares surface, text and border tiers.
- **Accents (16):** indigo (default, declares nothing) plus 15 `data-accent`
  scopes, each with a light and a dark value.
- **Semantic set in use:** `--surface`, `--surface-sunken`, `--surface-app`,
  `--surface-hover`, `--surface-active`, `--text`, `--text-secondary`,
  `--text-muted`, `--border`, `--border-strong`, `--border-focus`, `--accent`,
  `--accent-hover`, `--accent-soft`, `--accent-soft-text`, `--focus-ring`,
  `--destructive`. DS vocabulary appears 1,212 times; the shadcn vocabulary
  (`bg-background`, `text-muted-foreground`, ...) 45 times outside `ui/`.

### Type

One family, Inter Variable, `system-ui` for shortcut glyphs.

| Utility                            | Renders                                                                                                         | Uses      |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------- | --------- |
| `text-2xs`                         | 12px                                                                                                            | 36        |
| `text-xs`                          | **13px** (the DS token outranks Tailwind's 12px through the `design` layer; confirmed by compiling `index.css`) | 331       |
| `text-sm`                          | 14px                                                                                                            | 210       |
| `text-base`                        | 16px                                                                                                            | 34        |
| `text-xl` / `text-2xl` / `text-lg` | 20 / 24 / 18px                                                                                                  | 3 / 4 / 4 |
| `text-note-subject`                | 28px                                                                                                            | via CSS   |
| arbitrary `text-[..]`              | 13px x40, 11px x10, 10px x8, 15px x5, 28px x3, 9px x1, 0.8rem x1                                                | 68        |

Weights: `font-medium` 174, `font-semibold` 40, `font-normal` 5, `font-bold` 3.

### Radius, elevation, motion, size

- **Radius:** `rounded-full` 112, `rounded-md` 96, `rounded-lg` 70, bare
  `rounded` 39, `rounded-xl` 28, `rounded-sm` 8, `rounded-2xl` 5, plus 13
  arbitrary values (`[7px]`, `[5px]`, `[3px]`, `[calc(var(--radius)-3px)]`,
  `[min(var(--radius-md),10px)]`, ...).
- **Shadow:** `shadow-sm` 25, `shadow-md` 9, Tailwind default `shadow` 9,
  `shadow-pop` 5, `shadow-input` 1, `shadow-app-input` 1. No `shadow-lg/xl`.
- **Motion:** `duration-100` 49, `duration-150` 40, `ease-swift` 30,
  `duration-200` 13, `duration-450` 2, one each of 250, 300, 400.
- **Control heights:** `h-7` 22, `h-12` 18, `h-11` 16, `h-8` 15, `h-6` 11,
  `h-9` 8.

### Components

Primitives in `apps/desktop/src/components/ui/`: attachment, badge, bubble,
button, checkbox, command, context-menu, dialog, drawer, dropdown-menu,
input-group, input, marker, message, message-scroller, popover, progress,
select, spinner, switch, textarea, toast, tooltip. Plus `.app-icon-button`
(index.css, 11 uses) and `Kbd`.

- **Button:** variants default, outline, secondary, ghost, destructive, link;
  sizes xs 24, sm 28, default 32, lg 36, and four icon sizes.
- **Badge:** default, secondary, destructive, outline, ghost, link; 20px tall.
- Adoption: `<Button>` 251 vs native `<button>` 204; `<Input>` 58 vs native
  `<input>` 26.

## Part 2: inconsistencies and hardcoded values

Ordered by user impact.

1. **Dark-theme primary buttons fail contrast.** A white label on the dark
   accent `#7b7ef4` is 3.42:1 (needs 4.5:1 at 14px). Across all accents, 24 of
   the 32 accent x family pairs fail a white label, including light-theme teal,
   green, amber, orange, lime, emerald, cyan and sky.
2. **Paper fails its own secondary-text rule.** `--text-secondary` `#877a66` is
   4.06:1 on the Paper card and 3.89:1 on its page. Light and Paper
   `--text-muted` sit at 2.68:1 and 2.38:1.
3. **Callouts read tokens nobody defines.** `index.css` colors tip and warning
   callouts with `var(--success, #16a34a)` and `var(--warning, #ca8a04)`. Neither
   token exists, so the fallbacks always apply, at 3.30:1 and 2.94:1 on white
   for the uppercase callout title. `--destructive` itself is red-500, 3.76:1
   on white as text.
4. **No status tokens, so raw palette classes fill the gap.** 60 raw Tailwind
   color classes (red 34, amber 21, emerald/green 3, gray 2), mostly in settings
   (`add-ai-provider-dialog`, `backup-section`, `templates-section`) and mobile
   pills. Each pairs a light and a `dark:` shade by hand, and none follow Paper
   or Ink.
5. **Two radius ramps.** The DS declares `--radius-md` 7px; the Tailwind
   utilities compute `rounded-md` as `--radius - 2px` = 6px. Bare `rounded`
   compiles to a fixed `0.25rem`, so its 39 uses ignore the Appearance radius
   setting entirely. The `data-radius` scopes are three hand-written tables that
   the app's formula then disagrees with at every step.
6. **Off-scale type.** 68 arbitrary sizes. The 40 `text-[13px]` are redundant
   with `text-xs`; the 19 at 9/10/11px have no token (index.css has four more
   `font-size: 0.6875rem`); `text-[0.8rem]` in `Button size="sm"` is 12.8px.
7. **The primitive contradicts the rulebook.** `Button` default hovers with
   `bg-primary/80` (a fade) where design.md says `--accent-hover`; ghost and
   outline hover with `bg-muted` (the sunken surface) where design.md says
   `bg-surface-hover`. Badge uses `rounded-4xl`, off the DS scale.
8. **Focus rule opt-outs.** `focus-visible:outline-none` or a per-component ring
   in `tasks/task-row`, `task-group-header`, `all-notes-row`, `collection-row`,
   `mobile/task-row`, `mobile/chat-composer`, `lightbox-dialog`, and in the
   `toast`, `dropdown-menu`, `context-menu` primitives. design.md forbids all of
   them.
9. **Off-tier shadows.** Tailwind's default `shadow` (9 uses: `all-notes-grid`,
   `tasks-screen`, `kbd`, `note-export`, `mobile-stack`) is neither a DS tier
   nor theme-aware, so it vanishes on dark.
10. **Theme-blind literals.** The note `hr` reads `--coolgray-200/700` (cool grey
    on Paper and Ink). Lightbox and mobile sheets use `bg-black/80`,
    `bg-black/25`, `bg-white/15..25`, `text-white` (26 uses) with no token.
    Graph colors are fixed hexes; teal, green and amber are under 2.5:1 on a
    white canvas.
11. **Motion off-scale.** 17 durations outside 100/150/300 (200 x13, 450 x2,
    250, 400), mostly mobile and the sidebar switcher.
12. **The rulebook's type table no longer matches the editor.** design.md
    lists weights 400/500/600 and a 20px note H2; `index.css` sets note H2 at
    18px and H3 at 16px, both weight 650, the subject at 700, and
    `.app-page-title` at 26px / 700, a size with no token.
13. **Dead tokens.** Nothing in `apps/` or `packages/` reads `.reflect-space`,
    `--glass-*`, `--glow-purple`, `--display-*`, `--site-container`,
    `--bluegray-*`, `--near-white`, `--shadow-none`, `--tracking-wide`, or any
    `--space-N` (components use Tailwind's own spacing).

Accepted as-is: the terminal's 22 ANSI hexes (a terminal palette, not UI), the
export renderer's hexes (it styles a standalone file), and the accent swatch
hexes in settings.

## Part 3: the system

### Principles (kept)

The note is the hero. One accent. Hairlines, not boxes. State is tone, not
color. Keyboard-native. Do less. These are in design.md and stay word for word.
Two are added:

- **Every pair passes.** Any text token on any surface token of the same theme
  meets its floor: 4.5:1 for `--text` and `--text-secondary`, 3:1 for
  `--text-muted` and for non-text UI. A theme or accent that cannot meet it
  declares an override; it never ships the miss.
- **A role gets a token before it gets a second use.** If two components need
  the same color, size or radius, it is a token, not two literals.

### Token tiers

| Tier          | Owns                                                            | Named by components? |
| ------------- | --------------------------------------------------------------- | -------------------- |
| 1. Primitives | ramps (`--indigo-*`, `--coolgray-*`), theme seeds, accent table | no                   |
| 2. Semantic   | surface, text, border, accent, status, rule, scrim, media       | yes                  |
| 3. Component  | control heights, icon sizes, badge height, overlay edge         | yes                  |

A component names tier 2 or 3, never a ramp step and never a hex.

### Color roles

| Role             | Tokens                                                                                                       | New in 2                                 |
| ---------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------- |
| Surfaces         | `--surface-app`, `--surface-sunken`, `--surface`, `--surface-hover`, `--surface-active`, `--surface-inverse` |                                          |
| Text             | `--text`, `--text-secondary`, `--text-muted`, `--text-on-inverse`                                            | Paper and Light values corrected         |
| Borders          | `--border`, `--border-strong`, `--border-focus`                                                              |                                          |
| Accent as ink    | `--accent`, `--accent-hover`, `--accent-soft`, `--accent-soft-text`, `--focus-ring`                          |                                          |
| Accent as fill   | `--accent-fill`, `--accent-fill-hover`, `--text-on-accent`                                                   | yes                                      |
| Status           | `--danger`, `--warning`, `--success`, `--info`, each with `-soft`                                            | yes (`--destructive` aliases `--danger`) |
| Content          | `--rule`                                                                                                     | yes                                      |
| Media and scrims | `--scrim`, `--scrim-strong`, `--on-media`, `--on-media-soft`, `--on-media-hover`                             | yes                                      |

The accent split is the one structural change. `--accent` stays what it is
everywhere it is ink (links, rings, checked marks, the callout rule). Anything
that paints a solid block with a label on it reads `--accent-fill` and
`--text-on-accent`. On dark, stock indigo fills with `#5e5ce6` (white label
5.06:1) while links keep the lifted `#7b7ef4`; Space fills with its own
`#712fff` (5.91:1). A chosen accent fills with itself, and its label flips to
near-black `#0b0b0e` wherever white falls under 4.5:1; every flipped pair clears
4.6:1 (the tightest is dark violet at 4.64:1).

Status inks are `#c42020` / `#9a4a0a` / `#15703a` on light and `#f87171` /
`#fbbf24` / `#4ade80` on dark. Each holds 4.5:1 on `--surface`, on
`--surface-app` and on its own soft wash in every theme (tightest: light danger
on the Paper wash, 4.83:1), so a callout title or a danger button label passes
too. `--info` is the accent. A status color means one
thing and is never a category color.

### Type

| Step                | Size | Role                                        |
| ------------------- | ---- | ------------------------------------------- |
| `text-3xs` (new)    | 11px | counters, badges, tab-strip meta            |
| `text-2xs`          | 12px | section headers, shortcut hints, meta       |
| `text-xs`           | 13px | sidebar rows, captions, labels, table cells |
| `text-sm`           | 14px | buttons, menu items, default chrome         |
| `text-base`         | 16px | editor body (user-scalable), note H3        |
| `text-lg`           | 18px | note H2                                     |
| `text-xl`           | 20px | dialog and panel headings                   |
| `text-2xl`          | 24px | screen titles (Notes, a tag page)           |
| `text-note-subject` | 28px | note title, daily-note date                 |

Nothing below 11px. No arbitrary sizes: `text-[13px]` is `text-xs`,
`text-[9..11px]` is `text-3xs`, `text-[15px]` is `text-sm` in chrome or
`text-base` in content, `text-[28px]` is `text-note-subject`, and
`.app-page-title` moves from 26px to `text-2xl` so it sits one clear step under
the subject.

Five weights, each with one job: 400 prose and body chrome, 500 buttons, nav and
row titles, 600 dialog titles and labels that need emphasis, 650 note H2/H3, 700
the subject and screen titles. Tracking `-0.011em` by default, `-0.02em` at 20px
and up.

### Radius

One ramp, derived from the house `--radius` (8px default): sm = r - 4, md = r -
2, lg = r, xl = r + 4, 2xl = r + 8, full. `data-radius` sets only `--radius`
(sharp 0, small 4px, default 8px, round 14px) and the ramp follows. Bare
`rounded` is banned; it becomes `rounded-sm` (a chip) or `rounded-lg` (a
control). Usage stays as design.md says: md for menu items and small controls,
lg for buttons, inputs and cards, xl for dialogs and popovers, full for pills.

### Elevation and motion

Unchanged tiers: `shadow-input`, `shadow-sm` (resting card), `shadow-md` (menus,
popovers), `shadow-pop` (dialogs, palette, toasts). Tailwind's `shadow` is
banned like `shadow-lg`. Durations stay 100 / 150 / 300 with `ease-swift`;
200 becomes 150, 250 to 450 become 300. The boot mark's breathe is a keyframe,
not a transition, and keeps its own timing.

### Component guidance

- **Button.** Six variants, one height per size from `--control-h-*`. Primary
  reads `--accent-fill` / `--text-on-accent` and hovers to `--accent-fill-hover`
  (no opacity fade). Secondary is `--accent-soft` / `--accent-soft-text`. Ghost
  and outline hover to `--surface-hover`. Danger is `--danger-soft` /
  `--danger`. `sm` text is `text-xs`, not 0.8rem.
- **Icon button.** One component: `Button` with an `icon*` size. `.app-icon-button`
  (the round header chrome) becomes `Button variant="ghost" size="icon"
className="rounded-full"`, so there is one hover, one press and one focus.
- **Text field.** `Input`, `Textarea`, `InputGroup` only. Border
  `--border-strong`, stepping to `--border-focus` on focus; no ring, no glow.
  Native `<input>` only for checkbox and radio inside a primitive.
- **Row.** Sidebar and list rows take `--row-height` and `--nav-padding-y`; hover
  `--surface-hover`, selected `--surface-active`, focus is the row highlight.
- **Badge and counters.** `--badge-h`, `text-3xs` for counters or `text-2xs` for
  words, `rounded-full`. Tones: neutral (`--surface-active` / `--text-secondary`),
  accent (`--accent-soft`), and the four status softs. Nothing else.
- **Overlay.** One recipe: `bg-popover` + blur, edge `--overlay-edge`, radius lg
  for menus and xl for dialogs, shadow md or pop. Always the `ui/` primitive.
- **Callout.** Rule and label in the status ink (`--info` for note and
  important, `--success` tip, `--warning` warning, `--danger` caution), wash in
  the matching soft.
- **Media.** Lightbox chrome reads `--scrim-strong`, `--on-media`,
  `--on-media-soft`, `--on-media-hover`. Sheets and drawers read `--scrim`.
- **Graph colors.** Keep the nine ids, but draw nodes with the status-strength
  values on light (600 step) and the current values on dark, so every hue holds
  3:1 against its canvas.

## Part 4: migration

Each phase is its own PR and needs Mario's go before it starts.

1. **Adopt the contract.** Import `next.css` after `spacing.css` in
   `styles.css`; delete the three `data-radius` tables in favour of `--radius`
   alone; map `--color-danger/warning/success/info(-soft)`,
   `--color-accent-fill`, `--color-text-on-accent`, `--text-3xs` in the
   `@theme inline` block; point the callouts and `hr` at the new tokens. Visible
   change: dark primary buttons get the deeper fill, Paper secondary text
   darkens slightly, callouts and rules follow the theme. Extend
   `theme-tokens.test.ts` with the contrast floors above so a new theme or
   accent cannot regress them.
2. **Fix the primitives.** `Button` and `Badge` variants per the guidance;
   remove the `outline-none` and ring opt-outs in the three primitives.
3. **Mechanical sweep.** `text-[13px]` to `text-xs`, the 9 to 11px literals to
   `text-3xs`, bare `rounded`, Tailwind `shadow`, the 60 raw palette classes to
   status tokens, the 26 black and white literals to scrim and media tokens,
   off-scale durations. Grep-driven, reviewed per file.
4. **Retire.** Delete the dead tokens listed in `next.css`, then fold `next.css`
   into `colors.css`, `typography.css` and `spacing.css` and update design.md so
   there is one source again.

Phases 1 and 2 are where users see a difference. Phase 3 is cleanup with no
intended visual change beyond the radius setting finally reaching every corner.
