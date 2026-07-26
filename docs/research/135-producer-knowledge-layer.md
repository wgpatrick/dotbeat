# 135 — The producer knowledge layer: what an agent must know to tie a pack loop, blind

*Run 2026-07-26 on the owner's directive (verbatim intent): "I really want you to figure out how
you (the agent) can use dotbeat to generate clips that I rank as good as splice clips." The frame:
an agent with dotbeat's full toolkit should produce a 4-bar clip that ties a Splice/Loopmasters
pack loop in the blind showdown — what knowledge is it missing? The expressible surface is no
longer the constraint (deep synth surface, 12-family effect chain, render-true clip automation,
the theory composition layer, 15 validated tricks, per-note chance/ratchet/micro-tuning, groove +
humanize); research 121 showed the binding constraint is that agents apply only what their prompt
names, at the altitude it names it. Method: (a) fresh mining of the live blind-rating record —
`beat showdown --report` over 170 rated batches plus a per-role feature-vector analysis of every
scored clip in `examples/taste-t1/beat-scores.jsonl` (refs included — the pack loops' own measured
DSP profile is sitting in the log); (b) code/docs reads (`src/analysis/produce.ts`,
`src/taste/showdown.ts`, `src/taste/theory.ts`, `presets/tricks.json` via `docs/tricks-reference.md`,
research 115/118/121/124); (c) two single-agent web passes (FX craft, MIDI-expression craft) —
per-claim confidence labels, NOT adversarially verified; treat (medium) and below as leads. The
deliverable is §B: four per-role pack-loop checklists an agent can follow end-to-end, each step
naming a `beat` verb and a measured target. Everything else is their justification.*

## Headline answers

1. **The target, stated measurably, is already in our own log.** Current standings (170 rated
   batches, report run 2026-07-26): ref 88 % pairwise (by pool: familiar 95 / unfamiliar 94 /
   **packs 87** / cc0 65), gen 72 %, surge 44 %, surgeplus 35 %, engineplus 32 %, keymap 31 %,
   engine 1 %. In the most recent 40 batches surgeplus is climbing (58 %) and engineplus sits at
   34 %. Every scored clip carries a 13-key DSP feature vector, so the pack refs define per-role
   numeric targets we can verify against without ears (§A.2's table) — the checklists' exit gates
   are those measured rows, not tutorial lore. (High — computed this pass.)
2. **The single biggest measured hole is register/band placement, and it's a knowledge failure,
   not a tool failure.** Pack bassline refs put a median **43.8 % of energy below 60 Hz** and are
   **dead mono** (width −59.5 dB, corr 1.00). dotbeat's engineplus basslines measure **0.46 %
   sub-share** and **−11.8 dB wide** — the frozen role-blind `engineplusProfile` applies the
   unison/chorus width stack to the bass, violating the repo's own `bass-mono-anchor` trick and
   the refs it is chasing, and nothing ever sets `subLevel` or drops the figure's octave. The same
   pattern repeats mid-spectrum: ref chords carry 23.6 % bass-band body and ref leads 9.8 %, while
   engine clips concentrate 97-99 % in one band. **Our clips lose partly because every role's
   energy sits in a single narrow slice of spectrum; pack loops are placed.** (High — measured.)
3. **FX knowledge: the tricks layer covers about half of the measured gap axes; the other half
   was never written down.** Covered: width, air shelf, glue saturation, sub-foundation,
   bass-mono discipline (but the eval arm predates the catalog and never runs it). Not covered
   anywhere an agent can find it: compression dosage per role (ref crest 13-16 dB vs engine
   14-19 — refs are *denser*, engine drums are under-compressed), delay/reverb dosage and chain
   position, voicing-register rules, and every MIDI-side craft rule. §C/§D codify these as
   decision rules with sources. (High on the gap accounting; medium on individual web-sourced
   dosages.)
4. **MIDI expression is a fully-built, fully-unused surface.** The format has per-note
   `chance`/`cent`/ratchets, track `groove` (swing), `beat humanize` (timing/velocity/push-late/
   swing, lane-scoped), `velToFilterAmount` + generalized `velDest`/`keyDest`, and free-timed
   drum hits — and no generation path or skill step ever touches any of them: composed clips ship
   quantized-correct at near-uniform velocity. The craft numbers (swing 54-58 %, ghost notes at
   ~30-50 % velocity, hat accent ratios, gate-length groove) are all expressible today. (High —
   verified by code read; the numbers are §D.)
5. **Knowledge-capture recommendation: per-role TARGET PROFILES (data) + RECIPE CARDS (procedure),
   both queryable from one new verb, with the skill naming that verb per phase.** Research 121's
   law — agents use what the prompt names — rules out a long reference doc; research 118's trick
   catalog proved preconditioned, receipt-carrying moves work. The missing altitude is the ROLE:
   a `presets/role-targets.json` (measured pack-ref feature ranges per role, mined from the
   scores log) surfaced as `beat rolecheck <wav> --role bassline` (pass/fail per feature with the
   named trick/edit that fixes each miss), plus the §B checklists in the produce-song skill.
   Schema in §E. (Design proposal — medium.)
6. **The experiment (headline): a `crafted` showdown arm.** Smallest change that tests whether
   FX/MIDI knowledge closes the ref gap: a new source kind whose clip is built by the §B checklist
   — theory figure at the *correct octave*, curated patch, role-true production (a NEW
   `craftedProfile`, never an edit to the frozen `engineplusProfile`), MIDI feel pass
   (groove/humanize/velocity shaping/ghost notes), then a verify loop against the role-target
   row before the clip enters the batch. Same figure/patch discipline as engineplus so the
   ablation reads cleanly: crafted − engineplus = the knowledge layer's worth, in blind pairwise
   points. Detail in §F. (Proposal.)

---

## Part A — The target, measured

### A.1 Where the blind record stands (2026-07-26, 170 rated showdown batches)

`beat showdown examples/taste-t1 --report`, this pass:

| source | win | top-half | pairwise |
|---|---|---|---|
| ref | 70 % | 88 % | **88 % of 712** |
| gen | 24 % | 75 % | 72 % |
| surge | 1 % | 42 % | 44 % |
| surgeplus | 0 % | 31 % | 35 % |
| engineplus | 6 % | 28 % | 32 % |
| keymap | 1 % | 28 % | 31 % |
| engine | 0 % | 1 % | 1 % |

Ref by pool: familiar 95 % pairwise, unfamiliar 94 %, **packs 87 % (73 batches — the owner's
"splice clips" target)**, cc0 65 %. Two whole-board "none good" verdicts are excluded. By
figure source (recomputed from the shared log with the report's pairwise semantics — treat as
approximate): with commercial midi figures ref 86 / gen 76 / engineplus 28 / surge 51; with
theory figures (n=15, smoke) engineplus 47 and surgeplus 58 — the theory arm plus production is
the best composed-source cluster yet. Recent-window check (last 40 batches): ref 88, gen 66,
surgeplus 58, engineplus 34, engine 0.

Two readings matter for this doc. First, **production knowledge is already worth ~30 pairwise
points** (engine 1 → engineplus 32 with identical notes and patch) — the largest single lever
ever measured here, and it was applied by a *role-blind, six-line frozen profile*. Second, the
remaining ~55-point gap to the pack refs is not one thing; §A.2 decomposes it per role, and most
of it is knowledge this doc can write down.

### A.2 The pack-loop profile, per role — mined from the scores log

Median DSP features of every scored showdown clip, by role × source kind (this pass; bands:
sub < 60 Hz, bass 60-250, mids 250-2k, presence 2-6k, air > 6 kHz — `src/metrics/analyze.ts`).
The **ref row is the target**; engine/engineplus rows are the diagnosis:

**bassline** (49 batches)

| kind | crest dB | sub % | bass % | mids % | pres % | air % | corr | width dB |
|---|---|---|---|---|---|---|---|---|
| **ref (target)** | **12.8** | **43.8** | **42.4** | **4.6** | 0.0 | 0.0 | **1.00** | **−59.5** |
| gen | 11.2 | 16.6 | 80.0 | 1.4 | 0.0 | 0.0 | 1.00 | −65.1 |
| engineplus | 10.3 | **0.5** | 93.5 | 5.0 | 0.0 | 0.0 | **0.88** | **−11.8** |
| engine | 12.0 | 0.3 | 92.3 | 6.7 | 0.0 | 0.0 | 1.00 | −60.7 |

**chords** (47 batches)

| kind | crest dB | sub % | bass % | mids % | pres % | air % | corr | width dB |
|---|---|---|---|---|---|---|---|---|
| **ref (target)** | **15.5** | 0.0 | **23.6** | **69.8** | **0.4** | 0.1 | **0.70** | **−7.6** |
| gen | 18.9 | 0.0 | 23.7 | 62.2 | 0.8 | 0.0 | 0.62 | −6.3 |
| engineplus | 12.8 | 0.0 | **0.2** | 92.2 | 0.9 | 0.0 | 0.83 | −10.4 |
| engine | 15.0 | 0.0 | 0.0 | 96.9 | 0.4 | 0.0 | 1.00 | −58.2 |

**lead** (47 batches)

| kind | crest dB | sub % | bass % | mids % | pres % | air % | corr | width dB |
|---|---|---|---|---|---|---|---|---|
| **ref (target)** | **16.2** | 0.0 | **9.8** | **80.3** | **3.5** | 0.1 | **0.77** | **−8.8** |
| gen | 15.1 | 0.0 | 1.3 | 78.1 | 6.9 | 1.8 | 0.92 | −13.1 |
| engineplus | 13.7 | 0.0 | **0.0** | 98.7 | **1.3** | 0.0 | 0.84 | −10.7 |
| engine | 14.7 | 0.0 | 0.0 | 99.5 | 0.4 | 0.0 | 1.00 | −57.6 |

**drum-loop** (27 batches)

| kind | crest dB | sub % | bass % | mids % | pres % | air % | corr | width dB |
|---|---|---|---|---|---|---|---|---|
| **ref (target)** | **13.9** | **44.5** | 34.9 | 4.0 | **3.0** | **4.0** | 0.98 | −18.9 |
| gen | 16.0 | 29.1 | 59.8 | 4.0 | 3.3 | 3.0 | 1.00 | −36.7 |
| engineplus | 13.9 | 61.6 | 32.7 | 0.9 | **1.3** | **2.6** | 0.93 | −14.4 |
| engine | **17.3** | 40.3 | 57.9 | 0.5 | **0.2** | **0.7** | 0.99 | −22.8 |

What the table says, role by role (all high — measured):

- **Bassline: the fundamental is in the wrong octave and the width is on the wrong track.** A
  pack bass loop's energy centroid is *below 60 Hz* — fundamentals at E1-A1 (41-55 Hz) with a
  clean sub — while every dotbeat bass puts its fundamental in the 60-250 band (theory.ts voices
  bass at `key.root − 12`; with typical seed roots that's ~110 Hz) and never sets `subLevel`.
  Meanwhile the frozen `engineplusProfile` is role-blind (`role: 'default'`,
  `src/taste/showdown.ts:218`) and applies unison-5/width-0.6 + chorus 0.25 + reverb 0.18 *to the
  bass*, decorrelating it to 0.88 — the exact move `bass-mono-anchor` (tricks-reference) forbids
  and the refs never do. Two one-line knowledge fixes (octave down + subLevel; skip width on
  bass) attack the biggest measured feature gaps in the whole eval.
- **Chords: pack chord loops have a *body*.** 23.6 % of ref chord energy sits at 60-250 Hz —
  bottom voices around A2-B3 — and crest is high (15.5 dB: articulated, not walled). dotbeat
  chords are voiced entirely above 250 Hz (theory.ts `PAD_REGISTER` = key root + 12 semitones,
  and the voicing window climbs from there), so the loop reads thin regardless of production.
  Also note gen *wins* chords batches at 74 % with nearly identical width numbers to engineplus —
  width parity is already achieved on this role; register and timbre are what's left.
- **Lead: presence (2-6 kHz) is the hero band and we're at a third of it.** Refs put 3.5 % in
  presence and ~10 % in bass-band warmth under the lead line; engineplus manages 1.3 % presence,
  zero body, and over-flattens (crest 13.7 vs 16.2 — the saturator+narrow-band patch reads
  smaller, not bigger). The air-shelf trick fires on `bandAirPct < 1` but the refs say the lead
  battle is won an octave lower, at presence.
- **Drum-loop: refs are dense, bright, and controlled.** Ref crest 13.9 vs raw engine 17.3 —
  pack drum loops are *more* compressed than anything we render (glue/bus compression is the
  missing move; no trick covers compression at all). Presence+air together are 7 % of ref energy
  (real cymbals/hats) vs 0.9 % raw. engineplus gets air to 2.6 % via the shelf but overshoots
  sub (61.6 % — kick-heavy, hat-poor balance).

### A.3 What this reframes

The production ablation closed the *stereo/air* half of the measured gap (115's diagnosis:
mono, airless, static). The table shows what it never touched, because no document told it to:
**octave/register placement, sub layering, per-role width discipline, compression density,
presence-band energy, and hat/cymbal balance** — plus everything MIDI-side (§D), which features
can't see but ears rate. Those are exactly the knowledge gaps the checklists below encode.

---

## Part B — The per-role pack-loop checklists (the deliverable)

Each checklist takes an agent from nothing to one verified 4-bar clip. Steps name the `beat`
verb; exit gates name the §A.2 target row. General discipline for all four: work in a scratch
project (`beat init`), checkpoint after each stage, and **never ship a clip that fails its
role gate** — the 121 prime directive applied at loop scale. Where a step cites a source it is
justified in §C/§D; dosage numbers are starting points, tuned by the verify loop, not gospel.

**B.0 — Pack-shipping conventions that apply to every role** (from the pack-maker craft sweep;
high unless noted): a pack loop must **survive solo audition on repeat** — buyers browse solo'd,
which is exactly the showdown's own framing (splice.com/blog/tips-for-creating-your-own-sample-pack).
Cut start/end exactly on the bar at zero crossings with 1-5 ms micro-fades; audition ≥ 20
consecutive repeats (creatorsoundspro.com). Don't export a hanging reverb/delay tail — wrap it
under bar 1 so bar 4 → bar 1 is continuous (medium — austinhaynes.itch.io loop-tails devlog).
And the anti-static rule: **at least one parameter subtly automated across the 4 bars** plus
micro-variation so bar 4 ≠ bar 1 (splice.com + hyperbits.com) — dotbeat: one clip-automation
lane or LFO (F10) and one chance/ratchet cell (D.6).

### B.1 Bassline pack loop

Target row: sub 30-50 %, bass-band 35-50 %, mids ≤ 8 %, **corr ≥ 0.98 / width ≤ −40 dB (mono)**,
crest 11-14 dB, LUFS −19 (batch-normalized anyway).

1. **Choose the source.** Curated Surge bass patch (`beat surge patches --role bassline`; pool
   from `presets/surge-curated.json`) or engine patch. Render 3-5 candidates *on the actual
   figure* (`beat render`), pick by measured `bandSubPct` + crest (`beat metrics --json`) — the
   surge-candidates audition pattern from 121 §1.2.
2. **Compose at the right octave, around the kick.** Theory bass archetype (trance-roller /
   stussy / offbeat-root per theory.ts) with the root voiced at **E1-A1 (MIDI 28-33, ~41-55 Hz)**
   — one octave below theory.ts's current default, and the register the club-bass consensus names
   independently of our band-share inference (high — en.wikipedia.org/wiki/Sub-bass +
   dogsonacid.com sub-note threads). 1-3 pitch classes, root/5th/octave only below ~130 Hz (the
   register rule, research 124 §C.2). **Pattern-level kick slotting beats processing**: leave the
   first 16th of every beat to the kick (KICK-bass-bass-bass) so the loop grooves before any
   sidechain (high — attackmagazine.com warehouse-rolling-techno-bass + the Stussy recipe).
3. **Patch as a two-layer stack in one track.** Sub layer: `beat set <f> bass.subLevel 0.5` when
   `bandSubPct < 25` (the `sub-foundation` trick's own precondition) — mono, continuous, no gaps.
   Mid layer: the main osc carrying 60-250 Hz body plus saturation-derived harmonics at
   ~300 Hz-4 kHz so a solo'd loop reads on small speakers (high — attackmagazine.com's rolling-bass
   recipe: sub low-passed ~80 Hz, mid layer 65-350 Hz saturated ~35 % wet;
   masteringthemix.com bass-cut-through). The rolling *character* band is ~80-250 Hz — if a solo'd
   bass loop sounds empty the deficit is usually there, not in the sub (medium —
   theproducerschool.com).
4. **Produce — mono-anchored.** `beat trick apply <f> bass bass-mono-anchor` (unisonWidth 0,
   chorusMix 0, sendReverb 0, pan 0) then `glue-saturation` (warm, drive 0.25, mix 0.3). **No
   width moves, no reverb — ever** (§C rule F1; mono lows are a club-delivery hard constraint,
   not taste — dowdenmusic.com/bass-in-mono, high). Comp if crest > 14: 3:1-5:1, attack 1-10 ms,
   release 50-150 ms, ~4-6 dB GR (high — izotope.com bass-compression). For the showdown's
   solo'd-loop context, bake the pump into the notes (velocity dips on the kick slots) the way
   pack producers bake the sidechain into the export (medium — attackmagazine.com).
5. **MIDI feel.** Gate: ~60 % on downbeats, 90-100 % on offbeats (Stussy numbers, already in
   theory.ts); offbeat trance rollers ~80-90 % of the inter-note gap so every note fully releases
   before the next kick (medium — myloops.net). Velocity accents ~0.87/0.71/0.59 tiers, quiet
   fillers ~0.47; 2-4 *accented* steps per bar, rest low — the 303 accent convention (high —
   soundonsound.com Acidlab review + roland.com 303 sequencer guide). Swing the offbeat 16ths
   56-58 % (`beat humanize <f> bass --swing 0.14 --timing 0` or the track `groove` line).
   Do NOT timing-jitter a rolling bass (§D.3).
6. **Verify.** `beat metrics` vs the target row; `beat lint <wav> --screens` (sub-rumble, mud);
   the grind screen — solo bass with crest < 10.5 AND sub > 65 % AND definition band < 30 % ⇒
   fix before shipping (the 121 complaint detector).

### B.2 Chord/pad loop

Target row: bass-band 18-28 % (**the body**), mids 60-72 %, presence 0.3-1 %, crest 14-17 dB,
width −6..−11 dB, corr 0.6-0.85.

1. **Choose the source.** Surge Pads/Keys (`beat surge patches --role chords`) or engine patch;
   audition on the actual progression, pick by crest + bass-band share + width.
2. **Compose with a low bottom voice, inside the low-interval limits.** Theory chord track
   (weighted progression, 2-bar harmonic rhythm, minimal-motion voicing — theory.ts) but voice
   the *bottom* of the stack at **G2-C3 (MIDI 43-48, ~98-130 Hz)** so the 60-250 band carries
   real energy — one octave below theory.ts's current `PAD_REGISTER`. Interval discipline down
   there is the low-interval-limit table (high — robin-hoffmann.com/dfsb/low-interval-limits):
   no 3rds below C3, 4ths/6ths not below ~G2, 5ths OK from C2, octaves only below that —
   violating it is the classic "muddy chord loop." Don't double the bass's root inside the pad
   (medium — drumloopai.com house-chords); m7/m9/omit-5 colour per style; top voice hovers,
   moving ≤ 2 semitones between chords (high — Berklee voice-leading consensus).
3. **Patch.** Detune/unison for ensemble thickness (`detune-double`: osc2 +7 cents, level 0.5);
   noise wash ≤ 0.12 for texture (`noise-wash`); moderate cutoff — presence target is under 1 %,
   so a screaming-bright pad is off-profile.
4. **Produce — the full width stack, in order.** Create side content first (`unison-spread` /
   `pad-chorus` ensemble 0.25), then scale it (`utility-widen` 0.65), then the space
   (`reverb-bed` sendReverb 0.2-0.3; pre-delay-ish clarity comes free from the shared bus).
   `glue-saturation` light. Motion: one slow mover only — `slow-filter-lfo` (1/1 sync,
   depth 0.35).
5. **MIDI feel.** Strum the verticals: chord notes spread ~10-20 ms total, low-to-high, with
   per-note velocity variation — grid-perfect stacked attacks read as MIDI (medium —
   beatsden.com + djtechtools.com humanize guides; `beat humanize --timing 0.05 --velocity
   0.05`). One note per chord (usually the top) accented ~0.75, others 0.55-0.65 (medium —
   beatsden.com). Vary stab gates (1 vs 2 steps); leave a breath before barlines (house-pulse
   already drops step 14 ~30 % of the time); change one voicing element per repeat (D.8).
6. **Verify.** Crest ≥ 14 (a walled pad = over-saturated/over-compressed — back off mix knobs);
   bass-band 18-28; width in range **after** a mono-sum check (`beat lint --screens`
   mono-collapse: correlation floor 0.6).

### B.3 Lead loop

Target row: mids 75-85 %, **presence 2.5-5 %**, bass-band 5-12 % (warmth), crest 15-17 dB,
width −8..−13 dB, corr 0.75-0.9.

1. **Choose the source.** Surge Leads/Plucks or engine; audition candidates on the motif; pick by
   measured centroid ~2-3 kHz-region presence share + width (the Sandstorm lead was picked from 5
   patches exactly this way — 121 §1.2).
2. **Compose motif-first.** Theory lead archetype (single peak note on a strong beat near the
   midpoint, call-high/answer-low, one-change-per-repeat — theory.ts). Register: melody centred
   ~A3-A5; let sustained notes' lower harmonics supply the 60-250 warmth the refs show.
3. **Patch for presence.** Cutoff/brightness so 2-6 kHz carries 2.5-5 % — `bright-cutoff` when
   dark, or a +1-3 dB bell in the 2-5 kHz band via eq7 (`eq7Bell2Freq 3000`), not just the
   11 kHz air shelf (the refs win at presence, not air — §A.2; the buried-lead consensus fix is
   +1-3 dB at 2-5 kHz, high — musicguymixing.com + abletunes.com EQ cheat sheets). Saturation
   adds odd harmonics into exactly this band: `glue-saturation` at drive 0.25 before the EQ
   decision, then re-measure.
4. **Produce.** Width stack as chords but tighter (unison 5 / width 0.6, utility 0.6). A lead's
   space is **delay, not long reverb** — tail control inside 4 bars (medium — startcue.io):
   sendDelay 0.1-0.15 synced 1/8 or dotted-8th, feedback 20-40 % (2-4 repeats), never > ~80 % in
   a loop (medium — startcue.io + thevocalmarket.com); sendReverb 0.15-0.2. Keep crest ≥ 15 —
   if saturation+comp pull it under, reduce mix.
5. **MIDI feel.** `velToFilterAmount 0.3-0.5` so accents brighten, not just louden (velocity as
   timbre — §D.1); phrase-end ratchet or a chance<100 grace note for life; humanize timing
   ±0.1 step except on downbeats.
6. **Verify.** Target row + the resonance screen (`beat lint --screens` flags 2-5 kHz ringing —
   the presence push must come from harmonics, not one screaming bell).

### B.4 Drum loop

Target row: sub 35-50 % (kick), bass 25-40 %, **presence 2-4 % + air 3-5 % (hats/cymbals)**,
**crest 12-15 dB** (denser than we render today), width −15..−25 dB, corr ~0.98.

1. **Choose the sources.** Gen one-shots (`beat source gen` kick/snare/hat prompts) or kit
   samples; pick hats by air-band share (>8 kHz energy), kick by sub share + punch
   (crest of the solo hit).
2. **Compose the groove.** Four-on-floor kick; snare/clap 2+4; closed hats 8ths or 16ths with
   **open hats on the offbeat 8ths** (`open-hat-air` — the genre's air carrier). Choke
   discipline: a closed hat immediately after an open hat truncates it — an open hat ringing
   through a closed hit is a realism error (high — attackmagazine.com drum-techniques +
   production-expert.com; dotbeat: shorten `openHatDecay` or place the open hat where nothing
   follows). Ghost notes: ~25-40 % of main velocity on the "e" of 2 / "a" of 3 / the 16th before
   beat 4 (high — faderpro.com + samplefocus.com ghost-note guides). One turnaround gesture in
   bar 4: extra hat 16ths + an open hat, a velocity-crescendo 32nd roll into beat 1, or a
   *dropped* expected hit — silence is a fill too (high/medium — unison.audio hi-hat-rolls +
   attackmagazine.com beat-dissected).
3. **Velocity shape.** Three hat tiers, not jitter: accents ~0.9 (offbeats — the accent in
   house), body ~0.63, near-ghost 16ths ~0.4, then ±10-20 % randomness on top; never two
   adjacent hats identical (high — beatkitchen.io + unison.audio). Kick uniform and high
   (1.0/0.95); snare main hits ~0.9, ghosts ~0.35.
4. **Produce.** `glue-saturation` on the kit bus (drive 0.25/mix 0.3); **compression to
   density** — drum-bus glue 2:1 (up to 4:1), medium-fast attack, 4-5 dB reduction until crest
   lands 12-15 (high — attackmagazine.com mix-bus-compression; the one move no trick covers);
   `autopan-hats` slow/shallow with +1-2 dB utility gain to offset the perceived centre loss
   (medium — iconcollective.edu); air shelf +3 dB @ 11 kHz if air < 3 % after the open hats;
   kick/sub stays centred and dry.
5. **MIDI feel.** Swing 54-58 % on the 16th offbeats (`beat humanize --swing`), hats only —
   never the kick: 50 % = straight, 54 % "loosens the feel without sounding like swing" (Linn's
   own number), 58 % heavy shuffle, 66 % full triplet; house lives 52-56, techno ~50, lo-fi
   55-60 (high — Roger Linn via raaphorst.medium.com + attackmagazine.com swing guide;
   mind the two scales — MPC 50 % = FL 0 % = straight). ±5-10 ms jitter on hats/perc
   (`--timing 0.1-0.2` steps), none on kick/snare; a `chance=70-85` on one or two decorative
   hat cells — never structural kick/snare — so the loop breathes across repeats (high —
   Elektron trig-condition practice, elektronauts.com).
6. **Verify.** Target row; crest is the headline gate (17 ⇒ under-glued); presence+air ≥ 5 %
   combined; `beat lint --screens` (clicks from bad sample trims, dead air).

---

## Part C — FX decision rules behind the checklists

The role sections above consume these; this table is the cross-cutting reference — condition →
move → dosage → chain position → what it solves. Confidence: rules marked [T] restate the
validated trick catalog (high — measured receipts); [115] restate research 115's sourced
consensus (high); [W] come from this pass's web sweep (per-rule label). Chain-order convention
(multi-source consensus, high): **corrective EQ → compression → saturation/character → additive
EQ (shelves/bells) → modulation (chorus/phaser) → time effects via sends (delay → reverb) →
width/utility last**; dotbeat's fixed inserts approximate this and the reorderable `effects`
chain can express it exactly.

| # | rule | role(s) | dosage / position | solves |
|---|---|---|---|---|
| F1 | Bass and kick take **zero width moves and zero reverb** — mono-anchor them after any project-wide pass [T bass-mono-anchor] | bass, sub, kick | unisonWidth 0, chorusMix 0, sendReverb 0, pan 0 | club mono-sum survival; the §A.2 bass width violation |
| F2 | Width is created (unison/detune/chorus) before it is scaled (utility) — an M/S widener on a mono source does nothing [T utility-widen counter] | pitched non-bass | unison 5 / width 0.6-0.8 → utility 0.6-0.75, never > 0.75 | the −52 dB mono deficit, mono-safely |
| F3 | High-pass everything that isn't bass/kick (most parts 80-120 Hz, pads/keys 150-200 Hz); when low-mids congest, sweep-cut 2-4 dB at 200-500 Hz (worst offenders 200-350); subtractive EQ before the comp, additive after [W high — izotope.com HP guide + producerhive.com order rule] | chords, lead, hats, perc | eq7HpOn 12-24 dB/oct, early in chain | mud, headroom |
| F4 | An air shelf amplifies only what exists — open the filter or add noise first when cutoff < ~6 kHz [T air-shelf counter] | lead, pad, hats | +2-4 dB shelf @ 10-12 kHz, after saturation | boosting silence; thin brightness |
| F5 | The lead battle is won at **presence (2-6 kHz)**, not air: saturation harmonics + a small bell beat a bigger shelf [§A.2 measured; W medium] | lead | sat drive 0.2-0.3 warm; +2-3 dB bell ~3 kHz Q~1 | ref presence 3.5 % vs ours 1.3 % |
| F6 | Compress drums to a crest target, not a settings recipe: pack drum loops land 12-15 dB crest [§A.2 measured] | drum bus | ratio 2-4:1, attack 10-30 ms (transients pass), release 100-200 ms, 2-4 dB GR; before additive EQ | engine drums at 17.3 dB crest read unglued/amateur |
| F7 | Glue saturation is a default, not a decision: gentle warm drive on every summed role [T glue-saturation, 115 §5] | all | drive 0.25 / mix 0.3, post-comp | "digital/thin"; harmonic density; small-speaker read |
| F8 | Sidechain duck bass (and pads) under the kick; release tuned to tempo so it recovers just before the next kick: 30-80 ms = tight tech-house bounce, 200-500 ms = classic pump; depth 2-6 dB transparent, 10+ dB stylistic; pads take the deepest pump, leads the least [115 §4.2 + W high — gearnews.com + mastering.com sidechain guides] | bass, pad | duckAmount 0.3-0.5 (engine's fixed 160 ms release sits in the "tight" zone) | the genre's defining pump; kick/bass masking |
| F8b | Slot kick and bass by frequency, not just ducking: find the kick fundamental (house/techno ~40-50 Hz) and cut the bass 2-4 dB there (bell Q 2-4), or the mirror cut on the kick at the bass note's fundamental; decide per-genre who owns the sub [W high — blog.native-instruments.com kick-EQ + attackmagazine.com] | kick+bass pair | eq7 bell, corrective position | low-end masking a duck can't fix |
| F9 | Delay is the lead's space, reverb is the pad's: sendDelay (synced 1/8 / dotted) 0.1-0.15 on leads; sendReverb 0.2-0.3 on pads, 0.15 on leads [115 P1; W high] | lead, pad | sends, post-insert-chain | dry-static reading; width bed |
| F10 | One mover per rate tier — slow (section sweep or 1/1 LFO), medium (autopan/width), event (a throw or ratchet); never two movers on one param [T slow-filter-lfo counter; 115 §4.1] | per track | LFO depth ~0.35; autopan rate 0.1-0.25 Hz depth 0.5 | static loops; also the LFO-vs-automation clobber |
| F11 | Character effects (bitcrush, vinyl, resonator, grain delay) are *one-per-loop* identity moves at low mix, not stackable polish; bitcrush numbers: ~10-bit with sample rate kept > 30 kHz keeps drum transient punch, 12-bit + ~22 kHz for melodic lo-fi colour [W medium — unison.audio + mikesmixmaster.com] | any one supporting layer | mix 0.1-0.3; mid-chain | generic-sounding loops; complexity without mess |
| F12 | Beat-repeat/ratchet is an arrangement event (bar-4 turnaround, build), not an always-on [W medium] | hats, lead | chance/gate low; or per-note ratchetCount 3-4 on the last cell | loops that don't breathe across 4 bars |
| F13 | Never chorus/phaser a transient-heavy drum part (smears attacks, turns phasey); on bass the practice is chorus above ~200-300 Hz only — dotbeat has no band-split chorus, so the honest simplification is F1's "none on bass" [W medium-high — pluginreviewlab.com; thedystopiancollective.com Reese guide] | drums, bass | — | smeared transients; low-end mono damage |
| F14 | Duck the delay/reverb returns under their source (4-8 dB, fast attack, 100-250 ms release) so tails live only in the gaps [W medium — thevocalmarket.com] | lead sends | **not expressible today** — dotbeat's return buses have no duck; workaround: keep sends low (F9) and gate tails by note placement | wash without mud |

(§F's crafted arm applies F1-F10 mechanically; F11-F14 are the agent's taste calls — and F14 is
a noted tooling gap, alongside the reverb bus's missing pre-delay control and return-bus
high-pass, both standard practice: pre-delay 8-20 ms to protect transients, return HP ~200-300 Hz
so reverb never adds low-end rumble [W high — izotope.com reverb-pre-delay + waves.com
reverb-mixing-tips].)

## Part D — MIDI-side expression: the numbers that read as human

All expressible today; none currently applied by any generation path. Sources: this pass's web
sweep + research 124's already-mined recipes; confidence per rule. The master pattern the whole
sweep converges on (high — cross-source): **skeleton vs decoration**. Kick, snare, and offbeat
bass are the skeleton — 100 % quantized, full velocity, no probability. Hats, ghosts, perc, and
fills are the decoration — they carry ALL the humanization (velocity tiers, jitter, swing,
chance, chokes, rolls). Humanizing the skeleton is the amateur error in both directions.

- **D.1 Velocity as timbre, not loudness.** Map velocity into brightness so accents *open*, not
  just louden — the standard velocity→cutoff mapping mimicking acoustic behavior (high —
  gearspace/yamahasynth synth-programming consensus): `velToFilterAmount 0.3-0.5` (per-note
  effect 2^(vtf·(v−0.5)·4) — verified in 121) or `velDest cutoff / velAmount 0.4`. Velocity
  tiers, not jitter: accents ~0.85-0.95, body ~0.6-0.75, near-ghosts ~0.3-0.45 (≈ MIDI
  120/80/50 — beatkitchen.io's three-tier hat scheme, high), then ±10-20 % randomness on top,
  never two adjacent hits identical (high — beatkitchen.io + unison.audio). The 303 bass
  convention: 2-4 accented steps per bar trigger the filter/amp boost, everything else low
  (high — soundonsound.com + roland.com). Uniform velocity is the single most machine-reading
  tell.
- **D.2 Swing by genre, applied to offbeat 16ths only** (the Linn scale, high —
  raaphorst.medium.com + attackmagazine.com swing guide): 50 % straight, 54 % "loosens up the
  feel without sounding like swing" (Linn verbatim), 58 % heavy shuffle, 66 % triplet. House
  52-56, tech-house toward 56-58 (the Stussy window "< 54 stiff, > 62 dragged" — 124 §C.2),
  techno ~50, lo-fi 55-60; same % swings harder at slower BPM. dotbeat: track `groove <amount>
  <grid>` or `humanize --swing`. Mind the scale conventions: MPC/Logic 50 % = FL/Ableton 0 % =
  straight (Attack's "70-80 % jackin' swing" is the 0-100 scale).
- **D.3 Micro-timing: who moves and who doesn't.** Kick and snare stay on the grid — "a
  perfectly quantized four-on-the-floor is exactly right for techno" (high —
  production-expert.com); hats/perc take ±5-15 ms jitter, 20 ms max, 50 ms reads sloppy, ~5 ms
  is the audibility floor (high — unison.audio + samplefocus.com; `humanize --timing 0.1-0.2`
  steps ≈ ±3-6 ms at ~125 BPM). Pick ONE pocket scheme per clip, don't mix (medium —
  unison.audio): laid-back = snare/clap 8-20 ms late (`--push-late 0.05-0.1`, lane-scoped);
  urgent DnB = perc 5-8 ms early. Rolling basses stay quantized — their groove is gate+velocity,
  not timing (high).
- **D.4 Gate is groove**: the same onsets at 60 % vs 95 % gate are different grooves. Offbeat
  bass ~80-90 % of the inter-note gap so it fully releases before the next kick (medium —
  myloops.net); downbeat bass short (0.6); stabs 1-2 steps, saved longer voicings for
  breakdowns (medium — drumloopai.com); closed-hat choke via short `hatDecay` rather than note
  length, and never let an open hat ring through a closed hit (high — attackmagazine.com).
- **D.5 Ghost notes**: at 25-40 % of main-hit velocity (high — cross-source: beatkitchen 15-35
  MIDI, samplefocus 30-50 vs mains 90-100), on the "e" of 2, "a" of 3, the 16th before beat 4
  (high — faderpro.com); ideally a *different, softer articulation*, not the same sample quieter
  (high — samplefocus + edmprod DnB guide; dotbeat: a second quiet lane or lower `snareTone`
  variant). Quiet bass fillers (~0.47) between accents — already in the stussy generator.
- **D.6 Chance and ratchet keep a loop alive across repeats**: 60-90 % probability on decorative
  hats/perc/ghosts, never on the skeleton (high — Elektron Digitakt manual + elektronauts.com);
  the Elektron A:B cycle-condition's 4-bar-clip equivalent is "put the variation in bar 4."
  One ratchet (count 3-4, slight curve, velocity crescendo into beat 1) as the bar-4 turnaround;
  32nds = roll/build, 16ths = groove; combine the roll with chance so it doesn't fire every
  pass (high on roll construction — unison.audio; low on the chance-combo).
- **D.7 Micro-tuning and glide**: ±5-10 cents random per-note detune reads human, past ~±10-20
  reads out of tune (medium — sageaudio.com + Ableton's own "extremely small" doctrine, high);
  per-note `cent=` on doubled melodic notes, not a static whole-loop offset. 808/bass slides:
  mono glide 80-150 ms (`glide` field), on 1-2 note-changes per 4 bars, not every note (high —
  producersociety.com + itsgratuitous.com).
- **D.8 Voicing movement**: change one voicing element per repeat (inversion, top-note step, a
  sus on the V) rather than new chords; keep common tones, move changed voices stepwise —
  one-change-per-repeat is already a theory.ts operator; apply it to chords, not just lead
  (high — 124 §C.3 + drumloopai.com + Berklee).
- **D.9 Rests are arrangement**: bass notes avoid sounding *at* the kick (Attack's bassline
  rule — the timing gap is the groove and the headroom, high); a professional groove-bass part
  is mostly rests (offbeat-only, 4-8 notes/bar, downbeat left to the kick — medium,
  theproducerschool.com); drop an expected hit as a turnaround ("clap on each beat except the
  last" — attackmagazine.com jackin' dissection, medium); density ≤ ~70 % of available cells
  for supporting roles (low — inference; verifiable by onset-density metric).

## Part E — How this knowledge should live (capture format)

Options considered against 121's law (agents use what the prompt names, at the altitude named):

1. *Expanded skill checklists* — right altitude, but static: can't see the clip being built.
2. *A decision-table doc the skill points at* — becomes a catalogue; catalogues get skimmed.
3. *`beat trick suggest` extension* — right machinery (preconditions over FEATURE_KEYS +
   receipts), wrong granularity: tricks are single moves; the miss is role-level.
4. **Recommended: per-role target profiles + a `rolecheck` verb + recipe cards in the skill.**

The design: (a) **`presets/role-targets.json`** — per role, the §A.2 ref feature ranges, mined
from the scores log by a script (regenerated as ratings accumulate, like tricks-reference);
(b) **`beat rolecheck <wav> --role <r>`** — measures the clip, prints pass/fail per feature
with, on each fail, the named fix (a trick name or a §B step): the tricks pattern lifted one
altitude, turning the checklists' exit gates into a tool the skill can name in one line;
(c) the §B checklists into `.claude/skills/produce-song` (or a sibling `produce-loop` skill) so
the procedure is prompt-resident and the measurements are tool-resident. Schema sketch:

```json
{ "role": "bassline",
  "minedFrom": { "log": "examples/taste-t1/beat-scores.jsonl", "kind": "ref", "batches": 45,
                  "regenerate": "node scripts/gen-role-targets.mjs" },
  "targets": { "bandSubPct": [30, 50], "bandBassPct": [35, 50], "bandMidsPct": [0, 8],
                "stereoCorrelation": [0.98, 1.0], "stereoWidthDb": [-100, -40],
                "crestDb": [11, 14] },
  "fixes": { "bandSubPct.low": ["set $t.subLevel 0.5", "drop figure one octave (root E1-A1)"],
              "stereoWidthDb.high": ["trick apply $t bass-mono-anchor"],
              "crestDb.high": ["comp 2:1 @ attack 20ms until in range"] } }
```

This keeps the frozen-science discipline (targets carry provenance and regenerate from data,
never hand-tuned) and gives 121's detector-per-complaint a home: a future owner complaint adds a
range or a fix line, and `rolecheck` enforces it forever.

## Part F — The experiment: the `crafted` showdown arm

**Question**: does the knowledge layer (correct register + role-true FX + MIDI feel) close the
composed-source → pack-ref gap, beyond what role-blind production already bought?

**Smallest change** (one flag, one profile, no engine work):

1. `beat showdown <dir> --with-crafted` adds one `crafted` clip per role batch: the **same
   figure and same patch as the engine/engineplus clips** (the ablation discipline), but built
   through the §B checklist: figure transposed to the role's target octave (bass −12, chords
   bottom-voice −12), `subLevel` on bass, a NEW `craftedProfile(role)` implementing F1-F10
   role-aware (never touching the frozen `engineplusProfile` — CLAUDE.md guardrail), then the
   MIDI feel pass (velocity tiers, swing, gate shaping, one chance/ratchet cell — seeded, so the
   clip stays deterministic), then an automated verify loop: measure, compare to
   `role-targets.json`, apply the mapped fix, re-render (≤ 2 iterations — this *is* `rolecheck`
   run headless, and building it as the verb first makes the arm nearly free).
2. Run ~10 rounds against the pack-ref pool (`--ref-dir taste-dataset/refs-packs`), all four
   roles, owner rates blind as usual.

**Reading the result** (pre-registered): crafted ≥ 55-60 % pairwise (vs engineplus's 32-47 %)
says the knowledge layer works — promote `craftedProfile` to the produce/`--produced` default
and ship `rolecheck` into the skill; crafted ≈ engineplus says the remaining gap is timbre/
composition, not applied knowledge — spend next on samples (121 §3.5) and the gen hybrid;
crafted wins concentrated in bassline+drum-loop (where the register/density gaps are biggest)
with chords/lead flat would localize the residual to voicing/timbre. Either way the D27 north
star (first genuine blind win over a ref) gets its best-equipped shot to date: the theory-arm
subset already shows engineplus 47 / surgeplus 58 pairwise on composed figures — the crafted
arm stacks the two levers (theory composition + role-true craft) that have never yet been
applied to the same clip.

## Honest gaps

- The §A.2 medians pool all ref pools per role (familiar/unfamiliar/packs/cc0) — pack-only rows
  need the batch manifests joined in (kind-only in the shared log by design); the pooled medians
  are dominated by pack+familiar refs but a pack-only regeneration should precede freezing
  `role-targets.json`. The figure-source pairwise splits are my recomputation of the report's
  semantics, not the report's own output — directionally consistent, not decimal-exact.
- Features can't hear composition, timbre quality, or feel: a clip can hit every §A.2 range and
  still lose. The checklists treat the ranges as necessary-not-sufficient gates (the 121
  division of labor: metrics catch gross errors, ears decide quality).
- Web-pass dosages are single-agent-gathered, not adversarially verified; the trick-derived and
  log-measured numbers are the trustworthy core. Where a web rule and a measurement disagreed
  (lead air vs presence), the measurement won.
- §B's octave claims were inferred from band shares and then independently corroborated by the
  web sweep (club bass E1-A1 is cross-source consensus) — but nothing here pitch-tracked the
  actual pack loops; a 30-minute pass with `src/analysis/pitch.ts` over `refs-packs/bassline/`
  would pin the target register exactly and is the cheapest pre-experiment validation.
- n=15 on the theory-figure subset (smoke); surgeplus's 58 % recent window is 43 comparisons.
  The crafted arm's pre-registered thresholds should be read against ±10-point noise at these ns.
- MIDI-feel effects are invisible to every current metric; if the crafted arm wins, attributing
  the win between FX and feel needs a follow-up ablation (`crafted-nofeel`).

## Key sources (web passes, 2026-07-26; domain-level cites inline above)

The densest numeric single sources, worth mining further: Attack Magazine's warehouse-rolling-
techno-bass tutorial (the two-layer bass architecture, kick-slotting, 35 % wet saturation, the
kick-EQ mirror cut) and its Beat Dissected series (per-genre tempo/swing spec tables:
attackmagazine.com/technique); Roger Linn's shuffle math (raaphorst.medium.com/roger-linn-s-shuffle);
beatkitchen.io's drum-programming guide (velocity/tick numbers); the Elektron Digitakt manual's
trig-condition grammar (manualslib.com); Splice's own pack-making guide
(splice.com/blog/tips-for-creating-your-own-sample-pack); robin-hoffmann.com's low-interval-limit
table; izotope.com (HP hygiene, bass compression, reverb pre-delay); soundonsound.com (303 accent
behavior, Haas mono-compatibility); myloops.net + theproducerschool.com (the trance/Stussy bass
recipes research 124 already codified). Repo-internal: research 115 (production consensus + P1-P7),
118/tricks-reference (validated moves), 121 (harness law, detectors), 124 Part C (composition
craft), `src/analysis/produce.ts` + `src/taste/showdown.ts` (what ships today),
`examples/taste-t1/beat-scores.jsonl` (the measured target rows).
