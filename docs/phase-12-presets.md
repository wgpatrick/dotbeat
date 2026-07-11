# Phase 12 Stream 2 — the preset & drum-rack library, researched against real DAW conventions

*Owner's explicit direction: "research the types of preset synths and drum racks that are in
standard DAW systems. Let's build out our repo of synths and drum racks so it's similar."*

Before this stream, `presets/factory.json` held 4 presets (1 drum kit, 3 synth voicings), grown
ad hoc from one approved mix (Night Shift v3). This stream expanded it to **36 presets — 6
genre-named drum-voice kits and 30 synth presets across 7 researched categories** — and verified
the new content is acoustically real and distinct using this project's own metrics engine, not
by assertion.

## 1. Research pass — how shipping DAWs organize preset libraries

A focused, sourced pass (not a full adversarial harness), covering the sources the plan named:

**Ableton Live.** Live's browser Categories are split into `Sounds` ("all of your Instrument
Racks and instrument presets, organized by the **type of sound they make**, rather than by their
devices") vs. `Instruments` (organized by device) and `Drums` ("all of your drum presets ...
full drum kits ... as well as single drum hits") — [The Live 12 Browser](https://help.ableton.com/hc/en-us/articles/12927340213660-The-Live-12-Browser),
[Browser and Tags in Live 12 FAQ](https://help.ableton.com/hc/en-us/articles/11425042663708-Browser-and-Tags-in-Live-12-FAQ).
Ableton's own factory Rack packs are literally named by sound-type category — **Bass Rack, Lead
Rack, Pad Rack, Drum Rack** each ship as their own pack with a dedicated sample bank — confirming
Bass/Lead/Pad/Drums as top-level, sound-type-first categories rather than device-first ones
([House Racks](https://www.ableton.com/en/packs/house-racks/), [Magic Racks](https://www.ableton.com/en/packs/magic-racks/)).

**Serum / Vital.** Cross-referencing multiple current preset-bank listings, both tools' community
and factory content converge on the same taxonomy: **Bass, Lead, Pad, Pluck, Keys, FX/SFX**, with
arpeggio-oriented content ("Arp") a recurring cross-cutting category layered over the others
(e.g. ModeAudio's "Apex" Serum arp pack pairs 20 arps with "30 deep basses, rich pulsating pads,
vibrant synth leads and shimmering SFX"; presetshare.com catalogs presets by genre × `Arp` as a
first-class type) — [Vital Presets (edmprod)](https://www.edmprod.com/vital-presets/),
[Serum Presets (ADSR)](https://www.adsrsounds.com/synth/serum-presets/),
[Apex Serum Arp Presets](https://modeaudio.com/product/apex-serum-arp-presets),
[presetshare Arp presets](https://presetshare.com/presets?type=1&page=1).

**Native Instruments Battery/Maschine.** Factory and expansion kits are organized primarily by
**genre**, not abstract sound type — techno, house, trap/hip-hop, industrial, rock — e.g. the
Lunar Echoes expansion ships "47 Battery techno kits, 40 Maschine techno kits"; Timeless Glow
pairs kits sampled from vintage drum machines "including classics like the 909" —
[Techno and house sample packs](https://www.native-instruments.com/en/products/maschine/maschine-expansions/techno-house/),
[Best trap VSTs](https://www.native-instruments.com/en/specials/trap-vsts/).

**Genre drum-kit conventions.** Sourced findings per genre:
- **808/trap**: "808-style kicks have a less present transient and a long, subby decay,"
  produced by "a filter that is close to self-oscillating, with triggers fed directly into the
  filter"; pitch "drops down in pitch as the sound fades" — [MusicRadar TR-808](https://www.musicradar.com/tutorials/the-tr-808s-bass-drum-is-undoubtedly-the-most-recognisable-electronic-kick-sound-of-all-time-how-to-get-the-perfect-808s), [EDMProd 808s](https://www.edmprod.com/808s/).
- **Boom-bap**: "midrange weight in the snare and kick, not just sub and air"; "crunchy kicks,"
  "snappy snares," "gritty and crunchy" character, reminiscent of "worn," sampled sources —
  [Native Instruments: what is boom bap?](https://blog.native-instruments.com/what-is-boom-bap/), [Isolate Audio](https://isolate.audio/articles/boom-bap-drum).
- **House vs. techno**: "house drums have swing and shuffle, the hi-hats breathe... techno drums
  are tighter, more mechanical, and more relentless, with the hi-hat... a steady stream of
  sixteenth notes"; techno is "typically associated with a darker feel" —
  [SIX AM: House vs Techno](https://6amgroup.com/articles/guides-all/whats-the-difference-between-techno-house), [Orphiq](https://orphiq.com/resources/house-vs-techno-comparison).
- **Lo-fi**: "muted, with soft kicks... swinging hi-hats that aren't too bright"; produced via "a
  low-pass filter with a gentle curve" plus bitcrushing, which "reduces a sample's bit depth,
  introducing a gritty, lo-fi quality" — [NI: making lo-fi hip hop beats](https://blog.native-instruments.com/lo-fi-hip-hop-beats/), [Loopmasters: Lo-Fi bitcrushing](https://www.loopmasters.com/articles/2604-Create-A-Lo-Fi-Effect-In-FL-Studio-With-Bitcrushing-Dithering).

**What differentiates a category in parameter terms** (the research question behind "don't
re-label duplicates"):
- **Pluck vs. Pad**: "A pluck uses short attack + short decay + low sustain + short release...
  In contrast, a pad has longer Attack (500ms), Decay (5 seconds) and Release (9 seconds), and
  maximum Sustain." For the filter envelope specifically: "fast attack, moderate decay, medium
  sustain, and short release... each note opens up bright at the start... then settles down
  darker" is what makes the "unmistakable 'pluck' of subtractive synthesis," vs. a pad's slow
  filter-envelope attack for "the classic 'wah' sweep" — [Syntorial](https://www.syntorial.com/tutorials/synth-patch-checklist/), search synthesis of multiple sources.
- **Bass sub-types**: sub bass = "a sine wave... short attack and high sustain"; Reese bass =
  "detuning multiple sawtooth waves... no two cycles sound quite the same"; wobble bass =
  "modulating the filter cutoff... with an LFO to create a pulsating effect"; FM bass = "complex
  attacks and overtones that allow fat bass tones without disappearing in a dense mix" —
  [LANDR: Synth Bass](https://blog.landr.com/synth-bass/), [Transmission Samples: Reese](https://www.transmissionsamples.com/reese-bass-create), [EDMProd: Synth Bass](https://www.edmprod.com/synth-bass/).

**Primary in-repo source.** BeatLab's own engine (`beatlab/src/types.ts`, `DRUM_KIT_PRESETS`)
already ships four character presets modeled on real drum machines — `init` (909-style, the
current default), `tr808` ("loose, boomy... hip-hop and trap... slow pitch glide, long ringing
kick"), `tr909` ("tight, punchy, aggressive... house and techno"), `linn` ("fat, dark,
'sampled'-feeling... 80s pop") — with real calibrated `kickTune`/`kickPunch`/`kickDecay`/
`snareTone`/`hatTone` numbers. This is the actual engine dotbeat's drum-voice params drive
(confirmed by reading `beatlab/src/audio/engine.ts`: `kickTune` sets the kick MembraneSynth's
trigger frequency, `kickPunch` is its pitch-envelope decay in seconds, `kickDecay` its amplitude
decay, `snareTone` is the gain of a tonal "shell" layer blended under the snare's noise (0 = pure
noise), `hatTone` is shared `Tone.MetalSynth` resonance/brightness for both hat lanes). These
values anchored (not dictated) the new drum-voice kit designs below, pushed further per-genre
using the web research above plus a discovery specific to this engine: **for drum tracks,
`cutoff`/`resonance` are the whole-kit bus lowpass filter**, not a per-voice filter
(`src/core/edit.ts`: a fresh drum track inits at `cutoff: 12000, resonance: 0.1` — wide open) —
used deliberately below for lofi-kit's muffling and acoustic-rock-kit's natural top end.

## 2. What was built

### Drum-voice kits (`kind: "drums"`) — 6 total, up from 1

Drum tracks already support named presets identically to synth tracks — `applyPreset` in
`src/core/preset.ts` checks `preset.kind !== 'any' && track.kind !== preset.kind`, and the
pre-existing `driving-kit` preset already proved the `kind: "drums"` path end to end. **No gap
to close here** — the mechanism the plan asked to check for was already fully general.

| Kit | Genre | What's genuinely different |
|---|---|---|
| `driving-kit` (existing) | House | Moderate kick punch/decay, bright hats, parallel comp + light drive |
| `808-trap-kit` | 808/Trap | Deep `kickTune` (34 Hz) with a long slow-glide `kickPunch` (0.2s) and long `kickDecay` (1.1s) for the boomy 808 tail; very short `hatDecay` (0.025s) for hi-hat rolls; bitcrush + distortion for low-end saturation |
| `techno-kit` | Techno | Very short, snappy kick (`kickPunch` 0.015s, `kickDecay` 0.22s); scooped-mid, mostly-noise snare (`snareTone` 0.12); wide-open bus `cutoff` (13000 Hz) and heavy compression (ratio 8) for a driving, mechanical glue |
| `boom-bap-kit` | Boom-bap | Fat tonal snare (`snareTone` 0.55, longer decay); dampened bus `cutoff` (7000 Hz) + negative `eqHigh` for a "vinyl" top end; distortion/bitcrush for grit |
| `lofi-kit` | Lo-fi | Hardest bus lowpass in the library (`cutoff` 3500 Hz) + heaviest bitcrush (6 bits, 0.4 mix) + darkest hats (`hatTone` 2200 Hz) |
| `acoustic-rock-kit` | Acoustic/Rock | Highest `kickTune` (58 Hz, the most "pitched" kick) and highest `snareTone` (0.7, real shell resonance); zero distortion/bitcrush; near-fully-open bus `cutoff` (12000 Hz) — the least processed kit, by design |

### Synth presets — 30 total across 7 categories, up from 3

| Category | Presets | Differentiating mechanism |
|---|---|---|
| **Bass** (6) | `deep-sub-bass` (existing), `sub-sine-bass`, `reese-bass`, `wobble-bass`, `acid-bass`, `fm-bass` | sine sub vs. detuned-saw Reese vs. LFO-on-cutoff wobble vs. resonance-driven acid squelch vs. FM-modulator bite |
| **Lead** (5) | `bright-lead` (existing), `supersaw-lead`, `pluck-lead`, `square-chip-lead`, `fm-bell-lead` | unison width/voice-count, amp-envelope shape (sustained vs. staccato), bitcrush retro character, inharmonic FM ratio |
| **Pad** (5) | `lush-pad` (existing), `warm-pad`, `string-pad`, `glass-pad`, `dark-pad` | oscillator choice (saw/triangle), unison "ensemble" detune, FM-built shimmer vs. subtractive filter sweep |
| **Pluck** (4) | `crystal-pluck`, `warm-pluck`, `fm-pluck`, `marimba-pluck` | filter-envelope-driven brightness snap vs. FM-driven pluck vs. inharmonic woody partial |
| **Keys** (4) | `e-piano`, `bell-keys`, `organ-keys`, `warm-keys` | FM modulation index (EP vs. bell), fixed full-sustain envelope (organ) vs. decaying envelope (EP/keys), FM vs. subtractive |
| **Arp** (3) | `arp-pluck`, `arp-bell`, `arp-sequence` | short-medium decay voicings tuned for fast note runs — delay-forward, distinct from one-shot Plucks |
| **FX** (3) | `riser-sweep`, `noise-impact`, `drone-texture` | noise-oscillator-dominant content, long filter-envelope sweeps, dual independent LFOs |

Every param used is a real field from `SYNTH_FIELDS`/`SYNTH_PARAM_ORDER` in
`src/core/document.ts` (read in full before designing anything). One real constraint discovered
by reading the field table and the engine together: `wtTable`/`wtPos` exist as fields but are
inert on dotbeat today — the engine only scans wavetable position when `osc === 'wavetable'`,
and dotbeat's `OscType` enum (`sine | triangle | sawtooth | square`) doesn't include
`'wavetable'` — so no preset here touches those two fields.

## 3. Verification — real renders, real metrics

All 36 presets were applied to a real track via `beat preset` (in a fresh temp project — one
track per preset, drum kits exercising all 5 lanes across the loop, synth presets playing one
sustained note), rendered to a real WAV, and measured with `src/metrics/analyze.ts` (spectral
band %, centroid, crest factor) — the same metrics Phase 5's exit test used, same standard of
"measured numbers, not adjectives."

**Rendering path used, and why.** `cli/render-offline.mjs` (the node-web-audio-api path Phase
5's exit test uses) requires a *patched* native build (`scripts/build-patched-webaudio.sh`); this
checkout only has the plain npm release, which — confirmed empirically, not just by the code
comment's warning about hats — produces **completely silent output for every render**, drums or
not (verified: peak sample value 0 across the whole buffer for a single held synth note with no
drums involved). So verification instead used `cli/render.mjs`, the real-Chromium/real-Web-Audio
path (validated first against a single simple track: non-clipping, sensible -14.6 dBFS peak,
plausible spectral content — trustworthy for A/B comparison between presets even though its
absolute loudness on the existing multi-track `night-shift.beat` example differs from the
archived Phase-5 reference, which is a pre-existing, unrelated gap between the two render
pipelines this stream didn't introduce and wasn't in scope to fix). The verification script is
committed at `scripts/verify-phase12-presets.mjs` and is re-runnable
(`node scripts/verify-phase12-presets.mjs --beatlab-dir <path>`).

**Methodology note, stated honestly**: all synth presets were tested at the same fixed note
(MIDI 60) for a controlled A/B — this is a fair comparison *between* presets, but it means a
preset like `sub-sine-bass` doesn't show up as literally "sub-band-heavy" in this specific test
(the 0-60 Hz `sub` band is empty for every synth preset here, because none of them were played at
an actual sub-bass MIDI pitch) — that's a property of the test note choice, not the preset.

### Drum kits: real, measured, and matching the research

| Kit | Peak dBFS | Crest dB | Spectral centroid | air % |
|---|---|---|---|---|
| `driving-kit` (house) | -11.25 | 18.99 | 584 Hz | 4.2% |
| `808-trap-kit` | -9.47 | 14.77 | **216 Hz** (darkest/boomiest) | 0.7% |
| `techno-kit` | -12.13 | 21.89 | 972 Hz | 7.2% |
| `boom-bap-kit` | -10.22 | 18.36 | 340 Hz | 2.3% |
| `lofi-kit` | -9.99 | 19.33 | **135 Hz** (lowest of all 6) | **0.1%** (lowest of all 6) |
| `acoustic-rock-kit` | -13.31 | 19.64 | **1139 Hz** (brightest of all 6) | **9.3%** (highest of all 6) |

This is a direct, measured confirmation of the design intent, not just distinct-sounding-by-luck:
`lofi-kit` (heaviest bus lowpass + bitcrush) measures the **lowest** spectral centroid and
**lowest** air-band energy of any kit in the library; `acoustic-rock-kit` (deliberately the least
processed, bus filter left nearly wide open) measures the **highest** of both. `boom-bap-kit`
measures the highest mids % of any drum kit (6.6%, vs. 0.5-2.9% for the others) — a direct,
measured match to the sourced research claim that boom-bap carries "midrange weight... not just
sub and air." `808-trap-kit` measures the highest bass-band % (77.4%) of any kit, consistent with
its long, boomy low-frequency kick tail.

### Synth presets: representative cross-category and within-category evidence

Cross-category (same test note, MIDI 60): `noise-impact` (FX) measures a spectral centroid of
**2795 Hz** and **22.1% air-band energy** — both by far the highest in the entire 36-preset
library — a direct, measured signature of its dominant broadband-noise oscillator, nothing like
any tonal preset. `sub-sine-bass` (peak -5.83 dBFS, crest 9.72 dB) vs. `reese-bass` (peak -13.08
dBFS, crest 16.90 dB) shows a 7.25 dB peak-level gap and a 7.18 dB crest-factor gap between two
presets in the *same* category — a flat sustained sine vs. a dynamic detuned-saw texture are
measurably, not just nominally, different instruments.

Within a tight category (Keys, all four tested at the same note/duration): `organ-keys` (fixed
full-sustain envelope, `sustain: 1`) measures crest 13.27 dB against `bell-keys` (long FM decay
into near-silence, `sustain: 0.15`) at crest 16.33 dB — a 3+ dB gap driven directly by the
different amplitude-envelope shape the research identified as the pluck/pad/keys differentiator.
`e-piano` and `warm-keys` (FM vs. subtractive routes to a similar EP-ish role) differ in crest by
1 dB and in bass-band % by 2.7 points — smaller gaps than the drum kits or the bass category,
honestly reported: four short-to-medium melodic Keys voicings playing the same single note
converge more in a coarse 5-band spectral bucket than in perceived timbre (which lives more in
harmonic detail this metric doesn't resolve) — the params themselves (FM ratio, envelope shape,
oscillator choice) are still genuinely different per the design table above, not relabeled
duplicates.

Full 36-row raw output (name, kind, peak/RMS/crest dB, spectral centroid, 5-band %) is
reproducible via `node scripts/verify-phase12-presets.mjs --beatlab-dir <beatlab checkout>` — the
JSON-per-line format used here.

### New tests

`test/preset.test.ts` gained three tests: the drum-kit-count/name tripwire (`>= 6` kits,
including all 6 genre names), the synth-taxonomy tripwire (`>= 24` synth presets, one
representative name per category), and a structural distinctness check (no two presets in the
library share an identical param bag, regardless of name) — a cheap, permanent regression guard
against the exact failure mode the owner's brief warned against ("not re-labeled duplicates").

`npm test`: **289/283/0/6** (was 286/280/0/6 before this stream; +3 new tests, 0 regressions, the
6 skipped are the pre-existing macOS-tmpdir-symlink history-test quirk, unrelated to this
stream).

## 4. Deferred, honestly

- **No `src/core` changes were needed.** The plan asked to check whether drum tracks support
  named presets the same way synth tracks do — they already did (`preset.kind === 'drums'`
  already worked end to end via the existing `driving-kit`); there was no gap to close.
- **The offline (`render-offline.mjs`) render path is unusable in this checkout** without
  building the patched native `node-web-audio-api` module (`scripts/build-patched-webaudio.sh`,
  a Rust toolchain build not attempted here) — the plain npm release renders total silence for
  any content. Verification used the browser-based `cli/render.mjs` path instead (validated
  independently, see above). This is a pre-existing environment gap, not something this stream
  introduced, but it's worth flagging: whoever next needs `render-offline.mjs`'s bit-accurate
  engine parity should expect to run the patched-build script first.
- **Additional licensed sample content** (more FreePats/Freesound CC0 kits per research 09's
  cleared shortlist) was explicitly deprioritized per the plan's own guidance ("synthesized
  drum-rack presets are the higher-value, lower-risk deliverable, prioritize those first") and
  wasn't attempted this stream — the 6 synthesized genre kits above cover the same genre spread
  (808/trap, house, techno, boom-bap, lo-fi, acoustic/rock) the owner asked for without any new
  licensing surface.
- **A dedicated "Chords" category** (seen in some Ableton/Vital taxonomies alongside Bass/Lead/
  Pad/Keys) was folded into existing categories (`organ-keys`/`string-pad` cover chord-friendly
  sustained voicings) rather than split out separately — with a 30-preset synth library already
  shipped this stream, a dedicated Chords category is a reasonable next increment rather than a
  gap in this pass.
