# reflect-graph-paths

Shared graph-relative path classification for the native surfaces (the
desktop shell and the `reflect` CLI).

The durable boundary is deliberately lexical, with one canonical
representation: a forward-slashed wire path, shared with TypeScript on every
platform. Native paths go through `wire_path` first, so redundant
separators, `.` components, and non-UTF-8 names fail closed instead of
classifying differently per entry point. `walk.rs` adds the ignore-aware
vault walker used to catalog a graph.

Kept in lockstep with `packages/core/src/graph/paths.ts`; the shared
classification corpus lives in `fixtures/graph-path-classification.json` and
pins both implementations. Test with `cargo test -p reflect-graph-paths`.
