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

**Wrong**: assuming every CLI verb has a `beat_*` MCP counterpart. **Confirmed** (re-verified
2026-07-25 by a live `tools/list` against `beat mcp`): 71 tools, covering 69 of the 87 CLI
commands. The gap is now the *orchestration and eval* verbs, not the editing ones — `audition`,
`board`, `daemon`, `excerpt`, `gen-kit`, `match`, `open`, `pilot`, `prodtask`, `rate`, `showdown`,
`surge`, `taste-collect`, `taste-eval`, `taste-seeds`, `trick` have no tool. **Do**: shell out to
the raw CLI for those even inside an MCP-connected session; for everything else use the tool.
(This entry previously said the count was 27 and that `beat_vary`/`beat_score`/`beat_sample`/
`beat_lane` did not exist — **all four do exist**; that was a 2026-07-11 snapshot left to rot. If
you are unsure, run `tools/list` rather than trusting any written list.) See
`references/cli-reference.md` for the mapping and its five naming exceptions.

## 5. Applying the old 9.5 LU offline-vs-browser offset (it no longer exists)

**Wrong**: targeting -23.5 LUFS for an offline render because a streaming spec says -14, or
"correcting" a cross-path comparison by 9.5 LU. **Confirmed**: that constant was measured *pre-D15*
between BeatLab's Rust `node-web-audio-api` engine and Chromium's own `DynamicsCompressor` — two
different implementations. D15 collapsed both CLI render paths onto dotbeat's single engine
(`ui/src/audio/engine.ts`, with `ui/src/audio/offline.ts` as the offline construction of the *same*
`Engine`), so the offset went with it: the full-song parity gate now has live and offline agreeing
to **LUFS Δ0.19 / RMS Δ0.12** (D23). It is still quoted in `docs/phase-4-plan.md`, `ROADMAP.md`,
`docs/m4-native-engine-design.md`, and the worked example in `references/render-metrics-loop.md`, so
you *will* meet it. **Do**: target the streaming number directly on whichever path you use.

## 6. Comparing true-peak/crest across the live and offline render paths

**Wrong**: treating a ~1 dB true-peak or crest difference between a live-capture render and an
`--offline` render of the same unchanged file as a mix change. **Confirmed** (D23, third known
live-chain exception): on a limiter-pinned dense mix the live path reads peaks ~1 dB hotter (−1.5
vs −2.5 dBTP) while every energy metric matches — it is the live path's MediaRecorder→opus step
overshooting, verified by round-tripping the *offline* WAV through that same codec (+0.45 dB). Same
story for mono-width opus noise and sub-band tilt. **Do**: compare energy metrics (LUFS, RMS, band
shares, correlation) across paths freely; for peak-domain numbers stay on one path for the whole
loop and trust the **offline** number when they disagree.

## 6b. Trusting a `--offline` WAV without reading the printed refusals

**Wrong**: assuming `beat render --offline` rendered everything you hear in the GUI. **Confirmed**:
soundfont projects (instrument tracks / sf-backed drum lanes) are refused and fall back to live
capture, and an active `bitcrushRate` degrades to passthrough — both print a named reason rather
than failing. (The *old* silent-total-silence failure mode is gone: `cli/render-offline.mjs` and its
patched-`node-web-audio-api` dependency were deleted with D15. Any doc telling you to check
`render-offline.mjs`'s startup warning is describing a file that no longer exists.) **Do**: read
stderr — the refusal reason, the caveats, and the realtime ratio are all printed there.

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
