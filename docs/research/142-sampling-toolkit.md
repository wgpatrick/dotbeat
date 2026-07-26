# Research 142 — The sampling toolkit: removing the labor around the owner's ears

*Run 2026-07-26, commissioned by the owner's both/and ruling on the same day, which supersedes the
either/or framing of decisions.md D26 and research 121 §3.5. Verbatim: "This is a 'both and'
situation. We want to make the synths be able to create clips that rival producer-level clips. We
also want to have a robust method of sampling. The tricky part with sampling is that, in my
experience, it requires careful listening and cutting/clipping music. Maybe there are some tools we
could create to speed up the process — like systems that are aware of the beat, bars, etc, where we
might know how to break up a song — but my guess is I'll need to listen to find interesting samples.
Then, there are production tricks to mess with a sample... What's valuable with sampling is building
out the toolkit such that we can utilize sampling in an interesting way." The design brief that
follows from it: the owner supplies EARS and judgement; the toolkit removes the LABOR around that
judgement and then hands them a rich manipulation surface. Method: (a) a direct read of every audio
path in this repo this pass — `src/core/document.ts` (media block, `BeatAudioRegion`,
`BeatLaneSampleBacking`), `src/core/parse.ts`/`serialize.ts`/`edit.ts`, `src/core/keymap.ts`,
`src/analysis/{import,pitch,stems,gen-trim,regen}.ts`, `src/vary/{batch,audition}.ts`,
`src/taste/layered.ts`, `python/analyze.py`, `scripts/{source-lib,prep-oneshot-lib}.mjs`,
`cli/{beat,render,board}.mjs`, `src/mcp/server.ts`, and the sample/audio voice paths in
`ui/src/audio/engine.ts` (lines 1738-1763, 2292-2374, 3168-3210, 3223-3309, 3992-4057); (b) the
prior docs 120 / 121 §3.5 / 131 / 132 / 138 / 139 and decisions.md; (c) a sibling agent's mined
practitioner corpus, `sample-manipulation.md` (26 sources, Sound On Sound "Lost Art of Sampling"
Pt.3-6, Attack Magazine resampling/warp/Beat-Repeat tutorials, Splice and Tracklib guides, the
Ableton warp-mode reference), plus its `pack-production.md` and `layering.md` siblings; (d) one
library-level verification against `node_modules/tone` for a retrigger claim the repo's own comments
imply but never state. Confidence: **High** = read in source this pass, or quoted from a doc that
measured it; **Medium** = one plausible reading of code I read but did not run, or a single
practitioner source; **Low** = judgement or an effort estimate with no spike behind it. Nothing was
run: no chop was cut, no render made, no number in this doc is new measurement. Companions: research
120 (ref-pool acquisition), 121 §3.5 (the samples pillar as originally argued), 131/132 (the
measured gap and the keymap diagnosis), 139 (`src/taste/layered.ts`), `docs/source-showdown-eval.md`.
Research only — no code changes; §7 supplies decision text for the owner to paste, and deliberately
does not touch `docs/decisions.md` (that file has an unresolved duplicate-D23 collision awaiting an
owner call).*

## Headline answers

1. **dotbeat can PLACE sampled audio but it cannot PROCESS it.** An `audio` track's engine voice is
   three nodes — `player → muteGain → master` (`buildAudioTrackVoice`, engine.ts:3168-3175). No
   filter, no effect chain, no volume, no pan, no sends, no ducking. The format agrees: `parse.ts`
   rejects a synth block on an audio track (line 715) and rejects `effect`/`effects` lines on one
   (line 795), and `edit.ts:633` refuses `addEffect` outright. The richest sample-processing path
   dotbeat has today is a sample-backed DRUM LANE, which has a filter, an AHD envelope, and its own
   ordered effect chain. That inversion — the drum machine can produce a sample, the audio track
   cannot — is the single most consequential fact in this document. (High — code read.) §1

2. **Everything the finding loop needs already exists except the cut itself.** `beat analyze` detects
   beats/downbeats/sections into a frozen `*.analysis.json` contract; `src/analysis/import.ts` owns
   all the seconds→bars math; `beat audition` turns *any* directory of wavs into a scoreable
   clip-set batch with a blind stitched contact sheet; `beat board` is a non-blind picking UI with
   audio players, provenance chips and a measured-features table; `registerPreppedMedia` writes an
   ENFORCED provenance sidecar and rolls back the media copy if the sidecar write fails. The missing
   verb is exactly one: cut a long file into candidate chops on the detected grid. (High.) §2

3. **`beat chop` is the highest-value new verb in this document, and it is S-sized** because every
   part already exists in pure TS: `decodeWav` (`src/metrics/wav.ts`), `encodeWav16`
   (`src/analysis/gen-trim.ts`), an onset-flux transient detector (same file), the analysis-artifact
   loader, and `writeClipSetBatch`. Its default should be the *grid*, not the transient detector —
   the mined corpus is emphatic that over-segmentation is the failure mode and that "making fewer
   chops... borrows more of the groove of the original sample, and lets it breathe." (High for the
   parts; Medium for the shape.) §2.1

4. **Resampling is nearly free and it is the master key.** The mined corpus ranks it #1 unprompted:
   "the resample step is what converts 'a recording' into 'an instrument'." dotbeat already renders
   one solo WAV per track through one browser boot (`renderTrackSolosCommand`, exposed as
   `beat render --stems`) and already has the shared bounce→register primitive
   (`registerPreppedMedia`, shared by `beat source add` and `beat adopt`). `beat resample` is glue
   between two things that both work. What it is NOT is free in wall-clock: a render costs a
   ~10-15 s harness boot plus roughly realtime, so resampling is a deliberate act, not something to
   put in an inner loop. (High for the mechanism; Medium for the cost.) §3.1

5. **The keymap diagnosis has a sixth defect research 132 missed, and it is in Tone, not in
   keymap.ts: every keymap lane is monophonic and self-choking.** One `Tone.Player` per lane;
   `Source.start()` on an already-started source calls `restart()`, and `Player._restart` stops the
   most recently created source (`node_modules/tone/build/esm/source/Source.js:129-137`,
   `source/buffer/Player.js:184-186`). A repeated note at one pitch cuts its own tail; there is no
   legato and no overlap. On the decaying bells and plucks this workflow actually uses, that is
   audible as a chopped, mechanical line — plausibly part of the 38% nobody has attributed.
   (High — library read.) §4

6. **A sampled layer inside a layered instrument is blocked on exactly one thing: the crossover.**
   `LayerBand` is the load-bearing rule of `src/taste/layered.ts` ("that single rule is what makes
   the sum a mix instead of four voices fighting") and it is implemented as the synth track's one
   filter. A sample-backed drum lane HAS a filter, so a pitched or percussive sampled layer is
   reachable today through a drum-lane host. An audio track has none, so a loop/texture sampled layer
   is blocked until headline 1 is fixed. (High.) §5

7. **Two things to build first are not on anyone's list.** Demucs stem separation is fully built and
   tested (`src/analysis/stems.ts` + `python/stem_extract.py` + demucs already in the shared venv)
   and is reachable ONLY as a flag inside `beat source gen`. Exposing it as `beat stem-split` is XS
   and it is *the* sampling move for found music. And lane `filter=`/`fx=` are expressible in the
   format and render correctly but have no CLI or MCP verb at all — the drum-sampler's whole
   processing surface is reachable only by hand-editing the file or through the GUI. (High.) §1, §6

---

## 1. The honest inventory

Three questions, deliberately kept apart, because dotbeat's sampling surface diverges on all three:
**expressible** = the `.beat` grammar can say it and `parse.ts`/`serialize.ts` round-trip it;
**renders** = `ui/src/audio/engine.ts` actually does it in a live or offline render; **reachable** =
a CLI subcommand, MCP tool or daemon route sets it, i.e. an agent can do it without hand-editing text.

### 1.1 Registration, provenance and layout

| Capability | Expressible | Renders | Reachable | Notes |
|---|---|---|---|---|
| Reference an audio file from a document | ✅ `media` block: `sample <id> sha256:<64hex> <rel/path>` (`document.ts:772`) | ✅ daemon `GET /media/<path>` serves DECLARED paths only | ✅ `beat sample`, `beat_sample` | Path must be relative and must not contain `..` (`parse.ts:665`); media block must precede tracks |
| Content-address the bytes | ✅ sha256 is a required field | n/a | ✅ computed for you by `beat sample` | Soundfont bytes are re-hashed at load and 409 on mismatch (`daemon.ts:1131`) |
| Licence / provenance | ❌ **deliberately outside the format** (`document.ts:769-770`) | n/a | ⚠️ **partial** — `media/<id>.wav.json` is ENFORCED by `registerPreppedMedia` (`batch.ts:569-575`, rolls back the WAV copy if the sidecar write fails), but only on the `beat source add`/`source gen`/`adopt`/library-install paths. **`beat sample` writes no sidecar at all.** | Sidecar shape: `{source, license, query, sha256, preparedAt, durationSeconds, …}`. `--license` defaults to the literal `unspecified` — "you assert the license, we don't guess it" |
| On-disk layout | — | — | `media/` next to the `.beat` (never `samples/`); installs always COPY bytes in, never reference `presets/` by path (`daemon.ts:732`) | Batch dirs (`gen-<id>-<seed>/`) deliberately register nothing until `beat adopt` |

### 1.2 Audio-region clips (the `audio` track kind)

| Capability | Expressible | Renders | Reachable | Notes |
|---|---|---|---|---|
| One region per clip: `media`, `in`, `out`, `gainDb`, `warp`, `rate`, `markers` | ✅ `BeatAudioRegion` (`document.ts:607`) | ✅ | ✅ `beat audio-clip`, `beat set <t>.clip.<id>.audio.<field>`, `beat_audio_clip` | `in`/`out` are **seconds into the source**, `rate` is a playbackRate multiplier bounded 0.1–8 |
| Repitch (variable-speed) | ✅ `warp repitch` + `rate` | ✅ `player.playbackRate = rate` when and only when warp is `repitch` (engine.ts:4034) | ✅ `beat audio-pitch --to/--root/--semitones` computes the rate for you | Length changes with pitch, by construction |
| Time-stretch decoupled from pitch | ✅ `warp complex` is a legal enum value; `markers` is a modeled type | ❌ **treated exactly as `off`** (`document.ts:571-575`) — needs the signalsmith-stretch WASM dependency | ⚠️ settable, and a silent no-op | `markers` is `[]` always; no parser/serializer/edit support |
| Static clip gain | ✅ `gainDb` | ✅ | ✅ | |
| Gain automation over the region | ✅ `AUDIO_AUTOMATABLE_PARAMS = ['gain']`, full v0.9 lane machinery | ✅ placement-relative — lane time 0 is *this* placement's start (engine.ts:4050-4055) | ✅ `beat automate`, `beat automate-shape`, GUI | The audio track's **only** production control, and genuinely under-used |
| Several regions on one track at arbitrary offsets | ✅ v0.11 repeated `slot` lines with `at <steps>` (D16); overlap is validated (`scenePlacementError`) | ✅ per-placement retrigger; one Player per track, so a back-to-back placement truncates the previous cleanly | ✅ `beat place <scene> <track> <clip> <at>` | This is stutter/collage, already expressible — no verb computes the placements for you |
| Split a region at a timeline point | ✅ (it is an in/out edit, no new audio) | ✅ | ✅ `beat audio-split`, auto-places the second half in every scene that placed the original | No DSP, no new file |
| Rename a clip / display name | ❌ `BeatClip` has only `id` | — | — | Roadmap row, not started |
| **Any effect on an audio track** | ❌ `parse.ts:795` rejects `effect`/`effects` lines; `edit.ts:633` refuses | ❌ `buildAudioTrackVoice` is `player → muteGain → master` and `reconcileEffectChain` is never called for an audio track (call sites: engine.ts:2158 drum bus, :2807 synth chain, :3138 instrument voice — that is all three) | ❌ | Filter, EQ, saturation, bitcrush, grain delay, vinyl: **none of them** |
| **Volume / pan / sends / duck on an audio track** | ❌ `parse.ts:715`: "audio tracks have no synth block" | ❌ | ❌ | Only `gainDb` + gain automation |
| Fade in/out on a region | ❌ | ⚠️ a fixed 5 ms / 15 ms click-guard fade only, and only on trimmed drum-lane hits (engine.ts:3273) | ❌ | Workaround: dense gain automation |
| **Reverse** | ❌ | ❌ | ❌ | `reverseNotes` is MIDI-only. Roadmap row cites Ableton's `R`. Nothing in `src`, `ui/src` or `cli` reverses audio |

### 1.3 Sample-backed drum lanes (where the processing actually lives)

| Capability | Expressible | Renders | Reachable | Notes |
|---|---|---|---|---|
| Back a lane with a sample: `lane <name> sample <id> <gainDb> <tune>` | ✅ `BeatLaneSampleBacking` | ✅ | ✅ `beat lane`, `beat_lane`, `beat keymap`, `beat drum-kit` | `tune` clamped ±24 semitones |
| Repitch per lane | ✅ `tune` | ✅ `playbackRate = 2^(tune/12)` (engine.ts:3257) | ✅ | Variable-speed, same chipmunk transform as region repitch |
| Start / Length trim into the buffer | ✅ `params.start`, `params.length` (seconds; `length 0` = to natural end) | ✅ (engine.ts:3264-3275) | ✅ `beat set <t>.lane.<n>.start` / `.length` | This is Ableton's Simpler trim, and it is the mechanism for slice-to-lanes (§3.5) |
| AHD amplitude envelope | ✅ `params.attack/hold/decay` | ✅ decay ramp clamped to the effective duration so a trim never clicks (engine.ts:2319-2340) | ✅ `beat set …` | No sustain, no release |
| Per-lane filter | ✅ `params.cutoff/resonance` + `filter=lowpass\|bandpass\|highpass` | ✅ Tone.Filter, the same primitive synth tracks use | ⚠️ **cutoff/resonance yes** (`beat set`), **`filter=` NO** — `setLaneParamPath` rejects any key that isn't a `SAMPLE_LANE_PARAM_KEY` (`edit.ts:1046`) | Filter TYPE is settable only by hand-editing the file, or through the daemon's lane-backing route (i.e. the GUI) |
| **Per-lane effect chain** | ✅ `fx=eq3,comp,…` token → `BeatLaneSampleBacking.effects` (`parse.ts:363-370`) | ✅ rebuilt on type-list change, reusing `buildEffectRuntime`/`applyEffectParams` wholesale (engine.ts:2292-2310) | ❌ **no CLI, no MCP.** `addEffect` targets tracks only; `beat lane` takes 4 positionals; `setLaneBacking` (which would accept `fx=`) is wired only into the daemon's lane-ops route | Per-effect PARAM VALUES come from the drums TRACK's synth block — every lane sharing a type shares its knobs |
| The drums track's own production block | ✅ volume/pan/sends/eq/duck/track effect chain | ✅ | ✅ | So a sample routed through a drum lane gets a full production chain; the same sample on an audio track gets none |
| Overlapping hits on ONE lane (polyphony) | ✅ hits may overlap in the format | ❌ **one `Tone.Player` per lane; a retrigger stops the previous voice** (§4, D6) | — | Chords across *different* lanes are fine — different Players |
| Velocity | ✅ per-hit | ⚠️ linear gain only: `gain = dbToGain(gainDb) * velocity` (engine.ts:3258) | ✅ | No timbral change with velocity |
| Round-robin / velocity layers / sustain loops | ❌ | ❌ | ❌ | Round Robin is an existing not-started roadmap row |
| Choke groups | ⚠️ hard-coded: `hat` chokes `openhat` only (engine.ts:3239) | ✅ | ❌ no declaration | Relevant to chops: a slice kit wants a real choke group |

### 1.4 Analysis, bouncing and auditioning

| Capability | Reachable | Notes |
|---|---|---|
| Detect bpm / beats / downbeats / sections of a real audio file | ✅ `beat analyze <audio.wav> [--backend beatthis\|stub\|allin1]` → cached `<audio>.analysis.json` | The frozen contract is **seconds throughout, bars never appear**; `beatthis` gives beats+downbeats and no sections (honest `[]`); `allin1` gives sections but research 102 says trust its boundaries, not its labels. `beatthis` needs the owner-side venv |
| Turn a detected structure into a project | ✅ `beat skeleton` | `src/analysis/import.ts` owns every seconds→bars conversion: `barSeconds` from the median inter-downbeat interval, per-section rounding, >64-bar chunking, the empty-sections uniform fallback |
| Detect what pitch a registered sample IS | ✅ `beat sample-info` | Pure TS, no venv. Two independent methods that must agree, plus a harmonicity read and a partials table, because "a confident wrong number is worse than a low confidence" |
| Separate stems (demucs) | ⚠️ **built but not exposed** — `src/analysis/stems.ts` + `python/stem_extract.py`, four stems (bass/other/drums/vocals), near-silence guard, demucs already in the shared venv | Reachable only as `--gen-stem-extract` inside `beat source gen` / `beat showdown`. No standalone verb |
| Bounce a track to audio | ⚠️ `beat render --stems` — one solo WAV per track, ONE harness boot (`renderTrackSolosCommand`) | `--offline` is unsupported with `--stems` |
| Render a range / a lane / a single clip | ❌ | Length is always the whole project (`render.mjs:229`). Workaround: `beat excerpt <file> <section…>` writes a derived `.beat` you then render |
| Cut an audio FILE into pieces | ❌ **nothing anywhere** | `beat audio-split` splits a clip's in/out and writes no audio. `downbeatAlignedTrim` (an energy-flux downbeat detector + fade + 16-bit encoder, pure TS) exists but is private to the fal generation path |
| Audition a set of wavs blind | ✅ `beat audition <dir>` — mints a clip-set manifest over any wav dir (sorted names → v1..vN), stitches one `audition.wav` with a seeded-shuffled order and a timecode index | `beat rate` then serves blind A/B/C players over the same batches |
| Audition a set of wavs NON-blind | ✅ `beat board <dir>` — per-candidate `<audio>` players, provenance chips (`source.kind`/`provider`/`media`/`license`/`recipe`), a measured features table (LUFS, crest, centroid, width, sub %, air %), pick 1-9 / reject-all-with-note / skip, writes `beat-decisions.jsonl` | Manifest order, **not shuffled** — "this is the whole difference from rate." Warns above 4 candidates. No MCP wrapper exists for `board`, `rate`, `audition` or `excerpt` |
| GUI audio editing | ⚠️ `AudioClipEditor.tsx` — a static min/max waveform, in/out/gain/warp/rate fields | No zoom, no scroll, no drag-to-trim (explicitly out of scope when it shipped) |

### 1.5 The three-line verdict

Sampling in dotbeat today is **placement without processing**: the format and the engine can put a
piece of audio at a time and a pitch, and can shape it well *if* you route it through a drum lane,
and not at all if you route it through the track kind literally named `audio`. Everything upstream of
placement — finding, cutting, ranking, licensing — is either missing (the cut) or built and not
wired up (stem separation, lane effects). Everything downstream — reverse, fades, time-stretch,
round-robin, loops — is absent, with `warp complex` reserved in the format as a promise.

---

## 2. The finding loop

The owner listens. That is the irreducible step and no part of this section tries to replace it. What
follows is everything *else* in the loop, and what it costs to remove.

The loop today, honestly stated: open the file in something that isn't dotbeat, scrub, guess at bar
lines, export a region by hand, `beat sample` it (with no provenance), discover it's off-grid,
repeat. Four of those five steps are labor. The fifth is the owner.

### 2.1 `beat chop` — the cut (size **S**)

```
beat chop <audio-file> [--grid bar|2bar|4bar|beat|section|transient]
                       [--bars N] [--from <sec>] [--to <sec>] [--max N]
                       [--out-dir <dir>] [--rank distinct|loud|bright|tonal|order]
                       [--audition] [--analysis <path>] [--backend beatthis|stub|allin1]
```

*What it does.* Reads (or creates, via the existing `runAnalysis` path) the `<audio>.analysis.json`
sidecar; converts the detected downbeat grid into cut points using the same `barSecondsOf` median
inter-downbeat math `import.ts` already owns; writes `c001.wav … cNNN.wav` into `chop-<name>/` with
a short fade at each seam; writes a clip-set manifest via `writeClipSetBatch` so `beat audition`,
`beat rate` and `beat board` all work on it *the moment it exists*; and writes `chops.json` carrying,
per chop, the source path and sha256, start/end seconds, bar index, detected bpm and section label.

*What it costs.* Every part exists in pure TS. `decodeWav` handles 16-bit PCM and 32-bit float;
anything else (mp3/flac/aiff) goes through `decodeViaWebAudio`, exactly the injectable-decode seam
`prepOneshot` already uses. `encodeWav16` writes the file. The transient mode is `downbeatAlignedTrim`'s
existing rectified-energy-flux detector with the "take the whole envelope, not just the first bar"
generalization. The only genuinely new code is the cut loop, the manifest/provenance write, and the
CLI. (Medium — I did not spike it.)

*Design calls that matter, all from the mined corpus:*

- **Grid is the default, transient is opt-in.** The corpus is unambiguous that over-segmentation is
  the named risk of transient detection, and that "making fewer chops, leaving some pads playing
  sections of multiple hits... borrows more of the groove of the original sample, and lets it
  breathe" — one source builds a whole groove from *three* slices of a break. Default `--grid bar`.
  (Medium — single strong source, corroborated by the genre split it describes: d&b slices hard,
  hip-hop chops in phrases.)
- **Cut at zero crossings where possible, fade where not.** "Experienced editors of digital audio
  always try to make cuts at points where the waveform crosses the zero axis"; the documented
  fallback is a short fade-in to "rescue a badly trimmed, clicky sample start." `pack-production.md`
  independently reports the same rule as a QC gate for shipped loops: fades exist to kill seam
  clicks, not for tonal shaping. Implementation: snap each cut to the nearest zero crossing within
  ±2 ms, then apply a 2–5 ms fade regardless. (High — two independent corpora agree.)
- **Do NOT normalize, and do NOT trim silence.** `prepOneshot` does both (−60 dBFS trim, 5 ms
  fade-out, peak-normalize to −6 dBFS) and both are *wrong for a bar of music*: silence-trimming
  destroys the chop's timing relationship to the grid (a chop that begins with a 30 ms rest becomes
  early), and peak-normalizing destroys the level relationship *between* chops of one song, which is
  exactly the information the owner is listening for. The corpus's "normalize after trimming" advice
  is about one-shots, and dotbeat already follows it there. `beat chop` needs a raw path.
- **Refuse to register anything.** `beat source gen --count N` registers nothing and `beat adopt`
  registers the winner alone; chops must behave identically. Losing chops never enter the media block.

### 2.2 Ranking and grouping — making 180 bars auditable (size **S–M**)

A six-minute track at 128 bpm is ~180 bars. Nobody auditions 180 candidates, so the ranking *is* the
labor-removal, more than the cut is.

The honest tools for it already exist. `computeBatchFeatures` (`vary/batch.ts`) already measures
every wav in a batch dir into the same feature vector `src/taste/features.ts` defines and `beat board`
already displays. So:

- `--rank distinct` (the default): a greedy max-min-distance selection over those feature vectors —
  present the N most *different* chops first, and collapse near-duplicates into one representative
  with a "+7 similar" note. For a loop-based record this is the single move that most reduces
  listening time: you hear the twelve distinct bars of the song, not the same bar eighteen times.
- `--rank loud|bright|tonal`: named, honest single-axis sorts (LUFS, spectral centroid, `pitch.ts`'s
  harmonicity). `tonal` is the one that finds the chord stab in a drum-heavy record.
- `--rank order`: file order, for when the owner wants the arc.
- Auto-drop only the indefensible: a chop whose peak never clears −60 dBFS.

**Rank, never reject, and never with the taste model.** Two of this repo's own findings forbid it:
CLAP embeddings scored *below chance* on intra-batch preference (121 §2.4), and the taste model is
trained on rendered clip preferences, a different distribution entirely. Ranking chops by a learned
score would be precisely the "confident wrong number" that `src/analysis/pitch.ts` was written to
avoid. Ordering and deduplication are safe because a mistake costs a scroll; rejection is not,
because a mistake costs the sample.

### 2.3 The audition surface — `beat board` is the right home (size **S**)

`beat rate` is the wrong surface for finding. Blindness is a property of *measurement*, and the owner
is not measuring here — they are choosing, and they want to see which bar of which song a chop came
from while they choose. That is `beat board`'s exact thesis: "production picks — non-blind,
provenance shown."

And a chop set built by §2.1 satisfies board's entry conditions with no new code — it scans for
`manifest.json` plus rendered candidate wavs, which `writeClipSetBatch` produces. Three small changes
make it fit properly:

1. Render the chop provenance in the existing provenance-chip row: source file, bar index, section
   label, start timecode. This is a manifest field and one template line. (XS)
2. Board warns above 4 candidates and binds keys 1-9. With §2.2's ranking, present the top 9 and page.
   (XS)
3. Keep `beat audition` alongside it, unchanged, for the straight-through listen — one stitched wav
   with a timecode index is a genuinely different mode of attention from a page of players, and both
   are cheap. (Zero)

### 2.4 Provenance and licensing at import (size **S**)

The mechanism is built and enforced; what it lacks is a raw path and chop-shaped fields.

- Add `--raw` to the ingest path: skip `prepOneshot`'s trim/fade/normalize, keep the sidecar. Today
  the only no-prep registration is `beat sample`, which writes **no sidecar at all** — so the single
  fastest way to get audio into a dotbeat project is also the only way that records nothing about
  where it came from. That is the licensing hole, and it is one flag wide.
- Add chop fields to the sidecar: `derivedFrom: {file, sha256, startSeconds, endSeconds}`, `bpm`,
  `bars`, `sectionLabel`. Licence status then *inherits* and stays auditable, which is the whole
  point when the source is a commercial record.
- **Default chops to a gitignored directory and refuse registration without an asserted `--license`.**
  This is not new policy, it is the policy the repo already runs for reference chops: `--ref-dir`
  clips are read-only, the working copies live behind a generated `.gitignore`, and the manifest
  records the origin path as a reference only. Research 120 adds the two live constraints: Splice's
  terms forbid using downloaded content as AI training data (mitigated by excluding `ref`-kind
  vectors from any training mix), and "royalty-free ≠ redistributable — still no repo commits."

### 2.5 What the loop looks like afterward

```
beat analyze record.wav                       # once, cached
beat chop record.wav --grid 2bar --rank distinct --max 24
beat board chop-record/                       # the owner listens. this is the only human step.
beat source add song.beat stab chop-record/c037.wav --raw --license "cleared: <assertion>"
```

Four commands, one of which is the ears. Validation for this whole section is **owner-time-saved**,
measured the obvious way: time from "here is a six-minute track" to "here are the three chops I want,"
before and after. Not a showdown arm — nothing here changes how anything sounds.

---

## 3. The manipulation surface

Ranked by musical value × implementability against the engine as it actually is. Categories:
**(a)** already expressible · **(b)** composable from existing primitives · **(c)** needs new engine
DSP · **(d)** needs a new or newly-exposed sidecar.

### 3.1 Resample — (b), and it is the master key. Size **S**

The mined corpus puts this first without being asked, across three independently sourced chains:
*"the resample step is what converts 'a recording' into 'an instrument', which is the load-bearing
distinction for why iterative resampling is foundational."* One chain bounces an orchestral chord and
reloads it into Simpler, "auto-chromatic-mapped" — which is, exactly, `beat keymap`. Another bounces a
Rhodes chord for a stated reason worth quoting because it is a *format* insight, not a taste one:
*"you can always shorten notes... but you can't lengthen them any further than the duration of the
original sample"* — resample long, trim short later; the other direction doesn't exist. A third runs a
convolution→tape→vinyl→bitcrush degradation chain *before* the bounce specifically so the chain
"can't be un-done or re-balanced later," then re-chops the result. Resample → degrade → re-chop →
re-play is presented as one continuous pipeline, not three techniques.

dotbeat is two pieces of glue away from all of it:

```
beat resample <file.beat> <track> [--as <sample-id>] [--keep|--replace] [--seconds N]
```

Render the track solo (`renderTrackSolosCommand` already does exactly this, one boot for N tracks),
hand the WAV to `registerPreppedMedia` with `--raw` (the same primitive `beat adopt` uses, so the
sidecar is enforced for free and the provenance records which track and which document sha it came
from), and optionally swap the source track for a sample-backed one.

Why it matters more than its size suggests: it converts every synth-domain move into a sample-domain
move and back. It is also how you *escape* headline 1 in one direction — you cannot process audio on
an audio track, but you can process it before the bounce. And `beat regen`'s posture already
establishes the philosophy: a generated project is a recipe, and the sidecar is the recipe. A
resample sidecar recording `{trackId, docSha256, renderedAt}` makes a bounce reproducible the same way.

Honest costs: a render is a ~10-15 s harness boot plus roughly realtime capture (offline compute is
CPU-bound and prints its own realtime ratio; it can be *slower* than live on long dense projects, and
it refuses outright on soundfont tracks and undecoded media, so resample must fall back to live
capture for those). This is a deliberate act, not an inner-loop operation. "Nearly free" describes
the *code*, not the wall clock.

### 3.2 Give audio tracks a production chain — (c), and the highest-value engine change here. Size **S–M**

Everything in §1's audio-track row collapses into one fix. `buildAudioTrackVoice` grows an `fxIn`
and calls `reconcileEffectChain(voice, voice.fxIn, voice.muteGain, track.effects, track.id)` — the
literal three-line shape the instrument voice already uses at engine.ts:3138 — and the two refusals
(`parse.ts:795`, `edit.ts:633`) lift. Research 139 already established that the machinery is generic:
"`buildEffectRuntime`/`reconcileEffectChain` were already fully generic — nothing there was actually
synth-specific."

What it unlocks, all at once and all from the mined corpus: filter-as-extraction (the specific
crossover recipe found is a **186 Hz high-cut at 36 dB/oct** against a **200 Hz low-cut at 18 dB/oct**
— deliberately asymmetric and staggered, not a textbook matched pair — to split one sample into a
bass layer and a top layer for independent treatment); the lo-fi degradation stack, whose recurring
concrete order across two sources is **tape → vinyl/crackle → bitcrush** applied *before* committal
(dotbeat has `vinylDistortion`, `bitcrush` and `distortion`, and `grainDelay` for the granular edge);
resonant-bump-at-the-knee filtering; and the whole `beat trick` catalog, which today simply cannot be
applied to a sampled loop.

Whether it should also grow `volume`/`pan`/`sends` is a separate call — that means giving audio tracks
a synth block, which `parse.ts:715` explicitly refuses and which would be a format change. The effect
chain alone is the 80%, and it needs no new grammar: `BeatTrack.effects` already exists on every
track kind.

### 3.3 Slice-to-lanes — (b), very high value. Size **S**

Take one bar and mint one drum lane per slice, every lane backed by the **same** media id at a
different `start`/`length`. No new files, no new format, no new engine work — `params.start` and
`params.length` already do exactly this, and the AHD envelope already shapes each slice. What is
missing is only the verb that computes the pairs, and `gen-trim.ts`'s onset-flux detector already
computes them.

```
beat slice <file.beat> <audio-or-media-id> <track> [--slices 16|--transient] [--prefix s]
```

This is the MPC/Push slice mode, and per the corpus's three-method taxonomy (manual / transient /
grid) dotbeat can do two of the three natively. It is the single move that turns a found break into
*playable* material rather than a loop you place. It composes with §3.1 (slice a resampled stack) and
with §2 (slice one chop). Add a real choke-group declaration alongside it — the hard-coded
`hat` → `openhat` rule is not enough for a slice kit.

### 3.4 Reverse — (b) as a file op, and don't do it as (c). Size **XS**

The corpus flags reverse as "known-but-thinly-sourced" only in the sense that nobody writes down
parameters for it; the technique itself is ubiquitous (reverse-reverb: reverse the dry, reverb it,
reverse back so the build-up precedes the transient; reversed crashes and risers as transitions; a
credited compositional use on Kendrick Lamar's "Father Time"). Research 121 §3.5 named "a reverse
crash" specifically as what Sandstorm would have used immediately.

Two implementations are possible and the cheap one is strictly better. A `reverse: boolean` on
`BeatAudioRegion` means a format bump *and* engine work, because `AudioBufferSourceNode` has no
negative playbackRate — the engine would have to hold a reversed copy of every buffer. A file op —
`beat audio-reverse <in.wav> [-o out.wav]`, ~10 lines over `decodeWav`/`encodeWav16` — needs neither,
and it *composes*: the reversed file is an ordinary media file you can then chop, keymap, slice or
resample. Reverse-reverb becomes reverse → place → resample-with-reverb → reverse, which is exactly
the manual workflow, expressed in verbs that all exist once §3.1 lands.

### 3.5 Warp-mode misuse as a deliberate parameter — (a)/(c). Size **XS now, L for the real thing**

The corpus's #2 recommendation is to expose "use the wrong warp mode on purpose" as a creative
control rather than a defect, because it is "nearly free to add and directly matches the owner's
framing." dotbeat's honest position: it has exactly one working mode (`repitch`), so the *misuse*
axis doesn't exist yet — you cannot pick the wrong mode when there is only one. `complex` is reserved
in the format and silently does nothing.

The corpus also supplies the strongest argument yet for *which* stretch mode to build if one is ever
built: Ableton's **Texture** mode is functionally a granular engine behind the warp interface (fixed
grain size plus a Fluctuation randomization), and "the SAME control that does time-stretching for
textural material *is* the pad-from-a-one-second-sound technique — no separate granular engine is
conceptually required." That is a real argument for grain-based over phase-vocoder, and it is worth
recording now even though the build is **L** and belongs late (§6).

Meanwhile the honest v1 answer to "this chop is at the wrong tempo" is the one `beat showdown`
already uses on ref clips: conform the *project* to the chop's detected bpm (`foldBpmToRange`), and
cut chops on the source's own downbeat grid so they are bar-exact at their native tempo. That
dissolves most of the need.

### 3.6 Region fades — (c), small. Size **S**

`fadeIn`/`fadeOut` seconds on `BeatAudioRegion`, applied on the Player. Today the engine has a fixed
5 ms/15 ms click guard on trimmed drum hits and nothing on audio regions. Both mined corpora treat
seam fades as a technical QC gate — matched loop points, short fades to kill clicks, "prefer fading
only the very tail rather than the whole release." Low glamour, and it is the difference between a
chop that plays and a chop that ticks. Achievable today only via gain automation.

### 3.7 Rhythmic mangling / Beat Repeat — (b) for stutter, (c) for the device. Size **XS then M**

Multi-placement (§1.2) already makes stutter expressible: N placements of one short clip at
successive `at` values, non-overlap validated. What's missing is sugar —
`beat place … --repeat N --every <steps> [--decay]` — which is XS.

The corpus supplies two independently sourced Beat Repeat parameter sets worth recording for when a
real device is built: a glitchy chord-lead stutter at **Interval 1 bar, Gate 7/16, Grid 1/16** with
the device's own filter at **4.20 kHz / bandwidth 6.61**; and a pad stutter at **Grid 1/8, Gate 8/16,
Pitch Decay 100%**. Treat as a style range, not a contradiction. It also supplies a host-agnostic
probability trick dotbeat could adopt without a probability lane: chain a random-velocity stage
(amount 64) into a gate thresholded at 126, so only the rare randomly-loudest hits pass — a general
random-then-threshold pattern for faking probabilistic retrigger. (Medium — two sources, one each.)

### 3.8 Stem separation — (d), built, unexposed. Size **XS**

Covered in §1.4 and §6. Chop the drums out of a record, or lift the vocal, or isolate the bass before
you keymap it. Four stems, a near-silence guard that reports what it fell back to and why, RMS
receipts for kept/residual, `htdemucs` in the shared venv. It needs a CLI surface and a row in
`python/README.md`'s table. Nothing else.

### 3.9 Already expressible, no work needed

Repitch per lane and per region (`tune`, `warp repitch` + `rate`, `beat audio-pitch --semitones` for
material with no single pitch); trim and AHD-shape a one-shot; gain automation over a region as a
volume-shaping / gating / tremolo primitive; multi-placement collage. The gap on all four is
discoverability, not capability.

### 3.10 The recognizability budget — noted, not built

The mined corpus's sharpest single finding is oriented opposite to how transformation dials are
normally framed. A flip fails not by changing too much but by *removing the anchor*: a producer's
remix was rejected because she "left too much of the main vocals out." So a hard flip needs at least
one stable recognizable element retained while everything else changes, and separately, "if a drum
sample is layered and tweaked it is nigh-on impossible to identify its source" — layering plus
tweaking, not any single effect, is what defeats recognition. dotbeat has no way to reason about this
and I am not proposing it should. It is recorded because it is the one place where a "transformation
strength" knob would be actively misleading if anyone ever builds one.

---

## 4. Fixing the sampled path we already have — keymap at 38%

Research 132 §3 diagnosed four defects. Reading the code this pass, there are six more, and one of
them is not in `keymap.ts`.

**D1 — Speed-based repitch across ±24 semitones.** 132's own words: "the chipmunk/mud transform. A
phrase spanning an octave plays the same one-shot at up to 2× speed difference: duration halves/doubles
with pitch, transients sharpen/smear, formants shift. Commercial sample instruments re-sample every
few semitones precisely to avoid this; keymap stretches ONE sample across the whole span." (High.)

**D2 — Unverified root detection.** Low-confidence detection falls back to the strongest-low-partial
guess and proceeds. `beat keymap` refuses below `PITCH_CONFIDENCE_MEDIUM` unless `--force`, which is
better than nothing — but a *wrong-but-confident* root passes silently, and nothing downstream ever
re-checks. (High.)

**D3 — No round-robin.** Every hit is the same bytes. The machine-gun effect. (High.)

**D4 — No velocity layers.** Velocity multiplies gain and nothing else (engine.ts:3258). A real
instrument changes timbre with velocity; this changes level. (High.)

**D5 — No sustain loops.** `SAMPLE_LANE_PARAM_KEYS` has `start`/`length` but no `loopStart`/`loopEnd`.
A decaying one-shot either truncates or rings identically every time. `pack-production.md` records
the industry gate that makes this matter: loops must "loop perfectly" with matched start/end points. (High.)

**D6 — Every keymap lane is monophonic and self-choking. (New this pass.)** `loadLaneSample` builds
one `Tone.Player` per lane. `Source.start()` checks the state at the requested time and, if it is
already `"started"`, calls `restart()`; `Player._restart` explicitly stops the most recently created
source. So a repeated note on one pitch cuts its own tail, and there is no legato. Chords across
different lanes are fine — different Players — but a line that revisits a pitch inside the sample's
own decay is chopped. On bells, plucks and pads, which is exactly what this workflow generates,
that is audible. The engine documents the same semantics for the audio-track path in its own words
("`Tone.Source.start()` on an already-started player restarts it") without ever connecting it to
keymap. (High — verified in `node_modules/tone`.)

**D7 — Per-lane buffer duplication. (New.)** `loadLaneSample` issues `new Tone.Player({url: …})` per
lane, so a 15-lane keymap makes 15 fetches and holds 15 decoded copies of one file. The offline
render path avoids this (it is seeded from the shared `audioBuffers` cache); the live path does not.
Not a sound defect, but it caps how many zones a multi-zone keymap-v2 can afford in the current
shape. (Medium — read, not measured.)

**D8 — Keymap speaks hits, not notes. (New.)** Lanes carry hits with an optional gate duration; there
is no note duration semantics, no glide, no per-note pitch. `keymap.ts`'s own header says so:
"keymap-as-lanes is the v1, not the endgame," and it deliberately factors the `(rootMidi, targetMidi)`
arithmetic so a future sampler-*instrument* track reuses it unchanged. (High — the file says it.)

**D9 — One-shot quality lottery.** One fal one-shot per batch, "never auditioned before rating" (132).
This one is already solved by machinery that exists: `beat source gen --count N` + `beat board`. It is
a workflow fix, not a code fix. (High.)

**D10 — AHD, not ADSR.** Attack/hold/decay with the decay ramp clamped to the effective duration.
No sustain, no release. Correct for a drum; wrong for a pitched instrument. (High.)

**D11 — The lane's own processing surface is unreachable.** `filter=` and `fx=` are expressible and
render but have no CLI or MCP verb (§1.3). A keymap therefore ships with a wide-open filter and no
effects unless someone hand-edits the file. (High.)

### 4.1 What keymap-v2 takes — two honest paths

**v2a, inside the lane vocabulary (size M).** Fixes D1, D2, D9, D11.

- *Multi-zone.* N one-shots at spaced roots; each minted lane picks its nearest zone. This needs **no
  format change** — every lane already names its own sample id, so a keymap is already free to point
  different lanes at different media. It is arithmetic on top of `planKeymap`: extend `KeymapOptions`
  to take a list of `(sampleId, rootMidi)` and choose per lane. 132 estimates "even 3 per octave kills
  the worst repitch artifacts."
- *Root verification.* Render one minted lane, re-detect with `detectPitch`, refuse on mismatch. Every
  piece exists (`renderTrackSolosCommand` + `sample-info`'s detector); it is a loop nobody has closed.
- *Pre-audition.* Make `--count N` + board the documented path into a keymap rather than a separate
  workflow.
- *Reach the lane's filter and fx.* Add `filter`/`fx` to `setLaneParamPath`'s accepted keys, or expose
  `setLaneBacking` on the CLI. Small, and it is what makes a keymap *producible*.

**v2b, the endgame `keymap.ts` already names: a `sampler` track kind (size L).** Fixes D3–D8, D10.

Notes, not hits. A zone table — `(sample, rootMidi, loMidi, hiMidi, loVel, hiVel, roundRobinGroup,
loopStart, loopEnd)` — and a polyphonic voice pool that allocates one `ToneBufferSource` per sounding
note rather than one `Player` per lane, which fixes D6 by construction. ADSR rather than AHD.
Round-robin, velocity layers and sustain loops all belong here and nowhere else: each is a
"which sample, and how does it sustain" question, which is a zone-table question, not a lane question.
This is the same thing the "One-shot sampler instrument track kind" roadmap row already describes.

**Recommendation, with the honest caveat attached.** Build v2a. It moves the measurable number, it
also upgrades every gen-kit tonal role, and it is mostly arithmetic and verification. But do not
oversell it: 132 ranks keymap-v2 fifth of six and its own gap attribution says roughly half the
~40-point gap is composition, most of the remainder is production and mix placement, and only "a
minority residual" is raw source timbre. Its headline is blunter still: *"Sampling per se buys
nothing; production and sound-design density buy everything."* keymap-v2a is worth building because
sampling should not be *worse* than it has to be, not because it wins the showdown.

---

## 5. How sampling and layering compose

`buildLayeredClip(role, phrase, bpm, {produced})` assembles three or four **synth** tracks from one
shared `ComposedPhrase`. Each `LayerSpec` carries a `figure` (register, note-selection, articulation),
one `band` (the crossover), a `gainDb` ("the balance IS the instrument"), a `patch:
Partial<BeatSynth>`, a `mono` flag, and optional `production`. The governing rule is quoted in the
module itself: *"every layer plays the SAME musical figure — a stack playing different notes is an
arrangement, not an instrument — so the only transforms allowed are register, voice-selection and
articulation."* Onsets never move.

The mined layering corpus independently endorses the sample-plus-synth combination — its rules are
"combine dissimilar sounds, not identical ones," "match pitch/vibrato character across a crossfade
join," and "detune+pan duplicate copies for width" — and §12's flip analysis adds that layering plus
tweaking, not serial effects, is what actually disguises a source.

What a **sampled layer** would require, in order of increasing cost:

1. **A layer whose source is not a `BeatSynth`.** `LayerSpec.patch` is typed `Partial<BeatSynth>` and
   `layeredScratchText` emits `track <id> <Label> <color> synth`. Minimally this becomes a
   discriminated union: `source: {kind:'synth', patch} | {kind:'sample', media, rootMidi} |
   {kind:'audio', media, in, out}`. (S, mechanical.)

2. **The crossover — this is the blocker.** `LayerBand` is implemented as the track's one filter, and
   `checkCrossover` enforces exactly one lowpassed bottom layer with everything above it highpassed at
   ≥ half the bottom cutoff. A sample-backed drum lane HAS a filter (`params.cutoff/resonance` +
   `filterType`), so a **pitched or percussive sampled layer is reachable today**. An audio track has
   none, so a **loop/texture sampled layer is blocked on §3.2**. The mined corpus's own crossover
   recipe (186 Hz / 200 Hz asymmetric) is a filter recipe; without a filter there is nothing to apply
   it to.

3. **One drums track per sampled layer, not one lane per layer.** Per-lane effect *types* are per-lane
   but their *parameter values* are read from the drums track's synth block — the documented tradeoff:
   "every lane on a track sharing an effect TYPE shares that type's knob values." Two sampled layers
   on one drums track therefore cannot carry different production. And `monoViolations` inspects
   `BeatSynth` fields (pan, unison, chorus, reverb send), which live on the track, not the lane. So the
   host for a sampled layer is a whole drums track. Structural, and worth stating before anyone
   implements it the cheap way.

4. **Onset alignment is NOT free for a sample layer.** `layered.ts` gets it by construction for notes
   ("`layerNotes` may change a layer's register, its voice selection, its note LENGTH and its velocity,
   but it never moves a `start`"), and the mined transient corpus's most-repeated rule is that layers
   must be sample-aligned or the transient smears. A one-shot with 12 ms of leading silence puts its
   layer 12 ms late. `prepOneshot`'s −60 dBFS trim happens to fix this for anything ingested through
   `beat source add` — but *not* for a raw-ingested chop (§2.4), which is exactly the material a
   sampled layer wants. So a sampled layer needs an explicit align step: measure the first sample above
   threshold, write it into the lane's `params.start`. One number, computable with code that exists.

5. **A pitched sampled layer must play the figure, so §5 depends on §4.** Playing the same figure means
   a keymap, and a keymap today has D1–D8. A *percussive or textural* sampled layer escapes this — it
   plays on the figure's onsets, which `layerNotes` already yields — and that is the cheaper first
   target.

**Minimum viable proposal.** `LayerSpec.source` as a union; a `sample` layer hosted on its own drums
track with keymapped lanes; onset-aligned; band via the lane filter; production via the drums track's
synth block; verified by the existing `scripts/layered-check.mjs` target bands. Size **M**. What it
unblocks is precisely what 131 measured dotbeat missing: packs put 60.1% of their energy below 60 Hz
and engineplus bass puts 0.22% there — "the sub layer is a real recorded 808" is a sampled-layer move,
and so is "the air layer is a reversed cymbal."

---

## 6. The build plan

Every item lists size, what it unblocks, and how it is validated. Validation is deliberately split:
things that change *how something sounds* get a blind showdown arm; things that change *how long the
owner spends* get an owner-time measurement; things that change neither get a golden test.

| # | Build | Size | Unblocks | Validation |
|---|---|---|---|---|
| 1 | **`beat stem-split`** — expose `src/analysis/stems.ts` as a verb (+ `python/README.md` row, `--doctor`) | XS | Chopping drums/vocals/bass out of found music; cleaner keymap sources | Owner-time-saved. Existing sidecar tests already cover the module |
| 2 | **`beat chop`** + chop provenance sidecar + gitignored default + `--raw` ingest (§2.1, §2.4) | S | The entire finding loop | Owner-time: "6-minute track → 3 chosen chops," before/after. Golden test on cut points against a stub-backend artifact |
| 3 | **Chop provenance in `beat board`** + ranking (§2.2, §2.3) | S | Auditioning 180 bars without listening to 180 bars | Owner-time-saved, same measurement as #2 |
| 4 | **`beat resample`** (§3.1) | S | Every technique in §3; the "recording → instrument" conversion; degrade-before-commit | Golden test: a resampled track renders comparably to the source track's solo render. Not a showdown arm — it changes nothing about the sound by design |
| 5 | **Audio tracks get an effect chain** (§3.2) | S–M | Filtering, saturation, lo-fi, grain delay on sampled loops; `beat trick` on audio; §5 item 2 | **Blind showdown arm.** Pre-registered: chops from the refs-packs pool, produced vs unproduced, run through the existing `beat showdown`/`beat rate` flow. Question: does a produced chop beat an unproduced one, and does either enter ref band? |
| 6 | **`beat audio-reverse`** as a file op (§3.4) | XS | Reverse crashes/risers/reverb; a corpus-named ubiquitous technique dotbeat cannot do at all | Golden test (bit-exact reversal) |
| 7 | **`beat slice`** — transient/grid slices to lanes via `start`/`length`, plus a real choke-group declaration (§3.3) | S | Playable breaks; MPC-style rearrangement | Owner-time-saved + a golden test on computed slice points |
| 8 | **Reach the lane's `filter=`/`fx=`** from CLI/MCP (§1.3, D11) | XS | Producing anything that lives on a drum lane, including every keymap | CLI↔MCP parity-table row (the repo's own structural rule) |
| 9 | **Region `fadeIn`/`fadeOut`** (§3.6) | S | Chops that don't tick | Golden test |
| 10 | **keymap-v2a** — multi-zone + root verification + pre-audition (§4.1) | M | Sampled tonal material that isn't obviously a repitched one-shot; also every gen-kit tonal role | **Blind showdown arm**, keymap. Pre-registered: 32–38% → ≥50% pairwise over ≥8 batches |
| 11 | **Sampled layer in `layered.ts`** (§5) | M | "The sub is a real 808"; the measured sub/air deficits | **Blind showdown arm** on the existing `layered`/`layeredplus` arms, plus `scripts/layered-check.mjs`'s 24 target bands (currently engineplus 3 / layered 19 / layeredplus 18) |
| 12 | **`sampler` track kind** — zone table, polyphony, round-robin, velocity layers, sustain loops, ADSR (§4.1 v2b) | L | Everything D3–D8 and D10; a sampled *instrument* rather than a pitched drum machine | Showdown arm, after #10 has established the multi-zone baseline to beat |
| 13 | **`warp complex`** — grain-based stretch (§3.5) | L | Chops at arbitrary tempos; Texture-mode pad-from-a-one-second-sound | Showdown arm, last |

Items 1–4 are one focused stream and they deliver the owner's stated ask ("tools to speed up the
process") end to end. Item 5 is the single engine change worth arguing for on its own merits.

### What NOT to build

- **A CLAP-indexed local sample search** (121 §3.5 item 2). The obvious next thing, and premature. The
  library today is 165 role-sorted pack loops in four folders. Folder + filename + `beat chop`'s
  provenance table finds the right file in seconds; a CLAP index is a multi-GB dependency solving a
  problem that starts at maybe two thousand files. 121 also flags that CLAP scored below chance on
  intra-batch preference — retrieval is fine, but an index in the codebase *will* creep into ranking.
  Revisit when the library crosses ~2,000 files.
- **Ranking or rejecting chops with the learned taste model** (§2.2). Same reasoning, sharper: the
  model has never seen a chop, and a false reject costs the sample.
- **A waveform editor with drag-to-trim and zoom.** The owner's listening happens in a player; the
  numbers come from `sample-info` and `metrics`; the choosing happens in `board`. The existing static
  waveform in `AudioClipEditor.tsx` is the right amount of GUI, and the mined corpus's own
  zero-crossing advice is better served by *snapping automatically* than by asking a human to zoom.
- **`warp complex` before items 1–11.** It sounds like the headline feature and it is the worst
  leverage on the list: an L-sized WASM dependency for a problem that downbeat-aligned cutting plus
  tempo-conforming largely dissolves.
- **A second provenance mechanism.** `media/<id>.wav.json` exists and is enforced. Extend it.
- **Auto-registering chops into the media block.** Batch-then-adopt is this repo's established pattern
  and it exists precisely so losing candidates never pollute a project.
- **A `reverse` field on `BeatAudioRegion`** (§3.4) — the file op is smaller, needs no format bump, and
  composes with the rest of the toolkit.

---

## 7. Proposed text for a numbered decision — supplied, not applied

**Not written to `docs/decisions.md`.** That file currently has two entries numbered D23 (the
2026-07-17 offline-render one, filed out of numeric order, and the 2026-07-22 GPL one that every other
document cites as "D23"), and no D20 at all. Renumbering is an owner call, so the text below is
supplied for the owner to paste at the top of the file, matching the house shape: newest first,
`## D<N> — <lower-case summary> (YYYY-MM-DD)`, bold lead-in fields, terminal `**Revisit when:**`.
The highest number currently in the file is D29, so this drafts as **D30**.

> ## D30 — sampling and synthesis are both first-class; the sampling investment is a TOOLKIT around the owner's ears, not an automation of them (2026-07-26, owner)
>
> **The decision (owner, verbatim intent).** D26 chose synthesis-toward-commercial over leaning
> further into hosted generation, and research 121 §3.5 filed samples as a parallel track behind it.
> The owner rules that this is not an either/or: "This is a 'both and' situation. We want to make the
> synths be able to create clips that rival producer-level clips. We also want to have a robust method
> of sampling." D26's direction for the synthesis side stands unchanged. Sampling is promoted from a
> rider on the lowest-priority row to its own pillar, funded on its own terms.
>
> **What the sampling pillar is, and what it is not.** It is a toolkit, not an automation. The owner's
> own framing of the work: "The tricky part with sampling is that, in my experience, it requires
> careful listening and cutting/clipping music. Maybe there are some tools we could create to speed up
> the process — like systems that are aware of the beat, bars, etc, where we might know how to break up
> a song — but my guess is I'll need to listen to find interesting samples. Then, there are production
> tricks to mess with a sample... What's valuable with sampling is building out the toolkit such that
> we can utilize sampling in an interesting way." So: the harness removes every step around the
> listening — beat/bar/section-aware cutting, deduplication and ordering of candidates, a non-blind
> audition surface with provenance shown, licence capture at import, and a rich manipulation surface
> afterward. It does not rank, score or reject candidate samples on the owner's behalf. Ordering and
> deduplication are safe (a mistake costs a scroll); rejection is not (a mistake costs the sample), and
> the taste model and CLAP have both measured below chance on the judgement this would require.
>
> **Two standing constraints.** (1) Chops of commercial music are private, on the same footing
> `--ref-dir` reference clips already have: read-only originals, working copies behind a generated
> `.gitignore`, origin recorded as a reference, never committed — royalty-free is not redistributable,
> and research 120's Splice AI-training exclusion continues to apply to anything that could enter a
> training mix. (2) Nothing enters a document's media block without an asserted licence and an enforced
> `media/<id>.wav.json` provenance sidecar; the fast raw-registration path (`beat sample`) is brought
> under that rule rather than left as an exception.
>
> **Revisit when:** the sampling toolkit's first blind arm (a produced sampled chop against the existing
> engineplus/layered arms) comes back at or below the unproduced control, which would mean the
> manipulation surface — not the finding loop — was the wrong half to fund first.

---

## 8. Honest gaps

- **Nothing was run.** No chop was cut, no render made, no keymap built, no number in this document is
  new measurement. Every quoted figure comes from research 120/131/132/139 or from reading source.
- **All sizes are judgement, not spikes.** XS/S/M/L reflect how much existing machinery each item
  reuses, which I verified, and not how long anything takes, which I did not.
- **The mined manipulation corpus landed late and I read six of its twelve sections in full** (chopping,
  reversal, resampling, filtering, lo-fi, granular, rhythmic mangling, the flip, digging criteria) plus
  its summary and sources. Sections 2, 3, 10 and 11 I read only through the summary. The corpus itself
  flags granular as its weakest section (403/429 fetch failures) and reverse as thinly sourced on
  parameters. §3.5's grain-vs-phase-vocoder argument rests on a single Ableton-manual reading.
- **D7 (per-lane buffer duplication) is read, not measured.** I did not confirm 15 network fetches for a
  15-lane keymap in a running engine; I read the code path that would produce them.
- **D6's musical consequence is inferred.** The retrigger semantics are verified at the library level;
  that they are *audible* on this workflow's material is my reasoning, not a listening test, and it is
  the kind of claim this repo's own history says to check by ear before acting on.
- **§5's claim that the crossover is the blocker assumes the crossover is genuinely load-bearing.**
  `layered.ts` asserts it and the 6-clip target check moved 3 → 19, but that check cannot isolate the
  crossover's contribution from the register and balance changes shipped alongside it.
- **Whether producing a chop moves the owner's ear is entirely unmeasured.** That is exactly what build
  item 5's arm exists to find out, and it is the load-bearing bet of this whole plan.
- **No legal read.** Research 120's Splice AI clause and the D25 exclusion are quoted, not re-verified,
  and "assert your own licence" remains the only honest posture the tooling can enforce.
- **The `beat chop` ranking design is unvalidated.** Max-min-distance over the existing feature vector
  is a reasonable default and I have no evidence it selects *musically* distinct chops rather than
  merely spectrally distinct ones. It should ship with `--rank order` documented as the fallback for
  when it disappoints.

---

## Sources

**Repo (all read this pass).** `src/core/document.ts` · `src/core/parse.ts` · `src/core/serialize.ts` ·
`src/core/edit.ts` · `src/core/keymap.ts` · `src/analysis/import.ts` · `src/analysis/pitch.ts` ·
`src/analysis/stems.ts` · `src/analysis/gen-trim.ts` · `src/vary/batch.ts` · `src/vary/audition.ts` ·
`src/taste/layered.ts` · `src/metrics/wav.ts` · `python/analyze.py` · `scripts/source-lib.mjs` ·
`scripts/prep-oneshot-lib.mjs` · `cli/beat.mjs` · `cli/render.mjs` · `cli/board.mjs` ·
`src/mcp/server.ts` · `src/daemon/daemon.ts` · `ui/src/audio/engine.ts` · `ui/src/audio/waveform.ts` ·
`ui/src/components/AudioClipEditor.tsx` · `scripts/roadmap-data.mjs` ·
`node_modules/tone/build/esm/source/{Source,buffer/Player}.js`.

**Prior research.** `docs/research/120-high-quality-eval-refs.md` ·
`121-harness-engineering-for-music-agents.md` §2.4, §3.5, §3.7 · `131-quality-gap-empirical.md` ·
`132-sound-source-expansion.md` §1-§3, §5 · `138-splice-parity-plan.md` ·
`139-recipe-library-and-layering.md` · `docs/source-showdown-eval.md` · `docs/decisions.md` (D16, D21,
D23×2, D24, D25, D26, D27, D29).

**Mined practitioner corpus** (fetched 2026-07-26 by a sibling pass; full source list in that file).
`sample-manipulation.md` — Sound On Sound "Lost Art of Sampling" Pt.3-6 and "Sample Slicing: Beatmaking
With Hardware"; Attack Magazine "Resampled Pads with Spitfire Audio Tundra & Ableton Simpler",
"Resampled Deep House Rhodes", "No Strings Attached: Resampling Custom String Samples", "Working With
Samples: The Secrets of Dance Music Production", "Glitchy Chord Lead in Ableton Live", "MIDI
Probability Drums…", "DJ Boring – Winona", "The Rights and Wrongs of Sampling", "Is There A Secret To
A Truly Great Remix?"; Ableton Live manual, audio clips / tempo / warping; Splice "How to chop
samples" and "Sampling in Hip Hop: 4 Key Eras"; Tracklib music-sampling guide and the Kenny Mann
feature; Wikipedia, Sampling (music). Also `pack-production.md` (Splice quality principles; loop-point
and fade QC gates) and `layering.md` / `transients.md` (onset alignment, layer-dissimilar rules).
