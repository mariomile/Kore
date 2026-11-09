# Plan 35: cyber-brain as Kore's memory engine

(Numbered 35 because Plan 34 is Kore Cloud, #364.)

Status: slice 1 in progress (2026-11-09). Asked by Mario: "cyber-brain as a
native plugin for Kore, so memory management shows there and the chat learns
it from the plugin", with one principle: memory behaves the same whether he
writes from Kore, Claude, or any other agent.

## What cyber-brain is

Mario's own kit that turns a folder of Markdown into a memory every agent
uses the same way. The vault declares it in the frontmatter of `AGENTS.md`
(`cyber_brain: "0.1"`, `paths`, `daily_notes`, `writers`, `agents`); the
contract is `System/SPEC.md`; every memory write goes through the vault's
own `node System/scripts/brain.mjs` (`remember`, `loop`, `decision`), which
applies the formats, appends a run record to `System/runs/YYYY-MM.md` and
commits.

## The deciding choice: one implementation

Kore does not re-implement the kit's formats. It runs the vault's
`brain.mjs` for every memory write, the same code Claude Code and the
nightly cloud `dream` run, versioned with the vault. Rust owns the
capability (spawn Node with fixed arguments, never a free shell); core owns
the policy (when, with what). Node 18+ is required for writes; without it
memory is read-only and Kore says so, it never writes another format.

When `AGENTS.md` declares `cyber_brain:`, Kore's own agent memory
(`agents/user.md`, `agents/memory/*`, the `remember` line format) is off for
that vault.

## Trust model

`kit_script_run` executes a file that lives in the vault, and the vault
syncs (git, Kore Cloud). Whoever can write `System/scripts/brain.mjs` there
gets code run on this Mac at the next memory write, with the user's rights.
That is the same trust Claude Code, Codex and the nightly `dream` already
place in the file, since they run it too; Kore adds no new writer, but it
does add a runner. Guards that hold today: the script must resolve inside
the graph (no traversal, no symlink out), only `.mjs`/`.js`, Node gets an
argv and never a shell, a timeout kills the whole process tree, and core
only ever runs the subcommands listed in `cyber-brain/script.ts`.

To add in step 4, before the chat can trigger a run: Kore remembers the
hash of the script it last ran for this vault and, when the file changed
since (a kit upgrade, or a synced edit nobody made here), asks once before
running it, naming what changed. A vault never seen before asks too.

Git: with `git: true` the kit commits the files it wrote, and Kore's own
backup sync (`git/commit.rs`, libgit2 `commit_all`) commits the same repo.
They can meet on `.git/index.lock`. Both sides fail soft: the kit catches
a failed commit and keeps the write (the run record then has no `commit:`
line) and Kore's next sync pass stages whatever is left. Nothing is lost;
at worst one write is committed by Kore's backup instead of the kit. Kore
does not pass `--no-commit`: the run record must match what Claude Code
writes.

## Slices

1. **The chat writes memory like Claude Code.** `sensitivity: private` is the
   same hard block as `private: true`; the chat contract budget matches
   `kore guide` (20,000); detection from `AGENTS.md`; a native command that
   runs `brain.mjs` with fixed subcommands; chat tools `remember`, `loop`,
   `decision`; the kit's `System/skills/` served as vault skills.
2. **Kore MCP does the same** for ChatGPT, Grok and other remote agents, the
   agent name coming from the per-agent key (#321).
3. **Memory view**: NOW, open loops, decisions, run records with undo,
   `brain.mjs check` health. Read from the kit's files, no new data.
4. **Optional**: `dream` / `weekly` as Kore routines with `brain.mjs check` as
   the script tick, only if the cloud routine is not enough.

Out of scope: changing the kit or the vault for Kore; converting a
cyber-brain vault's daily notes to `daily/` (Kore reads `daily_notes` from
`AGENTS.md` instead).

Analysis: project files `analisi/cyber-brain-in-kore.md`,
`analisi/cyber-brain-plugin-piano.md`.
