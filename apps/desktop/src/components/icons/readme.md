# Icons

The app draws from a single icon family: [Solar](https://www.figma.com/community/file/1166831539721848736)'s
`-linear` set — a 24×24 grid, a 1.5px hairline stroke, and rounded terminals.
That weight is the point: at the 14–18px the UI actually renders icons at, a
2px stroke crowds its own counters and reads as a heavier, blunter glyph than
the text beside it.

## Using an icon

```tsx
import { Search } from '@/components/icons'

<Search aria-hidden className="size-4" />
```

Every icon takes the SVG props plus `size` (default `24`, overridden by any
`size-*` class) and `strokeWidth` (default `1.5`). `fill`, `stroke`, and
`strokeWidth` all live on the `<svg>` root, so setting one on the element
re-weights the whole glyph.

## Adding an icon

1. Find the glyph in Solar. Only `-linear` ids are eligible — the `-bold`,
   `-outline`, and `-broken` families are a different hand and will look it.
2. Add `ComponentName: 'solar-id-linear'` to `scripts/icon-manifest.mjs`.
3. Run `pnpm --filter @reflect/desktop icons` and commit the regenerated
   `solar-icons.gen.tsx`.

If Solar has no linear equivalent, draw one in `custom-icons.tsx` on the same
grid at the same weight rather than reaching for another library.

The generated file is committed on purpose: the SVG paths get reviewed like any
other source, and the app carries no icon runtime.

## shadcn components

`components.json` still names `lucide` as its icon library — that is the only
value the shadcn CLI emits for. Anything scaffolded with `shadcn add` therefore
arrives importing `lucide-react`; re-point it at `@/components/icons` before
committing, adding the glyph to the manifest if it is not in the set yet.
