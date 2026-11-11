# Kore, always on

Kore's MCP server can run on a machine that never sleeps, over a git clone of
the vault, so every agent (Claude on the web and the phone, ChatGPT, Grok bot,
Codex, Claude Code anywhere) reaches the same memory whether or not a Mac is
awake. Nothing here needs the desktop or mobile app: a vault that only ever
lives in git and is only ever used by agents works the same way. The app, when
there is one, is just another writer to the same repository.

This is Plan 32's slice 2. The pieces:

- `kore index` (Plan 32 prerequisite) builds the search index on the host.
- `kore mcp --http <addr> --sync` serves MCP and keeps the clone in step with
  its remote: it pulls and reindexes in the background, and commits and pushes
  every write an agent makes.
- `kore sync` is one pass of the same thing, for cron or for a look by hand.
- `kore sync --sources` also pulls Readwise and Granola into the vault and
  pushes the result, so those flows keep running with the Mac asleep and
  Obsidian closed (see below).
- `deploy/always-on/` has a Docker image and a systemd unit that wire it up.

## Two writers, one repository

The Mac (the app's git sync, Obsidian Git, or any job that commits and pushes)
and the host both push to one remote, for example
`github.com/<you>/<vault>`. Conflicts are the hard part, and the host avoids
them by construction instead of resolving them.

Every write an agent can make through Kore is a **structural** CLI operation:
append a bullet (`capture`, `append`), claim a new file (`new`), splice one
frontmatter key (`set`), add or remove one tag line (`tag`, `untag`), flip one
task marker (`done`), or replace one passage only if it is unchanged (`edit`).
None of them overwrites a note blindly. So the host records the
**operation**, not just its diff: each write becomes one commit plus one line
in a journal (`.git/kore-sync/journal.jsonl`, outside the working tree). When
the remote has moved, the host:

1. **fast-forwards** if it has nothing unpushed;
2. **rebases** its unpushed commits if they apply cleanly (a new note, a
   different file);
3. otherwise **replays**: aborts the rebase, resets to the remote, and re-runs
   each journaled operation through the CLI on top of the Mac's version, then
   pushes.

Replay goes through the same subcommands with the same arguments, so the
CLI's privacy rule (`private: true` notes are refused), path rules and write
rules apply again. The outcome is what the agent would have got had it
written a moment later: a bullet captured to today's daily lands after the
bullets the Mac added meanwhile. The host never commits conflict markers and
never stops syncing. An operation that no longer applies (the Mac deleted the
note) is dropped and named in the log; nothing is forced.

A push the remote refuses because it moved is retried (fetch, integrate,
push) up to three times per pass. A remote that cannot be reached is not an
error: writes stay committed and journaled, survive a restart, and go out on
the next pass.

What the host does not solve: the **Mac** can still see a conflict when it
pulls the host's commit on top of an unpushed edit to the same lines. Kore's
own git sync commits such a conflict into the note as standard markers and
flags it for review (Plan 12), so it never wedges either. A Mac-side job that
only pushes and never pulls will be rejected once the host has pushed; it has
to `git pull --rebase` (or merge) before pushing.

Before each write the host pulls, so it writes on the freshest tree and a
replay is rare. After each pull that changed files, and after each write, it
runs `kore index`, so search sees the new state within one sync interval
(default 60 s) of a Mac push.

The clone must be dedicated to the host. `--sync` refuses a working tree with
uncommitted changes, and keeps `.kore/` (the index) out of history by
adding it to `.git/info/exclude`, never to the vault's own `.gitignore`. Host
commits are authored `Kore host <kore-host@localhost>` with subjects like
`kore: capture --to=daily/2026-11-04.md … (via MCP)`.

## Readwise and Granola on the host

Set `KORE_READWISE_TOKEN` and/or `KORE_GRANOLA_TOKEN` in the host's
environment, plus the folder, file name pattern and tags you want
(`KORE_<SOURCE>_FOLDER`, `_PATTERN`, `_TAGS`; see `kore sources` in
[cli.md](cli.md)), then run `kore sync --sources` from a timer, for example every
15 minutes:

```cron
*/15 * * * * kore --graph /srv/vault sync --sources
```

It is an ordinary journaled write: `kore sources --since <last run>` is run,
committed as one `kore: sources …` commit and pushed. If the Mac's push wins
the race, the operation is replayed over the same window on top of the Mac's
version; the connector only appends what a note lacks, so a replay never
duplicates. Run it on the host only, not also from the app on the Mac, or two
writers append the same highlights to the same note at once. The first run
imports nothing older than itself; run `kore sources --since YYYY-MM-DD` once
by hand to backfill.

## Run it with Docker

Build from the repository root, then run with a volume for the clone:

```bash
docker build -f deploy/always-on/Dockerfile -t kore-host .

docker run -d --name kore --restart unless-stopped \
  -v kore-vault:/vault -p 127.0.0.1:8765:8765 \
  -e KORE_VAULT_REPO=https://github.com/<you>/<vault>.git \
  -e KORE_GIT_TOKEN=<fine-grained PAT, Contents read/write, this repo only> \
  -e KORE_MCP_TOKEN=$(openssl rand -hex 32) \
  -e KORE_PUBLIC_URL=https://<host>.<tailnet>.ts.net \
  kore-host
```

On first start the entrypoint clones the vault, builds the index (about 13 s
for 5,000 notes), and serves `http://0.0.0.0:8765/mcp` with `--sync`. The git
token reaches git through a credential helper that reads the environment, so
it is never written into `.git/config`.

Each agent can have its own key (#321): pass them as `KORE_MCP_AGENTS`, or
mount a volume for the keys file and point `KORE_MCP_KEYS_FILE` at it (then
`docker exec kore kore keys add "Grok bot" --write`). Keep that file out of
`/vault`, or the host would commit it.

The server does not terminate TLS. Put an HTTPS tunnel in front of port 8765
(Tailscale Funnel: `tailscale funnel 8765`; or Cloudflare Tunnel) and use its
URL as `KORE_PUBLIC_URL`. Agents connect exactly as described in
[MCP server → Remote access over HTTP](cli.md#remote-access-over-http).

## Run it without Docker

On a small VPS: install `kore` and `kore-indexer.mjs` side by side in
`/usr/local/bin` (`cargo build --release -p kore-cli` and
`pnpm --filter @kore/core build:indexer`), Node 22 and git; copy
`deploy/always-on/entrypoint.sh` to `/usr/local/bin/kore-host`; clone the
vault as the service user; put the secrets in `/etc/kore-host.env`; then
install `deploy/always-on/kore-host.service` and
`systemctl enable --now kore-host`.

Any long-running shell works too:

```bash
kore --graph ~/vault index
KORE_MCP_TOKEN=… kore --graph ~/vault mcp --http 127.0.0.1:8765 --sync
```

## Limits

- Semantic (embedding) search stays an app pass; the host's search is the
  full-text and operator search.
- `edit_note` (`kore edit`) replaces a passage only if it still reads what
  the agent saw. It is journaled like the other writes; on replay, if the
  Mac changed that passage meanwhile, the guard refuses it and the edit is
  dropped and logged rather than overwriting the Mac's text.
- One host per vault. Two hosts would each replay over the other and stay
  correct, but nothing tests that setup.
