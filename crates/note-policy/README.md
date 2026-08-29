# reflect-note-policy

Shared frontmatter parsing and title-derivation policy for the native
surfaces (the desktop shell and the `reflect` CLI).

`frontmatter` mirrors `packages/core/src/markdown/frontmatter.ts` (split
semantics) and `model.ts` (field coercions): tolerant, read-only parsing of
the fields native code needs — `id`, `title`, `aliases`, `private`. Broken
YAML degrades to "no frontmatter" rather than an unreadable note; `private`
follows the TS `coercePrivate` rules exactly, since it is the hard privacy
block and must never drift.

`heading` mirrors the `first_h1` half of `packages/core/src/markdown/extract.ts`:
the first level-1 heading with non-empty text, using `pulldown-cmark` for
CommonMark semantics (a `# line` inside a code fence is not a heading).

Kept in lockstep with `packages/core/src/markdown/`; the shared parity corpus
lives in `fixtures/parity/` and pins both native consumers through
`apps/cli/tests/parity.rs`. Test with `cargo test -p reflect-note-policy`.
