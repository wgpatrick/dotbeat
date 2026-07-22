# Research 114 — synth-engine alternatives: how to get better synth sounds into dotbeat

*2026-07-21. Commissioned after the source-showdown blind eval (`docs/source-showdown-eval.md`,
memory 2026-07-21): the engine's clips took a **4% pairwise win rate** against **94% for
commercial-record ref chops** and **~70% for fal-generated audio**, and the T6 sound-matching
harness (`docs/t6-sound-matching.md`) suggests even CMA-ES-optimal patches in the current synth
space don't reach real-record timbre. This pass researches **engines, not prompts**: what better
sound sources exist, what they'd cost to integrate, and what to try first. Single-agent web pass
(WebSearch + targeted fetches), NOT the 3-vote adversarial harness — every web-sourced claim
carries a confidence label: **(high)** = primary source fetched or 2+ independent agreeing
sources; **(medium)** = one source or search-summary-derived; **(low)** = inference or memory,
unverified. dotbeat-side and openDAW-side claims are read from this repo's own docs
(`docs/opendaw-notes.md`, research 21, research 115, t6, source-showdown-eval) and cited as such.
Research only — no code changes.*

## Headline

**Two distinct integration shapes exist, and conflating them is how this decision goes wrong:**

1. **Live device** — a new instrument that runs inside dotbeat's offline-exact render path.
   Must be license-clean for a possible future product, byte-deterministic, and maintainable.
   Almost every famous open-source synth is **GPLv3**, which poisons this shape for all of them
   except via a paid commercial license (Vital) — the one clean standout is the **DX7 engine
   `msfa` (Apache-2.0)**, which already exists as an MIT WAM/AudioWorklet port (`webdx7`) that
   would drop into dotbeat's existing WebAudio graph.
2. **Sound factory** — an external engine (any license, any process) that renders audio
   **offline into committed sample assets**, which dotbeat then plays through its existing
   sampler/keymap machinery — exactly the shape the fal/`keymap` pipeline already proved out at
   a 70% win rate. Determinism is free (the asset is content-addressed bytes in the repo);
   GPL is confined to a tool the user runs, whose *outputs* carry no copyleft; and the huge
   preset ecosystems (2,779 Surge patches, ~15,000+ DX7 patches in one collection alone) become
   directly harvestable.

**Recommendation: run the cheapest experiment in the factory shape first — a `surge` showdown
source rendered by `surgepy` through role-filtered factory patches (effort S, zero engine work,
zero license exposure) — and, in parallel or immediately after, the produced-defaults arm from
research 115, because the showdown's `engine` source currently renders at dry/mono defaults and
the 4% number conflates "engine ceiling" with "nobody turned the width/air/motion knobs on."
Only if a factory-shape source decisively beats both does a live-device integration (webdx7
first, being the only permissively-licensed candidate) earn its complexity.**

---

## 1. openDAW's synth devices — good ideas, unusable code

What openDAW ships is already fully mapped in this repo (research 21 §1.2, read directly from a
clone at commit `de7565a`): **Vaporisateur** (2-osc subtractive with unison + voicing modes),
**Nano** (minimal one-shot sampler), **Playfield** (composite drum rack), **Soundfont** (SF2
region player), plus scriptable escape hatches. Nothing in its instrument set is a tier above
dotbeat's own synth vocabulary — Vaporisateur is roughly dotbeat's synth plus unison (which
dotbeat has since added). The effects side is where openDAW is richer (Revamp 7-band parametric
EQ, Dattorro plate, delay-time-LFO delay — research 21 §1.4).

- **License: AGPL v3 (or later) dual-licensed with a paid commercial license** *(high —
  confirmed both in `docs/opendaw-notes.md` and by the current GitHub repo/README;
  https://github.com/andremichelle/openDAW)*. AGPL is the *strongest* copyleft — it triggers on
  network use, not just distribution. Copying any openDAW DSP source into dotbeat would obligate
  the whole app. There is also an `opendaw-headless` repo *(medium —
  https://github.com/andremichelle/opendaw-headless, not inspected)* — same license posture.
- **Extractability: facts and parameter lists only.** The standing rule from research 21 holds:
  vocabulary, parameter ranges, and architecture are safe to re-derive; source is not.
- **Sound-quality ceiling: not obviously higher than dotbeat's.** No evidence openDAW's stock
  instruments produce the commercial-record timbre the showdown ref chops have — its
  Vaporisateur is the same subtractive family that just lost. The exception is its **Soundfont
  device**: sample playback of real recorded instruments is a genuinely different ceiling, and
  the idea (not the code) transfers — see §5.4.

**Verdict: no integration path. Keep mining it for device *specs* (the parametric EQ and plate
reverb from research 21 remain the best-documented targets); never for code.** Effort N/A.

---

## 2. Open-source hardware-synth emulators

### 2.1 The GPL problem, spelled out once

Every synth in this section except the `msfa` core is **GPLv3** *(high — each repo's LICENSE
verified via search results below)*. Concretely for dotbeat:

- **Compiling GPL DSP to WASM and shipping it in dotbeat's web bundle is distribution of a
  derivative-linked work** — the conservative (and FSF-aligned) reading is the entire
  distributed program must be GPLv3. dotbeat "may be productized someday"; a GPLv3 core engine
  forecloses closed-source productization and is incompatible with keeping dotbeat's own code
  under a permissive license *(high as to the mainstream legal reading; no case law is settled
  on WASM-module boundaries specifically — low on any claim that a postMessage/AudioWorklet
  boundary would be treated differently)*.
- **An out-of-process sidecar is "mere aggregation"** — a separate GPL program dotbeat spawns
  and talks to at arm's length (CLI args, files, stdio). Distributing it alongside dotbeat
  requires providing *that program's* source (trivial — it's already public) but does not
  infect dotbeat *(medium — the mere-aggregation doctrine is standard GPL FAQ guidance, but
  "arm's length" is a judgment call; a sidecar whose only purpose is to be dotbeat's synth
  engine is more aggressive than a generic tool)*.
- **Outputs of GPL programs are not GPL.** Audio rendered by a GPL synth carries no code
  copyleft — the *factory shape* (§0) is clean. (Factory *preset/wavetable content* can have its
  own license — flagged per synth below.)

### 2.2 The candidates

| Synth | Emulates | License | Web/WASM port | Headless-hostable | Preset ecosystem | Ceiling evidence |
|---|---|---|---|---|---|---|
| **Dexed** | Yamaha DX7 (6-op FM) | App **GPLv3**; core engine **`msfa` Apache-2.0** *(high — https://github.com/asb2m10/dexed README states exactly this split)* | **Yes, twice**: `webdx7` (**MIT** wrapper over Apache msfa, WAM + AudioWorklet + WASM, https://github.com/webaudiomodules/webdx7) and webDEXED (JUCE-to-WASM port, https://www.webaudiomodules.org/blog/webdexed/) *(high)* | Yes (plugin + the WASM builds) | **The best in class**: loads raw DX7 sysex; "DX7 All The Web" alone is 468 banks / **14,973 patches** (https://bobbyblues.recup.ch/yamaha_dx7/dx7_patches.html) *(high)*; decades of DX7 e-pianos/basses/bells — a canonical house/garage timbre family | The DX7 is on thousands of records; Sound2Synth chose Dexed as its real-world target *(high)* |
| **OB-Xd** | Oberheim OB-X | **GPLv3** *(high)* | **Yes**: `webOBXD` (WAM/WASM/AudioWorklet, Jari Kleimola 2017, https://github.com/jariseon/webOBXD) *(high)*; port license follows GPL upstream *(medium)* | Yes | Moderate (KVR banks) | Classic analog poly — pads/brass; well regarded free emulation *(medium)* |
| **Surge XT** | Original hybrid (subtractive + wavetable + FM + …) | **GPLv3** *(high — https://github.com/surge-synthesizer/surge)*; factory-content licensing was still an open issue (#6741 proposed CC-BY-SA for patches/wavetables; **unresolved at last check** — https://github.com/surge-synthesizer/surge/issues/6741) *(high that it's unresolved)* | **No known WASM port** *(medium — searches found none)* | **Yes, first-class**: `surgepy` Python bindings expose the full synth natively (https://github.com/surge-synthesizer/surge-python, GPL-3.0) *(high)* | **2,779 patches + 614 wavetables** in the factory *(high — Surge site/FAQ)*; active community patch repos | Most feature-complete open synth in existence; active dev team; broadly considered pro-grade *(medium — reputational)* |
| **Vital** | Original (spectral-warping wavetable) | **GPLv3, with paid non-GPL commercial licensing available** (licensing@vital.audio) *(high — https://github.com/mtytel/vital)*. **Factory presets/wavetables are proprietary, NOT in the repo** — forks ship empty; community CC0/CC-BY replacements exist (https://github.com/atsushieno/open-vital-resources) *(high)*. Name is trademarked — forks rename (**Vitalium**, DISTRHO) *(medium)* | No *(medium)* | Fork builds are plugin/standalone; no official headless API *(medium)* | Huge — but the ecosystem is `.vital` presets made for the *proprietary* product; legality of redistribution varies per preset author *(medium)* | The dominant modern free-tier synth; the "Serum-class" sound the reference space actually uses *(medium — reputational)* |
| **Odin 2** | Original (semi-modular virtual analog) | **GPLv3** *(high — https://github.com/TheWaveWarden/odin2)* | No | Plugin formats only | Small | Good free synth, no standout ecosystem *(medium)* |
| **Helm** | Original (subtractive, Vital's predecessor) | **GPLv3** *(high — https://github.com/mtytel/helm)* | No | Plugin/standalone | Moderate, aging | Superseded by Vital in every respect *(medium)* |
| **TAL-NoiseMaker** | Original virtual analog | Old source (v3.x) **GPL** on SourceForge/mirrors (https://github.com/Nexbit/tal-noisemaker); current 4.x/5.x freeware, closed *(medium)* | **Yes**: WAM "NoiseMaker" port exists (https://www.webaudiomodules.org/wamsynths/) *(high that it exists)* | Old source yes | Factory ~300 presets *(low)* | Beloved freeware bread-and-butter VA *(medium)* |

**Vital GPLv3 implications, since the brief asked:** using Vital's DSP inside dotbeat's shipped
engine puts the *entire distributed app* under GPLv3 — every contributor grants GPL rights, no
closed productization, no license mixing with GPL-incompatible code. The escape hatches are (a)
**buy the commercial license** Matt Tytel explicitly offers *(high that the offer exists;
unknown price)*, or (b) use Vital only in the **factory shape** (render assets with a stock
Vitalium build; outputs are clean) — but note the *content* problem cuts the other way: the
famous Vital sound lives in proprietary factory + marketplace presets you don't get with the
source, so open-source Vital is a great engine with an empty patch library.

**Where the ceiling evidence points:** for the showdown's reference space (house/electronica —
research 115's Floating Points / Four Tet / Dom Dolla frame), the two highest-value families are
**DX7 FM** (e-pianos, plucks, basses, bells — permissively available via msfa) and
**Surge-class hybrid** (supersaws, wavetable motion, pro effects — GPL, but factory-shape-safe).

---

## 3. Web-native synthesis platforms

These matter because dotbeat's engine *is* a WebAudio graph (Tone.js in a Playwright-driven
browser session, with an offline-exact render path) — anything that yields an AudioWorkletNode
composes directly.

| Platform | What it is | License | Runs in an existing WebAudio graph? | Maturity | Determinism story |
|---|---|---|---|---|---|
| **Web Audio Modules 2 (WAM2)** | VST-style plugin *standard* for the browser (AudioWorklet + WASM), SDK + host API | Open source SDK/npm modules *(high — https://www.webaudiomodules.com/docs/intro/)*; **each plugin has its own license** (webdx7 MIT, webOBXD GPL…) | **Yes — a WAM instantiates as a node you connect like any other** *(high)* | Standard stable since 2021; 40+ prebuilt plugins in wam-community (https://github.com/boourns/wam-community); academic + hobbyist, not commercial-grade ecosystem *(high)* | As deterministic as the plugin's DSP; OfflineAudioContext rendering of pure-WASM DSP with no `Math.random()`/time inputs should be byte-stable *(medium — inference, must be verified per plugin)* |
| **Faust** | DSP language compiling to WASM/AudioWorklet (`faustwasm`, https://github.com/grame-cncm/faustwasm) | Compiler GPL, **but generated code + library exception lets compiled output be under YOUR license** *(high — Faust libraries carry an explicit exception; faust2webaudio is MIT/GPL2 dual)* | **Yes** — emits AudioWorkletNodes | Very mature (20 yr), huge DSP library incl. filters (Moog ladder etc.), physical models, effects | Pure functions of input; deterministic *(medium-high)* |
| **Elementary Audio** | Declarative JS audio engine, native + web renderers | **MIT since v2.0** *(high — https://github.com/elemaudio/elementary)* | Yes (`@elemaudio/web-renderer` runs its WASM engine inside WebAudio); **has a first-class `@elemaudio/offline-renderer`** (https://www.elementary.audio/docs/packages/offline-renderer) *(high)* | Solid, commercially-backed origin, active | The offline renderer is sample-in/sample-out — the best determinism story on this list *(medium-high)* |
| **Glicol** | Rust graph/live-coding DSP, compiled to WASM | **MIT** *(high — https://github.com/chaosprint/glicol)* | Yes (AudioWorklet) | One-maintainer project; niche *(medium)* | Rust DSP, deterministic in principle *(medium)* |
| **Csound (WASM)** | The 40-year computer-music language in the browser | `@csound/browser` wrapper **Apache-2.0** dynamically loading **LGPL-2.1** `@csound/wasm-bin` — LGPL at a dynamic-load boundary, deliberately structured to avoid copyleft on your app *(high — npm package docs)* | Yes (AudioWorklet-only since v7 beta) | Mature language, beta WASM packaging (7.0.0-beta) *(high)* | Offline rendering is Csound's home turf; deterministic *(medium)* |

**Reading:** none of these *is* a better synth — they are better **substrates**. Their value to
dotbeat is (a) WAM2 as the delivery mechanism for §2's ported synths (webdx7 arrives as a WAM),
and (b) Faust/Elementary as the cheapest way to add specific missing DSP (a real ladder filter,
a plate reverb, a wavetable oscillator) to the *existing* engine under a clean license, without
adopting someone else's whole synth. Sound-quality ceiling is whatever you build — no preset
ecosystems (Faust's library of instrument examples is the closest thing, and it's small).

---

## 4. Hosting real plugins headlessly (VST3/CLAP native sidecar)

The "just use real plugins" option: a small native host process renders MIDI → WAV through
commercial-grade plugins.

- **Tooling:** Spotify **pedalboard** does exactly this from Python (loads VST3/AU, offline
  render) but is **GPLv3** because it embeds JUCE-under-GPL + the Steinberg VST3 SDK
  *(high — https://spotify.github.io/pedalboard/license.html)*. A custom minimal host means
  **JUCE 8 (AGPLv3/commercial dual)** *(high — https://github.com/juce-framework/JUCE/blob/master/LICENSE.md)*
  or the **CLAP** route: CLAP's SDK is pure **MIT** C headers *(high — Bitwig/u-he standard)*,
  so a from-scratch CLAP-only host avoids both JUCE and Steinberg licensing. Surge XT, Odin 2,
  and a growing set of u-he/commercial synths ship CLAP builds *(medium)*.
- **Licensing cost:** as a **sidecar in the factory shape** (renders assets, outputs committed),
  even the pedalboard/GPL route is fine — it's a tool, not a linked library, and dotbeat already
  ships Python ML sidecars (the CLAP-embed sidecar `beat match --no-clap` refers to). Shipping a
  *live* VST3 host inside a product = Steinberg licensing agreement or GPLv3 *(high)*.
- **Determinism: the real killer.** Field reports show plugins are **intentionally
  non-deterministic** — free-running LFOs, random phase/drift on analog modeling; Arturia
  Pigments fails render-twice-identical even on init patches, while Serum passes *(medium —
  Gearspace thread, https://gearspace.com/board/electronic-music-instruments-and-electronic-music-production/1422466-problem-vsts-do-not-render-identically-each-time.html)*.
  Per-plugin behavior is unauditable closed-source. In the live-device shape this breaks
  dotbeat's byte-reproducible render contract outright; in the factory shape it doesn't matter
  (render once, commit bytes).
- **Distribution problem:** dotbeat can never *ship* third-party commercial plugins — the user
  must own/install them. That makes this a power-user integration, not a default sound source.
- **Effort: L** (native host, plugin discovery/state management, per-plugin quirks, packaging).

**Verdict: never as the live engine. Plausible later as an optional factory-shape power tool
("render this track through my installed plugins"), after cheaper avenues are measured.**

---

## 5. The do-nothing-clever baseline: keep the engine, fix presets + production

### 5.1 What the sound-matching literature actually says

- **INSTRUMENTAL** (arXiv:2603.15905 — the paper the T6 harness is built on) matched real
  recorded audio with a **28-parameter subtractive synth + CMA-ES** and found: *more parameters
  do not monotonically improve matching* (past ~29 dims the optimizer exploits extremes — the
  bound T6 already enforces); of **eight tested engine-extension hypotheses, only parametric EQ
  boosting yielded meaningful improvement**; and per this repo's own prior reading (research 107
  §, taste-loop-design), **unison + noise floor was the single biggest lever** — *which dotbeat
  has already added* *(high — abstract fetched this pass, https://arxiv.org/abs/2603.15905, plus
  internal docs)*.
- **Sound2Synth** (IJCAI 2022, https://arxiv.org/abs/2205.03043) got the first "real-world
  applicable" neural preset-inference results on **Dexed** — evidence both that FM spaces are
  matchable and that auto-preset-from-reference is a live technique for whatever engine dotbeat
  lands on *(high)*.
- Combined read: **the marginal synthesis features to add, in evidence order, are (1) a real
  parametric EQ (the only extension INSTRUMENTAL could validate — and research 21 already specs
  openDAW's Revamp as the target), (2) wavetable oscillators (the one source-type gap between
  dotbeat and the Serum/Vital class that defines the reference space; AKWF's ~4,000
  public-domain single-cycle waveforms make content free *(medium — AKWF is widely described as
  public domain, unverified this pass)*), (3) filter character (a nonlinear ladder with drive —
  available as a Faust library one-liner under a clean license), (4) FM depth beyond the
  existing osc-FM field.** Chorus/unison/noise — the classic biggest levers — are already in.

### 5.2 The confound the showdown hasn't isolated yet

Research 115's finding is load-bearing here: the measured gaps vs ref chops are **stereo width
(−52 dB vs −11 dB), air-band energy, and production complexity — not production quality** — and
`genkit.ts` sets **zero** production fields, so every `engine` clip in the showdown was rendered
at dry/mono/static defaults *even though* `unisonWidth`, `chorusMix`, sends, and width tools all
exist. **The 4% number is "default init patch vs finished records," not "engine ceiling vs
finished records."** Until an engine-with-produced-defaults arm runs, no engine-replacement
decision is evidence-based.

### 5.3 Preset quality as the product surface

Every serious synth's value is majority-presets: Surge ships 2,779, the DX7's ecosystem is five
figures, Vital's is a marketplace. dotbeat's preset story (Phase 12 presets + gen-kit) is thin
and — per 115 — never touches the production surface. The do-nothing-clever plan is: per-role
produced preset profiles (115 §6), plus T6's `beat match` used as an **auto-preset factory**
against curated ref chops, building a native preset library with measured distance-to-target.

### 5.4 The adjacent cheap win: sample-based instruments

openDAW's Soundfont device (§1) is a reminder that the biggest timbre ceiling jump available to
*any* engine is playing real recorded samples. dotbeat already has the sampler/keymap path (the
showdown's `keymap` source). SF2/SFZ support would unlock mature free libraries (GM soundfonts,
Versilian, sfz instruments) — players exist at friendly licenses (FluidSynth is LGPL-2.1;
`sfizz` BSD-2 *(medium — licenses from memory, verify before building)*). Not this doc's
question, but it belongs in the same decision frame.

**Effort: S** (produced defaults / showdown arm) to **M** (wavetable osc + parametric EQ + ladder
filter via Faust-generated or hand-written worklet DSP).

---

## 6. Recommendation matrix

| Avenue | Ceiling | License for a future product | Integration into TS/Tone.js + offline render | Determinism | Effort | Verdict |
|---|---|---|---|---|---|---|
| 1. openDAW devices | ≈ current engine (instruments); higher (FX specs) | **AGPL v3** — worst on this list | none (specs only) | n/a | n/a | **Mine specs, never code** (standing rule) |
| 2a. webdx7 / msfa (DX7 FM) as live device | High for FM family (e-pianos, plucks, bass, bells) | **Apache-2.0 core + MIT port — the only clean live-device candidate** | WAM AudioWorklet node in the existing graph; offline ctx to verify | Likely; must verify byte-stability | **M** | **Best live-device bet; gate on §7 results** |
| 2b. Surge XT via surgepy | High, broad (VA + wavetable + FM), 2,779 patches | GPLv3 → **factory shape only** (sidecar tool; outputs clean); factory-content license unresolved — treat rendered presets as private/eval-only until clarified | out-of-process render → WAV assets (existing Python-sidecar precedent) | Solved by committing assets | **S** | **Do first — the cheapest ceiling probe (§7)** |
| 2c. Vital/Vitalium | Highest "modern" ceiling *if* you have the presets — which open forks don't | GPLv3 (commercial license purchasable); content proprietary | none existing; large | unknown | **L** | **Skip unless later evidence demands Serum-class; then price the commercial license** |
| 2d. OB-Xd / Odin 2 / Helm / TAL | Good VA, nothing unique | GPL(v3) | webOBXD exists (GPL) | unknown | M | **Skip — dominated by 2a/2b** |
| 3. Faust / Elementary / WAM2 substrate | Whatever you build; no presets | Clean (generated-code exception / MIT) | Native fit (AudioWorklet); Elementary even has an offline renderer | Good | S per DSP block | **Adopt as the mechanism for §5.1's targeted DSP additions, not as a synth** |
| 4. VST3/CLAP native sidecar | Highest absolute (commercial plugins) | Host buildable clean via CLAP/MIT; plugins not shippable | sidecar, factory shape only | **Bad live; fine as assets** | **L** | **Defer; optional power-user tool later** |
| 5. Keep engine: produced defaults + presets + EQ/wavetable/filter | Unknown — *that's the point of measuring* | Clean (all in-house) | Already integrated | Already byte-exact | **S–M** | **Run the 115 defaults arm now; it de-confounds every other row** |

## 7. Cheapest first experiment — exactly what to plug into `beat showdown`

The showdown already accepts any source that yields a loudness-/duration-matched WAV per role
with provenance in the manifest (`docs/source-showdown-eval.md` §"How a batch is built"). Add
**two new source kinds** and run one real batch series per role:

1. **`surge`** (effort S): a ~100-line Python sidecar using `surgepy` — load Surge XT factory
   patches filtered by role-appropriate categories (Basses / Keys / Pads / Leads), play the
   *same seed phrase* the `engine` source solos (notes are already available at batch-build
   time), render offline to WAV, hand back like the `gen` backend does. Deterministic enough
   for an eval; GPL confined to a dev-side tool; factory-patch content stays out of git (same
   private posture as ref chops) until Surge's content-license issue resolves. Optionally a
   second variant using **Dexed patches through a headless Dexed/msfa render** for the FM
   family. *This directly answers: "does a pro-grade patch library through a pro-grade engine
   beat our engine — and does it beat fal?"*
2. **`engine-produced`** (effort S, from research 115): the identical engine render but with
   the per-role produced-defaults profile applied (unison width, chorus, sends, width/air
   moves). *This answers: "how much of the 4% was defaults, not engine?"*

Decision rule: if `engine-produced` closes most of the gap → invest in §5 (presets + EQ +
wavetable + filter; Faust/Elementary substrate). If `surge`/FM wins decisively even against
`engine-produced` → the engine itself is the ceiling, and the live-device path (webdx7 first,
license-clean) plus a factory-shape Surge preset pipeline is justified. If `gen`/`keymap` still
beats both → keep spending on the sample/generation pipeline, not synthesis.

## Honest gaps

- Surge factory-content licensing was verified *unresolved*, not resolved-unfavorable — re-check
  issue #6741 before shipping any Surge-rendered preset publicly.
- `surgepy`'s exact offline-render API and its determinism were not verified hands-on this pass
  *(the repo confirms the bindings exist and are GPL-3.0; the api-tutorial notebooks were not
  fetched)*.
- webdx7's byte-determinism under OfflineAudioContext is inferred, not tested; it's also
  explicitly "work-in-progress" (27 commits, no releases) — budget for adoption/maintenance.
- No listening evidence was gathered that DX7/Surge timbres beat fal output for *this* owner's
  taste — that is precisely what the §7 showdown run exists to measure.
- AKWF public-domain status, sfizz/FluidSynth licenses, and openDAW-headless capabilities are
  from memory/single mentions *(medium/low)* — verify before building on them.

## Sources

- openDAW: https://github.com/andremichelle/openDAW (AGPL v3 dual-license, README);
  https://github.com/andremichelle/opendaw-headless; internal: `docs/opendaw-notes.md`,
  `docs/research/21-opendaw-devices-effects.md`
- Dexed / msfa: https://github.com/asb2m10/dexed (GPL v3 app, Apache-2.0 msfa);
  https://github.com/webaudiomodules/webdx7 (MIT port, fetched);
  https://www.webaudiomodules.org/blog/webdexed/ ; DX7 patches:
  https://bobbyblues.recup.ch/yamaha_dx7/dx7_patches.html (14,973 patches),
  https://github.com/visualizersdotnl/Yamaha-DX7-patch-library
- OB-Xd web port: https://github.com/jariseon/webOBXD ; https://www.webaudiomodules.org/wamsynths/obxd
- Surge XT: https://github.com/surge-synthesizer/surge (GPL3);
  https://surge-synthesizer.github.io/ (2,779 patches / 614 wavetables);
  https://github.com/surge-synthesizer/surge-python (surgepy, GPL-3.0, fetched);
  https://github.com/surge-synthesizer/surge/issues/6741 (content licensing, fetched — open)
- Vital: https://github.com/mtytel/vital (GPLv3 + commercial licensing note);
  https://github.com/atsushieno/open-vital-resources ;
  https://linuxmusicians.com/viewtopic.php?f=48&t=23764
- Odin 2: https://github.com/TheWaveWarden/odin2 ; Helm: https://github.com/mtytel/helm ;
  TAL-NoiseMaker source mirror: https://github.com/Nexbit/tal-noisemaker
- WAM2: https://www.webaudiomodules.com/docs/intro/ ; https://www.webaudiomodules.org/wamsynths/
  (fetched — webDX7, DEXED, OBXD, yoshimi, NoiseMaker); https://github.com/boourns/wam-community
- Faust: https://github.com/grame-cncm/faust ; https://github.com/grame-cncm/faustwasm ;
  https://github.com/grame-cncm/faustlibraries (generated-code license exception);
  faust2webaudio MIT/GPL2: https://github.com/grame-cncm/faust2webaudio
- Elementary: https://github.com/elemaudio/elementary (MIT);
  https://www.elementary.audio/docs/packages/offline-renderer
- Glicol: https://github.com/chaosprint/glicol (MIT)
- Csound WASM: https://www.npmjs.com/package/@csound/browser (Apache-2.0 wrapper, LGPL-2.1 bin)
- Plugin hosting: https://spotify.github.io/pedalboard/license.html (GPLv3);
  https://github.com/juce-framework/JUCE/blob/master/LICENSE.md (AGPLv3/commercial);
  CLAP MIT + https://github.com/free-audio/clap-juce-extensions
- Plugin render non-determinism: https://gearspace.com/board/electronic-music-instruments-and-electronic-music-production/1422466-problem-vsts-do-not-render-identically-each-time.html
- Sound matching: https://arxiv.org/abs/2603.15905 (INSTRUMENTAL, abstract fetched);
  https://arxiv.org/abs/2205.03043 (Sound2Synth); internal: `docs/t6-sound-matching.md`,
  `docs/research/107-taste-model-program.md`, `docs/research/115-production-layer-techniques.md`,
  `docs/source-showdown-eval.md`
