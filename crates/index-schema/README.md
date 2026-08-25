# reflect-index-schema

Shared schema + migrations for `<graph>/.reflect/index.sqlite` (Plan 04/14).

The desktop app (writer) and the `reflect` CLI (read-only) both depend on
this crate, so the schema can never skew between them. Everything that
creates or migrates the schema sits behind the `vec` feature — the vec0
virtual tables require the sqlite-vec extension; read-only consumers build
with `default-features = false` and get just the constants.

Migrations live in `migrations/` as append-only numbered SQL files tracked
via SQLite's `user_version` pragma: never edit a shipped migration, append a
new one and bump `LATEST_SCHEMA_VERSION`.

Almost every table is a rebuildable projection of the markdown — except the
`chat_*` tables, which hold durable AI chat history. Wipe-style migrations
and `index_clear` must never touch them.
