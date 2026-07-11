# Common mistakes to avoid

Sourced from this project's own corrected mistakes (design docs, plan "Result" sections, and
source comments explicitly flagging a prior wrong assumption) plus direct verification against
current source in this session — not speculative.

## 1. Assuming edits auto-checkpoint

**Wrong**: assuming `beat set`/`beat add-note`/any edit command saves a restorable version by
itself. **Confirmed wrong the hard way**: `docs/phase-15-history-panel.md`'s own verification notes
record that the original plan/spec assumed D3 gave auto-checkpointing on every edit, and it does
not — checkpointing is an explicit `beat checkpoint` call; `beat set` writes the file but mints no
checkpoint. Re-confirmed directly in this session by reading `cli/beat.mjs`: no `checkpoint()` call
anywhere in the `set`/`add-note`/etc. command paths. **Do**: call `beat checkpoint <file> --intent
"<what the user asked for>"` explicitly after each batch of edits that fulfills one request.

## 2. `vary --scope selection` on a param-group vary

**Wrong**: `beat vary song.beat lead cutoff --scope selection --port 8420` (or any rung-1
param-group vary, not `feel`). **What happens**: a clear, structural error — `vary --scope
selection only applies to "feel" (param groups mutate whole-track synth params, not per-note/lane
content)` — confirmed by running it. Param-group variants (`cutoff`, `resonance`, etc.) mutate a
whole track's synth params; there's no per-note/lane concept for a selection to scope. **Do**: use
`--scope selection` only with `feel` (content/humanize variation); for param-group variants, scope
is inherently whole-track.

## 3. Unquoted bracket paths in a shell

**Wrong**: `beat set song.beat drums.pattern.hat[2] 0.6` typed directly in a shell. **What
happens**: in zsh, this fails with `no matches found: drums.pattern.hat[2]` before the CLI even
sees it — `[`/`]` are glob metacharacters, expanded by the shell, not passed through — confirmed
directly in this session. **Do**: always quote the path — `beat set song.beat
"drums.pattern.hat[2]" 0.6`.

## 4. Reaching for an MCP tool that doesn't exist

**Wrong**: assuming every CLI verb has a `beat_*` MCP counterpart and trying `beat_vary` /
`beat_score` / `beat_sample` / `beat_lane` / `beat_daemon`. **Confirmed**: driving a live
`tools/list` call against `beat mcp` returns exactly 27 tools, and none of those five exist. **Do**:
for the variation-and-audition loop and media registration/assignment, shell out to the raw CLI
even inside an MCP-connected session — see `references/cli-reference.md` for the exact list of
what's MCP-covered vs CLI-only.

## 5. Trusting `beat render --offline` output without checking for the silent-failure warning

**Wrong**: treating any WAV `beat render --offline` produces as real audio. **Confirmed**: without
a locally-patched `node-web-audio-api` native build (not part of a normal `npm install`),
`render-offline.mjs` renders **total silence with no error** — this was found the hard way in
Phase 12 Stream 2 and is why `docs/decisions.md` D15 retires this render path in favor of
retargeting `beat render` onto dotbeat's own `ui/` engine (`docs/phase-17-plan.md` Stream L). **Do**:
check for the tool's own startup warning about the missing patched build, or better, check whether
Stream L has landed and `--offline` still exists at all before relying on it; if metrics on a
render come back suspiciously silent/short, that's the first thing to check, not a mix problem.

## 6. Comparing LUFS/metrics across the two render paths without the calibration offset

**Wrong**: rendering one iteration through the browser (Chromium) path and the next through
`--offline`, then comparing their LUFS numbers directly. **Confirmed**: the two paths differ by a
**constant, measured 9.5 LU** offset (differing `DynamicsCompressor` auto-makeup between Chromium
and the Rust engine) — see `references/render-metrics-loop.md`. **Do**: stay on one render path for
an entire iteration loop; only translate the final number if a cross-path target (e.g. a streaming
-14 LUFS spec) needs mapping onto the path actually in use.

## 7. Assuming track ids without running `beat inspect` first

**Not a confirmed historical bug, but a real risk this skill exists to prevent**: guessing common
names like `lead`/`bass`/`drums` for an unfamiliar project's track ids. A project can name tracks
anything (human slugs, D6). `beat inspect <file>` is cheap and is the only reliable source —
run it before the first edit in any session touching an unfamiliar project.

## 8. Treating the GUI selection as if it lives in the `.beat` file

**Not a bug, a design property worth stating explicitly**: the selection is deliberately ephemeral
— it lives only in a running daemon's in-memory state (`beat daemon <file> --port <p>`), never
written to the `.beat` file, and is gone when the daemon stops. Don't expect `beat inspect` or the
raw file to show what's selected, and don't expect a selection to survive a daemon restart.
