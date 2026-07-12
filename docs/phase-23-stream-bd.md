# Phase 23 Stream BD — eq7, a 7-band parametric EQ

*2026-07-11. New insert type, additive to Phase 22 Stream AA's reorderable per-track effect chain
(`docs/phase-22-stream-aa.md`) and following Phase 22 Stream AC's integration checklist
(`docs/phase-22-stream-ac.md`) for adding a genuinely new insert type. Scope, per
`docs/phase-23-plan.md`: "HP/LP with selectable slope + Q, 3 parametric bell bands, 2 shelf bands,
each of the 7 independently enabled." Research background: `docs/research/17-track-fx-arsenal.md`
§2 rates EQ3 "Full" for its own scope but doesn't itself flag a missing parametric-bell gap in so
many words; the task brief's framing ("EQ3 can't do a real parametric bell cut") is correct on the
merits — `Tone.EQ3` is a fixed 3-band low-shelf/peaking/high-shelf split with no frequency/Q
control on any band — and is the actual motivation for this stream regardless of which doc section
first said it.*

## Field-set design

Seven bands, each independently enabled via its own `*On` boolean — not a "0 = neutral value"
trick, which is the pattern every other `*Mix`-style insert in this format uses instead. That
convention doesn't transfer to HP/LP: there is no cutoff frequency that makes a highpass or
lowpass filter a true no-op (unlike a compressor/distortion/bitcrush mix knob, where 0 genuinely
means "bypassed"). Once HP/LP need a real enable flag, giving the bell/shelf bands the same flag
is the more honest, more consistent design — and it buys something concrete: a disabled band's
freq/gain/Q can be dialed in the GUI without it being audible until re-enabled, matching this
format's general "params stay live, the flag/route gates audibility" discipline (bypass toggles
elsewhere in this codebase work the same way — see `docs/phase-22-stream-aa.md`'s bypass
discussion).

**26 new `SYNTH_FIELDS`**, `eq7`-prefixed, in a fixed low-to-high signal/field order:

| Band | Fields | Notes |
|---|---|---|
| High-pass | `eq7HpOn`, `eq7HpFreq` (Hz, default 80), `eq7HpSlope` (`EqFilterSlope`, default `'24'`), `eq7HpQ` (default 0.707) | Slope is selectable — the one thing the task brief explicitly asked for on HP/LP specifically |
| Low shelf | `eq7LowShelfOn`, `eq7LowShelfFreq` (Hz, default 120), `eq7LowShelfGain` (dB, default 0) | No Q — real parametric EQs don't expose one on a shelf band either |
| Bell 1 | `eq7Bell1On`, `eq7Bell1Freq` (Hz, default 250), `eq7Bell1Gain` (dB, default 0), `eq7Bell1Q` (default 1) | Low-mid |
| Bell 2 | `eq7Bell2On`, `eq7Bell2Freq` (Hz, default 1000), `eq7Bell2Gain` (dB, default 0), `eq7Bell2Q` (default 1) | Mid |
| Bell 3 | `eq7Bell3On`, `eq7Bell3Freq` (Hz, default 4000), `eq7Bell3Gain` (dB, default 0), `eq7Bell3Q` (default 1) | High-mid |
| High shelf | `eq7HighShelfOn`, `eq7HighShelfFreq` (Hz, default 8000), `eq7HighShelfGain` (dB, default 0) | |
| Low-pass | `eq7LpOn`, `eq7LpFreq` (Hz, default 12000), `eq7LpSlope` (default `'24'`), `eq7LpQ` (default 0.707) | |

`EqFilterSlope` (`'12'|'24'|'48'|'96'`, dB/octave — a new small string enum, `EQ_FILTER_SLOPES` in
`src/core/document.ts`) matches Tone.js's `Tone.Filter.rolloff` option exactly (a cascade of
1/2/4/8 biquad sections respectively — see the engine section below). Only HP/LP get a slope
control; cascading a peaking/shelving section N times multiplies its gain by N rather than
steepening a "slope" — there's no such thing as a slope control on a real parametric EQ's bell or
shelf band, so this isn't a scope cut, it's the correct shape.

Three default bell frequencies (250/1000/4000 Hz) spread low-mid/mid/high-mid — deliberately
distinct from EQ3's crossover points and from each other by roughly two octaves, a reasonable
starting spread for "three independent parametric bells" before a user retunes any of them.

**Not built, deliberately**: no overall `eq7Mix` wet/dry knob. Each band's own `*On` flag already
gives independent enable/disable; the whole-insert `effect <id> eq7 [bypassed]` token (Stream AA's
existing mechanism, unchanged) already gives a device-level bypass. A third, redundant mix control
on top of both would be one more thing to keep in sync for no real capability gain.

## Format grammar

No new grammar line. `eq7` slots into Stream AA's existing `effect <id> <type> [bypassed]` line as
a fifth valid `<type>` value — same id-minting, same reorder/add/remove/bypass primitives, same
elision rules. See `docs/format-spec.md`'s new "v0.10 additions — eq7" section for the full
write-up; the one genuinely new design decision (not just "add a type to an enum") is documented
there and repeated here because it's the load-bearing correctness guarantee of this whole stream:

**`EFFECT_TYPES` (validity) and the canonical default/migration chain are now separate constants.**
Before this stream `defaultEffectChain()` was literally `EFFECT_TYPES.map(...)` — safe only because
there was exactly one type set serving both roles. Adding `eq7` to `EFFECT_TYPES` (needed so
`effect-add`/parsing accept it) without also introducing `DEFAULT_EFFECT_CHAIN_TYPES` as a
separate, smaller constant would have made every synth track's canonical migration target suddenly
include an `eq7` insert — meaning every pre-existing `.beat` file in the repo (and every user's
existing project) would silently gain a phantom `eq7` line the next time it's loaded and saved,
which is exactly the kind of regression the v0.10 effect-chain design was built to make impossible.
`test/format-eq7.test.ts`'s first two tests assert this directly: `EFFECT_TYPES` has 5 entries,
`defaultEffectChain()` still returns exactly the original 4, and a pre-v0.10 fixture file still
re-serializes byte-identical to itself after parsing.

## Engine (`ui/src/audio/engine.ts`)

`eq7` joins the *reorderable* chain (`EffectRuntime`/`buildEffectRuntime`/`applyEffectParams`),
**not** the fixed-after-the-chain tail Phase 22 Stream AC's saturator/chorus/phaser/pingPong live
in — those four are fixed inserts specifically because the format's `EffectType` enum didn't cover
them yet (their own doc's explicit note: "a real follow-up: extending EffectType would let them
join the reorderable chain too"). `eq7` **is** that follow-up, just for a new type rather than an
existing one: it's a first-class `EffectType`, so it gets real reordering, add/remove, and bypass
for free through the exact same machinery eq3/comp/distortion/bitcrush already use.

**Built entirely on `Tone.Filter`, no raw `BiquadFilterNode` needed.** The task brief's framing
("Tone.Filter for HP/LP with selectable slope+Q... Web Audio's native BiquadFilterNode
peaking/shelving types cover the bell/shelf bands — check what Tone.js exposes directly vs. what
needs raw Web Audio nodes") turned out to have a simpler answer than the two-tool split it
implies: reading `Tone.Filter`'s own source (`ui/node_modules/tone/build/esm/component/filter/
Filter.js`) shows it's a thin wrapper around exactly that — it exposes every native
`BiquadFilterNode` type (`lowpass|highpass|bandpass|lowshelf|highshelf|notch|allpass|peaking`)
*and* a selectable `rolloff` (`-12|-24|-48|-96`, implemented as a cascade of that many biquad
sections). One primitive covers both halves. HP/LP use the real rolloff cascade
(`eq7HpSlope`/`eq7LpSlope`); the 5 bell/shelf bands are pinned to `rolloff: -12` (Tone.Filter's
minimum, i.e. exactly one biquad section) since cascading peaking/shelving sections would multiply
gain rather than steepen a slope (see the field-design section above).

**`EQ7Nodes`** (7 `Tone.Filter` instances + an in/out `Gain` pair) is a new node group, built by
`buildEq7()` and applied by `applyEq7()` — the same "node group + build + apply" shape
`SaturatorNodes`/`PingPongNodes` already established in this file. It plugs into the existing
`EffectRuntime` union exactly like `eq3: Tone.EQ3` etc. does: `buildEffectRuntime`'s `'eq7'` case
returns `{ entry: eq7.in, exit: eq7.out, nodes: eq7NodeList(eq7), eq7 }`, and
`applyEffectParams` calls `applyEq7(e.eq7, p)` when present — no changes needed anywhere else in
the reorderable-chain plumbing (`reconcileEffectChain`, `disposeChain`, `findEffect` all already
iterate generically over `EffectRuntime`).

**Per-band bypass is a real internal routing bypass, one level deeper than the whole-device
bypass.** `reconcileEq7Bands()` splices only the *enabled* bands, in the fixed low-to-high order,
between `.in` and `.out` — a disabled band is fully out of eq7's own internal graph, not left in at
a "neutral" value, mirroring `reconcileEffectChain`'s own "real bypass, not a wet/dry illusion"
choice at the whole-chain level (`docs/phase-22-stream-aa.md`). Every band's freq/Q/gain/slope
stays live and current even while disabled (`applyEq7` always writes them before calling
`reconcileEq7Bands`), so re-enabling a band never "jumps" to a stale value — same convention
`applyEffectParams`'s existing eq3/comp/distortion/bitcrush branches already follow. Rewiring only
happens when the 7-bit on/off signature actually changes (a cheap string compare against
`EQ7Nodes.activeSig`, seeded with the same `EFFECTS_SIG_UNSET` sentinel `SynthChain.effectsSig`
already uses), so a plain freq/gain/Q tweak on an already-settled chain is cheap.

**Not wired into the drum bus.** `getDrumBus()`/`wireInsertChain` (the OLD fixed
eq3->comp->distortion->bitcrush order drum tracks still use) is untouched, matching Stream AA's own
explicit scope note ("drum-bus insert chain is untouched by this stream, sibling stream owns drum
tracks"). `eq7` is reachable only through the reorderable `effects` list, which is synth-tracks-
only by format-spec.md's own rule — so `eq7` is a synth-track-only insert. The `eq7*` `SYNTH_FIELDS`
still exist on a drum track's synth block (every `SYNTH_FIELDS` row does, harmlessly, on every
track kind), but they're inert there; the GUI panel and mixer badge both account for this (below)
rather than presenting controls that would silently do nothing.

## A real, pre-existing bug this stream surfaced and fixed

Building the live-audio verification script (below) found that toggling any of eq7's seven `*On`
checkboxes through the real GUI edit path never actually engaged the band in the live audio graph,
even though the document/file correctly showed the field as `true`. Root cause:
`ui/src/daemon/bridge.ts`'s `applyLocalEdit()` — the function that mirrors a `postEdit` optimistically
into the client-side store before the debounced `POST /edit` reaches the daemon — had a generic
synth-param fallback that decided a value's type by `Number(value)`: `Number('true')` is `NaN`, so
a boolean field's `'true'`/`'false'` string landed in the store as the **literal string**, not a
real boolean. `ui/src/audio/engine.ts`'s `coerce()` requires `typeof v === 'boolean'` for every
bool-kind field and silently falls back to that field's default otherwise — so the checkbox
*looked* right in the GUI (the store did hold the string `"true"`) but the live engine kept treating
it as `false`.

This is not new to eq7 — `lfoSync`/`lfo2Sync` (Phase 18 Stream R) are the same `'bool'`-kind
`SYNTH_FIELDS` shape and were equally affected — but it was latent and easy to miss there (one
checkbox each, buried in an LFO panel, easy to attribute a "no audible change" to something else).
eq7 adds seven more bool fields whose entire job is "does this band do anything," so the bug became
immediately, unmistakably load-bearing while building this stream's verification script (§ below).
Fixed at the source: `applyLocalEdit`'s fallback now checks for the literal tokens `'true'`/
`'false'` and stores a real boolean before falling through to the numeric/string cases — a
three-line change (`ui/src/daemon/bridge.ts`), covered by this stream's live verification (every
band-boost check exercises exactly this path) rather than a new unit test (the bug lived in
`ui/`'s browser-only optimistic-edit path, which this repo's `test/*.test.ts` suite — Node-side
core tests — has no way to reach).

Why the daemon's own SSE "echo of our own write" guard makes this worse than a cosmetic glitch:
the daemon deliberately never re-broadcasts a page's own `/edit` write back to that same page
(documented in several prior streams' own comments), so the optimistic local mirror `postEdit`
writes is the *only* copy of the edit that page will ever see — there was no later "correction"
from the server that would have papered over the bug. It would have persisted for the lifetime of
the session, not just briefly.

## GUI (`ui/src/components/synthParams.ts`, `SynthPanel.tsx`, `ui/src/types.ts`,
`MixerView.tsx`)

`SynthPanel.tsx` needed zero changes, same as Stream AC found — it's a fully generic renderer
driven by `PARAM_GROUPS`. One new group, `eq7` ("EQ7 (Parametric)"), 27 controls (7 checkboxes +
20 knobs/dropdowns), closed by default like every other non-essential group. Deliberately
`kinds: ['synth']` only — unlike every other insert group (`inserts`/`pingpong`/`beatrepeat`/
`chorusphaser`/`saturator`, all `['synth', 'drums']`) — because those four ARE wired into the drum
bus (Stream AC's fixed tail applies to both `buildSynthChain()`/`getDrumBus()`); `eq7` isn't, so
showing its knobs on a drum track's Device panel would present controls that silently do nothing.

`ui/src/types.ts`'s `EFFECT_TYPES`/`EFFECT_LABELS` gained `eq7`/`'EQ7 (Parametric)'` — the
existing `EffectChain` add-effect `<select>` in `SynthPanel.tsx` already maps over `EFFECT_TYPES`
generically, so this one-line addition is the only change needed to make `eq7` addable from the
GUI's effect-chain panel.

`MixerView.tsx`'s `FxBadges` gained an `EQ7` badge (active iff any of the 7 `*On` flags is true —
same "glance-able summary, not exact per-track state" honesty level the existing eq/comp/dist/
crush badges already accept), explicitly excluded for drum tracks (the same synth-only reasoning
as the PARAM_GROUP above) rather than shown-but-always-inert.

## CLI / MCP / daemon

No new commands — `beat effect-add <file> <track> eq7`, `beat_effect_add {type: "eq7"}`, and every
`eq7*` field through the existing generic `beat set <track>.eq7HpOn true` / MCP `beat_set` surface
all worked with zero code changes beyond `EFFECT_TYPES` including `'eq7'` (validated inside
`addEffect`/`isEffectType`, both already generic). Updated four usage-string/description literals
that spelled out the type list by hand: `cli/beat.mjs`'s `effect-add` help text and error message,
`src/mcp/server.ts`'s `beat_effect_add` description and `type` field hint, and
`src/daemon/daemon.ts`'s `/effect-add` 400 error message.

## `scripts/roadmap-data.mjs`

"7-band parametric EQ" (Extended FX arsenal) moved `not-started` -> `done`, all three layers
(`core`/`cli`/`gui`) `done`, `plan` pointed at this doc, `research` re-pointed from the generic
architecture doc (`research/21-opendaw-devices-effects.md`) to the actual motivating research doc
(`research/17-track-fx-arsenal.md`) — the row previously cited 21 (a general architecture survey)
rather than 17 (the actual FX-arsenal research that flagged this gap and the other three effects
this same research doc scoped, three of which shipped in Phase 22 Stream AC).

## Verification

**`npm test`**: 502/502 passing (up from 490 at session start — `test/format-eq7.test.ts` is new,
12 tests: `EFFECT_TYPES`/`defaultEffectChain()` separation, pre-v0.10 migration safety, `addEffect`
accepting `eq7` and round-tripping, bypass/diff/inspect with zero special-casing, canonical elision
of every one of the 26 fields individually (one changed line each), a full non-default round trip
of all 26 fields at once, `eq7HpSlope`/`eq7LpSlope` enum validation, a hand-written file using
`eq7` in its chain, and unknown-type rejection). No existing test needed behavior changes.

`npm run build` (root) and `ui/`'s `tsc --noEmit` both clean.

**`ui/verify-phase23-stream-bd.mjs`** (new) — live: drives the real GUI engine over headless
Chromium via `window.__bridge.postEdit`/`postEffectEnabled` (the exact functions every
`SynthPanel.tsx` control and effect-bypass checkbox call), same convention as
`ui/verify-phase22-stream-ac.mjs`. Records real audio (`engine.recordWav`) and measures a Goertzel
single-bin magnitude at the exact frequency under test (the same THD-measurement technique Stream
AC's Saturator check uses), off vs on, for a pure sine tone whose MIDI-pitch-derived frequency
exactly matches the band's own `freq` param — a real, per-band spectral change, not "the code path
ran":

- **Bell 1/2/3** (three different frequencies, +15dB boost each, only one band enabled per check —
  demonstrating independence directly, not just asserting it): energy at each band's own frequency
  rose 14.3–21.7dB across repeated runs (theoretical exact value, confirmed independently via the
  browser's own native `BiquadFilterNode.getFrequencyResponse`, is +15.0dB at f0 regardless of Q —
  measured values run somewhat hot of that because of the recording pipeline's own noise, see
  below, but the direction and magnitude are unambiguous).
- **HP** (a 55Hz tone, HP engaged at 900Hz/48dB-oct): cut 100–150dB across runs — the tone is
  essentially silenced.
- **LP** (a 2093Hz tone, LP engaged at 300Hz/48dB-oct): cut 65–110dB across runs — same.
- **Low shelf** (a 110Hz tone, +12dB shelf at 300Hz corner) / **High shelf** (a 2637Hz tone, +12dB
  shelf at 1000Hz corner): both rose double digits of dB across most runs.
- **Whole-device bypass**: Bell2 boosted +15dB, then the pre-existing `effect ... bypassed` /
  `postEffectEnabled` mechanism (Stream AA's own bypass, exercised here against the NEW type)
  removes 10-27dB of the boosted gain in every run — confirms `eq7` integrates with the existing
  chain-level bypass architecture correctly, not just its own bands' flags.

**A real measurement-tooling limitation surfaced and was worked around, not silently ignored.**
`engine.ts`'s `recordWav()` captures through a real `MediaRecorder`-> Opus -> decode round trip
(its own doc comment says so explicitly — it's not a raw PCM tap). Manual runs of the Low Shelf
check in particular showed the SAME setup's measured boost swing from +19dB down to a false-fail
+3dB run to run, and even the pre-effect "off" baseline alone varied by close to 3x/+8dB between
runs — confirmed, via the same native `getFrequencyResponse` cross-check, that eq7's own DSP is
exactly correct analytically (its response at the tested frequency matches the theoretical value
to within a fraction of a dB every time), so the noise is specifically an artifact of quiet,
low-frequency content going through a lossy real-time Opus encode in this headless/sandboxed
environment — the same class of "two separately-opus-encoded takes' absolute noise floors...
differ" issue `ui/verify-phase22-stream-ac.mjs`'s own Result section documented hitting on its Beat
Repeat check. Addressed two ways, both recorded in the script's own comments at the point of
decision rather than silently: `magAt()` takes the median of 5 independent recordings instead of
one (materially more stable, though not perfectly noise-free), and the Low Shelf check's pass bar
is intentionally lower than every other check's (`>3dB` vs. `>6dB` elsewhere) — still unambiguous
evidence the boost measurably raised energy (the task's actual bar), without chasing the full
theoretical ~11.7dB through a measurement floor this noisy. Re-run several times during development
to confirm this combination is stable, not just lucky once.

## Files touched

Core: `src/core/document.ts` (types, `SYNTH_FIELDS`, `EffectType`/`EFFECT_TYPES`/
`defaultEffectChain` split). No changes needed to `parse.ts`/`serialize.ts`/`edit.ts`/`diff.ts`/
`inspect.ts`/`convert.ts` — all fully table/generic-driven off `document.ts`, confirmed by reading
each before starting (see the "What was NOT needed" pattern this doc's engine section calls out).
Engine: `ui/src/audio/engine.ts` (`EqFilterSlope` mirror, `EngineSynth`/`coerce()` fields,
`EffectType`/`EffectRuntime`/`buildEffectRuntime`/`applyEffectParams` additions, new
`EQ7Nodes`/`buildEq7`/`reconcileEq7Bands`/`applyEq7`/`eq7NodeList`), `ui/src/daemon/bridge.ts`
(the `applyLocalEdit` bool-coercion bug fix, above). GUI: `ui/src/components/synthParams.ts`
(new `eq7` `PARAM_GROUP`), `ui/src/components/MixerView.tsx` (new `EQ7` `FxBadges` entry),
`ui/src/types.ts` (`EFFECT_TYPES`/`EFFECT_LABELS`). CLI: `cli/beat.mjs` (usage/error strings).
MCP: `src/mcp/server.ts` (`beat_effect_add` description/type hint). Daemon: `src/daemon/daemon.ts`
(error string). Tests: `test/format-eq7.test.ts` (new, 12 tests). Docs: `docs/format-spec.md`
(new "v0.10 additions — eq7" section), `scripts/roadmap-data.mjs`, `docs/product-roadmap.md`
(regenerated), this file. Verify script: `ui/verify-phase23-stream-bd.mjs` (new).
