# Kore design reference

The rules the interface is built to. Tokens live in
[`design-system/tokens/`](../design-system/tokens/), primitives in
[`apps/desktop/src/components/ui/`](../apps/desktop/src/components/ui/),
icons in [`apps/desktop/src/components/icons/`](../apps/desktop/src/components/icons/readme.md).
This document says how they combine; when it and the code disagree, fix one
of them in the same PR.

Grounded in [WCAG 2.2](https://www.w3.org/WAI/WCAG22/quickref/) (2.4.7 Focus
Visible, 2.4.11 Focus Not Obscured, 2.4.13 Focus Appearance, 1.4.3 / 1.4.11
contrast), Apple's
[HIG — Focus and selection](https://developer.apple.com/design/human-interface-guidelines/focus-and-selection),
and the [`:focus-visible`](https://developer.mozilla.org/en-US/docs/Web/CSS/:focus-visible)
contract browsers implement.

## Principles

- **The note is the hero.** Chrome is small (12–14px), quiet, and grey. The
  user's prose is the only thing that gets the full `--text` at 16px+.
- **One accent.** `--accent` (indigo by default, user-selectable) marks the
  primary action, the selected state, links, and keyboard focus. Nothing else
  is saturated. If a surface has two accent-colored things, one is wrong.
- **Hairlines, not boxes.** Separation is a 1px `--border` (7% ink) or a step
  in surface tone (`--surface-sunken`), never a shadow on a resting element.
  Shadows are for things that float.
- **State is tone, not color.** Hover, active, selected, and text-field focus
  are all steps in the ink ramp (`--surface-hover` → `--surface-active`,
  `--border` → `--border-focus`). Color is reserved for the accent rule above
  and for `--destructive`.
- **Keyboard-native.** Every control reaches keyboard focus and shows it.
  Every text field reaches it and does *not* draw a ring (see States).
- **Do less.** No surface competes with the editor. A new panel, badge,
  glow, or animation needs a reason the existing tokens cannot cover.

## Tokens

Use the semantic aliases; reach for a ramp step (`--indigo-500`,
`--coolgray-300`) only when building a new alias.

| Need | Token | Tailwind |
| --- | --- | --- |
| Page / rails | `--surface-app`, `--surface-sunken` | `bg-surface-app`, `bg-surface-sunken` |
| Cards, editor canvas | `--surface` | `bg-surface` |
| Hover wash / selected row | `--surface-hover`, `--surface-active` | `bg-surface-hover`, `bg-surface-active` |
| Copy | `--text`, `--text-secondary`, `--text-muted` | `text-text`, `text-text-secondary`, `text-text-muted` |
| Dividers / input outline | `--border`, `--border-strong` | `border-border`, `border-border-strong` (shadcn: `border-input`) |
| Focused text field | `--border-focus` | `border-border-focus` |
| Keyboard focus on controls | `--focus-ring` | global rule, see States |
| Accent | `--accent`, `--accent-hover`, `--accent-soft`, `--accent-soft-text` | `bg-accent`, `bg-accent-soft`, `text-accent-soft-text` |
| Danger | `--destructive` | `text-destructive`, `bg-destructive/10` |
| Corners | `--radius` (house, 8px) and `--radius-sm/md/lg/xl/full` | `rounded-md/lg/xl/full` |
| Elevation | `--shadow-input`, `--shadow-sm`, `--shadow-md`, `--shadow-pop` | `shadow-input`, `shadow-sm`, `shadow-md`, `shadow-pop` |
| Motion | `--duration-fast/base/slow`, `--ease-swift` | `duration-100/150/300`, `ease-swift` |

The shadcn vocabulary (`bg-background`, `text-muted-foreground`,
`border-input`, `bg-popover`) is bridged onto the same tokens in
`apps/desktop/src/styles/index.css`; either name is fine inside `ui/`, the
DS names are preferred everywhere else. Two names are deliberately *not*
bridged: `--accent` is the brand color, not shadcn's hover wash (use
`bg-surface-hover` for that), and the shadow ramp is owned by
`design-system/tokens/colors.css` because it changes per theme.

Themes (`data-theme`), accents (`data-accent`), radius (`data-radius`) and
density (`data-density`) are scopes on the document root. A component only
ever names a token, so a theme change moves every surface at once. Never
hard-code a hex in a component.

## Typography

One typeface, Inter Variable (`--font-sans`), with `system-ui` on iOS.

| Role | Token | Size |
| --- | --- | --- |
| Section headers, shortcut hints, meta | `--text-2xs` | 12px |
| Sidebar rows, captions, labels | `--text-xs` | 13px |
| Buttons, menu items, default chrome | `--text-sm` | 14px |
| Editor body | `--text-base` | 16px |
| Note H2 / lead UI heading | `--text-xl` | 20px |
| Note title, daily-note date | `--text-subject` | 28px |

Weights: 400 body, 500 for buttons, nav and titles (the workhorse), 600 for
the note subject and dialog titles. Chrome uses `--leading-normal` (1.5),
prose `--leading-relaxed` (1.7). Inter's default tracking is `-0.011em`; go
tighter (`--tracking-tight`) only at 20px and above. Keep shortcut glyphs
(⌘ ⌥ ⇧) in `--font-shortcut`.

## Spacing and layout

A 4px grid (`--space-1` … `--space-24`). Chrome is dense: 16px sidebar
gutter, 6–10px vertical inside menu items, 32px (`h-8`) control height,
28px (`h-7`) for the small variant. The editor column is
`--editor-measure` (46rem). Row height and nav padding follow the density
setting through `--row-height` and `--nav-padding-y`; do not size a list row
in a component.

Radii are gentle and proportional: `rounded-md` for menu items and small
controls, `rounded-lg` (the house 8px) for buttons, inputs and cards,
`rounded-xl` for dialogs and popovers, `rounded-full` for pills, avatars and
the send button. Components name the scale, never a pixel value, so the
radius setting rescales everything together.

## Color

- Light: near-white canvas, `#17181c` ink. Dark: charcoal, `#ededf0` ink,
  a lifted accent (`#7b7ef4`) so it holds contrast on dark. Each theme
  variant re-declares only what it changes.
- Body copy and control labels meet 4.5:1 (`--text`, `--text-secondary`).
  `--text-muted` is for placeholders, shortcut hints and meta only — never
  for something the user must read to act.
- Non-text UI (borders of inputs, icons that carry meaning, the focus ring)
  meets 3:1 against its surroundings (WCAG 1.4.11). `--border` (7% ink) is
  decorative and exempt; `--border-strong` is the input outline.
- Semantic colors mean one thing each: `--destructive` for irreversible
  actions and errors, `--green-500` success, `--amber-500` warning. Do not
  color-code categories with them.
- Icons inherit `currentColor`. Use `text-text-muted` for a resting icon,
  `text-text` on hover, `text-accent` only for an "on" state.

## States

Every interactive element has the same five states, and they are produced by
the same tokens everywhere.

| State | Treatment |
| --- | --- |
| Hover | `bg-surface-hover` wash on rows and ghost buttons; `--accent-hover` on solid accent buttons; `text-text` on muted icon buttons. Nothing moves. |
| Active (pressed) | `active:scale-[0.97]` on buttons (150ms, `ease-swift`); `bg-surface-active` on rows. |
| Selected / current | `bg-surface-active` row, `text-text`; accent (`bg-accent`, `bg-accent-soft`) only when selection is *the* primary state of the surface (checked box, current tab pill, chosen option). |
| Disabled | `opacity-50` and `pointer-events-none` / `cursor-not-allowed`. No greyed color swaps. |
| Focus | See below. |

### Focus

Two rules, defined once in `apps/desktop/src/styles/index.css` and never
re-added per component. They are unlayered CSS, so a Tailwind
`focus-visible:` utility cannot override them; that is the point.

**Controls** — buttons, links, checkboxes, switches, select triggers, tabs,
focusable rows and cards:

```css
:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 2px;
}
```

Shown on keyboard focus only (`:focus-visible`), never on mouse or touch.
A 2px solid outline is the shape WCAG 2.2 SC 2.4.13 names as sufficient:
it covers the 2px perimeter of the control, and `--focus-ring` is the accent,
which the default indigo keeps above 3:1 against both the light and dark
surfaces (pale user accents such as amber or lime trade some of that away;
that is the user's choice, not a component's). The offset keeps the ring off
the control's own border so both stay legible. Outlines follow
`border-radius`, so pills get a round ring for free.

**Text entry** — `<input>`, `<textarea>`, the chat composer, the palette and
find inputs, the note editor:

```css
:focus-visible {
  outline: none; /* the ui/ primitives step the border instead */
}
```

No outline, no ring, no glow, on any input event. Browsers match
`:focus-visible` on a text field the moment it is focused by any means, so
a ring on inputs is a highlight that lights every time you click to type —
the noise this rule exists to remove. The focus indicator is the caret plus
the field's border stepping from `--border-strong` to `--border-focus`
(40% of the theme's ink, neutral by construction, warm on Paper and Ink).
Composite fields (`InputGroup`, the chat composer) step the wrapper's border
with `focus-within`. Borderless fields inside a frame (the ⌘K palette, the
find pill, quick capture) show only the caret; the frame is the state.

This departs from macOS, which rings text fields in the accent. Kore is an
editor: the caret is always the focus, and the editor itself never draws a
ring. Text fields follow the editor, not the toolbar.

**Not ringed** — menu items, listbox options and command-palette rows show
focus as the row highlight (`focus:bg-surface-hover`), the HIG idiom for
lists; dialogs, menus and listboxes that take focus on open are their own
indicator. Hidden radios behind option cards (Appearance) move the outline
onto the card with `has-[:focus-visible]:outline-2`, the one sanctioned
per-component focus utility, and it must reproduce the control shape above.

Focus must not be obscured (2.4.11): nothing sticky may cover a focused
element, and a focused row inside a scroll container scrolls into view.

## Overlays

Menus, selects, popovers, dialogs, tooltips and toasts share one recipe from
`ui/`: `bg-popover` (88% `--surface` + backdrop blur/saturate, so the layer
reads as *above* the page), `ring-1 ring-foreground/10` as the edge,
`rounded-lg` (menus) or `rounded-xl` (dialogs, palette), and the shadow tier
that matches the height — `shadow-md` for menus and popovers, `shadow-pop`
for dialogs, the palette and toasts. Liquid Glass raises the same
variables; do not add a second glass recipe.

Always use the shadcn component in `ui/` (`DropdownMenu`, `Popover`,
`Dialog`, `Tooltip`, `Command`, `Select`, `Drawer` on mobile). Never
hand-roll an overlay: focus trapping, escape, outside-click and the
animation contract come with the primitive.

Enter with `fade-in-0 zoom-in-95` from the anchor
(`origin-(--transform-origin)`), 150ms `ease-swift`; exit with the reverse.
Menus align to their trigger; dialogs center; the palette sits at the top
third.

## Motion

Short and calm. `--duration-fast` (100ms) for color and opacity,
`--duration-base` (150ms) for presses, lifts and overlay entry,
`--duration-slow` (300ms) only for layout moves such as rail collapse. One
curve, `--ease-swift` (fast out, soft landing). No bounces, no springs, no
motion on hover except the color change itself.

`prefers-reduced-motion` collapses every transition and animation app-wide
(`index.css`); do not gate individual animations by hand, and do not use
`motion-reduce:` utilities to reintroduce motion.

## Do / Don't

**Do**

- Build on `ui/` primitives and the semantic tokens; add a token before
  adding a hex.
- Let the global focus rule work: a new button, link or row needs *no*
  focus classes.
- Use `focus-within:border-border-focus` on a composite text field's frame,
  and nothing else for its focus.
- Keep icons on the Solar linear set at `size-3.5`/`size-4`, 1.5px stroke.
- Match control heights (`h-8`, `h-7`) and the 4px grid.

**Don't**

- Don't add `focus-visible:ring-*`, `focus-visible:border-ring`,
  `focus-within:ring-*` or `outline-none` to a component — the first three
  build a second, off-rule indicator; the last is a no-op against the
  unlayered rule and reads as an opt-out that never happens.
- Don't ring, glow or recolor a text field on focus, and don't lift its
  shadow.
- Don't use the accent for hover, dividers or "important" copy.
- Don't invent an overlay, a badge color, a shadow or an easing.
- Don't use Tailwind's default `shadow-lg`/`shadow-xl`; the DS tiers are the
  only elevations.
