# Research 132 — sound-source expansion: the shortest path to a clip the owner ranks with a Splice loop

*2026-07-26. Commissioned off the current showdown standings (Splice pack refs ~68–93% pairwise,
fal-gen ~74–83%, engineplus ~53%, surgeplus ~50%, surge ~44%, keymap ~38%, raw engine ~20%) and the
owner's directive, verbatim: "I really want you to figure out how you (the agent) can use dotbeat
to generate clips that I rank as good as splice clips." Every candidate source below is judged by
exactly one criterion: **would a clip made with it plausibly be ranked alongside a Splice pack loop
in a blind 5–7-way batch by this owner** — and ranked by time-to-parity, not capability breadth.
Method: (a) repo-data mining — the full 250-entry scores log re-tallied with era/figure-source/
head-to-head splits, batch manifests, the surge sidecar + curation code, and the on-disk Surge
factory content; (b) three parallel web passes (open synths / sampler paths / plugin hosting) with
per-claim confidence: **(high)** = primary source fetched or 2+ independent agreeing sources,
**(medium)** = one source, **(low)** = inference. Repo-side claims cite file paths and are (high)
unless noted. Companions: research/114 (the original synth survey), 120 (eval refs), 127 (gen
bake-off), `docs/source-showdown-eval.md`, `docs/surge-track.md`, `docs/engine-presets.md`,
decisions D23–D27. Research 131 (parallel gap analysis) did not exist in `docs/research/` at
writing time; research **134** (patch design at scale) and 135 landed from parallel sessions
mid-pass — 134 reaches the same structural conclusion independently ("a patch must mean a
produced multi-layer track stack, not a synth param bag") and its measurements are cited where
they corroborate. Research only — no code changes.*

## Headline answers

1. **Surge underperforms because of the harness around it, not the synth in it — five named,
   fixable defects.** The eval draws from 18% of the patches on disk (639 factory; 2,920
   third-party `.fxp` sit unenumerated beside them), the role filters then exclude the most
   loop-relevant categories (104 Polysynths, 45 Sequences, the 8 literal "Chords" patches),
   curation squeezes what's left to 14–16 patches/role, the sidecar never tells Surge the
   project tempo (every tempo-synced LFO/delay/arp in a patch free-runs at the default), and the
   clip is rated as a dry solo synth line against loops that are produced, layered program
   material. When ONE of these is controlled — commercial MIDI figures instead of bank figures —
   surge-lead jumps to **69% pairwise, within 2 points of gen (71%)**. The synth is fine. §2.
2. **"Sampled vs synthesized" is NOT the gap. "Born produced vs rendered dry" is.** fal-gen is
   synthesized (by a neural model) and sits at 74–83% because its output *arrives sounding like a
   produced stem* — the same reason pack loops win. Direct head-to-heads since the clean-methodology
   cutoff: gen beats surge **78%** (n=45) and beats keymap **87%** (n=91), while gen loses to
   pack/ref loops only 66:34. Meanwhile keymap — actual sampled audio — sits at 31–38% because the
   sampler machinery plays one speed-repitched one-shot with no layers, loops, or articulation.
   Sampling per se buys nothing; production and sound-design density buy everything. §1, §3.
3. **The shortest path to parity is not a new synth — it is (a) surge-v2 (fix the five defects),
   (b) a ref-matched production pass fitted to the measured pack-loop feature targets instead of
   hand-tuned constants, and (c) a layered-composite arm that renders a clip the way a pack loop is
   actually made (2–3 sound layers + chain), with new *sources* (plugin-host sidecar, SFZ sampler)
   entering only through that pipeline.** Candidate-source details and ranking in §4–§5.
4. **First two experiments, both expressible as showdown arms today:** `surge2` (full-pool +
   tempo-synced + ref-matched production + theory/midi figures) and `composite` (bass example:
   engine sub layer + surge mid layer + one-shot top, produced to the pack-bass feature targets).
   Concrete definitions in §5.

---

## 1. The target, quantified: what a Splice loop is to this eval

The refs-packs pool (165 role-sorted WAVs, e.g. Toolroom `T_TSSK_128_synth_loop_bunny_Dm.wav`)
holds 87% pairwise overall — and per the current standings 68–93% by role. Feature-mining the
scores log (all recent-era rated batches since 2026-07-23, `beat-scores.jsonl` features block)
gives the concrete production profile a competitive clip must hit:

**All pitched+drum roles pooled (means, n = clips rated per kind):**

| kind | n | crest dB | width dB | corr | air % | presence % | sub % |
|---|---|---|---|---|---|---|---|
| ref (all pools) | 95 | 15.4 | −30.1 | 0.75 | **2.3** | 4.2 | 19.1 |
| gen | 110 | 16.2 | −33.5 | 0.83 | 1.9 | **7.2** | 10.8 |
| surge | 48 | 14.3 | −24.7 | 0.85 | **0.7** | 5.6 | 8.2 |
| surgeplus | 39 | **11.1** | **−17.3** | 0.67 | 1.0 | 6.4 | 11.9 |
| engineplus | 110 | 12.3 | −11.6 | 0.86 | 0.8 | 1.9 | 10.0 |
| keymap | 110 | 15.6 | −33.3 | 0.88 | 2.8 | 3.6 | 20.2 |
| engine | 110 | 13.8 | −52.3 | 0.99 | 0.2 | 0.7 | 6.5 |

**Bassline role only (the role where surge fails hardest):**

| kind | n | sub % | bass % | crest dB | width dB |
|---|---|---|---|---|---|
| ref | 26 | **47.1** | 33.9 | 12.2 | −48.6 |
| gen | 31 | 19.3 | 76.5 | 13.1 | −55.0 |
| keymap | 31 | 45.3 | 54.0 | 11.5 | −49.9 |
| surge | 14 | 28.1 | 60.6 | 14.8 | −53.0 |
| surgeplus | 13 | 34.7 | 60.2 | **8.3** | **−39.7** |
| engineplus | 31 | 3.1 | 85.9 | 10.2 | **−11.8** |

Three readings, each load-bearing for everything below:

- **Pack loops are professionally *mix-placed*, not just professionally *synthesized*.** A pack
  bass loop is nearly mono (−48.6 dB width), sub-dominant (47% of energy below ~60 Hz), and dense
  (crest 12.2). A pack lead/chords loop carries ~3× surge's air-band energy. These are mixdown
  decisions — a compressor, a sub-management strategy, an air shelf — not oscillator quality.
- **The current production passes are miscalibrated in both directions.** `engineplus` renders
  bass at −11.8 dB width (wildly wide where the target is mono) with 3% sub (target 47%);
  `surgeplus` overshoots width on pitched roles (−17.3 vs ref −30.1) and crushes crest to 8.3–11.1
  (over-saturated) — hand-tuned constants in `surgeplusProfile`/the produce.ts profiles, never fit
  to the measured targets sitting in the same log. The twin problem was fixed by turning knobs UP,
  and the data says it went past the reference on the axes it turned.
- **gen's 74–83% is the proof of what matters.** Stable Audio 3 output is synthesized, but trained
  on finished music — it arrives with layering, air, groove and space baked in ("born produced").
  It is the only non-ref source whose feature row sits next to ref's on nearly every axis. The
  lesson is not "use more AI"; it is that the eval rewards *finished stems*, and every dotbeat
  source that renders a naked patch is competing in the wrong weight class.

## 2. Why surge underperforms gen — the diagnosis

A world-class synth at 44–50% against a text-prompt generator at 74–83% is a harness problem
until proven otherwise. Working through the actual pipeline (`src/taste/showdown.ts`,
`python/surge_render.py`, `scripts/curate-surge-patches.mjs`, `presets/surge-curated.json`, the
on-disk factory content, and the log's own splits), five defects, each with evidence:

### 2.1 Patch pool: the eval sees 18% of the patches on disk, and the wrong 18% for loops

`surge_render.py` `_patches_root()` enumerates **only `patches_factory/`** — 639 `.fxp`. The same
`resources/data` dir on the owner's machine carries **`patches_3rdparty/` with 2,920 `.fxp`**
across 37 designer collections, never enumerated (repo-verified: `~/Documents/dotbeat/tools/surge/
resources/data`). Research 114's "2,779 patches" headline was the marketing total; the eval never
saw most of it. Within the factory pool, `SURGE_ROLE_CATEGORIES` maps bassline→Basses (**59
patches**), chords→Pads+Keys (81), lead→Leads+Plucks (242) — excluding **Polysynths (104)**, the
single category most like house stab/chord material, the literal **Chords category (8)**, and
**Sequences (45)**, which are exactly the arp/motion patches a lead loop wants (they need tempo
sync — see 2.3 — which is presumably why they were skipped). D26-era curation then keeps the top
quartile: **bassline 14, chords 16, lead 16 patches**, so the entire surge arm's timbral diversity
is ~46 sounds, with visible repeats in the rated batches (the same patch appears up to 3× across
72 surge clips — a recognition/fatigue channel the blind design otherwise works hard to close).

### 2.2 Patch suitability: showcase sounds, curated by a probe that penalizes exactly what loops need

Factory patches are keyboard-demo sounds: designed to impress played by hand, with long releases
and wide internal FX — not to sit in a 4-bar mix-ready loop. The measured symptom: surge clips
carry **0.7% air-band energy vs ref 2.3%** (and 0.0% on bassline). Part of that is the curation
loop itself: the ring gate (`ringDb > −32` rejects) plus the aes-blend probe demonstrably **gated
out the bright leads** (`docs/engine-presets.md` notes 242 lead candidates → 62 survivors, "bright
factory leads on the high probe ring by the narrow-peak metric") — the screen built against the
pre-fix comb-artifact era is now removing the patches that would carry the air band the refs win
on. Research 134, running in parallel, measured this directly on the engine side: **the same ring
gate fails 22% of the owner's own Splice lead loops** — the gate rejects the quality bar itself
(high — 134 §2). And the curation probes (a held triad, a 4-note motif) score patches on
*sustained-tone prettiness*, not on "does this sound like a loop stem" — there is no
crest/sub/width term aimed at the §1 targets.

### 2.3 The rendering contract: Surge never learns the tempo, and plays one dry pass

`surge_render.py` `render()` creates the synth, loads the patch, plays the note list, renders with
a fixed 1.5 s tail — and **never sets a host tempo**. Every tempo-synced element in a factory
patch — synced LFOs, synced delays, the entire Sequences category — free-runs at surgepy's default
rather than locking to the batch's 120–128 BPM grid, so any patch with synced motion renders
subtly (or grossly) off-groove. Verified against the owner's actual build this pass **(high)**:
the surgepy instance exposes **no tempo API whatsoever** (`dir()` probed — no
`setTempo`/`bpm`/`time` member exists), so this is not a missed call in `surge_render.py`; the
binding itself cannot express tempo today — and the upstream source confirms it:
`src/surge-python/surgepy.cpp` on `main` hard-codes `surge->time_data.tempo = 120;` in
`createSurge()` and binds nothing tempo-related **(high — upstream file fetched this pass)**. So
every surge clip ever rated rendered its synced modulation at 120 BPM regardless of the batch
tempo. The binding *does* expose `setParamVal`, `setModDepth01`,
`pitchBend`, and `channelController` — meaning per-block parameter automation (filter rides, macro
sweeps) is available right now with zero upstream work. Beyond tempo: one patch, one pass, no
per-note articulation, no pitch bend, no filter/macro automation over the phrase, no velocity
curve shaping, no humanization — a static MIDI-file audition of a preset. A pack loop has motion
*composed into the audio*: fills, mutes, filter rides, sidechain pump.

### 2.4 Production: rated dry, and the produced arm is calibrated by hand, not by reference

Raw `surge` is scored with zero production (by design — it isolates timbre), so it competes
against finished stems as a naked patch; that alone caps it near the middle of the board.
`surgeplus` exists to fix this but its profile is a set of hand-tuned constants (chorus 0.55,
utility width 0.85, autopan, saturator 0.3/0.4, reverb 0.42, +5 dB air) that the feature data
shows overshooting width (−17.3 vs target −30) and crushing crest (8.3 on bass vs target 12.2),
with **no compressor** (the one universal pack-loop treatment) and no per-patch adaptation. Its
head-to-head record vs plain surge since the twin-fix is a coin flip overall (surge beats
surgeplus 54% of 26) while in the newest theory-figure batches surgeplus 58% > surge 15% (n=9,
smoke) — i.e. the pass sometimes helps and sometimes audibly overcooks, exactly what un-referenced
constants would do.

### 2.5 Composition: half the gap for lead/chords, none of it for bass

The figure-source split since 2026-07-23 is the cleanest causal evidence in the log. With
commercial MIDI figures, per role: **lead — surge 69% ≈ gen 71%** (ref 87%); **chords — surge 53%**
(gen 80%, ref 88%); **bassline — surge 23%** (gen 88%, ref 77%). So: for lead, composition quality
was most of the surge-vs-gen gap and the remaining deficit is small; for chords it is roughly half;
for bassline, composition barely moves it — surge bass fails on *sound*: 28% sub energy vs the
refs' 47%, zero air, no compression/saturation density, and a curated pool of 14 showcase bass
patches. Overall (all roles, midi figures): surge 53% vs gen 79% vs ref 85%.

### The fix list, in expected-impact order (all S–M effort, no new architecture)

1. **Add a tempo binding and pass the batch BPM** (S): `surgepy.cpp` hard-codes
   `time_data.tempo = 120` at creation and the member is public — a ~3-line pybind addition to
   the existing source build at `~/Documents/dotbeat/tools/surge`, the same local-patch posture
   as the `getOutput()` stride fix (which has an upstream-issue draft precedent) **(high that the
   binding is trivial — upstream source read; the patch itself is not yet written)**. The
   alternative shipped mechanism is `surge-xt-cli` (headless, OSC+MIDI, in the macOS bundle since
   XT 1.3) if driving the full synth beats extending the bindings. Until either lands, restrict
   the pool to non-synced patches or accept the mistiming knowingly.
2. **Enumerate `patches_3rdparty`** (S): 639 → 3,559 candidates; extend `SURGE_ROLE_CATEGORIES`
   with Polysynths/Chords→chords, Sequences→lead (post-tempo-fix). Licensing posture unchanged —
   the third-party content carries the same unresolved GPL-umbrella ambiguity as the factory set
   (no separate license files in `resources/data`, #6741 still open as of 2024-05 — high, both
   verified this pass), so renders stay gitignore-gated exactly as today (D23).
3. **Re-curate against the §1 targets** (M): re-run curation with the probe scored partly on
   distance-to-ref-feature-targets per role (sub%, air%, crest, width) instead of pure aes-blend;
   drop or recalibrate the ring gate post-stride-fix so bright leads survive; probe at the
   project tempo.
4. **Ref-matched production** (M): replace `surgeplusProfile`'s constants with per-role targets
   *measured from refs-packs* (the numbers are already in the log — §1's table IS the spec), add
   the compressor, and iterate until the produced clip's feature row lands inside the ref
   distribution rather than past it. This is a new named profile beside the frozen one, never an
   edit (CLAUDE.md frozen-science rule).
5. **Motion** (M): one filter-cutoff or macro ride per phrase (the `override` mechanism already
   exists in `docs/surge-track.md`; extending it to a 2-point ramp is a sidecar-arg change), and
   velocity-shaped MIDI from the theory layer.

Prediction, stated so the experiment can falsify it: fixes 1–4 move surge-lead and surge-chords
into the gen band (70–80%) and surge-bassline to ≥50%; if they do not, the residual is genuine
timbre and the plugin-host path (§4.4) is the escalation.

## 3. The sampled-instrument hypothesis, and why keymap sits at 38%

The hypothesis to test was "commercial loops are recordings of real/sampled instruments through
real chains — how much of the gap is sampled-vs-synthesized?" The eval's own data answers: **less
than it looks.** keymap IS sampled audio (a fal one-shot) and scores 31–38%; gen is synthesized
end-to-end and scores 74–83%. On bassline, keymap's *timbre* matches the refs almost exactly
(sub 45.3% vs 47.1% — the best timbre match of any source) and it still loses 2:1, because
everything around the timbre is missing. Diagnosis of the keymap arm (`src/taste/showdown.ts`
`buildPitchedKeymapPhrase`, `src/core/keymap.ts`, `ui/src/audio/engine.ts`):

- **Speed-based repitch across ±24 semitones.** A lane's `tune` maps to
  `playbackRate = 2^(tune/12)` — the chipmunk/mud transform. A phrase spanning an octave plays
  the same one-shot at up to 2× speed difference: duration halves/doubles with pitch, transients
  sharpen/smear, formants shift. Commercial sample instruments re-sample every few semitones
  precisely to avoid this; keymap stretches ONE sample across the whole span.
- **Root-detection fallback.** Low-confidence pitch detection falls back to the
  strongest-low-partial guess and proceeds (documented in `docs/source-showdown-eval.md`) — a
  wrong root makes the whole instrument systematically out of tune with the batch, and nothing
  downstream checks.
- **No sustain loops, no velocity layers, no round-robin.** A decaying one-shot either truncates
  or rings identically on every hit; every note is the same byte-for-byte sample — the machine-gun
  effect the sampler literature spent 30 years engineering away.
- **One-shot quality lottery.** The source is a single fal one-shot per batch, prompt-tier
  `bass`/`stab`/`pluck` — sometimes great, sometimes mediocre, never auditioned before rating.

What "an actual sampled instrument" takes, given this machinery already exists: **multi-zone
keymaps** (N one-shots at spaced roots — even 3 per octave kills the worst repitch artifacts;
fal can generate the same subject at specified pitches, or one one-shot can be offline-repitched
in small steps by a sidecar), root *verification* (render one lane, re-detect, refuse on
mismatch), and loop-point detection for sustained roles. That is an S–M upgrade to an existing
source, versus adopting a full SFZ engine — and the SFZ route (§4.3) is the escalation if
multi-zone keymap still reads as "a sample, not an instrument."

The honest overall estimate: of the ~40-point pairwise gap between surge/keymap and the refs,
the repo's own controlled splits attribute roughly **half to composition** (closed by midi/theory
figures for lead, partially for chords), most of the remainder to **production/mix-placement**
(the §1 feature deltas — width, air, crest, sub, compression — all reachable with existing or
cheap tools), and a **minority residual to raw source timbre** — concentrated in bass, where both
the surge factory pool and the engine genuinely lack the sub-forward, saturated character of a
produced pack bass. "Sampled material" is one way to buy that residual; it is not the main gap.

## 4. The candidate-source survey, with 2026 eyes

Judged strictly by the owner's criterion — could clips made with it get ranked next to Splice
loops — with license, headless-macOS feasibility, patch-bank reality, and integration cost given
the surge-sidecar precedent (a JSON-contract Python/CLI sidecar in the existing 8-sidecar fleet,
D23's factory shape).

### 4.1 Open synths renderable out-of-process (the Surge-sidecar shape)

The 2026 landscape reshuffles 114's table meaningfully — two projects revived, one died, two new
ones appeared, and only Surge has first-class offline bindings; everything else renders through a
generic offline plugin host (§4.4), which is why that host is a *prerequisite* for most of this
table, not an alternative to it.

| synth | family it adds | code license | headless path (macOS) | patch bank | verdict for the owner's criterion |
|---|---|---|---|---|---|
| **Surge XT** (incumbent) | already in | GPLv3; content license still ambiguous (#6741 **open**, last activity 2024-05, high) | surgepy (built) + **`surge-xt-cli`** (headless OSC+MIDI, ships in the macOS bundle since XT 1.3, high) | ~2,800 patches total; 3rd-party is the larger share and carries the same GPL-umbrella ambiguity (medium) | fix the harness (§2) before judging the synth |
| **Dexed / msfa** | FM: e-pianos, FM bass, bells, plucks — canonical house timbres | Dexed GPLv3; **msfa core Apache-2.0** (high) | no CLI; host the VST3/CLAP offline (§4.4), or embed the small GUI-free msfa core (high) | the DX7 sysex universe — "All The Web" ~200k patches (dedupes to low thousands of banks, medium); legal status: tolerated gray zone, no formal licenses (medium) | highest content-value per integration dollar of any new synth; render-only posture for gray banks |
| **OB-Xf** (NEW 2025 — Surge Synth Team relaunch of OB-Xd) | Oberheim analog poly — the warm stab/brass/string chords deep house runs on | GPL3 (high) | AU/VST3/LV2/CLAP + standalone; no CLI — offline host (high) | **300+ new presets by professional sound designers** (high) | the strongest *fresh, purpose-designed* preset bank in open synths; directly aimed at the chords role's deficit |
| **Vital / Vitalium** | spectral-warping wavetable — the modern Serum-class palette | GPLv3; **factory presets explicitly not redistributable**; upstream stale (last push 2023-05, high) | Vitalium has a `plugin-headless` DSP-only build option but no render CLI; JUCE-7 breakage noted by KXStudio, unresolved (medium); macOS ARM unproven (low) | open content is tiny (open-vital-resources: 3 small CC0/CC-BY collections, high); the real bank is proprietary; commercial license still purchasable ($25–80 tiers, medium) | great engine, empty open library, shaky fork — **demoted from 114's "highest ceiling" slot**; revisit only via a paid Vital + owner-bought preset packs, render-only |
| **Odin 2** (revived: v2.4.0, 2025) | semi-modular VA | GPLv3 (high) | AU/VST3/LV2/CLAP; offline host (high) | small | alive again but content-poor; dominated by OB-Xf |
| **ZynAddSubFX / Yoshimi** | additive/pad-machine — lush pads, organs, choirs | GPL-2.0+; **1,100+ instruments in-repo under the same unambiguous GPL** (high) | `--no-gui` + OSC exists but no MIDI-file→WAV batch mode; practical path = LV2/VST plugin in an offline host (medium) | the largest *unambiguously-licensed* bank in this table | best license-clean content volume; timbre family is pads/textures, a secondary role for house |
| **Cardinal** (VCV fork) | modular/generative, acid patches | GPLv3+, self-contained, macOS universal (high) | headless build exists (Linux); realistic path = its VST3/CLAP in an offline host + Host-MIDI module (medium) | Patchstorage: ~205 patches, per-upload licenses (high) | flexibility high, preset economics weak — patches aren't playable programs; skip for now |
| **Six Sines** (NEW 2025–26, baconpaul) | TX81Z-style 6-op FM + CZ phase distortion | **MIT** — the cleanest license of any synth here (high) | AU/VST3/CLAP, macOS ARM, active; offline host (high) | ~40 factory presets (high) | small bank but MIT means it is the one synth whose *engine* could someday go live-device without a license conversation |
| **Vaporizer2** (open-sourced 2023) | hybrid wavetable + sampler | GPLv3 (high) | AU/VST3/CLAP/LV2; offline host (medium) | **410+ presets, 780+ wavetables** shipped free, GPL-umbrella content (high count, medium license clarity) | the largest open wavetable bundle — the honest replacement for what Vital was supposed to supply |
| Helm | — | GPLv3, **repo archived 2022** (high) | — | — | dead; skip |

### 4.2 Synthesis-family coverage check

Families dotbeat currently has zero or weak coverage of, and whether any candidate above closes
them: **FM beyond DX7** — Six Sines (TX81Z-style, MIT) plus the DX7 banks cover it; **wavetable
done properly** — Vaporizer2 (open content) or paid Vital (closed content), both via the offline
host; **analog poly chords** — OB-Xf, directly; **additive/pads** — ZynAddSubFX; **granular and
physical modeling** — no open candidate with a real preset economy surfaced (RipplerX exists for
physical modeling, medium, content-thin); granular texture is currently *better served by gen*
(texture prompts) than by any open synth, and physical-modeling timbres (mallets, plucked strings)
are better bought as CC0 samples (§4.3) than synthesized. No family gap justifies an integration
on its own under the owner's criterion — content quality and production, not family coverage, is
what the eval pays for.

### 4.3 Sampler paths — the "actual sampled instrument" route

The headless render story is solved and license-clean; the *content* story is the constraint.

- **sfizz (`sfizz_render`)** — BSD-2-Clause; the CLI renders `--sfz + --midi → --wav` offline,
  exactly the sidecar shape dotbeat already runs **(high — man page + repo fetched)**. One flag:
  **the sfizz repo was archived read-only 2026-06-21** (high) — it works today (last release
  1.2.3), but vendor/pin it and expect no fixes (one open issue reports sustained-pedal-like
  rendering on some content, medium). This is the only real headless SFZ path on macOS; liquidsfz
  (MPL-2.0) is a realtime JACK client with no offline render (medium), and sforzando / Decent
  Sampler are proprietary GUI freeware with no CLI (medium — absence of evidence).
- **FluidSynth** — LGPL-2.1, actively maintained (v2.5.7 released 2026-07-25, high), and
  `fluidsynth -F out.wav font.sf2 file.mid` is a supported faster-than-realtime render path
  (high — man page). The catch: free SF2 content skews GM/orchestral/retro; little of it is
  Splice-competitive (medium/low).
- **ConvertWithMoss v19 (2026-07, active)** — the glue tool that changes the calculus: converts
  multisamples among WAV / Bitwig `.multisample` / SFZ / SF2 / DecentSampler / Kontakt / EXS etc.
  (high — manual fetched), so any legally-convertible library normalizes into sfizz/FluidSynth
  input.
- **Content tiers (the real bottleneck):**
  - *Repo-committable, pro-leaning:* **Karoryfer Samples** (CC0-1.0, explicitly including format
    conversion and redistribution — their basses are genuinely usable for electronic material,
    high on license / medium on quality), **VCSL/Versilian** (CC0, incl. percussion, bells, TX81Z
    electrophones, high), **Salamander Grand** (CC-BY-3.0 SFZ, 16 velocity layers — the classic
    house-piano source, high), curated **Freesound CC0**, Signature Sounds CC0 packs (medium,
    single source).
  - *Render-only (outputs fine in music; sources never committed):* Pianobook (EULA: commercial
    music yes, redistribution no — high), Greg Sullivan e-pianos (informal permission, medium),
    Cymatics free packs / MusicRadar SampleRadar (royalty-free, no redistribution — medium), and
    essentially all free Juno/SH-101/Moog multisample packs (informal licensing, medium) — same
    private posture as the surge factory renders.
  - *Eval-listening only:* **Splice itself — its ToS grants use in "New Recordings" but bars
    sublicensing sounds in isolation, redistribution, and explicitly "Sounds as source or training
    material for generative or other types of artificial intelligence models" (high — terms
    fetched)** — which re-confirms D25's critic-training exclusion (already implemented in
    `src/taste/eval.ts` `trainable()`, repo-verified).
- **What this buys against the actual gap:** for house/electronica the sampled-instrument wins
  are concentrated in a few timbres — piano stabs (Salamander), e-piano/Wurli (Greg Sullivan /
  Pianobook, render-only), organ bass, and Karoryfer's basses. It does NOT solve the bass-role
  deficit by itself (a pack bass is a *produced* bass, §1) and everything rendered through sfizz
  still needs the same ref-matched production pass as surge. Integration cost: S — `sfizz_render`
  is closer to a drop-in than surgepy was (no source build; MIDI-file input the midifig/theory
  layer can already emit).

### 4.4 Plugin hosting in principle — yes, license-clean, and cheaper than surgepy was

D23's line — GPL tools may run as out-of-process sound factories whose outputs carry no copyleft;
the live-embed ban stands — covers this shape exactly, and 2026 tooling makes it an S–M
integration rather than 114's estimated L:

- **pedalboard (Spotify)** — GPLv3, actively shipped (v0.9.24, 2026-07-08), macOS arm64 wheels,
  Python 3.10–3.14 **(high — PyPI/README fetched)**. Since v0.7.4 it hosts **instrument** VST3/AU
  plugins: `load_plugin(...)` then call with MIDI messages + duration → numpy audio (high — API
  reference fetched). `pip install pedalboard` into the existing sidecar venv is near-zero
  integration cost. Crux: preset loading — `.vstpreset` works, `.fxp` is flaky per-plugin
  (Serum reported broken, medium), no full state round-trip (medium).
- **DawDreamer** — GPLv3 (JUCE-based), repo active through 2026-02 but last PyPI wheel v0.8.3
  (2024-09, py3.10–3.12) **(high)**. Uniquely strong preset story: `load_preset` (.fxp),
  `load_vst3_preset`, and **full `save_state`/`load_state`** round-trip, plus real parameter
  automation at audio rate (high — docs fetched). The fallback when pedalboard's preset loading
  fails for a given synth.
- **REAPER `-renderproject`** — proprietary, owner-licensable (~$60); CLI-renders a plain-text
  generated `.rpp` (plugin state embedded as base64) through ANY installed VST3/AU/CLAP; no
  output-use restriction found (high on capability, medium on EULA nuance). The compatibility
  backstop for plugins JUCE-based hosts mis-handle; needs a GUI session on macOS (medium).
- **CLAP**: SDK is MIT (high) but **no maintained offline CLAP render host exists** (high —
  clap-host is a Qt GUI example); a purpose-built host is license-clean but build-it-yourself.
  **Plugalyzer** (GPL-3.0 CLI, VST3/AU/LV2, MIDI-file in, `--preset`, state import/export, JSON
  keyframe automation) is the shell-out alternative to the Python libs — source build, moderate
  activity (high on features, medium on maintenance).

What plugin hosting is FOR, per the owner's criterion: it is the **one integration that unlocks
the whole §4.1 table at once** — Dexed's DX7 banks, OB-Xf's 300 pro presets, Vaporizer2's
wavetable bundle, Six Sines, Odin 2 — plus **the owner's own commercial plugins** if any get
bought later (Serum/Diva-class, the actual sound-design tier Splice loops are made with).
Distribution is irrelevant in the factory shape; determinism is solved by committing rendered
bytes (D23), and non-deterministic renders (114 §4) don't matter for eval clips. The probe order
the preset findings imply: Dexed first (sysex loading is MIDI-standard, dodging the .vstpreset
crux entirely), then OB-Xf, then Vaporizer2.

## 5. Recommendation: ranked by (expected gain × license cleanliness) / integration cost

The ranking follows one principle §1–§3 establish: **the eval rewards finished stems, so every
dollar of effort spent making an existing source render *finished* beats a dollar spent adding a
new raw source.** New sources enter where they supply a timbre no current source can produce.

| rank | candidate | expected gain | license | cost | why here |
|---|---|---|---|---|---|
| 1 | **surge2** — the five §2 fixes as one new arm | lead/chords → gen band (70–80%) predicted; bass → ≥50% | unchanged (D23 posture) | S–M | every defect is named, measured, and repo-local; the midi-figure split already proved the ceiling is near gen |
| 2 | **composite** — layered, ref-matched produced clips | the only path that attacks the §1 feature gap head-on for ALL sources | clean (all in-house + existing sources) | M | pack loops are layered program material; no solo-patch arm can close that by definition |
| 3 | **plugin-host sidecar (pedalboard first)** — Dexed/DX7 banks, then OB-Xf, Vaporizer2, Six Sines; later owner-owned commercial synths | one probe unlocks five preset ecosystems (DX7's is the biggest content play in open synthesis) | GPL tool, factory shape (D23); bank licenses per-bank (DX7 banks gray → render-only) | S to probe, M to productionize | 2026 tooling collapsed 114's L estimate to a pip install; presets are the only crux |
| 4 | **sfizz/SFZ sampled keys** — Salamander piano, e-pianos, Karoryfer bass | role-specific (house piano/EP stabs, organ bass); CC0/CC-BY content is repo-committable | BSD-2 renderer; content per-tier §4.3 | S | narrow but genuinely un-synthesizable timbres; renderer is archived — vendor it |
| 5 | **keymap-v2** — multi-zone + root verification + loops | keymap 38% → mid-band; also upgrades every gen-kit tonal role | clean | S–M | fixes a source that already exists; timbre already matches refs on bass (§3) |
| 6 | **webdx7/msfa live device** | FM family for the *product*, not the eval | Apache/MIT (the only clean live candidate) | M–L | 114's gate still holds: earn it only after factory-shape sources beat the eval |

### First experiment 1 — the `surge2` showdown arm

One new opt-in source kind (or a `--surge-v2` variant of the existing one), rateable blind against
the whole ladder in the same batch:

- **pool**: `patches_factory` + `patches_3rdparty` (639 → 3,559), role map extended
  (chords += Polysynths, Chords; lead += Sequences once tempo lands);
- **tempo**: the surgepy tempo binding added to the local build (or, until then, synced-mod
  patches screened out by a param scan rather than silently mistimed);
- **figures**: theory/midi tier only (the bank is known to drag — D26);
- **production**: a `surge2Profile` fit to the §1 ref-feature targets per role (width −30 not
  −17; crest 12–15 via a compressor move, not saturator crush; air ≥2%; bass sub ≥40% via a
  sub-layer or octave-down doubling decision, mono width);
- **motion**: one `setParamVal` filter/macro ride per phrase through the existing override
  addressing;
- **gate**: 2 rounds (~8 pitched batches); success = surge2 pairwise ≥ 65% overall and ≥ 50% on
  bassline; failure isolates to the role level (the per-role splits are the instrument).

### First experiment 2 — the `composite` showdown arm

A composite clip per pitched role, built from sources the repo already has, produced to the ref
targets — i.e. render what a sample-pack producer would actually ship:

- **bassline**: engine sine/triangle sub layer (the engine is genuinely good at sub — it just
  never plays that role alone) + surge/keymap mid-bass layer for character + the ref-matched
  chain (comp → saturation → mono-safe width → air shelf);
- **lead/chords**: surge or keymap main layer + a quiet detuned engine pad layer for width + the
  chain; optionally a gen texture bed at −18 dB for "air and dirt";
- same figure across layers (they are one part, not a mashup), same duration/LUFS pipeline;
- **gate**: composite beats its own best single-source sibling's pairwise in the same batches;
  the D27 event (a genuine blind win over a ref) is the stretch target — this arm is the first
  whose feature vector can actually sit inside the ref distribution.

Both arms are ordinary `writeShowdownBatch` citizens: manifest provenance records the recipe,
the scores log stays kind-only, gitignore gates inherit from the surge/midi posture. They are
complementary to — not competing with — research 134 §7's pre-registered engineplus experiment
(matched/designed *engine* patch stacks): 134 attacks the engine's patch program, this doc
attacks the surge harness and the layering pipeline; all three arms can share rounds and anchors,
and all three chase the same D27 event.

### Why the plugin-host probe outranks any single new synth

Rank 3 is one probe that gates five sources. If pedalboard renders Dexed's VST3 from a sysex
bank on the owner's machine (an afternoon's test), the same sidecar pattern then prices in
OB-Xf, Vaporizer2, Six Sines, and Odin 2 at marginal cost ~zero each — and each lands in the
showdown as its own arm through the identical duration/LUFS/gitignore pipeline surge proved.
If preset loading turns out to be the blocker pedalboard's issue tracker suggests, DawDreamer's
`save_state`/`load_state` round-trip is the documented fallback before anything custom gets
written.

## Honest gaps

- **The standings this doc was commissioned against (Splice 68–93 / gen 74–83 / engineplus 53 /
  surgeplus 50 / surge 44 / keymap 38 / engine 20) do not exactly match any single split this
  pass could recompute from the log** (the closest: recent-era pairwise ref 83–88 / gen 66–78 /
  surge 45–53 / surgeplus 32–58 / keymap 32–35 / engineplus 24–47 / engine 0–8, depending on
  window and figure source). The *ordering* replicates everywhere; the absolute numbers depend on
  era/window choices, and n is small in the newest splits (theory-era surgeplus 58% is n=9
  batches). Treat all point estimates as ±10.
- **The §2 prediction is a prediction.** The midi-figure split is the strongest causal evidence
  (surge-lead 69% ≈ gen 71%), but it is n=16 batches on one owner's ears; surge2 could land short
  if the bass-role deficit is deeper than production.
- **surgepy tempo**: the missing binding was verified on the owner's build; the claim that
  `time_data.tempo` is trivially bindable is inferred from the codebase's structure and the
  stride-fix precedent, not yet written or compiled.
- **sfizz is archived (2026-06)**: the render CLI works today but is unmaintained; the
  sustain-pedal-like rendering issue is a single unverified report.
- **pedalboard preset loading is the plugin path's crux** and per-plugin flaky (.fxp reports);
  no source this pass found tested the specific combinations that matter here
  (Dexed-under-pedalboard sysex loading, OB-Xf state loading) — the S-effort probe exists
  precisely to answer them. DX7 sysex banks are a community-tolerated gray zone with no formal
  licenses: render-only, private posture, same as the surge factory renders.
- **Web claims are point-in-time** (fetched 2026-07-26); licensing pages churn — re-verify
  Splice ToS, Surge #6741, and any CC0 claim before content ships beyond the private eval.

## Sources

**Repo (all read this pass):** `docs/source-showdown-eval.md`, `docs/surge-track.md`,
`docs/engine-presets.md`, `docs/decisions.md` D23–D29, `docs/research/114`, `120` (via D25),
`127`, `129`; `src/taste/showdown.ts`, `src/taste/surgeCuration.ts`, `src/taste/theory.ts`,
`src/taste/eval.ts` (pack-ref training exclusion), `src/core/keymap.ts`,
`ui/src/audio/engine.ts` (sample-lane `playbackRate`), `python/surge_render.py`,
`presets/surge-curated.json`, `examples/taste-t1/beat-scores.jsonl` (250 entries, re-tallied),
172 showdown batch manifests, the owner's Surge data dir
(`~/Documents/dotbeat/tools/surge/resources/data` — 639 factory + 2,920 third-party `.fxp`),
and a live `dir()` probe of the built surgepy instance.

**Web (fetched 2026-07-26 by the three research passes; key items):**
- sfizz BSD-2 + `sfizz_render`: https://github.com/sfztools/sfizz (archived 2026-06-21),
  https://man.archlinux.org/man/sfizz_render.1.en
- FluidSynth LGPL-2.1, v2.5.7 2026-07-25, `-F` fast render:
  https://github.com/FluidSynth/fluidsynth, https://www.fluidsynth.org/api/FileRenderer.html
- ConvertWithMoss v19: https://www.mossgrabers.de/Software/ConvertWithMoss/
- Karoryfer CC0: https://github.com/sfzinstruments/karoryfer.meatbass,
  https://shop.karoryfer.com/pages/free-samples ; VCSL CC0: https://github.com/sgossner/VCSL ;
  Salamander CC-BY-3.0: https://github.com/sfzinstruments/SalamanderGrandPiano ;
  Greg Sullivan e-pianos: https://github.com/sfzinstruments/GregSullivan.E-Pianos ;
  Pianobook EULA: https://www.pianobook.co.uk/terms-conditions/
- Splice ToS (AI-training prohibition, no isolated-sound sublicensing): https://splice.com/terms
- Cymatics / SampleRadar / Freesound licensing:
  https://cymatics.fm/pages/free-sample-packs-license-agreement,
  https://www.musicradar.com/news/tech/free-music-samples-royalty-free-loops-hits-and-multis-to-download-sampleradar,
  https://freesound.org/browse/tags/cc0/
- pedalboard GPLv3, v0.9.24, instrument hosting + `.vstpreset`:
  https://github.com/spotify/pedalboard, https://spotify.github.io/pedalboard/reference/pedalboard.html,
  https://github.com/spotify/pedalboard/issues/245 (+ #187, #277, #311)
- DawDreamer GPLv3, state round-trip: https://github.com/DBraun/DawDreamer,
  https://dirt.design/DawDreamer/user_guide/plugin_processor.html (+ issues #199, #131)
- CLAP MIT SDK / no offline host: https://github.com/free-audio/clap,
  https://github.com/free-audio/clap-host ; Plugalyzer: https://github.com/CrushedPixel/Plugalyzer
- REAPER CLI rendering: https://github.com/ReaTeam/Doc/blob/master/REAPER-CLI.md
- Surge #6741 (content licensing, still open): https://github.com/surge-synthesizer/surge/issues/6741 ;
  surgepy tempo hard-code: https://github.com/surge-synthesizer/surge/blob/main/src/surge-python/surgepy.cpp ;
  surge-xt-cli: https://bedroomproducersblog.com/2023/12/11/surge-xt-13/
- Vital/Vitalium: https://github.com/mtytel/vital, https://github.com/DISTRHO/DISTRHO-Ports,
  https://github.com/atsushieno/open-vital-resources, https://vital.audio/
- Dexed/msfa/webdx7: https://github.com/asb2m10/dexed, https://github.com/webaudiomodules/webdx7,
  https://bobbyblues.recup.ch/yamaha_dx7/dx7_patches.html
- OB-Xf: https://github.com/surge-synthesizer/OB-Xf,
  https://bedroomproducersblog.com/2025/09/23/surge-synth-team-ob-xf/
- ZynAddSubFX/Yoshimi: https://github.com/zynaddsubfx/zynaddsubfx,
  https://man.archlinux.org/man/zynaddsubfx.1.en
- Odin 2 v2.4: https://github.com/TheWaveWarden/odin2/releases ; Helm archived:
  https://github.com/mtytel/helm ; Cardinal: https://github.com/DISTRHO/Cardinal,
  https://patchstorage.com/platform/cardinal/
- Six Sines (MIT): https://github.com/baconpaul/six-sines ; Vaporizer2:
  https://www.vast-dynamics.com/?q=Vaporizer2,
  https://bedroomproducersblog.com/2023/09/27/vaporizer2-open-source/
