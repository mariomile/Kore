# reflect-capture-host

`reflect-capture-host` — the native-messaging host the Chrome capture
extension (`apps/extension`) talks to (Plan 11).

A small Rust binary: stdin/stdout carry the Chrome native-messaging protocol
(stdout belongs to that channel exclusively; diagnostics go to stderr, which
Chrome surfaces in its extension logs). Captures are spooled durably on disk
(Maildir-discipline atomic writes into the graph's spool directory) so a
capture succeeds even when the desktop app is not running; the desktop
watcher and drain pick committed captures up.

Bundled with the desktop app as a Tauri sidecar. Test with
`cargo test -p reflect-capture-host`.
