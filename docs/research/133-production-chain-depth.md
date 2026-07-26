# 133 — Production-chain depth: what it takes for a dotbeat clip to rank with a pack loop

*2026-07-26. Commissioned after the production layer plateaued: the engineplus ablation lifted the
raw engine's blind pairwise wins dramatically (full-history scoreboard measured this pass: engine
1% → engineplus 32%; the commissioning note quotes a recent-window read of ~20% → ~53%) while
commercial refs sit at 84-95% pairwise depending on role and window. Mid-pass, the owner sharpened
the target (2026-07-26, verbatim intent): "figure out how you (the agent) can use dotbeat to
generate clips that I rank as good as splice clips." So this doc's question is not "better
production in general" — it is: **what does a 4-bar dotbeat clip need so a blind listener ranks it
alongside a Splice/Loopmasters pack loop**, given the ref pool IS now pack loops
(`taste-dataset/refs-packs/`). Method: (a) repo reading — `src/analysis/produce.ts`, `trick.ts`,
`src/taste/showdown.ts`, `ui/src/audio/engine.ts`, `ui/src/components/synthParams.ts`,
`src/core/document.ts`, research 115/118/121/122; (b) **new measurements this pass** — `beat
metrics` medians over 20 pack loops per role and over 28 engineplus / 28 engine showdown clips
(marked **(measured)**, commands reproducible); (c) two single-agent web passes (loop-production
craft; chain-order/dosage craft) — NOT adversarially verified, per-claim confidence labels, URLs
in Sources. Research only — no code changes.*

## Headline

1. **The width and air doctrine is partly obsolete against pack loops — measured this pass.**
   Pack basslines are *dead mono* (median stereoWidthDb **-45.5 dB**, correlation 1.00) with
   **zero** air-band energy, and still win ~87% pairwise. Meanwhile engineplus clips already sit
   at width **-10 to -15 dB** — inside the pack range for chords (-3.0), lead (-7.9), and drums
   (-12.0). The width gap the tricks catalog was built around is **closed**. The air gap mostly
   never existed for role-isolated loops: pack chords/lead ship **0.00-0.17%** air (the 1.9%
   target came from full-mix chops). `PRODUCED_RANGES` in `src/analysis/trick.ts` is calibrated
   to the wrong reference class.
2. **The two measured gaps that remain are spectral occupancy and transient life.** (a) An
   engineplus chords/lead clip puts **~99% of its energy in one band** (mids, 250 Hz-2 kHz);
   pack chords/leads spread real energy into bass (median 3-9%, p75 42-49%) and presence
   (lead median 3.7%). Engineplus bass has **0.1% sub** vs pack bass **29.9%** — `subLevel`
   exists and defaults 0, and *no profile sets it*. (b) Pack loops are MORE dynamic, not more
   compressed: crest 15.5-18.3 dB (chords/lead/drums) vs engineplus 10.6-14.0. "Add compression"
   is the wrong medicine; **articulation** (shorter envelopes, velocity contrast, space between
   notes) and transient shaping are the right one.
3. **Sourced pack-loop craft says loops are deliberately UNDER-processed.** Splice's own spec is
   peak-normalize to -1 dB; the convergent producer norm (UMEK, Gravitas, SIRMA/MusicTech,
   Lostbeat) is "just enough EQ," character saturation/compression especially on drums, printed
   tails wrapped, micro-fades — and explicitly NOT track-style mastering, so buyers can finish
   the sound. The "instantly produced solo" quality is **sound design + registration + character
   + articulation**, not chain length. That is exactly the shape of the measured gap in (2).
4. **Biggest can-do-today-but-don't findings:** (a) **parallel/NY compression is natively
   expressible** — the comp insert is a true dry/wet fan topology (`engine.ts` compIn→{dry,comp}
   →sum) and `compMix` ships at 0, untouched by every profile and trick; (b) **an octave-down
   body layer** — `osc2Detune` is unclamped at the format level (cents; -1200 = octave down), so
   the registration gap is one `set` away; (c) **a ghost-kick pump on a solo loop** — the duck
   reads the source track's kick *hits*, not audio, so a silent (volume ≤ -60 dB floors to -∞)
   four-on-the-floor drums track makes any bass/chords loop pump today; (d) **a two-stage
   "loop-finishing" render** — the surgeplus sample-host pattern (render → re-host the WAV as a
   sample lane → apply a second insert chain → render) gives any clip a pseudo-master-bus pass,
   including post-saturation EQ, with zero format work.
5. **What genuinely needs engine work, ranked by expected rating-gain-per-effort:** transient
   shaper (small node, directly attacks the crest gap) > OTT-style 3-band up/down compression
   (the modern electronic "produced" signature) > exciter (115 P2, still unbuilt) >
   `duckRelease` + `utilityMonoBelow` (small fields) > side-only EQ shelf > stereo delay bus /
   reverb pre-delay > master block (last — batch loudness-normalization already covers the
   loudness half of mastering for showdown purposes).

---

## 1. Where the gap actually is now (measured this pass)

Medians via `node cli/beat.mjs metrics <wav> --json`; pack loops sampled evenly per role dir
(n=20 each) from `~/Documents/dotbeat/taste-dataset/refs-packs/`; engineplus/engine from the most
recent showdown batches in `examples/taste-t1/` (n=10/role engineplus, n=28 engine cross-role).
Band shares are % of total energy: sub <60 Hz, bass 60-250, mids 250-2k, presence 2-6k, air >6k.

| median | LUFS | crest dB | sub% | bass% | mids% | pres% | air% | width dB | corr |
|---|---|---|---|---|---|---|---|---|---|
| **pack bassline** | -10.7 | 11.4 | 29.9 | 48.8 | 0.8 | 0.00 | 0.00 | **-45.5** | 1.00 |
| **pack chords** | -15.4 | 15.9 | 0.0 | 8.9 | 70.1 | 0.3 | 0.00 | -3.0 | 0.34 |
| **pack lead** | -13.0 | 15.5 | 0.0 | 3.2 | 82.5 | 3.7 | 0.17 | -7.9 | 0.72 |
| **pack drum-loop** | -16.1 | 18.3 | 23.2 | 40.1 | 3.8 | 2.7 | 1.1 | -12.0 | 0.88 |
| engineplus bassline | — | 10.6 | **0.1** | 92.1 | 7.9 | 0.01 | 0.00 | -11.0 | — |
| engineplus chords | — | 13.8 | 0.0 | 0.1 | **99.6** | 0.1 | 0.00 | -10.2 | — |
| engineplus lead | — | 10.6 | 0.0 | 0.0 | **99.2** | 0.7 | 0.00 | -10.9 | — |
| engineplus drum-loop | — | 14.0 | **60.2** | 33.0 | 2.0 | 1.2 | 3.2 | -14.9 | — |
| raw engine (all roles) | — | 12.6 | 0.0 | 0.0 | 99.8 | 0.0 | 0.00 | -57.8 | 1.00 |

(engineplus/engine LUFS omitted — batches are normalized to common loudness, so LUFS carries no
signal there. Pack LUFS shows loops ship hot with ~-1 dBTP peaks, consistent with §2's specs;
the showdown normalizer makes this a non-issue for ratings.)

Scoreboard cross-check, same day (`beat showdown examples/taste-t1 --report`, 170 rated batches,
full history): ref 88% pairwise overall (packs pool 87%, familiar 95%), gen 72%, engineplus 32%,
engine 1%. Engineplus **by role**: bassline 57%, drum-loop 37%, lead 17%, chords 11%.

**The reading.** Three points, in order of evidential strength:

- **Spectral occupancy tracks the per-role standings.** The role where engineplus does best
  (bassline, 57% pairwise) is the one role where its energy lands in the right bands (bass-band
  dominant — though still missing the sub octave); the roles where it collapses (chords 11%,
  lead 17%) are exactly the ones stuck at 99% mids. A pack chord loop has body an octave below
  its voicing and a little presence sheen above it; an engineplus chord stab is a band-limited
  blob in the middle. This is registration and patch fullness — mostly *composition + sound
  design*, only secondarily an effects question. *(measured + inference on causality)*
- **Crest runs the wrong direction.** Every pack role out-crests its engineplus counterpart by
  2-5 dB at matched loudness. iZotope's own reference ranges (Sources §8) put unprocessed drums
  at 16-18 dB crest and dense mixes at 9-12 — pack loops sit deliberately on the dynamic side.
  The engineplus chain (chorus + saturation + reverb send) *smears* transients and fills gaps;
  nothing in any profile shortens an envelope, adds velocity contrast, or shapes an attack.
  *(measured; the perceptual claim "punchier reads better" is inference but matches the owner's
  standing "grindy/static" complaints.)*
- **Air/width chase should be demoted for pack-competitiveness.** Not removed — chords/lead width
  (-3/-8 targets) still wants the existing width stack, and drum-loops carry the only real air
  (1.1%) — but `PRODUCED_RANGES.bandAirPct {lo:1.0}` and `stereoWidthDb {lo:-25}` treat full-mix
  numbers as per-role targets and will mis-rank suggestions against pack refs (e.g. air-shelf
  fires on a chords track whose ref class ships 0.00% air; nothing fires on the missing bass
  octave, for which no trick exists). *(measured)*

Eval-hygiene side-finding: `refs-packs/lead/` contains at least one drum loop
(`GUY_GERBER_drum_loop_synth_kit_03_120.wav`, seen as a `lead` ref in batch
`showdown-lead-12812`) — a mislabeled ref pollutes the per-role read; worth a pool sweep.

## 2. What sample-pack producers actually do to a loop before shipping (the target process)

Web pass, sourced (URLs in Sources; confidence per claim). This is the closest professional
analogue to what a showdown clip must be: a 4-bar, single-role clip that sounds impressive
solo'd AND sits in a buyer's mix.

**The delivery spec (what "finished" means for a loop):**
- Peak-normalize to **-1.0 dBFS** (Splice's stated spec; other outlets 0 dB to -6 dBTP —
  *high*). No public per-loop LUFS target exists anywhere (*high confidence in the absence*).
- Perfect loop points on zero crossings; **2-10 ms edge fades** to kill clicks; reverb/delay
  tails **bounced "as loop" so the tail wraps into the loop start** rather than being cut off
  (*high — Splice, NI, Gravitas, SIRMA independently*).
- Key + BPM in the filename; 24-bit / 44.1-48 kHz WAV; DC-offset removal in the batch pass
  (*high*).
- One limiter across the whole pack for consistent perceived loudness — a *pack-level* pass,
  not per-loop mastering (*high — SIRMA/MusicTech*).

**The processing a shipped loop carries (and pointedly does not):**
- **"Just enough EQ"** — role-appropriate carving, conservative: non-bass parts high-passed
  ~80-100 Hz, congestion cuts 150-500 Hz, prefer cuts over boosts (*high — UMEK interview, SOS
  Mixing Essentials*). "You shouldn't overproduce them; you have to leave some space for
  artists to tweak them" (UMEK, verbatim).
- **Character compression + saturation, especially drums** — commercial drum content is
  processed *per sound* through console compressors/EQs, tube saturation, tape (*high as
  Wave Alchemy's stated practice; medium as an industry generalization*). Glue norms: 2:1-4:1,
  slow attack / fast release, 2-3 dB reduction (*medium*).
- **Dry/wet discipline** — heavy reverb/compression baked in is a rejection reason; the norm is
  a dry version plus a wet version, or tails printed but the core sound left workable
  (*high — three independent sources*).
- **Bass mono** — the mixing norm (mono below ~100-120 Hz, bass centered for projection and
  mono compatibility — *high as mixing norm, SOS Mixing Bass*) shows up in the measurements as
  pack bass loops that are simply mono altogether (§1). No submission spec mandates it in
  writing (*checked; stated absence*).
- **Air is a garnish, not a foundation** — 1-2 dB shelf above ~10 kHz *where the source has top
  end at all*; §1 shows shipped melodic loops mostly carry none.

**What this means for a 4-bar dotbeat clip, concretely.** The pack producer's leverage order is
(1) **sound design** — the patch itself is rich before any insert runs: layered registration
(sub/body/top), movement designed into the sound; (2) **articulation** — the groove breathes,
notes have attack and space (the measured crest); (3) **character** — one or two coloring moves
(saturation, character comp) chosen per sound, dosed low; (4) **finishing** — edges, tails,
normalization. dotbeat's current production layer starts at (3) and skips (1), (2), and the tail
half of (4): `applyProducedDefaults` never touches an envelope, a velocity, a note register,
`subLevel` (outside the unused `sub-foundation` trick), or the clip's edges. The showdown
normalizer already covers loudness matching, so the *entire* remaining gap is upstream of where
the production layer currently operates. *(synthesis; the mapping to dotbeat is this doc's
inference)*

## 3. The professional vocabulary vs dotbeat's arsenal — an honest audit

Constraint check done against `ui/src/components/synthParams.ts` + `src/core/document.ts`
(EFFECT_TYPES: eq3, comp, distortion, bitcrush, eq7, autoFilter, autoPan, tremolo, utility,
grainDelay, vinylDistortion, resonator; fixed tail inserts: saturator → chorus → phaser →
pingPong; beatRepeat; sends: shared stereo reverb bus / shared **mono** delay bus; scheduled
duck; master = limiter(-1) only). Chain topology per track (`engine.ts` SynthChain): osc bank →
filter → **reorderable chain** → **fixed tail (saturator→chorus→phaser→pingPong)** → mute →
pan → vol → sends.

| Technique | Perceptual job | Expressible today? | If not: node vs composition |
|---|---|---|---|
| Parallel / NY compression | density without losing transients | **YES — unused.** comp insert is a real dry/wet fan; crush (`compThreshold` -35, `compRatio` 8-10, fast attack) and blend `compMix` 0.3-0.4 | — |
| Transient design (attack/sustain) | punch/snap independent of level; dry up sustain | **No.** Slow-attack comp (`compAttack` 0.02-0.05) *emphasizes* attack by ducking sustain — a partial stand-in; no attack boost, no level-independence | **Node** (small): SPL-style dual envelope-follower differential; 3 params |
| Multiband dynamics / OTT | per-band density; the modern "hyper-produced" sheen | **No.** Single-band comp only | **Node** (medium): 3-band split + up/down comp per band |
| Dynamic EQ / de-essing | tame a frequency only when it misbehaves | **No** | **Node** (medium). Low priority for instrumental loops |
| Saturation families | tape = HF-transient softening + odd-3rd; triode = even+odd, program-dependent; transistor = odd/hard; clipper = flat-top odd | **Partial.** 4 static waveshaper curves (analog/warm/clip/fold) + vinylDistortion. No program-dependence/hysteresis. `warm` ≈ triode-ish, `clip` = clipper | Mostly adequate for loops; tape node = low priority (its transient-softening half is the *opposite* of the crest gap) |
| Mid-side beyond a width knob | side-only air shelf; bass-mono crossover; mid-only comp | **No** (utilityWidth scales the whole side). 115 P5's `utilityMonoBelow` still unbuilt | **Node** (small for monoBelow; medium for side-shelf EQ). Demoted: pack bass is simply mono, and bass profiles carry no width to guard |
| Exciter (harmonic air) | manufacture top-octave content a shelf can only amplify | **No** (115 P2, still open) | **Node** (small-medium: HPF→waveshaper→mix). Demoted vs 115: melodic pack loops ship ~0% air; matters mainly for drum-loops/hats |
| Spatial depth (pre-delay, ER/tail, size) | front-back placement; "expensive" space | **No.** Reverb bus is fixed (decay 2.2 s, wet 1, no pre-delay); delay bus mono; only `sendReverb` amount varies. pingPong insert is the one per-track space | **Node/format** (medium): bus params in the document, or a per-track reverb insert. Delay-before-reverb ordering inexpressible (sends are parallel) |
| Haas widening | dramatic width from mono | Deliberately absent | Keep skipping — mono-sum failure (115 §2.1 verdict reaffirmed by SOS) |
| Bus/glue topology (drum bus vs mix bus vs master) | one moving object; shared character | **Partial.** Drum tracks ARE a bus (lanes→one chain). No group buses, no master block. **Two-stage re-host** (§4) = a whole-clip finishing bus today | Master block stays sequenced last (115 P4); loudness half already handled by batch normalization |
| Sidechain beyond volume ducking | pump; spectral unmasking | **Partial.** Full-band scheduled duck, fixed 5 ms/160 ms/24 dB·amount envelope, kick-lane only. **Ghost-kick trigger works today** (silent source track). No release control; no multiband duck | `duckRelease` = one SYNTH_FIELDS number (115 §4.2, still unbuilt). Multiband duck = node, low priority for single-role loops |
| Automation as production (micro-moves) | "alive" static loops: send throws, filter drift, width blooms | **Mostly YES.** Clip lanes on every numeric field; 2 tempo-synced LFOs with sends/EQ/pan destinations; the 121 automation-vs-static-value render bug is FIXED (base/offset composition verified in engine.ts this pass). **Caveat: clip automation plays only in song mode** — a pack-loop render must wrap its clip in a 1-scene song block to hear its own automation | — |

*(Chain-order note for §4: because saturator/chorus sit in a fixed tail AFTER the reorderable
chain, "EQ after saturation to tame added harmonics" is inexpressible within one track — the
craft's other legal pattern, saturation-as-late-sweetener dosed low, is what dotbeat's topology
enforces. The two-stage re-host is the escape hatch when a clip needs post-saturation shaping.)*

## 4. Ordering and dosage: from fixed profiles to a decision procedure

**What the craft says (sourced, §7-8 of the chain-craft pass):** gain-stage → subtractive EQ →
compression (so junk frequencies don't drive the detector) → additive EQ ("if EQ is meant to
help a part cut through, do it after compression" — Mike Senior/SOS) → modulation/width late →
time-based space last; saturation either early-as-tone or late-as-sweetener (both are
professional patterns); sidechain last. Dosage anchors: glue comp 1-3 dB GR at 1.5-2:1;
character/parallel comp crushed but blended 20-40%; shelves 1-3 dB; crest 14-15 dB = transients
running hot, <9-10 = overprocessed (iZotope's diagnostic framing — the one dosage rule in the
literature tied to a metric we already compute).

**dotbeat's mapping.** The reorderable chain should default to: `eq7` (subtractive: HP for
non-bass roles, congestion cut) → `comp` (parallel, §5 dosages) → `eq3`/`eq7` boosts (additive)
→ `utility` (width, late) — with the fixed saturator tail acting as the low-dosed sweetener it
topologically is, and sends after everything by construction.

**The decision procedure (replaces fixed dosage with measured inputs).** All inputs already
computed (`FEATURE_KEYS` + ringDb + roughness pair-check). Targets = §1's pack table (p25-p75
band per role, not a scalar).

```
render → beat metrics → v = features; role r; targets T[r] from §1
1 REGISTRATION GATE (biggest lever, composition+patch, not effects):
    if r ∈ {chords, lead} and v.bandBassPct < T.bass.p25:
        add body an octave down — osc2Type=osc, osc2Detune=-1200, osc2Level 0.3-0.4,
        or subLevel 0.1-0.15, or drop the voicing's root an octave
    if r ∈ {bass, sub} and v.bandSubPct < 10: subLevel 0.5 (the existing, unused
        sub-foundation trick); check kick relationship if a kit exists
    if r = drums and v.bandSubPct > 40: kick is drowning the kit — kick lane gain -2..-3 dB
        or kickDecay shorter (engineplus drum-loops measure 60% sub vs pack 23%)
2 ARTICULATION GATE (crest, run BEFORE any compression decision):
    if v.crestDb < T.crest.p25 (chords/lead ≥ ~14, drums ≥ ~16):
        shorten decay/release toward stab (decay 0.2-0.5, sustain ≤ 0.5), add velocity
        contrast (accents 0.9-1.0 / offbeats 0.5-0.7), leave rests in the figure
    if v.crestDb > T.crest.p75: only then reach for glue (comp 2:1, slow attack, 1-3 dB GR)
3 CHARACTER (dose by distance-to-target, not fixed):
    saturatorMix ≈ 0.15 + 0.05·(T.pres.med − v.bandPresencePct clamped ≥0), cap 0.4;
    curve: warm (chords/pads), analog (bass/lead), clip (drums, drive ≤ 0.2)
    parallel comp for density WITHOUT killing step 2's crest: threshold −30..−35,
    ratio 6-10, attack ≤ 5 ms, release 0.1-0.15, compMix 0.25-0.4 — stop when crest
    falls back to T.crest band
4 WIDTH (harmonic roles only; bass mono-anchored as today):
    if v.stereoWidthDb < T.width.p25: unison 5 / 0.65-0.7 → chorus 0.2-0.3 →
    utilityWidth 0.6-0.7, in that order (create side signal, then scale it)
5 SPACE: sendReverb to role dose (chords 0.25, lead 0.2, snare 0.12, bass 0) —
    expect crest −0.5..−1; if step 2 margin is thin, halve the send
6 TOP: only if cutoff ≥ ~6 kHz AND r ∈ {drums, lead}: eq7 high shelf 10-12 kHz +1..+3
    (pack melodic loops ship ~0% air — do NOT chase the old 1.9% full-mix target)
7 MOTION: one slow synced LFO (pad cutoff 1/1, depth ~0.3) or autoPan on hats; for
    automation moves, wrap the clip in a 1-scene song block or they render silent
8 VERIFY: re-render, re-measure; every step names its expected metric move (§6);
    revert any step whose move didn't materialize; ≤ 2 iterations
```

This is implementable as `beat trick suggest` v2: same clause grammar, but preconditions read
**per-role target bands** (a `PACK_RANGES[role]` table replacing the role-blind
`PRODUCED_RANGES`), and knob defaults become functions of the measured distance. *(design
inference; every input named is already a FEATURE_KEY or existing screen)*

## 5. The minimum viable pack-loop chain (per role, in dotbeat's own names)

The smallest ordered treatment an agent applies to a rendered-but-raw clip to make it
pack-competitive — a candidate **new** profile set (`packplusProfile`) beside, never inside, the
frozen `engineplusProfile`/`surgeplusProfile` (CLAUDE.md: frozen eval constants are never
edited). Steps ordered per §4; dosages are starting points for the §7 experiment, not doctrine.

**chords / pads** (worst role today, 11% pairwise):
1. `osc2Type` = main osc, `osc2Detune -1200`, `osc2Level 0.35` (octave body) + `subLevel 0.1`
2. `decay 0.4`, `sustain 0.4`, `release 0.25` if crest < 14 (stab articulation); accent
   velocities on the pattern's anchors
3. `saturatorCurve warm`, `saturatorDrive 0.2`, `saturatorMix 0.25`
4. `compThreshold -32`, `compRatio 8`, `compAttack 0.003`, `compRelease 0.12`, `compMix 0.35`
   (NY topology, native)
5. `unisonVoices 5`, `unisonWidth 0.7`, `chorusMode ensemble`, `chorusMix 0.25`,
   `utilityWidth 0.65`
6. `sendReverb 0.25`, `sendDelay 0.08`
7. skip the air shelf unless cutoff ≥ 6 kHz — then eq7 high shelf 11 kHz +2

**lead** (17% pairwise): as chords but `osc2Level 0.3`, `subLevel 0`, crest target ≥ 14 via
decay/velocity + rests; `saturatorCurve analog` drive 0.25 mix 0.3 (presence target 1-6%);
width `utilityWidth 0.6`; `sendDelay 0.12`; LFO2 → `sendReverb` depth 0.15 at 1/1 for the
phrase-scale throw.

**bassline** (57% — closest; protect what works): `bass-mono-anchor` (existing trick) +
`subLevel 0.5` + `saturatorCurve analog`, drive 0.35, mix 0.4 (the mid/top harmonics that let
it read on small speakers) + NO width, NO reverb + short decay with rests (pack crest ~11) +
**ghost-kick pump**: add a `pump` drums track, kick on quarters, `volume -60` (floors to
silence), `duckSource pump`, `duckAmount 0.4`. Expressible end-to-end today.

**drum-loop** (37%): rebalance first (kick share, §4 step 1); `hatTone 7000-9000` +
`open-hat-air` (existing trick) for the genuine air this role wants; velocity contrast on hats
(accent scheme, not flat 0.8); parallel comp on the bus (`compMix 0.3`, ratio 8, attack ≤ 3 ms)
*instead of* downward glue — keeps crest near 18; `saturatorCurve clip`, drive 0.15, mix 0.2;
width from `utilityWidth 0.6` + the stereo reverb send at 0.1, kick dry.

**Finishing (all roles):** render with tail so the reverb/delay decay wraps or rides out
(`beat render --tail`); batch normalization already delivers the pack's "one limiter, -1 dB
peak" convention. For clips needing post-saturation EQ or a whole-clip character pass: the
**two-stage re-host** — `beat source add` the render, host it on a drums-kind track (the
surgeplus pattern, `buildSurgeSampleHost`), apply eq7/comp/utility on the host, re-render.
Worth wrapping as a `beat loopmaster <clip.wav>` compound command; zero grammar.

## 6. The measurable target for every move

Per-role targets = §1's pack medians/quartiles (proposal: commit them as
`presets/pack-ranges.json` regenerated from the private pack dirs by a script — aggregate
statistics only, no audio redistributed; keep pack-pool variants excluded from critic training
per the standing Splice-ToU note).

| Move | Metric that must move | Expected size (from §1 gaps) |
|---|---|---|
| Octave body layer / subLevel (chords, lead) | bandBassPct up; bandMidsPct down | mids 99% → ≤ 90; bass 0 → ≥ 3-9% |
| subLevel 0.5 (bass) | bandSubPct up | 0.1% → ≥ 10-30% |
| Articulation (envelopes, velocity, rests) | crestDb up | +2-4 dB toward role band (14-16 chords/lead, 16-19 drums) |
| Parallel comp | crestDb down ≤ 2 while rmsDb up | crest stays in role band; density audible |
| Saturation dose | bandPresencePct up | lead 0.7% → 1-6%; watch roughness pair-check for regressions |
| Width stack (chords/lead) | stereoWidthDb up, stereoCorrelation down | already ≈ closed; hold -12..-3, corr 0.2-0.8 |
| Ghost-kick pump | no static FEATURE_KEY (motion) | audible; Audiobox PC is the standing proxy; a modulation-depth metric is a future add |
| Air shelf (drums/lead only) | bandAirPct up | drums toward ~1%; melodic roles: leave ≈ 0 |
| Kick rebalance (drum-loop) | bandSubPct down | 60% → ~25-40% |

Two metric gaps worth one small addition each, flagged not built: a **per-onset attack metric**
(crest is clip-global; a transient shaper's success wants attack-slope measured per hit) and a
**modulation/motion scalar** (the §4 step-7 moves are invisible to every static FEATURE_KEY —
the tricks catalog already has to write `expect: flat` for them).

## 7. Recommendation — phased

**Phase A — today's nodes only (tricks + a new profile set; days, no engine work):**
1. `packplusProfile` per role (§5), a NEW named profile beside the frozen ones, plus
   `PACK_RANGES` per-role targets replacing role-blind `PRODUCED_RANGES` in suggest ranking.
2. New tricks in the existing grammar: `octave-body` (osc2 -1200 layer), `ny-glue` (parallel
   comp), `ghost-kick-pump` (needs a second-track step or a compound CLI edit — the one recipe
   the closed vocabulary can't fully express today; `sidechain-pump`'s deferred slot covers it),
   `stab-articulation` (envelope set steps; velocity contrast needs note-level edits — a
   `scaleVelocity` recipe verb or a compound command).
3. Wire `subLevel` into the bass role of `baseProfile` — one line, but it changes produced
   output, so it lands as part of the new profile, not an edit to the frozen ablation.
4. Fix the ref-pool hygiene find (drum loop in `refs-packs/lead/`).

**Phase B — engine additions, ranked by rating-gain-per-effort:**
1. **Transient shaper** EffectType (attack/sustain, envelope-follower differential; 3 params)
   — directly attacks the one measured gap no current node addresses; small (SPL topology is
   two envelope followers and a gain).
2. **OTT-style multiband up/down comp** — the strongest "reads as modern/produced" candidate
   for chords/leads; medium build (3-band split + 2 comps/band).
3. **`duckRelease`** (one SYNTH_FIELDS number, default 0.16 byte-compatible) — unlocks the
   250-350 ms deep-house pump the fixed 160 ms can't make.
4. **Exciter** (115 P2) — now scoped to drum-loops/hats where the air actually lives.
5. `utilityMonoBelow` + side-shelf EQ, stereo delay bus, reverb pre-delay, master block — in
   that order, all demoted from 115's ranking by the §1 measurements.

**The one experiment (proves the biggest hypothesis):** a blind showdown arm **`packplus`** —
same figure and patch as the engineplus clip, plus §5's chain (registration + articulation +
character + role dosage), all today's nodes. Hypothesis: the remaining ref gap is majority
spectral-occupancy + articulation, not missing DSP. Pre-registered success read: packplus beats
engineplus head-to-head ≥ 65% of implied pairs over ≥ 12 batches across all four roles, AND its
band/crest medians land inside the §1 pack p25-p75 bands; secondary read per role (chords/lead
should move most, bassline least). If packplus moves < 10 points, the gap is in sound design
depth/timbre (T6 territory) or motion, and Phase B's transient shaper + OTT jump the queue.

## Honest gaps

- Pack medians are n=20/role from one owner's curated pool; quartile spreads are wide (chords
  bass% p25 1.4 / p75 49) — the targets are bands, not points, and a per-loop nearest-ref
  profile match (`beat metrics --save-profile` per reference) may beat aggregate bands.
- The crest→preference and occupancy→preference causal claims are inference from correlations
  across roles; the §7 experiment is their test. Band shares are energy ratios — a change in one
  band mechanically moves the others; read them jointly.
- The recent-window scoreboard quoted in the commission (~53% engineplus, refs 68-93%) was not
  reproduced exactly here; full-history and my recent-window recomputes (engineplus 32-40%
  pairwise) differ by window and pairwise convention. Directionally identical; per-role split
  (bassline strong, chords/lead weak) is stable across both.
- Both web passes are single-agent, non-adversarial; confidence labels are self-reported.
  Notable literature conflict preserved rather than resolved: tape saturation's harmonic content
  (SOS: odd/3rd-dominant + HF self-erasure; tutorial tier: "even/warm").
- Splice's own creator pages are login-gated; its -1 dB spec is snippet + secondary-source
  corroborated. No source publishes crest-per-role or LUFS-per-loop numbers — §1's measured
  table is, as far as this pass found, better calibration data than anything public.
- research/131 (parallel empirical gap analysis) did not exist to read at write time; where it
  lands, reconcile its window against §1's full-history numbers.

## Sources

Loop-pack craft: Splice blog (Morgan Page sample-creation; "Tips for creating your own sample
pack"); MusicTech/SIRMA "Tips on how to make your own sample pack"; Native Instruments blog
"How to make a sample pack"; Gravitas Create "How to Make a Sample Pack"; Lostbeat Audio
"Best practices to make your own sample packs"; DJ TechTools UMEK "How to Build the Perfect
Sample Pack"; Wave Alchemy Drum Tools 02; Mastering The Mix "Tips for Mixing Loops and Samples";
KVR threads t=565234 (pack levels), p=9259291 (QC checklist); Gearspace 895480 (snippet); SOS
"Mixing Essentials" (White), "Mixing Bass" (Senior); mixanalog "Why and how to mono low end";
FaderPro / Weapon Sounds club low-end (snippets); Safari Audio "Air EQ".
Chain craft: SOS "Analogue Warmth" (Robjohns — saturation physics), SPL Transient Designer
review + manual, SOS Senior "EQ before or after compression", SOS Haas mono-compatibility Q&A;
iZotope "Multiband Compressors vs. Dynamic EQs", "What Is Crest Factor?"; Wikipedia "Parallel
compression" (Katz); Piano For Producers OTT guide; Production Expert on Xfer OTT; Sonarworks
"Pro Mastering Tips: Mid-Side EQ"; Flotown "Center That Sub!" (elliptical EQ); Waves "Get More
From Reverb"; FabFilter reverb-controls; Practical Music Production delay-before-reverb; Icon
Collective "Best Effects Chain Order"; Hyperbits + Beat Kitchen automation/movement guides;
Wavesfactory Trackspacer; Bedroom Producers Blog spectral-ducking roundup.
dotbeat internal, read/measured this pass: `src/analysis/produce.ts`, `src/analysis/trick.ts`
(+ `PRODUCED_RANGES`), `src/taste/showdown.ts` (frozen profiles, surgeplus host, activeFraction),
`ui/src/audio/engine.ts` (chain topology, comp fan, duck 5 ms/160 ms, buses, master, automation
base/offset fix), `ui/src/components/synthParams.ts`, `src/core/document.ts` (SYNTH_FIELDS,
EFFECT_TYPES, osc2Detune unclamped, volume floor), `src/taste/features.ts`, `src/metrics/*`
(bands, ring, roughness, arc/sections), `docs/producing.md`, `docs/tricks-reference.md`,
research 115/118/120/121/122; `beat metrics` runs over `taste-dataset/refs-packs/*` (20/role)
and `examples/taste-t1/showdown-*` (28 engineplus, 28 engine, 10/role split); `beat showdown
examples/taste-t1 --report` (170 batches, 2026-07-26).
