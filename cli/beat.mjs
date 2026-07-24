#!/usr/bin/env node
// beat — the unified CLI (docs/phase-2-plan.md §2.4). One entry point over the .beat toolchain:
//
//   beat inspect <file> [--json]                     project overview (or the parsed doc as JSON)
//   beat set <file> <path> <value> [<path> <value>]  surgical edits, canonical write, edit-list output
//   beat add-note <file> <track> <pitch> <start> <dur> <vel>
//   beat rm-note <file> <track> <note-id>
//   beat diff <a.beat> <b.beat>                      semantic diff: reads like an edit list
//   beat diff --git <rev1> <rev2> <file>             same, between two git revisions
//   beat render <file> -o out.wav                   render to WAV (dotbeat's own engine, headless Chromium)
//   beat daemon <file> [--port 8420]                 two-way sync with a running dotbeat GUI
//
// diff exit codes follow diff(1) convention: 0 = no musical changes, 1 = changes, 2 = error.
// Requires `npm run build` (reads compiled ../dist/src/core).

import { readFileSync, writeFileSync, existsSync, readdirSync, rmSync, mkdirSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  parse,
  saveClip,
  setScene,
  placeClip,
  unplaceClip,
  renameScene,
  setSong,
  songMove,
  insertScene,
  setMediaSample,
  setLaneSample,
  clearLegacyLaneSamples,
  addEffect,
  removeEffect,
  moveEffect,
  setEffectEnabled,
  serialize,
  setValue,
  addNote,
  removeNote,
  addHit,
  removeHit,
  setAutomationPoint,
  applyAutomationShape,
  addAudioClip,
  splitAudioClip,
  humanize,
  BeatHumanizeError,
  quantizeNotes,
  transposeNotes,
  timeScaleNotes,
  fitToScaleNotes,
  invertNotes,
  reverseNotes,
  legatoNotes,
  consolidateRatchet,
  SCALE_NAMES,
  addTrack,
  removeTrack,
  addGroup,
  removeGroup,
  renameGroup,
  setGroupColor,
  setGroupTracks,
  initDocument,
  defaultDrumKitLanes,
  diffDocuments,
  formatDiff,
  describeDocument,
  parsePresetLibrary,
  applyPreset,
  formatPresetList,
  filterPresetsByCategory,
  PRESET_CATEGORIES,
  parseMacroLibrary,
  applyMacro,
  formatMacroList,
  BeatMacroError,
  parseDrumKitLibrary,
  applyDrumKit,
  formatDrumKitList,
  parseSelection,
  serializeSelection,
  selectionToVaryScope,
  BeatSelectionError,
  formatNumber,
  BeatEditError,
  BeatParseError,
  BeatPresetError,
  BeatPitchTimeError,
} from '../dist/src/core/index.js'
import { decodeWav, analyze, lint, formatLint, RENDER_RUN_VARIANCE_META, buildProfile, serializeProfile, parseProfile, BeatProfileError } from '../dist/src/metrics/index.js'
// --- Phase 37 Stream RB begin ---
import { analyzeStructure, formatStructure, BeatAnalysisError } from '../dist/src/analysis/index.js'
// --- Phase 37 Stream RB end ---
// ==== Phase 38 Stream SA begin ====
import { validateAnalysisArtifact, buildSkeleton, formatSkeletonReport } from '../dist/src/analysis/index.js'
// ==== Phase 38 Stream SA end ====
// ==== Phase 38 Stream SB begin ====
import { runAnalysis, sidecarDoctor, defaultAnalysisPath } from '../dist/src/analysis/index.js'
// ==== Phase 38 Stream SB end ====
// ==== production tricks (research 118) ====
import {
  parseTrickLibrary,
  applyTrick,
  suggestForDocument,
  siblingRenderFeatures,
  failingPreconditions,
  firingCounters,
  formatTrickList,
  formatTrickCard,
  TRICK_AXES,
  BeatTrickError,
} from '../dist/src/analysis/index.js'
// ==== production tricks end ====
// ==== Phase 40 Stream VA ====
// Pitch-aware sampling: detection (pure TS, no Python — decisions.md D20) and the tune arithmetic
// that turns a root into a keymap. keymap.js is deep-imported rather than routed through
// core/index.js so this stream adds no line to a file two sibling streams are also editing.
import { detectPitch, formatPartials, formatPitchLine, PITCH_CONFIDENCE_MEDIUM } from '../dist/src/analysis/index.js'
import { buildKeymap, planKeymap, noteToMidi, midiToNote, rateForPitch } from '../dist/src/core/keymap.js'
// ==== end Phase 40 Stream VA ====

// ---- usage / per-command help (Phase 34 Stream NB, pilots 94 & 97) --------------------------
// The old monolithic USAGE template literal, restructured as one entry per command so
// `beat <cmd> --help` and `beat help <cmd>` can print just that command's block (plus a
// "related:" pointer to its natural family). The no-args full dump is regenerated from the same
// entries below, so there is exactly one source of truth and the dump reads as it always has.

const PATHS_NOTE = `paths for set: bpm | loop_bars | selected_track | <track>.<synth param> | <track>.name |
               <track>.color | <track>.pattern.<lane>[<step>]`

// Natural command families, surfaced as a "related:" line under per-command help — the loop a
// command belongs to is half of understanding it (vary is meaningless without score/suggest).
const HELP_FAMILIES = [
  ['vary', 'audition', 'score', 'adopt', 'suggest', 'taste-eval', 'match'], // the taste loop (docs/taste-loop-design.md)
  ['taste-seeds', 'taste-collect', 'showdown', 'prodtask', 'pilot', 'rate', 'taste-eval'], // the data-collection pipeline (seeds -> batches -> rate -> eval; showdown = per-role source comparison; prodtask = per-role production-task eval; pilot = the T5 critic-guided QD search)
  ['trick', 'prodtask', 'rate'], // production tricks + the blind eval that validates them (docs/prodtask.md)
  ['pilot', 'taste-eval', 'rate', 'score'], // the T5 overnight critic-guided QD search (docs/pilot.md, research/117)
  ['checkpoint', 'history', 'restore', 'pin', 'unpin', 'pins'],
  ['effect-add', 'effect-rm', 'effect-move', 'effect-bypass'],
  ['clip', 'scene', 'scene-set', 'place', 'unplace', 'song', 'song-move', 'song-insert'],
  ['add-note', 'rm-note', 'add-hit', 'rm-hit'],
  ['render', 'feedback', 'metrics', 'lint'], // Phase 37 Stream RA: the render -> listen loop
  // ==== Phase 38 Stream SA begin ====
  ['analyze', 'skeleton', 'analyze-structure', 'source'], // Phase 38: audio import -> skeleton -> critique
  // ==== Phase 38 Stream SA end ====
  // ==== Phase 40 Stream VA ====
  ['sample', 'sample-info', 'keymap', 'lane'], // Phase 40: register a sound -> read its pitch -> play a melody with it
  // ==== end Phase 40 Stream VA ====
  // ==== gen-kit ====
  ['gen-kit', 'source', 'rate', 'score', 'adopt', 'regen'], // compose from generated sounds -> re-pick through the taste loop
  // ==== end gen-kit ====
]

/** One entry per command, in the exact order the full dump prints them. `text` is the command's
 * whole usage block verbatim (2-space indent, aligned description column), covering every form
 * of the command (e.g. vary's three invocations and --groups live in the one `vary` entry). */
const HELP = [
  { cmd: 'init', text: `  beat init <file> [--bpm 120] [--bars 2]               a fresh project with one starter track` },
  {
    cmd: 'add-track',
    text: `  beat add-track <file> <id> <synth|drums|instrument|audio> [--name N] [--color #hex] [--soundfont <sample-id> --program N] [--legacy-lanes]
                                                          (a fresh drums track defaults to the 12-lane kit; --legacy-lanes opts back into the old implicit 5;
                                                          a fresh synth or drums track also starts with a real, already-populated default effect chain —
                                                          eq3 -> comp -> distortion -> bitcrush, all enabled — not an empty one; see beat effect-add)`,
  },
  { cmd: 'rm-track', text: `  beat rm-track <file> <id>` },
  {
    cmd: 'group',
    text: `  beat group <file> <id> <track-id> [<track-id> ...] [--name N] [--color #hex]
                                                          fold N existing tracks into one named, colored
                                                          group (a track belongs to at most one group)`,
  },
  { cmd: 'rm-group', text: `  beat rm-group <file> <id>                                ungroup (member tracks are kept, untouched)` },
  {
    cmd: 'group-set',
    text: `  beat group-set <file> <id> [--name N] [--color #hex] [--tracks id,id,...]
                                                          rename/recolor a group or replace its whole
                                                          membership list (add/remove/reorder members)`,
  },
  { cmd: 'inspect', text: `  beat inspect <file> [--json]` },
  // ==== Phase 38 Stream SB begin ====
  {
    cmd: 'analyze',
    text: `  beat analyze <audio.wav> [--backend beatthis|stub|allin1] [--force] [-o out.json] [--json]
                                                          detect tempo/beats/downbeats/sections in a real WAV via the
                                                          Python sidecar; writes a cached <audio>.analysis.json (feed it to
                                                          beat skeleton). Default backend beatthis (needs the owner-side venv;
                                                          stub is a deterministic no-deps grid for testing). --force re-analyzes.
                                                          NOTE: for the SYMBOLIC analysis of a .beat file, use analyze-structure.
  beat analyze --doctor                                   report the Python interpreter + which backends are installed`,
  },
  // ==== Phase 38 Stream SB end ====
  // --- Phase 37 Stream RB begin ---
  {
    cmd: 'analyze-structure',
    text: `  beat analyze-structure <file> [--json] [--root N] [--scale name]
                                                          symbolic song analysis (no rendering): per-section onset
                                                          density, syncopation, pitch-class vs scale, repetition/novelty.
                                                          --root 0-11 (0=C) + --scale (major/minor/dorian/…) enable the
                                                          in-scale readout; omit both for scale-agnostic histograms`,
  },
  // --- Phase 37 Stream RB end ---
  {
    cmd: 'set',
    text: `  beat set <file> <path> <value> [<path> <value> ...]     e.g. beat set song.beat lead.cutoff 900 bpm 124
                                                          declared drum lanes: <track>.lane.<name>.<param> <v>
                                                          (synth-backed: tune/punch/decay/tone; sample-backed:
                                                          start/length/attack/hold/decay/cutoff/resonance/gainDb/
                                                          tune; empty value reverts a param to its default)`,
  },
  {
    cmd: 'add-note',
    text: `  beat add-note <file> <track> <pitch> <start> <duration> <velocity 0-1>
                                                          velocity is 0.0-1.0, NOT MIDI's 0-127 (e.g. 0.8, not 100)`,
  },
  { cmd: 'rm-note', text: `  beat rm-note <file> <track> <note-id>` },
  {
    cmd: 'add-hit',
    text: `  beat add-hit <file> <track> <lane> <start> <velocity 0-1> [duration]   free-timed drum hit (start/duration in fractional 16th steps;
                                                          velocity is 0.0-1.0, NOT MIDI's 0-127 — e.g. 0.9, not 110)`,
  },
  { cmd: 'rm-hit', text: `  beat rm-hit <file> <track> <hit-id>` },
  {
    cmd: 'quantize',
    text: `  beat quantize <file> <track> [--grid 1] [--amount 1] [--ends] [--no-starts] [--notes id,id]
                                                          snap notes toward the grid (grid in 16th steps:
                                                          1=16ths 2=8ths 4=quarters 0.5=32nds; amount<1 = partial)`,
  },
  {
    cmd: 'humanize',
    text: `  beat humanize <file> <track> [--timing 0.15] [--velocity 0.06] [--push-late 0] [--swing 0] [--seed N] [--lanes hat,openhat | --ids a,b]
                                                          make a stiff part feel played: seeded timing/velocity
                                                          jitter, behind-the-beat drag, offbeat swing; scope by lane/id`,
  },
  { cmd: 'transpose', text: `  beat transpose <file> <track> <semitones> [--notes id,id]      shift pitch (clamped to MIDI 0-127)` },
  {
    cmd: 'time-scale',
    text: `  beat time-scale <file> <track> <factor> [--notes id,id]        stretch time (2 = x2, 0.5 = ÷2), anchored at the
                                                          earliest scoped note so a selection stretches in place`,
  },
  {
    cmd: 'fit-scale',
    text: `  beat fit-scale <file> <track> <root 0-11> <scale> [--notes id,id]   snap pitches to the nearest tone in a scale
                                                          (root: 0=C..11=B; see --list-scales)
  beat fit-scale --list-scales                            list the valid <scale> names`,
  },
  { cmd: 'invert', text: `  beat invert <file> <track> [axis-pitch] [--notes id,id]  mirror pitch around axis (default: selection's own mean)` },
  { cmd: 'reverse', text: `  beat reverse <file> <track> [--notes id,id]              tape-reverse the scoped notes' time span` },
  { cmd: 'legato', text: `  beat legato <file> <track> [--gap 0] [--notes id,id]     extend each note to the next note's start` },
  {
    cmd: 'consolidate',
    text: `  beat consolidate <file> <track> [--notes id,id]          bake ratcheted notes (ratchetCount>1) back into
                                                          discrete notes (the ratchet "consolidate" action)`,
  },
  {
    cmd: 'diff',
    text: `  beat diff <a.beat> <b.beat>
  beat diff --git <rev1> <rev2> <file>`,
  },
  {
    cmd: 'presets',
    text: `  beat presets [--json] [--category <cat>]                list the factory preset library (optionally
                                                          filtered to one taxonomy category — see
                                                          --list-categories for the enumerated set)
  beat presets --list-categories                          list the valid --category values`,
  },
  { cmd: 'preset', text: `  beat preset <file> <track> <name>                       apply a preset to a track (a bag of set edits)` },
  {
    cmd: 'macro',
    text: `  beat macro list [--json]                                 list the factory macro library (a knob -> N target params)
  beat macro apply <file> <track> <name> <value>           apply a macro to a track at knob position 0..100
                                                          (resolves to literal set edits, same discipline as presets)`,
  },
  {
    cmd: 'trick',
    text: `  beat trick list [--json] [--axis width|air|motion|glue]  list the production-trick catalog (research 118)
  beat trick show <name>                                   full card: when/recipe/expect/counter/why
  beat trick apply <file> <track> <name> [--clip c] [--knob k] [--force] [--dry-run]
                                                          apply a trick's recipe as ordinary edits (prints the
                                                          honest applied list; refuses on counter-indications
                                                          unless --force; --dry-run previews without writing)
  beat trick suggest <file> [<track>] [--json]             rank the tricks whose preconditions pass (reads a
                                                          sibling <file>.wav render for metrics if present, else
                                                          document state only — renders nothing itself)`,
  },
  { cmd: 'drum-kits', text: `  beat drum-kits [--json]                                  list the factory drum-kit library (kit-808/kit-909/kit-acoustic)` },
  { cmd: 'drum-kit', text: `  beat drum-kit <file> <track> <name>                      apply a drum kit to a track (replaces its whole lane list)` },
  {
    cmd: 'vary',
    text: `  beat vary <file> <track> <group-or-lane> [--count 9] [--amount 0.25] [--seed N] [--out-dir d] [--render] [--audition] [--no-normalize] [--spread] [--exclude p1,p2]
                                                          batch-generate small-diff variants. On a declared-lane
                                                          drums track (every fresh/kit drums track), target a LANE
                                                          NAME (kick, hat, tom_lo, ...) — mutates that lane's own
                                                          backing params (synth voice tune/punch/decay/tone, or a
                                                          sample lane's start/length/AHD/filter plus gainDb/tune),
                                                          written as replayable beat-set lane paths; the legacy
                                                          kick/snare/hats groups error there (they mutate track-wide
                                                          params the engine never plays once lanes are declared).
                                                          Elsewhere, target a param group (see --groups).
                                                          --out-dir defaults to vary-<target>-<seed> NEXT TO the
                                                          .beat file, not the cwd; --audition implies --render and
                                                          stitches the wavs into one audition.wav + timecode index.
                                                          --spread explores each param's FULL musical range
                                                          (stratified bands — audibly distinct variants, what
                                                          taste-collect uses) instead of jittering near the current
                                                          value; --exclude leaves the named group params untouched.
                                                          Rendered variants are loudness-normalized by default (pure
                                                          gain to the batch-median LUFS; upward gains capped at -1
                                                          dBTP true peak — an already-hot render is never attenuated
                                                          — recorded in the manifest) so picks rate sound, not level
                                                          — the taste log's "louder wins" confound; --no-normalize
                                                          keeps the raw render loudness (levels still measured and
                                                          recorded).
  beat vary <file> <track> feel [--count 9] [--seed N] [--timing .15] [--velocity .06] [--push-late 0] [--swing 0] [--lanes hat,openhat | --ids a,b] [--spread] [--render] [--audition]
                                                          batch humanized FEEL variants (content variation) to audition + score
  beat vary <file> <track> feel --scope selection --port <p> [...same feel flags, minus --lanes/--ids]
                                                          scope to the GUI selection held by a running daemon instead of
                                                          typing --lanes/--ids by hand (lanes -> --lanes, bars/notes -> --ids)
  beat vary <file> <track> automation:<param> [--clip id] [--count 9] [--seed N] [--render] [--audition]
                                                          batch MOVEMENT variants of a clip's automation on <param>
                                                          (varies shape/depth/rate/phase, e.g. automation:cutoff) —
                                                          --clip picks WHICH clip's lane (default the track's first clip);
                                                          each variant carries a replayable beat automate-shape recipe;
                                                          scores/adopts through the same loop (see beat automate-shape)
  beat vary --groups                                      list the mutation groups (static; both modes documented)
  beat vary <file> <track> --groups                       list THAT track's real targets (lanes + live groups)`,
  },
  {
    cmd: 'automate',
    text: `  beat automate <file> <track> <clip> <param> <time> <value> [--id p1] [--interpolation linear|hold|curve]
                                                          add or move a clip automation point (time in fractional
                                                          16th steps from the clip's start; --id moves that point
                                                          if it already exists, else adds it with that id;
                                                          --interpolation sets the segment-shape this point starts,
                                                          default linear — omit on a move to keep the existing shape)`,
  },
  {
    cmd: 'automate-shape',
    text: `  beat automate-shape <file> <track> <clip> <param> <ramp|sine|triangle|exp|adsr> --from V --to V [--cycles N --points N --bars N]
                                                          fill a clip's automation lane with a predefined SHAPE (Phase 37):
                                                          ramp = linear from->to; sine/triangle = --cycles oscillations
                                                          between from and to; exp = eased curve; adsr = envelope. Emits
                                                          --points points (default 16) across the clip span (--bars, else
                                                          the clip loop / audio length / doc loop_bars). REPLACES any
                                                          existing lane for that param on the clip.`,
  },
  {
    cmd: 'clip',
    text: `  beat clip <file> <track> <clip-id>                      snapshot the track's CURRENT LIVE content into a clip
                                                          (re-snapshotting always starts from whatever's live on the
                                                          track right now, not empty — the same "capture current live
                                                          state" model the daemon's own "+ capture scene" uses; two
                                                          clips saved back-to-back without clearing the track in
                                                          between will share content, e.g. a "chorus" snapshotted on
                                                          top of "verse" content becomes verse-plus-chorus, not an
                                                          independent chorus — rm-note/rm-hit the live track's
                                                          existing content first if you want a fresh, independent
                                                          clip instead of an accumulated one)`,
  },
  {
    cmd: 'scene',
    text: `  beat scene <file> <scene-id> [<track>=<clip>[@<steps>] ...]
                                                          create/replace a scene's slot map — the command that MINTS a
                                                          scene (beat place only edits existing ones). Repeat a track for
                                                          multiple placements (v0.11), e.g. fx=riser1 fx=impact1@48;
                                                          @<steps> is fractional 16th steps from the section start
                                                          (omitted = 0). Multi-placement / @>0 is AUDIO tracks only for
                                                          now — synth/drum clips tile from the section start`,
  },
  {
    cmd: 'scene-set',
    text: `  beat scene-set <file> <scene-id> --name N|--clear-name  rename a scene (or clear its name, back to showing
                                                          just the id) — the scene IS the reusable bundle of
                                                          content, so its name follows it into every section
                                                          that reuses it`,
  },
  {
    cmd: 'place',
    text: `  beat place <file> <scene> <track> <clip> <at-steps>     add ONE placement of an already-saved clip to a scene's
                                                          track slot at <at-steps> (fractional 16th steps from the
                                                          section start). The scene must already EXIST — beat scene
                                                          mints scenes, place edits one placement. Audio tracks only
                                                          for at > 0 / multiple placements (v1); overlapping
                                                          placements on one track are an error`,
  },
  {
    cmd: 'unplace',
    text: `  beat unplace <file> <scene> <track> <clip>[@<at>]       remove ONE placement. @<at> is only required when the
                                                          same clip is placed more than once on that track (the
                                                          error lists the candidate at values); removing the last
                                                          placement drops the track from the scene entirely`,
  },
  { cmd: 'song', text: `  beat song <file> [<scene> <bars> ...]                   replace the song timeline (empty = loop mode)` },
  { cmd: 'song-move', text: `  beat song-move <file> <from-index> <to-index>           reorder a section — a two-line diff, not a rewrite` },
  {
    cmd: 'song-insert',
    text: `  beat song-insert <file> <index> <bars>                  insert a NEW section with a fresh, empty, independent scene at
                                                          <index> (0-based; song.length appends) — unlike song-move/song,
                                                          never reuses an existing scene id, so it can't share content with
                                                          any other section (docs/product-roadmap.md's "Independent
                                                          per-section scene editing" row); place clips into it afterward
                                                          via beat scene/beat_song. Requires song mode already.`,
  },
  { cmd: 'sample', text: `  beat sample <file> <sample-id> <wav-path>               register media (sha256 computed for you; path relative to the .beat)` },
  // ==== Phase 38 Stream SA begin ====
  {
    cmd: 'skeleton',
    text: `  beat skeleton <out.beat> <analysis.json> [--section-bars N]
                                                          scaffold a NEW, structure-matched empty project from a
                                                          *.analysis.json (from beat analyze): one empty scene per
                                                          distinct detected section label, a song block matching the
                                                          detected arrangement, tempo from the artifact. Refuses to
                                                          overwrite an existing out.beat. Labelless artifacts fall back
                                                          to uniform --section-bars (default 8) chunks. Fill the scenes
                                                          afterward with beat clip / beat place.`,
  },
  // ==== Phase 38 Stream SA end ====
  // ==== Phase 37 Stream RD begin ====
  {
    cmd: 'source',
    text: `  beat source search <query> [--max N] [--dur-min V] [--dur-max V] [--out-dir d]
                                                          find CC0 (public-domain) sounds on Freesound, top-rated first
                                                          (--out-dir also downloads each preview for auditioning);
                                                          NEEDS FREESOUND_API_KEY + network egress to freesound.org
  beat source add <file.beat> <sample-id> <local-audio-file> [--license L] [--note N]
                                                          OFFLINE: prep a file you already have (trim/fade/normalize)
                                                          and register it as media, writing an enforced provenance
                                                          sidecar media/<id>.wav.json. --license defaults to
                                                          "unspecified" (you assert the license; only the --freesound
                                                          path labels media "CC0-1.0")
  beat source add <file.beat> <sample-id> --freesound <id> [--note N]
                                                          GATED: fetch a specific CC0 sound from Freesound by id and
                                                          register it (label "CC0-1.0"); needs the key + egress. CC0
                                                          is the only license ever fetched (zero redistribution risk)
  beat source gen <file.beat> <sample-id> "<prompt>" [--seconds N] [--seed N] [--backend stub|stableaudio|fal] [--provider P] [--license L]
                                                          GENERATE a one-shot with Stable Audio Open (local text-to-audio)
                                                          and register it as media with a provenance sidecar. Default
                                                          --backend stableaudio (needs torch + the model, owner-side;
                                                          see python/README.md), default --seconds 2. --backend stub is
                                                          a deterministic, dependency-free tone bed. --backend fal
                                                          generates on fal.ai's GPUs (seconds per one-shot instead
                                                          of minutes; needs FAL_KEY) — default model Stable Audio 3
                                                          MEDIUM (1.4B params, licensed training data, outputs yours
                                                          under the Community License); --provider picks others:
                                                          fal-ai/stable-audio (Open, the local backend's model) or
                                                          fal-ai/stable-audio-25/text-to-audio (2.5, Stability
                                                          platform terms). "Powered by Stability AI"
  beat source gen --doctor                                report which generative backends are installed (JSON)` +
    // ==== Phase 40 Stream VB ====
    `
  beat source gen <file.beat> <sample-id> "<prompt>" --count N [--seed-from S] [--out-dir d] [--audition]
                                                          BATCH: generate N candidates of ONE prompt across seeds
                                                          S..S+N-1 into gen-<sample-id>-<S>/ next to the .beat and
                                                          register NOTHING — then rank them with \`beat score\` and
                                                          register the winner ALONE with \`beat adopt\` (the same two
                                                          verbs a vary batch uses). Losing candidates never enter the
                                                          media block; delete the batch dir to forget them. --audition
                                                          stitches the candidates into one audition.wav with a timecode
                                                          index (no render needed — they are already audio)`
    // ==== end Phase 40 Stream VB ====
  },
  // ==== Phase 37 Stream RD end ====
  // ==== Phase 40 Stream VC ====
  {
    cmd: 'regen',
    text: `  beat regen <file.beat> [--verify] [--id <sample-id>]     rebuild generated media from the provenance sidecars alone
                                                          (media/<id>.wav.json's prompt/seed/seconds/backend) — a fully
                                                          generated project is a RECIPE: clone it with an empty media/,
                                                          run this, get the song back. --verify regenerates to a temp
                                                          dir and reports per-sample sha256 match/differ WITHOUT
                                                          touching media/; --id does one sample. SLOW: ~2 min per
                                                          one-shot on CPU (a 10-sample project is ~20 min); the count
                                                          and estimate print before the run starts. Byte-identical
                                                          reproduction is verified same-machine/same-torch only — a
                                                          differing hash elsewhere is expected, not corruption.
                                                          Freesound/local-ingest media isn't generated, so it's skipped` },
  // ==== end Phase 40 Stream VC ====
  // ==== gen-kit ====
  {
    cmd: 'gen-kit',
    text: `  beat gen-kit <project-dir> [--roles kick,snare,hats,perc,bass,lead] [--candidates 4] [--bpm 96] [--key a] [--scale minorPentatonic] [--gen-backend fal|stub|stableaudio] [--seed 41]
                                                          compose a PLAYABLE .beat project entirely from generated
                                                          sounds — the recipe-song workflow as one command
                                                          (docs/gen-kit-pipeline.md). Per role: N candidate one-shots
                                                          (one subject x N distinct style prompts, taste-collect's
                                                          convention) land as a scoreable batch dir (group
                                                          genkit:<role>) registering NOTHING; a measurable default is
                                                          picked — drums by spectral centroid vs the role's target
                                                          band, bass/lead by pitch-detection confidence — and adopted
                                                          (deferred registration: losers never touch the media block);
                                                          tonal winners are keymapped into the project's key. Starter
                                                          patterns (simple seeded groove + in-key phrases) are written,
                                                          scene-placed and song-armed, so beat render is audible
                                                          immediately. Everything is deterministic in --seed for a
                                                          given backend; every asset carries a provenance sidecar, so
                                                          beat regen --verify replays the whole kit. Re-pick any role
                                                          later: beat rate <project-dir> (or beat score <batch> ...),
                                                          then beat adopt <batch> vN --force. Default --gen-backend
                                                          fal (needs FAL_KEY; seconds per sound); stub is the
                                                          dependency-free deterministic tone bed CI runs.`,
  },
  // ==== end gen-kit ====
  {
    cmd: 'lane',
    text: `  beat lane <file> <track> <lane> <sample-id|none> [gain] [tune]   back a drum lane with a sample ("none" reverts the lane
                                                          to its synth voice)
  beat lane <file> <track> --clear-legacy                 drop stale v0.5 \`lane\` sample lines from a DECLARED-lane track
                                                          (dead data there — playback reads the declarations; inspect
                                                          flags them). Errors on a legacy 5-lane track, where those
                                                          lines are live.`,
  },
  // ==== Phase 40 Stream VA ====
  {
    cmd: 'sample-info',
    text: `  beat sample-info <file> <sample-id> [--json] [--partials 8]
                                                          what IS this sound: detected pitch (+ note name, cents off),
                                                          confidence, duration, peak, centroid, and the top-partials
                                                          table (frequency, level, ratio to the lowest strong partial).
                                                          Pure TS — no Python, no venv. Read the TABLE, not just the f0:
                                                          two partials a semitone apart (ratio ~1.06) will beat against
                                                          themselves; a ratio like 1.80 means an inharmonic clang whose
                                                          pitch is a judgement call. LOW confidence is a real answer, not
                                                          a failure — bells and found percussion usually read low, and
                                                          the table is how you decide the root yourself.`,
  },
  {
    cmd: 'keymap',
    text: `  beat keymap <file> <track> <sample-id> --scale <name> --from <note> --to <note> [--root <note>] [--key <note>] [--gain dB] [--dry-run] [--force]
                                                          pitch-map ONE sample across a scale: mints one declared lane per
                                                          scale degree, named by note (a5, c6, …), each tuned to land the
                                                          sample on that pitch. The tunes come from the sample's DETECTED
                                                          fundamental, so they are right even when the sound came back
                                                          between notes (fractional tunes are normal and correct).
                                                          --root <note> states the root yourself and skips detection —
                                                          a first-class path, not a fallback: bells, plucks and found
                                                          percussion are exactly where detection is weakest, so expect to
                                                          use it. Refuses on a low-confidence detection (quoting the
                                                          partials and a ready-to-paste --root) rather than building a
                                                          wrong keymap; --force takes the detection anyway.
                                                          --key sets the scale's root (default: --from's pitch class).
                                                          --scale names: see beat fit-scale --list-scales.
                                                          --dry-run prints the lanes without writing.
                                                          A lane's tune is limited to -24..24 semitones, so a span more
                                                          than 2 octaves from the root errors, naming what IS reachable.`,
  },
  {
    cmd: 'audio-pitch',
    text: `  beat audio-pitch <file> <track> <clip-id> (--to <note> [--root <note>] | --semitones <n>) [--force]
                                                          repitch an audio-region clip by computing its warp rate for you
                                                          (sets warp repitch + rate). --to <note> detects the region's
                                                          fundamental and moves it to that note; --root <note> states the
                                                          region's current pitch instead of detecting it; --semitones
                                                          shifts by an interval with no detection at all (the honest
                                                          option for a chord or a pad, which has no single pitch).
                                                          Repitch is variable-speed: length changes with pitch.`,
  },
  // ==== end Phase 40 Stream VA ====
  {
    cmd: 'effect-add',
    text: `  beat effect-add <file> <track> <eq3|comp|distortion|bitcrush|eq7|autoFilter|autoPan|tremolo|utility|grainDelay|vinylDistortion|resonator> [--id id] [--index n] [--bypassed]
                                                          add an insert to a synth track's effect chain
                                                          (default: appended, enabled; order in the file IS chain order)`,
  },
  { cmd: 'effect-rm', text: `  beat effect-rm <file> <track> <effect-id>               remove an insert by id` },
  { cmd: 'effect-move', text: `  beat effect-move <file> <track> <effect-id> <new-index>  reorder — a two-line diff, not a rewrite` },
  {
    cmd: 'effect-bypass',
    text: `  beat effect-bypass <file> <track> <effect-id> <true|false>  bypass/re-enable one insert (real routing
                                                          bypass, not just its own mix knob — see beat_set's
                                                          <track>.effect.<id>.enabled path for the same edit)`,
  },
  {
    cmd: 'audio-clip',
    text: `  beat audio-clip <file> <track> <clip-id> <media-id> <in> <out> [gain] [warp off|repitch|complex] [rate]
                                                          create/replace an audio-region clip on an
                                                          'audio' track (in/out are seconds into the
                                                          source media); trim an existing clip's fields
                                                          with beat set <track>.clip.<id>.audio.<field> <v>`,
  },
  {
    cmd: 'audio-split',
    text: `  beat audio-split <file> <track> <clip-id> <at-step> [--id new-clip-id]
                                                          split-at-point: cuts one audio-region clip into
                                                          two at a timeline position (fractional 16th
                                                          steps from the clip's start), same media,
                                                          adjusted in/out — no DSP. v0.11: the second half
                                                          is auto-placed right after the first in every
                                                          scene that placed the original (reported in the
                                                          output), so a split never orphans arrangement`,
  },
  {
    cmd: 'score',
    text: `  beat score <batch-dir> <pick> [pick2 pick3] [--log f]   record a ranked pick (<=3) into the scores log
                                                          (pick is a variant number, "1" or "v1" both work;
                                                          --log defaults to beat-scores.jsonl NEXT TO the
                                                          batch's parent .beat file, not the cwd)`,
  },
  {
    cmd: 'adopt',
    text: `  beat adopt <batch-dir> <pick> [--force]                 copy the picked variant over the batch's parent .beat
                                                          (refuses if the parent changed since the batch was
                                                          generated — sha256 guard — unless --force; a running
                                                          daemon/GUI hot-reloads the adopted file automatically)`,
  },
  {
    cmd: 'suggest',
    text: `  beat suggest --taste <batch-dir> [--log f]            T4 (gate passed on 37 rated batches, 32% top-1 vs 20%
                                                          chance): pre-rank an UNSCORED rendered batch with the
                                                          taste model trained on your whole scores log — a listen-
                                                          in-this-order hint. ADVISORY only: never adopts, never
                                                          writes; your beat score pick is still the data.
  beat suggest --taste-next <collection-dir> [--log f]    T4 next-round proposal: coverage of your scored batches
                                                          vs the target data mix (taste-loop-design.md), concrete
                                                          collect commands for the under-covered splits, one
                                                          repeat-probe (self-consistency ceiling), and the
                                                          connectivity-anchor reminder. Advisory: runs nothing.
  beat suggest <file> <track> [--target <lane-or-id>] [--log f]
                                                          read the scores log and propose the next beat-vary round
                                                          (--log defaults to beat-scores.jsonl next to the .beat);
                                                          lane-aware on declared-lane drums tracks (cold start
                                                          recommends a real lane; never recommends a group that
                                                          would be an audio no-op on that track)`,
  },
  {
    cmd: 'taste-eval',
    text: `  beat taste-eval <file.beat | --log f> [--json] [--seed N] [--backfill] [--embed-backend clap|mert|stub|off] [--embed-model M] [--aes-backend aes|stub|off]
                                                          the taste-model eval harness (docs/taste-loop-design.md):
                                                          leave-one-batch-out held-out pick prediction over the
                                                          scores log — top-1/top-3/pairwise accuracy vs chance for
                                                          the built-in scorers (random, dsp-bt, and — when batch
                                                          renders still exist to embed — embed-bt and both-bt, the
                                                          T2 ablation) plus the learned taste directions. Embeddings
                                                          come from a Python sidecar (python/embed.py), cached next
                                                          to each wav: clap = LAION-CLAP (default, Apache-2.0),
                                                          mert = MERT-330M (stronger on music benchmarks; CC-BY-NC
                                                          weights, personal use only), stub = deterministic no-deps.
                                                          --aes-backend adds Audiobox-Aesthetics (CC-BY-4.0): four
                                                          NAMED axes per clip — CE content enjoyment, CU content
                                                          usefulness, PC production complexity, PQ production
                                                          quality — as explicit features (aes-bt / dsp+aes-bt in
                                                          the ablation) plus signed per-axis taste directions.
                                                          Scored batches carry per-variant DSP features in the log
                                                          since T0; --backfill derives them for older entries whose
                                                          batch renders still exist (rewrites the log, .bak kept).
                                                          When the log mixes round kinds, each scorer also reports
                                                          per-type splits — vary (track variations), gen (generated
                                                          samples, group "gen:<id>"), clip-set (beat audition dirs)
                                                          — same folds, attributed by the held-out batch's kind;
                                                          splits under 5 batches are labeled smoke (JSON: smoke).
  beat taste-eval --doctor                                report the embedding sidecar's readiness (interpreter +
                                                          per-backend deps), JSON`,
  },
  {
    cmd: 'match',
    text: `  beat match <target.wav> [--track-kind synth|drum-sampler] [--budget N] [--population N] [--out <dir>] [--seed N] [--no-clap]
                                                          T6 sound matching (docs/t6-sound-matching.md): CMA-ES
                                                          over the engine's continuous params against a 1-2s
                                                          target chop — can the engine make THIS sound, and how
                                                          close? Pitch frozen from f0 detection; osc/filter types
                                                          enumerated as short screening runs; staged search
                                                          (source params, then insert effects); target and every
                                                          candidate loudness-normalized before the loss (log-mel
                                                          multi-scale + MFCC + envelope). One offline engine
                                                          session serves the whole run; evals cached by candidate
                                                          hash (re-runs with a bigger --budget resume free).
                                                          Writes best.beat + best.wav, patch.txt (beat set lines),
                                                          loss-curve.jsonl, report.json (ceiling in MFCC + CLAP
                                                          cosine; CLAP degrades to a named reason without the
                                                          python sidecar). Default --budget 50 is smoke-scale;
                                                          real ceiling runs want 2000-5000.`,
  },
  {
    cmd: 'taste-seeds',
    text: `  beat taste-seeds <dir> [--count 8] [--seed 1]         generate synthetic seed SONGS (deterministic space:
                                                          tempo, key, progression, palette, drum feel) as the raw
                                                          material for taste data collection. Step 1 of the
                                                          collect->rate->eval pipeline (docs/taste-loop-design.md).`,
  },
  {
    cmd: 'taste-collect',
    text: `  beat taste-collect <dir> [--per-seed 2] [--count 5] [--gen N] [--gen-backend fal|stub|stableaudio] [--seed 41]
                                                          build the rating queue from a taste-seeds dir: --per-seed
                                                          vary batches per seed song (random track x group incl.
                                                          feel + drum voices, offline-rendered), --count variants
                                                          per batch, plus --gen generated-sample batches from a
                                                          stratified prompt bank
                                                          (drum one-shots, bass/plucks, pads/textures, vox chops,
                                                          risers — default backend fal, needs FAL_KEY). Failures
                                                          skip with a warning; everything lands as ordinary
                                                          score-able batches.`,
  },
  {
    cmd: 'showdown',
    text: `  beat showdown <dir> [--roles bassline,chords,lead,drum-loop] [--rounds 1] [--seed 41]
                [--gen-backend fal|stub|stableaudio] [--with-produced] [--with-surge] [--random-patches]
                [--ref-dir <path>] [--midi-dir <path>] [--seconds S]
                                                          build blind SOURCE-SHOWDOWN batches from a taste-seeds
                                                          dir: each batch is ONE musical role x one clip per
                                                          source — engine (the role's seed phrase, soloed, through
                                                          dotbeat's own synth, playing a role-mapped factory/curated
                                                          preset — docs/engine-presets.md; --random-patches keeps the
                                                          seed's historical random patch for era comparison, and the
                                                          engine/engineplus manifest from-strings record the patch
                                                          source [patch: random-seed-patch|factory:<name>|curated:<id>]),
                                                          gen (a fal-generated phrase from
                                                          the prompt bank's phrase tier), keymap (a generated
                                                          one-shot played as an instrument through the engine's
                                                          sampler lanes), optionally engineplus (--with-produced:
                                                          the SAME figure and patch as the engine clip plus a
                                                          production pass — unison/chorus width, saturation,
                                                          reverb/delay sends, eqHigh air — the "is it the synth
                                                          or the production?" ablation), optionally surge
                                                          (--with-surge: a composed figure through a Surge XT
                                                          factory patch via surgepy — pitched roles only,
                                                          drum-loop skipped; its own distinct figure unless
                                                          --shared-figure; needs a source-built surgepy, see
                                                          beat showdown --surge-doctor). With --with-surge AND
                                                          --with-produced together, a surgeplus clip is added: the
                                                          SAME surge render through a dotbeat production pass
                                                          (hosted as a sample voice on a drums-kind track — the
                                                          audio-playback track the engine produces; 'audio'-kind
                                                          tracks carry no effect chain — applying eqHigh air /
                                                          saturation / chorus / reverb+delay sends), isolating
                                                          production for surge as engineplus does for engine.
                                                          Optionally ref
                                                          (--ref-dir). With --midi-dir the composed sources
                                                          (engine/engineplus/keymap/surge) draw their figures
                                                          from MIDI files of commercial tracks instead of the
                                                          archetype bank (bass/chords/lead parts extracted via
                                                          python/midi_extract.py, transposed into the seed's
                                                          key; drum-loop keeps the bank; per-source distinct
                                                          files unless --shared-figure; unusable dir/files warn
                                                          and fall back to the bank) — holds COMPOSITION at
                                                          commercial quality so ratings compare sound
                                                          realization. Clips are duration-matched (trim/pad;
                                                          --seconds overrides the shortest-clip default) and
                                                          loudness-normalized to a
                                                          common LUFS; sources are seeded-shuffled into v-numbers
                                                          so rating stays blind. Rate with beat rate as usual.
  beat showdown --report [--log f] (or beat showdown <dir> --report [--json])
                                                          the scoreboard: per-source win / top-half / pairwise
                                                          rates from every scored showdown batch, overall and per
                                                          role, small-n splits labeled smoke (same convention as
                                                          taste-eval). See docs/source-showdown-eval.md.
        --ref-dir clips are PRIVATE chops of commercial music: the tool only ever READS under that
        path (originals untouched), the trimmed/level-matched working copies live in the batch dir
        behind a generated .gitignore, the manifest records the origin path as a reference only,
        and the shared scores log records the source KIND alone — never the path, title, or audio.
        --with-surge renders through Surge XT (GPLv3, a local dev-side tool — outputs carry no code
        copyleft) but its factory-patch CONTENT license is unresolved upstream, so surge- and
        surgeplus-bearing batches get the same .gitignore treatment as ref batches (surgeplus is the
        same surge audio, produced); the scores log stays kind-only.
        surgepy has no PyPI wheel — beat showdown --surge-doctor reports the source-build steps.
        --midi-dir files are MIDI transcriptions of copyrighted songs (derivative works, PRIVATE —
        keep them outside any repo): the tool only ever READS them, midi-figure batches get the
        generated .gitignore gate, the manifest records the midi path/transposition as a local
        reference only, and the shared scores log records only figureSource:'midi'|'bank' — never
        a song title, artist, or path.`,
  },
  {
    cmd: 'prodtask',
    text: `  beat prodtask transform <dir> [--rounds 1] [--seed 61] [--arms original,tricked,random]
                [--tricks name,name] [--roles bassline,chords,lead,drum-loop] [--seconds S]
                                                          build blind PRODUCTION-TRANSFORM batches (research 119
                                                          §T-C): each batch is ONE composed figure in N arms —
                                                          original (raw engine solo, the documented mono/dry/static
                                                          loss mode), tricked (the SAME figure + patch plus a
                                                          sensible per-role trick stack via the real beat trick
                                                          apply path — width/air/glue), and random (the SAME figure
                                                          + a magnitude-matched RANDOM-EDIT control: the same number
                                                          of edits the stack made, on random legal params at random
                                                          legal values — the control that separates "the RIGHT
                                                          production moves" from "any change sounds different").
                                                          Notes/patch are identical across arms; only production
                                                          varies. Assembled as an ordinary clip-set batch: arms
                                                          seeded-shuffled into v-numbers, duration-matched, and —
                                                          load-bearing — loudness-normalized so tricks win on
                                                          width/air/glue, never on level. Renders are local-engine
                                                          only (no fal). --tricks overrides the per-role stack (for
                                                          ablations: width-only vs width+air vs full). Rate with
                                                          beat rate as usual.
  beat prodtask --report <dir> [--json] (or --log f)      the scoreboard: per-arm win / top-half / pairwise from
                                                          every scored prodtask batch, overall and per task/role,
                                                          small-n splits labeled smoke, PLUS per-arm mean DSP
                                                          receipts (stereoWidthDb, bandAirPct) tying the blind
                                                          result to the mechanical one. Chance: tricked-vs-original
                                                          pairwise 50% = tricks don't move the ear; tricked must
                                                          ALSO beat random. See docs/prodtask.md.`,
  },
  {
    cmd: 'pilot',
    text: `  beat pilot run <dir> [--budget 80] [--generations 6] [--niches 4]
                [--roles bassline,chords] [--seed N] [--controls 3] [--aes-backend aes]
                                                          the constrained T5 overnight pilot (plan C3,
                                                          docs/research/117): the owner's "circular process" —
                                                          seeded quality-diversity search over the synth-param VARY
                                                          space (NEVER gen — the critic is blind there), scored by
                                                          the PESSIMISTIC ensemble critic (mean − β·std) with the #1
                                                          hack vector STEREO WIDTH fenced out. Per generation: mutate
                                                          the best-per-niche elites (niches = brightness×density DSP
                                                          buckets) + ε random immigrants, render offline (budget-
                                                          bounded, one boot/gen), keep best per niche. Ships a blind
                                                          morning frontier per role: critic-guided ELITES plus
                                                          random-mutation CONTROLS (never critic-scored), as ordinary
                                                          rateable clip-set batches (group pilot:<role>, loudness-
                                                          normalized, seeded-shuffle). SCALING GATE: elites must beat
                                                          controls in your blind ratings before any scale-up. Needs
                                                          a scored log (the critic trains on it) + the aes sidecar
                                                          (BEAT_PYTHON at the venv). Rate with beat rate as usual.
  beat pilot --report <dir> [--json] (or --log f)         the scoreboard: elite-vs-control win / top-half / pairwise
                                                          over every scored pilot batch, overall and per role, with
                                                          the SCALING GATE verdict. See docs/pilot.md.`,
  },
  {
    cmd: 'rate',
    text: `  beat rate <dir> [--port 4321] [--log f]               local web UI over every UNSCORED rendered batch under
                                                          <dir>: blind shuffled A/B/C players, click picks in
                                                          preference order (best first, up to 3), saved through the
                                                          standard score path into ONE beat-scores.jsonl at the dir
                                                          root (--log overrides). Re-running resumes where you left
                                                          off; then: beat taste-eval --log <dir>/beat-scores.jsonl`,
  },
  {
    cmd: 'audition',
    text: `  beat audition <dir> [--group G] [--seed N] [--no-shuffle]
                                                          stitch a blind audition.wav from ANY directory of wavs
                                                          (stem chops, one-shots) or re-stitch an existing batch.
                                                          A plain wav dir gets a clip-set manifest (sorted names ->
                                                          v1..vN) so beat score works on it; presentation order is
                                                          seeded-shuffled by default (position bias — the printed
                                                          index is the answer key). vary/gen --audition shuffles the
                                                          same way; --no-shuffle restores generation order there too`,
  },
  {
    cmd: 'metrics',
    text: `  beat metrics <file.wav> [--json] [--save-profile <ref.json>]
                                                          LUFS, true peak, crest, spectral, stereo;
                                                          --save-profile writes the numbers as a reusable
                                                          reference profile (with provenance) for lint --ref`,
  },
  {
    cmd: 'lint',
    text: `  beat lint <file.wav> [--target <LUFS> | --ref <ref.json>] [--json] [--doc <file.beat>]
                                                          deterministic mix findings (default target -14);
                                                          --ref compares against a saved reference profile
                                                          instead of absolute targets (LUFS/band/width/crest
                                                          deltas) — full-mix statics only: a profile can't
                                                          hear arrangement, sections, or masking;
                                                          --doc renders each track solo to name the actual
                                                          offending track in each finding's suggestion, and
                                                          makes fix lines cite that .beat by name (without it
                                                          they show an honest <file.beat> placeholder)`,
  },
  {
    cmd: 'render',
    text: `  beat render <file> [-o out.wav] [--tail <sec>]          render to WAV through dotbeat's own engine
                                                          (headless Chromium driving ui/; no BeatLab needed)
  beat render <file> --offline [-o out.wav]               compute the mix through an offline context instead
                                                          of capturing the realtime clock — same engine, no
                                                          lossy recorder step. Repeatable to ~1 LSB for
                                                          oscillator content; noise-based voices (e.g. the
                                                          default kit's snare/hats) vary per run, exactly as
                                                          they do live. CPU-bound: fast for short/small
                                                          projects, can be SLOWER than live capture for long
                                                          dense songs (the measured ratio is printed).
                                                          Refuses soundfont (instrument/sf-lane) projects;
                                                          an ACTIVE bitcrushRate (>1 with bitcrushMix >0)
                                                          renders as passthrough (caveat printed).
  beat render --batch <dir> [--live | --offline] [--no-normalize]
                                                          render every .beat variant in a vary-batch dir through
                                                          ONE harness boot (what vary --render calls). Defaults
                                                          to OFFLINE compute — short clips are where it is both
                                                          exact and fast — falling back to live capture with a
                                                          printed reason when the project uses soundfonts.
                                                          --live forces realtime capture; --offline errors
                                                          instead of falling back. Re-rendering a batch whose
                                                          manifest records loudness normalization re-applies it
                                                          (to the recorded target LUFS) and refreshes the
                                                          manifest's measured levels, so the manifest keeps
                                                          describing the actual audio; --no-normalize keeps the
                                                          raw re-render loudness and honestly re-records the
                                                          batch as not normalized.
  beat render <file> --stems [--out-dir d]                Phase 37: one solo WAV per track into an out dir
                                                          (default stems-<file> next to the .beat) — stems for
                                                          external mixing or per-track metrics
  env CHROME_PATH=<binary>                                use a specific Chromium/Chrome instead of a system
                                                          Chrome install — required in locked-down/proxied
                                                          environments where \`playwright install chrome\` is
                                                          blocked (a \`playwright install chromium\` binary works).
  note: song mode renders only scene-placed content — a groove on a track that isn't placed in any
        scene renders SILENT. Snapshot with beat clip and place it with beat scene / beat place first.`,
  },
  // ---- Phase 37 Stream RA begin: feedback help entry --------------------------------------
  {
    cmd: 'feedback',
    text: `  beat feedback <file> [--sections] [--ref <ref.json>] [--json]
                                                          render the song ONCE, then report mix feedback.
                                                          default: whole-song metrics + lint in one block.
                                                          --sections: slice the render at song section
                                                          boundaries and report the per-section energy arc
                                                          (LUFS / spectral balance / width / crest per section
                                                          + section-to-section movement, flagged only when it
                                                          clears the render-run variance floor). --ref compares
                                                          each section (or the whole song) against a saved
                                                          reference profile (beat metrics --save-profile).
                                                          Honest limits: per-section STATIC metrics only — this
                                                          does NOT hear masking, arrangement, or transitions,
                                                          only how sections differ as isolated static mixes`,
  },
  // ---- Phase 37 Stream RA end -------------------------------------------------------------
  { cmd: 'daemon', text: `  beat daemon <file> [--port 8420]` },
  { cmd: 'checkpoint', text: `  beat checkpoint <file> [--label L] [--intent I]         save a restorable version (auto-labels from the diff)` },
  {
    cmd: 'history',
    text: `  beat history <file> [--limit N] [--collapsed]           list checkpoints, newest first (--collapsed folds
                                                          unnamed runs between pins into "N more checkpoints")`,
  },
  { cmd: 'restore', text: `  beat restore <file> <ref>                               go back to a checkpoint (append-only — never destroys work)` },
  { cmd: 'pin', text: `  beat pin <file> <ref> <name...>                         name a checkpoint (<=25 chars), e.g. beat pin song.beat a1b2c3 rough mix v1` },
  { cmd: 'unpin', text: `  beat unpin <file> <name...>                             remove a pin by name` },
  { cmd: 'pins', text: `  beat pins <file>                                        list this project's pins, newest checkpoint first` },
  { cmd: 'selection', text: `  beat selection --port <p> [--set "<grammar>" | --clear]  read/set the GUI selection held by a running daemon` },
  {
    cmd: 'mcp',
    text: `  beat mcp                                                MCP server over stdio: the commands above as tools (~58,
                                                          covering track/note/hit/effect/scene/place/song/preset/macro/
                                                          drum-kit/vary/score/adopt/sample/lane/checkpoint/render/metrics editing) —
                                                          only daemon (a long-running process, structurally not a
                                                          tool call) stays CLI-only; send tools/list on a running
                                                          'beat mcp' for the exact, current set`,
  },
  {
    cmd: 'mcp-init',
    text: `  beat mcp-init <file> [--force | --force-config | --force-claude]
                                                          write a .mcp.json next to <file> so Claude Code
                                                          (or any MCP client) auto-discovers 'beat mcp' there,
                                                          plus a music-session CLAUDE.md scaffold (you're making
                                                          music, not developing dotbeat; render->metrics->lint;
                                                          vary/score for taste; units). Existing files are never
                                                          overwritten without a force flag, per file:
                                                          --force-config regenerates just .mcp.json (e.g. after
                                                          this repo moves), --force-claude replaces just the
                                                          CLAUDE.md scaffold (your own edits to it are lost),
                                                          --force overwrites both`,
  },
]

// Pilot 108: the full dump is ~350 lines — say up front that per-command help exists, or nobody
// finds it (it shipped in Phase 34 and the taste-loop pilot still grepped the wall instead).
const USAGE = `usage (one command's block: beat help <command>, or beat <command> --help):\n${HELP.map((e) => e.text).join('\n')}\n\n${PATHS_NOTE}`

/** The `beat <cmd> --help` / `beat help <cmd>` view: just that command's block, plus set's own
 * paths note and the command's family as a "related:" pointer. Returns null for unknown names
 * (callers print the standard unknown-command error, exit 2). */
function commandHelp(name) {
  const entry = HELP.find((e) => e.cmd === name || (e.aliases ?? []).includes(name))
  if (!entry) return null
  let out = `usage:\n${entry.text}`
  if (entry.cmd === 'set') out += `\n\n${PATHS_NOTE}`
  const family = HELP_FAMILIES.find((f) => f.includes(entry.cmd))
  if (family) out += `\n\nrelated: ${family.filter((c) => c !== entry.cmd).map((c) => `beat ${c}`).join(', ')}`
  return out
}

function readDoc(path) {
  return parse(readFileSync(path, 'utf8'))
}

/** Write the canonical form and print the musical edit list for what changed. */
function writeDoc(path, before, after) {
  const text = serialize(after)
  writeFileSync(path, text)
  process.stdout.write(formatDiff(diffDocuments(before, after)))
}

function initCmd(argv) {
  const file = argv.find((a) => !a.startsWith('--'))
  if (!file) throw new BeatEditError('init needs a file path')
  if (existsSync(file)) throw new BeatEditError(`${file} already exists — refusing to overwrite`)
  const bpmIdx = argv.indexOf('--bpm')
  const barsIdx = argv.indexOf('--bars')
  const doc = initDocument({
    ...(bpmIdx !== -1 ? { bpm: Number(argv[bpmIdx + 1]) } : {}),
    ...(barsIdx !== -1 ? { loopBars: Number(argv[barsIdx + 1]) } : {}),
  })
  writeFileSync(file, serialize(doc))
  process.stdout.write(`created ${file}: ${doc.bpm} bpm, ${doc.loopBars} bar(s), starter track "${doc.tracks[0].id}"\n`)
  // Pilot 108: a fresh project is SILENT and nothing said so — a first `vary --render` would burn
  // real-time renders on silence. Print the on-ramp, same then:-hint convention as vary/score.
  process.stdout.write(`the starter track has no notes yet — then: beat add-note ${file} ${doc.tracks[0].id} 60 0 4 0.8, or beat add-track ${file} drums drums + beat drum-kit ${file} drums kit-909\n`)
}

function addTrackCmd(argv) {
  const [file, id, kind, ...rest] = argv
  if (!file || !id || !kind) throw new BeatEditError('add-track needs <file> <id> <synth|drums|instrument|audio>')
  const nameIdx = rest.indexOf('--name')
  const colorIdx = rest.indexOf('--color')
  const sfIdx = rest.indexOf('--soundfont')
  const progIdx = rest.indexOf('--program')
  // Phase 22 Stream AB: a fresh drum track defaults to the 12-lane GM-aligned kit going forward
  // (research 19 Part VII) — --legacy-lanes opts back into the old implicit-5, empty-lanes[] shape
  // for a caller/script that specifically wants pre-v0.10 behavior.
  const legacyLanes = rest.includes('--legacy-lanes')
  // Phase 39 Stream UA (pilot 105 leftover): an instrument track with no --soundfont fails in core
  // (edit.ts addTrack). Intercept here to add the synth-track nudge to the message — the same
  // "instrument tracks need a soundfont" guard, plus a way forward for a quick part with no sample.
  if (kind === 'instrument' && rest.indexOf('--soundfont') === -1) {
    throw new BeatEditError(
      'instrument tracks need a soundfont: pass --soundfont <sample-id> [--program N] (register the .sf2 with beat sample first) — or use a synth track for a quick part with no sample',
    )
  }
  const before = readDoc(file)
  const { doc } = addTrack(before, {
    id,
    kind,
    ...(nameIdx !== -1 ? { name: rest[nameIdx + 1] } : {}),
    ...(colorIdx !== -1 ? { color: rest[colorIdx + 1] } : {}),
    ...(sfIdx !== -1 ? { soundfont: { sample: rest[sfIdx + 1], program: progIdx !== -1 ? Number(rest[progIdx + 1]) : 0 } } : {}),
    ...(kind === 'drums' && !legacyLanes ? { lanes: defaultDrumKitLanes() } : {}),
  })
  writeDoc(file, before, doc)
}

function rmTrackCmd(argv) {
  const [file, id] = argv
  if (!file || !id) throw new BeatEditError('rm-track needs <file> <id>')
  const before = readDoc(file)
  const { doc } = removeTrack(before, id)
  writeDoc(file, before, doc)
}

// Track grouping (Phase 22 Stream AF): fold N existing tracks into one named, colored group — the
// CLI/agent face on the same addGroup/removeGroup/renameGroup/setGroupColor/setGroupTracks core
// primitives the daemon's POST /group route and the GUI's "+ group" affordance wrap. `--name`/
// `--color` follow add-track's own flag convention; track ids are the remaining positional args.
function groupCmd(argv) {
  const [file, id, ...rest] = argv
  if (!file || !id) throw new BeatEditError('group needs <file> <id> <track-id> [<track-id> ...] [--name N] [--color #hex]')
  const nameIdx = rest.indexOf('--name')
  const colorIdx = rest.indexOf('--color')
  const flagTokens = new Set()
  if (nameIdx !== -1) {
    flagTokens.add(nameIdx)
    flagTokens.add(nameIdx + 1)
  }
  if (colorIdx !== -1) {
    flagTokens.add(colorIdx)
    flagTokens.add(colorIdx + 1)
  }
  const trackIds = rest.filter((_, i) => !flagTokens.has(i))
  if (trackIds.length === 0) throw new BeatEditError('group needs at least 1 track id')
  const before = readDoc(file)
  const { doc } = addGroup(before, {
    id,
    trackIds,
    ...(nameIdx !== -1 ? { name: rest[nameIdx + 1] } : {}),
    ...(colorIdx !== -1 ? { color: rest[colorIdx + 1] } : {}),
  })
  writeDoc(file, before, doc)
}

function rmGroupCmd(argv) {
  const [file, id] = argv
  if (!file || !id) throw new BeatEditError('rm-group needs <file> <id>')
  const before = readDoc(file)
  const { doc } = removeGroup(before, id)
  writeDoc(file, before, doc)
}

function groupSetCmd(argv) {
  const [file, id, ...rest] = argv
  if (!file || !id) throw new BeatEditError('group-set needs <file> <id> [--name N] [--color #hex] [--tracks id,id,...]')
  const nameIdx = rest.indexOf('--name')
  const colorIdx = rest.indexOf('--color')
  const tracksIdx = rest.indexOf('--tracks')
  if (nameIdx === -1 && colorIdx === -1 && tracksIdx === -1) throw new BeatEditError('group-set needs at least one of --name/--color/--tracks')
  const before = readDoc(file)
  let doc = before
  if (nameIdx !== -1) doc = renameGroup(doc, id, rest[nameIdx + 1])
  if (colorIdx !== -1) doc = setGroupColor(doc, id, rest[colorIdx + 1])
  if (tracksIdx !== -1) doc = setGroupTracks(doc, id, rest[tracksIdx + 1].split(',').filter(Boolean))
  writeDoc(file, before, doc)
}

// v0.8+ multi-preset listing (docs/phase-8-plan.md's "Remaining": "beat inspect should list a
// bank's presets" — a loaded SF2 can carry many programs; the file only pins the one selected).
// Reads the actual .sf2 bytes (relative to the .beat file, sha256-verified like every other
// media consumer) and enumerates via spessasynth_core's SoundBankLoader — a pure binary-format
// parse, no audio context / DSP / browser shim required (verified: no window/document stub
// needed, unlike SpessaSynthProcessor's WASM path in render-offline.mjs). Best-effort: a missing
// file, unregistered sample, or hash mismatch is reported per-track rather than failing the
// whole inspect (inspect is a read-only overview that should stay usable even when media isn't
// checked out locally), matching the spirit of `beat inspect`'s always-available design.
async function instrumentPresetInfo(file, doc) {
  const info = new Map()
  const instrumentTracks = doc.tracks.filter((t) => t.kind === 'instrument' && t.instrument)
  if (instrumentTracks.length === 0) return info
  const { createHash } = await import('node:crypto')
  const { dirname: pathDirname, resolve: pathResolve } = await import('node:path')
  const beatDir = pathDirname(pathResolve(file))
  let SoundBankLoader
  for (const t of instrumentTracks) {
    const sample = doc.media.find((m) => m.id === t.instrument.sample)
    if (!sample) {
      info.set(t.id, { error: `sample "${t.instrument.sample}" is not in the media block` })
      continue
    }
    const filePath = pathResolve(beatDir, sample.path)
    if (!existsSync(filePath)) {
      info.set(t.id, { error: `file not found: ${sample.path} (relative to ${beatDir})` })
      continue
    }
    try {
      const bytes = readFileSync(filePath)
      const hash = createHash('sha256').update(bytes).digest('hex')
      if (hash !== sample.sha256) {
        info.set(t.id, { error: `sha256 mismatch for ${sample.path} (file ${hash.slice(0, 12)}..., document expects ${sample.sha256.slice(0, 12)}...)` })
        continue
      }
      SoundBankLoader ??= (await import('spessasynth_core')).SoundBankLoader
      const bank = SoundBankLoader.fromArrayBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
      const presets = bank.presets
        .map((p) => ({ program: p.program, bankMSB: p.bankMSB, bankLSB: p.bankLSB, name: p.name }))
        .sort((a, b) => a.bankMSB - b.bankMSB || a.bankLSB - b.bankLSB || a.program - b.program)
      info.set(t.id, { presets })
    } catch (e) {
      info.set(t.id, { error: e.message })
    }
  }
  return info
}

function formatInstrumentPresets(doc, info) {
  if (info.size === 0) return ''
  const lines = ['', 'soundfont presets:']
  for (const t of doc.tracks) {
    const result = info.get(t.id)
    if (!result) continue
    if (result.error) {
      lines.push(`  ${t.id}: ${result.error}`)
      continue
    }
    lines.push(`  ${t.id}: ${result.presets.length} preset${result.presets.length === 1 ? '' : 's'}`)
    for (const p of result.presets) {
      const selected = p.program === t.instrument.program ? ' [selected]' : ''
      lines.push(`    program ${p.program} (bank ${p.bankMSB}/${p.bankLSB}): "${p.name}"${selected}`)
    }
  }
  return lines.join('\n') + '\n'
}

async function inspectCmd(argv) {
  const json = argv.includes('--json')
  const file = argv.find((a) => a !== '--json')
  if (!file) throw new BeatEditError('inspect needs a file')
  const doc = readDoc(file)
  const presetInfo = await instrumentPresetInfo(file, doc)
  if (json) {
    const instrumentPresets = presetInfo.size > 0 ? Object.fromEntries(presetInfo) : undefined
    process.stdout.write(JSON.stringify(instrumentPresets ? { ...doc, instrumentPresets } : doc, null, 2) + '\n')
  } else {
    process.stdout.write(describeDocument(doc) + formatInstrumentPresets(doc, presetInfo))
  }
}

// ==== Phase 38 Stream SB begin ====
const ANALYZE_BACKENDS = ['beatthis', 'stub', 'allin1']

function formatDoctorReport(report) {
  const lines = []
  lines.push(`interpreter: ${report.interpreter ?? '(unknown)'}`)
  if (report.pythonFound === false) {
    lines.push(`python3: NOT FOUND`)
    if (report.error) lines.push(report.error)
    return lines.join('\n') + '\n'
  }
  lines.push(`python: ${report.python ?? '(unknown)'}`)
  if (report.error) {
    lines.push(`error: ${report.error}`)
    return lines.join('\n') + '\n'
  }
  lines.push('backends:')
  const backends = report.backends ?? {}
  for (const name of ['stub', 'beatthis', 'allin1']) {
    const b = backends[name]
    if (!b) continue
    const missing = Array.isArray(b.missing) && b.missing.length > 0 ? `missing: ${b.missing.join(', ')}` : 'ok'
    lines.push(`  ${name.padEnd(9)} ${b.ok ? 'ok' : missing}`)
  }
  return lines.join('\n') + '\n'
}

/** Human-readable `beat showdown --surge-doctor`: interpreter, surgepy availability, factory patch
 * path + count, and (when surgepy is missing) the exact source-build steps — surgepy has no wheel. */
function formatSurgeDoctor(report) {
  const lines = []
  lines.push(`interpreter: ${report.interpreter ?? '(unknown)'}`)
  if (report.pythonFound === false) {
    lines.push('python3: NOT FOUND')
    if (report.error) lines.push(report.error)
    return lines.join('\n') + '\n'
  }
  const surgepy = report.surgepy ?? {}
  if (surgepy.available) {
    lines.push('surgepy: available')
    lines.push(`factory content: ${report.patchesRoot ?? report.factoryPath ?? '(unknown)'}`)
    lines.push(`factory patches: ${report.patchCount ?? '(unknown)'}`)
    if (surgepy.constructError) lines.push(`note: surge constructed with an error — ${surgepy.constructError}`)
  } else {
    lines.push('surgepy: NOT AVAILABLE (surge clips are skipped)')
    if (report.error) lines.push(`error: ${report.error}`)
    if (surgepy.fix) lines.push(`fix: ${surgepy.fix}`)
  }
  return lines.join('\n') + '\n'
}

async function analyzeCmd(argv) {
  const json = argv.includes('--json')

  if (argv.includes('--doctor')) {
    const report = await sidecarDoctor()
    process.stdout.write(json ? JSON.stringify(report, null, 2) + '\n' : formatDoctorReport(report))
    return
  }

  const force = argv.includes('--force')
  const backendIdx = argv.indexOf('--backend')
  const backend = backendIdx >= 0 ? argv[backendIdx + 1] : 'beatthis'
  if (!ANALYZE_BACKENDS.includes(backend)) {
    throw new BeatAnalysisError(`unknown --backend "${backend}" (one of: ${ANALYZE_BACKENDS.join(', ')})`)
  }
  let outIdx = argv.indexOf('-o')
  if (outIdx < 0) outIdx = argv.indexOf('--out')
  const outPath = outIdx >= 0 ? argv[outIdx + 1] : undefined

  // Positional audio path = first arg that isn't a flag or a flag's value.
  const consumed = new Set()
  if (backendIdx >= 0) consumed.add(backendIdx + 1)
  if (outIdx >= 0) consumed.add(outIdx + 1)
  const audioPath = argv.find(
    (a, i) => !a.startsWith('-') && !consumed.has(i),
  )
  if (!audioPath) throw new BeatAnalysisError('analyze needs an audio file (a .wav), or pass --doctor')
  if (/\.beat$/i.test(audioPath)) {
    throw new BeatAnalysisError(
      `"${audioPath}" is a .beat file — for the symbolic analysis of a project, use: beat analyze-structure ${audioPath}. ` +
        `beat analyze reads reference AUDIO (a .wav) to detect its tempo/beats/sections.`,
    )
  }

  const { artifact, cached, outPath: writtenPath } = await runAnalysis({ audioPath, backend, force, outPath })

  if (json) {
    process.stdout.write(JSON.stringify(artifact, null, 2) + '\n')
    return
  }

  const b = artifact.backend
  const out = []
  out.push(`analyzed ${artifact.source.file} (backend ${b.name}${b.version ? ` ${b.version}` : ''}${b.model ? `/${b.model}` : ''})`)
  if (b.name === 'stub') {
    out.push(`  ⚠ stub backend — a synthetic fixed 120-BPM intro/loop/outro grid, NOT detected from your audio.`)
    out.push(`    install a real backend for true tempo/section detection: beat analyze --doctor`)
  }
  out.push(`  bpm ${Number(artifact.bpm).toFixed(2)} (${artifact.bpmMethod})`)
  out.push(`  duration ${artifact.source.durationSeconds.toFixed(2)}s · ${artifact.beats.length} beats · ${artifact.downbeats.length} downbeats`)
  if (artifact.sections.length > 0) {
    out.push(`  sections (${artifact.sections.length}):`)
    for (const s of artifact.sections) {
      out.push(`    ${String(s.label ?? '(unlabeled)').padEnd(10)} ${s.start.toFixed(2)}s → ${s.end.toFixed(2)}s`)
    }
  } else {
    out.push(`  sections: none (beats-only backend — beat skeleton will chunk the beat grid into parts)`)
  }
  if (cached) {
    out.push(`  using cached ${writtenPath} — pass --force to re-analyze`)
  } else {
    out.push(`  wrote ${writtenPath}`)
  }
  out.push(`  next: beat skeleton <out.beat> ${writtenPath}`)
  process.stdout.write(out.join('\n') + '\n')
}
// ==== Phase 38 Stream SB end ====

// --- Phase 37 Stream RB begin ---
async function analyzeStructureCmd(argv) {
  const json = argv.includes('--json')
  const rootIdx = argv.indexOf('--root')
  const scaleIdx = argv.indexOf('--scale')
  const root = rootIdx >= 0 ? Number(argv[rootIdx + 1]) : undefined
  const scale = scaleIdx >= 0 ? argv[scaleIdx + 1] : undefined
  // Positional file is the first arg that isn't a flag or a flag's value.
  const file = argv.find((a, i) => a !== '--json' && a !== '--root' && a !== '--scale' && !(rootIdx >= 0 && i === rootIdx + 1) && !(scaleIdx >= 0 && i === scaleIdx + 1))
  if (!file) throw new BeatEditError('analyze-structure needs a file')
  const doc = readDoc(file)
  const analysis = analyzeStructure(doc, { root, scale })
  if (json) {
    process.stdout.write(JSON.stringify(analysis, null, 2) + '\n')
  } else {
    process.stdout.write(formatStructure(analysis) + '\n')
  }
}
// --- Phase 37 Stream RB end ---

function setCmd(argv) {
  const [file, ...pairs] = argv
  if (!file || pairs.length === 0 || pairs.length % 2 !== 0) {
    throw new BeatEditError('set needs a file and one or more <path> <value> pairs')
  }
  const before = readDoc(file)
  let doc = before
  for (let i = 0; i < pairs.length; i += 2) {
    doc = setValue(doc, pairs[i], pairs[i + 1])
  }
  writeDoc(file, before, doc)
}

function addNoteCmd(argv) {
  const [file, track, pitch, start, duration, velocity] = argv
  if (!file || !track || velocity === undefined) throw new BeatEditError('add-note needs <file> <track> <pitch> <start> <duration> <velocity>')
  const before = readDoc(file)
  const { doc } = addNote(before, track, { pitch: Number(pitch), start: Number(start), duration: Number(duration), velocity: Number(velocity) })
  writeDoc(file, before, doc)
}

function rmNoteCmd(argv) {
  const [file, track, noteId] = argv
  if (!file || !track || !noteId) throw new BeatEditError('rm-note needs <file> <track> <note-id>')
  const before = readDoc(file)
  const { doc } = removeNote(before, track, noteId)
  writeDoc(file, before, doc)
}

function addHitCmd(argv) {
  const [file, track, lane, start, velocity, duration] = argv
  if (!file || !track || !lane || start === undefined || velocity === undefined) throw new BeatEditError('add-hit needs <file> <track> <lane> <start> <velocity> [duration]')
  const before = readDoc(file)
  const { doc } = addHit(before, track, { lane, start: Number(start), velocity: Number(velocity), ...(duration !== undefined ? { duration: Number(duration) } : {}) })
  writeDoc(file, before, doc)
}

function rmHitCmd(argv) {
  const [file, track, hitId] = argv
  if (!file || !track || !hitId) throw new BeatEditError('rm-hit needs <file> <track> <hit-id>')
  const before = readDoc(file)
  const { doc } = removeHit(before, track, hitId)
  writeDoc(file, before, doc)
}

function humanizeCmd(argv) {
  const valued = ['--timing', '--velocity', '--push-late', '--swing', '--seed', '--ids', '--lanes']
  const positional = argv.filter((a, i) => !a.startsWith('--') && !valued.includes(argv[i - 1]))
  const [file, track] = positional
  if (!file || !track) throw new BeatEditError('humanize needs <file> <track> [--timing 0.15] [--velocity 0.06] [--push-late 0] [--swing 0] [--seed N] [--lanes hat,openhat | --ids a,b]')
  const flagValue = (flag) => {
    const i = argv.indexOf(flag)
    return i === -1 ? undefined : argv[i + 1]
  }
  const before = readDoc(file)
  // scope: explicit --ids, or --lanes (resolve to the drum-hit ids on those lanes)
  let ids
  if (flagValue('--ids') !== undefined) ids = flagValue('--ids').split(',').filter(Boolean)
  else if (flagValue('--lanes') !== undefined) {
    const lanes = new Set(flagValue('--lanes').split(',').filter(Boolean))
    const t = before.tracks.find((x) => x.id === track)
    if (!t) throw new BeatEditError(`no track "${track}"`)
    ids = (t.hits ?? []).filter((h) => lanes.has(h.lane)).map((h) => h.id)
    if (ids.length === 0) throw new BeatEditError(`no hits on lane(s) ${[...lanes].join(', ')} in track "${track}"`)
  }
  const seed = flagValue('--seed') !== undefined ? Number(flagValue('--seed')) : (readFileSync(file, 'utf8').length % 2147483647)
  const { doc, changed } = humanize(before, track, {
    ...(flagValue('--timing') !== undefined ? { timing: Number(flagValue('--timing')) } : {}),
    ...(flagValue('--velocity') !== undefined ? { velocity: Number(flagValue('--velocity')) } : {}),
    ...(flagValue('--push-late') !== undefined ? { pushLate: Number(flagValue('--push-late')) } : {}),
    ...(flagValue('--swing') !== undefined ? { swing: Number(flagValue('--swing')) } : {}),
    seed,
    ...(ids !== undefined ? { ids } : {}),
  })
  writeDoc(file, before, doc)
  process.stdout.write(`humanized ${changed} event(s) with seed ${seed}\n`)
}

function quantizeCmd(argv) {
  const positional = argv.filter((a, i) => !a.startsWith('--') && !['--grid', '--amount', '--notes'].includes(argv[i - 1]))
  const [file, track] = positional
  if (!file || !track) throw new BeatEditError('quantize needs <file> <track> [--grid 1] [--amount 1] [--ends] [--no-starts] [--notes id,id]')
  const flagValue = (flag) => {
    const i = argv.indexOf(flag)
    return i === -1 ? undefined : argv[i + 1]
  }
  const before = readDoc(file)
  const noteIds = flagValue('--notes') !== undefined ? flagValue('--notes').split(',').filter(Boolean) : undefined
  const { doc, changed } = quantizeNotes(before, track, {
    ...(flagValue('--grid') !== undefined ? { grid: Number(flagValue('--grid')) } : {}),
    ...(flagValue('--amount') !== undefined ? { amount: Number(flagValue('--amount')) } : {}),
    ...(argv.includes('--no-starts') ? { starts: false } : {}),
    ...(argv.includes('--ends') ? { ends: true } : {}),
    ...(noteIds !== undefined ? { noteIds } : {}),
  })
  writeDoc(file, before, doc)
  if (changed === 0) process.stdout.write('already on the grid — no notes moved\n')
  if (changed > 0) warnIfPastLoopBoundary(doc, track, noteIds)
}

// Phase 33 Stream MD item 3 (research/98): quantizing a note onto a grid step can push it past the
// loop's own end with zero warning (confirmed repro: step 62 -> 64 in a 4-bar/64-step loop, valid
// steps 0-63). Mirrors the shape ui/src/components/NoteView.tsx's PitchTimePanel already uses for
// the identical GUI-side bug (Phase 30 Stream KC): a post-hoc warning printed alongside the normal
// result, not a hard clamp that would silently change what the requested quantize actually does.
// Checked only against the notes/hits actually in THIS op's own scope (mirrors the GUI's
// `opNoteIds` check), against the doc's own loop length (loopBars*16 — the same `loopSteps` value
// `inspect`'s "steps X-Y of N" line already reports).
function warnIfPastLoopBoundary(doc, trackId, scopeIds) {
  const t = doc.tracks.find((x) => x.id === trackId)
  if (!t) return
  const totalSteps = doc.loopBars * 16
  const events = t.kind === 'drums' ? t.hits : t.notes
  const scope = scopeIds && scopeIds.length ? events.filter((e) => scopeIds.includes(e.id)) : events
  const overflowing = scope.filter((e) => e.start + (e.duration ?? 0) > totalSteps)
  if (overflowing.length === 0) return
  const worst = overflowing.reduce((a, b) => (a.start + (a.duration ?? 0) >= b.start + (b.duration ?? 0) ? a : b))
  process.stdout.write(
    `warning: ${overflowing.length} ${t.kind === 'drums' ? 'hit' : 'note'}${overflowing.length === 1 ? '' : 's'} now end${overflowing.length === 1 ? 's' : ''} past this ${totalSteps}-step loop's own boundary (e.g. ${worst.id} at step ${worst.start + (worst.duration ?? 0)}) — the overhang plays once but won't repeat each loop pass.\n`,
  )
}

// ---- Pitch & Time operations (Phase 22 Stream AD) — one-shot rewrites, same shape as quantize:
// pure core function, canonical write, musical-edit-list output. All six share the --notes id,id
// scoping flag quantize/humanize already use.

function notesFlag(argv) {
  const i = argv.indexOf('--notes')
  return i === -1 ? undefined : argv[i + 1].split(',').filter(Boolean)
}

function transposeCmd(argv) {
  const positional = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--notes')
  const [file, track, semitones] = positional
  if (!file || !track || semitones === undefined) throw new BeatEditError('transpose needs <file> <track> <semitones> [--notes id,id]')
  const before = readDoc(file)
  const noteIds = notesFlag(argv)
  const { doc, changed } = transposeNotes(before, track, Number(semitones), noteIds ? { noteIds } : {})
  writeDoc(file, before, doc)
  if (changed === 0) process.stdout.write('no notes moved (already clamped, or nothing in scope)\n')
}

function timeScaleCmd(argv) {
  const positional = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--notes')
  const [file, track, factor] = positional
  if (!file || !track || factor === undefined) throw new BeatEditError('time-scale needs <file> <track> <factor> [--notes id,id] (2 = x2, 0.5 = ÷2)')
  const before = readDoc(file)
  const noteIds = notesFlag(argv)
  const { doc, changed } = timeScaleNotes(before, track, Number(factor), noteIds ? { noteIds } : {})
  writeDoc(file, before, doc)
  if (changed === 0) process.stdout.write('no notes changed\n')
}

function fitScaleCmd(argv) {
  if (argv.includes('--list-scales')) {
    process.stdout.write(SCALE_NAMES.join('\n') + '\n')
    return
  }
  const positional = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--notes')
  const [file, track, root, scale] = positional
  if (!file || !track || root === undefined || !scale) throw new BeatEditError('fit-scale needs <file> <track> <root 0-11> <scale> [--notes id,id] (see --list-scales)')
  const before = readDoc(file)
  const noteIds = notesFlag(argv)
  const { doc, changed } = fitToScaleNotes(before, track, Number(root), scale, noteIds ? { noteIds } : {})
  writeDoc(file, before, doc)
  if (changed === 0) process.stdout.write('already in scale — no notes moved\n')
}

function invertCmd(argv) {
  const positional = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--notes')
  const [file, track, axis] = positional
  if (!file || !track) throw new BeatEditError('invert needs <file> <track> [axis-pitch] [--notes id,id]')
  const before = readDoc(file)
  const noteIds = notesFlag(argv)
  const { doc, changed } = invertNotes(before, track, axis !== undefined ? Number(axis) : undefined, noteIds ? { noteIds } : {})
  writeDoc(file, before, doc)
  if (changed === 0) process.stdout.write('no notes moved\n')
}

function reverseCmd(argv) {
  const positional = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--notes')
  const [file, track] = positional
  if (!file || !track) throw new BeatEditError('reverse needs <file> <track> [--notes id,id]')
  const before = readDoc(file)
  const noteIds = notesFlag(argv)
  const { doc, changed } = reverseNotes(before, track, noteIds ? { noteIds } : {})
  writeDoc(file, before, doc)
  if (changed === 0) process.stdout.write('no notes moved (a single note has no span to reverse)\n')
}

function legatoCmd(argv) {
  const positional = argv.filter((a, i) => !a.startsWith('--') && !['--notes', '--gap'].includes(argv[i - 1]))
  const [file, track] = positional
  if (!file || !track) throw new BeatEditError('legato needs <file> <track> [--gap 0] [--notes id,id]')
  const before = readDoc(file)
  const noteIds = notesFlag(argv)
  const gapIdx = argv.indexOf('--gap')
  const opts = { ...(noteIds ? { noteIds } : {}), ...(gapIdx !== -1 ? { gap: Number(argv[gapIdx + 1]) } : {}) }
  const { doc, changed } = legatoNotes(before, track, opts)
  writeDoc(file, before, doc)
  if (changed === 0) process.stdout.write('no notes resized\n')
}

function consolidateCmd(argv) {
  const positional = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--notes')
  const [file, track] = positional
  if (!file || !track) throw new BeatEditError('consolidate needs <file> <track> [--notes id,id]')
  const before = readDoc(file)
  const noteIds = notesFlag(argv)
  const { doc, changed } = consolidateRatchet(before, track, noteIds ? { noteIds } : {})
  writeDoc(file, before, doc)
  if (changed === 0) process.stdout.write('no ratcheted notes in scope — nothing to consolidate\n')
}

// The factory library ships with the package; BEAT_PRESETS overrides for a user library.
function loadPresets() {
  const path = process.env.BEAT_PRESETS ?? resolve(dirname(new URL(import.meta.url).pathname), '..', 'presets', 'factory.json')
  return parsePresetLibrary(readFileSync(path, 'utf8'))
}

function presetsCmd(argv) {
  if (argv.includes('--list-categories')) {
    process.stdout.write(PRESET_CATEGORIES.join('\n') + '\n')
    return
  }
  let presets = loadPresets()
  const categoryIdx = argv.indexOf('--category')
  if (categoryIdx !== -1) {
    const category = argv[categoryIdx + 1]
    if (!category) throw new BeatEditError('--category needs a value (see `beat presets --list-categories`)')
    presets = filterPresetsByCategory(presets, category)
  }
  process.stdout.write(argv.includes('--json') ? JSON.stringify(presets, null, 2) + '\n' : formatPresetList(presets))
}

function presetCmd(argv) {
  const [file, track, name] = argv
  if (!file || !track || !name) throw new BeatEditError('preset needs <file> <track> <preset-name> (see `beat presets`)')
  const presets = loadPresets()
  const preset = presets.find((p) => p.name === name)
  if (!preset) throw new BeatEditError(`no preset "${name}" (have: ${presets.map((p) => p.name).join(', ')})`)
  const before = readDoc(file)
  writeDoc(file, before, applyPreset(before, track, preset))
}

// Phase 26 Stream DD (docs/research/27-macro-tooling-layer.md): macros are tooling, exactly like
// presets above — "a macro is a preset with a continuous input" (research 18 §6). BEAT_MACROS
// overrides for a user library, same convention as BEAT_PRESETS/BEAT_DRUM_KITS.
function loadMacros() {
  const path = process.env.BEAT_MACROS ?? resolve(dirname(new URL(import.meta.url).pathname), '..', 'presets', 'macros.json')
  return parseMacroLibrary(readFileSync(path, 'utf8'))
}

function macroListCmd(argv) {
  const macros = loadMacros()
  process.stdout.write(argv.includes('--json') ? JSON.stringify(macros, null, 2) + '\n' : formatMacroList(macros))
}

function macroApplyCmd(argv) {
  const [file, track, name, valueStr] = argv
  if (!file || !track || !name || valueStr === undefined) {
    throw new BeatEditError('macro apply needs <file> <track> <macro-name> <value 0..100> (see `beat macro list`)')
  }
  const value = Number(valueStr)
  if (!Number.isFinite(value)) throw new BeatEditError(`macro apply: value must be a number, got "${valueStr}"`)
  const macros = loadMacros()
  const macro = macros.find((m) => m.name === name)
  if (!macro) throw new BeatEditError(`no macro "${name}" (have: ${macros.map((m) => m.name).join(', ')})`)
  const before = readDoc(file)
  writeDoc(file, before, applyMacro(before, track, macro, value))
}

function macroCmd(argv) {
  const [sub, ...rest] = argv
  if (sub === 'list') {
    macroListCmd(rest)
    return
  }
  if (sub === 'apply') {
    macroApplyCmd(rest)
    return
  }
  throw new BeatEditError('macro needs a subcommand: `beat macro list` or `beat macro apply <file> <track> <name> <value>`')
}

// Production tricks (docs/research/118-production-bag-of-tricks.md): a validated catalog of named
// production MOVES over the measured width/air/motion/glue gaps. Loads the macro library first (the
// validation context for `macro`-step tricks — a trick can call a factory macro), then eagerly
// validates the trick library against the live format vocabulary. BEAT_TRICKS overrides the path,
// same convention as BEAT_PRESETS/BEAT_MACROS/BEAT_DRUM_KITS.
function loadTricks() {
  const dir = resolve(dirname(new URL(import.meta.url).pathname), '..', 'presets')
  const macros = parseMacroLibrary(readFileSync(resolve(dir, 'macros.json'), 'utf8'))
  const path = process.env.BEAT_TRICKS ?? resolve(dir, 'tricks.json')
  return { tricks: parseTrickLibrary(readFileSync(path, 'utf8'), macros), macros }
}

function trickListCmd(argv) {
  const { tricks } = loadTricks()
  const axis = flagValue(argv, '--axis')
  if (axis !== undefined && !(TRICK_AXES ?? []).includes(axis)) {
    throw new BeatEditError(`--axis must be one of ${TRICK_AXES.join('|')}, got "${axis}"`)
  }
  const filtered = axis ? tricks.filter((t) => t.axis === axis) : tricks
  process.stdout.write(argv.includes('--json') ? JSON.stringify(filtered, null, 2) + '\n' : formatTrickList(filtered))
}

function trickShowCmd(argv) {
  const name = argv.find((a) => !a.startsWith('--'))
  if (!name) throw new BeatEditError('trick show needs a trick name (see `beat trick list`)')
  const { tricks } = loadTricks()
  const trick = tricks.find((t) => t.name === name)
  if (!trick) throw new BeatEditError(`no trick "${name}" (have: ${tricks.map((t) => t.name).join(', ')})`)
  process.stdout.write(argv.includes('--json') ? JSON.stringify(trick, null, 2) + '\n' : formatTrickCard(trick))
}

function trickApplyCmd(argv) {
  const known = new Set(['--clip', '--knob'])
  const positional = argv.filter((a, i) => !a.startsWith('--') && !known.has(argv[i - 1]))
  const [file, track, name] = positional
  if (!file || !track || !name) throw new BeatEditError('trick apply needs <file> <track> <trick-name> [--clip c] [--knob k] [--force] [--dry-run] (see `beat trick list`)')
  const force = argv.includes('--force')
  const dryRun = argv.includes('--dry-run')
  const clipId = flagValue(argv, '--clip')
  const knobStr = flagValue(argv, '--knob')
  const { tricks, macros } = loadTricks()
  const trick = tricks.find((t) => t.name === name)
  if (!trick) throw new BeatEditError(`no trick "${name}" (have: ${tricks.map((t) => t.name).join(', ')})`)
  // --knob fills the trick's (single) declared knob slot
  const knobs = {}
  if (knobStr !== undefined) {
    const v = Number(knobStr)
    if (!Number.isFinite(v)) throw new BeatEditError(`--knob must be a number, got "${knobStr}"`)
    const slot = (trick.slots.knobs ?? [])[0]
    if (!slot) throw new BeatEditError(`trick "${name}" has no knob slot to fill with --knob`)
    knobs[slot.name] = v
  }
  const before = readDoc(file)
  const features = siblingRenderFeatures(file) // sibling <file>.wav metrics if present, else null
  const result = applyTrick(trick, { doc: before, trackId: track, features }, { ...(clipId ? { clipId } : {}), knobs, macros, force })
  for (const w of result.warnings) process.stderr.write(`warning: ${w}\n`)
  if (result.overridden.length) process.stderr.write(`--force overrode: ${result.overridden.join('; ')}\n`)
  if (dryRun) {
    process.stdout.write(`dry-run — ${name} on "${track}" would apply:\n`)
    process.stdout.write(formatDiff(diffDocuments(before, result.doc)))
    return
  }
  writeDoc(file, before, result.doc)
}

function trickSuggestCmd(argv) {
  const json = argv.includes('--json')
  const positional = argv.filter((a) => !a.startsWith('--'))
  const [file, track] = positional
  if (!file) throw new BeatEditError('trick suggest needs a <file> [<track>]')
  const { tricks } = loadTricks()
  const doc = readDoc(file)
  if (track && !doc.tracks.some((t) => t.id === track)) {
    throw new BeatEditError(`no track "${track}" (have: ${doc.tracks.map((t) => t.id).join(', ')})`)
  }
  const wav = file.replace(/\.beat$/, '.wav')
  const hasWav = existsSync(wav)
  const suggestions = suggestForDocument(tricks, doc, hasWav ? wav : null, track)
  if (json) {
    process.stdout.write(JSON.stringify({ render: hasWav ? wav : null, suggestions: suggestions.map((s) => ({ trick: s.trick.name, track: s.trackId, axis: s.trick.axis, gap: s.gap, unverified: s.unverified })) }, null, 2) + '\n')
    return
  }
  const src = hasWav ? `metrics from ${basename(wav)}` : 'document state only (no sibling render — metric preconditions unverified)'
  process.stdout.write(`suggested tricks for ${basename(file)} — ${src}:\n`)
  if (suggestions.length === 0) {
    process.stdout.write('  (nothing applicable — every trick either fails a precondition, is counter-indicated, or is already applied)\n')
    return
  }
  const nameW = Math.max(...suggestions.map((s) => s.trick.name.length))
  const trackW = Math.max(...suggestions.map((s) => s.trackId.length))
  for (const s of suggestions) {
    const flag = s.unverified ? '  (needs a render to confirm)' : s.gap > 0 ? `  (gap ${s.gap.toFixed(1)})` : ''
    process.stdout.write(`  ${s.trackId.padEnd(trackW)}  ${s.trick.name.padEnd(nameW)}  [${s.trick.axis}]${flag}\n`)
  }
  process.stdout.write(`then: beat trick show <name>, then beat trick apply ${basename(file)} <track> <name>\n`)
}

function trickCmd(argv) {
  const [sub, ...rest] = argv
  if (sub === 'list') return trickListCmd(rest)
  if (sub === 'show') return trickShowCmd(rest)
  if (sub === 'apply') return trickApplyCmd(rest)
  if (sub === 'suggest') return trickSuggestCmd(rest)
  throw new BeatEditError('trick needs a subcommand: `beat trick list|show|apply|suggest` (see `beat trick --help`)')
}

// Phase 22 Stream AB: drum kits (kit-808/kit-909/kit-acoustic) — a separate small library from
// synth presets above, since a kit replaces a track's whole `lanes` list rather than setting synth
// params (see src/core/drumkit.ts's header comment for why it's not bolted onto BeatPreset).
function loadDrumKits() {
  const path = process.env.BEAT_DRUM_KITS ?? resolve(dirname(new URL(import.meta.url).pathname), '..', 'presets', 'drum-kits.json')
  return parseDrumKitLibrary(readFileSync(path, 'utf8'))
}

function drumKitsCmd(argv) {
  const kits = loadDrumKits()
  process.stdout.write(argv.includes('--json') ? JSON.stringify(kits, null, 2) + '\n' : formatDrumKitList(kits))
}

function drumKitCmd(argv) {
  const [file, track, name] = argv
  if (!file || !track || !name) throw new BeatEditError('drum-kit needs <file> <track> <kit-name> (see `beat drum-kits`)')
  const kits = loadDrumKits()
  const kit = kits.find((k) => k.name === name)
  if (!kit) throw new BeatEditError(`no drum kit "${name}" (have: ${kits.map((k) => k.name).join(', ')})`)
  const before = readDoc(file)
  writeDoc(file, before, applyDrumKit(before, track, kit))
}

// ---- variation-and-taste loop (rung 1) — docs/research/08-variation-loop-prior-art.md ------

// ---- taste data-collection system (owner decision 2026-07-17; docs/taste-loop-design.md) ------
// Synthetic seed songs -> vary batches -> offline renders -> `beat rate` web UI -> the SAME
// beat-scores.jsonl every taste tool reads. The point: T1's ~20-batch gate becomes a listening
// session instead of a music-production obligation, and the data covers many aesthetics.

async function tasteSeedsCmd(argv) {
  const known = new Set(['--count', '--seed'])
  for (const a of argv) if (a.startsWith('--') && !known.has(a)) throw new BeatEditError(`unknown flag "${a}" (known: --count, --seed)`)
  const positional = argv.filter((a, i) => !a.startsWith('--') && !known.has(argv[i - 1]))
  const outDir = positional[0]
  if (!outDir) throw new BeatEditError('taste-seeds needs an output directory: beat taste-seeds <dir> [--count 8] [--seed 1]')
  const count = flagValue(argv, '--count') ? Number(flagValue(argv, '--count')) : 8
  const seed0 = flagValue(argv, '--seed') ? Number(flagValue(argv, '--seed')) : 1
  const { generateSeedBeat } = await import('../dist/src/taste/seeds.js')
  const { loadEngineCuratedFile } = await import('../dist/src/taste/enginePresets.js')
  const { mkdirSync } = await import('node:fs')
  mkdirSync(outDir, { recursive: true })
  // Curated engine bank (docs/engine-presets.md E2): when present, each synth track's base patch is
  // drawn from the bank + seeded jitter (seeds stay byte-deterministic per seed); absent → the
  // historical random-roll patch. The pilot reads these seed files, so it inherits curated material.
  const curatedPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'presets', 'engine-curated.json')
  const seedCurated = loadEngineCuratedFile(curatedPath)
  if (seedCurated) process.stdout.write(`engine-curated.json present — synth seed patches drawn from the curated bank + seeded jitter\n`)
  for (let i = 0; i < count; i++) {
    const seed = seed0 + i
    const { text, description } = generateSeedBeat(seed, { curated: seedCurated })
    parse(text) // a seed that doesn't parse is a generator bug — fail loudly, write nothing bad
    const file = join(outDir, `seed-${String(seed).padStart(3, '0')}.beat`)
    writeFileSync(file, text + '\n')
    process.stdout.write(`${file}: ${description}\n`)
  }
  process.stdout.write(`next: beat taste-collect ${outDir} — render vary batches for rating\n`)
}

async function tasteCollectCmd(argv) {
  const known = new Set(['--per-seed', '--count', '--seed', '--gen', '--gen-backend', '--amount'])
  for (const a of argv) if (a.startsWith('--') && !known.has(a)) throw new BeatEditError(`unknown flag "${a}" (known: --per-seed, --count, --seed, --gen, --gen-backend, --amount)`)
  const positional = argv.filter((a, i) => !a.startsWith('--') && !known.has(argv[i - 1]))
  const dir = positional[0]
  if (!dir) throw new BeatEditError('taste-collect needs the taste-seeds directory: beat taste-collect <dir> [--per-seed 2] [--count 5] [--gen N]')
  const perSeed = flagValue(argv, '--per-seed') ? Number(flagValue(argv, '--per-seed')) : 2
  // Perturbation strength for synth-param / drum-voice vary batches. vary's own default is 0.25,
  // but owner feedback while rating (2026-07-17): at 0.25 the changes are below the just-noticeable
  // threshold — a "bass env" batch shifted attack by ~0.003s (imperceptible) — so the variants read
  // as near-identical and carry little preference signal, the same failure the gen one-shots had.
  // A bigger default makes each variant audibly distinct. (Not applied to `feel`, which varies via
  // its own timing/velocity knobs, not --amount.)
  const amount = flagValue(argv, '--amount') ? Number(flagValue(argv, '--amount')) : 0.6
  const count = flagValue(argv, '--count') ? Number(flagValue(argv, '--count')) : 5
  const metaSeed = flagValue(argv, '--seed') ? Number(flagValue(argv, '--seed')) : 41
  const genCount = flagValue(argv, '--gen') ? Number(flagValue(argv, '--gen')) : 0
  const genBackend = flagValue(argv, '--gen-backend') ?? 'fal'
  const { mulberry32 } = await import('../dist/src/taste/eval.js')
  const { generateGenStyleBatches } = await import('../dist/src/taste/seeds.js')
  const seedFiles = readdirSync(dir).filter((f) => f.startsWith('seed-') && f.endsWith('.beat')).sort()
  if (seedFiles.length === 0) throw new BeatEditError(`no seed-*.beat files in ${dir} — run beat taste-seeds ${dir} first`)
  // 'feel' rides in the synth pool so timing/velocity taste gets sampled too (its own round type
  // in taste-eval's splits comes from the group name in the manifest).
  // Feel (groove) eligibility, owner 2026-07-18: swing/timing act on NOTE ONSETS, so archetype
  // batches are only audible on dense/offbeat material — hats-driven drums, 16th arps. On a
  // sparse on-beat bassline even tight-vs-heavy-swing is near-silent ("very very little
  // difference"). So: drums ALWAYS get feel (it was wrongly missing there entirely); synth tracks
  // get it only when offbeat-dense enough to carry groove.
  const SYNTH_GROUPS = ['filter', 'env', 'osc', 'mix', 'motion']
  const DRUM_GROUPS = ['kick', 'snare', 'hats', 'feel']
  // ...and only when the notes are SHORT — offbeat count alone wrongly admitted basslines (deep
  // house bass IS offbeat), but sustained soft-attack notes mask timing shifts entirely (owner:
  // "very little variation", every bass feel batch). Groove needs plucky onsets: median note
  // duration <= 1 sixteenth-step, i.e. arps.
  const grooveDense = (t) => {
    if (t.kind !== 'synth') return false
    const notes = t.notes ?? []
    if (notes.filter((n) => n.start % 4 !== 0).length < 6) return false
    const durs = notes.map((n) => n.duration).sort((a, b) => a - b)
    return durs.length > 0 && durs[Math.floor(durs.length / 2)] <= 1
  }
  const rng = mulberry32(metaSeed)
  let made = 0
  let failed = 0
  for (const f of seedFiles) {
    const file = join(dir, f)
    const doc = parse(readFileSync(file, 'utf8'))
    // every (track, group) target this seed supports; drums here are always the legacy 5-lane kit
    // (2026-07-18) osc used to be SKIPPED on polyphonic tracks here — every osc batch on chords
    // died with Tone's "Start time must be strictly greater than previous start time". Root cause
    // was NOT osc2/sub/unison scheduling: the osc vary group includes noiseLevel, and chain.noise
    // is ONE persistent Tone source shared by every note, retriggered once per chord note at the
    // identical slot time. Fixed in the engine by a7ac2c6 (SynthChain.lastNoiseStart monotonic
    // guard); osc-on-poly verified clean on both render paths, so the skip is gone.
    const targets = doc.tracks.flatMap((t) => (t.kind === 'drums' ? DRUM_GROUPS : t.kind === 'synth' ? [...SYNTH_GROUPS, ...(grooveDense(t) ? ['feel'] : [])] : []).map((g) => [t.id, g]))
    for (let b = 0; b < perSeed && targets.length > 0; b++) {
      const [track, group] = targets.splice(Math.floor(rng() * targets.length), 1)[0]
      const varySeed = Math.floor(rng() * 100000)
      // Target-track salience (owner, 2026-07-18, twice: "the arp... is too quiet"; "chords are
      // too quiet... maybe just the stem?"). A quiet varied track in a full mix is unratable.
      //   - param groups (timbre judgments): SOLO the target — mute every other track, boost the
      //     target to a prominent level. Pure A/B of the sound being varied.
      //   - feel (groove judgments): keep the full mix but boost the target — groove is only
      //     judgeable against the rest of the rhythm section.
      // All level changes are batch-constant (fair comparisons) and restored right after.
      const PROMINENT_DB = -4
      const MUTE_DB = -60
      const solo = group !== 'feel'
      const volumes = new Map() // trackId -> original volume, for restore
      for (const t of doc.tracks) {
        const v = t.synth?.volume
        if (typeof v !== 'number') continue
        if (t.id === track && v < PROMINENT_DB) volumes.set(t.id, { from: v, to: PROMINENT_DB })
        else if (solo && t.id !== track) volumes.set(t.id, { from: v, to: MUTE_DB })
      }
      const setVol = (id, v) => execFileSync(process.execPath, [fileURLToPath(import.meta.url), 'set', file, `${id}.volume`, String(v)], { stdio: 'ignore' })
      process.stderr.write(`\n=== ${f}: vary ${track} ${group} (seed ${varySeed}, spread${solo ? ', target solo' : ', full mix + boost'}) ===\n`)
      try {
        // spread replaced --amount jitter for param groups (owner, 2026-07-17) AND fixed-knob feel
        // jitter (owner, 2026-07-18: groove archetypes instead of count rolls of one subtle dice).
        // Pilot 113 (owner-approved): SOLO mix batches exclude `volume` from the varied params.
        // These batches are loudness-normalized before rating, and volume-level differences are
        // precisely the loudness confound the taste program controls away (docs/taste-loop-design.md
        // "Confounds"): normalization gained a -19 dB volume edit right back (+14.9 dB), so the
        // rater heard level-matched audio while the log recorded the volume edit as the preference
        // — and adopting that winner writes a volume nothing normalizes into the project. Pan/eq/
        // duck and the other mix params remain varied; they survive normalization audibly.
        for (const [id, v] of volumes) setVol(id, v.to)
        try {
          execFileSync(process.execPath, [fileURLToPath(import.meta.url), 'vary', file, track, group, '--count', String(count), '--seed', String(varySeed), '--spread', '--render', ...(solo && group === 'mix' ? ['--exclude', 'volume'] : [])], { stdio: ['ignore', 'ignore', 'inherit'] })
        } finally {
          for (const [id, v] of volumes) setVol(id, v.from)
        }
        made += 1
      } catch (err) {
        failed += 1
        process.stderr.write(`warning: vary ${track} ${group} on ${f} failed — skipping (${err instanceof Error ? err.message.split('\n')[0] : err})\n`)
      }
    }
  }
  // Generated-sound batches (owner: "a lot of generation using fal as part of it — those
  // generated sounds are some of the most interesting thus far"). One prompt -> `count`
  // candidates across seeds, batched next to the FIRST seed file (any host works; the batch dir
  // is what `beat rate` finds). Default backend fal (needs FAL_KEY + egress); stub keeps the
  // whole pipeline testable offline.
  let genMade = 0
  if (genCount > 0) {
    const hostFile = join(dir, seedFiles[0])
    // Each gen batch is ONE subject in `count` DISTINCT styles (owner insight 2026-07-17: five seeds
    // of one tight one-shot prompt are near-identical and carry almost no preference signal — the
    // model learns from feature differences between compared items). We call genSourceBatch directly
    // (not a `source gen` subprocess) so we can hand it the per-variant `prompts` array; a gen batch
    // is pure API + prep with no browser/daemon state that would need process isolation.
    const lib = await import(new URL('../scripts/source-lib.mjs', import.meta.url).href)
    for (const batch of generateGenStyleBatches(metaSeed, genCount, count)) {
      const seedFrom = Math.floor(rng() * 100000)
      process.stderr.write(`\n=== gen ${batch.id}: ${batch.label} — ${count} styles (${batch.seconds}s, ${genBackend}) ===\n`)
      try {
        await lib.genSourceBatch({ beatFile: hostFile, id: batch.id, prompt: batch.label, prompts: batch.prompts, seconds: batch.seconds, seedFrom, backend: genBackend })
        genMade += 1
      } catch (err) {
        failed += 1
        // Pilot 112 (MEDIUM): own the message rather than leaking a child command line / a flag
        // THIS command rejects (ours is --gen-backend, not --backend).
        process.stderr.write(`warning: gen "${batch.id}" failed — skipping${genBackend === 'fal' ? ' (fal needs FAL_KEY + network; retry with --gen-backend stub for placeholder audio, or --gen-backend stableaudio for local generation)' : ''} (${err instanceof Error ? err.message.split('\n')[0] : err})\n`)
        // a failed gen can leave its empty batch dir behind — remove it so `beat rate` never
        // queues a wav-less husk
        try {
          const husk = join(dir, `gen-${batch.id}-${seedFrom}`)
          if (existsSync(husk) && !readdirSync(husk).some((x) => x.endsWith('.wav'))) rmSync(husk, { recursive: true })
        } catch { /* best-effort cleanup */ }
      }
    }
  }
  process.stdout.write(`\n${made} vary batch(es) + ${genMade} gen batch(es) across ${seedFiles.length} seed song(s)${failed > 0 ? ` (${failed} failed)` : ''}\n`)
  process.stdout.write(`next: beat rate ${dir} — rate them in the browser; then beat taste-eval --log ${join(dir, 'beat-scores.jsonl')}\n`)
}

function flagValue(argv, flag) {
  const i = argv.indexOf(flag)
  return i !== -1 ? argv[i + 1] : undefined
}

// Source-showdown eval (docs/source-showdown-eval.md): blind per-role comparison of WHERE good
// sound comes from — engine synth vs fal generation vs keymap-repitched generation vs (opt-in,
// private) reference chops. Collection builds clip-set batches `beat rate` scores through the
// unchanged blind flow; --report is the standing scoreboard. A sibling of taste-collect rather
// than a mode of it: taste-collect's rounds vary ONE pipeline against itself, a showdown round
// varies the PIPELINE — different grammar (roles + sources, no --per-seed/--count), different
// report, same seeds dir and rating loop.
async function showdownCmd(argv) {
  const valued = ['--roles', '--rounds', '--seed', '--gen-backend', '--ref-dir', '--midi-dir', '--seconds', '--log']
  const known = new Set([...valued, '--report', '--json', '--with-produced', '--with-surge', '--surge-doctor', '--shared-figure', '--random-patches'])
  for (const a of argv) if (a.startsWith('--') && !known.has(a)) throw new BeatEditError(`unknown flag "${a}" (known: ${[...known].join(', ')})`)
  const positional = argv.filter((a, i) => !a.startsWith('--') && !valued.includes(argv[i - 1]))
  const dir = positional[0]
  const showdown = await import('../dist/src/taste/showdown.js')

  // ---- surge diagnostics -----------------------------------------------------------------------
  // surgepy is a source-build artifact of Surge XT (no PyPI wheel); this surfaces exactly what's
  // missing / where the factory content is, same spirit as `beat analyze --doctor`.
  if (argv.includes('--surge-doctor')) {
    const { surgeDoctor } = await import('../dist/src/analysis/surge.js')
    const report = await surgeDoctor()
    process.stdout.write(argv.includes('--json') ? JSON.stringify(report, null, 2) + '\n' : formatSurgeDoctor(report))
    return
  }

  // ---- the scoreboard --------------------------------------------------------------------------
  if (argv.includes('--report')) {
    const logPath = flagValue(argv, '--log') ?? (dir ? join(dir, 'beat-scores.jsonl') : null)
    if (!logPath || !existsSync(logPath)) {
      throw new BeatEditError('showdown --report needs a scored collection: beat showdown <dir> --report (beat-scores.jsonl at the dir root) or --log <path>')
    }
    const report = showdown.computeShowdownReport(logPath)
    process.stdout.write(argv.includes('--json') ? JSON.stringify(report, null, 2) + '\n' : showdown.formatShowdownReport(report))
    return
  }
  if (argv.includes('--json')) throw new BeatEditError('--json only applies to showdown --report')

  // ---- collection ------------------------------------------------------------------------------
  if (!dir) throw new BeatEditError('showdown needs the taste-seeds directory: beat showdown <dir> [--roles r1,r2] [--rounds 1] [--with-produced] [--ref-dir <path>] (or --report)')
  const { mulberry32 } = await import('../dist/src/taste/eval.js')
  const { genSubject, genSubjectVaried, genStyles } = await import('../dist/src/taste/seeds.js')
  const { writeVaryBatch, renderVaryBatch, normalizeBatchLoudness, formatNormalizationResult } = await import('../dist/src/vary/batch.js')
  const { mkdirSync, copyFileSync } = await import('node:fs')
  const lib = await import(new URL('../scripts/source-lib.mjs', import.meta.url).href)
  // Engine preset provenance + role-mapped draw (docs/engine-presets.md E0/E1/E2).
  const { RANDOM_SEED_PATCH, withPatchProvenance, pickEnginePreset, loadEngineCuratedFile } = await import('../dist/src/taste/enginePresets.js')

  const roles = (flagValue(argv, '--roles') ?? showdown.SHOWDOWN_ROLES.map((r) => r.role).join(','))
    .split(',')
    .filter(Boolean)
    .map((r) => showdown.showdownRole(r)) // throws with the legal list on a typo
  const rounds = flagValue(argv, '--rounds') ? Number(flagValue(argv, '--rounds')) : 1
  const metaSeed = flagValue(argv, '--seed') ? Number(flagValue(argv, '--seed')) : 41
  const genBackend = flagValue(argv, '--gen-backend') ?? 'fal'
  const targetSeconds = flagValue(argv, '--seconds') !== undefined ? Number(flagValue(argv, '--seconds')) : undefined
  // the engineplus ablation (docs/source-showdown-eval.md): a fifth clip — same figure, same
  // patch, plus a production pass as ordinary .beat edits — measuring how much of the engine's
  // blind-rating deficit is production (width/air/glue) rather than raw synth timbre
  const withProduced = argv.includes('--with-produced')
  // the Surge-as-sound-factory probe (research 114 §7): a clip that renders the SAME composed
  // figure through a Surge XT factory patch via python/surge_render.py — does a pro-grade synth +
  // patch library close the timbre gap the engine can't? Pitched roles only; drum-loop is skipped
  // (a kit through a synth patch is a different question). Degrades to warn-and-skip when surgepy
  // isn't built (CI/stub), never breaking the batch.
  const withSurge = argv.includes('--with-surge')
  // Un-blinding fix (owner, 2026-07-21, mid-rating): a batch where every composed source shares one
  // figure reveals the dotbeat-rendered cluster by its repeated melody. By default EVERY composed
  // source (engine, engineplus, keymap, surge) draws its OWN distinct archetype figure
  // (exclude-chained within the batch and across the run); --shared-figure restores the controlled
  // ablation (same notes across composed sources, only the sound-source varies).
  const sharedFigure = argv.includes('--shared-figure')
  // Engine preset draw (docs/engine-presets.md E1/E2): by DEFAULT the engine (and engineplus) clip
  // draws a role-mapped factory preset — the curated bank when presets/engine-curated.json exists,
  // factory.json / drum-kits.json otherwise — applied to the seed track as an ordinary preset edit,
  // instead of the seed's randomly rolled patch. --random-patches restores the historical behavior
  // (the seed's own random synthBlock) so the two patch eras stay directly comparable in one report.
  const randomPatches = argv.includes('--random-patches')
  const refDir = flagValue(argv, '--ref-dir')
  if (refDir !== undefined && !existsSync(refDir)) throw new BeatEditError(`no directory at --ref-dir ${refDir}`)

  // The midi figure source (docs/source-showdown-eval.md, "The midi figure source"): with
  // --midi-dir the composed sources draw their figures from MIDI transcriptions of commercial
  // tracks instead of the archetype bank — holding COMPOSITION at commercial quality so ratings
  // compare sound realization. Resolved ONCE here: doctor probe + file enumeration; anything
  // unusable warns once and the run falls back to the bank (the flag degrades, never breaks).
  // The .mid files are private derivative works — see the licensing block in the help text.
  const midiDir = flagValue(argv, '--midi-dir')
  let midifig = null
  let midiPool = []
  if (midiDir !== undefined) {
    if (!existsSync(midiDir)) throw new BeatEditError(`no directory at --midi-dir ${midiDir}`)
    midifig = await import('../dist/src/taste/midifig.js')
    const midiReport = await midifig.midiExtractDoctor()
    if (!midifig.midiExtractAvailable(midiReport)) {
      process.stderr.write(`warning: --midi-dir: midi_extract unavailable (${midiReport.error ?? 'mido not installed — pip install -r python/requirements-midi.txt'}) — composed figures fall back to the archetype bank\n`)
    } else {
      midiPool = midifig.listMidiFiles(midiDir)
      if (midiPool.length === 0) {
        process.stderr.write(`warning: no .mid files under ${midiDir} — composed figures fall back to the archetype bank\n`)
      } else {
        process.stderr.write(`midi figures: ${midiPool.length} file(s) under ${midiDir} — composed sources play commercial figures (midi batches are gitignore-gated, never committed)\n`)
      }
    }
  }

  // Resolve surge availability + the factory patch catalogue ONCE (not per batch): a doctor probe,
  // then the patch listing. On any failure surge is disabled for the whole run with one warning —
  // the other four sources still collect. surgeMod stays null when --with-surge is off.
  let surgeMod = null
  let surgePatches = null
  let curatedFile = null // loaded presets/surge-curated.json (D26) — narrows each role's draw to
  // the curated top quartile; absent → blind draw from the full pool (CI-safe, unchanged behavior)
  if (withSurge) {
    surgeMod = await import('../dist/src/analysis/surge.js')
    const curationMod = await import('../dist/src/taste/surgeCuration.js')
    try {
      const doc = await surgeMod.surgeDoctor()
      if (!surgeMod.surgeAvailable(doc)) {
        process.stderr.write(`warning: --with-surge: surgepy unavailable (${doc.error ?? doc.surgepy?.fix ?? 'not built'}) — skipping surge clips (beat showdown --surge-doctor for the build steps)\n`)
      } else {
        surgePatches = await surgeMod.listSurgePatches()
        process.stderr.write(`surge: ${surgePatches.length} factory patches at ${doc.patchesRoot ?? doc.factoryPath ?? '?'}\n`)
        // Curated pool (scripts/curate-surge-patches.mjs writes presets/surge-curated.json). When
        // present, the surge clip draws from the curated per-role list; when absent, the full pool.
        const curatedPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'presets', 'surge-curated.json')
        curatedFile = curationMod.loadCuratedFile(curatedPath)
        if (curatedFile !== null) {
          const sizes = Object.entries(curatedFile.roles ?? {}).map(([r, v]) => `${r} ${v.kept?.length ?? 0}/${v.pool ?? '?'}`).join(', ')
          process.stderr.write(`surge: curated pool loaded (${sizes || 'no roles'}) from presets/surge-curated.json\n`)
        }
      }
    } catch (err) {
      process.stderr.write(`warning: --with-surge: ${err instanceof Error ? err.message.split('\n')[0] : err} — skipping surge clips\n`)
    }
  }

  const seedFiles = readdirSync(dir).filter((f) => f.startsWith('seed-') && f.endsWith('.beat')).sort()
  if (seedFiles.length === 0) throw new BeatEditError(`no seed-*.beat files in ${dir} — run beat taste-seeds ${dir} first`)
  const seeds = seedFiles.map((f) => ({ file: f, doc: parse(readFileSync(join(dir, f), 'utf8')) }))

  // Ref pool: wavs under --ref-dir, read-only. A <ref-dir>/<role>/ subdir scopes the pool to the
  // role when present; otherwise any wav qualifies. Only .wav — the trim/normalize working copy
  // is frame math on RIFF data, and transcoding someone's private chops is out of scope.
  const refPool = (roleName) => {
    if (refDir === undefined) return []
    const scoped = join(refDir, roleName)
    const base = existsSync(scoped) ? scoped : refDir
    const out = []
    const walk = (d) => {
      let entries
      try { entries = readdirSync(d, { withFileTypes: true }) } catch { return }
      for (const e of entries) {
        if (e.isDirectory() && !e.name.startsWith('.')) walk(join(d, e.name))
        else if (e.name.toLowerCase().endsWith('.wav')) out.push(join(d, e.name))
      }
    }
    walk(base)
    return out.sort()
  }

  // Engine preset pool (E1/E2), loaded ONCE. When --random-patches is set it stays unused (the seed
  // keeps its random patch). The curated bank is preferred when present, factory next.
  let enginePresets = []
  let engineCurated = null
  if (!randomPatches) {
    try {
      enginePresets = loadPresets()
      const curatedPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'presets', 'engine-curated.json')
      engineCurated = loadEngineCuratedFile(curatedPath)
      const bankSize = Object.entries(engineCurated?.roles ?? {}).map(([r, v]) => `${r} ${v.kept?.length ?? 0}`).join(', ')
      process.stderr.write(`engine patches: factory (${enginePresets.length} presets)${engineCurated ? ` + curated bank (${bankSize || 'no roles'})` : ''} — engine/engineplus draw a role-mapped voicing (--random-patches for the historical random-seed-patch era)\n`)
    } catch (err) {
      process.stderr.write(`warning: engine preset pool failed to load (${err instanceof Error ? err.message.split('\n')[0] : err}) — falling back to random-seed-patch\n`)
    }
  }

  const rng = mulberry32(metaSeed)
  let made = 0
  let failed = 0
  // per-role archetypes already composed this session — threaded into the composer's exclude
  // list so no two batches of one run share a figure (the un-blinding fix's session guarantee)
  const usedFigures = new Map()
  // per-role preset names already drawn this run — exclude-chained so a run doesn't repeat a
  // voicing while the pool has alternatives (the archetype-figure convention, E1)
  const usedPresets = new Map()
  for (let round = 0; round < rounds; round++) {
    for (const spec of roles) {
      const batchSeed = Math.floor(rng() * 100000)
      const genSeed = Math.floor(rng() * 100000)
      const kmSeed = Math.floor(rng() * 100000)
      const styles = genStyles()
      const style = styles[Math.floor(rng() * styles.length)]
      const kmStyle = styles[Math.floor(rng() * styles.length)]
      const refPick = Math.floor(rng() * 100000) // drawn unconditionally so --ref-dir never shifts the other seeds
      // a seed song that actually carries this role's track (the arp track is optional per seed)
      const candidates = seeds.filter((s) => s.doc.tracks.some((t) => t.id === spec.seedTrack))
      if (candidates.length === 0) {
        failed += 1
        process.stderr.write(`warning: no seed song has a "${spec.seedTrack}" track for role ${spec.role} — skipping (generate more seeds: beat taste-seeds ${dir})\n`)
        continue
      }
      const seed = candidates[Math.floor(rng() * candidates.length)]
      const seedPath = join(dir, seed.file)
      const outDir = join(dir, `showdown-${spec.role}-${batchSeed}`)
      const workDir = join(outDir, 'work')
      const surgeThisRole = surgePatches !== null && showdown.surgeRoleCategories(spec.role) !== null
      process.stderr.write(`\n=== showdown ${spec.role}: composed figure in ${seed.file}'s key — engine vs ${withProduced ? 'engineplus vs ' : ''}gen vs keymap${surgeThisRole ? ' vs surge' : ''}${surgeThisRole && withProduced ? ' vs surgeplus' : ''}${refDir !== undefined ? ' vs ref' : ''} (seed ${batchSeed}, ${genBackend}) ===\n`)
      try {
        mkdirSync(workDir, { recursive: true })

        // BPM matching (owner, 2026-07-21, mid-rating: mixed tempos in one blind batch are both
        // a tell and a comparison killer). The ref clip is the only source that can't be
        // re-rendered, so the whole batch conforms to IT: detect its tempo with the analysis
        // sidecar (cached next to the wav), fold half/double-time readings into range, and
        // render engine/keymap/engineplus at that bpm; the gen prompt gets the same bpm as an
        // explicit hint. No ref (or sidecar unavailable — e.g. stub/CI): the seed's own bpm is
        // used, which still pins gen to the composed clips.
        const refPathEarly = (() => {
          if (refDir === undefined) return null
          const pool = refPool(spec.role)
          if (pool.length === 0) return null
          // audibility guard (owner, 2026-07-21): a mostly-silent chop (e.g. a bass stem where
          // the bass is tacet) survives loudness normalization as a near-inaudible clip — scan
          // deterministically forward from the seeded pick until a chop is actually ACTIVE,
          // falling back to the original pick (with a warning) if the whole pool is sparse.
          for (let offset = 0; offset < pool.length; offset++) {
            const candidate = resolve(pool[(refPick + offset) % pool.length])
            try {
              const { channels, sampleRate } = decodeWav(readFileSync(candidate))
              const active = showdown.activeFraction(channels, sampleRate)
              if (active >= 0.5) {
                if (offset > 0) process.stderr.write(`ref pick advanced ${offset} (skipped mostly-silent chop${offset === 1 ? '' : 's'})\n`)
                return candidate
              }
              process.stderr.write(`ref candidate mostly silent (${Math.round(active * 100)}% active) — trying next: ${basename(candidate)}\n`)
            } catch {
              process.stderr.write(`ref candidate unreadable — trying next: ${basename(candidate)}\n`)
            }
          }
          process.stderr.write(`warning: every ${spec.role} ref chop is mostly silent — using the seeded pick anyway\n`)
          return resolve(pool[refPick % pool.length])
        })()
        let batchBpm = seed.doc.bpm
        let bpmFromRef = false
        if (refPathEarly !== null && genBackend !== 'stub') {
          try {
            const { runAnalysis } = await import('../dist/src/analysis/sidecar.js')
            const { artifact } = await runAnalysis({ audioPath: refPathEarly, backend: 'beatthis' })
            if (typeof artifact.bpm === 'number' && artifact.bpm > 0) {
              batchBpm = showdown.foldBpmToRange(artifact.bpm)
              bpmFromRef = true
              process.stderr.write(`bpm-matched to ref: ${batchBpm} BPM (detected ${artifact.bpm.toFixed(1)}, ${artifact.bpmMethod})\n`)
            }
          } catch (err) {
            process.stderr.write(`bpm match skipped (${err?.message?.split('\n')[0] ?? err}) — using seed bpm ${batchBpm}\n`)
          }
        }

        // per-source composed figures (owner, 2026-07-21, SECOND un-blinding report: composed
        // clips sharing one figure per batch made the dotbeat-rendered group identifiable as a
        // same-melody cluster). Default: every composed source (engine, engineplus, keymap, and
        // surge below) draws its OWN archetype figure, exclude-chained so no two clips in a
        // batch — nor two batches in a run — repeat one. --shared-figure restores the controlled
        // ablation (identical notes across composed sources) for when isolating the sound-source
        // variable matters more than blindness (that mode produced the 2026-07-21
        // production-vs-timbre split).
        const pitchedKey = spec.role === 'drum-loop' ? null : showdown.inferSeedKey(seed.doc)
        const runExclude = usedFigures.get(spec.role) ?? []
        const drawnFigures = []
        let batchUsedMidi = false
        const drawComposed = (seedOffset) => {
          const exclude = [...runExclude, ...drawnFigures]
          const composed = spec.role === 'drum-loop'
            ? showdown.composeDrumPhrase(batchSeed + seedOffset, { exclude })
            : showdown.composePitchedPhrase(spec.role, pitchedKey, batchSeed + seedOffset, { exclude })
          drawnFigures.push(composed.archetype)
          return composed
        }
        // The midi figure source: when --midi-dir is live and this role maps to a midi part
        // (bassline/chords/lead — drum-loop keeps the bank), each composed source draws a figure
        // extracted from a DISTINCT midi file (same exclude-chain contract as the bank archetypes;
        // bank names and midi labels share one list and can never collide). Unusable files are
        // skipped for the next pick; a fully-unusable pool falls back to the bank with a warning.
        const midiPart = midifig !== null ? midifig.roleMidiPart(spec.role) : null
        const drawFigure = async (seedOffset) => {
          if (midiPool.length > 0 && midiPart !== null && pitchedKey !== null) {
            const tried = []
            for (let attempt = 0; attempt < Math.min(4, midiPool.length); attempt++) {
              const exclude = [...runExclude, ...drawnFigures, ...tried]
              const file = midifig.pickMidiFile(midiPool, batchSeed + seedOffset + attempt * 7919, exclude)
              if (file === null || exclude.includes(midifig.midiFigureLabel(file))) break // pool exhausted
              try {
                const figure = await midifig.runMidiExtract({ midiPath: file, part: midiPart, bars: 4 })
                const conv = midifig.midiFigureToComposedPhrase(figure, pitchedKey)
                drawnFigures.push(conv.phrase.archetype)
                batchUsedMidi = true
                return { composed: conv.phrase, midi: { file, figure, transposition: conv.transposition } }
              } catch (err) {
                tried.push(midifig.midiFigureLabel(file))
                process.stderr.write(`midi figure unusable (${err instanceof Error ? err.message.split('\n')[0] : err}) — trying another file\n`)
              }
            }
            process.stderr.write(`warning: no usable ${midiPart} midi figure — ${spec.role} falls back to the archetype bank\n`)
          }
          return { composed: drawComposed(seedOffset), midi: null }
        }
        // honest per-clip figure description for the manifest `from` (the midi path and the
        // transposition are LOCAL provenance — the shared log only ever sees figureSource)
        const figDesc = (drawn) => (drawn.midi !== null
          ? `${drawn.composed.archetype} [${drawn.midi.file}] (${drawn.midi.transposition})`
          : `composed ${drawn.composed.archetype} figure`)
        const applyComposed = (composed) => (spec.role === 'drum-loop'
          ? showdown.applyComposedDrums(extended, spec.seedTrack, composed)
          : showdown.applyComposedPhrase(extended, spec.seedTrack, composed))

        const engineDrawn = await drawFigure(0)
        const engineComposed = engineDrawn.composed
        // a midi-figure batch without a ref to conform to conforms to the SOURCE TRACK's own
        // tempo (the figure was written for it), which still pins gen via the prompt's bpm hint
        if (!bpmFromRef && engineDrawn.midi !== null && engineDrawn.midi.figure.bpm !== null) {
          batchBpm = showdown.foldBpmToRange(engineDrawn.midi.figure.bpm)
          process.stderr.write(`bpm from the midi figure's own tempo: ${batchBpm} BPM\n`)
        }
        let extended = { ...showdown.extendToFourBars(seed.doc), bpm: batchBpm }
        // patch provenance (docs/engine-presets.md E0): the engine/engineplus clips carry a tag
        // recording which patch era produced them. Default is the seed's random-seed-patch; E1/E2
        // swap in a role-mapped factory/curated voicing (and record factory:/curated:).
        let enginePatchProvenance = RANDOM_SEED_PATCH
        // E1/E2: replace the seed's random patch with a role-mapped preset (applied to the seed
        // track as an ordinary preset edit, BEFORE the figure composes, so the engineplus clip —
        // which produces whatever patch the engine clip carries — inherits it for free). Seeded by
        // the batch seed, exclude-chained across the run. Degrades to the random patch on any miss.
        if (!randomPatches && enginePresets.length > 0) {
          try {
            const pick = pickEnginePreset({
              role: spec.role,
              seed: batchSeed,
              presets: enginePresets,
              curated: engineCurated,
              exclude: usedPresets.get(spec.role) ?? [],
            })
            if (pick !== null) {
              extended = { ...pick.apply(extended, spec.seedTrack), bpm: batchBpm }
              enginePatchProvenance = pick.provenance
              usedPresets.set(spec.role, [...(usedPresets.get(spec.role) ?? []), pick.name])
              process.stderr.write(`engine patch: ${pick.provenance} (${spec.role})\n`)
            } else {
              process.stderr.write(`engine patch: no ${spec.role} preset in the pool — keeping random-seed-patch\n`)
            }
          } catch (err) {
            process.stderr.write(`engine patch draw skipped (${err instanceof Error ? err.message.split('\n')[0] : err}) — keeping random-seed-patch\n`)
          }
        }
        const phrased = applyComposed(engineComposed)
        const figure = engineComposed.archetype
        // pitchedPhrase: the engine clip's ComposedPhrase for pitched roles — the surge render's
        // shared-figure source and its "this role composes" gate (null for drum-loop)
        const pitchedPhrase = spec.role === 'drum-loop' ? null : engineComposed
        const plusDrawn = withProduced ? (sharedFigure ? engineDrawn : await drawFigure(101)) : null
        const plusComposed = plusDrawn === null ? null : plusDrawn.composed
        const kmDrawn = sharedFigure ? engineDrawn : await drawFigure(202)
        const kmComposed = kmDrawn.composed
        usedFigures.set(spec.role, [...runExclude, ...drawnFigures])
        process.stderr.write(`composed figure(s): ${drawnFigures.join(', ')}${sharedFigure ? ' (shared across composed sources)' : ''} (batch seed ${batchSeed})\n`)

        // engine clip: its composed figure soloed through dotbeat's own synth engine
        const engineDoc = showdown.soloForShowdown(phrased, spec.seedTrack)

        // engineplus clip (--with-produced): the engine patch + the production pass (width/air/
        // glue as ordinary .beat edits); its own figure by default, the engine's under
        // --shared-figure (the controlled same-notes ablation)
        let produced = null
        let plusFigure = null
        if (withProduced && plusComposed !== null) {
          const plusBase = plusComposed === engineComposed ? engineDoc : showdown.soloForShowdown(applyComposed(plusComposed), spec.seedTrack)
          produced = showdown.applyProductionTreatment(plusBase, spec.seedTrack)
          plusFigure = plusComposed.archetype
        }
        const kmPhrased = kmComposed === engineComposed ? phrased : applyComposed(kmComposed)
        const kmFigure = kmComposed.archetype

        // keymap clip: generated one-shot(s) registered into a scratch host, then played as an
        // instrument through the engine's sampler lanes
        const kmBase = join(workDir, 'km-base.beat')
        let kmDoc
        let kmFrom
        if (spec.keymap.kind === 'pitched') {
          writeFileSync(kmBase, showdown.keymapScratchText(batchBpm))
          const oneShot = genSubject(spec.keymap.oneShotSubjectId)
          const kmPrompt = `${oneShot.subject}, ${kmStyle}`
          await lib.addGeneratedSource({ beatFile: kmBase, id: 'sdkm', prompt: kmPrompt, seconds: oneShot.seconds, seed: kmSeed, backend: genBackend })
          const scratch = parse(readFileSync(kmBase, 'utf8'))
          const { channels, sampleRate } = decodeWav(readFileSync(join(workDir, 'media', 'sdkm.wav')))
          const pitch = detectPitch(channels, sampleRate)
          // an automated pipeline takes the best available root rather than refusing: detected
          // pitch, else the strongest-low-partial suggestion, else a4 — the root is recorded
          const rootMidi = pitch.midi ?? (pitch.suggestedRootNote ? noteToMidi(pitch.suggestedRootNote) : 69)
          const phrase = showdown.phraseFromSeed(kmPhrased, spec.seedTrack)
          const built = showdown.buildPitchedKeymapPhrase(scratch, 'sdkm', rootMidi, phrase)
          kmDoc = built.doc
          kmFrom = `keymap of "${kmPrompt}" (root ${midiToNote(Math.round(rootMidi))}, ${pitch.level ?? 'no'} confidence) playing the ${figDesc(kmDrawn)} (${seed.file}'s key)`
        } else {
          const drumsOnly = showdown.isolateTrack(kmPhrased, spec.seedTrack)
          writeFileSync(kmBase, showdown.serializeChecked(drumsOnly))
          const samplesByLane = {}
          const promptsUsed = []
          for (const [lane, subjectId] of Object.entries(spec.keymap.laneSubjects)) {
            const oneShot = genSubject(subjectId)
            const prompt = `${oneShot.subject}, ${kmStyle}`
            await lib.addGeneratedSource({ beatFile: kmBase, id: `sd${lane}`, prompt, seconds: oneShot.seconds, seed: kmSeed + promptsUsed.length, backend: genBackend })
            samplesByLane[lane] = `sd${lane}`
            promptsUsed.push(prompt)
          }
          kmDoc = showdown.buildKitPhrase(parse(readFileSync(kmBase, 'utf8')), spec.seedTrack, samplesByLane)
          kmFrom = `sample-lane kit of generated one-shots ("${kmStyle}") playing the composed ${kmFigure} groove`
        }

        // render engine (+ engineplus) + keymap in ONE batch boot (offline by default; raw
        // levels — the whole showdown batch is normalized together below, across sources)
        const workVariants = [
          { doc: engineDoc, recipe: withPatchProvenance(`engine ${spec.seedTrack} solo (composed ${figure})`, enginePatchProvenance) },
          ...(produced ? [{ doc: produced.doc, recipe: withPatchProvenance(`engine ${spec.seedTrack} solo + production pass (composed ${plusFigure})`, enginePatchProvenance) }] : []),
          { doc: kmDoc, recipe: `keymap phrase (composed ${kmFigure})` },
        ]
        writeVaryBatch({
          parentPath: seedPath,
          parentText: readFileSync(seedPath, 'utf8'),
          track: spec.seedTrack,
          group: 'showdown-work',
          count: workVariants.length,
          seed: batchSeed,
          outDir: workDir,
          variants: workVariants,
        })
        renderVaryBatch(workDir, workVariants.length, { normalize: false })

        // gen clip: the role's phrase-tier prompt, one candidate (prep pipeline included).
        // genSubjectVaried draws a genre/mood variant (not just a style treatment) so every
        // showdown round's gen clip isn't recognizable by always being the same musical
        // character (owner, 2026-07-21).
        const phraseSubject = genSubjectVaried(spec.phraseSubjectId, rng)
        const genPrompt = `${phraseSubject.subject}, ${style}, ${batchBpm} BPM`
        const genDir = join(workDir, 'gen')
        await lib.genSourceBatch({
          beatFile: seedPath,
          id: `sd${spec.role.replace(/-/g, '')}`,
          prompt: phraseSubject.subject,
          prompts: [genPrompt],
          seconds: phraseSubject.seconds,
          seedFrom: genSeed,
          backend: genBackend,
          outDir: genDir,
        })

        // surge clip (--with-surge, pitched roles only): the SAME composed figure rendered through
        // a Surge XT factory patch — timbre comparison, composition held constant. The patch is a
        // deterministic seeded pick from the role's category listing (recorded in the manifest for
        // reproducibility). Any failure warns and drops the surge clip; the batch still ships.
        let surgeClip = null
        if (surgeThisRole && pitchedPhrase !== null) {
          try {
            // curated draw (D26): the role's curated patch-key Set from presets/surge-curated.json,
            // or null → full role pool (blind, unchanged). Threaded into every pick + ring redraw.
            const curationMod = await import('../dist/src/taste/surgeCuration.js')
            const curatedKeys = curationMod.curatedKeysForRole(curatedFile, spec.role)
            const patch = showdown.pickSurgePatch(surgePatches, spec.role, batchSeed, { curatedKeys })
            if (patch === null) {
              process.stderr.write(`surge: no factory patch in ${showdown.surgeRoleCategories(spec.role).join('/')} for ${spec.role} — skipping surge clip\n`)
            } else {
              // by default the surge clip draws its OWN distinct figure (exclude-chained off the
              // engine's, and recorded so the next batch avoids it too); --shared-figure holds the
              // engine's figure constant for the controlled "same notes, different source" ablation
              let surgeDrawn = { composed: pitchedPhrase, midi: engineDrawn.midi }
              if (!sharedFigure) {
                surgeDrawn = await drawFigure(977)
                usedFigures.set(spec.role, [...runExclude, ...drawnFigures])
              }
              const surgePhrase = surgeDrawn.composed
              const surgeFigure = surgePhrase.archetype
              const notes = showdown.composedPhraseToSurgeNotes(surgePhrase, batchBpm)
              const surgeWav = join(workDir, 'surge.wav')
              // ring screen (owner, 2026-07-21, blind rating: several factory patches carry a
              // piercing narrow 4-8 kHz resonance, often hard-panned right — "Robochoir 2",
              // "Magic Music Box"). The sidecar reports its render's worst narrow tonal peak
              // (ringDb); a patch above the threshold is redrawn (deterministically, excluding
              // tried patches) up to 3 times, keeping the least-ringy render if none pass.
              const RING_DB_MAX = -32
              let chosen = null
              const tried = new Set()
              for (let attempt = 0; attempt < 3; attempt++) {
                const pool = surgePatches.filter((p) => !tried.has(p.path))
                const candidate = attempt === 0 ? patch : showdown.pickSurgePatch(pool, spec.role, batchSeed + attempt * 7919, { curatedKeys })
                if (candidate === null) break
                tried.add(candidate.path)
                const attemptWav = join(workDir, `surge-try${attempt}.wav`)
                const res = await surgeMod.runSurgeRender({ patch: candidate.path, notes, sampleRate: 44100, outPath: attemptWav })
                const ring = typeof res.ringDb === 'number' ? res.ringDb : -120
                if (chosen === null || ring < chosen.ring) chosen = { patch: candidate, ring, wav: attemptWav }
                if (ring <= RING_DB_MAX) break
                process.stderr.write(`surge: "${candidate.name}" rings (narrow peak ${ring} dB) — redrawing patch\n`)
              }
              if (chosen === null) throw new Error('no surge patch available after ring screening')
              copyFileSync(chosen.wav, surgeWav)
              if (chosen.ring > RING_DB_MAX) process.stderr.write(`surge: every tried patch rings — keeping the least-ringy ("${chosen.patch.name}", ${chosen.ring} dB)\n`)
              surgeClip = { kind: 'surge', wav: surgeWav, from: `Surge XT patch "${chosen.patch.name}" (${chosen.patch.category}) playing the ${figDesc(surgeDrawn)}${sharedFigure ? ' (shared with the engine clip)' : ''}` }
              process.stderr.write(`surge: rendered "${chosen.patch.name}" (${chosen.patch.category}) on the ${surgeFigure} figure (ring ${chosen.ring} dB)\n`)
            }
          } catch (err) {
            process.stderr.write(`surge render skipped (${err instanceof Error ? err.message.split('\n')[0] : err})\n`)
          }
        }

        // surgeplus clip (--with-surge AND --with-produced, pitched roles only): the SAME surge
        // render THROUGH a dotbeat production pass — isolates production for surge exactly as
        // engineplus does for engine (same figure + patch audio, only production varies). The surge
        // WAV can't take SYNTH_FIELDS edits (it's sidecar audio, not engine-synthesized), and an
        // 'audio'-KIND track carries no effect chain by format design (the engine renders it dry),
        // so the render is hosted the SAME way the keymap clip hosts its one-shot: a single-trigger
        // sample voice on a drums-kind scratch host — the audio-playback track dotbeat's engine
        // actually produces (sample -> filter -> drum bus + reverb/delay sends). Produced with the
        // role's produce.ts profile (applyProducedDefaults, engineplus's own primitive; its synth-
        // only width moves are auto-dropped on a sample voice), rendered offline like the work
        // batch. Graceful skip on any failure — and whenever surge itself skipped.
        let surgeplusClip = null
        if (withProduced && surgeClip !== null) {
          try {
            const spDir = join(workDir, 'surgeplus')
            mkdirSync(spDir, { recursive: true })
            const spBase = join(spDir, 'sp-base.beat')
            writeFileSync(spBase, showdown.surgeSampleHostText(batchBpm))
            await lib.addLocalSource({ beatFile: spBase, id: 'sdsurge', audioFile: surgeClip.wav, license: 'surge-factory-render', note: 'surge factory-patch render (surgeplus production host)' })
            const spHost = showdown.buildSurgeSampleHost(parse(readFileSync(spBase, 'utf8')), 'sdsurge')
            const spProduced = showdown.applySurgeplusProduction(spHost, spec.role)
            const spApplied = spProduced.applied.length > 0 ? spProduced.applied.join(', ') : 'no production moves landed'
            writeVaryBatch({
              parentPath: spBase,
              parentText: readFileSync(spBase, 'utf8'),
              track: showdown.SURGEPLUS_TRACK_ID,
              group: 'surgeplus-work',
              count: 1,
              seed: batchSeed,
              outDir: spDir,
              variants: [{ doc: spProduced.doc, recipe: `surge render + production pass (${spApplied})` }],
            })
            renderVaryBatch(spDir, 1, { normalize: false })
            const spWav = join(spDir, 'v1.wav')
            if (!existsSync(spWav)) throw new Error('surgeplus render produced no wav')
            surgeplusClip = { kind: 'surgeplus', wav: spWav, from: `${surgeClip.from} + production pass: ${spApplied} (same surge render as the surge clip, dotbeat production host)` }
            process.stderr.write(`surgeplus: produced the surge render (${spApplied})\n`)
          } catch (err) {
            process.stderr.write(`surgeplus skipped (${err instanceof Error ? err.message.split('\n')[0] : err})\n`)
          }
        }

        const clips = [
          { kind: 'engine', wav: join(workDir, 'v1.wav'), from: withPatchProvenance(`${figDesc(engineDrawn)} on ${seed.file} ${spec.seedTrack} solo (4 bars, dotbeat engine)`, enginePatchProvenance) },
          ...(produced
            ? [{ kind: 'engineplus', wav: join(workDir, 'v2.wav'), from: withPatchProvenance(`${sharedFigure ? `same ${figDesc(plusDrawn)} and patch as the engine clip` : `${figDesc(plusDrawn)} through the engine patch`} + production pass: ${produced.applied.join(', ')} (dotbeat engine)`, enginePatchProvenance) }]
            : []),
          { kind: 'keymap', wav: join(workDir, produced ? 'v3.wav' : 'v2.wav'), from: kmFrom },
          { kind: 'gen', wav: join(genDir, 'v1.wav'), from: `"${genPrompt}" (${genBackend})` },
          ...(surgeClip ? [surgeClip] : []),
          ...(surgeplusClip ? [surgeplusClip] : []),
        ]
        if (refDir !== undefined) {
          if (refPathEarly === null) {
            process.stderr.write(`warning: no .wav under ${refDir}${existsSync(join(refDir, spec.role)) ? `/${spec.role}` : ''} — building this ${spec.role} batch without a ref clip\n`)
          } else {
            clips.push({ kind: 'ref', wav: refPathEarly, from: refPathEarly })
          }
        }

        // assemble: seeded source->v-number shuffle (first blinding layer; beat rate shuffles
        // presentation again), then manifest + duration match + loudness normalization
        const order = showdown.assignClipOrder(clips.length, batchSeed)
        const files = new Array(clips.length)
        for (let v = 0; v < clips.length; v++) {
          const clip = clips[order[v]]
          copyFileSync(clip.wav, join(outDir, `v${v + 1}.wav`))
          files[v] = { file: `v${v + 1}.wav`, source: { kind: clip.kind, from: clip.from } }
        }
        rmSync(workDir, { recursive: true }) // never leave a scoreable work batch for beat rate to find
        // figureSource: 'midi' when ANY composed clip drew a midi figure (a partial bank
        // fallback still taints the batch's composition provenance) — gitignore-gates the dir
        // and puts the 'midi'/'bank' label (nothing else) in the scores log via scoreBatch
        showdown.writeShowdownBatch(outDir, spec.role, files, { seed: batchSeed, figureSource: batchUsedMidi ? 'midi' : 'bank' })
        const match = showdown.matchClipDurations(outDir, files.map((f) => f.file), targetSeconds !== undefined ? { targetSeconds } : {})
        process.stdout.write(`${outDir}/: ${files.length} clips (${clips.map((c) => c.kind).sort().join(' vs ')}), duration-matched to ${match.targetSeconds}s`)
        const adjusted = match.clips.filter((c) => c.action !== 'kept')
        process.stdout.write(adjusted.length > 0 ? ` (${adjusted.map((c) => `${c.file} ${c.action} ${c.fromSeconds}s -> ${c.toSeconds}s`).join(', ')})\n` : '\n')
        const norm = normalizeBatchLoudness(outDir, files.length)
        if (norm) process.stdout.write(formatNormalizationResult(norm))
        made += 1
      } catch (err) {
        failed += 1
        process.stderr.write(`warning: showdown ${spec.role} failed — skipping${genBackend === 'fal' ? ' (fal needs FAL_KEY + network; --gen-backend stub builds placeholder audio)' : ''} (${err instanceof Error ? err.message.split('\n')[0] : err})\n`)
        // never leave a half-built batch for beat rate to queue
        try {
          if (existsSync(outDir) && !existsSync(join(outDir, 'manifest.json'))) rmSync(outDir, { recursive: true })
        } catch { /* best-effort cleanup */ }
      }
    }
  }
  process.stdout.write(`\n${made} showdown batch(es)${failed > 0 ? ` (${failed} failed)` : ''} — sources are blind: the manifest is the answer key, don't peek before rating\n`)
  process.stdout.write(`next: beat rate ${dir} — then beat showdown ${dir} --report for the per-source scoreboard\n`)
}

// Production-task eval — production-transform (docs/research/119-production-task-evals.md §T-C,
// docs/prodtask.md): does the research-118 trick catalog move the OWNER'S blind ratings, not just
// the width/air METRICS? Each batch is ONE composed figure in N arms — original (raw engine),
// tricked (a per-role trick stack via the real `beat trick apply` path), and a random-edit control
// (same edit count, random legal params/values) — assembled as an ordinary clip-set batch and
// rated through the unchanged blind `beat rate` flow. A sibling of `beat showdown` that reuses its
// batch machinery wholesale (compose figure, solo, shuffle, duration-match, LUFS-normalize); the
// new source axis is the production ARM, not the source pipeline. Renders are local-engine only
// (no fal), same one-boot offline render as the showdown work batch.
async function prodtaskCmd(argv) {
  const valued = ['--rounds', '--seed', '--arms', '--tricks', '--roles', '--seconds', '--log']
  const known = new Set([...valued, '--report', '--json'])
  for (const a of argv) if (a.startsWith('--') && !known.has(a)) throw new BeatEditError(`unknown flag "${a}" (known: ${[...known].join(', ')})`)
  const positional = argv.filter((a, i) => !a.startsWith('--') && !valued.includes(argv[i - 1]))
  const sub = positional[0]
  const dir = positional[1] ?? (sub && sub !== 'transform' ? sub : undefined)
  const prodtask = await import('../dist/src/taste/prodtask.js')

  // ---- the scoreboard --------------------------------------------------------------------------
  if (argv.includes('--report')) {
    const logPath = flagValue(argv, '--log') ?? (dir ? join(dir, 'beat-scores.jsonl') : null)
    if (!logPath || !existsSync(logPath)) {
      throw new BeatEditError('prodtask --report needs a scored collection: beat prodtask --report <dir> (beat-scores.jsonl at the dir root) or --log <path>')
    }
    const report = prodtask.computeProdtaskReport(logPath)
    process.stdout.write(argv.includes('--json') ? JSON.stringify(report, null, 2) + '\n' : prodtask.formatProdtaskReport(report))
    return
  }
  if (argv.includes('--json')) throw new BeatEditError('--json only applies to prodtask --report')

  // ---- collection: `beat prodtask transform <dir>` ---------------------------------------------
  if (sub !== 'transform') throw new BeatEditError('prodtask needs a task: beat prodtask transform <dir> [--rounds N] [--seed S] [--arms original,tricked,random] [--tricks names] [--roles bassline,chords,lead,drum-loop] (or --report <dir>)')
  if (!dir) throw new BeatEditError('prodtask transform needs the taste-seeds directory: beat prodtask transform <dir>')

  const showdown = await import('../dist/src/taste/showdown.js')
  const { mulberry32 } = await import('../dist/src/taste/eval.js')
  const { writeVaryBatch, renderVaryBatch, normalizeBatchLoudness, formatNormalizationResult } = await import('../dist/src/vary/batch.js')
  const { mkdirSync, copyFileSync } = await import('node:fs')
  const { tricks, macros } = loadTricks()

  const roles = (flagValue(argv, '--roles') ?? prodtask.PRODTASK_ROLES.map((r) => r.role).join(','))
    .split(',')
    .filter(Boolean)
    .map((r) => prodtask.prodtaskRole(r)) // throws with the legal list on a typo
  const rounds = flagValue(argv, '--rounds') ? Number(flagValue(argv, '--rounds')) : 1
  const metaSeed = flagValue(argv, '--seed') ? Number(flagValue(argv, '--seed')) : 61
  const targetSeconds = flagValue(argv, '--seconds') !== undefined ? Number(flagValue(argv, '--seconds')) : undefined
  const trickOverride = flagValue(argv, '--tricks') !== undefined ? flagValue(argv, '--tricks').split(',').filter(Boolean) : undefined
  const ARM_ORDER = ['original', 'tricked', 'random']
  const requestedArms = (flagValue(argv, '--arms') ?? ARM_ORDER.join(',')).split(',').filter(Boolean)
  for (const a of requestedArms) if (!ARM_ORDER.includes(a)) throw new BeatEditError(`unknown arm "${a}" (have: ${ARM_ORDER.join(', ')})`)
  if (!requestedArms.includes('original')) throw new BeatEditError('the "original" arm is the baseline every prodtask batch is rated against — it cannot be dropped')
  const arms = ARM_ORDER.filter((a) => requestedArms.includes(a))
  if (arms.length < 2) throw new BeatEditError('a prodtask batch needs at least two arms (e.g. --arms original,tricked)')

  const seedFiles = readdirSync(dir).filter((f) => f.startsWith('seed-') && f.endsWith('.beat')).sort()
  if (seedFiles.length === 0) throw new BeatEditError(`no seed-*.beat files in ${dir} — run beat taste-seeds ${dir} first`)
  const seeds = seedFiles.map((f) => ({ file: f, doc: parse(readFileSync(join(dir, f), 'utf8')) }))

  const rng = mulberry32(metaSeed)
  let made = 0
  let failed = 0
  // per-role archetypes already composed this session — threaded into the composer's exclude list
  // so consecutive batches of one run never share a figure (the showdown's un-blinding guarantee)
  const usedFigures = new Map()
  for (let round = 0; round < rounds; round++) {
    for (const spec of roles) {
      const batchSeed = Math.floor(rng() * 100000)
      const candidates = seeds.filter((s) => s.doc.tracks.some((t) => t.id === spec.seedTrack))
      if (candidates.length === 0) {
        failed += 1
        process.stderr.write(`warning: no seed song has a "${spec.seedTrack}" track for role ${spec.role} — skipping (generate more seeds: beat taste-seeds ${dir})\n`)
        continue
      }
      const seed = candidates[Math.floor(rng() * candidates.length)]
      const seedPath = join(dir, seed.file)
      const outDir = join(dir, `prodtask-transform-${spec.role}-${batchSeed}`)
      const workDir = join(outDir, 'work')
      process.stderr.write(`\n=== prodtask transform ${spec.role}: composed figure in ${seed.file}'s key — ${arms.join(' vs ')} (seed ${batchSeed}) ===\n`)
      try {
        mkdirSync(workDir, { recursive: true })

        // compose ONE figure (the archetype bank, exclude-chained so recognition can't un-blind),
        // apply it, extend to 4 bars, solo the role track — the ORIGINAL arm's document. Every arm
        // shares this figure and patch to the note: the only thing that varies is production.
        const exclude = usedFigures.get(spec.role) ?? []
        let composed
        let phrased
        if (spec.role === 'drum-loop') {
          composed = showdown.composeDrumPhrase(batchSeed, { exclude })
          phrased = showdown.applyComposedDrums(showdown.extendToFourBars(seed.doc), spec.seedTrack, composed)
        } else {
          const key = showdown.inferSeedKey(seed.doc)
          composed = showdown.composePitchedPhrase(spec.role, key, batchSeed, { exclude })
          phrased = showdown.applyComposedPhrase(showdown.extendToFourBars(seed.doc), spec.seedTrack, composed)
        }
        usedFigures.set(spec.role, [...exclude, composed.archetype])
        const originalDoc = showdown.soloForShowdown(phrased, spec.seedTrack)
        process.stderr.write(`composed figure: ${composed.archetype} (batch seed ${batchSeed})\n`)

        // tricked arm: the per-role stack via the real applyTrick path. Always computed (even when
        // the tricked arm itself isn't requested) because the random control matches its edit count.
        const stack = prodtask.resolveTrickStack(spec.role, tricks, trickOverride)
        const trickedRes = prodtask.applyTrickStack(originalDoc, spec.seedTrack, stack, macros)
        for (const w of trickedRes.warnings) process.stderr.write(`  trick precondition: ${w}\n`)
        process.stderr.write(`trick stack [${trickedRes.tricks.join(', ')}]: ${trickedRes.editCount} edit(s)\n`)

        // random-edit control: the same edit count, random legal params/values (seeded, distinct
        // from the batch seed so it doesn't track the figure)
        const randomRes = prodtask.randomEditControl(originalDoc, spec.seedTrack, trickedRes.editCount, batchSeed + 31)
        process.stderr.write(`random-edit control: ${randomRes.edits.join(', ')}\n`)

        // build the requested arms in fixed order, then render them all in ONE batch boot (offline;
        // raw levels — the whole batch is loudness-normalized together below so tricks win on
        // width/air/glue, never on level)
        const armSpec = {
          original: { doc: originalDoc, from: `composed ${composed.archetype} on ${seed.file} ${spec.seedTrack} solo (4 bars, dotbeat engine, raw)` },
          tricked: { doc: trickedRes.doc, from: `same figure + trick stack [${trickedRes.tricks.join(', ')}]: ${trickedRes.applied.join('; ')}`, tricks: trickedRes.tricks, edits: trickedRes.applied },
          random: { doc: randomRes.doc, from: `same figure + random-edit control (${randomRes.edits.length} edits): ${randomRes.edits.join('; ')}`, edits: randomRes.edits },
        }
        const built = arms.map((kind) => ({ kind, ...armSpec[kind] }))
        const workVariants = built.map((b) => ({ doc: b.doc, recipe: `prodtask ${spec.role} ${b.kind}` }))
        writeVaryBatch({
          parentPath: seedPath,
          parentText: readFileSync(seedPath, 'utf8'),
          track: spec.seedTrack,
          group: 'prodtask-work',
          count: workVariants.length,
          seed: batchSeed,
          outDir: workDir,
          variants: workVariants,
        })
        renderVaryBatch(workDir, workVariants.length, { normalize: false })

        // assemble: seeded arm->v-number shuffle (first blinding layer; beat rate shuffles again),
        // then manifest + duration match + loudness normalization
        const clips = built.map((b, i) => ({
          kind: b.kind,
          wav: join(workDir, `v${i + 1}.wav`),
          source: { kind: b.kind, from: b.from, ...(b.tricks ? { tricks: b.tricks } : {}), ...(b.edits ? { edits: b.edits } : {}) },
        }))
        const order = showdown.assignClipOrder(clips.length, batchSeed)
        const files = new Array(clips.length)
        for (let v = 0; v < clips.length; v++) {
          const clip = clips[order[v]]
          copyFileSync(clip.wav, join(outDir, `v${v + 1}.wav`))
          files[v] = { file: `v${v + 1}.wav`, source: clip.source }
        }
        rmSync(workDir, { recursive: true }) // never leave a scoreable work batch for beat rate to find
        prodtask.writeProdtaskBatch(outDir, spec.role, files, { seed: batchSeed, task: 'transform' })
        const match = showdown.matchClipDurations(outDir, files.map((f) => f.file), targetSeconds !== undefined ? { targetSeconds } : {})
        process.stdout.write(`${outDir}/: ${files.length} arms (${built.map((b) => b.kind).sort().join(' vs ')}), duration-matched to ${match.targetSeconds}s\n`)
        const norm = normalizeBatchLoudness(outDir, files.length)
        if (norm) process.stdout.write(formatNormalizationResult(norm))
        made += 1
      } catch (err) {
        failed += 1
        process.stderr.write(`warning: prodtask transform ${spec.role} failed — skipping (${err instanceof Error ? err.message.split('\n')[0] : err})\n`)
        try {
          if (existsSync(outDir) && !existsSync(join(outDir, 'manifest.json'))) rmSync(outDir, { recursive: true })
        } catch { /* best-effort cleanup */ }
      }
    }
  }
  process.stdout.write(`\n${made} prodtask batch(es)${failed > 0 ? ` (${failed} failed)` : ''} — arms are blind: the manifest is the answer key, don't peek before rating\n`)
  process.stdout.write(`next: beat rate ${dir} — then beat prodtask --report ${dir} for the per-arm scoreboard\n`)
}

// The constrained T5 overnight pilot (plan item C3, docs/pilot.md, docs/research/117): the owner's
// "circular process" — make variations -> the pessimistic critic scores them -> the best breed the
// next round -> repeat a handful of generations -> ship a blind morning frontier of critic-guided
// ELITES plus random-mutation CONTROLS. Deliberately small (best-of-n-per-niche, ensemble pessimism,
// gen subspace fenced, width fence, control gate). Pure logic in src/taste/pilot.ts; this owns the
// offline renders and the aes/critic calls, reusing the prodtask/showdown assembly conventions.
async function pilotCmd(argv) {
  const valued = ['--budget', '--generations', '--niches', '--roles', '--seed', '--controls', '--epsilon', '--amount', '--log', '--aes-backend']
  const known = new Set([...valued, '--report', '--json'])
  for (const a of argv) if (a.startsWith('--') && !known.has(a)) throw new BeatEditError(`unknown flag "${a}" (known: ${[...known].join(', ')})`)
  const positional = argv.filter((a, i) => !a.startsWith('--') && !valued.includes(argv[i - 1]))
  const sub = positional[0]
  const dir = positional[1] ?? (sub && sub !== 'run' ? sub : undefined)
  const pilot = await import('../dist/src/taste/pilot.js')

  // ---- the scoreboard (`beat pilot --report`) --------------------------------------------------
  if (argv.includes('--report')) {
    const logPath = flagValue(argv, '--log') ?? (dir ? join(dir, 'beat-scores.jsonl') : null)
    if (!logPath || !existsSync(logPath)) {
      throw new BeatEditError('pilot --report needs a scored collection: beat pilot --report <dir> (beat-scores.jsonl at the dir root) or --log <path>')
    }
    const report = pilot.computePilotReport(logPath)
    process.stdout.write(argv.includes('--json') ? JSON.stringify(report, null, 2) + '\n' : pilot.formatPilotReport(report))
    return
  }
  if (argv.includes('--json')) throw new BeatEditError('--json only applies to pilot --report')

  // ---- the run (`beat pilot run <dir>`) --------------------------------------------------------
  if (sub !== 'run') throw new BeatEditError('pilot needs a subcommand: beat pilot run <dir> [--budget 80] [--generations 6] [--niches 4] [--roles bassline,chords] [--seed N] [--controls 3]  (or --report <dir>)')
  if (!dir) throw new BeatEditError('pilot run needs the taste-seeds directory: beat pilot run <dir>')

  const { criticWithUncertainty } = await import('../dist/src/taste/eval.js')
  const { embedAudioFile } = await import('../dist/src/taste/embeddings.js')
  const { computeBatchFeatures } = await import('../dist/src/taste/features.js')
  const { writeVaryBatch, renderVaryBatch, normalizeBatchLoudness, formatNormalizationResult } = await import('../dist/src/vary/batch.js')
  const showdown = await import('../dist/src/taste/showdown.js')
  const { copyFileSync } = await import('node:fs')

  const num = (flag, def) => (flagValue(argv, flag) !== undefined ? Number(flagValue(argv, flag)) : def)
  const budget = num('--budget', 80)
  const generations = num('--generations', 6)
  const niches = num('--niches', 4)
  const controls = num('--controls', 3)
  const seed = num('--seed', 71)
  const epsilon = flagValue(argv, '--epsilon') !== undefined ? Number(flagValue(argv, '--epsilon')) : undefined
  const amount = flagValue(argv, '--amount') !== undefined ? Number(flagValue(argv, '--amount')) : undefined
  const aesBackend = flagValue(argv, '--aes-backend') ?? 'aes'
  const logPath = flagValue(argv, '--log') ?? join(dir, 'beat-scores.jsonl')
  const roles = (flagValue(argv, '--roles') ?? pilot.DEFAULT_PILOT_ROLES.join(','))
    .split(',')
    .filter(Boolean)
    .map((r) => pilot.pilotRole(r).role) // throws with the legal list on a typo

  const seedFiles = readdirSync(dir).filter((f) => f.startsWith('seed-') && f.endsWith('.beat')).sort()
  if (seedFiles.length === 0) throw new BeatEditError(`no seed-*.beat files in ${dir} — run beat taste-seeds ${dir} first`)
  const seeds = seedFiles.map((f) => ({ file: f, doc: parse(readFileSync(join(dir, f), 'utf8')) }))
  const seedPathFor = (f) => join(dir, f)
  if (!existsSync(logPath)) {
    throw new BeatEditError(`no scores log at ${logPath} — the pilot critic trains on your rated batches; rate some first (beat rate ${dir}) or point --log at your log`)
  }

  process.stderr.write(`\n=== pilot run: budget ${budget} renders, ${generations} generations, ${niches} niches, roles [${roles.join(', ')}], seed ${seed} ===\n`)
  process.stderr.write(`training the pessimistic critic on ${logPath} (aes backend ${aesBackend})...\n`)
  const critic = await criticWithUncertainty(logPath, { aesBackend, beta: pilot.PILOT_BETA })
  process.stderr.write(`critic: bootstrap ensemble over ${critic.trainedPairs} pairs from ${critic.trainedBatches} dsp+aes batch(es) (β=${critic.beta})\n`)
  if (critic.trainedPairs === 0) {
    throw new BeatEditError('the critic trained on 0 pairs — no dsp+aes-scored batches in the log (is the aes sidecar available? point BEAT_PYTHON at the venv, or --aes-backend aes-stub for a dry wiring run)')
  }

  const budgetPerRole = Math.max(niches, Math.floor(budget / roles.length))
  const workRoot = join(dir, `pilot-work-${seed}`)
  let workCounter = 0

  // the injected slow step: render a whole generation offline in ONE engine boot, extract dsp + aes.
  // The width fence is NOT applied here — the loop applies it to the dsp before calling `score`; the
  // features stored here are the honest measured ones (the journal/selection see real widths).
  const makeEvaluate = (role) => async (genomes) => {
    const out = new Map()
    if (genomes.length === 0) return out
    const workDir = join(workRoot, `${role}-${workCounter++}`)
    mkdirSync(workDir, { recursive: true })
    // SOLO the mutated track (owner, 2026-07-22, first frontier audit: param changes on a track
    // buried in the mix are near-inaudible — the same finding that made every param-vary batch
    // solo its target back on 07-18; the pilot renders what the owner will actually judge)
    const variants = genomes.map((g) => ({ doc: showdown.soloForShowdown(g.doc, g.trackId), recipe: g.id }))
    writeVaryBatch({
      parentPath: seedPathFor(genomes[0].seedFile),
      parentText: readFileSync(seedPathFor(genomes[0].seedFile), 'utf8'),
      track: genomes[0].trackId,
      group: `pilot-work:${role}`,
      count: variants.length,
      seed,
      outDir: workDir,
      variants,
    })
    renderVaryBatch(workDir, variants.length, { mode: 'offline', normalize: true })
    const dsp = computeBatchFeatures(workDir, genomes.map((_, i) => `v${i + 1}.beat`))
    for (let i = 0; i < genomes.length; i++) {
      const beatFile = `v${i + 1}.beat`
      const wav = join(workDir, `v${i + 1}.wav`)
      const d = dsp[beatFile]
      if (!d || !existsSync(wav)) continue
      let aes
      try {
        aes = (await embedAudioFile(wav, { backend: aesBackend })).embedding
      } catch (err) {
        throw new BeatEditError(`aes sidecar failed on a pilot render (${err instanceof Error ? err.message.split('\n')[0] : err}) — set BEAT_PYTHON to the venv python, or --aes-backend aes-stub for a dry run`)
      }
      out.set(genomes[i].id, { dsp: d, aes })
    }
    rmSync(workDir, { recursive: true, force: true }) // never leave a scoreable work batch for beat rate
    return out
  }

  const score = (candidates) => critic.scorePopulation(candidates)

  const results = []
  for (const role of roles) {
    process.stderr.write(`\n--- role ${role} (budget ${budgetPerRole} renders) ---\n`)
    const result = await pilot.runPilotRole({
      role,
      seeds,
      budget: budgetPerRole,
      generations,
      niches,
      controls,
      ...(epsilon !== undefined ? { epsilon } : {}),
      ...(amount !== undefined ? { amount } : {}),
      seed,
      evaluate: makeEvaluate(role),
      score,
    })
    process.stderr.write(`  ${result.rendersSpent} renders, ${result.archive.length} elite(s) across ${new Set(result.archive.map((e) => e.niche)).size} niche(s), ${result.controls.length} control(s)\n`)
    results.push(result)
  }

  // assemble the blind morning frontier per role, ONE BATCH PER SEED LINEAGE (owner, 2026-07-22,
  // first frontier audit: a batch mixing lineages lets "nicer host song" masquerade as "better
  // optimization" — a true comparison holds the seed/figure constant and varies only the mutated
  // params). Each lineage batch = that seed's elites + their matched controls, freshly rendered in
  // one boot, seeded arm->v-number shuffle, duration-matched, loudness-normalized. Lineages that
  // lack an elite or a control are warn-skipped: without both, the batch can't feed the scaling
  // gate. group pilot:<role>; per-variant source records elite-vs-control honestly.
  let batchesLanded = 0
  for (const result of results) {
    const elitesAll = result.archive.slice(0, 8)
    const bySeed = new Map()
    for (const e of elitesAll) {
      const g = bySeed.get(e.genome.seedFile) ?? { elites: [], controls: [] }
      g.elites.push(e)
      bySeed.set(e.genome.seedFile, g)
    }
    for (const c of result.controls) {
      const g = bySeed.get(c.seedFile) ?? { elites: [], controls: [] }
      g.controls.push(c)
      bySeed.set(c.seedFile, g)
    }
    let lineageIdx = 0
    for (const [seedFile, g] of bySeed) {
      if (g.elites.length === 0 || g.controls.length === 0) {
        process.stderr.write(`note: ${result.role} lineage ${seedFile} has ${g.elites.length} elite(s)/${g.controls.length} control(s) — skipped (the gate needs both)\n`)
        continue
      }
      lineageIdx++
      const outDir = join(dir, `pilot-${result.role}-${seed}-l${lineageIdx}`)
      try {
      // trajectory arms (owner, 2026-07-22): the lineage's BEST elite also contributes its seed
      // original and ~1/3 / ~2/3 mutation-depth checkpoints, so the blind ranking tests whether
      // preference actually climbs along the optimization path — not just final-vs-control.
      const best = [...g.elites].sort((a, b) => b.score.pessimistic - a.score.pessimistic)[0]
      const seedDoc = parse(readFileSync(seedPathFor(best.genome.seedFile), 'utf8'))
      const trajectory = [
        { kind: 'origin', doc: seedDoc, from: `the untouched seed (${best.genome.seedFile}) — optimization step 0`, seedFile: best.genome.seedFile },
        ...pilot.checkpointSteps(best.genome.editSteps.length).map((steps) => ({
          kind: 'checkpoint',
          doc: pilot.reconstructCheckpoint(seedDoc, best.genome, steps),
          from: `optimization checkpoint: step ${steps} of ${best.genome.editSteps.length} on the best elite's lineage (${best.genome.seedFile})`,
          seedFile: best.genome.seedFile,
        })),
      ]
      const items = [
        ...trajectory,
        ...g.elites.map((e) => ({ kind: 'elite', doc: e.genome.doc, from: `niche ${pilot.nicheLabel(result.grid, e.niche)}, ${e.genome.editSteps.length} optimization steps from ${e.genome.seedFile} (pessimistic ${e.score.pessimistic})`, seedFile: e.genome.seedFile })),
        ...g.controls.map((c) => ({ kind: 'control', doc: c.doc, from: `random-mutation control descended from elite ${c.parentId} (${c.seedFile})`, seedFile: c.seedFile })),
      ]
      if (items.length < 2) {
        process.stderr.write(`warning: ${result.role} lineage ${seedFile} produced <2 frontier items — skipping\n`)
        continue
      }
      const workDir = join(outDir, 'work')
      mkdirSync(workDir, { recursive: true })
      // frontier clips solo the mutated track too — the audit must hear what the search optimized
      const variants = items.map((it, i) => ({ doc: showdown.soloForShowdown(it.doc, result.spec.seedTrack), recipe: `pilot ${result.role} ${it.kind} ${i + 1}` }))
      writeVaryBatch({
        parentPath: seedPathFor(items[0].seedFile),
        parentText: readFileSync(seedPathFor(items[0].seedFile), 'utf8'),
        track: result.spec.seedTrack,
        group: `pilot-frontier-work:${result.role}`,
        count: variants.length,
        seed,
        outDir: workDir,
        variants,
      })
      renderVaryBatch(workDir, variants.length, { mode: 'offline', normalize: false })
      const order = showdown.assignClipOrder(items.length, seed)
      const files = new Array(items.length)
      for (let v = 0; v < items.length; v++) {
        const it = items[order[v]]
        copyFileSync(join(workDir, `v${order[v] + 1}.wav`), join(outDir, `v${v + 1}.wav`))
        files[v] = { file: `v${v + 1}.wav`, source: { kind: it.kind, from: it.from } }
      }
      rmSync(workDir, { recursive: true, force: true })
      pilot.writePilotBatch(outDir, result.role, files, { seed })
      const match = showdown.matchClipDurations(outDir, files.map((f) => f.file))
      process.stdout.write(`${outDir}/: ${files.length} clips (${g.elites.length} elite vs ${g.controls.length} control + trajectory arms), duration-matched to ${match.targetSeconds}s\n`)
      const norm = normalizeBatchLoudness(outDir, files.length)
      if (norm) process.stdout.write(formatNormalizationResult(norm))
      batchesLanded += 1
      } catch (err) {
        process.stderr.write(`warning: frontier assembly for ${result.role} lineage ${seedFile} failed — ${err instanceof Error ? err.message.split('\n')[0] : err}\n`)
        try {
          if (existsSync(outDir) && !existsSync(join(outDir, 'manifest.json'))) rmSync(outDir, { recursive: true, force: true })
        } catch { /* best-effort */ }
      }
    }
  }
  rmSync(workRoot, { recursive: true, force: true })

  const journalPath = join(dir, `pilot-journal-${seed}.jsonl`)
  pilot.writePilotJournal(journalPath, results)
  process.stdout.write(pilot.formatPilotRunSummary(results, { batchesLanded, journalPath, beta: critic.beta }))
}

async function varyCmd(argv) {
  const { VARY_GROUPS, LEGACY_DRUM_VOICE_GROUPS, laneVaryDefs, varyTrack, BeatVaryError } = await import('../dist/src/vary/vary.js')
  const valued = ['--count', '--amount', '--seed', '--out-dir', '--timing', '--velocity', '--push-late', '--swing', '--lanes', '--ids', '--scope', '--port', '--clip', '--points', '--bars', '--exclude']
  // Pilot 111 (MEDIUM): vary accepted ANY unknown flag silently — the pilot-109 fix landed on
  // render only. Same loud error, covering the feel/automation sub-commands too (they share this
  // argv). --live/--offline are the render-mode passthrough (see varyRenderMode below).
  const knownBool = ['--groups', '--render', '--audition', '--no-shuffle', '--no-normalize', '--live', '--offline', '--spread']
  const knownVary = new Set([...valued, ...knownBool])
  for (const a of argv) {
    if (a.startsWith('--') && !knownVary.has(a)) throw new BeatEditError(`unknown flag "${a}" (known: ${[...knownVary].join(', ')})`)
  }
  if (argv.includes('--live') && argv.includes('--offline')) throw new BeatEditError('--live and --offline are mutually exclusive')
  const positional = argv.filter((a, i) => !a.startsWith('--') && !valued.includes(argv[i - 1]))
  if (argv.includes('--groups') || argv.length === 0) {
    // Track-aware when a file+track are given (Phase 35 Stream OA): a declared-lane drums
    // track's REAL targets are its own lanes, and the legacy kick/snare/hats groups are dead
    // there — the static list below can't know that, so it documents both modes instead.
    const [file, track] = positional
    if (file && track) {
      const doc = parse(readFileSync(file, 'utf8'))
      const t = doc.tracks.find((x) => x.id === track)
      if (!t) throw new BeatEditError(`no track "${track}" (have: ${doc.tracks.map((x) => x.id).join(', ')})`)
      if (t.kind === 'drums' && t.lanes.length > 0) {
        process.stdout.write(`declared-lane drums track "${track}" — vary targets its LANES (each lane's own backing params):\n`)
        for (const lane of t.lanes) {
          const defs = laneVaryDefs(lane)
          process.stdout.write(`${lane.name.padEnd(10)} ${defs ? defs.map((d) => d.key).join(', ') : '(sf-backed — program/note are identity, nothing to vary)'}\n`)
        }
        process.stdout.write(`track-wide groups (the drum bus — still real here):\n`)
        for (const [name, defs] of Object.entries(VARY_GROUPS)) {
          if (LEGACY_DRUM_VOICE_GROUPS.has(name)) continue
          if (!['filter', 'env', 'filterenv', 'fx', 'sends', 'mix'].includes(name)) continue
          process.stdout.write(`${name.padEnd(10)} ${defs.map((d) => d.key).join(', ')}\n`)
        }
        process.stdout.write(`(legacy groups ${[...LEGACY_DRUM_VOICE_GROUPS].join('/')} error on this track: they mutate track-wide params the engine never plays once lanes are declared)\n`)
      } else {
        const { legalGroupsForKind } = await import('../dist/src/vary/vary.js')
        const legal = legalGroupsForKind(t.kind)
        process.stdout.write(`${t.kind} track "${track}" — legal vary groups:\n`)
        for (const name of legal) process.stdout.write(`${name.padEnd(10)} ${VARY_GROUPS[name].map((d) => d.key).join(', ')}\n`)
      }
      process.stdout.write(`feel       content variation (humanized timing/velocity) — any track\n`)
      return
    }
    for (const [name, defs] of Object.entries(VARY_GROUPS)) {
      process.stdout.write(`${name.padEnd(10)} ${defs.map((d) => d.key).join(', ')}\n`)
    }
    process.stdout.write(`feel       humanized timing/velocity content variation (see beat vary <file> <track> feel)\n`)
    process.stdout.write(`automation:<param>  movement/shape variants of a clip's automation lane, e.g. automation:cutoff (--clip id targets a specific clip; default the track's first; see beat automate-shape)\n`)
    process.stdout.write(`(kick/snare/hats apply to LEGACY drums tracks only — on a declared-lane drums track, target a lane NAME instead; run beat vary <file> <track> --groups for that track's real targets)\n`)
    return
  }
  const [file, track, group] = positional
  if (!file || !track || !group) throw new BeatEditError('vary needs <file> <track> <group> (see beat vary --groups; "feel" batches humanized variants)')

  // "feel" is content variation (rung 2): batch humanized variants for auditioning + scoring.
  if (group === 'feel') {
    await varyFeelCmd(argv, file, track)
    return
  }
  // === Phase 37 Stream RC begin === automation:<param> — batch movement variants of a clip lane.
  if (group.startsWith('automation:')) {
    await varyAutomationCmd(argv, file, track, group.slice('automation:'.length))
    return
  }
  // === Phase 37 Stream RC end ===
  if (flagValue(argv, '--scope') !== undefined) {
    // Param-group variants (rung 1) mutate whole-track synth params — there's no per-note/lane
    // concept to scope by, so --scope selection only makes sense for "feel" (rung 2).
    throw new BeatEditError('vary --scope selection only applies to "feel" (param/lane targets mutate synth or lane params, not per-note/hit content)')
  }
  const count = flagValue(argv, '--count') ? Number(flagValue(argv, '--count')) : 9
  const amount = flagValue(argv, '--amount') ? Number(flagValue(argv, '--amount')) : 0.25
  // --spread: exploration mode — stratified sampling across each param's FULL musical range
  // instead of jittering around the parent's value. For preference-data collection (taste-collect),
  // where local mutation around a range-edge value yields near-identical variants (owner, 2026-07-17).
  const spread = argv.includes('--spread')
  const seed = flagValue(argv, '--seed') ? Number(flagValue(argv, '--seed')) : (Date.now() % 2147483647)
  // Default out-dir sits NEXT TO the .beat file, not under the process cwd (Phase 35 OC,
  // pilot 101 medium 4) — an explicit --out-dir still resolves exactly as written.
  const { defaultBatchDir } = await import('../dist/src/vary/batch.js')
  const outDir = flagValue(argv, '--out-dir') ?? defaultBatchDir(file, group, seed)

  // --exclude p1,p2: leave the named group params untouched (pilot 113: taste-collect pins mix's
  // volume — normalization would gain-match the renders and cancel the difference being rated).
  const exclude = flagValue(argv, '--exclude') !== undefined ? flagValue(argv, '--exclude').split(',').filter(Boolean) : undefined

  const text = readFileSync(file, 'utf8')
  const doc = parse(text)
  let variants
  try {
    variants = varyTrack(doc, track, group, { count, amount, seed, spread, ...(exclude !== undefined ? { exclude } : {}) })
  } catch (err) {
    if (err instanceof BeatVaryError) throw new BeatEditError(err.message)
    throw err
  }

  // Manifest write + render shaping live in src/vary/batch.ts, shared with beat_vary over MCP
  // (Phase 34 Stream NA) — the manifest shape is the contract `beat score`/`beat_score` read.
  const { writeVaryBatch, renderVaryBatch, formatNormalizationResult } = await import('../dist/src/vary/batch.js')
  const manifest = writeVaryBatch({ parentPath: file, parentText: text, track, group, count, amount, seed, outDir, variants })
  process.stdout.write(`${outDir}/: ${variants.length} variants of ${track}.${group} (amount ${amount}, seed ${seed})\n`)
  for (let i = 0; i < variants.length; i++) {
    process.stdout.write(`  v${i + 1}: ${manifest.variants[i].edits.join(', ')}\n`)
  }

  if (argv.includes('--render') || argv.includes('--audition')) {
    // Pilot 113 (MEDIUM-HIGH): a batch that varies `volume` while loudness normalization is on
    // rates level-matched audio — the rater never hears the very difference the batch mutates,
    // yet adopting the winner writes that volume into a project nothing normalizes. Say so.
    if (!argv.includes('--no-normalize') && variants.some((v) => v.edits.some((e) => e.path.endsWith('.volume')))) {
      process.stdout.write(`note: this batch varies volume, but loudness normalization will gain-match the renders — the volume differences will be largely inaudible when auditioning (pass --no-normalize to hear them raw)\n`)
    }
    // D15/D23: the one render path is dotbeat's own engine driven headless via render.mjs --batch
    // (one harness boot per batch; offline compute by default, live fallback for soundfont
    // projects — the child prints which). Pilot 111: linkMediaFrom was missing HERE while the
    // feel/automation paths passed it — a group vary of any sample-using project rendered with
    // every media fetch 404ing (silent lanes / thousands of noisy errors).
    const norm = renderVaryBatch(outDir, variants.length, { linkMediaFrom: file, ...varyRenderMode(argv) })
    process.stdout.write(`rendered ${variants.length} wavs into ${outDir}/ — audition, then: beat score ${outDir} <best> [2nd 3rd]\n`)
    if (norm) process.stdout.write(formatNormalizationResult(norm))
    if (argv.includes('--audition')) await auditionAfterRender(outDir, variants.length, { noShuffle: argv.includes('--no-shuffle') })
  }
}

/** The vary --render capture-mode passthrough (pilot 111: --live used to be silently swallowed —
 * the render child never saw it, despite the batch banner advertising it), plus the
 * --no-normalize opt-out of the default post-render loudness normalization. */
function varyRenderMode(argv) {
  return {
    ...(argv.includes('--live') ? { mode: 'live' } : argv.includes('--offline') ? { mode: 'offline' } : {}),
    ...(argv.includes('--no-normalize') ? { normalize: false } : {}),
  }
}

/** `--audition` (Phase 35 OC): stitch the just-rendered vN.wavs into one contact-sheet
 * audition.wav with a printed timecode index (+ audition.json) — shared by both vary rungs.
 * T0 taste-loop: presentation order is SHUFFLED by default (seeded from the batch dir's own
 * manifest seed, so re-stitching the same batch reproduces the same order) — v1..vN are
 * seed-monotone, and unshuffled listening bakes position bias into every pick. The printed index
 * is the answer key; `--no-shuffle` restores generation order. */
async function auditionAfterRender(outDir, count, opts = {}) {
  const { stitchAudition, formatAuditionIndex } = await import('../dist/src/vary/audition.js')
  const { BeatBatchError, readBatchManifest } = await import('../dist/src/vary/batch.js')
  try {
    let shuffleSeed
    if (opts.noShuffle !== true) {
      try {
        shuffleSeed = readBatchManifest(outDir).seed
      } catch {
        shuffleSeed = 41 // no manifest (arbitrary clip set) — any fixed seed keeps it reproducible
      }
    }
    process.stdout.write(formatAuditionIndex(stitchAudition(outDir, count, { shuffleSeed })))
  } catch (err) {
    if (err instanceof BeatBatchError) throw new BeatEditError(err.message)
    throw err
  }
}

/**
 * `--scope selection` glue: fetch the live selection off a running daemon and resolve it against
 * `doc`/`track` into the same {lanes|ids} shape `--lanes`/`--ids` accept by hand. Kept separate
 * from varyFeelCmd's flag parsing so the only untestable-without-a-daemon part is this one fetch
 * — the actual resolution (selectionToVaryScope) is a pure function tested without any daemon.
 */
async function fetchSelectionScope(port, doc, track) {
  const base = `http://127.0.0.1:${Number(port)}`
  const res = await fetch(`${base}/selection`)
  if (!res.ok) {
    const msg = await res.json().then((b) => b.error).catch(() => res.statusText)
    throw new BeatEditError(`could not read selection from daemon on port ${port}: ${msg}`)
  }
  const sel = await res.json()
  try {
    return selectionToVaryScope(sel, doc, track)
  } catch (err) {
    if (err instanceof BeatSelectionError) throw new BeatEditError(err.message)
    throw err
  }
}

async function varyFeelCmd(argv, file, track) {
  const { varyFeel, BeatVaryError } = await import('../dist/src/vary/vary.js')
  const count = flagValue(argv, '--count') ? Number(flagValue(argv, '--count')) : 9
  const seed = flagValue(argv, '--seed') ? Number(flagValue(argv, '--seed')) : (Date.now() % 2147483647)
  // Same next-to-the-.beat out-dir default as the param rung above (Phase 35 OC).
  const { defaultBatchDir } = await import('../dist/src/vary/batch.js')
  const outDir = flagValue(argv, '--out-dir') ?? defaultBatchDir(file, 'feel', seed)
  const scope = flagValue(argv, '--scope')
  if (scope !== undefined && scope !== 'selection') throw new BeatEditError(`vary --scope only supports "selection", got "${scope}"`)
  if (scope === 'selection' && (flagValue(argv, '--lanes') !== undefined || flagValue(argv, '--ids') !== undefined)) {
    throw new BeatEditError('vary --scope selection cannot be combined with --lanes/--ids — pick one way to scope')
  }
  const opts = {
    count,
    seed,
    // --spread: groove-archetype batches (tight/light-swing/heavy-swing/laid-back/loose) — the
    // owner flagged every fixed-knob feel batch as "all very similar" (2026-07-17/18).
    ...(argv.includes('--spread') ? { spread: true } : {}),
    ...(flagValue(argv, '--timing') !== undefined ? { timing: Number(flagValue(argv, '--timing')) } : {}),
    ...(flagValue(argv, '--velocity') !== undefined ? { velocity: Number(flagValue(argv, '--velocity')) } : {}),
    ...(flagValue(argv, '--push-late') !== undefined ? { pushLate: Number(flagValue(argv, '--push-late')) } : {}),
    ...(flagValue(argv, '--swing') !== undefined ? { swing: Number(flagValue(argv, '--swing')) } : {}),
    ...(scope !== 'selection' && flagValue(argv, '--lanes') !== undefined ? { lanes: flagValue(argv, '--lanes').split(',').filter(Boolean) } : {}),
    ...(scope !== 'selection' && flagValue(argv, '--ids') !== undefined ? { ids: flagValue(argv, '--ids').split(',').filter(Boolean) } : {}),
  }
  const text = readFileSync(file, 'utf8')
  const doc = parse(text)

  if (scope === 'selection') {
    const portIdx = argv.indexOf('--port')
    if (portIdx === -1 || argv[portIdx + 1] === undefined) {
      throw new BeatEditError('vary --scope selection needs --port <port> (the running daemon — same convention as `beat selection`)')
    }
    const resolved = await fetchSelectionScope(argv[portIdx + 1], doc, track)
    Object.assign(opts, resolved)
    process.stdout.write(
      resolved.lanes
        ? `scope: selection -> lanes ${resolved.lanes.join(', ')}\n`
        : resolved.ids
          ? `scope: selection -> ${resolved.ids.length} id(s): ${resolved.ids.join(', ')}\n`
          : 'scope: selection -> whole track (selection had nothing narrowing it)\n',
    )
  }

  let variants
  try {
    variants = varyFeel(doc, track, opts)
  } catch (err) {
    if (err instanceof BeatVaryError) throw new BeatEditError(err.message)
    throw err
  }
  // Manifest write + render shaping live in src/vary/batch.ts, shared with beat_vary over MCP
  // (Phase 34 Stream NA) — the manifest shape is the contract `beat score`/`beat_score` read.
  const { writeVaryBatch, renderVaryBatch, formatNormalizationResult } = await import('../dist/src/vary/batch.js')
  const manifest = writeVaryBatch({ parentPath: file, parentText: text, track, group: 'feel', count, seed, outDir, variants })
  process.stdout.write(`${outDir}/: ${variants.length} feel variants of ${track} (seed ${seed})\n`)
  for (let i = 0; i < variants.length; i++) process.stdout.write(`  v${i + 1}: ${manifest.variants[i].recipe}\n`)

  if (argv.includes('--render') || argv.includes('--audition')) {
    // D15: render through dotbeat's own engine (cli/render.mjs) — real-time per variant (see the
    // matching note in varyCmd above; a fast batch renderer for the canonical engine is future work).
    // linkMediaFrom: variant .beat files reference media relative to themselves; the parent's
    // media/ dir sits next to the parent, so batch.ts links it into the batch dir before rendering.
    const norm = renderVaryBatch(outDir, variants.length, { linkMediaFrom: file, ...varyRenderMode(argv) })
    process.stdout.write(`rendered ${variants.length} wavs into ${outDir}/ — audition, then: beat score ${outDir} <best> [2nd 3rd]\n`)
    if (norm) process.stdout.write(formatNormalizationResult(norm))
    if (argv.includes('--audition')) await auditionAfterRender(outDir, variants.length, { noShuffle: argv.includes('--no-shuffle') })
  }
}

// === Phase 37 Stream RC begin === automation as a vary target: batch movement variants of a clip
// lane into the same writeVaryBatch -> score -> adopt harness feel already uses. Whole-doc variants
// carrying a replayable automate-shape recipe (not set-edits), so score/adopt work for free.
async function varyAutomationCmd(argv, file, track, param) {
  const { varyAutomation, BeatVaryError } = await import('../dist/src/vary/vary.js')
  if (flagValue(argv, '--scope') !== undefined) {
    throw new BeatEditError('vary --scope selection only applies to "feel" (automation:<param> generates a whole-doc lane, not per-note/hit content)')
  }
  const count = flagValue(argv, '--count') ? Number(flagValue(argv, '--count')) : 9
  const seed = flagValue(argv, '--seed') ? Number(flagValue(argv, '--seed')) : (Date.now() % 2147483647)
  const { defaultBatchDir } = await import('../dist/src/vary/batch.js')
  // Colon-free dir label (a ':' in a path is legal on Linux but ugly/portability-risky); the
  // manifest still records the real group `automation:<param>`.
  const outDir = flagValue(argv, '--out-dir') ?? defaultBatchDir(file, `automation-${param}`, seed)
  const opts = {
    count,
    seed,
    ...(flagValue(argv, '--points') !== undefined ? { points: Number(flagValue(argv, '--points')) } : {}),
    ...(flagValue(argv, '--bars') !== undefined ? { bars: Number(flagValue(argv, '--bars')) } : {}),
    // --clip picks WHICH clip's automation lane to vary; omit for the track's first clip (the prior
    // implicit behavior). Pilot 104: with automation on more than one clip the target was silent
    // and unreachable; this makes it explicit without changing the default. varyAutomation errors
    // cleanly (BeatVaryError) if the named clip isn't on the track.
    ...(flagValue(argv, '--clip') !== undefined ? { clip: flagValue(argv, '--clip') } : {}),
  }
  const text = readFileSync(file, 'utf8')
  const doc = parse(text)
  let variants
  try {
    variants = varyAutomation(doc, track, param, opts)
  } catch (err) {
    if (err instanceof BeatVaryError) throw new BeatEditError(err.message)
    throw err
  }
  const { writeVaryBatch, renderVaryBatch, formatNormalizationResult } = await import('../dist/src/vary/batch.js')
  const manifest = writeVaryBatch({ parentPath: file, parentText: text, track, group: `automation:${param}`, count, seed, outDir, variants })
  process.stdout.write(`${outDir}/: ${variants.length} automation variants of ${track}.${param} (seed ${seed})\n`)
  for (let i = 0; i < variants.length; i++) process.stdout.write(`  v${i + 1}: ${manifest.variants[i].recipe}\n`)

  if (argv.includes('--render') || argv.includes('--audition')) {
    const norm = renderVaryBatch(outDir, variants.length, { linkMediaFrom: file, ...varyRenderMode(argv) })
    process.stdout.write(`rendered ${variants.length} wavs into ${outDir}/ — audition, then: beat score ${outDir} <best> [2nd 3rd]\n`)
    if (norm) process.stdout.write(formatNormalizationResult(norm))
    if (argv.includes('--audition')) await auditionAfterRender(outDir, variants.length, { noShuffle: argv.includes('--no-shuffle') })
  }
}
// === Phase 37 Stream RC end ===

async function scoreCmd(argv) {
  const positional = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--log')
  const [dir, ...picks] = positional
  if (!dir || picks.length === 0) throw new BeatEditError('score needs <batch-dir> and 1-3 ranked picks (variant numbers, best first)')
  // Pick normalization ("N" or "vN", Phase 33 Stream ME), manifest read, jsonl entry shape, and
  // the adopt-hint output all live in src/vary/batch.ts, shared verbatim with beat_score over MCP
  // (Phase 34 Stream NA) — a batch generated on either surface scores on either surface. Without
  // --log the log defaults NEXT TO the batch's parent .beat file (Phase 35 OC), not the cwd.
  const { scoreBatch, formatScoreResult, BeatBatchError } = await import('../dist/src/vary/batch.js')
  const logPath = flagValue(argv, '--log')
  let result
  try {
    result = scoreBatch(dir, picks, logPath)
  } catch (err) {
    if (err instanceof BeatBatchError) throw new BeatEditError(err.message)
    throw err
  }
  process.stdout.write(formatScoreResult(result))
}

// T0 taste-loop (docs/taste-loop-design.md L1): the eval harness every taste-model claim reduces
// to — leave-one-batch-out held-out pick prediction over the scores log, with the built-in
// reference scorers (random = the honesty floor, dsp-bt = the v0 Bradley-Terry ranker over DSP
// features). Entries older than the T0 log enrichment get their features derived lazily from
// batch-dir renders when those still exist; --backfill makes that durable by rewriting the log.
async function tasteEvalCmd(argv) {
  // --doctor: report the embedding sidecar's readiness (interpreter, per-backend deps) and stop.
  if (argv.includes('--doctor')) {
    const { embedDoctor } = await import('../dist/src/taste/embeddings.js')
    process.stdout.write(JSON.stringify(await embedDoctor(), null, 2) + '\n')
    return
  }
  const valued = ['--log', '--seed', '--embed-backend', '--embed-model', '--aes-backend']
  // Pilot 110 (MEDIUM): unknown flags used to be silently ignored (`--by-type` did nothing with
  // exit 0) — same failure class as pilot 109's `--offlin` render finding. Loud error instead.
  const known = new Set([...valued, '--json', '--backfill', '--doctor'])
  for (const a of argv) {
    if (a.startsWith('--') && !known.has(a)) throw new BeatEditError(`unknown flag "${a}" (known: --log, --seed, --json, --backfill, --embed-backend, --embed-model, --aes-backend, --doctor)`)
  }
  const positional = argv.filter((a, i) => !a.startsWith('--') && !valued.includes(argv[i - 1]))
  const [file] = positional
  const explicitLog = flagValue(argv, '--log')
  // Pilot 110 (MEDIUM): this used to demand <file.beat> even WITH --log, while its own error text
  // promised "--log <path>" alone works. The text was right; the check was wrong.
  if (!file && explicitLog === undefined) throw new BeatEditError('taste-eval needs <file.beat> (the log defaults to beat-scores.jsonl next to it) or an explicit --log <path>')
  const { defaultScoresLog } = await import('../dist/src/vary/batch.js')
  const { evaluate, formatEvalReport } = await import('../dist/src/taste/eval.js')
  const embedBackend = flagValue(argv, '--embed-backend') ?? 'clap'
  if (!['stub', 'clap', 'mert', 'off'].includes(embedBackend)) {
    throw new BeatEditError(`--embed-backend must be one of stub|clap|mert|off, got "${embedBackend}"`)
  }
  // Audiobox-Aesthetics axes (research/107 §4.1): 'stub' maps to the sidecar's aes-stub backend
  // (deterministic plumbing-truth axes, no torch) so the whole aes path tests everywhere.
  const aesRaw = flagValue(argv, '--aes-backend') ?? 'aes'
  if (!['aes', 'stub', 'off'].includes(aesRaw)) {
    throw new BeatEditError(`--aes-backend must be one of aes|stub|off, got "${aesRaw}"`)
  }
  const aesBackend = aesRaw === 'stub' ? 'aes-stub' : aesRaw
  const logPath = explicitLog ?? defaultScoresLog(file)
  if (!existsSync(logPath)) throw new BeatEditError(`no scores log at ${logPath} — score some batches first (beat vary ... --render, beat score)`)
  if (argv.includes('--backfill')) {
    // Rewrite entries that lack features but whose batch renders still exist — making the log
    // self-contained before batch dirs get cleaned up. A .bak of the original is kept.
    const lines = readFileSync(logPath, 'utf8').split('\n')
    const { computeBatchFeatures } = await import('../dist/src/taste/features.js')
    let filled = 0
    const rewritten = lines.map((line) => {
      const trimmed = line.trim()
      if (!trimmed) return line
      let entry
      try { entry = JSON.parse(trimmed) } catch { return line }
      if (entry.features !== undefined || typeof entry.batch !== 'string' || !Array.isArray(entry.picks)) return line
      if (!existsSync(entry.batch)) return line
      const files = [...entry.picks.map((p) => p.variant), ...(entry.rejected ?? [])]
      const features = computeBatchFeatures(entry.batch, files)
      if (Object.keys(features).length === 0) return line
      filled += 1
      return JSON.stringify({ ...entry, features })
    })
    writeFileSync(logPath + '.bak', lines.join('\n'))
    writeFileSync(logPath, rewritten.join('\n'))
    process.stdout.write(`backfilled features into ${filled} entr${filled === 1 ? 'y' : 'ies'} of ${logPath} (original kept at ${logPath}.bak)\n`)
  }
  const seed = flagValue(argv, '--seed') ? Number(flagValue(argv, '--seed')) : 41
  const report = await evaluate(logPath, { seed, embedBackend, embedModel: flagValue(argv, '--embed-model'), aesBackend })
  if (argv.includes('--json')) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n')
    return
  }
  process.stdout.write(formatEvalReport(report))
}

// T0 taste-loop: audition an ARBITRARY directory of wavs — the blind chop-rating flow
// (docs/taste-loop-design.md T3) and a re-stitch for existing batches. A dir without a
// manifest.json gets a clip-set manifest written over its wavs (sorted by name -> v1..vN), so
// `beat score` works on it exactly like a vary batch; adopt correctly refuses (no parent).
async function auditionCmd(argv) {
  const valued = ['--group', '--seed']
  const positional = argv.filter((a, i) => !a.startsWith('--') && !valued.includes(argv[i - 1]))
  const [dir] = positional
  if (!dir) throw new BeatEditError('audition needs <dir> (a vary/gen batch dir, or any directory of .wav files)')
  const { readBatchManifest, writeClipSetBatch, BeatBatchError } = await import('../dist/src/vary/batch.js')
  const { stitchAudition, formatAuditionIndex } = await import('../dist/src/vary/audition.js')
  try {
    let manifest
    try {
      manifest = readBatchManifest(dir)
    } catch {
      const files = readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.wav') && f !== 'audition.wav').sort()
      const seed = flagValue(argv, '--seed') ? Number(flagValue(argv, '--seed')) : 41
      manifest = writeClipSetBatch(dir, files, { group: flagValue(argv, '--group'), seed })
      process.stdout.write(`clip-set batch: ${files.length} wavs as v1..v${files.length} (manifest.json written)\n`)
      for (let i = 0; i < files.length; i++) process.stdout.write(`  v${i + 1}: ${files[i]}\n`)
    }
    const shuffleSeed = argv.includes('--no-shuffle') ? undefined : manifest.seed
    const files = manifest.variants.map((v) => (v.file.endsWith('.wav') ? v.file : v.file.replace(/\.beat$/, '.wav')))
    process.stdout.write(formatAuditionIndex(stitchAudition(dir, manifest.variants.length, { shuffleSeed, files })))
    process.stdout.write(`rate it blind, then: beat score ${dir} <best> [2nd 3rd]\n`)
  } catch (err) {
    if (err instanceof BeatBatchError) throw new BeatEditError(err.message)
    throw err
  }
}

// Phase 35 Stream OC (pilot 101 medium 3): adopt a scored winner as a real verb — copies the
// picked variant over the batch's parent .beat, with the sha256 guard in src/vary/batch.ts
// refusing to clobber a parent that has moved on since the batch was generated. Same core
// function as the beat_adopt MCP tool, so the two surfaces cannot drift.
async function adoptCmd(argv) {
  const positional = argv.filter((a) => !a.startsWith('--'))
  const [dir, pick] = positional
  if (!dir || !pick) throw new BeatEditError('adopt needs <batch-dir> <pick> (a variant number from beat score, "2" or "v2" both work)')
  const { adoptVariant, formatAdoptResult, BeatBatchError } = await import('../dist/src/vary/batch.js')
  try {
    process.stdout.write(formatAdoptResult(adoptVariant(dir, pick, { force: argv.includes('--force') })))
  } catch (err) {
    if (err instanceof BeatBatchError) throw new BeatEditError(err.message)
    throw err
  }
}

/** T4 v1 (gate passed 2026-07-18: dsp-bt 32% top-1 vs 20% chance on the owner's 37 batches):
 * `beat suggest --taste <batch-dir>` — ADVISORY pre-rank of an unscored rendered batch by the
 * taste model trained on the whole scores log. Prints a predicted ranking, never adopts, never
 * writes: the rating still comes from the owner's ears (the model just says where to listen
 * first). */
async function tasteSuggestCmd(argv) {
  const valued = ['--log']
  for (const a of argv) if (a.startsWith('--') && !valued.includes(a)) throw new BeatEditError(`unknown flag "${a}" (known for --taste mode: --log)`)
  const positional = argv.filter((a, i) => !a.startsWith('--') && !valued.includes(argv[i - 1]))
  const dir = positional[0]
  if (!dir) throw new BeatEditError('suggest --taste needs a rendered batch dir: beat suggest --taste <batch-dir> [--log f]')
  const manifestPath = join(dir, 'manifest.json')
  if (!existsSync(manifestPath)) throw new BeatEditError(`${dir} has no manifest.json — point at a vary/gen/clip-set batch dir`)
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const wavs = manifest.variants.map((v) => v.file.replace(/\.beat$/, '.wav'))
  if (!wavs.every((w) => existsSync(join(dir, w)))) throw new BeatEditError(`${dir} is not fully rendered — render it first (beat render --batch ${dir})`)
  const explicitLog = flagValue(argv, '--log')
  const siblingLog = join(dirname(resolve(dir)), 'beat-scores.jsonl')
  const logPath = explicitLog ?? (existsSync(siblingLog) ? siblingLog : null)
  if (logPath === null || !existsSync(logPath)) throw new BeatEditError(`no scores log found next to ${dir} — pass --log <beat-scores.jsonl> (the taste model needs YOUR past ratings to rank with)`)
  const { loadTasteBatches, trainOnBatches } = await import('../dist/src/taste/eval.js')
  const { computeBatchFeatures } = await import('../dist/src/taste/features.js')
  const { standardizeBatch, scoreVector } = await import('../dist/src/taste/ranker.js')
  const { batches } = loadTasteBatches(logPath)
  const training = batches.filter((b) => resolve(b.dir) !== resolve(dir)) // never train on the batch being ranked
  const model = trainOnBatches(training)
  if (model.pairCount === 0) throw new BeatEditError(`the log at ${logPath} has no usable scored batches yet — rate some first (beat rate)`)
  const features = computeBatchFeatures(dir, manifest.variants.map((v) => v.file))
  const files = manifest.variants.map((v) => v.file).filter((f) => features[f] !== undefined)
  if (files.length < 2) throw new BeatEditError(`fewer than 2 variants in ${dir} have derivable features — are the renders present and non-empty?`)
  const standardized = standardizeBatch(files.map((f) => features[f]))
  const ranked = files
    .map((f, i) => ({ file: f.replace(/\.beat$/, ''), score: scoreVector(model, standardized[i]) }))
    .sort((a, b) => b.score - a.score)
  process.stdout.write(`taste pre-rank of ${dir} — ADVISORY (trained on ${training.length} of your rated batches, ${model.pairCount} pairwise comparisons)\n`)
  for (let i = 0; i < ranked.length; i++) {
    process.stdout.write(`  ${i + 1}. ${ranked[i].file}  ${ranked[i].score >= 0 ? '+' : ''}${ranked[i].score.toFixed(2)}\n`)
  }
  process.stdout.write(`listen in that order, but YOUR pick is the data: beat score ${dir} <best> [2nd 3rd]\n`)
  process.stdout.write(`(held-out accuracy for this model class: beat taste-eval --log ${logPath})\n`)
}

/** T4 v2 — next-round composition proposal. Acquisition v1 is COVERAGE-based (the honest
 * simplification: with a linear BT model and this little data, under-sampled splits are where
 * new labels buy the most; posterior-variance acquisition can replace this scoring rule without
 * changing the command's shape). Also proposes one REPEAT PROBE (the self-consistency ceiling
 * from the design doc's distribution) — a copy of a scored batch re-queued under a fresh dir.
 * Advisory: prints commands, runs nothing. */
async function tasteNextCmd(argv) {
  const valued = ['--log']
  for (const a of argv) if (a.startsWith('--') && !valued.includes(a)) throw new BeatEditError(`unknown flag "${a}" (known for --taste-next mode: --log)`)
  const positional = argv.filter((a, i) => !a.startsWith('--') && !valued.includes(argv[i - 1]))
  const root = positional[0]
  const logPath = flagValue(argv, '--log') ?? (root ? join(root, 'beat-scores.jsonl') : null)
  if (!logPath || !existsSync(logPath)) throw new BeatEditError('suggest --taste-next needs a collection dir with beat-scores.jsonl (or --log <path>)')
  const { loadTasteBatches, variantTypeOf } = await import('../dist/src/taste/eval.js')
  const { batches } = loadTasteBatches(logPath)
  if (batches.length === 0) throw new BeatEditError(`no scored batches in ${logPath} yet — rate some first (beat rate)`)
  // coverage by round kind + group, vs the design doc's target mix
  const count = (fn) => batches.filter(fn).length
  const n = batches.length
  const shares = [
    ['synth-param vary', 0.35, count((b) => variantTypeOf(b) === 'vary' && !['feel', 'kick', 'snare', 'hats'].includes(b.group))],
    ['feel', 0.10, count((b) => b.group === 'feel' || b.group.startsWith('feel'))],
    ['drum voices', 0.10, count((b) => ['kick', 'snare', 'hats'].includes(b.group))],
    ['gen realization', 0.15, count((b) => b.group.startsWith('gen:'))],
    ['gen style-contrast', 0.15, count((b) => b.group.startsWith('style:'))],
  ]
  process.stdout.write(`next-round proposal from ${n} scored batch(es) in ${logPath}\n`)
  process.stdout.write(`coverage vs the target mix (docs/taste-loop-design.md):\n`)
  const gaps = shares.map(([name, target, have]) => ({ name, target, have, gap: target - have / n })).sort((a, b) => b.gap - a.gap)
  for (const g of gaps) process.stdout.write(`  ${String(g.name).padEnd(20)} ${g.have}/${n} (${Math.round((100 * g.have) / n)}%, target ${Math.round(g.target * 100)}%)${g.gap > 0.05 ? '  <- under-covered' : ''}\n`)
  const dir = root ?? dirname(resolve(logPath))
  // Pilot 113 (MEDIUM): this used to print the SAME gen command twice (both gen splits mapped to
  // one string), .slice(0, 2) starved equally-under-covered feel/drum-voice splits of any command
  // at all, and the gen proposal skipped its own prerequisite (taste-collect ERRORS without
  // seed-*.beat in the dir — the seeds host the gen batches too, even with --per-seed 0). Now:
  // one concrete command per under-covered split, identical commands merged into one line naming
  // every split they serve, and a seedless dir gets the taste-seeds step prepended so the printed
  // command matches what actually runs.
  let seedFiles = []
  try {
    seedFiles = readdirSync(dir).filter((f) => f.startsWith('seed-') && f.endsWith('.beat')).sort()
  } catch { /* dir unreadable/missing — treated as seedless */ }
  const hostSeed = seedFiles.length > 0 ? join(dir, seedFiles[0]) : null
  const seedsFirst = hostSeed === null ? `beat taste-seeds ${dir} && ` : ''
  // Feel + drum-voice proposals vary the collection's own seeds directly (every generated seed
  // has a legacy-kit `drums` track, so feel and the kick/snare/hats voice groups are real there).
  const cmdFor = (name) => {
    if (name === 'gen realization' || name === 'gen style-contrast') return [`${seedsFirst}beat taste-collect ${dir} --per-seed 0 --gen 4`, 'fal on your machine; --gen-backend stub elsewhere']
    if (name === 'feel' && hostSeed) return [`beat vary ${hostSeed} drums feel --spread --count 5 --render`, 'groove archetypes on a collection seed']
    if (name === 'drum voices' && hostSeed) return [`beat vary ${hostSeed} drums kick --spread --count 5 --render`, 'a drum-voice batch on a collection seed; also: snare, hats']
    return [`${seedsFirst}beat taste-collect ${dir} --per-seed 2 --count 5`, `covered by taste-collect's random track x group pools`]
  }
  process.stdout.write(`proposed next round:\n`)
  const under = gaps.filter((g) => g.gap > 0.05)
  if (under.length === 0) process.stdout.write(`  (no split is under-covered vs the target mix — collect whichever round you enjoy rating)\n`)
  const byCmd = new Map() // command -> { note, splits[] } — merge, never repeat a line
  for (const g of under) {
    const [cmd, note] = cmdFor(g.name)
    if (byCmd.has(cmd)) byCmd.get(cmd).splits.push(g.name)
    else byCmd.set(cmd, { note, splits: [g.name] })
  }
  for (const [cmd, { note, splits }] of byCmd) process.stdout.write(`  ${cmd}   # ${splits.join(' + ')} (${note})\n`)
  // repeat probe: the OLDEST scored batch whose renders still exist — measures self-consistency
  const probe = batches.find((b) => existsSync(b.dir))
  if (probe) {
    process.stdout.write(`repeat probe (self-consistency ceiling — rate it again blind, analysis keys on parent+group+seed):\n`)
    process.stdout.write(`  cp -r ${probe.dir} ${probe.dir}-probe && beat rate ${dir}\n`)
  }
  process.stdout.write(`connectivity anchor: when scoring the new round, re-listen to one past winner alongside it\n`)
  process.stdout.write(`(advisory only — nothing was generated or written)\n`)
}

async function suggestCmd(argv) {
  if (argv.includes('--taste-next')) return tasteNextCmd(argv.filter((a) => a !== '--taste-next'))
  if (argv.includes('--taste')) return tasteSuggestCmd(argv.filter((a) => a !== '--taste'))
  const { suggestNext, parseScoresLog } = await import('../dist/src/vary/suggest.js')
  const valued = ['--target', '--log']
  const positional = argv.filter((a, i) => !a.startsWith('--') && !valued.includes(argv[i - 1]))
  const [file, track] = positional
  if (!file || !track) throw new BeatEditError('suggest needs <file> <track> (see beat vary --groups for group names)')
  // Same track-existence check `vary` already gets (via varyTrack's BeatVaryError) — `suggest`
  // used to skip it entirely and hand back a normal-looking cold-start recommendation for a
  // track that doesn't exist (research/96).
  const doc = readDoc(file)
  const trackObj = doc.tracks.find((t) => t.id === track)
  if (!trackObj) throw new BeatEditError(`no track "${track}" (have: ${doc.tracks.map((t) => t.id).join(', ')})`)
  // Same next-to-the-.beat default as score's log (Phase 35 OC) — the two must agree or
  // suggest reads an empty exhaust while score keeps appending somewhere else.
  const { defaultScoresLog } = await import('../dist/src/vary/batch.js')
  const logPath = flagValue(argv, '--log') ?? defaultScoresLog(file)
  const target = flagValue(argv, '--target')
  const text = existsSync(logPath) ? readFileSync(logPath, 'utf8') : ''
  const entries = parseScoresLog(text)
  // trackLanes makes the suggestion lane-aware on declared-lane drums tracks (Phase 35 Stream
  // OA): cold start recommends a real lane, and a legacy drum-voice group that would no-op on
  // this track is never recommended.
  const suggestion = suggestNext(entries, track, {
    file,
    trackKind: trackObj.kind,
    ...(trackObj.kind === 'drums' && trackObj.lanes.length > 0 ? { trackLanes: trackObj.lanes } : {}),
    ...(target ? { target } : {}),
  })
  process.stdout.write(suggestion.reasoning.join('\n') + '\n')
}

// ---- v0.4 song structure (docs/phase-6-plan.md §6.4) ----------------------------------------

function clipCmd(argv) {
  const [file, track, clipId] = argv
  if (!file || !track || !clipId) throw new BeatEditError('clip needs <file> <track> <clip-id>')
  const before = readDoc(file)
  const { doc, created } = saveClip(before, track, clipId)
  writeDoc(file, before, doc)
  if (!created) process.stdout.write(`(re-snapshotted existing clip "${clipId}")\n`)
}

function sceneCmd(argv) {
  const [file, sceneId, ...pairs] = argv
  if (!file || !sceneId) throw new BeatEditError('scene needs <file> <scene-id> [<track>=<clip>[@<steps>] ...]')
  // v0.11 (Phase 36 PB): each pair is one PLACEMENT — the same track may repeat, and a trailing
  // @<steps> (fractional 16th steps from the section start, default 0) says where it sounds.
  // Everything funnels into core's setScene placement lists; all validation (audio-only-for-v1,
  // overlap, clip-exists) lives there, shared with the parser and MCP.
  const slots = {}
  for (const pair of pairs) {
    const eq = pair.indexOf('=')
    if (eq === -1) throw new BeatEditError(`slot "${pair}" must be <track>=<clip>[@<steps>]`)
    const track = pair.slice(0, eq)
    const rhs = pair.slice(eq + 1)
    const sep = rhs.lastIndexOf('@') // clip ids are alphanumeric/_/- tokens, so '@' is unambiguous
    let placement
    if (sep === -1) {
      placement = { clip: rhs, at: 0 }
    } else {
      const at = Number(rhs.slice(sep + 1))
      if (rhs.slice(sep + 1) === '' || Number.isNaN(at)) throw new BeatEditError(`slot "${pair}": @ must be followed by a step offset (fractional 16th steps), e.g. fx=impact1@48`)
      placement = { clip: rhs.slice(0, sep), at }
    }
    ;(slots[track] ??= []).push(placement)
  }
  const before = readDoc(file)
  writeDoc(file, before, setScene(before, sceneId, slots))
}

// v0.11 (Phase 36 PB): the friendlier single-placement verbs over core's placeClip/unplaceClip.
// `place` requires the scene to already exist (beat scene mints scenes); `unplace` needs @<at>
// only when the same clip is placed more than once on that track — core fail-louds on ambiguity
// and we surface its error verbatim.
function placeCmd(argv) {
  const [file, sceneId, track, clip, at] = argv
  if (!file || !sceneId || !track || !clip || at === undefined) {
    throw new BeatEditError('place needs <file> <scene> <track> <clip> <at-steps> (the scene must already exist — beat scene mints scenes)')
  }
  const before = readDoc(file)
  const { doc } = placeClip(before, sceneId, track, clip, Number(at))
  writeDoc(file, before, doc)
}

function unplaceCmd(argv) {
  const [file, sceneId, track, clipArg] = argv
  if (!file || !sceneId || !track || !clipArg) throw new BeatEditError('unplace needs <file> <scene> <track> <clip>[@<at>]')
  const sep = clipArg.lastIndexOf('@')
  let clip = clipArg
  let at
  if (sep !== -1) {
    at = Number(clipArg.slice(sep + 1))
    if (clipArg.slice(sep + 1) === '' || Number.isNaN(at)) throw new BeatEditError(`unplace "${clipArg}": @ must be followed by the placement's step offset, e.g. riser1@56.5`)
    clip = clipArg.slice(0, sep)
  }
  const before = readDoc(file)
  const { doc } = unplaceClip(before, sceneId, track, clip, at)
  writeDoc(file, before, doc)
}

// Phase 32 Stream LB: renames (or clears) a scene's display name — the CLI/agent face on
// renameScene, same shape as group-set's --name flag.
function sceneSetCmd(argv) {
  const [file, sceneId, ...rest] = argv
  if (!file || !sceneId) throw new BeatEditError('scene-set needs <file> <scene-id> --name N|--clear-name')
  const nameIdx = rest.indexOf('--name')
  const clearName = rest.includes('--clear-name')
  if (nameIdx === -1 && !clearName) throw new BeatEditError('scene-set needs at least one of --name/--clear-name')
  if (nameIdx !== -1 && clearName) throw new BeatEditError('scene-set: pass either --name or --clear-name, not both')
  const before = readDoc(file)
  const name = clearName ? null : rest[nameIdx + 1]
  writeDoc(file, before, renameScene(before, sceneId, name))
}

function songCmd(argv) {
  const [file, ...rest] = argv
  if (!file) throw new BeatEditError('song needs <file> [<scene> <bars> ...]')
  if (rest.length % 2 !== 0) throw new BeatEditError('song sections are <scene> <bars> pairs')
  const sections = []
  for (let i = 0; i < rest.length; i += 2) sections.push({ scene: rest[i], bars: Number(rest[i + 1]) })
  const before = readDoc(file)
  writeDoc(file, before, setSong(before, sections))
}

// Phase 24 Stream CB: reorder a section in place — a two-line diff, not a whole-timeline rewrite,
// same shape as effect-move/lane move.
function songMoveCmd(argv) {
  const [file, fromIndex, toIndex] = argv
  if (!file || fromIndex === undefined || toIndex === undefined) throw new BeatEditError('song-move needs <file> <from-index> <to-index>')
  const before = readDoc(file)
  const { doc } = songMove(before, Number(fromIndex), Number(toIndex))
  writeDoc(file, before, doc)
}

// Phase 26 Stream DJ: insert a brand-new, empty, genuinely independent scene as a new section —
// the CLI/MCP half of "Insert Scene" (docs/research/54-...md's P0 recommendation). Unlike `beat
// song` (whole-list replace, always references EXISTING scenes) this mints a scene id that has
// never appeared in the document before, so the new section can never inherit another section's
// content by construction. Capture-and-Insert Scene (the live-content-snapshot half) is daemon/GUI-
// only for now — see src/daemon/daemon.ts's captureAndInsertScene and POST /song {op:'captureInsert'}.
function songInsertCmd(argv) {
  const [file, index, bars] = argv
  if (!file || index === undefined || bars === undefined) throw new BeatEditError('song-insert needs <file> <index> <bars>')
  const before = readDoc(file)
  const { doc, sceneId } = insertScene(before, Number(index), Number(bars))
  writeDoc(file, before, doc)
  process.stdout.write(`inserted section at index ${Number(index)} with new empty scene "${sceneId}"\n`)
}

// v0.9 clip automation (docs/phase-9-automation-plan.md). Phase 26 Stream DI added an optional
// --interpolation flag (linear|hold|curve) — the segment-shape this point starts (document.ts's
// AutomationInterpolation); omitted on a move, the point's existing curve-shape is preserved.
function automateCmd(argv) {
  const idIdx = argv.indexOf('--id')
  const id = idIdx !== -1 ? argv[idIdx + 1] : undefined
  const interpIdx = argv.indexOf('--interpolation')
  const interpolation = interpIdx !== -1 ? argv[interpIdx + 1] : undefined
  const positional = argv.filter(
    (a, i) => !(idIdx !== -1 && (i === idIdx || i === idIdx + 1)) && !(interpIdx !== -1 && (i === interpIdx || i === interpIdx + 1)),
  )
  const [file, track, clip, param, time, value] = positional
  if (!file || !track || !clip || !param || time === undefined || value === undefined) {
    throw new BeatEditError('automate needs <file> <track> <clip> <param> <time> <value> [--id p1] [--interpolation linear|hold|curve]')
  }
  const before = readDoc(file)
  const { doc, created } = setAutomationPoint(before, track, clip, param, {
    time: Number(time),
    value: Number(value),
    ...(id !== undefined ? { id } : {}),
    ...(interpolation !== undefined ? { interpolation } : {}),
  })
  writeDoc(file, before, doc)
  if (!created) process.stdout.write(`(moved existing point)\n`)
}

// === Phase 37 Stream RC begin ===
function automateShapeCmd(argv) {
  const valued = ['--from', '--to', '--cycles', '--points', '--bars']
  const positional = argv.filter((a, i) => !a.startsWith('--') && !valued.includes(argv[i - 1]))
  const [file, track, clip, param, shape] = positional
  if (!file || !track || !clip || !param || !shape) {
    throw new BeatEditError('automate-shape needs <file> <track> <clip> <param> <ramp|sine|triangle|exp|adsr> [--from V --to V --cycles N --points N --bars N]')
  }
  const from = flagValue(argv, '--from')
  const to = flagValue(argv, '--to')
  if (from === undefined || to === undefined) throw new BeatEditError('automate-shape needs --from and --to (the shape\'s start and target values, in the param\'s own units)')
  const opts = {
    from: Number(from),
    to: Number(to),
    ...(flagValue(argv, '--cycles') !== undefined ? { cycles: Number(flagValue(argv, '--cycles')) } : {}),
    ...(flagValue(argv, '--points') !== undefined ? { points: Number(flagValue(argv, '--points')) } : {}),
    ...(flagValue(argv, '--bars') !== undefined ? { bars: Number(flagValue(argv, '--bars')) } : {}),
  }
  const before = readDoc(file)
  const { doc, spanSteps, points } = applyAutomationShape(before, track, clip, param, shape, opts)
  writeDoc(file, before, doc)
  process.stdout.write(`${shape} ${param} on ${track}.${clip}: ${points.length} points across ${formatNumber(spanSteps)} steps (${opts.from} -> ${opts.to})\n`)
}
// === Phase 37 Stream RC end ===

async function sampleCmd(argv) {
  const [file, id, samplePath] = argv
  if (!file || !id || !samplePath) throw new BeatEditError('sample needs <file> <sample-id> <wav-path> (path relative to the .beat file)')
  const { createHash } = await import('node:crypto')
  const beatDir = dirname(resolve(file))
  const abs = resolve(beatDir, samplePath)
  if (!existsSync(abs)) throw new BeatEditError(`no file at ${samplePath} (relative to ${beatDir}) — put the audio next to the project first`)
  const sha256 = createHash('sha256').update(readFileSync(abs)).digest('hex')
  const before = readDoc(file)
  writeDoc(file, before, setMediaSample(before, id, sha256, samplePath.replace(/\\/g, '/')))
  process.stdout.write(`registered ${id}: sha256:${sha256.slice(0, 12)}... ${samplePath}\n`)
}

// ==== Phase 38 Stream SA begin ====
// `beat skeleton <out.beat> <analysis.json>` — scaffold a structure-matched empty project from a
// detected-structure artifact (docs/phase-38-plan.md §SA). All the seconds->bars math and
// validation live in src/analysis/import.ts; this command is I/O + the refuse-overwrite guard.
function skeletonCmd(argv) {
  const sbIdx = argv.indexOf('--section-bars')
  const sectionBars = sbIdx >= 0 ? Number(argv[sbIdx + 1]) : undefined
  const positionals = argv.filter((a, i) => !a.startsWith('--') && !(sbIdx >= 0 && i === sbIdx + 1))
  const [outFile, analysisFile] = positionals
  if (!outFile || !analysisFile) throw new BeatAnalysisError('skeleton needs <out.beat> <analysis.json> [--section-bars N]')
  if (existsSync(outFile)) throw new BeatAnalysisError(`${outFile} already exists — refusing to overwrite (skeleton scaffolds a NEW project; delete it or choose another path)`)
  if (!existsSync(analysisFile)) throw new BeatAnalysisError(`no analysis file at ${analysisFile} — produce one with beat analyze <audio.wav> first`)
  let raw
  try {
    raw = JSON.parse(readFileSync(analysisFile, 'utf8'))
  } catch (e) {
    throw new BeatAnalysisError(`${analysisFile} is not valid JSON: ${e instanceof Error ? e.message : String(e)}`)
  }
  const artifact = validateAnalysisArtifact(raw)
  const { doc, report } = buildSkeleton(artifact, sectionBars !== undefined ? { sectionBars } : {})
  writeFileSync(outFile, serialize(doc))
  process.stdout.write(formatSkeletonReport(report, outFile) + '\n')
}
// ==== Phase 38 Stream SA end ====

// ==== Phase 37 Stream RD begin ====
// `beat source` — find/ingest real sounds into the taste loop (docs/phase-37-plan.md §RD). Backed
// by scripts/source-lib.mjs, imported at call time via a runtime dynamic import (shared verbatim
// with the MCP surface). SourceError is mapped to BeatEditError HERE so the shared main().catch
// prints a clean `error: ...` (exit 2) with no stack — never leaking through as an uncaught throw.
async function sourceCmd(argv) {
  const [sub, ...rest] = argv
  const flag = (name, dflt) => {
    const i = rest.indexOf(name)
    return i !== -1 ? rest[i + 1] : dflt
  }
  const VALUE_FLAGS = new Set(['--max', '--dur-min', '--dur-max', '--out-dir', '--license', '--note', '--freesound',
    // ==== Phase 39 Stream UB (gen) ====
    '--seconds', '--seed', '--backend', '--provider',
    // ==== Phase 40 Stream VB ==== (gen batches)
    '--count', '--seed-from',
    // ==== end Phase 40 Stream VB ====
  ])
  const positionals = rest.filter((a, i) => !a.startsWith('--') && !VALUE_FLAGS.has(rest[i - 1]))
  const lib = await import(new URL('../scripts/source-lib.mjs', import.meta.url).href)
  try {
    if (sub === 'search') {
      const [query] = positionals
      const outDir = flag('--out-dir')
      const opts = {
        query,
        max: flag('--max') !== undefined ? Number(flag('--max')) : 10,
        durMin: flag('--dur-min') !== undefined ? Number(flag('--dur-min')) : 0.05,
        durMax: flag('--dur-max') !== undefined ? Number(flag('--dur-max')) : 5,
      }
      const { total, results } = await lib.freesoundSearchCC0(opts)
      process.stdout.write(`${total} CC0 result${total === 1 ? '' : 's'} for "${query}" — top ${results.length} by rating:\n`)
      for (const r of results) {
        process.stdout.write(`  #${r.id}  ${r.name} by ${r.by}  (${Number(r.duration).toFixed(2)}s, rating ${r.rating ?? 'n/a'})  ${r.url}\n`)
      }
      if (outDir) {
        const saved = await lib.downloadPreviews({ results, outDir })
        process.stdout.write(`downloaded ${saved.length} preview${saved.length === 1 ? '' : 's'} into ${outDir}/ for auditioning\n`)
      }
      process.stdout.write(`register one with: beat source add <file.beat> <id> --freesound <#>\n`)
      return
    }
    if (sub === 'add') {
      const [file, id, audioFile] = positionals
      const freesoundId = flag('--freesound')
      const note = flag('--note')
      let result
      if (freesoundId !== undefined) {
        result = await lib.addFreesoundSource({ beatFile: file, id, freesoundId, note })
      } else {
        result = await lib.addLocalSource({ beatFile: file, id, audioFile, license: flag('--license', 'unspecified'), note })
      }
      process.stdout.write(
        `registered ${result.id}: sha256:${result.sha256.slice(0, 12)}... ${result.relPath} ` +
        `(${result.durationSeconds}s, license ${result.license})\n` +
        `provenance sidecar: ${result.relPath}.json\n`,
      )
      // Pilot 104 minor: re-registering an existing id silently replaced it. Say so explicitly.
      if (result.reregistered) {
        process.stdout.write(
          result.reregistered.changed
            ? `note: re-registered ${result.id} (replaced sha256:${result.reregistered.previousSha256.slice(0, 7)}... -> ${result.sha256.slice(0, 7)}...)\n`
            : `note: ${result.id} already registered (unchanged)\n`,
        )
      }
      return
    }
    // ==== Phase 39 Stream UB begin ====
    if (sub === 'gen') {
      // `beat source gen --doctor` probes the generative backends (stub always ok; stableaudio needs
      // torch owner-side). Prints the genDoctor JSON so it's scriptable, like `beat analyze --doctor --json`.
      if (rest.includes('--doctor')) {
        const analysis = await import(new URL('../dist/src/analysis/index.js', import.meta.url).href)
        const report = await analysis.genDoctor()
        process.stdout.write(JSON.stringify(report, null, 2) + '\n')
        return
      }
      const [file, id, prompt] = positionals
      // ==== Phase 40 Stream VB ====
      // `--count N`: generate N candidates (seeds S..S+N-1) into a batch dir and register NOTHING.
      // Presence of --count is the switch, not its value — asking for a batch of 1 is a coherent
      // (if unusual) request, and the alternative (N>1 means batch) would make --count 1 silently
      // mean something else entirely. Without --count, the single-shot register-now path below is
      // untouched.
      if (flag('--count') !== undefined) {
        await sourceGenBatch(lib, { file, id, prompt, rest, flag })
        return
      }
      // ==== end Phase 40 Stream VB ====
      const result = await lib.addGeneratedSource({
        beatFile: file,
        id,
        prompt,
        seconds: flag('--seconds') !== undefined ? Number(flag('--seconds')) : 2,
        ...(flag('--seed') !== undefined ? { seed: Number(flag('--seed')) } : {}),
        backend: flag('--backend', 'stableaudio'),
        provider: flag('--provider', 'stable-audio-open'),
        ...(flag('--license') !== undefined ? { license: flag('--license') } : {}),
      })
      process.stdout.write(
        `registered ${result.id}: sha256:${result.sha256.slice(0, 12)}... ${result.relPath} ` +
        `(${result.durationSeconds}s, ${result.source}, license ${result.license})\n` +
        `provenance sidecar: ${result.relPath}.json\n`,
      )
      if (result.reregistered) {
        process.stdout.write(
          result.reregistered.changed
            ? `note: re-registered ${result.id} (replaced sha256:${result.reregistered.previousSha256.slice(0, 7)}... -> ${result.sha256.slice(0, 7)}...)\n`
            : `note: ${result.id} already registered (unchanged)\n`,
        )
      }
      return
    }
    // ==== Phase 39 Stream UB end ====
    throw new BeatEditError('source needs a subcommand: `beat source search <query>` or `beat source add <file.beat> <id> <local-audio-file>` (see `beat help source`)')
  } catch (err) {
    if (err && err.name === 'SourceError') throw new BeatEditError(err.message)
    throw err
  }
}

// ==== Phase 40 Stream VB begin ====
/** `beat source gen ... --count N` — the generative taste loop's first half: N candidates from one
 * prompt across N seeds, into a batch dir, registering NOTHING. Prints the same
 * "audition, then: beat score ..." call to action the vary rungs print, so the generative workflow
 * and the mutation workflow converge on one pair of verbs (score, adopt). */
async function sourceGenBatch(lib, { file, id, prompt, rest, flag }) {
  const count = Number(flag('--count'))
  const seedFrom = flag('--seed-from') ?? flag('--seed')
  const result = await lib.genSourceBatch({
    beatFile: file,
    id,
    prompt,
    count,
    seconds: flag('--seconds') !== undefined ? Number(flag('--seconds')) : 2,
    // --seed-from is the batch's spelling of --seed; accept --seed too rather than erroring at
    // someone who reasonably reached for the flag the single-shot path taught them.
    ...(seedFrom !== undefined ? { seedFrom: Number(seedFrom) } : {}),
    backend: flag('--backend', 'stableaudio'),
    provider: flag('--provider', 'stable-audio-open'),
    ...(flag('--license') !== undefined ? { license: flag('--license') } : {}),
    ...(flag('--out-dir') !== undefined ? { outDir: flag('--out-dir') } : {}),
    onProgress: (i, n, seed) => process.stdout.write(`generating v${i}/${n} (seed ${seed})...\n`),
  })
  const last = result.seedFrom + result.candidates.length - 1
  process.stdout.write(
    `${result.dir}/: ${result.candidates.length} candidate${result.candidates.length === 1 ? '' : 's'} of "${prompt}" ` +
    `(seeds ${result.seedFrom}${last !== result.seedFrom ? `-${last}` : ''})\n`,
  )
  for (const c of result.candidates) {
    process.stdout.write(`  ${c.variant}: seed ${c.seed}, ${c.durationSeconds}s, sha256:${c.sha256.slice(0, 12)}...\n`)
  }
  // The property this whole path exists for — state it, don't leave it to be inferred.
  process.stdout.write(`nothing is registered in ${file} yet: candidates live only in the batch dir until you adopt one\n`)
  // Gen candidates are ALREADY audio: the vN.wavs a vary batch needs headless Chromium to produce
  // exist the moment generation ends, so the SAME stitcher runs with no render step in front of it
  // (auditionAfterRender is named for vary's flow, but it only stitches — nothing here re-renders).
  if (rest.includes('--audition')) await auditionAfterRender(result.dir, result.candidates.length, { noShuffle: rest.includes('--no-shuffle') })
  process.stdout.write(`audition, then: beat score ${result.dir} <best> [2nd 3rd]\n`)
  process.stdout.write(`then register the winner: beat adopt ${result.dir} <best>\n`)
}
// ==== Phase 40 Stream VB end ====
// ==== Phase 37 Stream RD end ====

// ==== Phase 40 Stream VC ====
// `beat regen` — replay a project's generated media from its provenance sidecars (see
// src/analysis/regen.ts for the honesty contract this surface is printing). The library returns
// structured results and never writes to stdout; the formatting lives there too, so the MCP twin
// prints the identical text. BeatRegenError → BeatEditError for the shared clean-exit path.
async function regenCmd(argv) {
  const args = argv.filter((a) => a !== '--verify')
  const idFlag = args.indexOf('--id')
  const id = idFlag !== -1 ? args[idFlag + 1] : undefined
  const file = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--id')[0]
  const verify = argv.includes('--verify')
  const analysis = await import(new URL('../dist/src/analysis/index.js', import.meta.url).href)
  try {
    const plan = analysis.planRegen(file, { id })
    // The cost estimate lands BEFORE the first minute is spent, never in the summary.
    process.stdout.write(analysis.formatRegenPlan(plan, verify) + '\n')
    if (plan.regenerable.length === 0) {
      process.stdout.write('nothing to regenerate — no generated media in this project\n')
      return
    }
    const res = await analysis.runRegen({
      beatFile: file,
      id,
      verify,
      // A 20-minute run must not be a silent one: report each sample as it lands.
      onProgress: (r) => process.stdout.write(analysis.formatRegenSample(r) + '\n'),
    })
    // The summary re-prints the per-sample lines, so drop them here and keep only the tail.
    process.stdout.write(analysis.formatRegenResults(res).split('\n').slice(res.results.length).join('\n') + '\n')
    // A `differs` is a report, not a failure (see regen.ts) — only a real error exits non-zero.
    if (res.results.some((r) => r.status === 'error')) process.exitCode = 1
  } catch (err) {
    if (err && err.name === 'BeatRegenError') throw new BeatEditError(err.message)
    throw err
  }
}
// ==== end Phase 40 Stream VC ====

// ==== gen-kit begin ====
// `beat gen-kit <project-dir>` — compose a playable .beat project entirely from generated sounds:
// the examples/recipe-song workflow (built by hand on 2026-07-14) as one command, on the Phase 40
// pieces. Per role it runs the SAME machinery the taste loop runs — genSourceBatch (deferred
// registration, style-contrast prompts), a measurable pick, adoptVariant (registers the winner
// ALONE), keymap for tonal roles — then writes seeded starter patterns and scene-places everything
// (song mode renders only scene-placed content; the Phase 39 silent-render trap). The pure logic
// (role specs, prompts, picks, spans, patterns) lives in src/analysis/genkit.ts; this function is
// the loop. See docs/gen-kit-pipeline.md.
async function genKitCmd(argv) {
  const VALUE_FLAGS = new Set(['--roles', '--candidates', '--bpm', '--key', '--scale', '--gen-backend', '--seed'])
  for (const a of argv) if (a.startsWith('--') && !VALUE_FLAGS.has(a)) throw new BeatEditError(`unknown flag "${a}" (known: ${[...VALUE_FLAGS].join(', ')})`)
  const flag = (name) => {
    const i = argv.indexOf(name)
    return i !== -1 ? argv[i + 1] : undefined
  }
  const positionals = argv.filter((a, i) => !a.startsWith('--') && !VALUE_FLAGS.has(argv[i - 1]))
  const projectDir = positionals[0]
  if (!projectDir) {
    throw new BeatEditError('gen-kit needs a <project-dir>, e.g. beat gen-kit my-kit --gen-backend stub\n  (creates <project-dir>/<project-dir>.beat plus one rateable candidate batch per role)')
  }
  const genkit = await import(new URL('../dist/src/analysis/index.js', import.meta.url).href)
  const { adoptVariant } = await import(new URL('../dist/src/vary/batch.js', import.meta.url).href)
  const { mulberry32 } = await import(new URL('../dist/src/taste/eval.js', import.meta.url).href)
  const lib = await import(new URL('../scripts/source-lib.mjs', import.meta.url).href)

  let roles
  try {
    roles = genkit.parseGenKitRoles(flag('--roles'))
  } catch (err) {
    if (err && err.name === 'BeatGenKitError') throw new BeatEditError(err.message)
    throw err
  }
  const candidates = flag('--candidates') !== undefined ? Number(flag('--candidates')) : 4
  if (!Number.isInteger(candidates) || candidates < 1) throw new BeatEditError(`--candidates must be a positive integer, got ${flag('--candidates')}`)
  const bpm = flag('--bpm') !== undefined ? Number(flag('--bpm')) : 96
  const keyText = flag('--key') ?? 'a'
  const keyMidi = parseKeyNote(keyText) // liberal: "a", "c#", or a full note like a2
  const keyPc = ((keyMidi % 12) + 12) % 12
  const scale = flag('--scale') ?? 'minorPentatonic'
  if (!SCALE_NAMES.includes(scale)) throw new BeatEditError(`unknown scale "${scale}" (have: ${SCALE_NAMES.join(', ')})`)
  const backend = flag('--gen-backend') ?? 'fal'
  if (!['fal', 'stub', 'stableaudio'].includes(backend)) throw new BeatEditError(`--gen-backend must be fal, stub or stableaudio, got "${backend}"`)
  const metaSeed = flag('--seed') !== undefined ? Number(flag('--seed')) : 41
  if (!Number.isInteger(metaSeed)) throw new BeatEditError(`--seed must be an integer, got ${flag('--seed')}`)

  // <dir>/<basename>.beat when the basename is a clean token, else <dir>/song.beat.
  mkdirSync(projectDir, { recursive: true })
  const base = basename(resolve(projectDir))
  const beatFile = join(projectDir, `${/^[a-zA-Z0-9._-]+$/.test(base) ? base : 'song'}.beat`)
  if (existsSync(beatFile)) throw new BeatEditError(`${beatFile} already exists — gen-kit composes a FRESH project; pick a new directory or remove the file`)

  const LOOP_BARS = 2
  const SECTION_BARS = 8
  // A fresh project. The 'starter' synth track is scaffolding only — a document must always carry
  // at least one track, so it stays until the kit's real tracks exist and is removed below.
  writeFileSync(beatFile, serialize(initDocument({ bpm, loopBars: LOOP_BARS, trackId: 'starter' })))
  process.stdout.write(`gen-kit: ${beatFile} — ${roles.map((r) => r.role).join(', ')} @ ${candidates} candidate(s) each, ${backend} backend, key ${pitchClassName(keyMidi)} ${scale}, seed ${metaSeed}\n`)

  // One rng, drawn in a fixed order, so the whole kit is deterministic in --seed (given the same
  // roles/candidates/backend): per role a prompt-style seed + a generation seedFrom, then the
  // three pattern seeds.
  const rng = mulberry32(metaSeed)
  const picks = [] // { spec, dir, pick, keymap? }
  for (const spec of roles) {
    const styleSeed = Math.floor(rng() * 1e9)
    const seedFrom = Math.floor(rng() * 100000)
    const prompts = genkit.genkitPrompts(spec, candidates, styleSeed)
    process.stdout.write(`\n=== ${spec.role}: ${candidates} candidate(s) of "${spec.subject}" (${spec.seconds}s, seeds ${seedFrom}${candidates > 1 ? `-${seedFrom + candidates - 1}` : ''}) ===\n`)
    const batch = await lib.genSourceBatch({
      beatFile,
      id: spec.role,
      prompt: spec.subject,
      prompts,
      seconds: spec.seconds,
      seedFrom,
      backend,
      group: `genkit:${spec.role}`,
      onProgress: (i, n) => process.stdout.write(`  generating v${i}/${n}...\n`),
    })
    // Measure every candidate from the batch dir — the exact prepped bytes an adopt would register.
    const measured = batch.candidates.map((c) => {
      try {
        return decodeWav(readFileSync(c.wav))
      } catch {
        return null
      }
    })
    let pick
    if (spec.kind === 'drum') {
      const centroids = measured.map((m) => (m === null ? null : analyze(m.channels, m.sampleRate).spectral.centroidHz))
      pick = genkit.pickDrumCandidate(spec, centroids)
    } else {
      const pitches = measured.map((m, i) => {
        if (m === null) return { hz: null, midi: null, note: null, cents: null, confidence: -1, level: 'low', method: 'undecodable', periodicity: 0, harmonicity: 0, partials: [], suggestedRootNote: null, suggestedRootHz: null, sampleRate: 0, durationSeconds: 0, analyzedFromSeconds: 0, analyzedToSeconds: 0 }
        return detectPitch(m.channels, m.sampleRate)
      })
      try {
        pick = genkit.pickTonalCandidate(pitches)
      } catch (err) {
        if (err && err.name === 'BeatGenKitError') throw new BeatEditError(`${spec.role}: ${err.message}`)
        throw err
      }
    }
    // Deferred registration pays off here: adopt registers the WINNER alone; the losers stay in
    // the batch dir as an ordinary rateable batch for the owner (or the critic) to re-pick.
    adoptVariant(batch.dir, `v${pick.index + 1}`)
    process.stdout.write(`  picked v${pick.index + 1}/${candidates}: ${pick.reason}\n`)
    process.stdout.write(`  registered ${spec.role}; all ${candidates} candidate(s) stay scoreable in ${batch.dir}\n`)
    picks.push({ spec, dir: batch.dir, pick })
  }
  const drumSeed = Math.floor(rng() * 1e9)
  const bassSeed = Math.floor(rng() * 1e9)
  const leadSeed = Math.floor(rng() * 1e9)

  // Build the playable document over the registered winners: kit lanes + keymapped tonal tracks,
  // starter patterns, then clip -> scene -> song so every track is scene-placed (song mode renders
  // only scene-placed content — the Phase 39 silent-render trap this command must never re-open).
  let doc = readDoc(beatFile)
  const drumRoles = picks.filter((p) => p.spec.kind === 'drum')
  const slots = {}
  // A declared sample lane, built directly (addLane refuses on a zero-lane drums track — that
  // shape means "legacy implicit 5-lane" — so fresh gen-kit tracks are born with their lane lists).
  const sampleLaneDecl = (name, sampleId, gainDb, tune) => ({
    name,
    backing: { type: 'sample', sample: sampleId, gainDb, tune, params: {}, filterType: 'lowpass', effects: [] },
  })
  process.stdout.write('\n')
  if (drumRoles.length > 0) {
    doc = addTrack(doc, { id: 'kit', kind: 'drums', name: 'kit', lanes: drumRoles.map((p) => sampleLaneDecl(p.spec.role, p.spec.role, p.spec.laneGainDb, 0)) }).doc
    for (const h of genkit.planDrumHits(drumRoles.map((p) => p.spec.role), LOOP_BARS, drumSeed)) {
      doc = addHit(doc, 'kit', h).doc
    }
    doc = saveClip(doc, 'kit', 'groove').doc
    slots.kit = [{ clip: 'groove', at: 0 }]
    process.stdout.write(`kit: lanes ${drumRoles.map((p) => p.spec.role).join(', ')} — starter groove written (clip "groove")\n`)
  }
  for (const p of picks.filter((x) => x.spec.kind === 'tonal')) {
    const role = p.spec.role
    const { fromMidi, toMidi } = genkit.keymapSpanForRoot(p.pick.rootMidi, keyPc)
    // The keymap plan (Phase 40 VA): one lane per scale degree, tuned from the sample's measured
    // root — minted directly into the fresh track's lane list.
    const plan = planKeymap({ rootMidi: p.pick.rootMidi, scaleRootMidi: keyPc, scale, fromMidi, toMidi })
    doc = addTrack(doc, { id: role, kind: 'drums', name: role, lanes: plan.map((l) => sampleLaneDecl(l.name, role, p.spec.laneGainDb, l.tune)) }).doc
    const laneNames = plan.map((l) => l.name)
    const clipId = role === 'bass' ? 'bline' : 'mel'
    const hits = role === 'bass' ? genkit.planBassHits(laneNames, LOOP_BARS, bassSeed) : genkit.planLeadHits(laneNames, LOOP_BARS, leadSeed)
    for (const h of hits) doc = addHit(doc, role, h).doc
    doc = saveClip(doc, role, clipId).doc
    slots[role] = [{ clip: clipId, at: 0 }]
    process.stdout.write(`${role}: keymapped ${laneNames.length} lanes (${laneNames[0]}..${laneNames[laneNames.length - 1]}, ${scale} in ${pitchClassName(keyMidi)}) — root ${p.pick.rootSource} ${midiToNote(p.pick.rootMidi)}; starter phrase written (clip "${clipId}")\n`)
  }
  // Produced defaults (docs/research/115-production-layer-techniques.md, plan A1): every registered
  // track ships with role-appropriate production (width / air / glue / space) instead of the dry,
  // mono, static init patch. Deterministic function of role — no rng — so the .beat stays
  // byte-deterministic per --seed. kick/bass stay mono-anchored (no width, no reverb per research
  // 115 §2.2); the drum bus (kit) gets an air shelf + light glue but no width (it carries the kick);
  // lead/pad get the full width/air/space; and the bass ducks under the kit's kick (§4.2) — the
  // genre-defining pump, wired only when the kit actually has a kick lane.
  const producedIds = []
  if (drumRoles.length > 0) producedIds.push('kit')
  for (const p of picks.filter((x) => x.spec.kind === 'tonal')) producedIds.push(p.spec.role)
  const kitHasKick = drumRoles.some((p) => p.spec.role === 'kick')
  process.stdout.write('\n')
  for (const id of producedIds) {
    let profile = genkit.productionProfileFor(genkit.productionRoleFor(id))
    if (id === 'bass' && kitHasKick) profile = { ...profile, duck: { source: 'kit', amount: 0.35 } }
    const res = genkit.applyProducedDefaults(doc, id, profile)
    doc = res.doc
    if (res.applied.length > 0) process.stdout.write(`produced ${id}: ${res.applied.join('; ')}\n`)
  }

  doc = removeTrack(doc, 'starter').doc // the scaffolding track — the kit's real tracks exist now
  doc = setScene(doc, 'main', slots)
  doc = setSong(doc, [{ scene: 'main', bars: SECTION_BARS }])
  doc = { ...doc, selectedTrack: doc.tracks[0].id }
  writeFileSync(beatFile, serialize(doc))

  process.stdout.write(
    `\n${beatFile}: ${doc.tracks.length} track(s), scene "main" placed for all of them, song ${SECTION_BARS} bars — a normal .beat project\n` +
    `  hear it:        beat render ${beatFile} && beat metrics ${beatFile.replace(/\.beat$/, '.wav')}\n` +
    `  make it yours:  beat vary ${beatFile} kit --groups   (and beat vary ... feel)\n` +
    `  re-pick a role: beat rate ${projectDir}   (or beat score <batch-dir> <best> ...), then beat adopt <batch-dir> vN --force\n` +
    `  prove the recipe: beat regen ${beatFile} --verify\n`,
  )
}
// ==== gen-kit end ====

function laneCmd(argv) {
  // Phase 35 Stream OB: `--clear-legacy` is the one-shot explicit cleanup for stale v0.5
  // laneSamples lines on a declared-lane track (inspect flags them; playback ignores them there).
  // Deliberately its own flag rather than an overload of `none`, which now means "revert the
  // DECLARED backing to its synth voice."
  if (argv.includes('--clear-legacy')) {
    const [file, track] = argv.filter((a) => a !== '--clear-legacy')
    if (!file || !track || argv.length !== 3) throw new BeatEditError('lane --clear-legacy needs exactly <file> <track>')
    const before = readDoc(file)
    const { doc, cleared } = clearLegacyLaneSamples(before, track)
    writeDoc(file, before, doc)
    process.stdout.write(`cleared ${cleared.length} stale legacy lane line${cleared.length === 1 ? '' : 's'} on ${track}: ${cleared.join(', ')}\n`)
    return
  }
  const [file, track, lane, sampleId, gain, tune] = argv
  if (!file || !track || !lane || !sampleId) throw new BeatEditError('lane needs <file> <track> <lane> <sample-id|none> [gain dB] [tune semitones] (or <file> <track> --clear-legacy)')
  const before = readDoc(file)
  const ref = sampleId === 'none' ? null : { sample: sampleId, gainDb: gain !== undefined ? Number(gain) : 0, tune: tune !== undefined ? Number(tune) : 0 }
  writeDoc(file, before, setLaneSample(before, track, lane, ref))
}

// ==== Phase 40 Stream VA ====
// Pitch-aware sampling (docs/phase-40-plan.md §VA): the three verbs that close the gap between
// "generate a sound" and "play a melody with it". Everything here is pure TS — no venv, no Python
// (decisions.md D20).

/** Decodes a REGISTERED sample's audio. Refusing on an unregistered id (rather than taking a path)
 * is deliberate: these verbs read the pitch of a sound the project already commits to, and the
 * media block is that commitment. */
function readSampleAudio(file, doc, sampleId) {
  const entry = doc.media.find((m) => m.id === sampleId)
  if (!entry) {
    throw new BeatEditError(
      `no sample "${sampleId}" in the media block (have: ${doc.media.map((m) => m.id).join(', ') || 'none'}) — register it with beat sample first`,
    )
  }
  const beatDir = dirname(resolve(file))
  const abs = resolve(beatDir, entry.path)
  if (!existsSync(abs)) throw new BeatEditError(`sample "${sampleId}" is registered at ${entry.path}, but there is no file there (relative to ${beatDir})`)
  return { entry, ...decodeWav(readFileSync(abs)) }
}

/** `--key a` is the natural way to say "A minor"; noteToMidi wants a full note. Only the pitch
 * class is ever used, so the octave we invent here is arbitrary. */
function parseKeyNote(text) {
  return noteToMidi(/^[a-gA-G][#sb]?$/.test(text) ? `${text}4` : text)
}

/** The scale root's pitch CLASS ("a"), not its arbitrary octave ("a5") — only the class is used. */
function pitchClassName(midi) {
  return midiToNote(midi).replace(/-?\d+$/, '')
}

function pitchBodyNote(pitch) {
  return `partials (measured over the body, ${pitch.analyzedFromSeconds.toFixed(3)}-${pitch.analyzedToSeconds.toFixed(3)}s of ${pitch.durationSeconds.toFixed(2)}s):`
}

function sampleInfoCmd(argv) {
  const json = argv.includes('--json')
  const pIdx = argv.indexOf('--partials')
  const partialCount = pIdx !== -1 ? Number(argv[pIdx + 1]) : undefined
  const positionals = argv.filter((a, i) => !a.startsWith('--') && !(pIdx !== -1 && i === pIdx + 1))
  const [file, sampleId] = positionals
  if (!file || !sampleId) throw new BeatEditError('sample-info needs <file> <sample-id> [--json] [--partials N]')
  const doc = readDoc(file)
  const { entry, channels, sampleRate } = readSampleAudio(file, doc, sampleId)
  const pitch = detectPitch(channels, sampleRate, partialCount !== undefined ? { partialCount } : {})
  const m = analyze(channels, sampleRate)
  if (json) {
    process.stdout.write(JSON.stringify({ id: sampleId, path: entry.path, pitch, metrics: m }, null, 2) + '\n')
    return
  }
  const lines = [
    `${sampleId}: ${m.durationSeconds.toFixed(2)}s, ${m.channels}ch @ ${m.sampleRate} Hz  ${entry.path}`,
    formatPitchLine(pitch),
    `peak       ${fmtDb(m.samplePeakDbfs, ' dBFS')} sample, ${fmtDb(m.truePeakDbtp, ' dBTP')} true`,
    `centroid   ${m.spectral.centroidHz.toFixed(0)} Hz`,
    '',
    pitchBodyNote(pitch),
    formatPartials(pitch.partials),
  ]
  // The table is the point (docs/phase-40-plan.md §VA item 2), so say what to look FOR in it —
  // an f0 alone leaves you stuck, and these two readings are what made the recipe-song's
  // bell_a-vs-bell_b call decidable.
  // Only PROMINENT partials (within 6 dB of the strongest, the same bar suggestedRootHz uses) can
  // audibly beat — a -25 dB straggler half a semitone off the root is not what sank bell_b, and
  // saying it is would make this advice noise.
  const beating = pitch.partials.find((q) => q.relDb >= -6 && Math.abs(1200 * Math.log2(q.ratio)) > 20 && Math.abs(1200 * Math.log2(q.ratio)) < 250)
  if (beating) {
    lines.push('', `note: two strong partials sit ${Math.abs(1200 * Math.log2(beating.ratio)).toFixed(0)} cents apart (x${beating.ratio.toFixed(3)}) — this close, they beat against each other: an unsteady, detuned ring rather than one clear pitch.`)
  }
  if (pitch.level === 'low' && pitch.suggestedRootNote) {
    lines.push(
      '',
      `LOW confidence is a real answer here, not a failure: bells, plucks and found percussion usually read low.`,
      `Read the table and decide the root yourself — then state it: beat keymap ${file} <track> ${sampleId} --scale minorPentatonic --from <note> --to <note> --root ${pitch.suggestedRootNote}`,
    )
  } else if (pitch.note) {
    lines.push('', `next: beat keymap ${file} <track> ${sampleId} --scale minorPentatonic --from <note> --to <note>`)
  }
  process.stdout.write(lines.join('\n') + '\n')
}

/** The refusal (docs/phase-40-plan.md §VA item 3): a wrong keymap is worse than none, so a
 * low-confidence detection stops here — but it must leave the user ONE copy-paste from success,
 * not with a research project. So it quotes the measured confidence, the whole partial table, and
 * the original command line with a `--root` derived from the strongest low partial appended. */
function keymapRefusal(argv, sampleId, pitch) {
  const lines = [
    `pitch detection is not confident enough to root a keymap on "${sampleId}" — refusing rather than minting six lanes of wrong tuning.`,
    '',
    formatPitchLine(pitch),
    '',
    pitchBodyNote(pitch),
    formatPartials(pitch.partials),
    '',
  ]
  if (pitch.suggestedRootNote) {
    lines.push(
      `The lowest strong partial is ${pitch.suggestedRootHz.toFixed(1)} Hz = ${pitch.suggestedRootNote}, which is usually where a struck sound's perceived pitch sits.`,
      `If the table agrees with you, state the root and re-run — this is a first-class path, not a workaround:`,
      '',
      `  beat keymap ${argv.join(' ')} --root ${pitch.suggestedRootNote}`,
      '',
    )
  }
  lines.push(`Or pass --force to build the keymap on the ${pitch.level}-confidence detection above as-is.`)
  return lines.join('\n')
}

function keymapCmd(argv) {
  const VALUE_FLAGS = new Set(['--scale', '--from', '--to', '--root', '--key', '--gain'])
  const flag = (name) => {
    const i = argv.indexOf(name)
    return i !== -1 ? argv[i + 1] : undefined
  }
  const positionals = argv.filter((a, i) => !a.startsWith('--') && !VALUE_FLAGS.has(argv[i - 1]))
  const [file, track, sampleId] = positionals
  const scale = flag('--scale')
  const from = flag('--from')
  const to = flag('--to')
  if (!file || !track || !sampleId || !scale || !from || !to) {
    throw new BeatEditError(
      'keymap needs <file> <track> <sample-id> --scale <name> --from <note> --to <note> [--root <note>] [--key <note>] [--gain dB]\n' +
      `  e.g. beat keymap song.beat bells bell_a --scale minorPentatonic --from a5 --to a6 --root a6\n` +
      `  scale names: ${SCALE_NAMES.join(', ')}`,
    )
  }
  const fromMidi = noteToMidi(from)
  const toMidi = noteToMidi(to)
  // The scale's root defaults to --from's pitch class, which is what "--from a5 --to a6 --scale
  // minorPentatonic" plainly means; --key overrides it for spans that don't start on the root.
  const scaleRootMidi = flag('--key') !== undefined ? parseKeyNote(flag('--key')) : fromMidi
  const gainDb = flag('--gain') !== undefined ? Number(flag('--gain')) : 0

  const before = readDoc(file)
  let rootMidi
  let rootSource
  const rootFlag = flag('--root')
  if (rootFlag !== undefined) {
    rootMidi = noteToMidi(rootFlag)
    rootSource = `--root ${rootFlag} (stated, not detected)`
  } else {
    const { channels, sampleRate } = readSampleAudio(file, before, sampleId)
    const pitch = detectPitch(channels, sampleRate)
    if (pitch.hz === null || (pitch.confidence < PITCH_CONFIDENCE_MEDIUM && !argv.includes('--force'))) {
      throw new BeatEditError(keymapRefusal(argv, sampleId, pitch))
    }
    rootMidi = pitch.midi
    rootSource = `detected ${pitch.hz.toFixed(1)} Hz = ${pitch.note} (${pitch.level} confidence ${pitch.confidence.toFixed(2)})`
  }

  // --dry-run runs the REAL build and simply doesn't write it. Computing the plan alone would skip
  // buildKeymap's track/sample checks, so a dry run against a typo'd track or an unregistered
  // sample printed a confident lane list for an edit that could never apply — a dry run that lies
  // about succeeding is worse than no dry run at all.
  const dryRun = argv.includes('--dry-run')
  const { doc, plan, added, rebacked } = buildKeymap(before, track, sampleId, { rootMidi, scaleRootMidi, scale, fromMidi, toMidi, gainDb })
  if (!dryRun) writeDoc(file, before, doc)
  process.stdout.write(
    `keymap${dryRun ? ' (dry run)' : ''}: ${plan.length} lane${plan.length === 1 ? '' : 's'} on ${track} backed by ${sampleId} — ${scale} in ${pitchClassName(scaleRootMidi)}, ${midiToNote(fromMidi)}..${midiToNote(toMidi)}\n` +
    `root ${midiToNote(rootMidi)}: ${rootSource}\n` +
    plan.map((l) => `  lane ${l.name} sample ${sampleId} ${formatNumber(gainDb)} ${formatNumber(l.tune)}\n`).join('') +
    (dryRun
      ? `nothing written (--dry-run) — ${added.length} lane${added.length === 1 ? '' : 's'} would be added, ${rebacked.length} re-backed\n`
      : (added.length > 0 ? `added ${added.length}: ${added.join(', ')}\n` : '') +
        (rebacked.length > 0 ? `re-backed ${rebacked.length} existing lane${rebacked.length === 1 ? '' : 's'}: ${rebacked.join(', ')}\n` : '') +
        `play it: beat add-hit ${file} ${track} ${plan[0].name} 0 0.8\n`),
  )
}

function audioPitchCmd(argv) {
  const VALUE_FLAGS = new Set(['--to', '--root', '--semitones'])
  const flag = (name) => {
    const i = argv.indexOf(name)
    return i !== -1 ? argv[i + 1] : undefined
  }
  const positionals = argv.filter((a, i) => !a.startsWith('--') && !VALUE_FLAGS.has(argv[i - 1]))
  const [file, trackId, clipId] = positionals
  const to = flag('--to')
  const semitonesFlag = flag('--semitones')
  if (!file || !trackId || !clipId || (to === undefined && semitonesFlag === undefined)) {
    throw new BeatEditError(
      'audio-pitch needs <file> <track> <clip-id> and either --to <note> (detect, then move to that note) or --semitones <n> (shift by an interval)\n' +
      '  e.g. beat audio-pitch song.beat pad padbed --to g4        (detects the region\'s pitch)\n' +
      '       beat audio-pitch song.beat pad padbed --semitones -1  (no detection — the honest option for a chord)',
    )
  }
  const before = readDoc(file)
  const track = before.tracks.find((t) => t.id === trackId)
  if (!track) throw new BeatEditError(`no track "${trackId}" (have: ${before.tracks.map((t) => t.id).join(', ') || 'none'})`)
  const clip = track.clips.find((c) => c.id === clipId)
  if (!clip) throw new BeatEditError(`no clip "${clipId}" on track "${trackId}" (have: ${track.clips.map((c) => c.id).join(', ') || 'none'})`)
  if (!clip.audio) throw new BeatEditError(`clip "${clipId}" on track "${trackId}" is not an audio-region clip — audio-pitch repitches audio regions (see beat audio-clip)`)

  let semitones
  let how
  if (semitonesFlag !== undefined) {
    semitones = Number(semitonesFlag)
    if (!Number.isFinite(semitones)) throw new BeatEditError(`--semitones must be a number, got "${semitonesFlag}"`)
    how = `--semitones ${formatNumber(semitones)} (stated — no pitch detection)`
  } else {
    const targetMidi = noteToMidi(to)
    const rootFlag = flag('--root')
    let rootMidi
    if (rootFlag !== undefined) {
      rootMidi = noteToMidi(rootFlag)
      how = `--root ${rootFlag} -> ${to} (root stated, not detected)`
    } else {
      const { channels, sampleRate } = readSampleAudio(file, before, clip.audio.media)
      // Detect over the SPAN THAT PLAYS, not the whole file — the region's in/out is the sound the
      // user is repitching, and a file can hold much more than the region uses.
      const a = Math.max(0, Math.round(clip.audio.in * sampleRate))
      const b = Math.min(channels[0].length, Math.round(clip.audio.out * sampleRate))
      const pitch = detectPitch(channels.map((ch) => ch.slice(a, b)), sampleRate)
      if (pitch.hz === null || (pitch.confidence < PITCH_CONFIDENCE_MEDIUM && !argv.includes('--force'))) {
        throw new BeatEditError(
          `pitch detection is not confident enough to repitch "${clipId}" to ${to} — refusing rather than guessing.\n\n` +
          formatPitchLine(pitch) + '\n\n' +
          pitchBodyNote(pitch) + '\n' + formatPartials(pitch.partials) + '\n\n' +
          (pitch.suggestedRootNote ? `State the region's current pitch and re-run:\n\n  beat audio-pitch ${argv.join(' ')} --root ${pitch.suggestedRootNote}\n\n` : '') +
          `A chord or a pad has no single pitch to detect — for those, shift by an interval instead:\n\n  beat audio-pitch ${file} ${trackId} ${clipId} --semitones <n>\n\n` +
          `Or pass --force to accept the ${pitch.level}-confidence detection above.`,
        )
      }
      rootMidi = pitch.midi
      how = `detected ${pitch.hz.toFixed(1)} Hz = ${pitch.note} (${pitch.level} confidence ${pitch.confidence.toFixed(2)}) -> ${to}`
    }
    semitones = targetMidi - rootMidi
  }
  const rate = rateForPitch(0, semitones)
  // warp first: setValue normalizes rate back to 1 while warp isn't 'repitch' (one canonical form
  // per state, D4), so setting rate first would be undone.
  let doc = setValue(before, `${trackId}.clip.${clipId}.audio.warp`, 'repitch')
  doc = setValue(doc, `${trackId}.clip.${clipId}.audio.rate`, String(rate))
  writeDoc(file, before, doc)
  process.stdout.write(
    `audio-pitch: ${trackId}.${clipId} warp repitch, rate ${formatNumber(rate)} (${semitones >= 0 ? '+' : ''}${formatNumber(semitones)} semitones)\n` +
    `${how}\n` +
    `repitch is variable-speed: the region now plays ${rate > 1 ? 'faster and shorter' : rate < 1 ? 'slower and longer' : 'unchanged'} — check its in/out span if the timing matters.\n`,
  )
}

// ==== end Phase 40 Stream VA ====

// v0.10 effect-chain commands (docs/phase-22-stream-aa.md). Add/remove/move change the chain's
// LIST shape/order, same reason clip/scene/song get their own commands instead of overloading
// `beat set`; bypass fits set's plain path=value grammar too (also usable as
// `beat set <file> <track>.effect.<id>.enabled <true|false>`), but gets its own friendlier verb
// here for discoverability, same as `beat lane`.
function effectAddCmd(argv) {
  const idIdx = argv.indexOf('--id')
  const id = idIdx !== -1 ? argv[idIdx + 1] : undefined
  const indexIdx = argv.indexOf('--index')
  const index = indexIdx !== -1 ? Number(argv[indexIdx + 1]) : undefined
  const bypassed = argv.includes('--bypassed')
  const positional = argv.filter((a, i) => {
    if (a.startsWith('--')) return false
    const prev = argv[i - 1]
    return prev !== '--id' && prev !== '--index'
  })
  const [file, track, type] = positional
  if (!file || !track || !type) throw new BeatEditError('effect-add needs <file> <track> <eq3|comp|distortion|bitcrush|eq7|autoFilter|autoPan|tremolo|utility|grainDelay|vinylDistortion|resonator> [--id id] [--index n] [--bypassed]')
  const before = readDoc(file)
  const { doc } = addEffect(before, track, type, { ...(id !== undefined ? { id } : {}), ...(index !== undefined ? { index } : {}), enabled: !bypassed })
  writeDoc(file, before, doc)
}

function effectRmCmd(argv) {
  const [file, track, effectId] = argv
  if (!file || !track || !effectId) throw new BeatEditError('effect-rm needs <file> <track> <effect-id>')
  const before = readDoc(file)
  const { doc } = removeEffect(before, track, effectId)
  writeDoc(file, before, doc)
}

function effectMoveCmd(argv) {
  const [file, track, effectId, index] = argv
  if (!file || !track || !effectId || index === undefined) throw new BeatEditError('effect-move needs <file> <track> <effect-id> <new-index>')
  const before = readDoc(file)
  const { doc } = moveEffect(before, track, effectId, Number(index))
  writeDoc(file, before, doc)
}

function effectBypassCmd(argv) {
  const [file, track, effectId, state] = argv
  if (!file || !track || !effectId || state === undefined) throw new BeatEditError('effect-bypass needs <file> <track> <effect-id> <true|false>')
  if (state !== 'true' && state !== 'false') throw new BeatEditError('effect-bypass state must be true or false')
  const before = readDoc(file)
  // the CLI arg is "bypassed?" (true = silence this insert); setEffectEnabled wants "enabled?" —
  // the two are inverses.
  const { doc } = setEffectEnabled(before, track, effectId, state === 'false')
  writeDoc(file, before, doc)
}

// Phase 22 Stream AE: audio-region clips (docs/phase-22-stream-ae.md). `audio-clip` creates/
// replaces a clip's region in one call (mirrors `lane`'s <sample-id> <gain> <tune> shape); trims
// after creation go through the ordinary `beat set <track>.clip.<id>.audio.<field> <value>` path
// (setValue already carries it — see edit.ts), so there's no separate "trim" subcommand.
function audioClipCmd(argv) {
  const [file, track, clip, media, inPoint, outPoint, gain, warp, rate] = argv
  if (!file || !track || !clip || !media || inPoint === undefined || outPoint === undefined) {
    throw new BeatEditError('audio-clip needs <file> <track> <clip> <media-id> <in> <out> [gain dB] [warp off|repitch|complex] [rate]')
  }
  const before = readDoc(file)
  const region = { media, in: Number(inPoint), out: Number(outPoint) }
  if (gain !== undefined) region.gainDb = Number(gain)
  if (warp !== undefined) region.warp = warp
  if (rate !== undefined) region.rate = Number(rate)
  const { doc } = addAudioClip(before, track, clip, region)
  writeDoc(file, before, doc)
}

// Split-at-point (research/16-audio-clip-editing.md §2): one pure edit, no DSP — see
// splitAudioClip in edit.ts. `at` is in fractional 16th steps from the clip's own start (the same
// unit note/hit `start` and automation `point` time already use).
function audioSplitCmd(argv) {
  const idIdx = argv.indexOf('--id')
  const newId = idIdx !== -1 ? argv[idIdx + 1] : undefined
  const positional = argv.filter((a, i) => !(idIdx !== -1 && (i === idIdx || i === idIdx + 1)))
  const [file, track, clip, at] = positional
  if (!file || !track || !clip || at === undefined) throw new BeatEditError('audio-split needs <file> <track> <clip> <at-step> [--id new-clip-id]')
  const before = readDoc(file)
  const { doc, first, second, placements } = splitAudioClip(before, track, clip, Number(at), newId !== undefined ? { newClipId: newId } : {})
  writeDoc(file, before, doc)
  process.stdout.write(`split "${clip}" into "${first.id}" and "${second.id}"\n`)
  // v0.11 (Phase 36): the split auto-places the second half right after the first in every scene
  // that placed the original (D16 q3) — say where, so the arrangement effect is never a surprise.
  for (const p of placements) process.stdout.write(`auto-placed "${p.clip}" at ${formatNumber(p.at)} in scene "${p.sceneId}"\n`)
}

function fmtDb(x, unit = '') {
  return Number.isFinite(x) ? `${x.toFixed(1)}${unit}` : String(x)
}

function metricsCmd(argv) {
  const json = argv.includes('--json')
  const profileIdx = argv.indexOf('--save-profile')
  const profilePath = profileIdx !== -1 ? argv[profileIdx + 1] : undefined
  if (profileIdx !== -1 && (!profilePath || profilePath.startsWith('--'))) {
    throw new BeatEditError('--save-profile needs a path to write, e.g. beat metrics ref.wav --save-profile ref.json')
  }
  const file = argv.find((a, i) => !a.startsWith('--') && (profileIdx === -1 || i !== profileIdx + 1))
  if (!file) throw new BeatEditError('metrics needs a wav file')
  const { channels, sampleRate } = decodeWav(readFileSync(file))
  const m = analyze(channels, sampleRate)
  if (profilePath) {
    // Phase 35 Stream OD: the measured metric set as a reusable reference profile (provenance:
    // source filename, date, tool) for `beat lint --ref`. Full-mix statics only — the profile
    // can't hear arrangement, sections, or masking.
    writeFileSync(profilePath, serializeProfile(buildProfile(m, basename(file))))
    // keep --json stdout pure JSON for machine consumers; the note goes to stderr there
    ;(json ? process.stderr : process.stdout).write(`reference profile saved to ${profilePath} (source ${basename(file)}) — compare a mix with: beat lint <mix.wav> --ref ${profilePath}\n`)
  }
  if (json) {
    // Phase 34 Stream NC: identical re-renders of the same .beat differ by up to the measured
    // amounts in RENDER_RUN_VARIANCE_META (real-time capture, phase relations shift run to run —
    // docs/render-determinism.md). Machine consumers should treat deltas inside those bounds as noise.
    process.stdout.write(JSON.stringify({ ...m, meta: RENDER_RUN_VARIANCE_META }, null, 2) + '\n')
    return
  }
  const b = m.spectral.bandsPct
  process.stdout.write(
    [
      `${file}: ${m.durationSeconds.toFixed(2)}s, ${m.channels}ch @ ${m.sampleRate} Hz`,
      `loudness   ${fmtDb(m.integratedLufs, ' LUFS')} integrated`,
      `peaks      sample ${fmtDb(m.samplePeakDbfs, ' dBFS')}, true ${fmtDb(m.truePeakDbtp, ' dBTP')}`,
      `dynamics   crest ${fmtDb(m.crestDb, ' dB')} (rms ${fmtDb(m.rmsDbfs, ' dBFS')})`,
      `spectrum   sub ${b.sub.toFixed(0)}% | bass ${b.bass.toFixed(0)}% | mids ${b.mids.toFixed(0)}% | presence ${b.presence.toFixed(0)}% | air ${b.air.toFixed(0)}%  (centroid ${m.spectral.centroidHz.toFixed(0)} Hz)`,
      m.stereo ? `stereo     correlation ${m.stereo.correlation.toFixed(3)}, width ${fmtDb(m.stereo.widthDb, ' dB')}` : 'stereo     (mono)',
    ].join('\n') + '\n',
  )
}

// Phase 33 Stream MD item 2 (research/98): `--doc <file.beat>` lets lint name the actual offending
// track in each finding's suggestion instead of a generic fix pattern. This is opt-in and only
// pays for real per-track audio (one solo render per track, via render.mjs's headless-chromium
// path — the same real engine `beat render` uses, no cheaper synthetic shortcut exists) when both
// a doc was given AND the plain mix already has at least one finding worth naming a track for.
async function lintCmd(argv) {
  const json = argv.includes('--json')
  const targetIdx = argv.indexOf('--target')
  const target = targetIdx !== -1 ? Number(argv[targetIdx + 1]) : undefined
  const docIdx = argv.indexOf('--doc')
  const docPath = docIdx !== -1 ? argv[docIdx + 1] : undefined
  // Phase 35 Stream OD: --ref <profile.json> switches the taste comparisons (loudness / bands /
  // width / crest) to deltas against a saved reference profile. One comparison frame at a time:
  // --ref and --target together is a contradiction, not a combination — error loudly.
  const refIdx = argv.indexOf('--ref')
  const refPath = refIdx !== -1 ? argv[refIdx + 1] : undefined
  if (refIdx !== -1 && (!refPath || refPath.startsWith('--'))) {
    throw new BeatEditError('--ref needs a profile path — write one with: beat metrics <ref.wav> --save-profile <ref.json>')
  }
  if (refPath !== undefined && target !== undefined) {
    throw new BeatEditError('pick one comparison frame: --ref <ref.json> (compare against a reference mix) or --target <LUFS> (absolute loudness target) — not both')
  }
  const file = argv.find(
    (a, i) =>
      !a.startsWith('--') &&
      (targetIdx === -1 || i !== targetIdx + 1) &&
      (docIdx === -1 || i !== docIdx + 1) &&
      (refIdx === -1 || i !== refIdx + 1),
  )
  if (!file) throw new BeatEditError('lint needs a wav file')
  if (refPath !== undefined && !existsSync(refPath)) {
    throw new BeatEditError(`no profile at ${refPath} — write one with: beat metrics <ref.wav> --save-profile ${refPath}`)
  }
  const { channels, sampleRate } = decodeWav(readFileSync(file))
  // Pilot 103: fix lines used to hardcode a `song.beat` placeholder that reads like a real file.
  // With --doc, they cite the actual .beat; without it, an honest `<file.beat>` placeholder.
  const lintOpts = {
    ...(docPath ? { beatPath: docPath } : {}),
    ...(refPath !== undefined ? { ref: parseProfile(readFileSync(refPath, 'utf8'), refPath) } : target !== undefined ? { targetLufs: target } : {}),
  }
  let findings = lint(analyze(channels, sampleRate), lintOpts)

  if (docPath && findings.some((f) => f.suggestion)) {
    const doc = readDoc(docPath)
    const { renderTrackSolosCommand } = await import('./render.mjs')
    const trackIds = doc.tracks.map((t) => t.id)
    const wavByTrack = await renderTrackSolosCommand(docPath, trackIds)
    const trackMetrics = trackIds.map((id) => {
      const { channels: c, sampleRate: sr } = decodeWav(wavByTrack.get(id))
      return { id, name: doc.tracks.find((t) => t.id === id)?.name, metrics: analyze(c, sr) }
    })
    findings = lint(analyze(channels, sampleRate), { ...lintOpts, trackMetrics })
  }

  process.stdout.write(json ? JSON.stringify(findings, null, 2) + '\n' : formatLint(findings))
  process.exitCode = findings.some((f) => f.level === 'warn') ? 1 : 0
  // render.mjs leaves event-loop stragglers (chromium pipes, vite) — same fix `render`'s own case
  // in main()'s switch needs. Only the --doc path touches chromium at all, so the fast/common path
  // (no --doc) exits naturally exactly as it always has.
  if (docPath) process.exit(process.exitCode ?? 0)
}

// ---- Phase 37 Stream RA begin: section-aware feedback + render --stems ----------------------
// Dynamic imports (mkdirSync/join, the section metric helpers, renderToBuffer) live inside these
// handlers rather than on the shared top-of-file import block so sibling streams RB/RC/RD editing
// the same file don't collide on the import lines.

/** `beat feedback <file>` — render the song ONCE through the real engine and turn that capture into
 * mix feedback. Default: whole-song analyze + lint in one block. With --sections: slice the render
 * at the song's section boundaries and report the per-section energy arc (LUFS / spectral balance /
 * width / crest per section + variance-padded section-to-section movement). --ref <profile.json>
 * compares each section (or the whole song) against a saved reference profile. Honest limits:
 * per-section STATIC metrics only — no masking, arrangement, or transition awareness. */
async function feedbackCmd(argv) {
  const { analyzeSections, formatSectionFeedback, formatWholeSongFeedback } = await import('../dist/src/metrics/index.js')
  const { renderToBuffer } = await import('./render.mjs')

  const json = argv.includes('--json')
  const wantSections = argv.includes('--sections')
  const refIdx = argv.indexOf('--ref')
  const refPath = refIdx !== -1 ? argv[refIdx + 1] : undefined
  if (refIdx !== -1 && (!refPath || refPath.startsWith('--'))) {
    throw new BeatEditError('--ref needs a profile path — write one with: beat metrics <ref.wav> --save-profile <ref.json>')
  }
  const file = argv.find((a, i) => !a.startsWith('--') && (refIdx === -1 || i !== refIdx + 1))
  if (!file) throw new BeatEditError('feedback needs a .beat file (it renders the file, then analyzes the render)')
  if (refPath !== undefined && !existsSync(refPath)) {
    throw new BeatEditError(`no profile at ${refPath} — write one with: beat metrics <ref.wav> --save-profile ${refPath}`)
  }
  const ref = refPath !== undefined ? parseProfile(readFileSync(refPath, 'utf8'), refPath) : undefined

  const { bytes, doc } = await renderToBuffer(file)
  const { channels, sampleRate } = decodeWav(bytes)

  if (wantSections) {
    if (!doc.song || doc.song.length === 0) {
      throw new BeatEditError(`--sections needs a song block, but ${file} is in loop mode (no sections to slice). Run whole-song feedback instead: beat feedback ${file}`)
    }
    const specs = doc.song.map((s) => ({ bars: s.bars, scene: s.scene, name: doc.scenes.find((sc) => sc.id === s.scene)?.name }))
    const secMetrics = analyzeSections(channels, sampleRate, doc.bpm, specs)
    process.stdout.write(json ? JSON.stringify({ sections: secMetrics, ...(ref ? { ref: ref.source } : {}) }, null, 2) + '\n' : formatSectionFeedback(secMetrics, ref))
  } else {
    const m = analyze(channels, sampleRate)
    const findings = lint(m, { beatPath: file, ...(ref ? { ref } : {}) })
    process.exitCode = findings.some((f) => f.level === 'warn') ? 1 : 0
    process.stdout.write(json ? JSON.stringify({ metrics: m, findings }, null, 2) + '\n' : formatWholeSongFeedback(m, findings))
  }
  process.exit(process.exitCode ?? 0) // render leaves chromium/vite event-loop stragglers — see render.mjs footer
}

/** `beat render <file> --stems [--out-dir d]` — one solo-rendered WAV per track into an out dir
 * (default stems-<basename> NEXT TO the .beat file). Reuses render.mjs's renderTrackSolosCommand
 * (one daemon/preview/browser session, one real solo capture per track). */
async function renderStemsCmd(argv) {
  const { mkdirSync } = await import('node:fs')
  const { join } = await import('node:path')
  const { renderTrackSolosCommand } = await import('./render.mjs')

  const outIdx = argv.indexOf('--out-dir')
  const outDir = outIdx !== -1 ? argv[outIdx + 1] : undefined
  if (outIdx !== -1 && (!outDir || outDir.startsWith('--'))) throw new BeatEditError('--out-dir needs a directory path')
  // Pilot 109 (LOW): --preview-port was silently ignored in stems mode (plain renders honor it),
  // breaking port-disciplined parallel automation. Parse it and pass it through.
  const portIdx = argv.indexOf('--preview-port')
  const previewPort = portIdx !== -1 ? Number(argv[portIdx + 1]) : undefined
  if (portIdx !== -1 && !Number.isFinite(previewPort)) throw new BeatEditError('--preview-port needs a port number')
  const consumed = new Set([outIdx + (outIdx !== -1 ? 1 : NaN), portIdx + (portIdx !== -1 ? 1 : NaN)])
  const file = argv.find((a, i) => !a.startsWith('--') && !consumed.has(i))
  if (!file) throw new BeatEditError('render --stems needs a .beat file')

  const doc = readDoc(file)
  const trackIds = doc.tracks.map((t) => t.id)
  if (trackIds.length === 0) throw new BeatEditError(`${file} has no tracks to render stems for`)
  const dir = outDir ?? join(dirname(resolve(file)), `stems-${basename(file).replace(/\.beat$/, '')}`)
  mkdirSync(dir, { recursive: true })

  const wavByTrack = await renderTrackSolosCommand(file, trackIds, previewPort !== undefined ? { previewPort } : {})
  for (const id of trackIds) {
    const outPath = join(dir, `${id}.wav`)
    writeFileSync(outPath, wavByTrack.get(id))
    console.error(`wrote ${outPath} (${wavByTrack.get(id).length} bytes)`)
  }
  process.stdout.write(`wrote ${trackIds.length} stem${trackIds.length === 1 ? '' : 's'} to ${dir}/ (one solo render per track: ${trackIds.join(', ')})\n`)
  process.exit(0) // render leaves chromium/vite event-loop stragglers — see render.mjs footer
}
// ---- Phase 37 Stream RA end -----------------------------------------------------------------

/** `git show rev:path` needs the path relative to the repo root, wherever we're invoked from. */
function gitShow(rev, file) {
  const abs = resolve(file)
  const dir = dirname(abs)
  try {
    const prefix = execFileSync('git', ['-C', dir, 'rev-parse', '--show-prefix'], { encoding: 'utf8' }).trim()
    return execFileSync('git', ['-C', dir, 'show', `${rev}:${prefix}${basename(abs)}`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  } catch (err) {
    const detail = (err.stderr ? String(err.stderr) : err.message).trim().split('\n')[0]
    throw new BeatEditError(`git show ${rev}:${file} failed: ${detail}`)
  }
}

function diffCmd(argv) {
  let aText, bText, label
  if (argv[0] === '--git') {
    const [, rev1, rev2, file] = argv
    if (!rev1 || !rev2 || !file) throw new BeatEditError('diff --git needs <rev1> <rev2> <file>')
    aText = gitShow(rev1, file)
    bText = gitShow(rev2, file)
    label = `${file}: ${rev1} -> ${rev2}`
  } else {
    const [a, b] = argv
    if (!a || !b) throw new BeatEditError('diff needs two files (or --git <rev1> <rev2> <file>)')
    aText = readFileSync(a, 'utf8')
    bText = readFileSync(b, 'utf8')
    label = `${a} -> ${b}`
  }
  const entries = diffDocuments(parse(aText), parse(bText))
  process.stdout.write(`# ${label}\n` + formatDiff(entries))
  process.exitCode = entries.length === 0 ? 0 : 1 // diff(1) convention
}

// ---- D3 history: checkpoint / history / restore (append-only, semantic labels) -------------
// "Versioning without git vocabulary" (docs/product-spec-desktop.md §4). Dynamically imported so
// this block stays self-contained.

async function checkpointCmd(argv) {
  const { checkpoint } = await import('../dist/src/history/index.js')
  const positional = argv.filter((a, i) => !a.startsWith('--') && !['--label', '--intent'].includes(argv[i - 1]))
  const [file] = positional
  if (!file) throw new BeatEditError('checkpoint needs <file> [--label L] [--intent I]')
  const label = flagValue(argv, '--label')
  const intent = flagValue(argv, '--intent')
  const result = checkpoint(file, { ...(label ? { label } : {}), ...(intent ? { intent } : {}) })
  if (result.skipped) process.stdout.write('no changes since the last checkpoint — nothing to save\n')
  else process.stdout.write(`checkpoint ${result.ref}  ${result.when}  ${result.label}\n`)
}

// Shared with the --collapsed view below: one checkpoint line, pin name (if any) and intent
// (if any) appended.
function formatHistoryLine(e) {
  const pin = e.pin ? `  [pin: ${e.pin}]` : ''
  const intent = e.intent ? `  (intent: ${e.intent})` : ''
  return `${e.ref}  ${e.when}  ${e.label}${pin}${intent}\n`
}

async function historyCmd(argv) {
  const { history, collapsedHistory } = await import('../dist/src/history/index.js')
  const limit = flagValue(argv, '--limit')
  const collapsed = argv.includes('--collapsed') || argv.includes('--pinned')
  const file = argv.find((a, i) => !a.startsWith('--') && argv[i - 1] !== '--limit')
  if (!file) throw new BeatEditError('history needs <file> [--limit N] [--collapsed]')
  const opts = limit !== undefined ? { limit: Number(limit) } : {}

  if (collapsed) {
    const rows = collapsedHistory(file, opts)
    if (rows.length === 0) {
      process.stdout.write('no history yet\n')
      return
    }
    for (const row of rows) {
      if (row.kind === 'collapsed') process.stdout.write(`  ... ${row.count} more checkpoint${row.count === 1 ? '' : 's'} ...\n`)
      else process.stdout.write(formatHistoryLine(row))
    }
    return
  }

  const entries = history(file, opts)
  if (entries.length === 0) {
    process.stdout.write('no history yet\n')
    return
  }
  for (const e of entries) process.stdout.write(formatHistoryLine(e))
}

async function restoreCmd(argv) {
  const { restore } = await import('../dist/src/history/index.js')
  const [file, ref] = argv
  if (!file || !ref) throw new BeatEditError('restore needs <file> <ref> (a checkpoint from `beat history`)')
  const result = restore(file, ref)
  if (result.skipped) process.stdout.write('that version is already the current one — nothing changed\n')
  else process.stdout.write(`restored — new checkpoint ${result.ref}  ${result.label}\n`)
}

async function pinCmd(argv) {
  const { pin } = await import('../dist/src/history/index.js')
  const [file, ref, ...nameParts] = argv
  const name = nameParts.join(' ')
  if (!file || !ref || !name) throw new BeatEditError('pin needs <file> <ref> <name> (a checkpoint from `beat history`, and a name up to 25 chars)')
  const result = pin(file, ref, name)
  process.stdout.write(`pinned ${result.ref} as "${result.name}"\n`)
}

async function unpinCmd(argv) {
  const { unpin } = await import('../dist/src/history/index.js')
  const [file, ...nameParts] = argv
  const name = nameParts.join(' ')
  if (!file || !name) throw new BeatEditError('unpin needs <file> <name>')
  unpin(file, name)
  process.stdout.write(`unpinned "${name}"\n`)
}

async function pinsCmd(argv) {
  const { pins } = await import('../dist/src/history/index.js')
  const [file] = argv
  if (!file) throw new BeatEditError('pins needs <file>')
  const entries = pins(file)
  if (entries.length === 0) {
    process.stdout.write('no pins yet\n')
    return
  }
  for (const p of entries) process.stdout.write(`${p.ref}  ${p.when}  ${p.name}\n`)
}

// D2 pointing protocol: the selection lives in a running daemon's memory, so this command is a
// thin HTTP client over it (parse/serialize the grammar client-side; POST/GET JSON).
async function selectionCmd(argv) {
  const portIdx = argv.indexOf('--port')
  if (portIdx === -1 || argv[portIdx + 1] === undefined) throw new BeatEditError('selection needs --port <port> (the running daemon)')
  const base = `http://127.0.0.1:${Number(argv[portIdx + 1])}`
  const fail = async (res) => {
    const msg = await res.json().then((b) => b.error).catch(() => res.statusText)
    throw new BeatEditError(`daemon rejected the selection: ${msg}`)
  }
  if (argv.includes('--clear')) {
    const res = await fetch(`${base}/selection`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    if (!res.ok) await fail(res)
    process.stdout.write('selection cleared\n')
    return
  }
  const setIdx = argv.indexOf('--set')
  if (setIdx !== -1) {
    if (argv[setIdx + 1] === undefined) throw new BeatEditError('selection --set needs a grammar string')
    const sel = parseSelection(argv[setIdx + 1])
    const res = await fetch(`${base}/selection`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(sel) })
    if (!res.ok) await fail(res)
    process.stdout.write(serializeSelection(sel))
    return
  }
  const res = await fetch(`${base}/selection`)
  if (!res.ok) await fail(res)
  const sel = await res.json()
  process.stdout.write(Object.keys(sel).length === 0 ? 'no selection\n' : serializeSelection(sel))
}

// D5's "BYO-Claude-Code fallback" (docs/product-spec-desktop.md §6): `beat mcp` already runs a
// full stdio JSON-RPC MCP server, but pointing a client at it was tribal knowledge (the right
// command, the right absolute path to this repo's beat.mjs). This writes the one-file config
// Claude Code (or any MCP client) auto-discovers on startup, so opening the project folder is
// the entire setup step.

/** The music-session CLAUDE.md scaffold `beat mcp-init` writes next to the .beat (Phase 35 OC —
 * "the agent started updating the README"): a screenful telling the helper agent it is here to
 * make music, not develop dotbeat. Exported via mcp-init only; kept as one template so tests can
 * assert the shipped text. */
function musicSessionScaffold(beatFileName) {
  return `# Music session — ${beatFileName}

You are here to MAKE MUSIC with dotbeat, not to develop dotbeat itself. Work
through the "beat" MCP tools (or the \`beat\` CLI). Never edit the dotbeat repo,
its README, or its source — the only files that should change here are this
project's .beat file, its media/, and files the beat tools write themselves.

The loop:
- After EVERY render, run metrics and lint on the wav and say in one line what
  changed musically and what the numbers did — never claim it sounds better
  without them.
- Taste decisions go through vary -> audition -> score. Pass audition
  (\`--audition\` / audition:true) to get ONE audition.wav with a timecode index
  instead of N files to juggle. Adopt a winner with beat_adopt /
  \`beat adopt <batch-dir> <pick>\`.
- Checkpoint at musical milestones ("drums locked", "rough mix"), not after
  every edit — restore is always safe and append-only.

Units, so edits land as intended:
- velocity is 0..1 (0.8, not MIDI 100)
- lane/clip gain is in dB (0 = unity, negative = quieter)
- note/hit start and duration are 16th-note steps; fractional = off-grid feel
- vary batch dirs (vary-*/) and beat-scores.jsonl live next to the .beat file

GUI interop: if the dotbeat GUI/daemon is running (default port 8420), the
user's live selection is readable — beat_selection reads it, and beat_vary
with scope "selection" plus that port varies exactly what they highlighted.
`
}

function mcpInitCmd(argv) {
  const file = argv.find((a) => !a.startsWith('--'))
  if (!file) throw new BeatEditError('mcp-init needs a <file> — the .beat project to point an MCP client at')
  if (!existsSync(file)) throw new BeatEditError(`${file} does not exist — run \`beat init ${file}\` first`)
  // Pilot 103: --force used to be all-or-nothing — refreshing a stale .mcp.json (repo moved, node
  // path changed) clobbered a user-customized CLAUDE.md along with it. The two files have
  // different owners (.mcp.json is machine-generated config; CLAUDE.md is the user's own once
  // they've touched it), so each gets its own force flag; plain --force still means both.
  const known = ['--force', '--force-config', '--force-claude']
  for (const a of argv) if (a.startsWith('--') && !known.includes(a)) throw new BeatEditError(`unknown flag "${a}" (known: ${known.join(', ')})`)
  const forceAll = argv.includes('--force')
  const forceConfig = forceAll || argv.includes('--force-config')
  const forceClaude = forceAll || argv.includes('--force-claude')
  const beatScript = new URL(import.meta.url).pathname // this file's own absolute path
  const projectDir = dirname(resolve(file))
  const configPath = resolve(projectDir, '.mcp.json')
  const claudePath = resolve(projectDir, 'CLAUDE.md')
  // Per-file granularity: each file is written if missing or its own force flag is set; an
  // existing file the caller didn't force is reported, never silently skipped. Neither file's
  // presence blocks the other from being (re)written.
  const notes = []
  let wroteAny = false
  if (!existsSync(configPath) || forceConfig) {
    const config = { mcpServers: { beat: { command: 'node', args: [beatScript, 'mcp'] } } }
    writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n')
    notes.push(`wrote ${configPath}`)
    wroteAny = true
  } else {
    notes.push(`${configPath} already exists — left untouched (--force-config regenerates just it, e.g. after this repo moves)`)
  }
  if (!existsSync(claudePath) || forceClaude) {
    writeFileSync(claudePath, musicSessionScaffold(basename(file)))
    notes.push(`wrote ${claudePath} (music-session ground rules for the agent)`)
    wroteAny = true
  } else {
    notes.push(`${claudePath} already exists — left untouched (--force-claude replaces just it with the fresh scaffold)`)
  }
  if (!wroteAny) {
    throw new BeatEditError(
      `nothing to write — both files already exist:\n` +
        `  ${configPath} (--force-config regenerates just it, e.g. after this repo moves)\n` +
        `  ${claudePath} (--force-claude replaces just it — careful, it may hold your own session notes)\n` +
        `--force overwrites both`,
    )
  }
  process.stdout.write(
    `${notes.join('\n')}\n\n` +
      `next: open ${projectDir} in Claude Code (or any MCP client that reads .mcp.json) — the\n` +
      `"beat" server is auto-discovered. Try a tool call: beat_inspect on "${basename(file)}".\n`,
  )
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2)
  // Per-command help (Phase 34 Stream NB): `beat help <cmd>` and `beat <cmd> --help`. The --help
  // form is intercepted ONLY as the first argument after the command name, so a command whose own
  // later args could be a literal "--help" is never shadowed; `beat help <unknown>` gets the
  // standard unknown-command error (exit 2), and an unknown `beat <cmd> --help` falls through to
  // the switch's own default case for the same error.
  if (cmd === 'help' && rest[0] !== undefined) {
    const text = commandHelp(rest[0])
    if (text === null) {
      console.error(`unknown command "${rest[0]}"\n\n${USAGE}`)
      process.exitCode = 2
    } else {
      console.log(text)
    }
    return
  }
  if (rest[0] === '--help') {
    const text = commandHelp(cmd)
    if (text !== null) {
      console.log(text)
      return
    }
  }
  switch (cmd) {
    case 'init':
      initCmd(rest)
      break
    case 'add-track':
      addTrackCmd(rest)
      break
    case 'rm-track':
      rmTrackCmd(rest)
      break
    case 'group':
      groupCmd(rest)
      break
    case 'rm-group':
      rmGroupCmd(rest)
      break
    case 'group-set':
      groupSetCmd(rest)
      break
    case 'inspect':
      await inspectCmd(rest)
      break
    // ==== Phase 38 Stream SB begin ====
    case 'analyze':
      await analyzeCmd(rest)
      break
    // ==== Phase 38 Stream SB end ====
    // --- Phase 37 Stream RB begin ---
    case 'analyze-structure':
      await analyzeStructureCmd(rest)
      break
    // --- Phase 37 Stream RB end ---
    case 'set':
      setCmd(rest)
      break
    case 'add-note':
      addNoteCmd(rest)
      break
    case 'rm-note':
      rmNoteCmd(rest)
      break
    case 'add-hit':
      addHitCmd(rest)
      break
    case 'rm-hit':
      rmHitCmd(rest)
      break
    case 'humanize':
      humanizeCmd(rest)
      break
    case 'quantize':
      quantizeCmd(rest)
      break
    case 'transpose':
      transposeCmd(rest)
      break
    case 'time-scale':
      timeScaleCmd(rest)
      break
    case 'fit-scale':
      fitScaleCmd(rest)
      break
    case 'invert':
      invertCmd(rest)
      break
    case 'reverse':
      reverseCmd(rest)
      break
    case 'legato':
      legatoCmd(rest)
      break
    case 'consolidate':
      consolidateCmd(rest)
      break
    case 'diff':
      diffCmd(rest)
      break
    case 'checkpoint':
      await checkpointCmd(rest)
      break
    case 'history':
      await historyCmd(rest)
      break
    case 'restore':
      await restoreCmd(rest)
      break
    case 'pin':
      await pinCmd(rest)
      break
    case 'unpin':
      await unpinCmd(rest)
      break
    case 'pins':
      await pinsCmd(rest)
      break
    case 'presets':
      presetsCmd(rest)
      break
    case 'vary':
      await varyCmd(rest)
      break
    case 'automate':
      automateCmd(rest)
      break
    // === Phase 37 Stream RC begin ===
    case 'automate-shape':
      automateShapeCmd(rest)
      break
    // === Phase 37 Stream RC end ===
    case 'clip':
      clipCmd(rest)
      break
    case 'scene':
      sceneCmd(rest)
      break
    case 'scene-set':
      sceneSetCmd(rest)
      break
    case 'place':
      placeCmd(rest)
      break
    case 'unplace':
      unplaceCmd(rest)
      break
    case 'song':
      songCmd(rest)
      break
    case 'song-move':
      songMoveCmd(rest)
      break
    case 'song-insert':
      songInsertCmd(rest)
      break
    case 'sample':
      await sampleCmd(rest)
      break
    // ==== Phase 38 Stream SA begin ====
    case 'skeleton':
      skeletonCmd(rest)
      break
    // ==== Phase 38 Stream SA end ====
    // ==== Phase 37 Stream RD begin ====
    case 'source':
      await sourceCmd(rest)
      break
    // ==== Phase 37 Stream RD end ====
    // ==== Phase 40 Stream VC ====
    case 'regen':
      await regenCmd(rest)
      break
    // ==== end Phase 40 Stream VC ====
    // ==== gen-kit ====
    case 'gen-kit':
      await genKitCmd(rest)
      break
    // ==== end gen-kit ====
    case 'lane':
      laneCmd(rest)
      break
    // ==== Phase 40 Stream VA ====
    case 'sample-info':
      sampleInfoCmd(rest)
      break
    case 'keymap':
      keymapCmd(rest)
      break
    case 'audio-pitch':
      audioPitchCmd(rest)
      break
    // ==== end Phase 40 Stream VA ====
    case 'effect-add':
      effectAddCmd(rest)
      break
    case 'effect-rm':
      effectRmCmd(rest)
      break
    case 'effect-move':
      effectMoveCmd(rest)
      break
    case 'effect-bypass':
      effectBypassCmd(rest)
      break
    case 'audio-clip':
      audioClipCmd(rest)
      break
    case 'audio-split':
      audioSplitCmd(rest)
      break
    case 'score':
      await scoreCmd(rest)
      break
    case 'adopt':
      await adoptCmd(rest)
      break
    case 'suggest':
      await suggestCmd(rest)
      break
    case 'taste-seeds':
      await tasteSeedsCmd(rest)
      break
    case 'taste-collect':
      await tasteCollectCmd(rest)
      break
    case 'showdown':
      await showdownCmd(rest)
      break
    case 'prodtask':
      await prodtaskCmd(rest)
      break
    case 'pilot':
      await pilotCmd(rest)
      break
    case 'rate': {
      const { rateCommand } = await import('./rate.mjs')
      await rateCommand(rest)
      return // the rating server runs until ctrl-c
    }
    case 'taste-eval':
      await tasteEvalCmd(rest)
      break
    case 'match': {
      const { matchCommand } = await import('./match.mjs')
      await matchCommand(rest)
      return // matchCommand process.exit()s (chromium/vite stragglers)
    }
    case 'audition':
      await auditionCmd(rest)
      break
    case 'preset':
      presetCmd(rest)
      break
    case 'macro':
      macroCmd(rest)
      break
    case 'trick':
      trickCmd(rest)
      break
    case 'drum-kits':
      drumKitsCmd(rest)
      break
    case 'drum-kit':
      drumKitCmd(rest)
      break
    case 'metrics':
      metricsCmd(rest)
      break
    case 'lint':
      await lintCmd(rest)
      break
    case 'mcp': {
      const { runMcpServer } = await import('../dist/src/mcp/server.js')
      await runMcpServer()
      return // serves stdio until stdin closes
    }
    case 'mcp-init':
      mcpInitCmd(rest)
      break
    case 'render': {
      // Phase 37 Stream RA: `--stems` renders one solo WAV per track into an out dir instead of one
      // full-mix WAV — its own handler (renderStemsCmd), which exits the process itself.
      if (rest.includes('--stems')) {
        // Pilot 109 (MEDIUM): --offline used to be silently dropped here — every stem rendered
        // via live capture with zero indication the flag was ignored. Say so out loud.
        if (rest.includes('--offline')) console.error('note: --offline is not supported with --stems yet — stems render via live capture')
        await renderStemsCmd(rest.filter((a) => a !== '--stems' && a !== '--offline'))
        break // renderStemsCmd process.exit()s; break keeps the switch well-formed
      }
      // Pilot 111 (HIGH): `beat render --batch <dir>` was advertised in help but UNREACHABLE —
      // this case always routed to renderCommand, which treats --batch's value as noise and dies
      // on the missing positional. Only vary's direct render.mjs exec ever reached batch mode.
      if (rest.includes('--batch')) {
        const { renderBatchCommand } = await import('./render.mjs')
        await renderBatchCommand(rest)
        process.exit(0) // same event-loop-straggler story as the single-render exit below
      }
      // One engine (D15): dotbeat's own (ui/src/audio/engine.ts) driven headless. `--offline` is
      // MEANINGFUL again (renderer slice 2) — same engine, computed through Tone.Offline as fast
      // as the CPU allows instead of captured off the realtime clock. (The OLD --offline was a
      // retired BeatLab path; this one shares every line of engine code with live playback.)
      const { renderCommand } = await import('./render.mjs')
      await renderCommand(rest)
      process.exit(0) // render leaves event-loop stragglers (chromium pipes, vite) — see render.mjs footer
    }
    // Phase 37 Stream RA: render once, then section-aware or whole-song mix feedback in one step.
    case 'feedback':
      await feedbackCmd(rest)
      break
    case 'daemon': {
      const { daemonCommand } = await import('./daemon.mjs')
      await daemonCommand(rest)
      return // daemon keeps running until signaled
    }
    case 'selection':
      await selectionCmd(rest)
      break
    case 'help':
    case '--help':
    case undefined:
      console.log(USAGE)
      break
    default:
      console.error(`unknown command "${cmd}"\n\n${USAGE}`)
      process.exitCode = 2
  }
}

main().catch((err) => {
  if (
    err instanceof BeatEditError ||
    err instanceof BeatParseError ||
    err instanceof BeatPresetError ||
    err instanceof BeatMacroError ||
    err instanceof BeatTrickError ||
    err instanceof BeatPitchTimeError ||
    err instanceof BeatHumanizeError ||
    err instanceof BeatProfileError ||
    err instanceof BeatAnalysisError ||
    err.name === 'HistoryError' ||
    err.name === 'WavDecodeError' ||
    err.name === 'AutomationShapeError' ||
    // gen-kit orchestrates source-lib + batch adopt + its own planning directly, so their typed
    // errors surface here (every other verb rewraps them closer to the call site).
    err.name === 'SourceError' ||
    err.name === 'BeatBatchError' ||
    err.name === 'BeatGenKitError'
  ) {
    console.error(`error: ${err.message}`)
    process.exitCode = 2
  } else {
    console.error(err.stack ?? String(err))
    process.exitCode = 2
  }
})
