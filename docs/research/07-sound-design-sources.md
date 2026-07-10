# Research pass 07 — Sound-design quality strategy: engines, presets, samples, licensing

*Run 2026-07-10 via the deep-research harness (fan-out search → fetch → adversarial 3-vote
verification → synthesis). 5 angles, 24 sources fetched, 116 claims extracted, 25 verified:
**24 confirmed (3-0), 1 refuted (0-3), 0 unverified.** 106 agents. Triggered directly by owner
feedback: "we have a long way to go to sound good… my sense is this is more about developing
preset synths, or importing other synths… and get audio samples. you may want to do some deep
research here."*

## Headline

The verified evidence supports a **layered strategy, ranked by effort/impact**:

1. **Tier 1 (done first, already underway):** curate presets on the existing 74-param engine and
   expose the parameter surface to agents — zero licensing risk, we own the engine. *(Phase 5
   shipped exactly this: format v0.3 + `presets/factory.json`.)*
2. **Tier 2 (low-moderate effort, high impact):** sample-based drums/instruments via
   **spessasynth_lib** — pure-TypeScript, **Apache-2.0**, plays SF2/SF3/SFOGG/DLS in the browser
   with **no WASM**, actively maintained (v4.3.0, May 2026) — fed by a **Freesound CC0** sample
   pipeline with per-file provenance metadata.
3. **Tier 3 (moderate effort, high impact):** port **Dexed's core FM engine (msfa)** — it is
   **Apache-2.0** (unlike the GPLv3 Dexed plugin wrapper) and loads standard DX7 `.syx`
   cartridge banks, unlocking the enormous DX7 patch ecosystem. Already proven in-browser
   (webDX7 via Emscripten).
4. **Tier 4 (conditional):** adopt **Surge XT** or **Vital's engine** *only if* the project
   accepts GPLv3 — and **never bundle Vital factory content** (presets AND wavetables are
   separately licensed, non-redistributable).

**The big coverage caveat:** all 24 surviving claims address engines/licensing/samples
(questions 2-3). **Zero claims survived on preset-craft technique or the pro-vs-amateur craft
gap** (questions 1 & 4) — those angles surfaced only blog-grade sources that failed adversarial
verification. The Tier-1 premise ("preset craft on our engine closes most of the gap") is
informed judgment backed by our own A/B experiment (v1 vs v3 night-shift), not by this pass.

## Verified findings (all 3-0 unless noted)

### Licensing ground rules

- **Engine license ≠ content license — always check both.** The canonical trap is Vital: engine
  source is GPLv3, but the README states verbatim *"Do not distribute the presets that come with
  the free version of Vital. They're under a separate license that does not allow
  redistribution"* — and the EULA extends this to wavetables and other unaltered factory media.
  FSF GPL FAQ confirms the general principle (bundled artwork/audio can be licensed separately).
  *(github.com/mtytel/vital, vital.audio/eula, gnu.org GPL FAQ)*
- **Rendered audio from a GPL engine is NOT automatically GPL-encumbered.** FSF: "The output of
  a program is not, in general, covered by the copyright on the code of the program" — with one
  exception: output that **copies GPL'd bundled content** (wavetables/samples shipped with the
  program) carries that content's license. Surge XT's team additionally states officially that
  music/patches/sounds made with Surge belong entirely to the user, commercial use included.
  *(gnu.org GPL FAQ #WhatCaseIsOutputGPL, surge-synthesizer.github.io/faq)*

### Engine-by-engine

| Engine | Engine license | Factory content license | Browser port | Notes |
|---|---|---|---|---|
| **Vital** | GPLv3 | **Separate, NON-redistributable** (presets + wavetables per EULA) | none verified | Trademark restrictions too; GPL path exists but content must be replaced |
| **Surge XT** | GPL-3.0 | user output explicitly unencumbered; **factory patch (.fxp) license itself NOT verified** (open question) | none verified | Cleanest GPL option — team waives claims on output |
| **Dexed / msfa** | Dexed wrapper GPLv3; **msfa core Apache-2.0** (per-file headers verified) | n/a (loads user `.syx`) | **yes** — webDX7 via Emscripten proves it | Loads standard DX7 `.syx` banks (4104/4096 bytes, multi-message sysex streams); DX7II/single-voice need conversion |
| **sfizz (SFZ)** | BSD-2-Clause (engine); sfizz-webaudio wrapper MIT | n/a (loads user SFZ) | **prototype only** — 2021, generators + in-memory samples only, no streaming | Proves SFZ-in-browser works; not production-ready |
| **spessasynth_lib (SF2/DLS)** | **Apache-2.0** (lib + core, verified) | bundles **no** content — per-soundfont licensing is ours to audit | **native TS/AudioWorklet — no WASM needed** | v4.3.0 May 2026, actively maintained; SF2/SF3/SFOGG/DLS + DLS→SF2 conversion |
| **WAM2 ecosystem** | varies per plugin | varies | **58 plugins** live in the community index, npm-installable, no build steps | Includes an SF2 player, 16-pad drum sampler, SH-101 clone, modal synth; **none** of Vital/Surge/Dexed/sfizz are in the index; documented C/C++→WASM porting pathway (peer-reviewed WAM2 paper). A claim giving precise instrument/effect category counts was **REFUTED 0-3** — only the total (58) and the four named instruments are verified. |

### Samples

- **Freesound is the viable CC0 source with built-in license isolation**: three main licenses
  (CC0 / CC-BY / CC-BY-NC, plus a retired legacy Sampling+). The CC0 subset may be used,
  modified, redistributed, even sold, no attribution required. Both the search UI and **APIv2
  expose a license filter** (`license: "Creative Commons 0"`), so the redistributable subset can
  be programmatically isolated. Caveat: Freesound does not verify upload provenance — a
  CC0-tagged file can still contain infringing material.
- **Aggregated "CC0" repos cannot be trusted without per-file auditing**: the LMMS replacement
  sample library shipped samples labeled CC0 that had actually been promised only under
  attribution terms (project lead's own 2014 "CC0 Violations" issue; uncleared samples
  quarantined in 2015). Prefer sources with per-file license metadata (Freesound API) over
  aggregated packs.

## What did NOT survive (and what that means)

- **Preset-craft technique** (layering, unison/detune recipes, modulation routing, velocity
  response, authoritative guides) — sources found (Sound On Sound's 63-part *Synth Secrets*
  series, Syntorial, Splice/FaderPro supersaw guides) but no claim survived verification.
  Treat every specific technique claim as unverified. Our own A/B experiment (9-param vs
  50-param night-shift renders) remains the strongest *local* evidence that patch depth is the
  quality lever.
- **The craft gap** (sound selection vs mixing vs arrangement weighting) — only vendor blogs
  surfaced; nothing survived. Still unresearched.
- **REFUTED (0-3):** "wam-community lists ~82 plugins, ~10 instruments / ~65 effects" — the live
  index has 58 entries and the category breakdown was wrong.

## Open questions (carried forward)

1. Copyright status of community DX7 `.syx` collections (e.g. the ~30k-patch archives) — and
   whether bare synth parameter presets are copyrightable at all. Gates *bundling* vs
   *user-loading* the DX7 ecosystem. (One fetched source admitted its "public domain" label
   rests on "was freely downloadable", not rights clearance.)
2. Per-source license audit of specific SoundFonts/kits (GeneralUser GS, FluidR3, Hydrogen
   drumkits, 99Sounds) — in scope this pass, produced no surviving claims.
3. Preset craft & production craft (questions 1 & 4) — re-research against book/curriculum-grade
   sources (e.g. the *Synth Secrets* corpus itself, academic mixing literature) rather than blogs.
4. Surge XT's factory patch library license specifically; any maintained WASM/headless Surge port.

## Consequences for the roadmap

- **Phase 5 (done) was the right Tier 1.** The v0.3 surface + factory presets is exactly the
  zero-license-risk first step this pass recommends.
- **Next sound-quality step = Tier 2**: a `beat`-side sampler track kind backed by
  spessasynth_lib (Apache-2.0, no WASM), plus a Freesound-APIv2 CC0 ingestion pipeline that
  stores per-file provenance (id, uploader, license URL, retrieval date). This also gives drums
  real transients — the single biggest "video game music" tell in the current kit.
- **Tier 3 (msfa FM import) is licensing-clean** and proven in-browser; it would be the first
  *second engine* and forces the format's multi-device story — sequence after sampler.
- **License decision gates Tier 4**: the repo needs its own license chosen (currently
  unlicensed) before any GPL code can even be considered. Flagged in ROADMAP open decisions.
- The `presets/factory.json` library grows via our own variation-loop (docs/variation-loop.md)
  + curation rather than by importing third-party preset content, whose licensing is the
  single most consistently poisoned well found in this pass.
