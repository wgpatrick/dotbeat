# Phase 25 — Effects panel redesign: only show what's actually there

*2026-07-12.* Owner feedback on the synth panel GUI: "It seems like all the audio effects are just
like present there as drop-downs? That's odd. It seems like they should be 'added' to the device,
only if there's interest in using them... Also - not clear if they're actually doing anything." This
stream fixes exactly that, and documents the fixed-vs-opt-in distinction that made a naive "gate
everything" fix wrong.

## The bug: two effect mechanisms, only one of them opt-in

dotbeat actually already had the real, correct, opt-in mechanism the owner is describing:
`ui/src/components/SynthPanel.tsx`'s `EffectChain` component renders `track.effects` — an ordered
list of `BeatEffect` instances (`src/core/document.ts`) — and nothing in that list is wired into the
live audio graph until it's explicitly `effect-add`ed, via the GUI's own add-effect picker or `beat
effect-add` (Phase 22 Stream AA; extended by Streams BD/BE/BF). `engine.ts`'s `reconcileEffectChain`
does a real routing splice for this, not a fake bypass — this part was already Ableton-like.

The bug was a SEPARATE mechanism sitting right below it in the same panel:
`ui/src/components/synthParams.ts`'s `PARAM_GROUPS` rendered a collapsible knob-group section for
every optional effect type — eq3/comp/distortion/bitcrush/eq7/autoFilter/autoPan/tremolo/utility/
grainDelay/vinylDistortion/resonator, plus the genuinely-fixed saturator/chorus/phaser/pingPong/
beatRepeat — **unconditionally**, regardless of whether that type was actually in `track.effects`.
A fresh track showed every knob group Phase 22/23 had ever added, whether or not the corresponding
DSP existed in the live graph. That's the "just present there as drop-downs" the owner was looking
at, and it's exactly what made "are these doing anything?" an honest question — most of that wall of
knobs, on a fresh track, controlled nodes that didn't exist yet.

## Research: how Ableton actually does this

A focused pass (not the full research-doc treatment — see the task brief) against Ableton's own
reference manual and forum discussion of Device View confirmed the model dotbeat's `EffectChain`
already follows and `PARAM_GROUPS` didn't:

- **An empty track's Device View shows no device panels at all.** There is nothing to configure
  until something is actually on the track — Ableton doesn't pre-render a compressor's knobs on a
  track that has no compressor. (Ableton manual, "Working with Instruments and Effects": devices are
  added by dragging from the Browser into Device View or double-clicking a Browser entry onto the
  selected track; nothing appears until that happens.)
- **The Browser stays reachable regardless of whether the track already has devices.** Adding one
  more device to an already-populated track is the same drag/double-click gesture — "simply drag it
  there or double-click its name to append it to the device chain." There's no separate "now it's
  full, no more adding" state.
- **Reordering and viewing devices happens in the SAME horizontal chain**, left to right, title bars
  showing enable/preset/param controls only for what's actually there. This is the direct analogue
  of dotbeat's `EffectChain` row list (drag/▲▼ to reorder, real controls per row) — dotbeat already
  had this half right.

The gap was entirely on the "showing controls for a device that doesn't exist" side, which Ableton's
model has no equivalent of at all — there's no such thing as a visible-but-inert Compressor panel on
a track with no Compressor. That's the bar this stream targets: hide the group, not just the device.

Sources consulted: [Ableton Live 12 Manual — Working with Instruments and
Effects](https://www.ableton.com/en/manual/working-with-instruments-and-effects/); Ableton Forum
threads on Device View drag/drop and chain behavior (device-add and device-chain-list navigation).

## The wrinkle: NOT every group in the wall is actually opt-in

Before gating anything, it mattered to work out which knob groups are real opt-in chain members and
which are genuinely fixed, always-wired inserts — gating the wrong ones would have hidden real,
currently-active controls.

**Fixed, always-wired inserts (Phase 22 Stream AC + Beat Repeat) — left untouched, still always
visible:** saturator, chorus/phaser (one combined group), Ping Pong Delay, Beat Repeat. These are
spliced into the signal path unconditionally in `ui/src/audio/engine.ts` — `buildSynthChain()` and
`getDrumBus()` both call `wireFxTail()` for saturator->chorus->phaser->pingPong on EVERY track, synth
or drum, no `effects`-list involvement at all. Their knobs being always-visible is correct: the DSP
really is always present, just usually inaudible at default (e.g. `saturatorMix = 0`). Gating these
would have hidden real, live controls — exactly the mistake the task brief warned against.

**Real opt-in `EffectType` chain members (Phase 22 Stream AA + Streams BD/BE/BF) — now gated:**
eq3, comp, distortion, bitcrush, eq7, autoFilter, autoPan, tremolo, utility, grainDelay,
vinylDistortion, resonator. Every one of these is only wired into a synth track's live graph when a
matching `BeatEffect` is present in `track.effects` (`engine.ts`'s `reconcileEffectChain` /
`buildEffectRuntime`) — confirmed directly by reading that code, not assumed from the type's name.

**A second wrinkle inside the opt-in set: eq3/comp/distortion/bitcrush are dual-natured.**
`src/core/document.ts`'s `BeatTrack.effects` field is explicitly synth-tracks-only — drum/instrument
tracks always carry `[]`. But `eqLow`/`compThreshold`/`distortionAmount`/`bitcrushBits` etc. are
fields on the ONE shared `BeatSynth` shape every track kind carries, and `engine.ts`'s
`getDrumBus()` wires all four unconditionally into the drum bus, exactly like the AC fixed-insert
group — drum tracks never see an `effects` chain at all, so there is nothing there to gate. So the
same four fields are simultaneously:
- **opt-in chain members** on a SYNTH track (real chain membership, must be gated), and
- **a fixed insert** on a DRUM track (same status as saturator etc., must stay always-visible).

The gate implemented below is therefore conditioned on track kind, not just on the field/group
identity — see "Design" below.

**A third wrinkle: `eq3`/`comp`/`distortion`/`bitcrush` are also the LEGACY DEFAULT CHAIN.**
`defaultEffectChain()` seeds every brand-new synth track (and every pre-v0.10 file) with exactly
these four, enabled, in that order — the sole migration target the whole file-format guarantees
(`format-v10-effects.test.ts`'s first test pins this down). So on a *freshly created* synth track,
these four groups are correctly VISIBLE from the start (the chain already contains them) — only
`eq7`/`autoFilter`/`autoPan`/`tremolo`/`utility`/`grainDelay`/`vinylDistortion`/`resonator` (never
in the default chain) start hidden. This isn't an inconsistency; it's the format's own documented
default made visible in the panel, and it degrades gracefully — remove `comp` from the chain and its
group disappears too (verified below).

## Design

1. **`synthParams.ts`: `ParamGroup` gained an optional `effectType?: EffectType` field.** Set on
   every opt-in group (the twelve types above); absent on every fixed-insert group and on the core
   synth surface (osc/filter/lfo/amp/sends/sidechain/drumvoice). This is pure metadata — no
   behavior lives in `synthParams.ts` itself, consistent with the file's existing "declarative
   metadata table, SynthPanel is the one renderer" discipline.

2. **The old single `'inserts'` group ("Inserts (EQ / Comp / Drive)") was SPLIT into four** — `eq3`,
   `comp` ("Compressor"), `distortion` ("Distortion"), `bitcrush` ("Bitcrush") — one per
   `EffectType`, titled to match `EFFECT_LABELS` (the same labels the Effect Chain panel's rows and
   add-picker already use, so "Compressor" in the chain list and "Compressor" in the knob wall are
   visibly the same thing). Splitting was necessary, not cosmetic: the old combined group bundled
   four independently-removable chain members into one visibility unit, so removing just `comp`
   would have left its now-dead knobs sitting next to eq3's still-live ones with no way to tell
   which was which. Verified directly (see below): removing `comp` alone now hides only the
   Compressor group, EQ3/Distortion/Bitcrush stay visible.

3. **`SynthPanel.tsx`'s group filter** now reads:
   ```ts
   const groups = PARAM_GROUPS.filter((g) => {
     if (!g.kinds.includes(kind)) return false
     if (g.effectType && kind === 'synth') return effects.some((e) => e.type === g.effectType)
     return true
   })
   ```
   The `kind === 'synth'` condition is the fix for the dual-natured eq3/comp/distortion/bitcrush
   case above: the gate only ever applies on synth tracks; on a drum track those same four groups
   fall through to `return true` unconditionally, exactly like the fixed-insert groups.

4. **Reactivity, no reload needed.** `postEffectAdd`/`postEffectRemove` (`ui/src/daemon/bridge.ts`)
   already apply the daemon's returned document straight to the zustand store (`useStore`) —
   `SynthPanel` reads `track.effects` from that same store on every render, so the group filter
   above re-evaluates automatically the instant an effect is added or removed. No new state,
   subscription, or polling was needed; this was already true of the `EffectChain` component itself
   and just needed the knob-group filter to read the same field.

5. **UX polish: making "I added it" and "here are its knobs" the same visible moment.** The task
   brief specifically flagged this ("not clear if they're actually doing anything" suggests the
   add-then-see connection should feel obvious). `SynthPanel` now tracks which effect type was just
   added (`justAdded` state, set from `EffectChain`'s add button after `postEffectAdd` resolves).
   The matching `Group` component, when it's the just-added one, forces its `<details>` open (some
   opt-in groups default closed — eq7/autoFilter/grainDelay etc.) and calls `scrollIntoView` on
   mount, plus a one-shot CSS `.param-group-flash` outline animation (1.6s, pure CSS, no layout
   shift). This is a small, targeted addition — no new browsing UI, no restructuring of the Effect
   Chain panel itself, which already had the right add/remove/reorder/bypass affordances (Phase 22
   Stream AA); it just makes the RESULT of clicking "+ Add effect" land somewhere the human can
   immediately see, instead of requiring them to go hunting through a long collapsed-groups list.

## What stayed the same, deliberately

- The `EffectChain` component itself (add picker, drag-to-reorder, ▲/▼ buttons, bypass checkbox,
  remove button) is untouched — it was already the correct, Ableton-like mechanism; this stream
  only fixed the OTHER panel that didn't respect it.
- Fixed-insert groups (saturator/chorus-phaser/pingpong/beatrepeat) render exactly as before —
  always visible, no `effectType`, no gating — because their DSP really is always live.
- Drum tracks keep seeing eq3/comp/distortion/bitcrush unconditionally (their own fixed bus insert),
  and never see the eight synth-only opt-in types (autoFilter/autoPan/tremolo/utility/eq7/
  grainDelay/vinylDistortion/resonator) at all — that `kinds: ['synth']` restriction predates this
  stream and was already correct.

## Verification

`ui/verify-phase25-effects-panel-redesign.mjs` — Playwright against a real `beat daemon` + the real
built frontend in headless Chromium (same harness as `ui/verify-phase22-stream-aa.mjs`):

1. A fresh synth track shows NO param group for `eq7`/`autoFilter`/`grainDelay` (not in the default
   chain), but DOES show `eq3`/`comp`/`distortion`/`bitcrush` (the legacy default chain) and the
   fixed-insert groups (`pingpong`/`beatrepeat`/`chorusphaser`/`saturator`).
2. Adding `eq7`/`autoFilter`/`grainDelay` via the REAL Effect Chain add picker (select + "+ Add
   effect" click, not a direct API call) makes each one's param group appear live — no reload — and
   confirms it auto-opens (`<details open>`) and gets the `.param-group-flash` highlight class.
   Removing each via the real remove button hides the group again.
3. Removing just `comp` from the default chain hides ONLY the Compressor group; `eq3`/`distortion`/
   `bitcrush` stay visible. Re-adding `comp` brings it back.
4. Through every add/remove above, the fixed-insert groups never move — checked before and after
   every step.
5. A drum track with a genuinely empty `effects` array (`[]` — drum tracks never carry one) still
   shows `eq3`/`comp`/`distortion`/`bitcrush` (its own fixed bus insert) plus the fixed-insert
   groups — confirming the `kind === 'synth'` condition correctly exempts drum tracks from the gate.

All checks pass:

```
[1] PASS: fresh synth track — hidden: eq7,autofilter,graindelay; shown (default chain): eq3,comp,distortion,bitcrush; shown (fixed): pingpong,beatrepeat,chorusphaser,saturator
[2] PASS: adding eq7 revealed the "eq7" param group, auto-opened + flashed
[3] PASS: removing eq7 hid the "eq7" param group again
[2] PASS: adding autoFilter revealed the "autofilter" param group, auto-opened + flashed
[3] PASS: removing autoFilter hid the "autofilter" param group again
[2] PASS: adding grainDelay revealed the "graindelay" param group, auto-opened + flashed
[3] PASS: removing grainDelay hid the "graindelay" param group again
[4] PASS: add/remove round-trip verified for eq7, autoFilter, and grainDelay
[5] PASS: removing just "comp" from the default chain hid ONLY the Compressor group — EQ3/Distortion/Bitcrush stayed visible
[5] PASS: re-adding comp brought the Compressor group back
[6] PASS: fixed-insert groups (pingpong, beatrepeat, chorusphaser, saturator) stayed visible through every add/remove above
[7] PASS: drum track (0 effects entries) still shows eq3/comp/distortion/bitcrush groups (fixed bus insert there) plus the fixed-insert groups: filter, amp, eq3, comp, distortion, bitcrush, pingpong, beatrepeat, chorusphaser, saturator, sends, sidechain, drumvoice
```

Also: full suite (`npm test`, 561/561) and both typechecks (`npx tsc -p tsconfig.json --noEmit`,
`cd ui && npx tsc --noEmit`) pass clean.
