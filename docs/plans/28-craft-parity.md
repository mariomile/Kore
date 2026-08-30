# Plan 28 — Craft parity: the visual and interaction register

**Status:** Direction set 2026-08-30 (user request, with Craft screenshots as
the reference); slice 1 in this wave.
**Outcome:** Kore reads and feels like Craft — surfaces, depth, cards,
micro-interactions — without restructuring the app. The left sidebar stays
Kore's own (explicitly liked as-is); everything else converges on Craft's
register.
**Navigation:** [Roadmap](../roadmap.md) · [STATE](../STATE.md).

## What "Craft" decomposes into

Craft is a native Swift app, but nothing in its visual language needs Swift.
Studying the reference shots, the register is five reproducible decisions:

1. **Content dissolves, it never clips.** Scrolled content melts under the
   chrome through a progressive blur + fade instead of hard-clipping at a
   bar's edge. There is no opaque toolbar line anywhere; depth comes from
   translucency over motion. On the web this is exactly
   `backdrop-filter: blur()` stacked in bands under `mask-image` gradients —
   WebKit's home turf (it is Apple's own recipe).
2. **Cards are live previews.** The document grid renders each note's actual
   content — headings, checkboxes, images, tables — at small scale, fading
   out at the card's bottom edge, on a surface one step lighter than the
   page with a hairline border and generous radius.
3. **Quiet circular chrome.** Header actions are small round/pill icon
   buttons that brighten on hover; primary actions are filled pills (Share).
   Titles are large and in-content, not bar text.
4. **One motion register.** Everything transitions 150–250ms on a soft-out
   curve; hover reveals affordances (block handles, row actions) rather than
   permanent chrome.
5. **Flat neutral color.** Craft dark is the graphite register (near-black
   page, cards a step lighter, no blue cast); Craft light is white cards on
   soft grey.

## What Kore already has

The gap is smaller than it looks — most of the machinery predates this plan:

- **Tokens:** the DS already ships `graphite` (Craft's dark register,
  verbatim) and `ash` (its light register, the token comment even names
  Craft), the house radius scale, two-layer shadow tiers, `--ease-swift`,
  and the `--layer-blur`/`--layer-saturate` translucency knobs every popover
  and the ⌘K palette already use.
- **Glass precedents:** mobile shell bars (`mobile-glass-bar`), Liquid Glass
  (`data-glass`), the popover blur floor.
- **Compact rich previews:** the wiki-link hover card already re-scales the
  editor's type ramp into a small live preview with an overflow fade — the
  exact rendering a Craft-style card needs.
- **Block affordances:** meowdown owns the drag handle and node selection;
  styling reaches them through `--meowdown-*` variables.

## The slices

Each slice is one PR, shippable alone, in priority order:

- **Slice 1 — the scroll veil (this wave).** `ScrollVeil`
  (components/scroll-veil.tsx): a dissolve zone at a scroll container's top
  edge — surface fade over two progressively-masked blur bands — that exists
  only while the container is scrolled, so resting content is never blurred
  and there is no per-frame scroll work (one boolean flip). Applied to the
  daily stream, the single note view, and All Notes' grid; the list/table
  views translate the same idea to their pinned header rows, which switch
  from opaque paint to glass (`app-glass-row`) so rows dissolve beneath
  them. No layout, routing, or virtualizer change: the veil is pure paint
  over the existing containers.
- **Slice 2 — live-preview cards.** The All Notes grid card becomes a Craft
  card: real markdown preview (the hover-card recipe: compact type ramp,
  bottom fade mask) instead of a plain-text snippet, title row with glyph,
  radius-xl surface, hover tint. Property chips on cards for typed tags —
  this absorbs the queued "gallery view with properties" backlog item.
  Constraint to respect: the grid flows down CSS columns, and WebKit
  fragments shadows/transforms across columns — hover stays border+tint,
  no lift.
- **Slice 3 — chrome details.** Round quiet icon buttons normalized across
  screen headers; the daily date pill navigation (‹ date ›) on daily notes;
  large in-content titles where a surface still puts its title in the bar.
- **Slice 4 — editor block affordances.** Hover drag-handle + ellipsis and
  the soft selected-block field, Craft-style. This bottoms out in meowdown
  (per CLAUDE.md: fix it there); the app side is theming through the
  existing `--meowdown-*` seams.

Colors need no slice: `graphite`/`ash` exist as theme variants today, and the
default themes keep their identity — Craft parity is structure and motion,
not a forced palette swap.

## What this plan deliberately does not do

- **No sidebar redesign.** Kore's left sidebar stays as it is.
- **No information-architecture change.** Routes, views, selection,
  keyboard model, and persistence are untouched; this is a paint-and-motion
  program.
- **No scroll listeners in hot paths.** The veil's one listener flips a
  boolean; nothing repaints per scroll frame beyond what the compositor
  already does for `backdrop-filter`.
