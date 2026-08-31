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

## The real gap

The machinery below shortens the build, but a side-by-side against the
reference shots (user correction, same day: "make sure we really use
Craft's UX and UI") shows the distance is not one missing effect. Four
register-level differences carry almost all of it:

- **Scale and air.** Craft titles are display-sized (28px+) with generous
  padding everywhere; Kore's were chrome-sized (15px screen titles, a 20px
  note subject) over dense rows. This single dimension does more than any
  effect.
- **Separation by space, not lines.** Kore drew hairlines between days,
  rows, and panels; Craft separates with whitespace and surface steps, and
  spends its one hairline under the title.
- **Cards as documents.** A title + plain-text snippet is not a Craft card;
  the card is the note, rendered small.
- **Bars vs. floating chrome.** Craft has no opaque toolbar lines; content
  passes under quiet floating controls.

## What Kore already has

Most of the machinery predates this plan:

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

- **Slice 1 — the register pass (this wave).** The four gap dimensions at
  once, on the main surfaces:
  - *Dissolve, don't clip*: `ScrollVeil` (components/scroll-veil.tsx), a
    dissolve zone at a scroll container's top edge — surface fade over two
    progressively-masked blur bands — that exists only while the container
    is scrolled (one boolean flip, no per-frame work). On the daily
    stream, the note view, and All Notes' grid; the list/table pinned
    header rows switch from opaque paint to glass (`app-glass-row`).
  - *Scale*: the note subject (`--text-note-subject`) moves 20px → 28px at
    weight 700 / tight tracking — every note title and daily date; screen
    titles (Notes, the tag page) move to the same display size.
  - *Space over lines*: daily-stream days lose the full-width rule between
    rows; each date carries Craft's one hairline under itself, in the
    content column. The note view gains air above the title.
  - *Cards as documents*: the All Notes grid card renders the note's real
    content (NoteCardPreview: the hover-card recipe — compact type ramp,
    read-only static MarkdownView, bottom fade when clamped), upgrading
    from the indexed snippet as each card nears the viewport. Radius-2xl,
    wider columns, more padding. Constraint respected: the grid flows down
    CSS columns and WebKit fragments shadows/transforms across columns, so
    hover stays border+tint, no lift.
- **Slice 2 — collection coherence (shipped).** Property chips on grid
  cards for typed tags (absorbing the queued "gallery view with
  properties" item); the board/calendar cards adopt the same card
  language.
- **Slice 3 — chrome details (shipped).** One `.app-icon-button` recipe —
  a 28px circle whose hover is a soft wash appearing — replaces the mixed
  square/round one-off buttons across the header chrome (All Notes'
  export/columns/views/import cluster, the tag page's gear, the tab
  strip's rail toggles, the history arrows). The daily stream gains
  Craft's ‹ date › pill: floating quiet chrome over the veil that names
  the day being read (focused day first, routed day as fallback), hops to
  adjacent days, and jumps back to today from its label. The line audit
  the slice called for found the strip and panel edges already clean —
  slice 1's floating-card layout carries separation by surface, and the
  one hairline the sticky table header keeps is legibility over scrolled
  rows, kept deliberately.
- **Slice 4 — editor block affordances and the context panel (app side
  shipped).** The selected block reads as Craft's soft tinted field: the
  `--meowdown-node-outline` seam moves to a 45%-translucent accent, so the
  wash carries the state and the ring only sharpens its edge. The context
  rail adopts the grouped-rows register: every `SidebarSection` body (note
  actions, properties, tasks, outline, history, similar, events,
  published) becomes a soft raised container on the sunken rail — quiet
  label above, rows with their hover wash inside. The hover drag-handle
  already renders quiet from meowdown; what remains — the per-block
  ellipsis button beside the grip, and any handle geometry polish — lives
  in the meowdown repo (its classes are hashed CSS modules, deliberately
  not a seam) and is queued there, per CLAUDE.md's fix-it-there rule.

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
