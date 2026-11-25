---
name: kore-canvas
description: Draw boards in a Kore graph as .canvas files (JSON Canvas, the format Obsidian writes and Kore opens on Mac and iPhone): note cards, text cards, images, links, groups and arrows. Use when the user asks for a canvas, a board, a visual map of a project or folder, a mind map or moodboard, or to lay notes out spatially.
---

# Kore canvas

A canvas is a `.canvas` file anywhere in the graph: JSON Canvas 1.0
(https://jsoncanvas.org), exactly as Obsidian writes it. Kore lists every
canvas and draws it as a board you pan and zoom, on the Mac and the iPhone.
The file is plain JSON in the vault, so a board you write is also a board
the user can open in Obsidian.

## Fastest path: a folder as a board

```sh
kore canvas "Projects/Studio"          # writes Projects/Studio/Studio.canvas
kore canvas Projects --out Maps/Projects.canvas --limit 60
```

(MCP: `draw_canvas`.) The folder's own notes become a grid of note cards,
each subfolder a labelled group, and every wiki link between two notes on
the board an arrow. It never replaces an existing board unless you pass
`--force`, and only pass it when the user asked for a fresh one: they may
have arranged the old board by hand.

Write the JSON yourself when the board is not a folder: a mind map around
one idea, the people on a deal, a moodboard of images, a timeline.

## The file

```json
{
  "nodes": [
    { "id": "6f2c1a0b9e8d7c6a", "type": "group", "label": "Research",
      "x": 0, "y": 0, "width": 920, "height": 400 },
    { "id": "1a2b3c4d5e6f7081", "type": "file", "file": "Projects/Brief.md",
      "x": 40, "y": 40, "width": 400, "height": 280 },
    { "id": "8a9b0c1d2e3f4051", "type": "text", "text": "## Open questions\n- Pricing?",
      "x": 480, "y": 40, "width": 400, "height": 280, "color": "4" }
  ],
  "edges": [
    { "id": "f0e1d2c3b4a59687", "fromNode": "1a2b3c4d5e6f7081", "toNode": "8a9b0c1d2e3f4051",
      "label": "raises" }
  ]
}
```

| Node `type` | Keys besides `id x y width height` | Kore draws |
|---|---|---|
| `file` | `file` (graph-relative path), optional `subpath` (`#Heading`) | A note card with its title and a live preview; an image file as the picture; a `.canvas` or `.base` as a link to open it |
| `text` | `text` (markdown) | A card rendering the markdown |
| `link` | `url` | A web link card |
| `group` | optional `label` | A labelled frame behind the cards inside it |

Optional on every node: `color`, a preset `"1"`–`"6"` (red, orange,
yellow, green, cyan, purple) or a hex `"#RRGGBB"`.

Edges: `fromNode` and `toNode` (node ids, required), optional `fromSide`
and `toSide` (`top`, `right`, `bottom`, `left`), `fromEnd`/`toEnd`
(`none` or `arrow`; by default only the end has an arrow), `label` and
`color`.

## Layout rules

- Ids are unique strings; Obsidian writes 16 hex digits. Keep them stable
  when you rewrite a board, so the user's references survive.
- Coordinates are integers in canvas units; `y` grows downward. A note card
  reads well at 400×280; a text card at 300–400 wide.
- Leave a 40-unit gap between cards. Nothing may overlap except a group and
  the cards inside it, with 40 of padding on every side.
- Nodes draw in array order: put a group **before** the cards it holds.
- Reference notes with `file` cards, never by pasting their text into a
  `text` card: the card stays live as the note changes.
- Link a `file` only to a path that exists, and never to a note marked
  `private: true`.

## Rules

1. **Edit a board the user arranged only where asked.** Moving their cards
   loses their layout: add new nodes in free space instead.
2. **Write the whole file atomically** (write a sibling temp file, then
   rename), and keep it valid JSON: Kore and Obsidian skip a file they
   cannot parse.
3. **Name the board for its subject** (`Studio map.canvas`) and save it next
   to the notes it shows, unless the user names a place.
