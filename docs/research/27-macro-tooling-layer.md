# Research 27 — Macro tooling layer: a concrete design pass

*2026-07-11. Phase 23 research stream RC (`docs/phase-23-plan.md`). Not a verified web-research
pass like 01-24 — this is an internal design pass grounded in reading dotbeat's own source
(`src/core/document.ts`, `src/core/preset.ts`, `src/daemon/daemon.ts`, `ui/src/components/*`,
`ui/src/daemon/*`) plus the two prior passes that already touched this area:
`docs/research/18-ableton-ui-architecture.md` §6 ("Racks & Macros") and Part II's "Macros/Racks
recommendation", and `docs/research/21-opendaw-devices-effects.md` row 15 (openDAW's
`ModularDeviceBox`, an independent second data point). Deliverable per the brief: which params are
worth mapping, the concrete mapping data shape, where it's authored/stored and how a turn resolves
to literal edits, what the GUI surface looks like, and an MVP cut — each with a recommendation, not
a survey.*

## 0. What's already decided, and what this pass adds

Research 18 named this area and made one real, load-bearing call: **a macro is tooling that emits
literal edits, never in-file indirection** — "a macro is a preset with a continuous input"
(research 18, "The Macros / Racks recommendation"). That's not re-litigated here; §1 below confirms
it with one additional independent source and one new argument, then this doc does the part
research 18 explicitly didn't do: the actual data shape, the actual storage location, the actual
daemon/CLI interaction model, and the actual GUI placement. Research 18 left a stub in `SYNTH_FIELDS`
worth flagging again up front so it isn't mistaken for a head start: `macroValue` (`document.ts:699`)
is a bare `0..1` number with **no mapping table at all** — not an Ableton-style macro, not a
foothold for one. Nothing below reads or writes it.

## 1. Confirming (not just assuming) "outside the file, like presets"

The brief asks this to be checked, not stipulated. Three independent arguments, each sufficient on
its own:

1. **The format's own founding goal is directly contradicted by in-file indirection.**
   `format-spec.md`'s Goal 1 is *"a single-parameter change produces a single-line diff"* — a macro
   knob is, by construction, one input that drives many outputs. Storing the knob's value in the
   file means the file no longer states the cutoff value; it states `macro=0.7` plus a mapping, and
   the real cutoff is *computed*. A `git diff` on a macro turn would show one changed number
   (`macro=0.7` → `0.75`) while the actual sonic change (five params moving) is invisible without
   resolving the mapping — exactly backwards from what every other dotbeat edit guarantees.
2. **dotbeat already ratified this exact tradeoff for presets (D9), and a macro is structurally the
   same category of thing.** `decisions.md` D9: *"the format has no preset reference: `beat preset`
   applies a named param bundle... through the same code path as `beat set`, so a preset application
   is a readable edit list and an ordinary diff."* A macro differs from a preset only in that its
   input is continuous (0-100) instead of a single "apply" trigger — the indirection-avoidance
   argument that motivated D9 applies without modification.
3. **Two independent DAWs converged on this pattern being a trap, from opposite directions.**
   Ableton's own Macro Mapping *is* in-file indirection (research 18 §6: "the knob's value is not
   itself a sound parameter — it is a *pointer*... 'Macro Variations' are... snapshots of the
   indirection layer's inputs, not of the resolved outputs") — that's Ableton accepting the cost
   because Live's project format was never trying to be diff-friendly. openDAW, a *newer* project
   that (like dotbeat) cares about clean serialization, built the identical pattern anyway
   (`ModularDeviceBox`/`DeviceInterfaceKnobBox`, research 21 row 15) — and research 21's own verdict
   on it is "skip, exactly per research 18's existing macro verdict... independent confirmation, not
   new information." Two real, shipped systems both landed on knob→pointer→target; neither is
   evidence dotbeat should copy the *mechanism*, only that the *ergonomics* (a curated front panel,
   one input reshaping several params at once) are worth having.

**Verdict: confirmed, not just extended.** A macro definition (name + target list + ranges/curves)
lives entirely outside the `.beat` file. "Turning a macro" computes each target's resolved value and
writes it as an ordinary `setValue` edit — the file only ever contains the resolved numbers,
indistinguishable from a human having turned each of those N knobs by hand. Section 3 below is the
concrete storage answer the brief also asks for explicitly, since "outside the file" alone doesn't
say *where*.

## 2. Which params are actually worth mapping

Real macro-mapping convention across DAWs/synths converges on the same short list, and it's not
arbitrary — it's "the params that move a sound's *character* along one continuous axis a producer
can name," not just "any automatable param":

- **Filter cutoff (± resonance)** is the single most common macro target in Ableton racks and Serum
  presets — it's the one control every subtractive patch has that reads as "brighter/darker" on a
  single sweep, and pairing it with resonance ("cutoff opens, resonance rises") is the single most
  common *two*-target macro in circulation.
- **Envelope times** (attack/release, sometimes decay) — one macro reshaping "pluck → pad" character.
- **Effect wet/dry and drive/amount** — reverb/delay send, distortion/saturation amount, are the
  next most common category ("space," "grit," "drive" macros) precisely because they're already
  single 0-1-ish knobs with an intuitive more/less semantic.
- **Motion depth** (LFO depth, not destination) — "add movement" without touching where it's routed.

Grounded in dotbeat's actual `SYNTH_FIELDS` (`document.ts:666-747`, ~54 optional fields) and the
Phase 22 effect-chain additions folded into the same table (ping-pong delay, beat repeat,
chorus/phaser, saturator — all already present as flat `SYNTH_FIELDS` entries, not a separate
per-instance model per `docs/phase-22-stream-aa.md`'s own scope cut), here's a concrete starter set
— eight macros, matching Ableton's own "8 knobs visible by default" convention, each built from real
field names, not generic examples:

| Macro | kind | Targets (`param`: min → max, curve) | Character |
|---|---|---|---|
| **Filter Sweep** | synth | `cutoff`: 80 → 18000 Hz, exp · `resonance`: 0.1 → 5, linear | The canonical one — brighter + more resonant together |
| **Grit** | synth | `distortionAmount`: 0 → 0.8, exp · `distortionMix`: 0 → 0.7, linear · `bitcrushBits`: 16 → 4, linear (inverted range) | "Add dirt" |
| **Space** | any | `sendReverb`: 0 → 0.7, linear · `sendDelay`: 0 → 0.5, linear | Room/depth, works on any track kind |
| **Warmth** | synth | `saturatorDrive`: 0 → 0.6, linear · `saturatorMix`: 0 → 0.6, linear · `eqHigh`: 0 → -4, linear · `eqLow`: 0 → 2, linear | Analog-tape-style tilt |
| **Motion** | synth | `lfoDepth`: 0 → 1, linear · `lfo2Depth`: 0 → 1, linear | Adds movement without touching `lfoDest`/`lfo2Dest` — safe, non-destructive of whatever routing is already set |
| **Width** | synth | `unisonWidth`: 0 → 1, linear · `unisonVoices`: 1 → 6, linear | "Fatten" |
| **Punch** | drums | `kickPunch`: 0.02 → 0.15, linear · `kickDecay`: 0.6 → 0.25, linear (inverted: tighter at high knob) · `compRatio`: 2 → 8, linear | Kit tightness/snap |
| **Snap** | drums | `hatDecay`: 0.12 → 0.02, linear (inverted) · `openHatDecay`: 0.5 → 0.2, linear (inverted) · `hatTone`: 3000 → 8000 Hz, exp | Hat brightness/tightness together |

Each row is 2-4 targets — matching the "one macro maps to many params" reality (research 18 §6) while
staying legible (an 8-target macro is a "what does this even control" problem, not a feature).
`Filter Sweep`/`Space`/`Motion` deliberately avoid targeting anything with a destination-enum
dependency (`lfoDest` itself, `duckSource`) — see §5's target-eligibility rule for why.

## 3. The mapping data shape

One macro = one name + a target list. Each target is `(param, min, max, curve)` — a direct answer
to the brief's "each with its own target range and curve" ask:

```ts
// src/core/macro.ts (new — mirrors src/core/preset.ts's shape and validation discipline exactly)

export type MacroCurve = 'linear' | 'exp' | 'log'

export interface MacroTarget {
  /** Must be a member of AUTOMATABLE_SYNTH_PARAMS (see §5) — reusing that derived table, not a
   * hand-maintained parallel whitelist, so a macro target set grows for free whenever a new
   * numeric SYNTH_FIELDS entry (a future effect, e.g. Phase 23 BD's 7-band EQ) ships. */
  param: string
  /** Resolved value when the knob reads 0. */
  min: number
  /** Resolved value when the knob reads 100. min > max is valid and IS how "inverted" targets
   * (Punch's kickDecay, Snap's hatDecay) are expressed — no separate `invert` flag needed. */
  max: number
  /** Shape of the 0..100 -> min..max mapping. Default 'linear'. 'exp'/'log' reuse the exact
   * curve math ui/src/components/Knob.tsx already implements for knob *display* scaling
   * (toNorm/fromNorm) — ported here as pure functions so core has no UI dependency, but the
   * arithmetic is identical on purpose: a macro's cutoff curve should feel like turning the
   * cutoff knob itself, because it's driving the same value through the same range. */
  curve?: MacroCurve
}

export interface BeatMacro {
  /** Lowercase slug, e.g. "filter-sweep" — same naming rule parsePresetLibrary enforces. */
  name: string
  kind: 'synth' | 'drums' | 'any'
  category: MacroCategory // see below — a small, macro-specific taxonomy, not PRESET_CATEGORIES
  description: string
  /** 1..8ish. Order = application order (deterministic edit-list order), same discipline
   * preset.ts's orderedParams() already establishes for presets. */
  targets: MacroTarget[]
}

/** Sound-shaping-intent categories — deliberately NOT PRESET_CATEGORIES (bass/lead/pad/...),
 * because a macro cuts across voice types (Space works on a bass track and a pad track equally)
 * where a preset is one voice's whole state. */
export const MACRO_CATEGORIES = ['tone', 'drive', 'space', 'motion', 'dynamics'] as const

function resolveTarget(t: MacroTarget, knob: number): number {
  const n = Math.min(1, Math.max(0, knob / 100))
  const shaped = t.curve === 'exp' ? n * n : t.curve === 'log' ? Math.sqrt(n) : n
  return t.min + shaped * (t.max - t.min)
}

/** Pure: knob position -> resolved (param, value) pairs. No document, no I/O — this is the
 * function both the interactive GUI drag and the one-shot CLI/agent apply share. */
export function resolveMacro(macro: BeatMacro, knob: number): Array<{ param: string; value: number }> {
  return macro.targets.map((t) => ({ param: t.param, value: resolveTarget(t, knob) }))
}

/** Applies a macro to one track at one knob position. Pure document -> document, exactly
 * preset.ts's applyPreset shape: loop setValue in target order, return the new document. The
 * caller serializes/diffs as usual — this produces N ordinary edit-list lines, nothing new. */
export function applyMacro(doc: BeatDocument, trackId: string, macro: BeatMacro, knob: number): BeatDocument {
  const track = doc.tracks.find((t) => t.id === trackId)
  if (!track) throw new BeatMacroError(`no track "${trackId}"`)
  if (macro.kind !== 'any' && track.kind !== macro.kind) {
    throw new BeatMacroError(`macro "${macro.name}" is a ${macro.kind} macro — track "${trackId}" is a ${track.kind} track`)
  }
  let next = doc
  for (const { param, value } of resolveMacro(macro, knob)) next = setValue(next, `${trackId}.${param}`, String(value))
  return next
}
```

This is deliberately almost a copy of `preset.ts`'s `BeatPreset`/`applyPreset` — same validation
posture (structural here, per-value validated by `setValue` at apply time), same "one canonical
application order" discipline, same error class pattern (`BeatMacroError` mirrors
`BeatPresetError`). Reusing the shape isn't laziness — it's the same "one table, many consumers"
house style `document.ts`'s own comments invoke for `SYNTH_FIELDS`/`AUTOMATABLE_SYNTH_PARAMS`, applied
at the tooling-library layer instead of the format layer.

## 4. Authoring & storage — the concrete answer

Presets today have exactly one tier: a static, git-committed `presets/factory.json` inside the
*dotbeat application repo* (not the user's project folder), read by the daemon from `presetsRoot`
(`src/daemon/daemon.ts:337`) and applied into whichever project the user has open. There is
**no user-facing "save a new preset" feature yet** — worth stating plainly, because it's the
precedent that should set macro authoring's own ambition level for v1, not an oversight to route
around.

**Recommendation: give macros exactly the same one tier for v1 — `presets/macros.json`, same repo,
same loading path, same shape discipline as `factory.json`.** Concretely:

- New file `presets/macros.json`: `{ "version": 1, "macros": BeatMacro[] }`, validated by a
  `parseMacroLibrary()` mirroring `parsePresetLibrary()` exactly (same lowercase-slug rule,
  same duplicate-name rejection, same "must be a known param" check — reusing
  `AUTOMATABLE_SYNTH_PARAMS` as the whitelist, see §5).
- The daemon's existing `GET /library` route (`docs/phase-22-stream-ah.md`'s `LibraryCatalog`)
  gains one more array: `macros: BeatMacro[]`. No new endpoint for *listing* — this is additive to
  infrastructure Stream AH already built and `library.ts` already fetches on load.
- One new apply route, `POST /library/apply-macro { track, name, value }`, wrapping `applyMacro`
  exactly the way `POST /library/apply-preset` wraps `applyPreset` (`daemon.ts`'s existing pattern:
  reject a kind mismatch with 400, return the fresh document, no SSE echo).
- CLI: `beat macro list` / `beat macro apply <file> <track> <name> <value>` — same shape as
  `beat presets` / `beat preset`. MCP: `beat_macro_list` / `beat_macro_apply`.

**Why not a per-project `.dotbeat/macros.json` or similar, at least for v1:** dotbeat's project
folder today has no precedent for a "project-local tooling config" directory at all — the git
history repo *is* the project folder itself (`src/history/history.ts`'s own header: "history is a
plain local git repo in the project folder", no `.dotbeat/` subdirectory anywhere in the codebase),
and `media/` is the only per-project subdirectory convention that exists, for actual audio content.
A per-project macro file is a reasonable *future* tier (see §6) once two things that don't exist yet
land: (a) user-authored preset/macro saving in general, and (b) a real use case for macros that
target more than one track by id (which — like `duckSource` — would make the macro inherently
project-specific and therefore *ineligible* for the portable factory library, per D9's own
trackref-ban reasoning). Neither is true today; building the per-project tier now would be
speculative plumbing for a feature (custom user macros) that doesn't exist elsewhere in the app yet
either.

**Does "turning a macro" need a live daemon connection, the way `beat vary --scope selection`
does?** No — and this is a genuine, useful asymmetry worth stating explicitly, since the brief asks
the question directly. `beat vary --scope selection` needs the daemon because it needs two things
only a running daemon has: the live, ephemeral pointing-selection state, and non-deterministic
generation (`cli/beat.mjs:707`'s own comment: "fetch the live selection off a running daemon").
Macro resolution needs **neither** — `resolveMacro`/`applyMacro` above are pure functions of
`(document, macro definition, knob value)`, all three of which a bare CLI invocation already has
(the file on disk, `presets/macros.json`, and a `--value` flag). So:

- **CLI/agent one-shot apply** (`beat macro apply song.beat bass filter-sweep 70`) needs **no
  daemon at all** — reads the file, reads `macros.json`, writes the result, exactly like
  `beat preset`.
- **GUI interactive drag** goes through the daemon, but through infrastructure that already
  exists rather than anything new: the knob's `onChange` computes `resolveMacro()` client-side
  (a small pure function, safe to duplicate/share between `src/core` and `ui/`) and fires the
  *existing* `postEdit(path, value)` once per target on every pointer-move tick — reusing the
  per-path 60ms debounce `ui/src/daemon/bridge.ts:206-233` already implements for every other
  knob in the app. No new daemon route is needed for the interactive case; `POST
  /library/apply-macro` above exists only for the one-shot, non-dragging case (an agent, or a
  future "apply this macro at this value" GUI action outside of live dragging).

This makes macro turning **strictly simpler to wire than `beat vary`**, not an equally heavy
daemon dependency — worth flagging as a finding, since the brief's framing ("does it need a live
daemon connection, same as `beat vary`'s scoped operations") suggested it might.

## 5. Target eligibility — reuse, don't reinvent

A macro target must be a member of `AUTOMATABLE_SYNTH_PARAMS` (`document.ts:751-760` — already the
derived "every numeric field, enums/bools/trackrefs excluded because they have no meaningful curve"
list clip automation uses today). This is a direct, deliberate reuse, not a coincidence:

- It structurally excludes exactly the categories that don't make sense as a macro target for the
  same reason they don't make sense as an automation target: `lfoDest`/`osc2Type`/`filterType` are
  enums (a continuous knob can't sweep between "lowpass" and "highpass" meaningfully),
  `duckSource` is a trackref (project-specific, and per D9 already banned from portable preset
  material for exactly that reason), booleans (`lfoSync`) have no continuous range.
- It means macro coverage grows automatically as the format grows: when Phase 23 Stream BD ships
  the 7-band EQ, its new numeric fields join `AUTOMATABLE_SYNTH_PARAMS` and become valid macro
  targets with zero macro-subsystem changes.
- It correctly and honestly **excludes** the new declared-lane per-voice params
  (`lanes[].backing.params.tune/punch/decay/tone` from `docs/phase-22-stream-ab.md`) for v1 — that
  stream's own "Deliberate scope cuts" §5 notes no fine-grained `setValue` path exists yet for
  per-param edits into a declared lane's backing params ("extending `applyDrumKit`-style
  replace-the-whole-lane semantics to a fine-grained per-param edit is future work"). A macro can't
  target what `setValue` can't address. The legacy 5-lane fields (`kickTune`, `kickPunch`,
  `snareDecay`, etc.) ARE flat `SYNTH_FIELDS` entries and fully eligible today — that's what
  `Punch`/`Snap` above target.

## 6. GUI surface

**Recommendation: a "Macros" row inside `SynthPanel.tsx`, not a dedicated overlay panel.**

Concretely: a horizontal row of `Knob.tsx` instances (the existing knob widget — no new control
needed, it already supports arbitrary `min`/`max`/`log`) placed above the existing `param-groups`
grid, in the same position `EffectChain` currently occupies (`SynthPanel.tsx:224`) — likely stacked
above or below it. One knob per factory macro whose `kind` matches the selected track
(`kind === track.kind || kind === 'any'`). With the eight-macro starter set in §2, a synth track
shows 5 knobs (Filter Sweep, Grit, Space, Warmth, Motion, Width — six, kind-filtered), a drums track
shows 3 (Punch, Snap, Space) — comfortably under Ableton's 8-visible convention with zero
slot-assignment UI needed for v1 (see §7).

**Why here and not a dedicated overlay**, argued from dotbeat's own recently-settled layout
decision, not first principles: research 18's Part II spine explicitly killed the
peer-panel/tab-switcher pattern (*"Replace the three-tab Editor/Arrangement/Mixer switcher... with
one screen"*) in favor of a selection-driven bottom pane, and `SynthPanel` (alongside
`InstrumentPanel`) **is** dotbeat's Device View — the panel that already shows "this track's sound,"
already handles both `synth` and `drums` kind (`SynthPanel.tsx:211`'s own `kind` branch), and
already grew one new top-of-panel row for exactly this kind of thing in Phase 22 Stream AA
(`EffectChain`, same file, same "new panel section above the knob groups" shape). A macro is
conceptually "a front panel for this track's other knobs" — it belongs co-located with the knobs it
drives, in the view the user already has open while shaping a sound, not in a separate global
overlay (`MixerView`/`HistoryPanel`-style) that would need its own track-selection sync and would
reopen the exact "which screen am I on" fragmentation research 18 spent its whole Part II removing.

**The knob-position display problem, stated honestly.** Because the file only ever stores resolved
target values — never "this came from macro X at position 70" — there is no ground truth for where
a macro's knob should visually sit when a track is (re)selected. Two options, and the recommended
one:

- *Always reset to a neutral default (50) on selection.* Simple, but actively misleading — turning
  it even slightly would jump every target from wherever the last macro (or a hand edit) actually
  left them, not from 50.
- **Recommended: best-effort inverse-estimate from the first target's current live value**, clearly
  marked as an estimate (not a stored truth). `knob ≈ inverseResolve(macro.targets[0], track.synth[macro.targets[0].param])`
  — cheap (one inverse of one monotonic function), close enough for the common case (nobody's
  turned that param by hand since), and honestly wrong exactly when it should be wrong (someone
  hand-edited `cutoff` directly after using Filter Sweep — the estimate drifts, same category of
  cost D9/research 18 already accepted for presets: "the file doesn't record this value came from a
  macro... re-deriving requires the tooling," now applied to *display* instead of data).

This is the direct, load-bearing consequence of confirming §1's decision rather than a UI nicety —
worth stating plainly rather than leaving implicit, since it's the one place the "no in-file
indirection" choice has a visible, real cost to a user turning a knob twice.

## 7. MVP scope — a recommended cut, with one thing explicitly NOT worth building

**Build for v1** (a future build stream, not this research pass):

1. `src/core/macro.ts` — `BeatMacro`/`MacroTarget` types, `resolveMacro`/`applyMacro`,
   `parseMacroLibrary` (mirrors `preset.ts` closely enough to lift its structure directly).
2. `presets/macros.json` — the eight-macro starter set from §2 (or a trimmed subset — even 4-5
   ships the concept).
3. Daemon: `macros` array folded into the existing `GET /library` response; one new
   `POST /library/apply-macro` route.
4. CLI (`beat macro list` / `beat macro apply`) + MCP (`beat_macro_list` / `beat_macro_apply`).
5. GUI: the `SynthPanel.tsx` Macros row (§6) — one `Knob` per applicable factory macro, live-drag via
   `postEdit` per target, best-effort position estimate on selection.

**Explicitly deferred, with reasons** (so a future stream doesn't have to re-derive them):

- **Multi-track / project-specific macros and their per-project storage tier** (§4) — no current use
  case, no existing per-project tooling-config precedent to extend, and it would need the same
  trackref-portability problem D9 already solved for presets by just banning it from the shared
  library.
- **User-authored "save this as a macro" (Ableton's Map-Mode equivalent)** — sequencing dependency:
  dotbeat has no "save a new preset" feature yet either; building macro-saving before preset-saving
  exists would be building the harder version of a capability the easier version doesn't have.
- **"Macro Variations" as a distinct feature — recommend NOT building this at all, not just later.**
  This is the one place this pass diverges from treating research 18's list as a straightforward
  backlog. Research 18 described Variations as "named snapshots of macro-knob inputs in the tooling
  layer." But once a macro resolves *immediately* to literal target values with no stored knob
  state (§1's confirmed decision), a snapshot of "macro X at position 70" is byte-for-byte the same
  information as a snapshot of "these N params at their resolved values" — which is just **a
  preset**, using infrastructure that already exists (`presets/factory.json`, `applyPreset`). Once
  preset-saving ships (the dependency above), "save the current sound as a preset" already gives
  the Ableton-Variations workflow for free — turn the macro to taste, save a preset, done. A
  parallel "macro variation" mechanism would be a second, redundant snapshot system solving a
  problem tooling-only macros don't actually have.
- **An automatable/in-file macro parameter** (one lane modulating several params via a stored
  mapping) — research 18 already gave this a clear verdict ("do not build... a deliberate, versioned
  grammar addition... not smuggled in as part of a UI redesign") and nothing in this pass changes
  that; restated here only so it isn't mistaken for an open question this doc left unresolved.
- **Bool/enum/trackref/declared-lane-param targets** — structurally excluded by reusing
  `AUTOMATABLE_SYNTH_PARAMS` (§5), not a v1.1 backlog item so much as a standing constraint tied to
  when clip automation itself gains those categories (unlikely, and undesirable for the same
  "no meaningful curve" reason).
- **A "Rand" randomize-all-macros button** and **per-macro slot assignment / hot-swap picker** (pick
  *which* macro occupies knob N, Ableton's 16-mappable/8-visible model) — cheap, real v1.1 polish,
  not required to prove the concept given the starter set is already small enough to show every
  applicable macro without a picker. Worth building alongside Phase 23 Stream BB's own "Hot-swap
  preset browser in Device View" gap-closure, since it's the same underlying UI primitive (a
  named-library picker docked in `SynthPanel`) — a natural shared dependency for whichever stream
  picks up either one first.

## Sources

- `docs/research/18-ableton-ui-architecture.md` §6, Part II "The Macros / Racks recommendation" —
  the prior pass this one confirms and extends.
- `docs/research/21-opendaw-devices-effects.md` row 15 — independent second-source confirmation
  (openDAW's `ModularDeviceBox`) that in-file macro indirection is a recurring trap, not an
  Ableton-specific quirk.
- `docs/decisions.md` D9 — "presets are tooling, never grammar," the precedent this pass extends
  and cites directly for both the file-elision-and-trackref-ban reasoning and the "one code path"
  application discipline.
- `src/core/document.ts` — `SYNTH_FIELDS` (666-747), `AUTOMATABLE_SYNTH_PARAMS` (751-760, reused
  directly as the macro-target whitelist), `SYNTH_PARAM_ORDER` (648-658).
- `src/core/preset.ts` — the structural template `src/core/macro.ts` should mirror
  (`BeatPreset`/`applyPreset`/`parsePresetLibrary`/category validation).
- `src/daemon/daemon.ts` (337-420, library routes) and `docs/phase-22-stream-ah.md` — the existing
  `/library` catalog + apply-route pattern this design extends rather than duplicates.
- `docs/phase-22-stream-aa.md` — the effect-chain grammar (flat `SYNTH_FIELDS`-keyed params, no
  per-instance storage) that determines which effect params are already macro-eligible today.
- `docs/phase-22-stream-ab.md` §5 — the declared-lane per-voice-param gap that scopes out lane
  params as macro targets for v1.
- `ui/src/components/Knob.tsx` — the existing knob widget (log/linear curve math) this design
  reuses both as the GUI control and as the source for `MacroTarget.curve`'s arithmetic.
- `ui/src/daemon/bridge.ts` (195-233) — `postEdit`'s existing per-path debounce, reused verbatim
  for interactive macro-knob dragging rather than building new daemon plumbing.
- `cli/beat.mjs` (124-131, 634-754) — `beat vary --scope selection`'s daemon dependency, contrasted
  against macro resolution's daemon-optional design in §4.
