# Phase 33 — fixing what the CLI/MCP usability pilots found

Source: seven CLI/MCP pilots (`docs/research/94` through `100`) — the first pilots of the new,
dramatically-cheaper CLI/MCP variant (`docs/usability-testing.md`'s "Variant: CLI/MCP pilots"
section), run directly against the `beat` CLI and the MCP tool surface with no GUI involved at all.

**Already fixed and pushed, before this plan was written**: the most severe finding — `beat restore`
silently and permanently discarding uncommitted work, confirmed via a controlled repro, fixed in
`src/history/history.ts` (commit `e4af642`). Not a stream here; mentioned for completeness.

**Not in scope for this phase** (bigger findings or already-confirmed non-issues, not confined
fixes): multi-region audio placement (research/99 confirmed this is a genuine core/data-model
constraint, same architectural gap already tracked for the GUI — not new scope, not a quick fix);
`render`'s ~1dB non-determinism between identical re-renders (research/96 — an engine-level
characteristic worth knowing about, not a CLI/MCP bug to patch); the orphaned-split-output GUI issue
(research/99 confirmed this does NOT reproduce via CLI — nothing to fix).

## Streams

| Stream | Feature area | Primary files | Source research |
|---|---|---|---|
| MB | MCP/CLI parity + help-text/doc accuracy | `src/mcp/server.ts`, `cli/beat.mjs` | 94, 95, 100 |
| MC | Error handling: stack-trace leaks + `beat suggest` validation gaps | `cli/beat.mjs`, `src/vary/` | 96, 98 |
| MD | `beat inspect`/`lint`/`quantize` correctness | `cli/beat.mjs`, `src/metrics/`, `src/core/edit.ts` | 98 |
| ME | Macro curve fix + small CLI UX papercuts | `src/core/macro.ts` (or wherever macro curve resolution lives), `cli/beat.mjs` | 96, 100 |

## MB — MCP/CLI parity + help-text/doc accuracy

1. **`beat_add_track` over MCP silently skips the default 12-lane drum kit — confirmed root
   cause.** `cli/beat.mjs`'s own `add-track` command (~line 248) does
   `...(kind === 'drums' && !legacyLanes ? { lanes: defaultDrumKitLanes() } : {})` when calling
   `addTrack`; `src/mcp/server.ts`'s `beat_add_track` handler (~line 213-224) calls the same
   `addTrack` core function but never passes `lanes` at all for the drums case. Add the identical
   conditional to the MCP handler so a drums track created via MCP gets the same real, materialized
   12-lane kit the CLI already produces — confirmed by pilot 95 directly comparing an MCP session's
   `beat_inspect` output against pilot 94's CLI session on the same starting state.
2. **`beat mcp --help` (or wherever the top-level MCP entry describes itself) overstates its own
   tool coverage.** Pilot 95 found the help text's "all of the above as tools" framing doesn't match
   reality — `vary`/`score`/`sample`/`lane`/`daemon` have no MCP tool despite being real CLI
   commands. Fix the help/description text to accurately describe the real ~48-tool surface, not
   claim 1:1 parity with the CLI that doesn't exist. Don't add the missing tools in this stream (a
   bigger scope decision, not a quick fix) — just make the claim honest.
3. **`beat_checkpoint`'s auto-label behavior is undocumented in its own tool description.** The
   first-ever checkpoint on a file always auto-labels as the bare word "checkpoint" regardless of
   diff size (confirmed core behavior in `src/history/history.ts`'s `checkpoint()` — not MCP-
   specific, but pilot 95 found MCP's tool description gives an agent no way to predict this). Add a
   line to the tool's `description` field explaining the auto-label behavior so an agent calling it
   isn't surprised by a generic label on its first call.
4. **`add-note`/`add-hit` velocity is 0-1, not MIDI 0-127 — undocumented, caused 16 failed
   commands in a row in pilot 94.** Add this explicitly to both the CLI help text (`cli/beat.mjs`'s
   help string for these commands) and the equivalent MCP tool descriptions (`beat_add_note`/
   `beat_add_hit` in `src/mcp/server.ts`) — this is a documentation fix in both places, not a
   behavior change (0-1 is the correct, established convention elsewhere in the format).
5. **Fresh synth tracks auto-ship 4 default effects — undocumented, surprised pilot 100.** Add a
   line to `add-track`'s CLI help and the MCP tool's description noting that a new synth/drums track
   starts with its own default effect chain already populated (name the defaults if that's stable
   and worth documenting, e.g. "EQ3, Compressor, Distortion, Bitcrush" if that's accurate — verify
   against `addTrack`'s actual defaults before writing it down).
6. **The `clip` command's live-content-accumulation semantic is confusing without being wrong.**
   Pilot 94 found sequential `clip` snapshots accumulate the track's current LIVE content rather than
   resetting, so a "chorus" clip captured after a "verse" clip can end up being "verse plus" rather
   than independent — this mirrors the exact `sceneFromLiveContent`/"capture current live state"
   model used elsewhere in the daemon (Phase 26 Stream DJ's `+ capture scene`), so it's likely
   intentional, consistent behavior rather than a bug. Confirm that reading is correct (check how
   `clip` is actually implemented in `cli/beat.mjs`/`src/core/edit.ts`), and if so, add a clear
   warning/note to the command's help text explaining that a fresh clip starts from whatever's
   currently live on the track, not from empty — so a user building sequential distinct clips needs
   to explicitly clear/reset between them if that's what they want. If investigation instead reveals
   this is a genuine bug (not matching the documented `capture scene` precedent), fix it for real
   instead of just documenting it — check which case you're actually in before choosing.

## MC — Error handling: stack-trace leaks + `beat suggest` validation gaps

1. **Three commands leak raw Node stack traces instead of the CLI's own clean `error: ...` format**
   every other command uses: `beat score` on a bad batch-dir path (research/96), `beat humanize
   --timing -1` (research/98), and `beat diff --git` with a bad git rev (research/98). Find each
   command's handler in `cli/beat.mjs`, wrap the actual failure point in a try/catch (or extend
   whatever the existing error-formatting convention is — check how OTHER commands already produce
   their clean `error: ...` output and match that exactly) so all three fail the same clean way as
   the rest of the CLI. No file corruption was observed in either repro — this is purely an error-
   presentation fix, not a data-safety one.
2. **`beat suggest`'s cold-start recommendation ignores track type.** Its first-ever suggestion for
   a synth track was `vary ... kick ...` — a param-group name that only makes sense for a drums
   track, so the suggested command "succeeds" but is a silent no-op against a synth track (confirmed
   via `inspect` + a render/metrics diff showing no real change, research/96). Find `suggest`'s
   cold-start logic (likely in `src/vary/` or wherever `beat suggest` is implemented) and make its
   recommendation respect the target track's actual kind.
3. **`beat suggest` skips the track-existence validation every sibling command has.** `vary
   song.beat bass ...` correctly errors on an unknown track name; `suggest song.beat bass` silently
   doesn't validate at all (research/96). Add the same validation `vary` already does — check how
   `vary`'s own handler validates track existence and mirror it in `suggest`'s handler.

## MD — `beat inspect`/`lint`/`quantize` correctness

1. **`beat inspect`'s plain-text view omits track groups entirely**, even though `--json` and `beat
   diff --git` both correctly reflect them (research/98, confirmed: grouping a set of tracks and
   ungrouping them showed correctly in the JSON output and in a diff, but the plain-text `inspect`
   view never mentioned groups at all). Find `inspect`'s plain-text rendering path (likely in
   `cli/beat.mjs` or a shared formatting module) and add group membership to its output, matching
   whatever section/format style the rest of `inspect`'s text view already uses.
2. **`beat lint`'s fix suggestions don't name the actual offending track.** Pilot 98 confirmed this
   concretely: applying `lint`'s literal advice to the `bass` track (because the suggestion didn't
   specify which track needed the fix) left the real true-peak/low-end issue essentially unchanged,
   because the actual offender was a different track. Find `lint`'s suggestion-generation logic
   (`src/metrics/` likely) and thread the actual offending track's id/name into each suggestion's
   message, not just a generic fix description.
3. **`beat quantize` can silently push a note one step past a loop's own boundary with no
   warning.** Confirmed in research/98: a note ended up at step 64 of a 64-step (0-63) loop after
   quantizing — one step past the loop's own end. This mirrors the exact "transform pushes content
   past the clip's loop length with no warning" bug Phase 30 Stream KC already fixed for the GUI's
   own Pitch & Time transforms (a toast warning, not a hard clamp, was that fix's approach — consider
   the same shape here: warn in the CLI's own output when a quantize operation pushes content past
   the loop boundary, rather than clamping and silently changing the requested operation's result).
   Find `quantize`'s implementation (`src/core/edit.ts` likely, shared with the GUI's own quantize
   path) and add the same boundary check/warning.

## ME — Macro curve fix + small CLI UX papercuts

1. **Macro curve `"exp"` is implemented as a quadratic, not a true exponential/log curve —
   confirmed by direct reverse-engineering** (research/100: predicted quadratic output values,
   compared against actual resolved macro output, matched exactly; `min+(max-min)*t^2`, not a real
   exponential curve). Find the macro curve resolution logic (likely `src/core/macro.ts` or wherever
   `resolveMacroTarget`/`inverseResolveMacroTarget` live, referenced elsewhere in this codebase's
   Phase 29 Stream GB work) and either (a) fix the `"exp"` case to be a genuine exponential/log
   curve, matching what the name promises, or (b) if a real exponential curve risks changing the
   sound of every macro currently using `curve: "exp"` in a way that's hard to justify re-tuning, at
   minimum rename the curve type to something honest (e.g. `"quad"`) and update
   `docs/format-spec.md`/any macro-authoring docs to match. Prefer (a) if the change is contained;
   use judgment on which is the better call given what you find, and explain your choice in your
   final report.
2. **Variants are displayed as `v1`/`v2` everywhere but must be scored as bare integers** — a
   real, if minor, discoverability gap (research/96: a user reasonably tries `beat score v1 ...`
   based on the tool's own display convention, and it doesn't work). Make `beat score` accept either
   form (`v1` or `1`) for the variant argument, normalizing internally — a small, contained
   convenience fix, not a breaking change to the existing bare-integer form.
3. **If time allows** (not required — only attempt after the above two are solid): `effect-move`'s
   musical diff output is chattier (4 lines) than the actual raw-file diff (2 lines) for the same
   edit, inverting the CLI's own "diff not noise" pitch for that one operation (research/98). Look at
   `effect-move`'s diff-formatting path and see if there's a small, contained way to make its
   summary proportionate to the edit's actual size — skip this item entirely if it doesn't have an
   obviously small fix, since this is the lowest-priority item in the whole phase.

## Merge order

All four streams touch largely disjoint areas of `cli/beat.mjs` (different command handlers) plus
their own separate core/mcp files — low conflict risk in any order. If a real conflict does surface
in `cli/beat.mjs` (the one file every stream touches to some degree), resolve by hand; each stream's
changes should be small, additive, and easy to reconcile individually.

## Verification approach

Same discipline as every prior phase: after each merge, independently re-run core typecheck, UI
typecheck (even though these streams are CLI/MCP-only, a full UI typecheck costs nothing and confirms
no accidental cross-contamination), full `npm test`, and each stream's own verification. Given these
are CLI/MCP fixes, "verification" here means real CLI/MCP invocations against a disposable scratch
project with actual output/exit-code/file-content checks — not a GUI Playwright script. Each stream
should write a small Node.js verify script (matching the pattern `docs/usability-testing.md`'s
CLI/MCP pilot variant already established) or extend `test/` with real unit/integration tests,
whichever fits the specific fix better — use judgment per-item rather than forcing one mechanism.
