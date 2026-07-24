# Surge sidecar-instrument tracks (Track 1a)

A `surge` track makes a Surge XT factory patch a first-class **compositional** citizen of the
`.beat` format: a track whose sound source is a named factory patch, whose parameters and notes are
ordinary diffable text, rendered deterministically at render time by the existing out-of-process
sidecar (`python/surge_render.py`). GPL stays out-of-process — nothing links Surge, ever
(`docs/decisions.md` D23).

## Grammar (as shipped)

```
track lead Lead #e06c75 surge
  surge
    patch "Formant Pulse"      # factory patch name, resolved via the catalogue AT RENDER
    sampleRate 44100           # optional; 44100 is the elided default
    override cutoff 0.62       # optional normalized (0..1) param overrides
    override resonance 0.3
  synth                        # the STANDARD production block still applies
    osc sawtooth               #   (osc/filter/envelope params are honest no-ops — the timbre is Surge's)
    volume -8                  #   volume/pan/sends/eq/comp/saturator/... DO process the hosted playback
    cutoff 2000
    resonance 0.8
    attack 0.01
    decay 0.2
    sustain 0.6
    release 0.3
    pan 0
    sendReverb 0.2
  note u1 61 0 4 0.8           # ordinary notes, ordinary pitched-track grammar
  note u2 64 4 4 0.8
```

- **`surge` block** (level 1, right after the track line, before the synth block):
  - `patch "<name>"` — the factory patch name. Double-quoted because factory names have spaces;
    this is the format's one quoted string (bare `patch Formant Pulse` also parses and
    re-serializes quoted). The patch is a **display/catalogue name**, resolved to a `.fxp` path at
    render time — a `.beat` with a surge track loads fine on a machine with no Surge build.
  - `sampleRate <hz>` — optional, `8000..192000`; **44100 is the elided canonical default**.
  - `override <param> <0..1>` — zero or more normalized parameter overrides in Surge's own param
    space (not natural Hz/dB). `<param>` resolves at render by exact Surge param name, a small
    friendly-alias table (`cutoff` → `A Filter 1 Cutoff`, `resonance`, `volume`, ...), then a unique
    substring match; an unresolved or ambiguous name is a **loud render error**. Overrides serialize
    sorted by param name (one canonical form); a duplicate param is a parse error.
- **The `synth` production block still applies.** A surge track carries the standard synth block and
  effect chain. On the hosted playback (a sample voice — see below) the osc-bank / filter / envelope
  fields are **honest no-ops** (the sound is the rendered Surge audio); the production subset —
  `volume`, `pan`, the reverb/delay **sends**, `eq*`, `comp*`, `distortion*`, `saturator*`, `chorus*`
  and the reorderable insert `effect` chain — **does** process (this is the surgeplus finding: sample
  voices run the full chain). The synth block is optional on input (defaults to the format's INIT
  patch) and always re-emitted in canonical form.
- **Notes / clips** are ordinary pitched-track grammar.

## Render semantics (determinism / provenance)

At render time (`beat render`, before the engine boots — `cli/surge-render-prep.mjs`, wired into
`cli/render.mjs`'s `bootRenderSession`):

1. Each surge track's **track-level notes** are converted to the sidecar note-list (the exact math
   `src/taste/showdown.ts` `composedPhraseToSurgeNotes` uses: 16th-note steps → absolute seconds at
   the doc bpm; velocity 0..1 → MIDI 1..127).
2. A **content hash** of `(patch, sorted overrides, notes, sampleRate)` keys a cached WAV under the
   project's `media/` dir: `media/surge_<trackId>_<hash12>.wav`, with a provenance sidecar
   `…​.wav.json` (patch, resolved patch path, applied overrides, hash, sampleRate, note count,
   seconds, timestamp). **Same doc → same audio** (the `beat regen` discipline): a matching hash is a
   cache hit and skips the sidecar entirely; any change to patch / an override / a note / the sample
   rate changes the hash and re-renders on the next render.
3. The surge track is rewritten **in memory** as a drums-kind **sample host** that plays the rendered
   WAV once per loop through the track's own synth production block + effect/send chain (the
   `buildSurgeSampleHost` mechanism from the eval, promoted to an engine feature). The host uses a
   neutral voice (flat amp envelope, wide-open filter) so the full multi-second render plays through,
   gated only by the buffer end; all production fields carry over. The rewritten doc is written to a
   scratch `.beat` beside the original (so relative `media/` resolves) and the daemon/engine boot on
   that — **the engine never sees a `surge` kind**, so no engine changes were needed.

The rendered WAV is real Surge audio; the whole file is unchanged in git terms (a patch-name
reference), and the audio regenerates from it.

### Licensing (D23)

Surge XT is GPLv3 — fine for a local, out-of-process render tool; the render OUTPUT carries no code
copyleft. But the factory-**patch content** license is unresolved upstream (surge issue #6741), so
**rendered surge WAVs must not land in git** — `.gitignore` the project's `media/` surge renders
(see `examples/surge-pilot/.gitignore`). The `.beat` itself is safe to commit.

## Setup (render-side only)

Rendering a surge track needs `surgepy` (a **source build** of Surge XT — no PyPI wheel) and the
factory content path:

- `BEAT_PYTHON` → an interpreter with `surgepy` on its path (or `python/.venv`).
- `SURGE_DATA_HOME` → the Surge factory data dir (…/`resources/data`, which contains
  `patches_factory/`).
- Verify with `beat surge doctor` (surgepy availability + factory patch count) and list names with
  `beat surge patches [--role lead|bassline|chords]`.

Build steps for `surgepy` are in `python/README.md`; `beat surge doctor` names exactly what's
missing.

## CLI

- `beat track add <file> <id> surge --patch "<name>" [--sample-rate N]` — add a surge track.
- `beat set <file> <track>.surge.patch "<name>"` — swap the patch (invalidates the render cache).
- `beat set <file> <track>.surge.sampleRate <hz>`.
- `beat set <file> <track>.surge.override.<param> <0..1>` — set an override; an **empty value clears**
  it.
- `beat set <file> <track>.volume -8` (and every other synth/effect field) — production, routed to
  the synth block as on any pitched track.
- `beat surge patches [--role r]` — list the factory catalogue / curated names.
- `beat surge doctor` — surgepy + factory-path probe.

## v1 limitations (honest deferrals)

- **No live GUI playback / re-synthesis.** In the GUI a surge track plays its **last rendered WAV**;
  a knob edit (`beat set` on a surge param) invalidates the cache and re-renders on the **next
  render**, not live. Editing a surge track in the GUI before it has ever been rendered has no audio.
- **Track-level notes only.** A surge track's **clips / scenes / song arrangement do not yet render**
  — only the track's top-level notes are synthesized (the host plays that one phrase per loop). Clips
  parse and round-trip; they just aren't rendered through Surge in v1.
- **`--batch` hot-swap.** The batch renderer's per-variant file swap doesn't re-run surge prep per
  variant (only the boot doc is prepped). Single `beat render` (and `feedback`/`match`/solo) is fully
  covered.
- **Osc-bank synth fields are no-ops** on the hosted playback (documented above) — the timbre is
  Surge's; only the production subset processes.
- **Override addressing** covers scene-A filter/volume aliases + name/substring matching; the full
  Surge modulation matrix is not exposed as overrides.

## Acceptance (the pilot)

`examples/surge-pilot/loop.beat` is a 2-track surge-lead + engine-bass loop. Rendered end-to-end
through the real engine it produces non-silent audio (measured: −24.2 LUFS integrated, −13.8 dBFS
peak, real spectral content across sub/bass/mids), with the surge lead rendered via the sidecar and
hosted with production, and the engine bass synthesized natively in the same mix.
