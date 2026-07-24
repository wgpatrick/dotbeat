# Research 126 — m2m arrangement trial: running the NeurIPS'25 track-aware arranger on this Mac

*Hands-on trial of the symbolic **arrangement** model from Ou et al., "Unifying Symbolic Music
Arrangement: Track-Aware Reconstruction and Structured Tokenization" (NeurIPS 2025, arXiv 2408.15176;
code `Sonata165/music2music_code`). Companion to `docs/research/125-midi-model-trials.md` (AMT + CA2 +
MIDI-RWKV), which established the install/render pipeline this reuses. The draw: m2m does two things
neither AMT nor CA2 can — **add a drum track to existing pitched material** (its headline win: note-F1
79.3 vs Composer's Assistant 2's 20.3 on drum arrangement) and **any-to-any band re-instrumentation**
with an explicit voice-order register control (the automated version of the per-voice assignment our
Sandstorm cover did by hand). Same genre-mismatch risk AMT had: trained on Los Angeles MIDI + Slakh2100
(pop/rock/multitrack), not EDM. Method: reused the private test corpus in `~/Documents/dotbeat/
taste-dataset/midi/`, stripped drums from three electronic multitracks and had `m2m_drummer` re-generate
them (3 seeds each), ran `m2m_arranger` on one segment against three target instrument sets, ran one
piano reduction, plus generated drums for a hand-built dotbeat-style figure. Every output gets sanity
stats; 12 were rendered to WAV through dotbeat's own engine. All work lives in the PRIVATE workspace
`~/Documents/dotbeat/taste-dataset/compose-lab/m2m/` (never committed). Single operator, one machine, one
afternoon — quality reads are directional, not a listening study.*

## LICENSE CAUTION (read first)

**The model code repo `Sonata165/music2music_code` ships with NO license file.** No license = all rights
reserved by default; this trial is **personal-use experimentation only**, and none of this code or the
checkpoints should be shipped, redistributed, or wired into a product surface without written permission
from the authors. (The separate REMI-z tokenizer toolkit *is* MIT-licensed — © 2024 Sonata165 — so only
the model/inference repo is the encumbered piece.) The four checkpoints live on Hugging Face under
`LongshenOu/*` with no explicit license tag either. Treat everything below as "can we, technically, on
this hardware" — not "may we adopt it."

## Headline answers

1. **The whole thing runs on this Mac on MPS, fast, with one non-obvious install fix.** All three
   arrangers (drum / band / piano, ~80M GPT-2 each) load in ~0.3s on MPS and generate a typical 4-bar
   segment in 1–6s; a dense input pushes it to 15–76s. The clean inference path is the repo's own
   `api/arranger.py` (transformers `GPT2LMHeadModel` + the REMI-z toolkit), **not** the training
   scripts. Reused the research-125 `amt-venv` (py3.10, torch 2.13, transformers 4.49) — `pip install
   remi-z` dropped in with no torch/numpy downgrade. (High — measured.) §1
2. **`m2m_drummer` genuinely adds a plausible drum track to drum-less pitched material — its core claim
   holds — but it does NOT respect EDM's defining four-on-the-floor kick.** On the two classic
   four-on-floor tracks the *original* kick is 100% on quarter-notes; the model's regenerated kick lands
   on quarters only **47–50%** (One More Time) and **7–40%** (Sandstorm) of the time — it sprinkles
   syncopated, pop/rock-shaped kicks instead. Onset recall of the original groove is moderate-to-good
   (0.28–0.89, rising with density). So: real, usable *pop/rock* drums; **wrong idiom** for
   four-on-floor electronic. Same genre story as AMT. (High — measured on 3 songs × 3 seeds.) §2
3. **`m2m_arranger` band re-instrumentation is the strong result, and the paper's voice-order register
   control is real and demonstrable.** Content survives re-instrumentation almost perfectly
   (pitch-class cosine 0.993–0.998); the output instruments are exactly the GM set you request; and
   **register follows the *order* of the instrument list, not each instrument's natural range** — the
   cleanest confirmation of a paper claim in this trial (see §3 for the swap experiment). This is the
   automated per-voice-assignment step, and it works. (High — measured.) §3
4. **Piano reduction runs essentially free and is idiomatic; drums for our own material work but need
   cherry-picking.** One `m2m_pianist_dur` reduction: 2.2s, single piano track spanning 34–89, in-key.
   Drums generated for a hand-built A-minor dotbeat figure gave a clean four-on-floor on 1 of 3 seeds
   (kick-on-quarter 1.0) and busier/looser grooves on the others. (High.) §4
5. **Recommendation: `m2m_drummer` earns a *conditional* slot as a drum-loop source in showdowns, and
   `m2m_arranger` is the more interesting adoption — but the license blocks both until cleared.** The
   drummer is worth a blind `beat rate` bake-off *specifically because* our deterministic drum recipes
   are already four-on-floor-correct and the model is not — that's a real, testable "does the human
   prefer the model's looser groove or our locked kick" question. The arranger is the better structural
   fit (a covers/re-voicing pipeline), and its register control maps directly onto the manual voice
   assignment dotbeat already does. Neither can be wired in as-is: **no license.** (Medium — design
   proposal, gated on licensing.) §5

---

## §1 Install and speed (exact steps that worked)

**Environment.** Reused research-125's `compose-lab/tools/amt-venv` (Python 3.10, torch 2.13.0 with MPS,
transformers 4.49.0, numpy 2.2.6). The repo's README asks for py3.8 + torch 2.2.2, but the `api/arranger`
path only needs `AutoTokenizer` + `GPT2LMHeadModel` + REMI-z, and those load and run fine on the newer
stack — no dedicated venv needed. Steps:

```
git clone https://github.com/Sonata165/music2music_code.git      # inference: api/arranger.py
pip install remi-z                                               # 0.7.1 — no torch/numpy downgrade
# checkpoints (all four, ~20s total, NO SSL stall this time):
python -c "from huggingface_hub import snapshot_download; [snapshot_download(r) for r in
  ['LongshenOu/m2m_ft','LongshenOu/m2m_drummer','LongshenOu/m2m_arranger','LongshenOu/m2m_pianist_dur']]"
```

**The one real friction: the `remi-z` PyPI wheel is missing its own data files.** `MultiTrack.from_midi`
immediately dies with `FileNotFoundError: dict_time_signature.yaml` — the package references two YAML
dictionaries (`dict_time_signature.yaml`, `dict_tempo.yaml`) that the wheel doesn't bundle. Fix: clone
the GitHub REMI-z (`Sonata165/REMI-z`, the README's intended install) and copy those two files into the
installed `remi_z/` package dir. (The `.py` sources are byte-identical to the wheel; only the data assets
are absent.) After that, `remi_z` + `torch` + `transformers` coexist and round-trip MIDI cleanly.
**Total setup ≈ 10 min.** (High.)

**Speed on MPS.** Model load 0.3s (offline). Per 4-bar drum segment: 1–6s typical; a very dense pitched
input (Sandstorm, 5 instruments) stretched one segment to 45–76s because generation length scales with
input token count. Band arrangement ~5s per 8 bars (it runs bar-by-bar with 1-bar history). Piano 2.2s.
Fully interactive; CPU would also be fine at this size. The pretrained-checkpoint download hit **no** SSL
0%-CPU stall this run (the memory'd `hf-hub-hang-diagnostic` failure mode; `snapshot_download` is still
the safe path). (High.)

**Model mechanics worth recording.** Instruments are GM program numbers passed as `i-{n}` tokens; drums
are program 128. The band/piano arrangers take an `instrument_and_voice` list whose **order is the voice
order** (voice 1 = highest register). `DrumArranger.arrange(..., merge_with_input=True)` folds the
generated drums back onto the source tracks. The drummer processes fixed **4-bar segments**, padding/
truncating each to 4 bars. Generated drums come out as standard GM percussion on channel 9 (36 kick,
38 snare, 42 hat, 49 crash…), which maps 1:1 onto dotbeat's kick/snare/clap/hat/openhat lanes.

## §2 Drum arrangement — the headline claim (`m2m_drummer`)

**Setup.** Three electronic multitracks with real drum tracks and clear grooves, drums stripped, 8-bar
segments fed as pitched-only input, drums regenerated 3 seeds each, compared against the original drums.
Segments: **call-on-me** (Eric Prydz, house, bars 4–12), **one-more-time** (Daft Punk, four-on-floor,
bars 8–16), **sandstorm** (Darude, dense, bars 16–24).

| song (seg) | seed | gen s | onset IoU | recall vs orig | **kick-on-¼ (gen / orig)** | notes/bar (gen / orig) |
|---|---|---|---|---|---|---|
| call-on-me | 0 | 5.3 | 0.44 | 0.50 | **1.00** / 1.00 | 9.9 / 18.0 |
| call-on-me | 1 | 1.0 | 0.28 | 0.28 | 0.89 / 1.00 | 3.8 / 18.0 |
| call-on-me | 2 | 3.6 | 0.56 | 0.56 | 0.73 / 1.00 | 8.8 / 18.0 |
| one-more-time | 0 | 6.4 | 0.57 | 0.65 | **0.47** / 1.00 | 12.8 / 17.2 |
| one-more-time | 1 | 1.9 | 0.35 | 0.35 | **0.50** / 1.00 | 5.5 / 17.2 |
| one-more-time | 2 | 4.1 | 0.51 | 0.54 | **0.50** / 1.00 | 11.4 / 17.2 |
| sandstorm | 0 | 45.1 | 0.46 | 0.69 | **0.40** / 1.00 | 21.6 / 17.8 |
| sandstorm | 1 | 76.1 | 0.57 | 0.89 | **0.07** / 1.00 | 26.4 / 17.8 |
| sandstorm | 2 | 15.9 | 0.59 | 0.88 | **0.29** / 1.00 | 20.5 / 17.8 |

**Read (blunt).** The model *does the job it claims* — hand it drum-less pitched content and it returns a
structured, multi-lane drum part (kick/snare/hat/clap/openhat), non-empty in 7–8 of 8 bars, at a density
in the same ballpark as the original. Onset recall climbs with input density (0.88–0.89 on Sandstorm),
so it "hears" where the groove wants hits. **But the defining EDM feature — the steady four-on-the-floor
kick — is exactly what it will not commit to.** Every original here is 100% kick-on-quarter; the model
regenerates that faithfully only on the sparsest, most house-shaped input (call-on-me, up to 1.0) and
degrades to 0.07–0.50 on the busier four-on-floor material, adding backbeat/syncopated kicks that read as
pop/rock. This is the same genre mismatch AMT showed on this corpus, now measured on the drum axis: the
training distribution (Los Angeles MIDI + Slakh) simply doesn't weight four-on-floor. Seeds vary a lot
(seed 1 is consistently the sparsest across all songs), so any use is a cherry-pick-from-3, not a
one-shot. (High on the measurements; the "wrong idiom" verdict is a lint read, ears confirm via renders.)

## §3 Band re-instrumentation (`m2m_arranger`) — the strong result

**Setup.** Source = call-on-me pitched bars 4–12 (a clear lead over bass + inner voices). Arranged to
three target sets, checking (a) content survival, (b) instrument assignment, (c) register allocation.

| target set (list order) | content pc-cosine | out instruments = requested? | per-voice register (mean pitch) |
|---|---|---|---|
| `string_trio` `[40,41,42]` | 0.998 | yes {40,41,42} | violin1 **76** · violin2 62 · cello **36** |
| `bass_piano_lead` `[80,0,33]` | 0.997 | yes {80,0,33} | synth-lead **74** · piano 59 · e-bass **36** |
| `string_trio` **reordered** `[42,41,40]` | 0.993 | yes {40,41,42} | cello **75** · violin2 62 · violin1 **48** |

**The voice-order register control is real.** The first two rows show the obvious behaviour: the first
instrument in the list takes the top register, the last takes the bottom. Row 3 is the clean proof —
feeding the **same three string instruments in reversed order** `[42,41,40]` moves **cello to the top**
(mean 75) and **violin1 to the bottom** (mean 48). Register tracks *list position*, not the instrument's
natural tessitura. That's precisely the paper's controllable-voice-assignment claim, and it's exactly the
lever a covers pipeline wants: "put this instrument on the melody voice, that one on the bass voice,"
decided by list order. Content survives near-perfectly (pc-cosine ≥ 0.993; every arrangement is 100%
scale-consistent, 0 empty bars). Instrument assignment is exact. This is the capability with no analogue
in AMT or CA2. (High — measured, including the controlled reorder.)

*Caveat on the ear evidence:* dotbeat's engine renders these through its own synth patches, not GM
violin/cello, so the WAVs convey the **register separation** (audible, pitch-driven) but not the timbral
identity of the assigned instruments. Judge the assignment from the pitch stats; judge the voicing from
the renders.

## §4 Piano reduction (`m2m_pianist_dur`) and drums for dotbeat's own material

**Piano reduction** ran essentially free: call-on-me pitched → one piano track, 2.2s, 59 notes spanning
34–89 (a full two-hand span), 100% scale-consistent, 0 empty bars. Pitch-class overlap with the source
is lower (0.43) than the band arranger's — expected, because a reduction re-voices and thins rather than
preserving every line. Idiomatic enough to include for completeness; no friction. (High.)

**Drums for our own material.** Built an 8-bar A-minor multitrack by hand (offbeat-eighth bass + triad
pad + simple lead — a dotbeat-shaped figure) and asked the drummer what it would add. Result depends on
seed: kick-on-quarter **1.00** on seed 2 (a clean four-on-floor — the offbeat bass evidently cued it),
0.71 on seed 1, 0.43 on seed 0; density 5.9–15.6 notes/bar. So on *our* content it *can* produce the
locked kick we want — but only sometimes, and you'd audition three and keep one. (High.)

## §5 Verdicts and recommendation

**Mac feasibility.** All three arrangers are **fully Mac-feasible on MPS today** — ~80M models, 0.3s
load, 1–6s per segment, no CUDA, no cloud, no C++ build (unlike MIDI-RWKV in research 125). The only
install gotcha is the missing REMI-z data files (§1). (High.)

**Does `m2m_drummer` earn a place as a drum source in showdowns?** *Conditionally yes — as a blind
bake-off candidate, not a default.* It is the only tool in this program that can add drums to existing
pitched content, and that's a capability dotbeat lacks entirely. Its weakness (won't hold four-on-floor)
is the *opposite* of the deterministic drum layer's weakness (locked to four-on-floor, no groove
variation), which makes them a genuinely interesting A/B: run "deterministic kick-locked groove vs
m2m_drummer's looser groove" as a blind `beat rate` series and let the ear decide whether the model's
pop/rock looseness is a feature or a bug on electronic material. Prediction (testable): the deterministic
groove wins on straight-ahead EDM, but the model may win where the brief wants a *live/broken* feel.

**Does `m2m_arranger` earn a place in a covers pipeline?** *This is the more compelling adoption.* It
automates the exact per-voice instrument-and-register assignment the Sandstorm cover did by hand, content
survives, and the voice-order control is a real, deterministic lever. The integration shape mirrors
research-125's CA2 proposal: a "MIDI-in, arranged-MultiTrack-out" sidecar over the deterministic layer's
pitched content, where the agent picks the target instrument list (order = voice assignment) and routes
the result into the render+rate loop. `m2m_pianist_dur` slots into the same sidecar for one-instrument
reductions.

**The blocking caveat.** Both recommendations are **gated on licensing.** The model code repo has no
license (§ caution). Nothing here should ship until that's cleared with the authors — this trial
establishes *technical* feasibility and *musical* fit, not permission.

## Where the listenable evidence is

12 WAV renders in `~/Documents/dotbeat/taste-dataset/compose-lab/m2m/renders/`, all through dotbeat's own
engine (`node cli/beat.mjs render`), verified non-silent (rms 740–2412). Drums use the v0.8 **hit-based**
drum grammar (`hit <id> <lane> <start> <vel>`) so multi-bar variation survives — the legacy 16-step
`pattern` caps at one repeating bar and would have flattened the model's per-bar changes.

- **Drum arrangement, solo + mixed for A/B:** `com-source-pitched` (drum-less source),
  `com-origdrums-mixed` (original groove, reference), `com-gendrums-solo-s2`, `com-gendrums-mixed-s2`
  (best seed); `omt-origdrums-mixed` vs `omt-gendrums-mixed-s0` (hear the four-on-floor break down).
- **Our own material:** `dotbeat-source`, `dotbeat-gendrums-mixed-s2` (the seed that locked the kick),
  `dotbeat-gendrums-mixed-s0` (looser).
- **Band + piano:** `band-string_trio`, `band-bass_piano_lead` (register separation audible),
  `piano-reduction`.

Raw `.mid` outputs + `results.json` per task under `compose-lab/m2m/outputs/{drummer,band,piano,
dotbeat_material}/`; `.beat` sources in `compose-lab/m2m/beats/`; drivers in `compose-lab/m2m/tools/`
(`run_drummer.py`, `run_band_piano.py`, `render_m2m.py`, `m2m_lib.py`).

## Honest gaps

- **One kit, one operator, one afternoon.** Three drum songs × 3 seeds, one band segment, one piano
  example. Numbers are directional; the real verdict is a blind `beat rate` series, not this report.
- **kick-on-quarter is a proxy, not a groove score.** It cleanly separates four-on-floor from not, but
  it doesn't judge whether the model's *alternative* groove is musically good — the renders exist so the
  owner can make that call. Onset IoU/recall likewise catch gross structure, not feel.
- **Band renders don't carry the GM timbre.** dotbeat's engine substitutes its own patches, so the WAVs
  demonstrate register/voicing, not violin-vs-cello identity. The instrument-assignment claim rests on
  the pitch stats (§3), which are unambiguous.
- **Genre verdict is on hard cases for the model.** Four-on-floor EDM is precisely where a Los Angeles
  MIDI / Slakh model is weakest; on pop/rock or live-band material the drummer would likely fare much
  better, and that's the corpus it was built for — just not dotbeat's.
- **Not run: the merge/`merge_with_input` path at scale, full-song arrangement, and any training/
  finetune.** Only bar-segment inference on short windows was exercised.
- **License unresolved.** The whole adoption question is downstream of a permission this trial can't
  grant itself.
