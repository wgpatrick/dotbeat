# Phase 10 — four parallel streams off the Phase 9 backlog

*Kicked off 2026-07-11, continuing the night-shift pattern from Phase 9
(`docs/phase-9-night-shift-plan.md`). Scope picked from that phase's own "Honestly still open"
list plus untouched items in `ROADMAP.md` / `docs/decisions.md` / `docs/product-spec-desktop.md`
— nothing invented from scratch. Each stream runs in its own git worktree/branch, keeps `npm
test` green, commits as it goes (not pushed), merged back into `main` sequentially by hand.*

## Stream A — Tauri D1 hardening

`docs/phase-9-tauri-spike-plan.md`'s "What's honestly still missing for a real D1" names three
concrete gaps. Close the two that don't need code signing / a paid Apple cert:

1. **Folder re-pointing**: `pick_project_folder` shows the native dialog but choosing a new
   folder doesn't restart the daemon/vite sidecars against it. Wire "Open Folder" to actually
   kill and respawn the sidecars pointed at the new path and re-navigate the window.
2. **Persisted folder scope**: add `tauri-plugin-fs`'s persisted-scope so a dialog-granted folder
   survives app restart (research 13 called this out explicitly).

Sidecar packaging (`yao-pkg`/`pkg` compiled binary) and notarization/signing are explicitly OUT
of scope tonight — both need tooling/credentials beyond a code change, note them as still-open
rather than attempting.

Owns: `desktop/src-tauri/src/lib.rs`, `desktop/src/*`. Zero overlap with dotbeat's `src`/`cli`/
`test`. Result appended to `docs/phase-9-tauri-spike-plan.md` under a new dated section (don't
rewrite the spike verdict).

## Stream B — Sound content: FluidR3 GM + MuldjordKit

`docs/research/09-sample-source-licenses.md`'s bundle-today shortlist has two cleared sources not
yet fetched: **FluidR3 GM** (MIT, item 4 — the GM percussion/instrument bank for the spessasynth
tier) and **FreePats MuldjordKit** (CC-BY 4.0, item 2 — deferred in Phase 7 as "blocked on
GitHub-release proxy access," which Stream F confirmed last night is NOT actually blocked on this
machine: GitHub is reachable).

1. Fetch FluidR3 GM (a real `.sf2`, MIT-licensed per the verified audit) into `presets/sf2/`,
   same provenance-sidecar convention as `presets/sf2/upright-piano-kw-small.sf2.json` (source
   URL, license, credit line, the verified-audit reference).
2. Attempt MuldjordKit fetch (`.h2drumkit` per FreePats); if it really is still blocked, say so
   plainly and move on rather than fighting it — this is a nice-to-have, not the stream's
   critical path.
3. Verify against real content: `beat inspect` on a project with an instrument track pointed at
   the real FluidR3 bank should list its actual GM program names (multi-preset listing shipped in
   Phase 9 Stream C, but only exercised against the single piano `.sf2` so far).

Owns: `presets/sf2/` (new files), `scripts/` (a new fetch script if one doesn't already fit the
existing pattern — additive, don't touch `prep-oneshot.mjs`), `docs/phase-7-plan.md` (append, mark
the FluidR3/MuldjordKit deferred line resolved or still-blocked). No `src`/`cli` changes expected
unless the fetch script needs a home there.

## Stream C — D5 chat-surface: BYO-Claude-Code onboarding

`docs/product-spec-desktop.md` §6 D5: "Ship the BYO-Claude-Code fallback first (our MCP server +
any client — near-zero new work)." `beat mcp` already runs a full stdio JSON-RPC server; what's
missing is the zero-setup path from "I have a dotbeat project folder" to "Claude Code is talking
to it" — today that's tribal knowledge, not a command.

1. `beat mcp-init <file>` (or similar) — writes a ready-to-use `.mcp.json` next to the project
   pointing at `node <repo>/cli/beat.mjs mcp`, so `claude` in that folder just works.
2. A short doc section (`README.md` or a new `docs/agent-setup.md`) walking through it end to
   end: open a project, run the command, open Claude Code, confirm a tool call round-trips.
3. Actually verify it: generate the config, launch `beat mcp` under it, drive one real tool call
   (e.g. `beat_inspect`) and confirm the response, the way Phase 3's session transcript did.

Owns: `cli/beat.mjs` (new command block, additive), a new doc file. Do not touch `src/mcp/
server.ts`'s existing tool surface — this stream is onboarding, not new tools.

## Stream D — Verify beatlab-side clip-automation engine wiring

Phase 9 Stream A shipped format v0.9 (clip automation) but flagged explicitly: "beatlab-side
engine wiring for clip automation is documented but unverified (no local beatlab checkout with
source to confirm against)." Stream F last night proved a beatlab checkout is actually possible
on this machine (cloned to a scratch dir outside this repo's git tree). Use that same approach to
close the gap for real:

1. Clone `https://github.com/wgpatrick/beatlab` to a scratch/gitignored location (same pattern as
   Stream F), `npm install`.
2. Load a `.beat` file with real clip automation (Stream A's `test/format-v09-automation.test.ts`
   fixtures are a starting point) through the daemon bridge into the real beatlab engine and
   confirm automation points actually move the parameter during playback — not just that the
   document round-trips.
3. If the wiring is missing or broken, fix it *in the beatlab checkout* — but this repo's git
   tree has no relationship to that one, and pushing to `wgpatrick/beatlab` is a separate,
   consequential action on a different remote. **Do not push.** Leave the fix as a diff/patch in
   the scratch checkout and write up exactly what's broken and what the fix is; the owner decides
   whether/when to land it on beatlab's own repo.

Owns: nothing in this repo except the write-up. Result in a new `docs/phase-10-clip-automation-verification.md`
in *this* repo (findings + patch description only, no code from the other repo copy-pasted in
unless it's the literal diff for the owner to review).

## Process

Same as Phase 9: worktree per stream, `npm test` green before calling it done (mind the Stream D
history.test.js flake is already fixed, so no more excuses there), sequential merge to `main`
with a full suite run after each. Streams A/B/C touch entirely disjoint files from each other —
expect zero merge conflicts this round. Stream D touches nothing in this repo but its own new doc.
