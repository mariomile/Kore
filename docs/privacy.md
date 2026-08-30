# What leaves the device, and when

Kore is local-first: your notes are markdown files in a folder you chose, the search
index is SQLite in `.reflect/` beside them, and **no Kore-hosted server exists in any
path** — there is no product analytics and no account. Kore does not send exception diagnostics or product analytics. Every network call the app can make is listed here, with what it carries.

The one hard rule sits above all of it: **a note with `private: true` frontmatter never
has its content sent to any external service.** Two different mechanisms enforce it,
and it is worth knowing which one you are relying on.

For everything the app sends itself, it is the `CloudSafe` type brand in
`packages/core/src/ai/`: content for a provider cannot even be constructed from a private
note, the flag is re-read from disk at call time, and an unchecked payload does not
compile. For the coding-agent CLIs, which read your files themselves rather than being
handed content, it is a deny list instead. See
[Coding-agent CLIs](#coding-agent-clis-off-until-you-configure-one) for what that means in
practice. Both are covered by tests.

## AI chat (off until you add a key)

- **Where:** directly to the provider whose API key *you* added — OpenAI, Anthropic,
  Google, or OpenRouter. Keys are bring-your-own; Kore proxies nothing.
- **What:** your chat messages and configured system prompt, plus what the model's
  tools read from your graph: search snippets, note content, and note listings. The
  configured prompt is stored in the device's ordinary settings file and is sent with
  every chat turn. Private notes are dropped from every tool result, and reading one is
  refused outright — the model sees a refusal, not the content. That protection cannot
  identify note content you manually paste into a message or the configured prompt.
- **When:** only while you use chat (⌘J). No background calls.

## Audio memos (off until you add a key)

- **Where:** directly to your configured providers. OpenAI or Google receives the
  recording for speech-to-text. A small text model from your configured OpenAI,
  Anthropic, or Google provider receives the fresh transcript to create the memo
  title and, when Transcription auto-format is enabled, add punctuation, paragraphs,
  and light Markdown to the body.
- **What:** the recorded audio bytes and the transcript produced from that recording.
  Existing note content is never read or sent. The resulting Markdown is written
  locally. Because no note content is read, recording works even when today's note is
  private. Turn Transcription auto-format off in Settings to store the raw provider
  transcript; the title-generation call still receives that transcript.
- **When:** when you record a memo, and on retry for memos still awaiting
  transcription.

## Semantic search (off by default)

- Embeddings are computed **on-device** (a bundled ONNX runtime; `all-MiniLM-L6-v2`)
  and stored in `.reflect/`. Note content never leaves the machine for embedding.
- Enabling it downloads the model (~90 MB) **from Hugging Face, once**. That request
  carries no user data; the model is cached locally afterwards.

## Backup & sync (off until you connect)

- **Where:** the git repository you connect — GitHub guided in-app (created **private**
  by default; a public repo requires explicit confirmation), or any git host over SSH.
- **What:** the whole graph as git commits — including notes marked `private: true`.
  The privacy flag blocks *services that read your content*; backup is your own
  repository, and excluding private notes from it would silently lose them.
- **When:** after you connect, on the background backup cadence and on "Back up now".
- GitHub sign-in uses your personal access token; the token is stored
  in the OS keychain.

## Browser capture (the Chrome extension)

- **Where:** nowhere on the network. The **Kore Capture** extension hands each
  capture to a local native-messaging host (`reflect-capture-host`) that the desktop
  app registers on your machine; the host spools it to the capture inbox on disk
  (`<graph>/.reflect/inbox/`) and the app drains it on next launch. **No Kore-hosted
  server, no third party, and no other destination is ever contacted** — the extension
  stores no keys and makes no AI or network calls of its own.
- **What:** only the page you explicitly capture (toolbar button or ⌘⇧K) — its URL,
  title, your current text selection, a screenshot of the visible tab, and, only when
  you tick "Capture page text", the page's extracted text. Nothing is read in the
  background; the extension requests no broad host permissions and acts on the active
  tab only at the moment you trigger it.
- **When:** when you capture. If the desktop app isn't reachable yet, the capture is
  held in the browser's local extension storage and retried automatically until it
  spools — it is never sent anywhere else in the meantime.
- Once a capture lands in your graph, the desktop app's rules above apply unchanged:
  enrichment may request the captured URL directly to read page metadata. On macOS and
  iOS, Kore also asks Apple's LinkPresentation framework for one representative
  image when the capture has no screenshot. These requests go to the captured website
  and any redirects or subresources selected by the operating system, never through a
  Kore server. The app re-reads the capture and daily note before and after each
  request; `private: true` prevents the request or discards its result. A successful
  image is downscaled and stored as a local JPEG in the graph. Any BYOK AI enrichment
  then follows the provider rules above.

## Coding-agent CLIs (off until you configure one)

- **Where:** the vendor's own service, through a CLI you installed and signed into
  yourself (Claude Code, Codex, or Cursor). Reflect starts the process; it never sees or
  proxies the traffic, and no key is stored here.
- **What:** whatever the agent decides to read. It runs with your graph folder as its
  working directory and reads files with its own tools, so this is the one AI surface
  where Reflect is not the thing assembling the payload.
- **How private notes are fenced:** before each run, Reflect queries the index for every
  `private: true` note and writes absolute per-file `Read`, `Write` and `Edit` deny rules
  into the CLI's own permission layer, alongside `.reflect/**` and `.git/**`. The rules
  are matched by the CLI, not by prompting, so the agent cannot talk itself past them.
- **The limits, stated plainly:** the list comes from the SQLite index rather than from
  the files, so it is only as good as the index. If the index cannot answer, because it is
  mid-rebuild after an app update, the run is refused rather than started with an
  incomplete list. A note you marked private in the last instant before the index caught
  up is the residual gap, and it closes as soon as the file is re-indexed.
- **Off by default:** yes. Nothing runs until you configure a provider in Settings, and
  edit mode is a second, separate opt-in.
- **MCP servers (a third opt-in, twice over):** servers you configure in Settings → MCP
  servers can give agent chat external tools, which means chat content and the notes the
  agent reads may reach those servers. They ride every edit-mode run, and a read-only
  conversation only after you flip the composer's Tools toggle and confirm the dialog
  that names the servers involved. That opt-in is per conversation and per session: New
  chat, switching conversations, and restarting the app all turn it back off. Without
  it, read-only chat stays what it always was, a zero-egress surface where nothing but
  the model's own service sees content. Cursor never gets MCP either way.

## Apple Contacts (off by default)

- **Where:** nowhere on the network. Enabling the Contacts integration reads the
  **macOS/iOS contacts store on-device** (the same store System Settings governs),
  behind the standard OS permission prompt. There is no Kore copy of your address
  book: lookups are live queries, nothing is mirrored into `.reflect/`, and Kore
  never writes back to Contacts.
- **What:** a note title or a meeting attendee's email is matched against your
  contacts; a match's name, email, and phone are shown on a suggestion card. Contact
  details enter a note **only when you click Add**, at which point they are ordinary
  markdown you own — covered by the same rules as anything else you type (including
  `private: true` and backup).
- **When:** only while the integration is on, and only for the note being viewed (or
  the meeting being added). Turning it off — in Settings or in the OS privacy pane —
  stops all reads immediately.

## Exception diagnostics

Kore does not include an external exception reporter. Errors remain local; no diagnostic events or source maps are sent to Reflect or Sentry.

## Housekeeping calls

- **API key validation:** adding a provider key sends one cheap authenticated probe to
  that provider to test it. No content.
- **Update check:** the packaged app fetches a release manifest (`latest.json`) from
  this repository's GitHub Releases on launch and every six hours. Stable builds check
  the latest stable release; beta builds check the beta feed. The app downloads the
  update archive only when you ask it to install. No user data is sent; payloads are
  verified against a public key compiled into the app before installing. Offline, the
  check fails silently and the app carries on.

## Secrets

API keys and tokens live in the **OS keychain only** — never in markdown, never in
`.reflect/`, never in git. Deleting a provider in Settings deletes its keychain entry.

## Summary table

| Call | Destination | Carries note content? | Off by default? |
| --- | --- | --- | --- |
| AI chat | Your chosen provider | Yes — private-note tool reads are blocked | Yes (needs your key) |
| Coding-agent CLI | The vendor's service, via a CLI you installed | Yes, with private notes fenced by per-file deny rules | Yes (needs a configured provider) |
| Audio transcription | Your chosen providers | No existing note content; audio and its fresh transcript | Yes (needs your key) |
| Embeddings | Nowhere (on-device) | — | Yes (opt-in download) |
| Model download | Hugging Face | No | Yes (opt-in) |
| Backup | Your git repository | Yes — including private notes | Yes (needs connecting) |
| Key validation | The provider | No | — (only when adding a key) |
| Update check | GitHub Releases | No | On in packaged builds |
| Browser capture | Nowhere (local host on disk) | — (stays on your machine) | — (only when you capture) |
| Capture metadata and preview | The captured website, via Kore and Apple LinkPresentation | URL only; private captures are blocked | No (after an explicit capture) |
| Contacts lookup | Nowhere (on-device OS store) | — (stays on your machine) | Yes (opt-in) |
| Exception diagnostics | Nowhere | — | Disabled |
