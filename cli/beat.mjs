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

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
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
  ['vary', 'score', 'adopt', 'suggest'],
  ['checkpoint', 'history', 'restore', 'pin', 'unpin', 'pins'],
  ['effect-add', 'effect-rm', 'effect-move', 'effect-bypass'],
  ['clip', 'scene', 'scene-set', 'place', 'unplace', 'song', 'song-move', 'song-insert'],
  ['add-note', 'rm-note', 'add-hit', 'rm-hit'],
  ['render', 'feedback', 'metrics', 'lint'], // Phase 37 Stream RA: the render -> listen loop
  // ==== Phase 38 Stream SA begin ====
  ['analyze', 'skeleton', 'analyze-structure', 'source'], // Phase 38: audio import -> skeleton -> critique
  // ==== Phase 38 Stream SA end ====
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
  { cmd: 'drum-kits', text: `  beat drum-kits [--json]                                  list the factory drum-kit library (kit-808/kit-909/kit-acoustic)` },
  { cmd: 'drum-kit', text: `  beat drum-kit <file> <track> <name>                      apply a drum kit to a track (replaces its whole lane list)` },
  {
    cmd: 'vary',
    text: `  beat vary <file> <track> <group-or-lane> [--count 9] [--amount 0.25] [--seed N] [--out-dir d] [--render] [--audition]
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
  beat vary <file> <track> feel [--count 9] [--seed N] [--timing .15] [--velocity .06] [--push-late 0] [--swing 0] [--lanes hat,openhat | --ids a,b] [--render] [--audition]
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
                                                          is the only license ever fetched (zero redistribution risk)` },
  // ==== Phase 37 Stream RD end ====
  {
    cmd: 'lane',
    text: `  beat lane <file> <track> <lane> <sample-id|none> [gain] [tune]   back a drum lane with a sample ("none" reverts the lane
                                                          to its synth voice)
  beat lane <file> <track> --clear-legacy                 drop stale v0.5 \`lane\` sample lines from a DECLARED-lane track
                                                          (dead data there — playback reads the declarations; inspect
                                                          flags them). Errors on a legacy 5-lane track, where those
                                                          lines are live.`,
  },
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
    text: `  beat suggest <file> <track> [--target <lane-or-id>] [--log f]
                                                          read the scores log and propose the next beat-vary round
                                                          (--log defaults to beat-scores.jsonl next to the .beat);
                                                          lane-aware on declared-lane drums tracks (cold start
                                                          recommends a real lane; never recommends a group that
                                                          would be an audio no-op on that track)`,
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
                                                          offending track in each finding's suggestion`,
  },
  {
    cmd: 'render',
    text: `  beat render <file> [-o out.wav] [--tail <sec>]          render to WAV through dotbeat's own engine
                                                          (headless Chromium driving ui/; no BeatLab needed)
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
    text: `  beat mcp-init <file> [--force]                          write a .mcp.json next to <file> so Claude Code
                                                          (or any MCP client) auto-discovers 'beat mcp' there,
                                                          plus a music-session CLAUDE.md scaffold (you're making
                                                          music, not developing dotbeat; render->metrics->lint;
                                                          vary/score for taste; units) — an existing CLAUDE.md
                                                          is never overwritten without --force`,
  },
]

const USAGE = `usage:\n${HELP.map((e) => e.text).join('\n')}\n\n${PATHS_NOTE}`

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

function flagValue(argv, flag) {
  const i = argv.indexOf(flag)
  return i !== -1 ? argv[i + 1] : undefined
}

async function varyCmd(argv) {
  const { VARY_GROUPS, LEGACY_DRUM_VOICE_GROUPS, laneVaryDefs, varyTrack, BeatVaryError } = await import('../dist/src/vary/vary.js')
  const valued = ['--count', '--amount', '--seed', '--out-dir', '--timing', '--velocity', '--push-late', '--swing', '--lanes', '--ids', '--scope', '--port', '--clip', '--points', '--bars']
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
  const seed = flagValue(argv, '--seed') ? Number(flagValue(argv, '--seed')) : (Date.now() % 2147483647)
  // Default out-dir sits NEXT TO the .beat file, not under the process cwd (Phase 35 OC,
  // pilot 101 medium 4) — an explicit --out-dir still resolves exactly as written.
  const { defaultBatchDir } = await import('../dist/src/vary/batch.js')
  const outDir = flagValue(argv, '--out-dir') ?? defaultBatchDir(file, group, seed)

  const text = readFileSync(file, 'utf8')
  const doc = parse(text)
  let variants
  try {
    variants = varyTrack(doc, track, group, { count, amount, seed })
  } catch (err) {
    if (err instanceof BeatVaryError) throw new BeatEditError(err.message)
    throw err
  }

  // Manifest write + render shaping live in src/vary/batch.ts, shared with beat_vary over MCP
  // (Phase 34 Stream NA) — the manifest shape is the contract `beat score`/`beat_score` read.
  const { writeVaryBatch, renderVaryBatch } = await import('../dist/src/vary/batch.js')
  const manifest = writeVaryBatch({ parentPath: file, parentText: text, track, group, count, amount, seed, outDir, variants })
  process.stdout.write(`${outDir}/: ${variants.length} variants of ${track}.${group} (amount ${amount}, seed ${seed})\n`)
  for (let i = 0; i < variants.length; i++) {
    process.stdout.write(`  v${i + 1}: ${manifest.variants[i].edits.join(', ')}\n`)
  }

  if (argv.includes('--render') || argv.includes('--audition')) {
    // D15: the one render path is dotbeat's own engine driven headless (cli/render.mjs). It's a
    // real-time capture per variant, so a batch of N takes ~N * loop-length plus browser startup —
    // slower than the retired faster-than-realtime offline path. Correct output, honest cost; a
    // dedicated fast batch renderer for dotbeat's own engine is future work (see D15 / phase-17 doc).
    renderVaryBatch(outDir, variants.length, { onProgress: (i, n) => process.stdout.write(`rendering v${i}/${n}...\n`) })
    process.stdout.write(`rendered ${variants.length} wavs into ${outDir}/ — audition, then: beat score ${outDir} <best> [2nd 3rd]\n`)
    if (argv.includes('--audition')) await auditionAfterRender(outDir, variants.length)
  }
}

/** `--audition` (Phase 35 OC): stitch the just-rendered vN.wavs into one contact-sheet
 * audition.wav with a printed timecode index (+ audition.json) — shared by both vary rungs. */
async function auditionAfterRender(outDir, count) {
  const { stitchAudition, formatAuditionIndex } = await import('../dist/src/vary/audition.js')
  const { BeatBatchError } = await import('../dist/src/vary/batch.js')
  try {
    process.stdout.write(formatAuditionIndex(stitchAudition(outDir, count)))
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
  const { writeVaryBatch, renderVaryBatch } = await import('../dist/src/vary/batch.js')
  const manifest = writeVaryBatch({ parentPath: file, parentText: text, track, group: 'feel', count, seed, outDir, variants })
  process.stdout.write(`${outDir}/: ${variants.length} feel variants of ${track} (seed ${seed})\n`)
  for (let i = 0; i < variants.length; i++) process.stdout.write(`  v${i + 1}: ${manifest.variants[i].recipe}\n`)

  if (argv.includes('--render') || argv.includes('--audition')) {
    // D15: render through dotbeat's own engine (cli/render.mjs) — real-time per variant (see the
    // matching note in varyCmd above; a fast batch renderer for the canonical engine is future work).
    // linkMediaFrom: variant .beat files reference media relative to themselves; the parent's
    // media/ dir sits next to the parent, so batch.ts links it into the batch dir before rendering.
    renderVaryBatch(outDir, variants.length, { linkMediaFrom: file, onProgress: (i, n) => process.stdout.write(`rendering v${i}/${n}...\n`) })
    process.stdout.write(`rendered ${variants.length} wavs into ${outDir}/ — audition, then: beat score ${outDir} <best> [2nd 3rd]\n`)
    if (argv.includes('--audition')) await auditionAfterRender(outDir, variants.length)
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
  const { writeVaryBatch, renderVaryBatch } = await import('../dist/src/vary/batch.js')
  const manifest = writeVaryBatch({ parentPath: file, parentText: text, track, group: `automation:${param}`, count, seed, outDir, variants })
  process.stdout.write(`${outDir}/: ${variants.length} automation variants of ${track}.${param} (seed ${seed})\n`)
  for (let i = 0; i < variants.length; i++) process.stdout.write(`  v${i + 1}: ${manifest.variants[i].recipe}\n`)

  if (argv.includes('--render') || argv.includes('--audition')) {
    renderVaryBatch(outDir, variants.length, { linkMediaFrom: file, onProgress: (i, n) => process.stdout.write(`rendering v${i}/${n}...\n`) })
    process.stdout.write(`rendered ${variants.length} wavs into ${outDir}/ — audition, then: beat score ${outDir} <best> [2nd 3rd]\n`)
    if (argv.includes('--audition')) await auditionAfterRender(outDir, variants.length)
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

async function suggestCmd(argv) {
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
  const VALUE_FLAGS = new Set(['--max', '--dur-min', '--dur-max', '--out-dir', '--license', '--note', '--freesound'])
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
    throw new BeatEditError('source needs a subcommand: `beat source search <query>` or `beat source add <file.beat> <id> <local-audio-file>` (see `beat help source`)')
  } catch (err) {
    if (err && err.name === 'SourceError') throw new BeatEditError(err.message)
    throw err
  }
}
// ==== Phase 37 Stream RD end ====

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
  const lintOpts = refPath !== undefined ? { ref: parseProfile(readFileSync(refPath, 'utf8'), refPath) } : target !== undefined ? { targetLufs: target } : {}
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
    const findings = lint(m, ref ? { ref } : {})
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
  const file = argv.find((a, i) => !a.startsWith('--') && (outIdx === -1 || i !== outIdx + 1))
  if (!file) throw new BeatEditError('render --stems needs a .beat file')

  const doc = readDoc(file)
  const trackIds = doc.tracks.map((t) => t.id)
  if (trackIds.length === 0) throw new BeatEditError(`${file} has no tracks to render stems for`)
  const dir = outDir ?? join(dirname(resolve(file)), `stems-${basename(file).replace(/\.beat$/, '')}`)
  mkdirSync(dir, { recursive: true })

  const wavByTrack = await renderTrackSolosCommand(file, trackIds)
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
  const force = argv.includes('--force')
  const beatScript = new URL(import.meta.url).pathname // this file's own absolute path
  const projectDir = dirname(resolve(file))
  const configPath = resolve(projectDir, '.mcp.json')
  if (existsSync(configPath) && !force) throw new BeatEditError(`${configPath} already exists — pass --force to overwrite`)
  const config = { mcpServers: { beat: { command: 'node', args: [beatScript, 'mcp'] } } }
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n')
  // Phase 35 OC: also scaffold a music-session CLAUDE.md next to the project. An existing
  // CLAUDE.md is the user's own (or an earlier scaffold they may have edited) — never
  // overwritten without --force, but its presence doesn't block the .mcp.json half above.
  const claudePath = resolve(projectDir, 'CLAUDE.md')
  let claudeNote
  if (existsSync(claudePath) && !force) {
    claudeNote = `${claudePath} already exists — left untouched (--force overwrites it with the music-session scaffold)`
  } else {
    writeFileSync(claudePath, musicSessionScaffold(basename(file)))
    claudeNote = `wrote ${claudePath} (music-session ground rules for the agent)`
  }
  process.stdout.write(
    `wrote ${configPath}\n${claudeNote}\n\n` +
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
    case 'lane':
      laneCmd(rest)
      break
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
    case 'preset':
      presetCmd(rest)
      break
    case 'macro':
      macroCmd(rest)
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
        await renderStemsCmd(rest.filter((a) => a !== '--stems'))
        break // renderStemsCmd process.exit()s; break keeps the switch well-formed
      }
      // One render path now (D15): dotbeat's own engine (ui/src/audio/engine.ts) driven headless.
      // The retired `--offline` flag (BeatLab-dependent, broken in this environment) is accepted
      // and ignored so old invocations don't hard-error — the real engine is dotbeat's own either way.
      const { renderCommand } = await import('./render.mjs')
      await renderCommand(rest.filter((a) => a !== '--offline'))
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
    err instanceof BeatPitchTimeError ||
    err instanceof BeatHumanizeError ||
    err instanceof BeatProfileError ||
    err instanceof BeatAnalysisError ||
    err.name === 'HistoryError' ||
    err.name === 'WavDecodeError' ||
    err.name === 'AutomationShapeError'
  ) {
    console.error(`error: ${err.message}`)
    process.exitCode = 2
  } else {
    console.error(err.stack ?? String(err))
    process.exitCode = 2
  }
})
