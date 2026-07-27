import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useStore, isEffectivelyMuted } from '../state/store'
import { engine } from '../audio/engine'
import { postEdit, postSelection, postAutomation, postAddTrack, postRemoveTrack, postGroupOp, postAudioSplit, postClipMove, postClipRemove, postClipDuplicate, daemonBase, type AddTrackOpts } from '../daemon/bridge'
import { isTauri, openProjectFolder } from '../daemon/tauri'
import { applyPresetToTrack, installKitLane, installSoundfont, installAudioClip, readDragPayload, LIBRARY_DND_MIME } from '../daemon/library'
import { useDropTarget } from '../dragDrop'
import { audioRegionTimelineSteps, declaredLaneNames, firstPlacementClip, sortPlacements, type AutomationInterpolation, type BeatAutomationPoint, type BeatDocument, type BeatGroup, type BeatTrack, type TrackKind } from '../types'
import { PARAM_GROUPS, type ParamSpec } from './synthParams'
import { showToast } from '../state/toastStore'
import { ContextMenu, type ContextMenuItem } from './ContextMenu'
import { formatClock } from './TransportBar'

// Phase 20 Stream W — track add/delete/rename/recolor + project-folder controls. There is no BeatLab
// component to port these from (BeatLab's tracks are lesson-defined; its store has no track
// add/remove/rename/color action — verified by direct source read), so the UI is built fresh here,
// reusing BeatLab's UI *patterns*: the controlled inline `<input>` edit (its TrackLab section-note
// field), the `style={{ background: color }}` swatch (its TrackStrip track-dot), and a header delete
// button (its SceneLauncher scene-del). Rename/color write the existing `<track>.name`/`<track>.color`
// setValue paths via postEdit; add/remove go through the new /add-track /remove-track daemon routes
// (postAddTrack/postRemoveTrack) wrapping core's addTrack/removeTrack.
// The kinds the GUI can CREATE — deliberately a subset of TrackKind, not a mirror of core's
// TRACK_KINDS. 'surge' is absent because a surge track is defined by its patch name (BeatSurge.patch)
// and the GUI has no patch-selection surface at all, so an added one would be unconfigurable here —
// the same honesty as the instrument case below, which refuses when no SoundFont sample is
// registered. Surge tracks are created with `beat track add --kind surge`; the GUI RENDERS them
// (see AUTO_OPTIONS_BY_KIND.surge). Widen this only alongside a real patch picker.
const TRACK_KINDS: readonly AddTrackOpts['kind'][] = ['synth', 'drums', 'instrument', 'audio']

// ── Arrangement length (Phase 19 Stream V) ───────────────────────────────────────────────────────
// Two length surfaces, matching the two document modes. Loop mode (doc.song === null) is a single
// region sized by loop_bars — changed through the ordinary optimistic {path,value} /edit path
// (postEdit), like every other one-line edit. Song mode's timeline IS the section list, which /edit
// can't express as one line — appending/deleting/resizing a section is a whole-list setSong
// statement — so those go through the daemon's additive POST /song route, then re-pull the
// authoritative document (the daemon doesn't broadcast its own writes; see bridge.ts's /edit note).
const LOOP_MIN = 1
const LOOP_MAX = 64
const clampBars = (n: number, lo = LOOP_MIN, hi = LOOP_MAX) => Math.max(lo, Math.min(hi, Math.round(n)))

// Phase 24 Stream CE: how much raw pointer movement (px) still counts as a "click" on the ruler
// rather than a drag-to-select gesture — see the click-to-seek effect below.
const CLICK_MOVE_PX = 4

/** Change loop-mode length via the already-supported `loop_bars` edit path (optimistic + debounced;
 * one canonical line on disk). */
function changeLoopBars(next: number): void {
  postEdit('loop_bars', String(clampBars(next)))
}

// ── Overlapping-region resolution policy (Phase 22 Stream AG) ───────────────────────────────────
// docs/research/22-opendaw-editing-workflow.md §2.1: openDAW ships a user-configurable overlap
// policy for what happens when a resized region would overlap its neighbor. dotbeat's song
// timeline is a flat ordered list of section durations (no independently-positioned regions), so
// the only place growth genuinely "conflicts" with something is resizing a NON-LAST section
// larger — see src/daemon/daemon.ts's songResize for the full reasoning and the authoritative,
// server-side implementation (this is a GUI-side FAITHFUL MIRROR of it, same "local mirror for an
// instant live preview" discipline bridge.ts's applyLocalEdit already uses for /edit — keep the two
// in lockstep). A GUI editing preference (like openDAW's own Preferences->Editing setting), not
// project content, so it lives in the Zustand store (state/store.ts's overlapPolicy), not the file.
export type OverlapPolicy = 'clip' | 'push-existing' | 'keep-existing'
export const OVERLAP_POLICIES: readonly OverlapPolicy[] = ['clip', 'push-existing', 'keep-existing']

/** Mirrors daemon.ts's songResize on the derived Section[] shape (startBar included), so the live
 * drag preview shows exactly what committing the drag would produce under the chosen policy —
 * not just a generic "shift everything" preview regardless of the selected policy. */
function previewResizeSections(sections: Section[], index: number, bars: number, policy: OverlapPolicy): Section[] {
  const cur = sections[index]!
  const delta = bars - cur.bars
  const isLast = index === sections.length - 1
  const nextBars = sections.map((s) => s.bars)
  if (delta <= 0 || isLast || policy === 'push-existing') {
    nextBars[index] = bars
  } else if (policy === 'clip') {
    const next = sections[index + 1]!
    const give = Math.min(delta, next.bars - 1)
    nextBars[index] = cur.bars + give
    nextBars[index + 1] = next.bars - give
  }
  // 'keep-existing': growth into a non-last section is refused — nextBars stays untouched.
  let bar = 0
  return sections.map((s, i) => {
    const b = nextBars[i]!
    const out = { scene: s.scene, bars: b, startBar: bar }
    bar += b
    return out
  })
}

/** Issue one arrangement-length op to the daemon's /song route, then re-pull /document so the UI
 * reflects the new sections/scenes/clips (the daemon doesn't echo its own writes). Phase 24 Stream
 * CB adds 'move' (reorder a section — {from, to}), same route, same op-dispatch shape as append/
 * resize/delete. Phase 26 Stream DJ adds 'insert' (a brand-new EMPTY scene spliced in at `index`)
 * and 'captureInsert' (a brand-new scene pre-populated by snapshotting every track's current live
 * content, same position) — unlike 'append', neither ever reuses an existing scene id, so the
 * resulting section starts genuinely independent rather than sharing state with a sibling. Phase 32
 * Stream LB adds 'renameScene' ({id, name}) — sets or (name omitted/undefined) clears a scene's
 * display name; named on the scene (not the section), so it travels with every section that
 * reuses it, same op-dispatch shape as the rest. */
async function postSong(body: {
  op: 'append' | 'resize' | 'delete' | 'move' | 'insert' | 'captureInsert' | 'renameScene'
  index?: number
  bars?: number
  policy?: OverlapPolicy
  from?: number
  to?: number
  id?: string
  name?: string
}): Promise<void> {
  const base = daemonBase()
  try {
    const res = await fetch(`${base}/song`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      console.warn(`[daw] POST /song ${body.op}: HTTP ${res.status}`, await res.text().catch(() => ''))
      return
    }
    const docRes = await fetch(`${base}/document`)
    if (docRes.ok) useStore.getState().setDoc((await docRes.json()) as BeatDocument)
  } catch (err) {
    console.warn('[daw] could not POST /song:', err)
  }
}

// The arrangement / song view (D4, product-spec-desktop §5). Tracks as rows, bars as columns,
// real scenes/clips/section boundaries from the document's song arrangement. Canvas-rendered, one
// <canvas> per track row (docs/phase-11-song-view.md's validated approach: DOM/SVG node count
// scales with total notes, canvas draw calls scale with events actually drawn — the right cost
// model for a dense, zoomed-out timeline). Below a px/bar threshold each bar collapses to one
// opacity-encoded density block; above it, real note/hit ticks render — the audio-waveform
// min/max-per-pixel LOD idea generalized to notes. Nothing here updates per-frame, so canvases
// redraw on data/selection/size change (no rAF loop needed — matches Scope.tsx's convention but
// without the animation loop).

const ROW_H = 56 // taller than the pre-Phase-18 44px: the header now stacks a name row + an inline mixer strip
const HEADER_W = 264 // wide enough for the inline channel strip (mute/solo/volume/pan/sends) in the track header
const TICK_ROW_H = 13 // Phase 24 Stream CD: bar-number tick strip along the bottom of the ruler
// Phase 41 Stream D: a locator strip along the TOP of the ruler, above the section-label row. The
// ruler is now three stacked strips — locators (this), section labels (26px), bar ticks — and every
// consumer positions from these constants, so growing the ruler here automatically pushes the
// playhead's `top: RULER_H` and the track rows below it without a second edit.
// Minimum px between consecutive LABELLED bar ticks before the ruler also prints a wall-clock
// figure beside the bar number (Phase 41 Stream D). Below this the two labels collide.
// 56px: measured, not guessed — at the ruler's 9px type a 3-digit bar number plus a m:ss
// clock plus the 4px gap needs ~52px, and 64 (the first guess) suppressed the labels entirely at
// the very zoom the verify script exercises (2-bar tick interval * 31.9px/bar = 63.8px).
const TICK_CLOCK_MIN_PX = 56
// Below this many px to the NEXT marker, a locator flag drops its label and shows only its pin —
// see the `compact` computation in the locator strip for why (overlapping names render as mush).
const LOCATOR_LABEL_MIN_PX = 48
const LOCATOR_ROW_H = 16
const SECTION_LABEL_H = 26
const RULER_H = LOCATOR_ROW_H + SECTION_LABEL_H + TICK_ROW_H
const DETAIL_PX_PER_BAR = 32 // at or above this, draw real ticks; below, density blocks
const DENSITY_REF = 6 // events/bar that reads as full-opacity (soft normalization, not a hard cap)

// ── Timeline zoom (Phase 24 Stream CD) ───────────────────────────────────────────────────────────
// pxPerBar used to be nothing but laneWidth / totalBars — always fit-to-container-width, no
// independent zoom, and no horizontal scroll (the timeline could never be wider than its container).
// Zoom decouples the two: `null` means "fit to width" (today's behavior, and still the default); a
// number pins pxPerBar regardless of container width. `.arr-scroll` already has `overflow: auto`
// (previously exercised only by the Phase 22 Stream AG resize-drag live preview — see the render*
// comment further down), so once pxPerBar * totalBars exceeds laneWidth the container just scrolls;
// no new scroll plumbing is needed, only decoupling pxPerBar from laneWidth. Session-only UI state —
// never written to the .beat file, same treatment as mute/solo and group-collapse — so it lives in
// local component state below, not the document or even the Zustand store.
const MIN_PX_PER_BAR = 4
const MAX_PX_PER_BAR = 256
const ZOOM_FACTOR = 1.4 // per zoom-in/out step (button click or one wheel-zoom tick)

// ── Follow-the-playhead (Phase 41 Stream D) ──────────────────────────────────────────────────────
// How close to a viewport edge the playhead may get before the view pages forward, and where in the
// lane viewport it lands after that page (0 = hard left, 0.5 = centred). A third of the way in keeps
// the bar you just played visible for context while leaving most of the screen as lookahead.
const FOLLOW_MARGIN_PX = 24
const FOLLOW_ANCHOR = 1 / 3

/** Bar-tick label density for the ruler, zoom-aware in the same spirit DETAIL_PX_PER_BAR already
 * applies to note/hit rendering: once there's a full DETAIL_PX_PER_BAR worth of room per bar, number
 * every bar; below that, skip bars (in powers of two) so the numbers never overlap. */
function tickIntervalFor(pxPerBar: number): number {
  if (pxPerBar >= DETAIL_PX_PER_BAR) return 1
  if (pxPerBar >= DETAIL_PX_PER_BAR / 2) return 2
  if (pxPerBar >= DETAIL_PX_PER_BAR / 4) return 4
  if (pxPerBar >= DETAIL_PX_PER_BAR / 8) return 8
  return 16
}
const GROUP_HEADER_H = 34 // Phase 22 Stream AF: one collapsible fold-header row per track group
// Loop mode's synthetic single-section sentinel scene name (see the `sections` useMemo below) —
// shared so any code that needs to tell "a real song-mode scene" apart from "there is no song at
// all" (Phase 23 Stream BC's drag-to-create-audio-clip: it can only auto-slot into a real scene)
// reads the same literal rather than re-typing the magic string.
const LOOP_SCENE_SENTINEL = '(loop)'

// ── Inline channel-strip helpers (Phase 18): the arrangement track header carries a compact subset
// of the full mixer, reusing MixerView's exact data-flow — volume/pan write `<id>.volume`/`<id>.pan`
// (one-line diffs) and mute/solo drive the SAME store flags the engine reads per-tick to gate audio
// (isEffectivelyMuted, Phase 14 Stream E). These four tiny formatters mirror MixerView's (kept local
// so MixerView stays untouched — it remains the full-strip overlay). ──────────────────────────────
const VOL_MIN = -60
const VOL_MAX = 6
function trackVolume(t: BeatTrack): number {
  return t.kind === 'instrument' && t.instrument ? t.instrument.volume : t.synth.volume
}
function trackPan(t: BeatTrack): number {
  return t.kind === 'instrument' && t.instrument ? t.instrument.pan : t.synth.pan
}
const fmtDb = (v: number) => (v <= VOL_MIN ? '-∞' : `${v > 0 ? '+' : ''}${v.toFixed(1)}`)
const fmtPan = (v: number) => (Math.abs(v) < 0.02 ? 'C' : v < 0 ? `L${Math.round(-v * 100)}` : `R${Math.round(v * 100)}`)

// Built-in sends (research 18: dotbeat's fixed reverb/delay/mod buses, not arbitrary return tracks).
// Shown as glanceable badges for the sends that are actually dialed in — the same "read the real
// synth-block field" approach MixerView's FxBadges uses. Instrument tracks carry a synth block the
// engine ignores for playback, so (like FxBadges) we don't show sends there.
const SEND_KEYS: { key: string; label: string }[] = [
  { key: 'sendReverb', label: 'Rv' },
  { key: 'sendDelay', label: 'Dl' },
]

/** The compact inline channel strip embedded in each arrangement track header. Subscribes to the
 * store's mute/solo flags (so it reflects and drives the real audio gate) and writes volume/pan via
 * the same edit path the full MixerView uses. */
function InlineStrip({ track }: { track: BeatTrack }) {
  const muted = useStore((s) => !!s.mutes[track.id])
  const soloed = useStore((s) => !!s.solos[track.id])
  const toggleMute = useStore((s) => s.toggleMute)
  const toggleSolo = useStore((s) => s.toggleSolo)

  const vol = trackVolume(track)
  const pan = trackPan(track)
  const sends = track.kind === 'instrument' ? [] : SEND_KEYS.filter((s) => Number(track.synth[s.key] ?? 0) > 0)

  return (
    <div className="arr-strip">
      <button
        className={`arr-strip-btn mute ${muted ? 'on' : ''}`}
        onClick={() => toggleMute(track.id)}
        title="mute (session-only, gates real audio)"
        data-mute={track.id}
      >
        M
      </button>
      <button
        className={`arr-strip-btn solo ${soloed ? 'on' : ''}`}
        onClick={() => toggleSolo(track.id)}
        title="solo (session-only, gates real audio)"
        data-solo={track.id}
      >
        S
      </button>
      <label className="arr-strip-vol" title={`volume ${fmtDb(vol)} dB`}>
        <input
          type="range"
          min={VOL_MIN}
          max={VOL_MAX}
          step={0.1}
          value={vol}
          data-vol={track.id}
          onChange={(e) => postEdit(`${track.id}.volume`, e.target.value)}
        />
        <span className="arr-strip-db">{fmtDb(vol)}</span>
      </label>
      <label className="arr-strip-pan" title={`pan ${fmtPan(pan)}`}>
        <input
          type="range"
          min={-1}
          max={1}
          step={0.01}
          value={pan}
          data-pan={track.id}
          onChange={(e) => postEdit(`${track.id}.pan`, e.target.value)}
        />
        <span className="arr-strip-panval">{fmtPan(pan)}</span>
      </label>
      <span className="arr-strip-sends" title="active built-in sends (reverb / delay / mod)">
        {sends.map((s) => (
          <span key={s.key} className="arr-send-badge">
            {s.label}
          </span>
        ))}
      </span>
    </div>
  )
}

// ── Automation lanes (Phase 20 Stream Z) ─────────────────────────────────────────────────────────
// Per-track parameter picker + inline draggable breakpoint curve, over dotbeat's v0.9 clip
// automation (BeatAutomationLane). Automation is CLIP-SCOPED and only plays in song mode (the engine
// returns an empty automation map in loop mode — ui/src/audio/engine.ts contentFor), so the picker
// is only offered when a track's clip actually plays in a scene. Each shown param renders as its own
// dedicated sub-lane below the track row — research 18 §7's "move an envelope into its own dedicated
// lane below the clip … a track can show many parameter lanes stacked at once", the multi-lane
// presentation that fits the +/- picker (the same-row red-line overlay is the single-lane alternate,
// deferred). Curve drags redraw the canvas imperatively and POST only on pointer-up (research 15 §2:
// no React state / no network per pointer move); the write goes through the daemon's /automate route
// wrapping the SAME core setAutomationPoint/removeAutomationPoint `beat automate` uses.
const AUTO_H = 46 // height of one automation sub-lane
const AUTO_PAD = 6 // vertical inset for the curve inside a sub-lane
const PICKER_H = 30 // height of the expanded add-a-lane strip
const MARKER_HIT = 8 // px radius to grab a breakpoint
const SEGMENT_HIT = 6 // px distance to grab a segment (Phase 26 Stream DI: alt/option-drag-to-bow)

/** Every knob param, keyed — the value ranges (min/max) that map a raw automation value to the
 * sub-lane's y-axis. Reuses synthParams.ts's declarative table (the same one SynthPanel renders),
 * so a param's automation y-range always matches its knob range. Knob params are exactly the
 * numeric fields, i.e. the automatable set (AUTOMATABLE_SYNTH_PARAMS excludes only enums/bools). */
const SPEC_BY_KEY: Map<string, ParamSpec> = new Map()
for (const g of PARAM_GROUPS) for (const p of g.params) if (p.kind === 'knob') SPEC_BY_KEY.set(p.key, p)

/** The automatable params offered for a track kind, in synthParams group order. Phase 22 Stream
 * AE: 'audio' tracks aren't in synthParams.ts's PARAM_GROUPS table at all (they carry no synth
 * block) — their one automatable param is the clip's own 'gain' (AUDIO_AUTOMATABLE_PARAMS in
 * document.ts), so it's listed directly rather than derived from the loop below. */
const AUTO_OPTIONS_BY_KIND: Record<TrackKind, { key: string; label: string }[]> = {
  synth: [],
  drums: [],
  instrument: [],
  audio: [{ key: 'gain', label: 'Clip Gain' }],
  surge: [],
}
for (const g of PARAM_GROUPS) {
  for (const kind of g.kinds) {
    for (const p of g.params) {
      if (p.kind === 'knob' && !AUTO_OPTIONS_BY_KIND[kind].some((o) => o.key === p.key)) {
        AUTO_OPTIONS_BY_KIND[kind].push({ key: p.key, label: p.label })
      }
    }
  }
}
// A surge track carries a FULL synth block alongside its `surge` block — document.ts:961, "present
// iff kind === 'surge' (the synth block is ALSO present, as production)". That block is the
// surgeplus hosting layer's production stage (filter/env/effects/sends applied to the sidecar's
// rendered audio), so every param automatable on a synth track is automatable here too. It can't
// come from the loop above: synthParams.ts's ParamGroup.kinds is its own narrower 3-kind TrackKind
// ('synth'|'drums'|'instrument') and no group declares 'surge'. Mirroring synth's list is the
// honest answer — not `[]`, which would silently deny surge tracks automation they support.
AUTO_OPTIONS_BY_KIND.surge = AUTO_OPTIONS_BY_KIND.synth.map((o) => ({ ...o }))

/** Every read of AUTO_OPTIONS_BY_KIND goes through here. `track.kind` is whatever the daemon's
 * JSON says — core's TrackKind, not necessarily this file's — so a kind added to core before the
 * GUI mirrors it (research 137 §2.3: exactly what 'surge' did) must degrade to "no automatable
 * params" rather than throwing a TypeError that takes the whole arrangement render down. The
 * parity test makes the mirror drift loud; this keeps the failure mode soft in the meantime. */
function autoOptionsFor(kind: string): { key: string; label: string }[] {
  return AUTO_OPTIONS_BY_KIND[kind as TrackKind] ?? []
}

// Phase 22 Stream AE: 'gain' isn't a synth field (it's not in PARAM_GROUPS/SPEC_BY_KEY at all —
// it only exists on audio-track clips, AUDIO_AUTOMATABLE_PARAMS in document.ts), so it needs its
// own range here rather than falling through to the generic 0..1 default — a clip gain automation
// point is a dB value, same shape as the synth volume field's range.
function specFor(param: string): ParamSpec {
  if (param === 'gain') return { key: 'gain', label: 'Clip Gain', kind: 'knob', min: -60, max: 6, format: (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(1)}` }
  return SPEC_BY_KEY.get(param) ?? { key: param, label: param, kind: 'knob', min: 0, max: 1, format: (v: number) => v.toFixed(2) }
}
function laneLabel(track: BeatTrack, param: string): string {
  const spec = specFor(param)
  if (param === 'volume') return 'Track Vol'
  if (param === 'pan') return 'Track Pan'
  if (param === 'gain') return 'Clip Gain'
  return `${track.name} / ${spec.label}`
}

/** Where a track's automatable clip actually plays, in song-time. [] in loop mode (no clip-scoped
 * playback). The picker targets the FIRST occurrence's clip (v1: one editable clip per track —
 * multi-clip automation deferred).
 *
 * v0.11 (Phase 36 PD): occurrences are PLACEMENT-granular. A non-audio track still gets exactly
 * one occurrence per section that maps it to an existing clip, spanning the whole section (a
 * synth/drum clip tiles from the section start — the D16 scope guard makes that the only legal
 * shape). An AUDIO track gets one occurrence PER PLACEMENT: `at` is the placement's own offset,
 * `startStep`/`lengthSteps` are the block's real timeline extent (placement start to the region's
 * timeline length, truncated at the section end — the same extent the engine actually sounds). */
interface ClipOccurrence {
  clipId: string
  startBar: number
  bars: number
  /** Phase 24 Stream CC: this occurrence's index into the `sections`/`doc.song` array — the move/
   * remove/duplicate primitives' section-addressing unit. */
  sectionIndex: number
  /** v0.11: this occurrence's placement offset within its section, in fractional 16th steps (0 for
   * every non-audio occurrence and every pre-v0.11 document). Part of the occurrence's identity —
   * occKey folds it in, and the daemon's placement-granular ops take it as `at`. */
  at: number
  /** Absolute song-timeline start of the BLOCK, in steps: sectionStart*16 + at. */
  startStep: number
  /** The block's rendered length in steps: the audio region's timeline length truncated at the
   * section end; a full section (bars*16) for non-audio occurrences. */
  lengthSteps: number
}
function trackOccurrences(track: BeatTrack, sections: Section[], doc: BeatDocument): ClipOccurrence[] {
  if (!doc.song) return []
  const out: ClipOccurrence[] = []
  sections.forEach((s, sectionIndex) => {
    const scene = doc.scenes.find((sc) => sc.id === s.scene)
    if (!scene) return
    const sectionStartStep = s.startBar * 16
    const sectionSteps = s.bars * 16
    if (track.kind === 'audio') {
      // One occurrence per placement (v0.11), x/width proportional to `at` and the region's own
      // timeline length — blocks sit where the audio actually sounds, not "the whole section."
      for (const p of sortPlacements(scene.slots[track.id] ?? [])) {
        const clip = track.clips.find((c) => c.id === p.clip)
        if (!clip?.audio) continue
        if (p.at >= sectionSteps) continue // placed past this section's end — nothing audible to draw
        const lengthSteps = Math.min(audioRegionTimelineSteps(clip.audio, doc.bpm), sectionSteps - p.at)
        out.push({ clipId: p.clip, startBar: s.startBar, bars: s.bars, sectionIndex, at: p.at, startStep: sectionStartStep + p.at, lengthSteps })
      }
      return
    }
    const clipId = firstPlacementClip(scene.slots, track.id) // non-audio: single placement at 0 by validation
    if (!clipId) return
    if (!track.clips.find((c) => c.id === clipId)) return
    out.push({ clipId, startBar: s.startBar, bars: s.bars, sectionIndex, at: 0, startStep: sectionStartStep, lengthSteps: sectionSteps })
  })
  return out
}

/** Phase 24 Stream CC: a stable string key for one occurrence — the unit both the marquee
 * selection Set and the clip-move batch address. v0.11 (Phase 36 PD): a placement at `at > 0`
 * appends its offset (`track::section::at`); the at-0 key keeps the original two-part form so
 * every pre-existing selector/verify script (`[data-clip-block="lead::0"]`) still matches — and
 * the two forms can't collide, since one track can't place two clips at the same `at` (overlap
 * validation). */
function occKey(trackId: string, sectionIndex: number, at: number): string {
  return at === 0 ? `${trackId}::${sectionIndex}` : `${trackId}::${sectionIndex}::${at}`
}

/** Phase 29 Stream GA: a deterministic small color for a scene id, used ONLY as the "these sections
 * share a scene" badge (sceneShareCounts above) — never track.color, no palette to maintain, no
 * meaning beyond "same color = same scene id." A cheap string hash is plenty; collisions between
 * two DIFFERENT scene ids landing on a similar hue are a cosmetic non-issue (the badge only shows up
 * when a scene is shared, and the tooltip always names the scene explicitly too). */
function sceneLinkColor(sceneId: string): string {
  let h = 0
  for (let i = 0; i < sceneId.length; i++) h = (h * 31 + sceneId.charCodeAt(i)) >>> 0
  return `hsl(${h % 360}, 65%, 55%)`
}

/** The section whose startBar is closest to `targetStartBar` — how a drag's continuous bar delta
 * snaps to the section grid a clip occurrence can actually live on (occurrences are 1:1 with
 * sections; there is no in-between bar position to land on). */
function nearestSectionIndex(sections: Section[], targetStartBar: number): number {
  let best = 0
  let bestDist = Infinity
  for (let i = 0; i < sections.length; i++) {
    const d = Math.abs(sections[i]!.startBar - targetStartBar)
    if (d < bestDist) {
      bestDist = d
      best = i
    }
  }
  return best
}

const NO_POINTS: BeatAutomationPoint[] = []

type FlatNote = { start: number; duration: number; pitch: number } // start/duration in 16th steps, absolute over the song
type FlatHit = { start: number; lane: string }
interface TrackFlat {
  track: BeatTrack
  notes: FlatNote[]
  hits: FlatHit[]
  pitchMin: number
  pitchMax: number
}
interface Section {
  scene: string
  bars: number
  startBar: number
}

/** Round a clip's content up to a whole number of bars (min one), so tiling a clip across a
 * longer section lands on bar boundaries — matches how the clip actually loops within a section. */
function clipStepLen(maxEnd: number): number {
  return Math.max(16, Math.ceil(maxEnd / 16) * 16)
}

/** Phase 24 Stream CJ: tile `off` across one section at period `len`, but when `clipLoop` is set,
 * restrict to events whose own (clip-local) `start` falls within [loop.start*16, loop.end*16) and
 * tile at THAT period instead — mirrors engine.ts's contentOf's exact same clip.loop interpretation
 * (loopStartSteps/loopSteps, first occurrence at `start - loopStartSteps`), so the arrangement's
 * visual note/hit density matches what actually plays once a clip has its own loop override. `len`
 * is only used in the no-override branch (today's content-max-extent tiling, unchanged). */
function tileOffsets(clipLoop: { start: number; end: number } | null, len: number, sectionSteps: number, eventStart: number): number[] {
  if (!clipLoop) {
    const offs: number[] = []
    for (let off = 0; off < sectionSteps; off += len) offs.push(off)
    return offs
  }
  const loopStartSteps = clipLoop.start * 16
  const loopSteps = Math.max(16, (clipLoop.end - clipLoop.start) * 16)
  if (eventStart < loopStartSteps || eventStart >= loopStartSteps + loopSteps) return [] // outside the loop window — never plays
  const offs: number[] = []
  for (let off = eventStart - loopStartSteps; off < sectionSteps; off += loopSteps) offs.push(off)
  return offs
}

/** Flatten one track's playable content across the whole song timeline into absolute-step events.
 * Song mode: each section's scene maps this track to a clip (or not — an unmapped track is silent
 * in that section); the clip's events tile across the section's bars — at the clip's OWN `loop`
 * range when it has one (Phase 24 Stream CJ), else at today's content-max-extent tiling (unchanged).
 * Loop mode (no song block): the track's live notes/hits play across loop_bars as a single section
 * (no clip, so no clip.loop — unaffected by this stream). */
function flattenTrack(track: BeatTrack, sections: Section[], doc: BeatDocument): TrackFlat {
  const notes: FlatNote[] = []
  const hits: FlatHit[] = []

  for (const section of sections) {
    const sectionStartStep = section.startBar * 16
    const sectionSteps = section.bars * 16
    const sectionEndStep = sectionStartStep + sectionSteps

    // Resolve this section's content for this track.
    let srcNotes = track.notes
    let srcHits = track.hits
    let clipLoop: { start: number; end: number } | null = null
    if (doc.song) {
      const scene = doc.scenes.find((s) => s.id === section.scene)
      // The at-0/first placement's clip is exact here: this flattener only produces note/hit
      // ticks, and note/hit-bearing (non-audio) tracks are single-placement-at-0 by v0.11's own
      // validation (D16 scope guard). Audio tracks carry no notes/hits — their per-placement
      // rendering is the canvas fill + block overlay in TrackRow, driven by trackOccurrences.
      const clipId = scene ? firstPlacementClip(scene.slots, track.id) : undefined
      if (!clipId) continue // track not in this scene → silent this section
      const clip = track.clips.find((c) => c.id === clipId)
      if (!clip) continue
      srcNotes = clip.notes
      srcHits = clip.hits
      clipLoop = clip.loop ?? null
    }

    if (track.kind === 'drums') {
      const maxEnd = srcHits.reduce((m, h) => Math.max(m, h.start + 1), 0)
      const len = clipStepLen(maxEnd)
      for (const h of srcHits) {
        for (const off of tileOffsets(clipLoop, len, sectionSteps, h.start)) {
          const abs = sectionStartStep + off
          if (abs >= sectionEndStep) continue
          hits.push({ start: abs, lane: h.lane })
        }
      }
    } else {
      const maxEnd = srcNotes.reduce((m, n) => Math.max(m, n.start + n.duration), 0)
      const len = clipStepLen(maxEnd)
      for (const n of srcNotes) {
        for (const off of tileOffsets(clipLoop, len, sectionSteps, n.start)) {
          const abs = sectionStartStep + off
          if (abs >= sectionEndStep) continue
          notes.push({ start: abs, duration: n.duration, pitch: n.pitch })
        }
      }
    }
  }

  let pitchMin = Infinity
  let pitchMax = -Infinity
  for (const n of notes) {
    if (n.pitch < pitchMin) pitchMin = n.pitch
    if (n.pitch > pitchMax) pitchMax = n.pitch
  }
  if (!Number.isFinite(pitchMin)) {
    pitchMin = 48
    pitchMax = 72
  }
  if (pitchMin === pitchMax) {
    pitchMin -= 6
    pitchMax += 6
  }
  return { track, notes, hits, pitchMin, pitchMax }
}

type Band = { start: number; end: number } | null

/** One track row: a fixed header + a canvas note/density renderer. Its own canvas, redrawn when
 * its data, the viewport width, the LOD mode, or its selection band changes. */
function TrackRow({
  flat,
  totalBars,
  pxPerBar,
  detail,
  sections,
  band,
  selected,
  onHeaderClick,
  onRowPointerDown,
  headerExtra,
  groupPickChecked,
  onToggleGroupPick,
  alreadyGrouped,
  occurrences,
  selectedOcc,
  dragPreview,
  onOccPointerDown,
  renameRequest,
}: {
  flat: TrackFlat
  totalBars: number
  pxPerBar: number
  detail: boolean
  sections: Section[]
  band: Band
  selected: boolean
  onHeaderClick: () => void
  onRowPointerDown: (e: React.PointerEvent) => void
  /** Phase 31 Stream KE item 1: a request (keyed by a fresh `nonce` each time, so repeat requests on
   * the same track still re-fire) from the parent's list-level double-click coordinator (see
   * ArrangementView's `handleArrangementClickCapture`) to open THIS track's rename field. Non-null
   * only for the one row it targets. */
  renameRequest?: { trackId: string; nonce: number } | null
  headerExtra?: ReactNode
  /** Phase 22 Stream AF: whether this track is currently picked (checkbox) for the next "+ group"
   * action. Undefined/omitted when grouping isn't wired up by the caller. */
  groupPickChecked?: boolean
  onToggleGroupPick?: () => void
  /** True when this track already belongs to a group — a track can only be in one, so the pick
   * checkbox is hidden rather than offered-and-refused. */
  alreadyGrouped?: boolean
  /** This track's clip occurrences (Phase 22 Stream AE originally passed these for 'audio'-kind
   * canvas rendering only; Phase 24 Stream CC generalized it to every kind — it now also drives
   * the bounded/labeled/selectable `.arr-clip-block` DOM overlay every track row renders). Passed
   * down rather than recomputed: the parent already builds this exact list (occurrencesByTrack)
   * for the automation-lane wiring. */
  occurrences?: ClipOccurrence[]
  /** Phase 24 Stream CC: which occurrences (by occKey) are part of the current marquee/click
   * selection — drives `.arr-clip-block.selected`. */
  selectedOcc: Set<string>
  /** Phase 24 Stream CC: the live preview while a selected clip is being dragged — every occurrence
   * whose key is in `keys` renders shifted by `deltaBars` (bars, can be fractional-looking but is
   * always a whole-bar round), until the drag commits or cancels. */
  dragPreview: { deltaBars: number; keys: Set<string> } | null
  /** Phase 24 Stream CC: pointerdown on one clip block — stops the event from also starting the
   * lane's own empty-space marquee/bar-select drag (see beginClipDrag in the parent). v0.11
   * (Phase 36 PD): passes the whole occurrence, so the parent knows WHICH placement (occ.at) and
   * which clip the gesture targets. */
  onOccPointerDown: (occ: ClipOccurrence, e: React.PointerEvent) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const { track } = flat
  // Dim the whole row when the track is effectively silenced (explicitly muted, or another track is
  // soloed) — the same signal the engine's real audio gate reads (Phase 14 Stream E).
  const dimmed = useStore((s) => isEffectivelyMuted(s, track.id))
  // Phase 32 Stream LA (docs/research/81/87/92/93): right-click a clip block -> Delete/Duplicate —
  // see the block's own onContextMenu below and daemon.ts's removeClipFromSection/
  // duplicateClipToNewSection for what each item actually does. `busy` disables both items for the
  // duration of their own round-trip (each is a real write, not a debounced /edit) so a second
  // right-click mid-flight can't fire a duplicate request against a stale sectionIndex.
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; sectionIndex: number; clipId: string; at: number } | null>(null)
  const [ctxBusy, setCtxBusy] = useState(false)
  const setSelectedTrack = useStore((s) => s.setSelectedTrack)
  const setSelectedSection = useStore((s) => s.setSelectedSection)
  const setBottomPaneOpen = useStore((s) => s.setBottomPaneOpen)

  // Inline rename (Phase 20 Stream W): double-click the track name to edit it in place, Enter/blur
  // commits, Escape cancels. Names are single tokens in the format (no whitespace — src/core/edit.ts's
  // `if (/\s/.test(value)) throw ...`), so whitespace is filtered out as typed.
  //
  // Phase 30 Stream JD, item 1 (docs/research/87: renaming to "vox sample" silently became
  // "voxsample" with zero warning). Checked whether track.id and track.name could be split apart so
  // the DISPLAY name could carry spaces while only the internal id stays a slug — they're already two
  // separate fields (document.ts: `id` is "document-scoped human slug (D6)", `name` is free text) —
  // but the constraint isn't actually about id/name being the same field, it's that the WHOLE `.beat`
  // text format is whitespace-tokenized (parse.ts: `trimmedStart.trim().split(/\s+/)`, no quoting
  // grammar anywhere). Teaching the parser+serializer to quote one field would be a real, cross-
  // cutting format change (parse.ts, serialize.ts, and everything that round-trips a `.beat` file),
  // not a contained one — so this takes the (b) fallback the plan calls for: keep stripping (still the
  // only value the format can store), but surface it inline the instant it happens instead of mangling
  // the input in silence.
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState(track.name)
  const [spaceStripped, setSpaceStripped] = useState(false)
  // Phase 31 Stream KE item 1 (docs/research/90: renaming took two double-clicks, not one).
  //
  // Root cause, confirmed by instrumenting a real headless run (not guessed from reading the code):
  // the native `dblclick` event requires BOTH clicks to land on the SAME element. The first click of
  // a double-click on an unselected track calls `onHeaderClick`, which selects the track — and
  // selecting a track mounts App.tsx's `<VaryAffordance />` contextual toolbar, a sibling rendered
  // ABOVE `<ArrangementView />`, which shifts the ENTIRE track list down by the toolbar's height
  // before the second click lands. A real double-click's second click fires at the same fixed screen
  // coordinate as the first (a physical mouse doesn't move between the two clicks of one gesture) —
  // measured directly via a headless click-log, that second click doesn't just miss the shifted
  // button, it typically lands in a DIFFERENT track's row entirely (whichever row's now sitting at
  // that now-stale coordinate), so per-row same-element OR even same-row double-click detection can't
  // catch it. The actual pairing (see `handleArrangementClickCapture` on the parent `.arrangement`
  // container, the one ancestor whose own position is stable regardless of which descendant a
  // deflected click lands on) lives one level up; this row just reacts to being TOLD to open rename
  // via `renameRequest`, whichever element actually received the second click.
  useEffect(() => {
    if (renameRequest && renameRequest.trackId === track.id) {
      setDraft(track.name)
      setRenaming(true)
    }
    // Only the nonce should re-trigger this — `track.name` is read fresh inside, not a dependency
    // that should itself reopen renaming.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renameRequest])
  const commitRename = useCallback(() => {
    setRenaming(false)
    setSpaceStripped(false)
    const name = draft.trim()
    if (name && name !== track.name) postEdit(`${track.id}.name`, name)
    else setDraft(track.name)
  }, [draft, track.id, track.name])

  // Phase 22 Stream AH: the track header is a drop target for the content browser (ContentBrowser.tsx)
  // — a preset onto a matching-kind track (applyPresetToTrack), a kit onto a drum track (every lane
  // it has, via installKitLane with no `lane`), or a soundfont onto an instrument track
  // (installSoundfont). A single kit ONE-SHOT (payload.lane set) also lands here if dropped on the
  // header rather than a specific lane row (StepSequencer.tsx) — it just installs to its own lane.
  //
  // Phase 23 Stream BC: that same one-shot payload also lands on an `audio`-kind track header —
  // dragging a real audio file (a kit's own wav) onto an audio track creates a clip from it
  // (installAudioClip), the clip-creation half Stream AE's format work left for the GUI. No new
  // position signal exists at the header (unlike the canvas, a header drop isn't "at bar N"), so the
  // target clip is resolved the same "primary occurrence" convention every other per-track panel in
  // this file already uses (occurrences[0]): reuse it in place if the track already has one,
  // otherwise mint a new clip and slot it into the FIRST song section's scene (sections[0]) so it's
  // immediately visible — refused with a clear message in loop mode, where there's no scene to slot
  // into yet (add a song section first).
  const handleLibraryDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      const payload = readDragPayload(e.dataTransfer)
      if (!payload) return
      if (payload.type === 'preset') {
        if (payload.kind !== 'any' && payload.kind !== track.kind) {
          showToast(`"${payload.name}" is a ${payload.kind} preset — "${track.name}" is a ${track.kind} track.`)
          return
        }
        applyPresetToTrack(track.id, payload.name).catch((err) => showToast(`Could not apply preset: ${(err as Error).message}`))
      } else if (payload.type === 'kit-lane') {
        if (track.kind === 'drums') {
          installKitLane(track.id, payload.kit, payload.lane ? { lane: payload.lane } : {}).catch((err) =>
            showToast(`Could not install sample: ${(err as Error).message}`),
          )
        } else if (track.kind === 'audio') {
          if (!payload.lane) {
            showToast('Drag a single kit sample (not a whole kit) onto an audio track — one clip, one sample.')
            return
          }
          const existingClipId = occurrences?.[0]?.clipId
          const firstScene = sections[0]?.scene
          const opts: { clipId?: string; sceneId?: string } =
            existingClipId !== undefined ? { clipId: existingClipId } : firstScene && firstScene !== LOOP_SCENE_SENTINEL ? { sceneId: firstScene } : {}
          if (existingClipId === undefined && !opts.sceneId) {
            showToast('Add a song section first ("+ section") — audio clips only play once slotted into a song-mode scene.')
            return
          }
          installAudioClip(track.id, payload.kit, payload.lane, opts).catch((err) => showToast(`Could not create audio clip: ${(err as Error).message}`))
        } else {
          showToast(`"${track.name}" is a ${track.kind} track — drop kit samples onto a drum or audio track.`)
        }
      } else if (payload.type === 'soundfont') {
        if (track.kind !== 'instrument') {
          showToast(`"${track.name}" is not an instrument track — drop a soundfont onto an instrument track.`)
          return
        }
        installSoundfont(payload.file, { track: track.id }).catch((err) => showToast(`Could not install soundfont: ${(err as Error).message}`))
      }
    },
    [track.id, track.kind, track.name, occurrences, sections],
  )
  // Phase 27 Stream EB: shared drop-target primitive (ui/src/dragDrop.ts) — fixes the real bug
  // research/74 §3.1 found (`onDragLeave={() => setDropHover(false)}` was a bare boolean with no
  // `relatedTarget` check, so crossing from the header's background onto ANY of its densely packed
  // interactive children — checkbox, swatch, rename/delete buttons, the InlineStrip's mute/solo/
  // volume/pan controls — re-fired `dragleave` on the header and cancelled the highlight across
  // ~98% of its own surface area).
  const dropTarget = useDropTarget<HTMLDivElement>(LIBRARY_DND_MIME, handleLibraryDrop)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    const wCss = Math.max(1, totalBars * pxPerBar)
    canvas.width = Math.round(wCss * dpr)
    canvas.height = Math.round(ROW_H * dpr)
    canvas.style.width = `${wCss}px`
    canvas.style.height = `${ROW_H}px`
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, wCss, ROW_H)

    // Row backdrop + section dividers.
    ctx.fillStyle = 'rgba(255,255,255,0.015)'
    ctx.fillRect(0, 0, wCss, ROW_H)
    ctx.strokeStyle = 'rgba(255,255,255,0.09)'
    ctx.lineWidth = 1
    for (const s of sections) {
      const x = Math.round(s.startBar * pxPerBar) + 0.5
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, ROW_H)
      ctx.stroke()
    }
    // Faint per-bar gridlines when detailed enough to be legible.
    if (pxPerBar >= DETAIL_PX_PER_BAR) {
      ctx.strokeStyle = 'rgba(255,255,255,0.035)'
      for (let b = 1; b < totalBars; b++) {
        const x = Math.round(b * pxPerBar) + 0.5
        ctx.beginPath()
        ctx.moveTo(x, 0)
        ctx.lineTo(x, ROW_H)
        ctx.stroke()
      }
    }

    if (track.kind === 'audio') {
      // Phase 22 Stream AE: a flat-colored fill per clip occurrence (section), with dark edge
      // markers standing in for in/out handles — the "internal content in miniature" flavor
      // research/30 (Ableton) calls out for audio (a stand-in for a real waveform; see the bottom
      // Clip panel's AudioClipInspector — AudioClipEditor.tsx — for the real thing). No drag-to-trim this
      // stream (a real lift — see docs/phase-22-stream-ae.md's honest gap note); trim via the
      // fields under the track, or `beat set`/beat_set.
      //
      // Phase 24 Stream CC: the clip ID label used to be drawn here too — it now lives on the
      // `.arr-clip-block` DOM overlay every track kind gets (bounded/labeled/selectable), so this
      // canvas text is just the media filename + warp mode (extra detail the DOM label doesn't
      // carry), anchored to the BOTTOM of the block so it doesn't collide with the DOM label at
      // the top.
      //
      // v0.11 (Phase 36 PD): one fill PER PLACEMENT, at the placement's own startStep/lengthSteps
      // (trackOccurrences), not one full-section fill per section — the fill sits exactly where
      // the audio actually sounds.
      for (const occ of occurrences ?? []) {
        const clip = track.clips.find((c) => c.id === occ.clipId)
        if (!clip?.audio) continue
        const x = (occ.startStep / 16) * pxPerBar
        const w = Math.max(4, (occ.lengthSteps / 16) * pxPerBar)
        ctx.fillStyle = track.color
        ctx.globalAlpha = 0.85
        ctx.fillRect(x + 1, 4, w - 2, ROW_H - 8)
        ctx.globalAlpha = 1
        ctx.fillStyle = 'rgba(0,0,0,0.35)'
        ctx.fillRect(x + 1, 4, 3, ROW_H - 8) // in-point marker
        ctx.fillRect(x + w - 4, 4, 3, ROW_H - 8) // out-point marker
        if (w > 40) {
          ctx.fillStyle = '#0b0e14'
          ctx.font = '9px sans-serif'
          ctx.textBaseline = 'bottom'
          const label = clip.audio.warp === 'off' ? clip.audio.media : `${clip.audio.media} · ${clip.audio.warp} x${clip.audio.rate}`
          ctx.fillText(label, x + 8, ROW_H - 5, w - 16)
        }
      }
    } else if (detail) {
      if (track.kind === 'drums') {
        // Stacked lane rows (the track's own declared lanes, or the implicit 5 — Phase 22 Stream
        // AB); a hit is a tick at its lane.
        const laneNames = declaredLaneNames(track)
        const laneH = ROW_H / laneNames.length
        ctx.fillStyle = track.color
        for (const h of flat.hits) {
          const li = laneNames.indexOf(h.lane)
          if (li === -1) continue
          const x = (h.start / 16) * pxPerBar
          const y = li * laneH + 2
          ctx.fillRect(x, y, Math.max(2, pxPerBar / 16), laneH - 3)
        }
      } else {
        // Synth notes positioned by pitch within the row, width by duration.
        const range = flat.pitchMax - flat.pitchMin
        ctx.fillStyle = track.color
        for (const n of flat.notes) {
          const x = (n.start / 16) * pxPerBar
          const w = Math.max(2, (n.duration / 16) * pxPerBar)
          const norm = (n.pitch - flat.pitchMin) / range
          const y = (1 - norm) * (ROW_H - 6) + 2
          ctx.fillRect(x, y, w, 3)
        }
      }
    } else {
      // Density LOD: one opacity-encoded block per bar, opacity ∝ event count in that bar.
      const counts = new Array<number>(totalBars).fill(0)
      const events = track.kind === 'drums' ? flat.hits.map((h) => h.start) : flat.notes.map((n) => n.start)
      for (const st of events) {
        const bar = Math.floor(st / 16)
        if (bar >= 0 && bar < totalBars) counts[bar]++
      }
      for (let b = 0; b < totalBars; b++) {
        if (counts[b] === 0) continue
        const alpha = Math.min(1, counts[b] / DENSITY_REF)
        ctx.globalAlpha = 0.15 + alpha * 0.85
        ctx.fillStyle = track.color
        ctx.fillRect(Math.round(b * pxPerBar) + 1, 6, Math.max(1, pxPerBar - 2), ROW_H - 12)
      }
      ctx.globalAlpha = 1
    }

    // Selection band overlay for this row.
    if (band) {
      const x0 = band.start * pxPerBar
      const x1 = band.end * pxPerBar
      ctx.fillStyle = 'rgba(224,161,60,0.22)'
      ctx.fillRect(x0, 0, x1 - x0, ROW_H)
      ctx.strokeStyle = 'rgba(224,161,60,0.8)'
      ctx.beginPath()
      ctx.moveTo(x0 + 0.5, 0)
      ctx.lineTo(x0 + 0.5, ROW_H)
      ctx.moveTo(x1 - 0.5, 0)
      ctx.lineTo(x1 - 0.5, ROW_H)
      ctx.stroke()
    }
  }, [flat, totalBars, pxPerBar, detail, sections, band, track, occurrences])

  // Phase 27 Stream EA bug 1: `occurrences` is [] whenever this isn't song mode (see
  // trackOccurrences's `if (!doc.song) return []` in the parent) — synthesize one display-only
  // occurrence spanning `sections[0]` when that's the loop-mode implicit section (identified the same
  // way the header-drop handler above already does: `scene === LOOP_SCENE_SENTINEL`), so the
  // `.arr-clip-block` boundary/label/selection chrome mounts in loop mode too. clipId has no real
  // clip to name, so it uses the same LOOP_SCENE_SENTINEL label the section itself already carries.
  // A real drag/click on this block still routes through the ordinary onOccPointerDown → beginClipDrag
  // path in the parent; with only one section to land on, a drag there is always a same-section no-op
  // and a plain click just (de)selects the block — see beginClipDrag's own comment.
  //
  // Phase 31 Stream KA item 2(b) considered, but deliberately did NOT, synthesizing a placeholder
  // block for every section a track has no clip in yet: Phase 24 Stream CC's own verify script
  // (ui/verify-phase24-stream-cc.mjs, part B) depends on a track's SILENT sections staying
  // genuinely block-free DOM space to start a marquee-select drag from (starting a drag ON any
  // `.arr-clip-block` — even an inert placeholder — routes through onOccPointerDown/beginClipDrag
  // instead, which stopPropagation()s and turns the gesture into a single-clip drag, not a marquee).
  // Blanketing every empty section in a placeholder block would have silently broken that. Instead,
  // the fix lives in `onRowPointerDown`'s own click handler (this file, the `beginDrag`/`drag` effect
  // below) — a plain click ANYWHERE in a track's row, populated or not, now resolves and sets
  // `selectedSectionIndex` from the click's bar position, so a genuinely silent section is still
  // retargetable without needing new, marquee-blocking DOM chrome.
  const displayOccurrences: ClipOccurrence[] =
    occurrences && occurrences.length > 0
      ? occurrences
      : sections.length === 1 && sections[0]!.scene === LOOP_SCENE_SENTINEL
        ? [{ clipId: LOOP_SCENE_SENTINEL, startBar: sections[0]!.startBar, bars: sections[0]!.bars, sectionIndex: 0, at: 0, startStep: sections[0]!.startBar * 16, lengthSteps: sections[0]!.bars * 16 }]
        : []

  return (
    <div className={`arr-row ${dimmed ? 'dimmed' : ''}`} style={{ height: ROW_H }}>
      <div
        className={`arr-track-header ${selected ? 'selected' : ''} ${dropTarget.className}`}
        style={{ width: HEADER_W }}
        data-drop-target="track-header"
        onDragOver={dropTarget.onDragOver}
        onDragLeave={dropTarget.onDragLeave}
        onDrop={dropTarget.onDrop}
      >
        <div className="arr-track-titlebar">
          {/* Phase 22 Stream AF: pick this track for the next "+ group" action. Hidden once the track
              is already in a group — a track belongs to at most one group in this format, so the
              affordance is to ungroup first, not to silently re-home it. */}
          {!alreadyGrouped && onToggleGroupPick && (
            <input
              type="checkbox"
              className="arr-group-pick"
              data-group-pick={track.id}
              checked={!!groupPickChecked}
              onChange={onToggleGroupPick}
              onClick={(e) => e.stopPropagation()}
              title="pick for grouping"
            />
          )}
          {/* color: a hidden native color input behind the visible swatch (the swatch always renders
              regardless of native color-input chrome). Writes the <track>.color setValue path. */}
          <label className="arr-track-color" title="track color" onClick={(e) => e.stopPropagation()}>
            <span className="arr-track-swatch" style={{ background: track.color }} />
            <input
              type="color"
              className="arr-track-color-input"
              value={track.color}
              data-color={track.id}
              onChange={(e) => postEdit(`${track.id}.color`, e.target.value.toLowerCase())}
            />
          </label>
          {renaming ? (
            <span className="arr-track-rename-wrap">
              <input
                className="arr-track-rename"
                autoFocus
                value={draft}
                data-rename={track.id}
                onChange={(e) => {
                  const raw = e.target.value
                  const stripped = raw.replace(/\s/g, '')
                  setSpaceStripped(stripped !== raw)
                  setDraft(stripped)
                }}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitRename()
                  else if (e.key === 'Escape') {
                    setDraft(track.name)
                    setSpaceStripped(false)
                    setRenaming(false)
                  }
                }}
              />
              {spaceStripped && (
                <span className="arr-track-rename-hint" data-rename-hint={track.id}>
                  spaces aren&apos;t allowed in track names — removed automatically
                </span>
              )}
            </span>
          ) : (
            <button
              className="arr-track-select"
              data-track-select={track.id}
              onClick={onHeaderClick}
              title={`select track ${track.name} (double-click to rename)`}
            >
              <span className="arr-track-name">{track.name}</span>
              <span className={`arr-track-kind kind-${track.kind}`}>{track.kind[0]}</span>
            </button>
          )}
          <button
            className="arr-track-del"
            data-del={track.id}
            title={`delete track ${track.name}`}
            onClick={() => {
              if (window.confirm(`Delete track "${track.name}"? This removes its clips, notes, and mixer settings and cannot be undone from here.`)) {
                postRemoveTrack(track.id).catch((err) => showToast(`Could not delete track: ${(err as Error).message}`))
              }
            }}
          >
            ×
          </button>
        </div>
        <InlineStrip track={track} />
        {headerExtra}
      </div>
      <div className="arr-lane" data-track={track.id} onPointerDown={onRowPointerDown} style={{ touchAction: 'none' }}>
        <canvas ref={canvasRef} className="arr-canvas" />
        {/* Phase 24 Stream CC: a bounded, labeled, selectable block per clip occurrence — Part 1's
            visibility fix. Sits ABOVE the canvas (later in DOM order) so it both reads clearly and
            catches pointer events for click/marquee-select/drag-move; the canvas underneath keeps
            drawing the occurrence's own content in miniature (note/hit ticks, or the audio fill).
            `occurrences` (the parent's real song-scene occurrences, from trackOccurrences) is always
            [] in loop mode — no scene/clip concept there — which used to mean this chrome never
            mounted for a fresh/simple project (Phase 27 Stream EA bug 1: `examples/night-shift.beat`
            itself, and every new project until it grows a `song` block). Fixed below by synthesizing
            ONE display-only occurrence spanning the loop's own implicit section (see `sections`'s own
            loop-mode branch, which already builds exactly this one-section-over-loop_bars shape) —
            purely a render-time affordance for THIS overlay; `occurrences` itself is passed through
            unmodified everywhere else in this component (the audio-fill canvas above, the
            library-drop clip-targeting logic), so it doesn't change what loop-mode content exists,
            only that its row now gets a visible boundary/label/selection target like song mode's do. */}
        {displayOccurrences.map((occ) => {
          const key = occKey(track.id, occ.sectionIndex, occ.at)
          const isSelected = selectedOcc.has(key)
          const isDragging = !!dragPreview?.keys.has(key)
          // v0.11 (Phase 36 PD): position/size from the occurrence's own startStep/lengthSteps —
          // a placement at `at 32` renders x-offset into its section, width = the region's real
          // timeline extent (trackOccurrences), not a full-section block.
          const left = (occ.startStep / 16 + (isDragging ? dragPreview!.deltaBars : 0)) * pxPerBar
          const width = Math.max(4, (occ.lengthSteps / 16) * pxPerBar)
          return (
            <div
              key={key}
              className={`arr-clip-block ${isSelected ? 'selected' : ''} ${isDragging ? 'dragging' : ''}`}
              data-clip-block={key}
              data-clip-id={occ.clipId}
              data-section-index={occ.sectionIndex}
              data-placement-at={occ.at}
              style={{ left, width, borderColor: track.color }}
              title={`${occ.clipId}${occ.at > 0 ? ` @ step ${occ.at}` : ''} · ${occ.bars} bar${occ.bars === 1 ? '' : 's'} section`}
              onPointerDown={
                occ.clipId === LOOP_SCENE_SENTINEL
                  ? // The synthetic loop-mode block (Phase 27 Stream EA bug 1) has no real clip to
                    // move — beginClipDrag's move branch is always a same-section no-op here, and
                    // its unconditional stopPropagation silently ate every OTHER gesture the bare
                    // lane would otherwise have handled, including Stream EC's bar-range-selection
                    // drag (regression caught by ec's own live-verify script re-run post-merge: a
                    // drag on this block produced no selection at all, since beginDrag/onRowPointerDown
                    // never got the chance to fire). Route straight to the lane's own handler instead
                    // — it already covers both the plain-click-selects-track case (bug 2's fix, in
                    // this same handler's onUp) and the real bar-range-select drag, so a "click/drag
                    // on this row" behaves identically whether or not the synthetic block happens to
                    // be there.
                    onRowPointerDown
                  : (e) => onOccPointerDown(occ, e)
              }
              onContextMenu={
                occ.clipId === LOOP_SCENE_SENTINEL
                  ? // The synthetic loop-mode block has no real clip/section to act on — Delete/
                    // Duplicate need an actual song-mode occurrence, so it just suppresses the
                    // browser's native menu without opening one of its own (same "nothing to do
                    // here" stance the onPointerDown branch above already takes for this block).
                    (e) => e.preventDefault()
                  : (e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      setCtxMenu({ x: e.clientX, y: e.clientY, sectionIndex: occ.sectionIndex, clipId: occ.clipId, at: occ.at })
                    }
              }
            >
              <span className="arr-clip-label">{occ.clipId}</span>
            </div>
          )
        })}
      </div>
      {ctxMenu &&
        (() => {
          const { sectionIndex, clipId, at } = ctxMenu
          // v0.11 (Phase 36 PD): an audio block is ONE placement of a possibly multi-placement
          // slot, so Delete/Duplicate pass the block's own `at` — the daemon targets just that
          // placement (a riser at 48 survives deleting the at-0 clip). Non-audio slots are
          // single-placement by validation, so the pre-v0.11 whole-slot calls stay exact there.
          const placementAt = track.kind === 'audio' ? at : undefined
          const items: ContextMenuItem[] = [
            {
              key: 'delete',
              label: 'Delete',
              danger: true,
              disabled: ctxBusy,
              onSelect: () => {
                setCtxBusy(true)
                postClipRemove(track.id, sectionIndex, placementAt)
                  .catch((err) => showToast(`Could not delete clip: ${(err as Error).message}`))
                  .finally(() => setCtxBusy(false))
              },
            },
            {
              key: 'duplicate',
              label: 'Duplicate',
              disabled: ctxBusy,
              title: `copy "${clipId}" into a new, independent scene in a fresh section right after this one`,
              onSelect: () => {
                setCtxBusy(true)
                postClipDuplicate(track.id, sectionIndex, placementAt)
                  .then(({ index }) => {
                    // Point every "which clip is open" bit of state at the freshly-inserted section,
                    // same three side effects a plain click on a clip block already sets (beginClipDrag's
                    // onUp above) — the new block is immediately the one the note editor/clip panel show.
                    setSelectedTrack(track.id)
                    postEdit('selected_track', track.id)
                    setSelectedSection(index)
                    setBottomPaneOpen(true)
                    showToast(`Duplicated clip "${clipId}" into section ${index + 1}.`, 'success')
                  })
                  .catch((err) => showToast(`Could not duplicate clip: ${(err as Error).message}`))
                  .finally(() => setCtxBusy(false))
              },
            },
          ]
          return <ContextMenu x={ctxMenu.x} y={ctxMenu.y} items={items} onClose={() => setCtxMenu(null)} testId={`${track.id}.clip.${sectionIndex}`} />
        })()}
    </div>
  )
}

/** One automation sub-lane: the draggable breakpoint curve for (track, clipId, param), drawn across
 * every section occurrence that plays that clip (tiled every loopSteps, matching engine playback).
 * Canvas-rendered; a drag redraws imperatively and commits once on pointer-up (research 15 §2). */
function AutomationLane({
  track,
  clipId,
  param,
  occurrences,
  totalBars,
  pxPerBar,
  loopSteps,
  onRemoveLane,
}: {
  track: BeatTrack
  clipId: string
  param: string
  occurrences: ClipOccurrence[]
  totalBars: number
  pxPerBar: number
  loopSteps: number
  onRemoveLane: () => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const spec = specFor(param)
  const min = spec.min ?? 0
  const max = spec.max ?? 1
  const fmt = spec.format ?? ((v: number) => v.toFixed(2))
  // Subscribe to just this lane's points. `find` returns the store's own array reference (stable
  // across unrelated state changes), so Object.is equality keeps this from re-rendering per tick.
  const points = useStore(
    useCallback(
      (s) => s.doc?.tracks.find((t) => t.id === track.id)?.clips.find((c) => c.id === clipId)?.automation.find((l) => l.param === param)?.points ?? NO_POINTS,
      [track.id, clipId, param],
    ),
  )
  const markersRef = useRef<{ x: number; y: number; id: string }[]>([])
  // Phase 26 Stream DI: every rendered segment this draw pass, in CANVAS-LOCAL pixel coords (one
  // entry per tile occurrence a segment is drawn in, since a looped lane repeats the same segment
  // at multiple x offsets) — lets pointer gestures hit-test "near a line between two points," not
  // just "on a point," for the alt/option-drag-to-bow gesture below.
  const segmentsRef = useRef<{ ax: number; ay: number; bx: number; by: number; aId: string; bId: string }[]>([])
  type DragState =
    | { mode: 'move'; id: string; time: number; value: number }
    | { mode: 'new'; time: number; value: number }
    | { mode: 'bow'; aId: string; bId: string; midY: number; dy: number }
  const dragRef = useRef<DragState | null>(null)
  const dragLabelRef = useRef<HTMLDivElement>(null)
  const [popup, setPopup] = useState<{ id: string; x: number; y: number; time: number; value: number; interpolation: AutomationInterpolation } | null>(null)
  const popupRef = useRef<HTMLDivElement>(null)

  // Phase 29 Stream GE item 3 (docs/research/81 §"one more rough edge on that popup"): the popup
  // used to close only via Escape (and only while the numeric <input> itself had keyboard focus) or
  // a further click inside this SAME automation lane — clicking anywhere else on the page (another
  // panel, the topbar, a different lane) left it sitting open indefinitely. Standard outside-click
  // (+ Escape from anywhere, not just the focused input) dismissal, scoped to while a popup is open.
  useEffect(() => {
    if (!popup) return
    const onPointerDownOutside = (e: PointerEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) setPopup(null)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPopup(null)
    }
    document.addEventListener('pointerdown', onPointerDownOutside)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDownOutside)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [popup])

  const valueToY = useCallback((v: number) => {
    const norm = Math.max(0, Math.min(1, (v - min) / (max - min || 1)))
    return AUTO_PAD + (1 - norm) * (AUTO_H - 2 * AUTO_PAD)
  }, [min, max])
  const yToValue = useCallback((y: number) => {
    const norm = Math.max(0, Math.min(1, 1 - (y - AUTO_PAD) / (AUTO_H - 2 * AUTO_PAD)))
    return min + norm * (max - min)
  }, [min, max])

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    const wCss = Math.max(1, totalBars * pxPerBar)
    canvas.width = Math.round(wCss * dpr)
    canvas.height = Math.round(AUTO_H * dpr)
    canvas.style.width = `${wCss}px`
    canvas.style.height = `${AUTO_H}px`
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, wCss, AUTO_H)
    // Phase 29 Stream GF item 6: a freshly-added, empty lane used to render as two ~6%-opacity
    // rail lines on the dark background fill — no baseline, no current-value marker, nothing that
    // read as "click here to add a point" (pilot 81). Raised the fill/rail opacity and, for the
    // genuinely-empty case, added a dashed center baseline plus small "click to automate" text —
    // a real visual invitation instead of a near-blank rectangle. Once the lane has real points the
    // baseline/label are skipped entirely (the curve itself is the content, same as before).
    ctx.fillStyle = 'rgba(255,255,255,0.035)'
    ctx.fillRect(0, 0, wCss, AUTO_H)
    // top / bottom rails
    ctx.strokeStyle = 'rgba(255,255,255,0.12)'
    ctx.lineWidth = 1
    for (const yy of [AUTO_PAD, AUTO_H - AUTO_PAD]) {
      ctx.beginPath()
      ctx.moveTo(0, yy + 0.5)
      ctx.lineTo(wCss, yy + 0.5)
      ctx.stroke()
    }
    if (points.length === 0) {
      const midY = AUTO_H / 2
      ctx.save()
      ctx.strokeStyle = 'rgba(255,255,255,0.22)'
      ctx.lineWidth = 1
      ctx.setLineDash([3, 4])
      ctx.beginPath()
      ctx.moveTo(0, midY + 0.5)
      ctx.lineTo(wCss, midY + 0.5)
      ctx.stroke()
      ctx.setLineDash([])
      if (wCss > 90) {
        ctx.fillStyle = 'rgba(255,255,255,0.32)'
        ctx.font = '10px -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif'
        ctx.textBaseline = 'middle'
        ctx.fillText('click to add a point', 8, midY)
      }
      ctx.restore()
    }

    // Effective points = committed points with the active drag applied (move overrides one id; new
    // adds a provisional point). Sorted by time — the canonical curve order.
    const drag = dragRef.current
    let eff = points.map((p) => ({ ...p }))
    if (drag?.mode === 'move') eff = eff.map((p) => (p.id === drag.id ? { ...p, time: drag.time, value: drag.value } : p))
    if (drag?.mode === 'new') eff = [...eff, { id: '__draft__', time: drag.time, value: drag.value }]
    eff.sort((a, b) => a.time - b.time)
    const draggedId = drag?.mode === 'move' ? drag.id : undefined
    const bow = drag?.mode === 'bow' ? drag : null

    const markers: { x: number; y: number; id: string }[] = []
    const segments: { ax: number; ay: number; bx: number; by: number; aId: string; bId: string }[] = []
    ctx.strokeStyle = track.color
    ctx.lineWidth = 1.5
    for (const occ of occurrences) {
      // v0.11 (Phase 36 PD): tile from the occurrence's own block extent (startStep/lengthSteps) —
      // for an audio placement the curve rides the placement's real start (placement-relative gain
      // automation, matching the engine's own lookup), not the section boundary; for non-audio
      // occurrences startStep/lengthSteps ARE the section bounds, so nothing changes there.
      for (let off = 0; off < occ.lengthSteps; off += loopSteps) {
        const tileStartStep = occ.startStep + off
        const tileEndStep = Math.min(occ.startStep + occ.lengthSteps, tileStartStep + loopSteps)
        const xAt = (localStep: number) => ((tileStartStep + localStep) / 16) * pxPerBar
        if (eff.length === 0) continue
        ctx.beginPath()
        // hold the first value from the tile start
        ctx.moveTo((tileStartStep / 16) * pxPerBar, valueToY(eff[0]!.value))
        ctx.lineTo(xAt(eff[0]!.time), valueToY(eff[0]!.value))
        // Phase 26 Stream DI: each segment renders per the shape its START point carries —
        // 'hold' steps (a horizontal run, then a vertical jump right at the next point's time),
        // 'curve' eases via curveEase-equivalent sampling (kept in visual sync with the engine's
        // own curveEase in ui/src/audio/engine.ts — see that file's comment), anything else (incl.
        // an in-progress bow-drag on THIS exact segment, which gets a live bezier-toward-the-
        // pointer preview instead) draws a straight line, same as before this stream.
        for (let i = 0; i < eff.length - 1; i++) {
          const a = eff[i]!
          const b = eff[i + 1]!
          const ax = xAt(a.time)
          const ay = valueToY(a.value)
          const bx = xAt(b.time)
          const by = valueToY(b.value)
          segments.push({ ax, ay, bx, by, aId: a.id, bId: b.id })
          if (bow && a.id === bow.aId && b.id === bow.bId) {
            const mx = (ax + bx) / 2
            const my = (ay + by) / 2 + bow.dy
            ctx.quadraticCurveTo(mx, my, bx, by)
          } else if (a.interpolation === 'hold') {
            ctx.lineTo(bx, ay)
            ctx.lineTo(bx, by)
          } else if (a.interpolation === 'curve') {
            const STEPS = 16
            for (let s = 1; s <= STEPS; s++) {
              const t = s / STEPS
              const shaped = t * t // quadratic ease-in — mirrors engine.ts's curveEase exactly
              ctx.lineTo(ax + (bx - ax) * t, valueToY(a.value + (b.value - a.value) * shaped))
            }
          } else {
            ctx.lineTo(bx, by)
          }
        }
        // hold the last value to the tile end
        ctx.lineTo((tileEndStep / 16) * pxPerBar, valueToY(eff[eff.length - 1]!.value))
        ctx.stroke()
        // markers (skip the provisional draft — it isn't grabbable until committed)
        for (const p of eff) {
          const x = xAt(p.time)
          const y = valueToY(p.value)
          ctx.beginPath()
          ctx.arc(x, y, 3.2, 0, Math.PI * 2)
          ctx.fillStyle = p.id === draggedId ? '#fff' : track.color
          ctx.fill()
          ctx.lineWidth = 1
          ctx.strokeStyle = 'rgba(0,0,0,0.6)'
          ctx.stroke()
          ctx.strokeStyle = track.color
          ctx.lineWidth = 1.5
          if (p.id !== '__draft__') markers.push({ x, y, id: p.id })
          // 'hold' points get a small flat cap so the step is recognizable even without hovering
          if (p.interpolation === 'hold') {
            ctx.fillStyle = 'rgba(0,0,0,0.65)'
            ctx.fillRect(x - 1, y - 1, 2, 2)
          }
        }
      }
    }
    markersRef.current = markers
    segmentsRef.current = segments
  }, [points, totalBars, pxPerBar, occurrences, loopSteps, track.color, valueToY])

  useEffect(() => {
    draw()
  }, [draw])

  // Map a canvas-local x to the clip-local time of the occurrence it falls in (points are stored in
  // clip-local 16th steps; the tile the pointer is over sets the reference frame). Returns null when
  // x is outside every occurrence.
  const clipTimeFromX = useCallback(
    (localX: number): { time: number; occ: ClipOccurrence } | null => {
      const absStep = (localX / pxPerBar) * 16
      let occ = occurrences.find((o) => absStep >= o.startStep && absStep < o.startStep + o.lengthSteps)
      if (!occ) occ = occurrences[0]
      if (!occ) return null
      let t = ((absStep - occ.startStep) % loopSteps + loopSteps) % loopSteps
      t = Math.max(0, Math.min(loopSteps, Number(t.toFixed(2))))
      return { time: t, occ }
    },
    [occurrences, pxPerBar, loopSteps],
  )

  // Phase 26 Stream DI: point-to-segment distance hit-test, using the segments draw() just laid
  // out (canvas-local coords, one entry per rendered tile occurrence — see segmentsRef above).
  // Feeds the alt/option-drag-to-bow gesture: "near (not on) a line between two breakpoints."
  const hitTestSegment = useCallback((localX: number, localY: number) => {
    let bestD = SEGMENT_HIT * SEGMENT_HIT
    let best: { ax: number; ay: number; bx: number; by: number; aId: string; bId: string } | null = null
    for (const s of segmentsRef.current) {
      const dx = s.bx - s.ax
      const dy = s.by - s.ay
      const len2 = dx * dx + dy * dy || 1
      let t = ((localX - s.ax) * dx + (localY - s.ay) * dy) / len2
      t = Math.max(0, Math.min(1, t))
      const px = s.ax + t * dx
      const py = s.ay + t * dy
      const d = (px - localX) ** 2 + (py - localY) ** 2
      if (d <= bestD) {
        bestD = d
        best = s
      }
    }
    return best
  }, [])

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button === 2) return // right-click is handled entirely by onContextMenu below
      setPopup(null)
      const canvas = canvasRef.current
      if (!canvas) return
      const rect = canvas.getBoundingClientRect()
      const localX = e.clientX - rect.left
      const localY = e.clientY - rect.top
      // hit-test existing markers
      let hit: string | null = null
      let best = MARKER_HIT * MARKER_HIT
      for (const m of markersRef.current) {
        const d = (m.x - localX) ** 2 + (m.y - localY) ** 2
        if (d <= best) {
          best = d
          hit = m.id
        }
      }
      // alt-click deletes a breakpoint
      if (hit && e.altKey) {
        postAutomation({ op: 'remove', track: track.id, clip: clipId, param, id: hit })
        return
      }
      // Phase 26 Stream DI: alt/option-drag on a SEGMENT (not a point) bows it into a curve —
      // live preview is a quadratic bezier toward the drag point; on release this commits
      // `interpolation: 'curve'` on the segment's start point (the persisted format is a flag, not
      // a bow amount — see AutomationInterpolation's doc comment in document.ts — so the engine and
      // the settled render both use a fixed ease, curveEase, once the drag ends).
      if (e.altKey && !hit) {
        const seg = hitTestSegment(localX, localY)
        if (seg) {
          e.preventDefault()
          const midY = (seg.ay + seg.by) / 2
          dragRef.current = { mode: 'bow', aId: seg.aId, bId: seg.bId, midY, dy: 0 }
          draw()
          const onMove = (ev: PointerEvent) => {
            const drag = dragRef.current
            if (!drag || drag.mode !== 'bow') return
            drag.dy = ev.clientY - rect.top - drag.midY
            draw()
          }
          const onUp = () => {
            window.removeEventListener('pointermove', onMove)
            window.removeEventListener('pointerup', onUp)
            const drag = dragRef.current
            dragRef.current = null
            if (drag && drag.mode === 'bow') {
              const aPoint = points.find((p) => p.id === drag.aId)
              if (aPoint) postAutomation({ op: 'set', track: track.id, clip: clipId, param, id: aPoint.id, time: aPoint.time, value: aPoint.value, interpolation: 'curve' })
            }
            draw()
          }
          window.addEventListener('pointermove', onMove)
          window.addEventListener('pointerup', onUp)
          return
        }
      }
      e.preventDefault()
      if (hit) {
        const p = points.find((pt) => pt.id === hit)!
        dragRef.current = { mode: 'move', id: hit, time: p.time, value: p.value }
      } else {
        const t = clipTimeFromX(localX)
        if (!t) return
        dragRef.current = { mode: 'new', time: t.time, value: yToValue(localY) }
      }
      draw()
      // Phase 26 Stream DI: surface the live drag value (already computed below, just never
      // rendered before this stream) as a small floating label near the cursor — an imperative DOM
      // write, not React state, matching draw()'s own no-React-per-move discipline (research 15 §2).
      const showLabel = (lx: number, ly: number, value: number) => {
        const label = dragLabelRef.current
        if (!label) return
        label.style.display = 'block'
        label.style.left = `${lx + 10}px`
        label.style.top = `${ly - 18}px`
        label.textContent = fmt(value)
      }
      const hideLabel = () => {
        const label = dragLabelRef.current
        if (label) label.style.display = 'none'
      }
      // (dragRef.current here is always 'move' | 'new' — the 'bow' branch above already returned.)
      const initial = dragRef.current
      if (initial) showLabel(localX, localY, initial.value)

      const onMove = (ev: PointerEvent) => {
        const drag = dragRef.current
        if (!drag || drag.mode === 'bow') return
        const lx = ev.clientX - rect.left
        const ly = ev.clientY - rect.top
        const t = clipTimeFromX(lx)
        if (t) drag.time = t.time
        drag.value = Number(yToValue(ly).toFixed(4))
        draw()
        showLabel(lx, ly, drag.value)
      }
      const onUp = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        hideLabel()
        const drag = dragRef.current
        dragRef.current = null
        if (!drag || drag.mode === 'bow') {
          draw()
          return
        }
        if (drag.mode === 'move') {
          postAutomation({ op: 'set', track: track.id, clip: clipId, param, id: drag.id, time: drag.time, value: drag.value })
        } else if (drag.mode === 'new') {
          postAutomation({ op: 'set', track: track.id, clip: clipId, param, time: drag.time, value: drag.value })
        }
        // leave the imperative draft on screen; the optimistic store update (postAutomation) triggers
        // the effect redraw from the real points on the next render.
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    },
    [points, clipTimeFromX, yToValue, draw, hitTestSegment, fmt, track.id, clipId, param],
  )

  // Phase 26 Stream DI: right-click a breakpoint -> a small popup with an exact numeric value
  // <input> AND a linear/hold/curve toggle for the segment it starts (both features "touch the
  // same component," research/65's recommendation to ship them together). Right-click empty space
  // just closes any open popup.
  const onContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      const canvas = canvasRef.current
      if (!canvas) return
      const rect = canvas.getBoundingClientRect()
      const localX = e.clientX - rect.left
      const localY = e.clientY - rect.top
      let hit: string | null = null
      let best = MARKER_HIT * MARKER_HIT
      for (const m of markersRef.current) {
        const d = (m.x - localX) ** 2 + (m.y - localY) ** 2
        if (d <= best) {
          best = d
          hit = m.id
        }
      }
      if (!hit) {
        setPopup(null)
        return
      }
      const p = points.find((pt) => pt.id === hit)
      if (!p) return
      setPopup({ id: p.id, x: localX, y: localY, time: p.time, value: p.value, interpolation: p.interpolation ?? 'linear' })
    },
    [points],
  )

  return (
    <div className="arr-auto-row" style={{ height: AUTO_H }}>
      <div className="arr-auto-head" style={{ width: HEADER_W }}>
        <span className="arr-auto-label" title={laneLabel(track, param)}>
          {laneLabel(track, param)}
        </span>
        <span className="arr-auto-range" title={`${fmt(min)} … ${fmt(max)}`}>
          {fmt(max)}
        </span>
        <button className="arr-auto-remove" title="remove this automation lane" data-auto-remove={`${track.id}.${param}`} onClick={onRemoveLane}>
          ×
        </button>
      </div>
      <div
        className="arr-auto-lane"
        data-auto-track={track.id}
        data-auto-param={param}
        onPointerDown={onPointerDown}
        onContextMenu={onContextMenu}
        style={{ touchAction: 'none' }}
      >
        <canvas ref={canvasRef} className="arr-auto-canvas" />
        <div ref={dragLabelRef} className="arr-auto-drag-label" style={{ display: 'none' }} />
        {popup && (
          <div
            ref={popupRef}
            className="arr-auto-popup"
            style={{ left: popup.x, top: popup.y }}
            data-auto-popup={`${track.id}.${param}.${popup.id}`}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <input
              type="number"
              step="any"
              className="arr-auto-popup-input"
              defaultValue={popup.value}
              autoFocus
              data-auto-value-input={`${track.id}.${param}.${popup.id}`}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const v = Number((e.target as HTMLInputElement).value)
                  if (Number.isFinite(v)) postAutomation({ op: 'set', track: track.id, clip: clipId, param, id: popup.id, time: popup.time, value: v, interpolation: popup.interpolation })
                  setPopup(null)
                } else if (e.key === 'Escape') {
                  setPopup(null)
                }
              }}
            />
            <div className="arr-auto-popup-modes">
              {(['linear', 'hold', 'curve'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  className={`arr-auto-popup-mode${popup.interpolation === m ? ' on' : ''}`}
                  data-auto-interp={`${track.id}.${param}.${popup.id}.${m}`}
                  onClick={() => {
                    postAutomation({ op: 'set', track: track.id, clip: clipId, param, id: popup.id, time: popup.time, value: popup.value, interpolation: m })
                    setPopup((prev) => (prev ? { ...prev, interpolation: m } : prev))
                  }}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/** The expandable "add an automation lane" strip that drops below a track row when its automation
 * picker is open — a param <select> + add button, spanning the timeline width. */
function AutomationPicker({ track, available, onAdd }: { track: BeatTrack; available: { key: string; label: string }[]; onAdd: (param: string) => void }) {
  const [pick, setPick] = useState(available[0]?.key ?? '')
  // Phase 29 Stream GF item 7: `available` shrinks by exactly one entry every time a lane is
  // added (the just-picked param drops out, since it's now "visible"/already added) — the OLD
  // code recomputed `chosen` by falling back straight to `available[0]` whenever `pick` fell out
  // of the list, which is EVERY add, so the ~100-option dropdown snapped back to the top after
  // every single lane (pilot 84: "making multi-lane setup tedious"). Track the previous list and,
  // when `pick` disappears, land on whatever's now at roughly the same INDEX instead — keeps the
  // selection (and therefore the native <select>'s own scroll-into-view-on-open behavior) in the
  // same neighborhood the user was just browsing, rather than jumping to the top of the list.
  const prevAvailableRef = useRef(available)
  useEffect(() => {
    const prev = prevAvailableRef.current
    prevAvailableRef.current = available
    if (available.some((a) => a.key === pick)) return
    const prevIdx = prev.findIndex((a) => a.key === pick)
    const idx = prevIdx === -1 ? 0 : Math.min(prevIdx, available.length - 1)
    setPick(available[idx]?.key ?? '')
  }, [available, pick])
  return (
    <div className="arr-auto-picker" style={{ height: PICKER_H }}>
      <div className="arr-auto-picker-head" style={{ width: HEADER_W }}>
        automation
      </div>
      <div className="arr-auto-picker-body">
        <select className="arr-auto-select" value={pick} data-auto-select={track.id} onChange={(e) => setPick(e.target.value)}>
          {available.map((a) => (
            <option key={a.key} value={a.key}>
              {laneLabel(track, a.key)}
            </option>
          ))}
        </select>
        <button className="arr-auto-add" data-auto-add={track.id} onClick={() => pick && onAdd(pick)} disabled={!pick}>
          + add lane
        </button>
      </div>
    </div>
  )
}

// ── Track grouping (Phase 22 Stream AF) ─────────────────────────────────────────────────────────
// Fold N tracks into one collapsible group header. Deliberately flat (no nested/group-of-groups):
// group MEMBERSHIP/name/color persists to the .beat file (a `group <id> <name> <color> <track-id>…`
// line, src/core/document.ts's BeatGroup); collapsed/expanded is UI-only session state, kept as a
// plain Record in ArrangementView's own component state — the same "not in the file" treatment
// mute/solo already get (ui/src/state/store.ts) — so it does not round-trip through a reload. Group
// members can sit anywhere in the document's own track order (grouping never reorders tracks); the
// header renders once, at the position of the group's first member in doc order, and every member
// row is visually indented via the `arr-grouped-track` wrapper class.

/** One collapsible group header row: swatch, member count, double-click-to-rename, collapse toggle,
 * ungroup ×. Rename posts through the same daemon /group route create/delete use. */
function GroupHeaderRow({ group, collapsed, onToggleCollapse, onUngroup }: { group: BeatGroup; collapsed: boolean; onToggleCollapse: () => void; onUngroup: () => void }) {
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState(group.name)
  const commitRename = useCallback(() => {
    setRenaming(false)
    const name = draft.trim()
    if (name && name !== group.name) postGroupOp({ op: 'rename', id: group.id, name }).catch((err) => showToast(`Could not rename group: ${(err as Error).message}`))
    else setDraft(group.name)
  }, [draft, group.id, group.name])

  return (
    <div className="arr-row arr-group-row" style={{ height: GROUP_HEADER_H }} data-group={group.id}>
      <div className="arr-track-header arr-group-header" style={{ width: HEADER_W }}>
        <button className="arr-group-toggle" data-group-toggle={group.id} onClick={onToggleCollapse} title={collapsed ? 'expand group' : 'collapse group'}>
          {collapsed ? '▸' : '▾'}
        </button>
        <span className="arr-group-swatch" style={{ background: group.color }} />
        {renaming ? (
          <input
            className="arr-track-rename"
            autoFocus
            value={draft}
            data-group-rename={group.id}
            onChange={(e) => setDraft(e.target.value.replace(/\s/g, ''))}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename()
              else if (e.key === 'Escape') {
                setDraft(group.name)
                setRenaming(false)
              }
            }}
          />
        ) : (
          <button
            className="arr-group-name"
            onDoubleClick={() => {
              setDraft(group.name)
              setRenaming(true)
            }}
            title={`${group.tracks.length} tracks in this group (double-click to rename)`}
          >
            {group.name} <span className="arr-group-count">({group.tracks.length})</span>
          </button>
        )}
        <button className="arr-group-ungroup" data-ungroup={group.id} title="ungroup (tracks are kept)" onClick={onUngroup}>
          ×
        </button>
      </div>
      <div className="arr-lane arr-group-lane" />
    </div>
  )
}

export function ArrangementView() {
  const doc = useStore((s) => s.doc)
  const selection = useStore((s) => s.selection)
  const setSelectedTrack = useStore((s) => s.setSelectedTrack)
  const setBottomPaneOpen = useStore((s) => s.setBottomPaneOpen)
  // Phase 29 Stream GA: which song section is "in view" for the bottom Clip View / properties strip
  // / Place-in-Arrangement targeting — set by clicking a clip block (below, beginClipDrag's click
  // branch) or a section chip's name (the sections toolbar further down).
  const selectedSectionIndex = useStore((s) => s.selectedSectionIndex)
  const setSelectedSection = useStore((s) => s.setSelectedSection)
  // Phase 36 PD (v0.11): the third "which clip is open" coordinate — set by a click on an audio
  // clip block (beginClipDrag's click branch), read by AudioClipEditor's placement targeting.
  const setSelectedPlacement = useStore((s) => s.setSelectedPlacement)
  // Phase 22 Stream AG: the overlap-resolution preference every resize (chip +/- and the drag
  // handle) reads and sends to the daemon's POST /song resize op.
  const overlapPolicy = useStore((s) => s.overlapPolicy)
  const setOverlapPolicy = useStore((s) => s.setOverlapPolicy)
  // Phase 24 Stream CE: the transport's loop-region override — null loops the full song/loop
  // (today's default), or a bar range to loop just that while auditioning/editing it. Session-only
  // (see store.ts's doc comment); set from THIS view's existing bar-range selection axis below.
  const loopRegion = useStore((s) => s.loopRegion)
  const setLoopRegion = useStore((s) => s.setLoopRegion)
  // Playback position for the moving playhead. currentStep is the SAME grid-quantized song position
  // the step-sequencer/NoteView playheads already read (engine's Tone.getDraw() handoff, ported in
  // Phase 12 Stream 1) — reused here, not a second position-tracking mechanism. It ticks at most
  // 16x/bar, so it's allowed in reactive state (docs/research/15 §2); only the lightweight playhead
  // div re-renders on it — the memoized row canvases don't (their effect deps exclude currentStep).
  const currentStep = useStore((s) => s.currentStep)
  // Phase 41 Stream D: `playing` gates the follow-the-playhead auto-scroll below. Cheap to
  // subscribe to here — it flips at most twice per transport session, unlike currentStep.
  const playing = useStore((s) => s.playing)
  // research/128 §2.2 deep links: when the agent's `POST /focus` selects a track, scroll that track's
  // row into view here — the selection itself is already handled by the ordinary `selectedTrackId`
  // path (bridge.ts's focus handler), this only nudges the timeline so the newly-focused track is
  // actually visible. Keyed on `focusEpoch` so a repeat focus on the same track re-scrolls; the row
  // is found by its stable `data-track` attribute (the `.arr-lane` below), the same hook the verify
  // scripts use. `block: 'nearest'` never yanks the view when the row is already on screen.
  const focusEpoch = useStore((s) => s.focusEpoch)
  const focusTrackId = useStore((s) => s.focusTrackId)
  useEffect(() => {
    if (!focusTrackId) return
    const row = document.querySelector(`[data-track="${focusTrackId}"]`)
    row?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [focusEpoch, focusTrackId])
  // Phase 31 Stream KE item 1 (docs/research/90): the list-level coordinator behind the "rename
  // takes one double-click, not two" fix — see TrackRow's own comment on `renameRequest` for the
  // full root-cause writeup. Deliberately lives here, not per-row: a real double-click's second
  // click, deflected by the VaryAffordance toolbar's layout shift, was measured (via a real headless
  // click-log) landing in a DIFFERENT track's row than the first click — so pairing has to happen at
  // an ancestor stable enough to see every row's clicks, not inside any one row.
  const lastTrackSelectClickRef = useRef<{ trackId: string; at: number } | null>(null)
  const [renameRequest, setRenameRequest] = useState<{ trackId: string; nonce: number } | null>(null)
  // Phase 32 Stream LB: inline rename for a section chip's scene name, double-click to open — same
  // one-double-click convention as track rename (KE), just not the deflected-click coordinator
  // dance track rename needed: selecting a section (`setSelectedSection`) is a plain state set with
  // no sibling toolbar mounting above the chips, so there's no analogous layout-shift-mid-gesture
  // bug here for a plain per-chip onDoubleClick to worry about.
  //
  // `sectionIndex` (not just `sceneId`) is part of this state on purpose. Root cause, confirmed by
  // instrumenting a real headless run: two sections can share the SAME scene (songAppend's
  // duplicate-by-reference behavior — see T4 below), so keying the open rename field on `sceneId`
  // alone made EVERY chip sharing that scene match `isRenamingThis` at once, mounting one
  // `autoFocus` `<input>` per matching chip simultaneously. The later one in DOM order stole focus
  // from the earlier one immediately after mount, firing its `onBlur` (`commitSceneRename`) before
  // a real user (or a test) could ever type into it — the rename field appeared to instantly close
  // itself. Scoping by section index means only the chip actually double-clicked opens an input;
  // the commit itself still targets `sceneId`, so the name still applies scene-wide (T4's contract).
  const [sceneRename, setSceneRename] = useState<{ sceneId: string; sectionIndex: number; draft: string } | null>(null)
  const commitSceneRename = useCallback(() => {
    setSceneRename((cur) => {
      if (!cur) return null
      const trimmed = cur.draft.trim()
      const sanitized = trimmed.replace(/[^a-zA-Z0-9_-]/g, '')
      void postSong({ op: 'renameScene', id: cur.sceneId, ...(sanitized ? { name: sanitized } : {}) })
      return null
    })
  }, [])
  const handleArrangementClickCapture = useCallback((e: React.MouseEvent) => {
    const DOUBLE_CLICK_MS = 400
    const target = e.target as HTMLElement
    const now = Date.now()
    const selectBtn = target.closest<HTMLElement>('.arr-track-select[data-track-select]')
    if (selectBtn) {
      const trackId = selectBtn.getAttribute('data-track-select')!
      const prev = lastTrackSelectClickRef.current
      if (prev && prev.trackId === trackId && now - prev.at < DOUBLE_CLICK_MS) {
        lastTrackSelectClickRef.current = null
        setRenameRequest({ trackId, nonce: now })
      } else {
        lastTrackSelectClickRef.current = { trackId, at: now }
      }
      return
    }
    // Deflected-click case: this click landed somewhere else entirely (often a different track's
    // row) — if it arrives soon enough after a select-button click, treat it as that gesture's lost
    // second click. Exclude genuinely separate, deliberate control clicks (mute/solo/delete buttons,
    // the color swatch, the volume/pan sliders) so quickly operating one of those right after
    // selecting a track is never misread as the second half of a rename gesture.
    if (target.closest('button, input[type="color"], input[type="range"]')) return
    const prev = lastTrackSelectClickRef.current
    if (prev && now - prev.at < DOUBLE_CLICK_MS) {
      lastTrackSelectClickRef.current = null
      setRenameRequest({ trackId: prev.trackId, nonce: now })
    }
  }, [])
  const scrollRef = useRef<HTMLDivElement>(null)
  const [laneWidth, setLaneWidth] = useState(800)
  // Timeline zoom (Phase 24 Stream CD): null = fit-to-width (default, today's behavior); a number
  // pins pxPerBar independently of laneWidth. See the module-level comment above MIN_PX_PER_BAR.
  const [zoomPxPerBar, setZoomPxPerBar] = useState<number | null>(null)
  // Active drag band (bars), plus which axis is dragging (the ruler → all tracks, or a track id).
  const [drag, setDrag] = useState<{ axis: 'ruler' | string; start: number; cur: number } | null>(null)
  const dragRectLeft = useRef(0)
  // Raw pointerdown clientX (Phase 24 Stream CE), separate from dragRectLeft's row-relative origin —
  // used only to tell a plain click (negligible movement) apart from a real drag-to-select gesture on
  // the ruler, so a click there can seek instead of committing a trivial one-bar selection.
  const dragStartClientX = useRef(0)
  // Active length-resize drag on a section's right-edge handle (Phase 19). `bars` is the live,
  // previewed length; it commits on pointer-up (loop_bars for loop mode, POST /song for song mode).
  // `startScrollLeft` (Phase 22 Stream AG) is the .arr-scroll container's scrollLeft at drag-start —
  // needed because growing the LAST section now auto-scrolls the container (see the resize effect
  // below), and the bar delta must account for that scroll, not just raw pointer movement.
  const [resize, setResize] = useState<{ index: number; startBar: number; startBars: number; startX: number; startScrollLeft: number; bars: number } | null>(null)
  const resizePxPerBar = useRef(1)
  // Phase 24 Stream CB: section-chip reorder drag. Same native-HTML5-DnD + {draggingIndex, overIndex}
  // shape SynthPanel.tsx's effect-chain drag already establishes (EffectRow's dragState) — sections
  // have no stable id (BeatSongSection is just {scene, bars}, and duplicates are legal), so identity
  // here is the chip's index at drag-start, which is safe because nothing reorders the array mid-drag
  // (the move only commits on drop).
  const [sectionDrag, setSectionDrag] = useState<{ draggingIndex: number | null; overIndex: number | null }>({ draggingIndex: null, overIndex: null })
  // ── Cross-track clip occurrence selection + drag-move (Phase 24 Stream CC) ───────────────────
  // No existing selection state fits this: `selection` (above) is the daemon-owned D2 pointing
  // protocol (a bar range, optionally scoped to tracks) that `beat vary --scope selection` reads —
  // coarser and a different owner (server round-trip) than "which specific clip BLOCKS are
  // marquee-selected right now," which is pure, local, transient GUI interaction state, never
  // meant to survive a reload or be read by anything outside this component.
  //
  // `selectedOcc` keys are `occKey(trackId, sectionIndex, at)` — one key per occurrence (v0.11:
  // per PLACEMENT on audio tracks; still 1:1 with sections everywhere else — see ClipOccurrence's
  // own doc comment), so that triple is the addressable unit. A plain marquee REPLACES the
  // selection (no shift-to-add — out of scope, matches this stream's own scope cut).
  const [selectedOcc, setSelectedOcc] = useState<Set<string>>(new Set())
  // Which track rows the current empty-space lane drag has passed over, keyed the same way `drag`
  // (above) already is — reuses that SAME gesture (a lane pointerdown) rather than inventing a
  // second one, so the existing single-track bar-range selection (`postSelection`, read by `beat
  // vary --scope selection`) keeps working unchanged; this just ALSO derives which clip blocks the
  // resulting rectangle intersects, across however many rows the pointer crossed. Populated by the
  // `drag` pointermove effect below; read (and reset) on pointerup.
  const rowsSpannedRef = useRef<Set<string>>(new Set())
  // Live preview while dragging a selected clip block: every occurrence whose key is in `keys`
  // renders shifted by `deltaBars` bars until the drag commits (nearest-section-snapped) or is
  // released as a no-op. Set/cleared imperatively by beginClipDrag's own pointermove/up listeners
  // (the same "attach on pointerdown, tear down on pointerup" idiom AutomationLane's onPointerDown
  // already uses in this file — not a useEffect, since the gesture is inherently one-shot).
  const [clipDrag, setClipDrag] = useState<{ deltaBars: number; keys: Set<string> } | null>(null)
  // Automation UI state (Phase 20 Stream Z): which track headers have the add-a-lane picker open,
  // and which params the user has explicitly added (a lane can be shown before it has any points).
  // Lanes that already carry points always show regardless — see visibleParamsFor.
  const [autoOpen, setAutoOpen] = useState<Record<string, boolean>>({})
  const [addedLanes, setAddedLanes] = useState<Record<string, string[]>>({})
  // Phase 29 Stream GF item 6 (second half): a just-added lane's DOM row doesn't exist until the
  // NEXT render, and `.arr-scroll` (the arrangement's own vertical scrollport, independent of the
  // page) doesn't auto-scroll to reveal it — when the arrangement pane is short (small window, or
  // several rows already visible), the new lane can land below the scrollport's current view with
  // no visual cue it exists at all. Pilot 84 read this as "the lane renders BEHIND the clip-editor
  // panel," since from a screenshot alone "exists in the document but isn't anywhere on screen" is
  // indistinguishable from a genuine stacking/paint-order bug — confirmed via direct DOM/layout
  // inspection that `.arr-scroll` really is just clipping it correctly (ordinary scrolled-off
  // content, not a z-index escape). Fixing the SYMPTOM either way: scroll the new lane into view
  // the moment it mounts, so "added but not visible" can't happen regardless of root cause.
  const lastAddedLaneRef = useRef<{ track: string; param: string } | null>(null)
  // Add-track control (Phase 20 Stream W): a small kind-chooser menu in the toolbar.
  const [addOpen, setAddOpen] = useState(false)
  const [addBusy, setAddBusy] = useState(false)
  // Track grouping (Phase 22 Stream AF): tracks checked (via each header's pick checkbox) for the
  // next "+ group" action, which group in the tracks list are folded (session-only — see the
  // GroupHeaderRow comment above for why collapse never touches the file), and a busy flag for the
  // group create/delete round-trip.
  const [groupPick, setGroupPick] = useState<Set<string>>(new Set())
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({})
  const [groupBusy, setGroupBusy] = useState(false)
  // New-project / save-as-template (Phase 22 Stream AF): one busy flag shared by all three prompts
  // below (they're mutually exclusive user actions).
  const [projectBusy, setProjectBusy] = useState(false)

  // Track the width available to the timeline lanes (total minus the fixed header column).
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const measure = () => setLaneWidth(Math.max(1, el.clientWidth - HEADER_W))
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const sections: Section[] = useMemo(() => {
    if (!doc) return []
    if (doc.song && doc.song.length > 0) {
      let bar = 0
      return doc.song.map((s) => {
        const out = { scene: s.scene, bars: s.bars, startBar: bar }
        bar += s.bars
        return out
      })
    }
    // Loop mode: one implicit section over loop_bars.
    return [{ scene: LOOP_SCENE_SENTINEL, bars: doc?.loopBars ?? 4, startBar: 0 }]
  }, [doc])

  // Phase 29 Stream GA: how many VISIBLE sections reference each scene id — "+ section" duplicates
  // by REUSING the previous section's scene (correct, intentional: docs/phase-6-plan.md's own
  // "starting content" default), but nothing distinguished that from an independent section, a real
  // footgun pilot 86 called out explicitly (editing one silently edits every section sharing that
  // scene). A count > 1 drives the "linked" badge on both the section chips and the ruler labels
  // below.
  const sceneShareCounts = useMemo(() => {
    const m = new Map<string, number>()
    for (const s of sections) m.set(s.scene, (m.get(s.scene) ?? 0) + 1)
    return m
  }, [sections])

  const totalBars = useMemo(() => sections.reduce((n, s) => n + s.bars, 0), [sections])
  const fitPxPerBar = totalBars > 0 ? laneWidth / totalBars : 0
  // zoomPxPerBar overrides the fit-to-width value once the user has zoomed; otherwise fall back to
  // it, preserving the pre-Stream-CD default exactly. Every downstream reader of pxPerBar (detail
  // threshold, canvas sizing, ruler width, drag math, the resize-preview freeze) already goes through
  // this one variable, so decoupling it here is the whole of the zoom feature's plumbing.
  const pxPerBar = zoomPxPerBar ?? fitPxPerBar
  const detail = pxPerBar >= DETAIL_PX_PER_BAR
  const songMode = !!doc?.song?.length

  // ── Live resize preview (Phase 22 Stream AG) ─────────────────────────────────────────────────
  // The timeline is normally fit-to-width (pxPerBar = laneWidth / totalBars), which is exactly why
  // dragging the LAST section's right edge outward used to be impossible (docs/phase-19-arrangement-
  // length.md's "Deferred" note: "the last boundary is always at the container edge"; the algebra:
  // totalBars * pxPerBar === laneWidth always, so the right edge can never sit right of the
  // container). While a resize drag is active, rendering switches to the FROZEN px/bar captured at
  // drag-start (resizePxPerBar.current) and a PREVIEWED section list/total (reflecting the policy
  // above), instead of the reactive fit-to-width values — so growing the section actually widens the
  // rendered timeline (scrollable via .arr-scroll's existing overflow:auto) instead of being capped
  // at the old width. On pointer-up the drag ends, doc.loopBars/song commits, and the ordinary
  // fit-to-width layout takes back over (the arrangement "re-fits" to the new length).
  const renderSections = resize ? previewResizeSections(sections, resize.index, resize.bars, overlapPolicy) : sections
  // A trailing buffer of blank bars, present ONLY while a resize drag is active, added on top of
  // the true preview total for the rendered (scrollable) width alone — section positions/handles
  // above are unaffected (they're placed from renderSections' real bar counts). This is what makes
  // the edge auto-scroll bootstrap-able: growth needs scrollable overflow to scroll INTO, but that
  // overflow only exists once bars has already grown — so a fixed head-start buffer is rendered
  // proactively the moment a drag starts (before any growth has happened yet), and it keeps
  // reappearing ahead of the growing content on every render, so there is always somewhere to
  // auto-scroll into. Committed values never see this — it's a render-only figure.
  const DRAG_TAIL_BARS = 8
  const renderTotalBars = resize ? renderSections.reduce((n, s) => n + s.bars, 0) + DRAG_TAIL_BARS : totalBars
  const renderPxPerBar = resize ? resizePxPerBar.current || pxPerBar : pxPerBar

  const flats: TrackFlat[] = useMemo(() => {
    if (!doc) return []
    return doc.tracks.map((t) => flattenTrack(t, sections, doc))
  }, [doc, sections])

  // Track grouping (Phase 22 Stream AF): trackId -> its group (a track is in at most one), and the
  // render plan — one "group-header" row the first time a group's members are encountered in doc
  // order, then each member's own "track" row (only when the group isn't collapsed). Ungrouped
  // tracks render exactly as before. Collapsing hides the member rows entirely; the header always
  // shows so the fold can be reopened.
  const groupByTrack = useMemo(() => {
    const m = new Map<string, BeatGroup>()
    if (doc) for (const g of doc.groups) for (const tid of g.tracks) m.set(tid, g)
    return m
  }, [doc])
  type RowPlanTrackRow = { kind: 'track'; flat: TrackFlat; grouped: BeatGroup | null }
  type RowPlanRow = { kind: 'group-header'; group: BeatGroup } | RowPlanTrackRow
  const rowPlan: RowPlanRow[] = useMemo(() => {
    const rows: RowPlanRow[] = []
    const seenGroups = new Set<string>()
    for (const flat of flats) {
      const g = groupByTrack.get(flat.track.id) ?? null
      if (g) {
        if (!seenGroups.has(g.id)) {
          seenGroups.add(g.id)
          rows.push({ kind: 'group-header', group: g })
        }
        if (!collapsedGroups[g.id]) rows.push({ kind: 'track', flat, grouped: g })
      } else {
        rows.push({ kind: 'track', flat, grouped: null })
      }
    }
    return rows
  }, [flats, groupByTrack, collapsedGroups])

  // Automation: where each track's clip plays (song-time occurrences), and the clip loop length the
  // engine uses to tile automation (loopBars*16 — ui/src/audio/engine.ts contentFor).
  const occurrencesByTrack = useMemo(() => {
    const m = new Map<string, ClipOccurrence[]>()
    if (doc) for (const t of doc.tracks) m.set(t.id, trackOccurrences(t, sections, doc))
    return m
  }, [doc, sections])
  const loopSteps = (doc?.loopBars ?? 4) * 16

  // The params to show as sub-lanes for a track: params that already have automation points on the
  // track's primary (first-playing) clip, plus any the user explicitly added, filtered to the offered
  // set for the track kind. Existing automation is therefore always visible without opening a picker.
  const visibleParamsFor = useCallback(
    (track: BeatTrack): string[] => {
      const occ = occurrencesByTrack.get(track.id) ?? []
      const primary = occ[0]?.clipId
      const clip = primary ? track.clips.find((c) => c.id === primary) : undefined
      const existing = clip ? clip.automation.map((l) => l.param) : []
      const offered = new Set(autoOptionsFor(track.kind).map((o) => o.key))
      const out: string[] = []
      for (const p of [...existing, ...(addedLanes[track.id] ?? [])]) {
        if (offered.has(p) && !out.includes(p)) out.push(p)
      }
      return out
    },
    [occurrencesByTrack, addedLanes],
  )

  const addLane = useCallback((trackId: string, param: string) => {
    lastAddedLaneRef.current = { track: trackId, param }
    setAddedLanes((prev) => {
      const cur = prev[trackId] ?? []
      if (cur.includes(param)) return prev
      return { ...prev, [trackId]: [...cur, param] }
    })
  }, [])

  // Scrolls the just-added lane into view once its row has actually mounted (see
  // lastAddedLaneRef's comment above). Runs after every render touching addedLanes; a no-op
  // (element not found yet, or nothing pending) most of the time.
  useEffect(() => {
    const pending = lastAddedLaneRef.current
    if (!pending) return
    const el = document.querySelector(`[data-auto-track="${pending.track}"][data-auto-param="${pending.param}"]`)
    if (el) {
      el.scrollIntoView({ block: 'nearest' })
      lastAddedLaneRef.current = null
    }
  }, [addedLanes])

  // Removing a lane clears its stored points (one /automate remove per breakpoint — an empty lane has
  // no canonical serialized form, so the last removal drops the `auto` block) and forgets it locally.
  const removeLane = useCallback(
    (track: BeatTrack, param: string) => {
      const occ = occurrencesByTrack.get(track.id) ?? []
      const primary = occ[0]?.clipId
      const clip = primary ? track.clips.find((c) => c.id === primary) : undefined
      const lane = clip?.automation.find((l) => l.param === param)
      for (const p of lane?.points ?? []) {
        postAutomation({ op: 'remove', track: track.id, clip: primary!, param, id: p.id })
      }
      setAddedLanes((prev) => {
        const cur = prev[track.id] ?? []
        if (!cur.includes(param)) return prev
        return { ...prev, [track.id]: cur.filter((p) => p !== param) }
      })
    },
    [occurrencesByTrack],
  )

  // Phase 22 Stream AE: split-at-playhead. currentStep is the SAME absolute song-timeline step the
  // moving playhead div is positioned from (see showPlayhead/playheadLeft below); find whichever
  // occurrence (section) the playhead currently sits over for this track, convert to a CLIP-
  // relative step, and hand off to the daemon's /audio-split route (postAudioSplit).
  const splitAudioAtPlayhead = useCallback(
    async (track: BeatTrack) => {
      const occ = occurrencesByTrack.get(track.id) ?? []
      // v0.11 (Phase 36 PD): occurrences are placement-granular, so "which clip is under the
      // playhead" is the placement whose OWN block extent contains it — a playhead over the riser
      // at step 32 splits the riser, not the at-0 clip — and the split offset is relative to the
      // placement's start, not the section's.
      const hit = occ.find((o) => currentStep >= o.startStep && currentStep < o.startStep + o.lengthSteps)
      if (!hit) {
        showToast('Move the playhead over this track\'s clip first (split-at-playhead needs a position inside the clip).')
        return
      }
      const atSteps = currentStep - hit.startStep
      if (atSteps <= 0) {
        showToast('The playhead is at the very start of the clip — nothing to split there.')
        return
      }
      try {
        await postAudioSplit(track.id, hit.clipId, atSteps)
        postSelection({ tracks: [track.id] })
      } catch (err) {
        showToast(`Could not split: ${(err as Error).message}`)
      }
    },
    [occurrencesByTrack, currentStep],
  )

  const barFromClientX = useCallback(
    (clientX: number) => {
      const b = Math.floor((clientX - dragRectLeft.current) / pxPerBar)
      return Math.max(0, Math.min(totalBars - 1, b))
    },
    [pxPerBar, totalBars],
  )

  const beginDrag = useCallback(
    (axis: 'ruler' | string, e: React.PointerEvent) => {
      // Phase 32 Stream LA follow-up: right-click is handled entirely by a clip block's own
      // onContextMenu (or, for bare lane space, the browser's native menu — nothing here to open).
      // beginClipDrag's own `e.button === 2` bail (below) happens BEFORE its `e.stopPropagation()`
      // call, so a right-click's pointerdown on a clip block is NOT stopped from bubbling up to
      // THIS handler (the lane's own onPointerDown) — confirmed live: without this guard, that
      // bubbled pointerdown fell into this function's own "plain click -> select this row's track"
      // completion on pointerup, silently retargeting selectedTrackId/selectedSectionIndex to
      // whichever row the right-click landed in, even while its own context menu was legitimately
      // open. Same guard as beginClipDrag/AutomationLane's onPointerDown already use, applied here
      // too since this handler can be reached either directly (a right-click on bare lane space) or
      // via that bubble (a right-click on a clip block).
      if (e.button === 2) return
      e.preventDefault()
      const laneEl = (e.currentTarget as HTMLElement).querySelector('.arr-canvas') ?? e.currentTarget
      dragRectLeft.current = (laneEl as HTMLElement).getBoundingClientRect().left
      dragStartClientX.current = e.clientX
      const b = barFromClientX(e.clientX)
      // Phase 24 Stream CC: seed the marquee's row-span tracker with the starting row (a drag that
      // never leaves its starting track still needs to register that row for the occurrence-select
      // computed on pointerup below). A ruler-originated drag spans no specific row — it's the
      // existing full-width bar-range selection, unrelated to clip-block marquee-select.
      rowsSpannedRef.current = axis === 'ruler' ? new Set() : new Set([axis])
      setDrag({ axis, start: b, cur: b })
    },
    [barFromClientX],
  )

  // ── Moving selected clip occurrences between sections (Phase 24 Stream CC; extracted in Phase 41
  // Stream D) ──────────────────────────────────────────────────────────────────────────────────
  // This used to live inline inside beginClipDrag's pointerup. It was extracted the moment a SECOND
  // caller appeared (the arrow-key nudge below) rather than copied: a duplicated move handler is
  // exactly the "two surfaces, one operation, vow to keep them in sync" shape that has drifted
  // measurably several times in this codebase. Drag and nudge now differ only in how they arrive at
  // `deltaSections`; everything after that -- the out-of-range guard, the placement-granular move
  // list, the scene-forking warning -- is this one function.
  const moveOccurrences = useCallback(
    (keys: Set<string>, deltaSections: number, anchorTargetIndex: number) => {
      if (deltaSections === 0 || keys.size === 0) return
      const moves: { track: string; fromIndex: number; toIndex: number; at?: number }[] = []
      for (const k of keys) {
        // occKey is `track::section` (at 0) or `track::section::at` (a placement at > 0) —
        // track ids are slugs (no ':'), so a plain '::' split is unambiguous.
        const parts = k.split('::')
        const tid = parts[0]!
        const fromIndex = Number(parts[1])
        const at = parts.length > 2 ? Number(parts[2]) : undefined
        const toIndex = fromIndex + deltaSections
        if (toIndex < 0 || toIndex >= sections.length) {
          showToast('Cannot move the selection that far — it would fall outside the arrangement.')
          return
        }
        // v0.11 (Phase 36 PD): the daemon's move is placement-granular — `at` names WHICH
        // placement moves (omitted = the at-0/first, every pre-v0.11 slot's only one), and the
        // moved placement keeps its own `at` in the destination section.
        moves.push({ track: tid, fromIndex, toIndex, ...(at !== undefined ? { at } : {}) })
      }
      // Phase 30 Stream JD, item 4 (docs/research/87): daemon.ts's applyClipMoves ALWAYS mints a
      // fresh, private scene for every section a move touches (its own comment: "simplest way to
      // guarantee this move never bleeds into a sibling section"), even when that section's old
      // scene wasn't actually shared with anything. That's invisible/harmless in the common case —
      // the only genuinely surprising outcome (what pilot 87 hit) is when a TOUCHED section's old
      // scene WAS shared with some other section (touched or not): that shared content just got
      // split apart into an independent copy with zero on-screen explanation. Detect that specific
      // case up front, from the pre-move `sections` snapshot, and toast about it once the move
      // actually lands — undo (unaffected by this change) already reverts the whole thing cleanly.
      const sceneUseCount = new Map<string, number>()
      for (const s of sections) sceneUseCount.set(s.scene, (sceneUseCount.get(s.scene) ?? 0) + 1)
      const touchedIndices = new Set<number>()
      for (const mv of moves) {
        touchedIndices.add(mv.fromIndex)
        touchedIndices.add(mv.toIndex)
      }
      const forkedSectionNums = [...touchedIndices]
        .filter((idx) => (sceneUseCount.get(sections[idx]!.scene) ?? 0) > 1)
        .sort((a, b) => a - b)
        .map((idx) => idx + 1)
      setSelectedOcc(new Set())
      postClipMove(moves)
        .then(() => {
          if (forkedSectionNums.length === 0) return
          const label = forkedSectionNums.length === 1 ? `Section ${forkedSectionNums[0]}` : `Sections ${forkedSectionNums.join(', ')}`
          showToast(
            `Moved clip to section ${anchorTargetIndex + 1} — ${label} no longer share${forkedSectionNums.length === 1 ? 's' : ''} content with the section(s) it used to link to; each is now independent.`,
            'success',
          )
        })
        .catch((err) => showToast(`Could not move clip(s): ${(err as Error).message}`))
    },
    [sections],
  )

  // Pointerdown on a clip block (Phase 24 Stream CC). stopPropagation (called by the block itself,
  // TrackRow's onOccPointerDown) already kept the lane's own beginDrag from also firing, so this is
  // purely the clip-move gesture — attach/tear-down window listeners inline, the SAME "one-shot
  // gesture, no useEffect" idiom AutomationLane's onPointerDown already uses in this file.
  //
  // Click vs. drag: released with negligible movement → a plain click, selects just this one
  // occurrence (replacing whatever was selected). Released after a real drag → snaps the ORIGIN
  // clip's new start bar to the nearest section, turns that into a section-INDEX delta (the only
  // grid a clip can actually live on — see ClipOccurrence's doc comment), and applies the SAME
  // section-index delta to every occurrence in the group (the whole current selection if the
  // dragged block was already part of it, else just this one block — "keep its own single-clip
  // drag behavior" for a block outside any selection, per docs/phase-24-plan.md's CC scope). One
  // batched POST /clip-move commits the whole group as one write.
  const beginClipDrag = useCallback(
    (track: BeatTrack, occ: ClipOccurrence, e: React.PointerEvent) => {
      const trackId = track.id
      const { sectionIndex } = occ
      // Phase 32 Stream LA: right-click is handled entirely by the block's own onContextMenu (its
      // new context menu, TrackRow below) — same `e.button === 2` bail AutomationLane's onPointerDown
      // already uses. Fixes a real pre-existing bug docs/research/87 found along the way: with no
      // button check here, a right-click's pointerdown used to fall straight into this function's own
      // "plain click -> select this occurrence, retarget the track/section" branch below (nothing
      // ever moves on a right-click-release, so `moved` stayed false) — right-click silently
      // retargeted the clip editor with no menu and no visual cue, while left-click on the identical
      // block did NOT retarget (research 87's "genuinely strange, undiscovered asymmetry").
      if (e.button === 2) return
      e.stopPropagation()
      e.preventDefault()
      const key = occKey(trackId, sectionIndex, occ.at)
      const keys = selectedOcc.has(key) ? new Set(selectedOcc) : new Set([key])
      const startClientX = e.clientX
      const pxb = pxPerBar || 1
      let moved = false
      let deltaBars = 0
      const onMove = (ev: PointerEvent) => {
        const dxPx = ev.clientX - startClientX
        if (Math.abs(dxPx) > 3) moved = true
        deltaBars = Math.round(dxPx / pxb)
        setClipDrag(deltaBars === 0 ? null : { deltaBars, keys })
      }
      const onUp = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        setClipDrag(null)
        if (!moved) {
          setSelectedOcc(new Set([key]))
          // Bug 2 fix (Phase 27 Stream EA), extended: a clip block's own pointerdown stopPropagation
          // keeps the lane's onRowPointerDown (and therefore its own click-sets-selectedTrack fix,
          // below in this file) from ever firing when the click lands ON a block rather than empty
          // lane space. Bug 1's fix means loop-mode rows now ALWAYS have a block spanning the full
          // row, so without this, "click anywhere in a track's row" would silently stop being true
          // again the moment a click happened to land on the (now omnipresent) block. Same three
          // side effects clickHeader/the lane's own click path use.
          setSelectedTrack(trackId)
          postEdit('selected_track', trackId)
          setBottomPaneOpen(true)
          // Phase 29 Stream GA: a plain click on a clip block also points the "which section" state
          // at this occurrence's section — the missing half of "which clip is open" (the other half,
          // track selection, is set just above). sectionIndex is -1 for nothing real to point at
          // (there isn't one today — every real occurrence carries its own index — but guards the
          // synthetic loop-mode block if that path is ever routed through here instead of
          // onRowPointerDown).
          if (sectionIndex >= 0) setSelectedSection(sectionIndex)
          // v0.11 (Phase 36 PD): on an AUDIO track the clicked block is ONE placement of a possibly
          // multi-placement slot — record exactly which one, so the bottom-pane clip editor
          // (AudioClipEditor) targets the clicked placement's clip, not blindly the at-0/first one.
          // Must come after setSelectedSection, which deliberately clears any placement choice.
          if (track.kind === 'audio' && sectionIndex >= 0) setSelectedPlacement({ track: trackId, clip: occ.clipId, at: occ.at })
          return
        }
        if (deltaBars === 0) return
        const origin = sections[sectionIndex]
        if (!origin) return
        const targetIndex = nearestSectionIndex(sections, origin.startBar + deltaBars)
        moveOccurrences(keys, targetIndex - sectionIndex, targetIndex)
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    },
    [selectedOcc, pxPerBar, sections, setSelectedTrack, setBottomPaneOpen, setSelectedSection, setSelectedPlacement],
  )

  // Start a length-resize drag from a section's right-edge handle. stopPropagation keeps the ruler's
  // own bar-range select from also firing; the actual length change is previewed live and committed
  // on pointer-up (see the effect below).
  const beginResize = useCallback(
    (index: number, startBar: number, startBars: number, e: React.PointerEvent) => {
      e.preventDefault()
      e.stopPropagation()
      resizePxPerBar.current = pxPerBar || 1
      setResize({ index, startBar, startBars, startX: e.clientX, startScrollLeft: scrollRef.current?.scrollLeft ?? 0, bars: startBars })
    },
    [pxPerBar],
  )

  // Zoom controls (Phase 24 Stream CD): step the effective px/bar up or down by ZOOM_FACTOR, clamped
  // to [MIN_PX_PER_BAR, MAX_PX_PER_BAR]. Reading `z ?? fitPxPerBar` (not `pxPerBar`) means the very
  // first zoom-in/out step is relative to whatever's currently on screen (the fit value) rather than
  // some stale prior zoom.
  const zoomIn = useCallback(() => {
    setZoomPxPerBar((z) => Math.min(MAX_PX_PER_BAR, (z ?? fitPxPerBar) * ZOOM_FACTOR))
  }, [fitPxPerBar])
  const zoomOut = useCallback(() => {
    setZoomPxPerBar((z) => Math.max(MIN_PX_PER_BAR, (z ?? fitPxPerBar) / ZOOM_FACTOR))
  }, [fitPxPerBar])
  const zoomFit = useCallback(() => setZoomPxPerBar(null), [])

  // ── Zoom-to-selection + a zoom history stack (Phase 41 Stream D) ─────────────────────────────
  // Zooming into a region is only half a gesture: without a way back, every inspection of a
  // detail costs a manual re-navigation to wherever you were. The stack makes zoom-in/zoom-out a
  // matched pair — Z pushes the current view and frames the selection, X pops back to exactly the
  // px/bar AND scroll offset you left, however many levels deep you went.
  //
  // A view is (zoomPxPerBar, scrollLeft): restoring the zoom alone would land you at the right
  // magnification in the wrong place, which is most of the way to not having gone back at all.
  const [zoomStack, setZoomStack] = useState<{ zoom: number | null; scrollLeft: number }[]>([])

  const zoomToSelection = useCallback(() => {
    const el = scrollRef.current
    const band = selection.bars
    if (!el || !band) {
      showToast('Select a bar range first — drag the ruler or a track row, then press Z to zoom to it.')
      return
    }
    const bars = Math.max(1, band.end - band.start)
    const laneW = Math.max(1, el.clientWidth - HEADER_W)
    // A little padding so the selection doesn't sit flush against both edges with no context.
    const next = Math.max(MIN_PX_PER_BAR, Math.min(MAX_PX_PER_BAR, (laneW * 0.9) / bars))
    setZoomStack((st) => [...st, { zoom: zoomPxPerBar, scrollLeft: el.scrollLeft }])
    setZoomPxPerBar(next)
    // The new scrollLeft has to be applied after the wider content has actually laid out, or the
    // container clamps it to the OLD (narrower) scrollWidth and the view lands short. Same
    // requestAnimationFrame handoff onWheelZoom above already relies on for its anchor.
    requestAnimationFrame(() => {
      const el2 = scrollRef.current
      if (!el2) return
      const centerBar = band.start + bars / 2
      const maxScroll = Math.max(0, el2.scrollWidth - el2.clientWidth)
      el2.scrollLeft = Math.max(0, Math.min(maxScroll, centerBar * next - laneW / 2))
    })
  }, [selection.bars, zoomPxPerBar])

  const zoomBack = useCallback(() => {
    setZoomStack((st) => {
      const prev = st[st.length - 1]
      if (!prev) return st
      setZoomPxPerBar(prev.zoom)
      requestAnimationFrame(() => {
        if (scrollRef.current) scrollRef.current.scrollLeft = prev.scrollLeft
      })
      return st.slice(0, -1)
    })
  }, [])

  // Scroll-wheel zoom with Cmd/Ctrl held (trackpad pinch also arrives as a wheel event with ctrlKey
  // set, so this covers both). Anchor-preserving: the bar currently under the pointer stays under the
  // pointer after the zoom change, the same idiom every pan/zoom canvas uses, rather than always
  // zooming around the left edge (which would walk the view away from whatever you're looking at).
  const onWheelZoom = useCallback(
    (e: React.WheelEvent<HTMLDivElement>) => {
      if (!(e.ctrlKey || e.metaKey)) return // plain wheel still scrolls normally
      e.preventDefault()
      const scrollEl = scrollRef.current
      const cur = zoomPxPerBar ?? fitPxPerBar
      if (!scrollEl || cur <= 0) return
      const rect = scrollEl.getBoundingClientRect()
      const pointerOffsetInViewport = e.clientX - rect.left
      const contentX = pointerOffsetInViewport + scrollEl.scrollLeft - HEADER_W
      const barAtPointer = contentX / cur
      const next = Math.max(MIN_PX_PER_BAR, Math.min(MAX_PX_PER_BAR, cur * (e.deltaY < 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR)))
      setZoomPxPerBar(next)
      requestAnimationFrame(() => {
        if (scrollRef.current) scrollRef.current.scrollLeft = Math.max(0, barAtPointer * next + HEADER_W - pointerOffsetInViewport)
      })
    },
    [zoomPxPerBar, fitPxPerBar],
  )

  // ── Follow the playhead (Phase 41 Stream D) ──────────────────────────────────────────────────
  // Zoom (Stream CD, above) made the timeline able to be WIDER than its container for the first
  // time, but nothing ever scrolls it back to the playhead — so the moment you press play on
  // anything longer than a screenful, the playhead walks off the right edge and you are looking at
  // a static picture of bars 1-40 while bar 130 plays. On the 242-bar / 7:17 reference project this
  // is the difference between a usable arrangement and an unusable one.
  //
  // Deliberately a "page when it leaves the window" scroll, not a continuous centering one: keeping
  // the playhead pinned mid-screen means the CONTENT slides under it constantly, which is far
  // harder to read (and far more expensive — currentStep ticks 16x/bar) than letting the playhead
  // sweep across a stationary view and jumping the view once per screenful. Same reason Live/Logic
  // both default to page-scroll rather than continuous. FOLLOW_ANCHOR puts the playhead a third of
  // the way in after each jump, so there's always two thirds of a screen of lookahead ahead of it.
  //
  // Only acts while the transport is running. When stopped, scrolling is entirely the user's — no
  // "the view fought me" surprise, and no need to auto-disable the toggle on manual scroll (a
  // behavior that reliably reads as the toggle turning itself off for no reason).
  const [follow, setFollow] = useState(true)
  useEffect(() => {
    if (!follow || !playing) return
    const el = scrollRef.current
    if (!el || renderPxPerBar <= 0 || currentStep < 0) return
    const maxScroll = Math.max(0, el.scrollWidth - el.clientWidth)
    if (maxScroll <= 0) return // the whole song already fits; nothing to follow
    const x = HEADER_W + (currentStep / 16) * renderPxPerBar
    // The lane viewport is the container minus the sticky header column on its left — a playhead at
    // x < scrollLeft + HEADER_W is hidden BEHIND the track headers, not merely off-screen.
    const viewLeft = el.scrollLeft + HEADER_W
    const viewRight = el.scrollLeft + el.clientWidth
    if (x >= viewLeft + FOLLOW_MARGIN_PX && x <= viewRight - FOLLOW_MARGIN_PX) return
    const laneW = Math.max(1, el.clientWidth - HEADER_W)
    el.scrollLeft = Math.max(0, Math.min(maxScroll, x - HEADER_W - laneW * FOLLOW_ANCHOR))
  }, [follow, playing, currentStep, renderPxPerBar])

  // ── Locators (Phase 41 Stream D, v0.11) ──────────────────────────────────────────────────────
  // Named point markers on the timeline, read straight off the document (they are durable file
  // content, not session state — see src/core/document.ts's BeatLocator). Sorted by bar for
  // rendering and for prev/next navigation; `?? []` because a pre-v0.11 daemon's payload has no
  // `locators` key at all and the GUI ships independently of the daemon it connects to.
  const locators = useMemo(() => [...(doc?.locators ?? [])].sort((a, b) => a.bar - b.bar), [doc])
  const [locatorRename, setLocatorRename] = useState<{ id: string; draft: string } | null>(null)

  // The last bar the playhead was actually at, remembered ACROSS a stop. `currentStep` goes to -1
  // the moment the transport stops (engine.stop's own reset), which means every "where am I"
  // question — drop a marker here, jump to the previous marker — silently answered "bar 1" as soon
  // as you pressed stop. Caught by verification, not by reading the code: pressing "," after
  // stopping at bar 101 reported "already at the first marker" and went nowhere, because `here`
  // had quietly become 1. Stopping does not move you, so the reference point must survive it.
  // `null` until the playhead has EVER had a real position, which is what lets "drop a marker at
  // the playhead" tell "stopped at bar 97" apart from "never played" — the two are indistinguishable
  // from `currentStep` alone (both -1), and conflating them is what made M silently mark the wrong
  // bar (see newLocatorBar below).
  const lastPlayheadBarRef = useRef<number | null>(null)
  useEffect(() => {
    if (currentStep >= 0) lastPlayheadBarRef.current = Math.floor(currentStep / 16) + 1
  }, [currentStep])
  const playheadBar = useCallback(
    () => (currentStep >= 0 ? Math.floor(currentStep / 16) + 1 : lastPlayheadBarRef.current),
    [currentStep],
  )

  // Scroll a bar into view without touching the transport — the shared half of "jump to marker" and
  // the zoom-to-selection framing below. Centres the target when it isn't already comfortably on
  // screen, which for a jump (unlike follow's forward-only paging) is the right instinct: you asked
  // to look at that bar specifically, so put it where you can see what surrounds it.
  const scrollBarIntoView = useCallback((bar0: number) => {
    const el = scrollRef.current
    if (!el || renderPxPerBar <= 0) return
    const maxScroll = Math.max(0, el.scrollWidth - el.clientWidth)
    if (maxScroll <= 0) return
    const x = HEADER_W + bar0 * renderPxPerBar
    const laneW = Math.max(1, el.clientWidth - HEADER_W)
    el.scrollLeft = Math.max(0, Math.min(maxScroll, x - HEADER_W - laneW / 2))
  }, [renderPxPerBar])

  // Jump the transport to a locator. Deliberately the SAME gesture semantics as a click on the
  // ruler (engine.seek): relocate while playing, start from there while stopped — Ableton's own
  // rule, and already this app's documented behavior for "click a position on the timeline". A
  // marker lane that behaved differently from the ruler two pixels below it would be the
  // inconsistency, not the consistency.
  const jumpToLocator = useCallback(
    (bar: number) => {
      const bar0 = Math.max(0, bar - 1) // locator bars are 1-based; engine.seek takes 0-based
      scrollBarIntoView(bar0)
      engine.seek(bar0)
    },
    [scrollBarIntoView],
  )

  // Where a new marker lands: the playhead if the transport has a position, else the start of the
  // current bar selection, else bar 1. All three are "the place the user is currently looking at",
  // in decreasing order of how explicitly they said so.
  // Where a new marker lands. THE PLAYHEAD WINS, including the remembered one from before a stop —
  // that is what the button's tooltip and the Shortcuts panel both promise, and the first cut of
  // this got the precedence backwards: the remembered playhead was checked LAST, after the
  // selection, so the overwhelmingly natural workflow (drag-select the breakdown, click the ruler
  // inside it to listen, stop, press M) silently marked the SELECTION START instead of bar 97.
  // Caught by the usability pilot, which is the only thing that would have caught it — every
  // assertion in the verify suite happened to press M with no selection active.
  //
  // The bar-range selection is only a fallback for the genuinely ambiguous case: a session where
  // the playhead has never been anywhere, so "at the playhead" means nothing yet and the selection
  // is the only place the user has actually pointed at.
  const newLocatorBar = useCallback((): number => {
    const atPlayhead = playheadBar()
    if (atPlayhead !== null) return atPlayhead
    if (selection.bars) return selection.bars.start + 1
    return 1
  }, [selection.bars, playheadBar])

  const addLocator = useCallback(() => {
    const bar = Math.min(Math.max(1, newLocatorBar()), Math.max(1, totalBars))
    // Ids are minted client-side on purpose — see setValue's locator grammar for why the id must be
    // in the PATH (the daemon coalesces undo entries by path string, so a shared append path would
    // collapse several quick adds into a single undo step and lose all but the last).
    const taken = new Set(locators.map((l) => l.id))
    let n = 1
    while (taken.has(`m${n}`)) n++
    const id = `m${n}`
    postEdit(`locator.${id}`, String(bar))
    // Open the rename field immediately: an unnamed marker at bar 101 is barely better than no
    // marker at all, and naming it is the entire point of the feature.
    setLocatorRename({ id, draft: '' })
  }, [locators, newLocatorBar, totalBars])

  const commitLocatorRename = useCallback(() => {
    setLocatorRename((cur) => {
      if (!cur) return null
      // Same sanitization as scene rename: the format has no quoted strings, so spaces become
      // underscores (and are rendered back as spaces) rather than being silently dropped.
      const sanitized = cur.draft.trim().replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_-]/g, '')
      if (sanitized) postEdit(`locator.${cur.id}.name`, sanitized)
      return null
    })
  }, [])

  const removeLocator = useCallback((id: string) => {
    postEdit(`locator.${id}`, '')
    setLocatorRename((cur) => (cur?.id === id ? null : cur))
  }, [])

  // Prev/next marker relative to where the transport is now. Ties (a marker exactly at the current
  // bar) resolve away from the current position so repeated presses always keep moving.
  const jumpMarker = useCallback(
    (dir: -1 | 1) => {
      if (locators.length === 0) {
        showToast('No markers yet — press M (or "+ marker") to drop one at the playhead.')
        return
      }
      // Same "remembered position survives a stop" rule as newLocatorBar above; before a first
      // playback there is nowhere to be relative to, so start from bar 1.
      const here = playheadBar() ?? 1
      const target = dir === 1 ? locators.find((l) => l.bar > here) : [...locators].reverse().find((l) => l.bar < here)
      if (!target) {
        showToast(dir === 1 ? 'Already at the last marker.' : 'Already at the first marker.')
        return
      }
      jumpToLocator(target.bar)
    },
    [locators, playheadBar, jumpToLocator],
  )

  // ── Arrangement keyboard shortcuts (Phase 41 Stream D) ───────────────────────────────────────
  // Registered on the window, like App.tsx's own Shift+Tab/undo handlers, and guarded the same way
  // against form-control focus so they never hijack the BPM box or a rename field.
  //
  // The arrow and split keys additionally require a clip-block selection (`selectedOcc`). That is
  // the deliberate boundary against NoteView's own window-level arrow handler: `selectedOcc` is
  // arrangement-only state that the note editor never sets, so "arrows nudge whichever thing you
  // actually have selected" resolves without the two handlers having to know about each other.
  // Space, marker navigation and zoom carry no such guard — they are view-wide concerns.
  //
  // Every row here is mirrored in ShortcutHelp.tsx's Arrangement group, in this same diff.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return // leave undo/redo/zoom-wheel modifiers alone
      const el = document.activeElement as HTMLElement | null
      const tag = el?.tagName
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || el?.isContentEditable) return

      if (e.key === ' ') {
        // Space is sacred in a DAW: it plays even when a toolbar button happens to hold focus, so
        // blur the button rather than letting the browser re-activate it.
        if (tag === 'BUTTON') el?.blur()
        e.preventDefault()
        if (useStore.getState().playing) engine.stop()
        else void engine.play()
        return
      }
      if (e.key === '0') {
        e.preventDefault()
        setSelectedOcc(new Set())
        setSelectedSection(null)
        postSelection({})
        return
      }
      if (e.key === 'm' || e.key === 'M') {
        e.preventDefault()
        addLocator()
        return
      }
      if (e.key === ',') {
        e.preventDefault()
        jumpMarker(-1)
        return
      }
      if (e.key === '.') {
        e.preventDefault()
        jumpMarker(1)
        return
      }
      if (e.key === 'z' || e.key === 'Z') {
        e.preventDefault()
        zoomToSelection()
        return
      }
      if (e.key === 'x' || e.key === 'X') {
        e.preventDefault()
        zoomBack()
        return
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        if (selectedOcc.size === 0) return // not ours — see the NoteView boundary note above
        e.preventDefault()
        // One SECTION per press, not one bar: a section index is the only grid a clip occurrence
        // can actually live on (ClipOccurrence's own doc comment), and it is the same unit the
        // drag gesture snaps to, so nudge and drag agree by construction.
        const dir = e.key === 'ArrowRight' ? 1 : -1
        const anchor = Math.min(...[...selectedOcc].map((k) => Number(k.split('::')[1])))
        moveOccurrences(selectedOcc, dir, anchor + dir)
        return
      }
      if (e.key === 's' || e.key === 'S') {
        if (selectedOcc.size === 0) return
        const trackId = [...selectedOcc][0]!.split('::')[0]!
        const track = doc?.tracks.find((t) => t.id === trackId)
        if (!track) return
        e.preventDefault()
        // Gate on kind exactly as the clip block's own split button does (it only renders on audio
        // tracks). Without this the key reaches postAudioSplit on a synth clip and surfaces a raw
        // daemon rejection — technically not silent, but a confusing error is barely better than
        // no feedback. Say the actual reason instead.
        if (track.kind !== 'audio') {
          showToast(`Split only applies to audio clips — "${track.name || track.id}" is a ${track.kind} track.`)
          return
        }
        void splitAudioAtPlayhead(track)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [addLocator, jumpMarker, zoomToSelection, zoomBack, selectedOcc, moveOccurrences, splitAudioAtPlayhead, doc, setSelectedSection])

  // ── Overview strip / minimap (Phase 41 Stream D) ─────────────────────────────────────────────
  // The whole song, always, in one screen-width strip — sections, markers, the playhead, and a
  // window showing which slice the main timeline is currently displaying. Once zoom is useful
  // enough to be worth using (which follow and zoom-to-selection make it), you spend most of your
  // time looking at 8 bars of 242 with no indication of where those 8 bars are; the strip is the
  // "you are here" the zoomed view structurally cannot give you. Click or drag it to go somewhere.
  //
  // The viewport window is positioned IMPERATIVELY from the scroll handler, never through React
  // state. Scroll fires far too often to re-render a component that owns 30 track canvases — the
  // same reasoning the file already applies to `currentStep` ("only the lightweight playhead div
  // re-renders on it"), just taken one step further because scroll has no natural 16th-note rate
  // limit at all.
  const miniRef = useRef<HTMLDivElement>(null)
  const miniWindowRef = useRef<HTMLDivElement>(null)
  const syncMiniWindow = useCallback(() => {
    const scrollEl = scrollRef.current
    const mini = miniRef.current
    const win = miniWindowRef.current
    if (!scrollEl || !mini || !win || totalBars <= 0 || renderPxPerBar <= 0) return
    const miniW = mini.clientWidth
    const pxPerBarMini = miniW / totalBars
    const firstBar = scrollEl.scrollLeft / renderPxPerBar
    const barsVisible = Math.max(0, scrollEl.clientWidth - HEADER_W) / renderPxPerBar
    win.style.left = `${Math.max(0, firstBar * pxPerBarMini)}px`
    // Clamp to a grabbable minimum: at deep zoom the true window is a sub-pixel sliver that reads
    // as "nothing is displayed" rather than "you are looking at a very small part of this".
    win.style.width = `${Math.max(6, Math.min(miniW, barsVisible * pxPerBarMini))}px`
  }, [totalBars, renderPxPerBar])

  // Re-sync whenever the geometry changes under it (zoom, song length, container resize) as well as
  // on scroll — a zoom step changes which slice is visible without any scroll event firing.
  useLayoutEffect(syncMiniWindow, [syncMiniWindow, laneWidth, locators])

  const miniSeek = useCallback(
    (clientX: number) => {
      const mini = miniRef.current
      const scrollEl = scrollRef.current
      if (!mini || !scrollEl || totalBars <= 0 || renderPxPerBar <= 0) return
      const rect = mini.getBoundingClientRect()
      const bar = ((clientX - rect.left) / Math.max(1, rect.width)) * totalBars
      const laneW = Math.max(1, scrollEl.clientWidth - HEADER_W)
      const maxScroll = Math.max(0, scrollEl.scrollWidth - scrollEl.clientWidth)
      // Centre the clicked bar: you pointed at a place, so put it in the middle of the view rather
      // than at its left edge where half the context you were aiming for is off-screen.
      scrollEl.scrollLeft = Math.max(0, Math.min(maxScroll, bar * renderPxPerBar - laneW / 2))
      syncMiniWindow()
    },
    [totalBars, renderPxPerBar, syncMiniWindow],
  )

  // Drag anywhere on the strip to scrub the view along it — same attach-on-pointerdown idiom the
  // rest of this file's one-shot gestures use.
  const beginMiniDrag = useCallback(
    (e: React.PointerEvent) => {
      if (e.button === 2) return
      e.preventDefault()
      miniSeek(e.clientX)
      const onMove = (ev: PointerEvent) => miniSeek(ev.clientX)
      const onUp = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    },
    [miniSeek],
  )

  // Window-level move/up for the resize handle: preview the new bar count while dragging, commit once
  // on release. Loop mode writes loop_bars (optimistic /edit); song mode resizes that section (/song).
  //
  // Auto-scroll on approach to the right edge (Phase 22 Stream AG): growing the section widens the
  // rendered timeline past the container (renderTotalBars * renderPxPerBar > laneWidth — see the
  // render* comment above), so there is real off-screen content to reach. Nudging .arr-scroll's
  // scrollLeft while the pointer sits near the container's right edge is what makes that content
  // actually reachable with a real mouse — the same edge-autoscroll idiom every DAW's arrangement
  // view uses for exactly this reason. The bar delta folds in how far we've auto-scrolled (not just
  // raw pointer movement), since holding the mouse still while the view scrolls under it is the same
  // gesture as moving the mouse further right over static content.
  useEffect(() => {
    if (!resize) return
    const EDGE_PX = 36
    const SCROLL_STEP = 28
    const onMove = (e: PointerEvent) => {
      const scrollEl = scrollRef.current
      if (scrollEl) {
        const rect = scrollEl.getBoundingClientRect()
        if (e.clientX > rect.right - EDGE_PX) {
          scrollEl.scrollLeft = Math.min(scrollEl.scrollLeft + SCROLL_STEP, scrollEl.scrollWidth - scrollEl.clientWidth)
        }
      }
      setResize((r) => {
        if (!r) return r
        const scrollLeftNow = scrollEl?.scrollLeft ?? r.startScrollLeft
        const delta = (e.clientX - r.startX + (scrollLeftNow - r.startScrollLeft)) / (resizePxPerBar.current || 1)
        return { ...r, bars: clampBars(r.startBars + delta) }
      })
    }
    const onUp = () => {
      setResize((r) => {
        if (r && r.bars !== r.startBars) {
          if (songMode) void postSong({ op: 'resize', index: r.index, bars: r.bars, policy: overlapPolicy })
          else changeLoopBars(r.bars)
        }
        return null
      })
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [resize, songMode, overlapPolicy])

  // Window-level move/up so a drag that leaves the element still tracks and always commits.
  //
  // Phase 24 Stream CE: a plain CLICK on the ruler (pointerdown+pointerup with negligible on-screen
  // movement) seeks the transport there instead of committing the trivial one-bar selection a click
  // used to produce — distinct from an actual drag-to-select gesture, which still works exactly as
  // before (including on the ruler, once the pointer has genuinely moved). Judged on raw pixel
  // movement (CLICK_MOVE_PX), not bar delta — bar granularity alone would misclassify a real short
  // drag that doesn't cross a bar boundary. Track-row axes are unaffected; click-to-seek is
  // ruler-only, matching the plan's "clicking A SPOT ON THE RULER" framing.
  useEffect(() => {
    if (!drag) return
    const onMove = (e: PointerEvent) => {
      setDrag((d) => (d ? { ...d, cur: barFromClientX(e.clientX) } : d))
      // Phase 24 Stream CC: for a track-lane-originated drag (not the ruler), track every row the
      // pointer physically passes over — elementFromPoint against the live DOM rather than
      // re-deriving each row's stacked height (ROW_H + variable automation-lane extras + group
      // headers) a second time here; the DOM already knows.
      if (drag.axis !== 'ruler') {
        const el = document.elementFromPoint(e.clientX, e.clientY)
        const laneEl = el instanceof Element ? el.closest('.arr-lane') : null
        const tid = laneEl?.getAttribute('data-track')
        if (tid) rowsSpannedRef.current.add(tid)
      }
    }
    const onUp = (e: PointerEvent) => {
      setDrag((d) => {
        if (d) {
          // Phase 24 Stream CE: a plain click on the ruler seeks instead of committing a trivial
          // one-bar selection — see this effect's own header comment above.
          const isClick = Math.abs(e.clientX - dragStartClientX.current) < CLICK_MOVE_PX
          if (d.axis === 'ruler' && isClick) {
            engine.seek(d.start)
            return null
          }
          if (d.axis !== 'ruler' && isClick) {
            // Bug 2 fix (Phase 27 Stream EA): a plain click anywhere in a track's `.arr-lane` row —
            // not just its name button (clickHeader, which sets the SAME three things) — should also
            // open that track's clip in the bottom pane. Without this, clicking the lane only ever
            // touched the bar-range `selection` state below, leaving `selectedTrack` (and therefore
            // the bottom pane) pointed at whichever track's NAME was last clicked — two state slices
            // that look like one "select this track's row" gesture but silently weren't wired
            // together. A real drag (isClick false) still does bar-range selection only, unchanged.
            setSelectedTrack(d.axis)
            postEdit('selected_track', d.axis)
            setBottomPaneOpen(true)
            // Phase 31 Stream KA items 2(a)/2(b): a plain click on a track's row can land either on
            // the loop-mode synthetic block (Phase 27 Stream EA bug 1 routes its pointerdown here,
            // not through onOccPointerDown/beginClipDrag, specifically to keep bar-range-selection
            // dragging working on that row) or on genuinely BARE lane space over a song-mode section
            // this track has no clip in (research/93: "+ insert scene"'s empty section had no
            // clickable block at all — nothing DOM-present to retarget the editor with, since
            // trackOccurrences only ever returns entries for sections a track already has a clip
            // in). Rather than synthesizing new placeholder DOM chrome for every empty section
            // (considered, but rejected — see displayOccurrences's own comment: it would have turned
            // every silent section into a `.arr-clip-block`, breaking Phase 24 Stream CC's
            // marquee-select-from-empty-space gesture, which specifically starts a drag from bare
            // lane space), resolve which section the click's own bar position falls into and set
            // selectedSectionIndex directly — the same "which section is the user pointed at" signal
            // a populated clip-block click already sets (beginClipDrag's own onUp), now reachable
            // from bare lane space too. `sections` is `[{startBar:0, bars:loopBars}]` in loop mode,
            // so this naturally resolves to index 0 there (item 2(a)'s case) without a separate
            // branch.
            const clickedSection = sections.findIndex((s) => d.start >= s.startBar && d.start < s.startBar + s.bars)
            if (clickedSection >= 0) setSelectedSection(clickedSection)
          }
          const start = Math.min(d.start, d.cur)
          const end = Math.max(d.start, d.cur) + 1 // inclusive bar → exclusive end; selection needs start < end
          const bars = { start, end }
          postSelection(d.axis === 'ruler' ? { bars } : { tracks: [d.axis], bars })
          // Phase 24 Stream CC: derive the clip-occurrence marquee selection from the SAME
          // gesture — every occurrence, on every row the pointer crossed, whose bar range
          // intersects [start, end). A ruler drag doesn't touch this (full-width bar-range select
          // only); a plain click (zero-width row set beyond the seeded starting row, 1-bar range)
          // naturally degenerates to "select whatever's exactly there, else clear" — no separate
          // click-to-deselect path needed.
          if (d.axis !== 'ruler') {
            const next = new Set<string>()
            for (const tid of rowsSpannedRef.current) {
              for (const occ of occurrencesByTrack.get(tid) ?? []) {
                // v0.11 (Phase 36 PD): intersect against the occurrence's REAL block extent
                // (startStep/lengthSteps) — a placement at step 32 isn't selected by a marquee
                // over the section's first bar it doesn't touch.
                if (occ.startStep / 16 < end && (occ.startStep + occ.lengthSteps) / 16 > start) next.add(occKey(tid, occ.sectionIndex, occ.at))
              }
            }
            setSelectedOcc(next)
          }
        }
        return null
      })
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [drag, barFromClientX, occurrencesByTrack, setSelectedTrack, setBottomPaneOpen, sections, setSelectedSection])

  // Phase 24 Stream CE: loop-region controls. `setLoopRange` is the one place that writes
  // `loopRegion` — no separate "push this to the engine" call is needed: engine.ts's `tick()` reads
  // `loopRegion` fresh from the store on every scheduled step, so a running transport picks up a
  // newly set/cleared region on its very next tick automatically.
  const setLoopRange = useCallback(
    (range: { start: number; end: number } | null) => {
      setLoopRegion(range)
    },
    [setLoopRegion],
  )
  // Loop whatever bar range is currently selected via the existing selection axis (drag the ruler or
  // a track — docs/phase-13-views.md's "Selection wired to /selection"), reusing it rather than a
  // second selection mechanism.
  const loopThisSelection = useCallback(() => {
    if (selection.bars) setLoopRange({ start: selection.bars.start, end: selection.bars.end })
  }, [selection.bars, setLoopRange])
  // A section chip's own "loop this section" toggle (song mode only): loop just that section's bar
  // range, or clear the region if it's already looping exactly that section (a toggle, not just a
  // setter — clicking an already-active section's loop button turns looping off).
  const loopThisSection = useCallback(
    (i: number) => {
      const sec = sections[i]
      if (!sec) return
      const range = { start: sec.startBar, end: sec.startBar + sec.bars }
      const alreadyThis = loopRegion && loopRegion.start === range.start && loopRegion.end === range.end
      setLoopRange(alreadyThis ? null : range)
    },
    [sections, loopRegion, setLoopRange],
  )

  const clickHeader = useCallback(
    (t: BeatTrack) => {
      setSelectedTrack(t.id)
      postEdit('selected_track', t.id)
      postSelection({ tracks: [t.id] })
      // Selecting a track (re)opens the bottom detail pane on it — Ableton's "selection drives the
      // bottom pane" idiom, and the way a collapsed pane comes back.
      setBottomPaneOpen(true)
    },
    [setSelectedTrack, setBottomPaneOpen],
  )

  // Add a track of a chosen kind (Phase 20 Stream W). Mints a unique id from the kind (synth,
  // synth2, …), defers name/color to core's defaults (color cycles TRACK_COLORS by index), then
  // selects the new track. Instrument tracks need a registered SoundFont sample — the GUI has no
  // sample-registration surface, so it reuses the first media sample if one exists, else the option
  // is disabled with a tooltip pointing at `beat sample` (honest: the GUI can't register samples).
  const addTrackOfKind = useCallback(
    async (kind: AddTrackOpts['kind']) => {
      const d = useStore.getState().doc
      if (!d) return
      setAddOpen(false)
      const ids = new Set(d.tracks.map((t) => t.id))
      let id: string = kind
      for (let i = 2; ids.has(id); i++) id = `${kind}${i}`
      const opts: Parameters<typeof postAddTrack>[0] = { id, kind }
      if (kind === 'instrument') {
        const sample = (d.media as { id?: string }[])[0]?.id
        if (!sample) {
          showToast('Instrument tracks need a registered SoundFont sample. Register one with `beat sample` first.')
          return
        }
        opts.soundfont = { sample, program: 0 }
      }
      setAddBusy(true)
      try {
        await postAddTrack(opts)
        setSelectedTrack(id)
        postEdit('selected_track', id)
        postSelection({ tracks: [id] })
      } catch (err) {
        showToast(`Could not add track: ${(err as Error).message}`)
      } finally {
        setAddBusy(false)
      }
    },
    [setSelectedTrack],
  )

  // ── Track grouping (Phase 22 Stream AF) ─────────────────────────────────────────────────────
  const toggleGroupPick = useCallback((id: string) => {
    setGroupPick((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const createGroup = useCallback(async () => {
    const trackIds = [...groupPick]
    if (trackIds.length < 2) return
    setGroupBusy(true)
    try {
      await postGroupOp({ op: 'create', trackIds })
      setGroupPick(new Set())
    } catch (err) {
      showToast(`Could not group tracks: ${(err as Error).message}`)
    } finally {
      setGroupBusy(false)
    }
  }, [groupPick])

  const ungroup = useCallback(async (groupId: string) => {
    try {
      await postGroupOp({ op: 'delete', id: groupId })
    } catch (err) {
      showToast(`Could not ungroup: ${(err as Error).message}`)
    }
  }, [])

  // Collapse/expand is local-only (never posts anywhere) — see the GroupHeaderRow comment above.
  const toggleGroupCollapsed = useCallback((groupId: string) => {
    setCollapsedGroups((prev) => ({ ...prev, [groupId]: !prev[groupId] }))
  }, [])

  // ── New-project-from-scratch + save-as-template (Phase 22 Stream AF) ───────────────────────────
  // Plain browser `window.prompt`s, not a native file picker: unlike "open folder…" (Tauri-only,
  // disabled outside the desktop shell — see tauri.ts), these three hit the daemon's own HTTP routes
  // directly (POST /new-project, POST /save-as-template — src/daemon/daemon.ts) and so work, and are
  // verifiable live, in ANY browser the GUI runs in, desktop shell or plain `vite dev`. A single
  // prompt captures "a folder, or a path ending in .beat" — typing `myproj/mysong.beat` picks both
  // the destination and the file name in one go, so there's no separate name prompt to chain.
  const createNewProject = useCallback(async () => {
    const path = window.prompt('New project — destination folder (or a path ending in .beat):')
    if (!path) return
    setProjectBusy(true)
    try {
      const base = daemonBase()
      const res = await fetch(`${base}/new-project`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path }),
      })
      const body = (await res.json()) as { filePath?: string; error?: string }
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
      // Phase 31 Stream KE item 3 (docs/research/92: the old browser-mode text, "Point a beat daemon
      // at it to open it," assumed CLI knowledge a GUI-only user has no way to act on). The
      // constraint is real either way — this running tab can't retarget its own daemon to a
      // different file — but the wording now matches "open folder…"'s own disabled-state tooltip
      // (`available in the desktop app — switches the daemon to another project folder`), so both
      // surfaces explain the same underlying limitation the same honest way instead of one assuming
      // CLI fluency.
      showToast(
        `Created ${body.filePath}.\n\n${isTauri() ? 'Use "open folder…" to switch to it.' : 'Switching to it is available in the desktop app (or the CLI) — this browser tab can\'t retarget the daemon to a different file.'}`,
        'success',
      )
    } catch (err) {
      showToast(`Could not create project: ${(err as Error).message}`)
    } finally {
      setProjectBusy(false)
    }
  }, [])

  const newProjectFromTemplate = useCallback(async () => {
    const from = window.prompt('Start a new project from a template — path to the template .beat file:')
    if (!from) return
    const path = window.prompt('New project — destination folder (or a path ending in .beat):')
    if (!path) return
    setProjectBusy(true)
    try {
      const base = daemonBase()
      const res = await fetch(`${base}/new-project`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path, from }),
      })
      const body = (await res.json()) as { filePath?: string; error?: string }
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
      // See createNewProject's matching comment above — same honest, desktop-app/CLI-framed wording
      // for the same browser-mode "this tab can't retarget itself" constraint.
      showToast(
        `Created ${body.filePath} from template ${from}.\n\n${isTauri() ? 'Use "open folder…" to switch to it.' : 'Switching to it is available in the desktop app (or the CLI) — this browser tab can\'t retarget the daemon to a different file.'}`,
        'success',
      )
    } catch (err) {
      showToast(`Could not create project from template: ${(err as Error).message}`)
    } finally {
      setProjectBusy(false)
    }
  }, [])

  const saveAsTemplate = useCallback(async () => {
    const path = window.prompt('Save this project as a template — destination folder (or a path ending in .beat):')
    if (!path) return
    setProjectBusy(true)
    try {
      const base = daemonBase()
      const res = await fetch(`${base}/save-as-template`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path }),
      })
      const body = (await res.json()) as { filePath?: string; error?: string }
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
      showToast(`Saved template to ${body.filePath}. This project's file is untouched.`, 'success')
    } catch (err) {
      showToast(`Could not save template: ${(err as Error).message}`)
    } finally {
      setProjectBusy(false)
    }
  }, [])

  if (!doc) return null

  // Resolve the band to show per axis: an in-progress drag wins; otherwise the committed selection.
  const dragBand: Band = drag ? { start: Math.min(drag.start, drag.cur), end: Math.max(drag.start, drag.cur) + 1 } : null
  const committedBand: Band = selection.bars ?? null
  const selTracks = selection.tracks
  // Phase 27 Stream EC (research/70 §3.5, item 2): a bar-range selection paints as a band across
  // EVERY visible track row, matching Ableton's own default — a time-range selection is a full
  // vertical band across the whole arrangement, not a highlight confined to whichever row was
  // physically dragged across. This applies whether the drag/selection originated on the ruler OR
  // inside one specific track's lane (Ableton's own lane-drag ALSO sets a full-arrangement time
  // selection). Purely a RENDERING-scope widening: `selTracks`/`drag.axis` still exist and still
  // drive the actual selection DATA sent via `postSelection` below (a lane drag still scopes the
  // daemon's selection to that one track — the same value `beat vary --scope selection` and any
  // other selection-reading op see) — only how many rows visually tint has changed, not what's
  // selected.
  function bandForTrack(): Band {
    return drag ? dragBand : committedBand
  }
  const rulerBand: Band = drag ? (drag.axis === 'ruler' ? dragBand : null) : committedBand

  const modeLabel = detail ? 'detail view' : `density view (${pxPerBar.toFixed(1)}px/bar)`

  // Bar-number ticks along the ruler (Phase 24 Stream CD). Built from renderTotalBars/renderPxPerBar
  // (not the plain totalBars/pxPerBar) so ticks track the SAME live values the section labels and
  // resize preview already use — including the frozen px/bar + trailing buffer while a resize drag is
  // in progress. Bar counts here are small (tens, not thousands), so a plain array built fresh each
  // render is cheap enough that a useMemo would be overkill (matches modeLabel/showPlayhead above,
  // also plain per-render consts).
  const tickInterval = tickIntervalFor(renderPxPerBar)
  const barTicks: number[] = []
  for (let b = 0; b < renderTotalBars; b += tickInterval) barTicks.push(b)
  // Once there's real room to spare (double the detail threshold), also draw unlabeled minor ticks at
  // each quarter-bar (beat) — "finer subdivision at high zoom," the same LOD instinct DETAIL_PX_PER_BAR
  // already applies to note/hit rendering, extended to the ruler. Only meaningful when tickInterval is
  // already 1 (guaranteed at this px/bar), so it can safely reuse barTicks as the per-bar list.
  const showBeatTicks = renderPxPerBar >= DETAIL_PX_PER_BAR * 2
  // Phase 41 Stream D: seconds per bar at the document's implicit 4/4 (see TransportBar's own note
  // — a per-clip `signature` may override the meter locally, but there is no document-level one, so
  // the ruler has nothing else to compute a wall clock from). The tick-clock label needs roughly
  // TICK_CLOCK_MIN_PX between consecutive LABELLED ticks (tickInterval bars apart, not one bar) to
  // sit beside the bar number without the two overlapping.
  const secPerBar = doc ? 240 / doc.bpm : 0
  const showTickClock = tickInterval * renderPxPerBar >= TICK_CLOCK_MIN_PX

  // Playhead x in scroll-content coordinates: header column + fractional bar position. Step-precise
  // (finer than the requested bar granularity, at no extra cost). Shown only while the transport is
  // running and the position is within the song. It scrolls horizontally with the lanes (absolutely
  // positioned inside the scroll container) and spans just the track rows, below the sticky ruler.
  const totalSteps = totalBars * 16
  const showPlayhead = currentStep >= 0 && currentStep < totalSteps && renderPxPerBar > 0
  const playheadLeft = HEADER_W + (currentStep / 16) * renderPxPerBar

  // Extra vertical space the automation sub-lanes + open pickers add below the plain track rows, so
  // the playhead spans the whole (taller) stack. Only counts rows that actually render — a collapsed
  // group's members (and their automation) contribute nothing (rowPlan already omits them).
  const visibleTrackRows = rowPlan.filter((r): r is RowPlanTrackRow => r.kind === 'track')
  const groupHeaderRows = rowPlan.filter((r) => r.kind === 'group-header').length
  const autoExtra = visibleTrackRows.reduce((sum, r) => {
    const t = r.flat.track
    const lanes = visibleParamsFor(t).length
    const occ = occurrencesByTrack.get(t.id) ?? []
    const pickerOpen = autoOpen[t.id] && occ.length > 0 && autoOptionsFor(t.kind).length > 0
    return sum + lanes * AUTO_H + (pickerOpen ? PICKER_H : 0)
  }, 0)
  const contentRowsHeight = visibleTrackRows.length * ROW_H + groupHeaderRows * GROUP_HEADER_H

  return (
    <div className="arrangement" onClickCapture={handleArrangementClickCapture}>
      <div className="editor-toolbar">
        <span className="section-heading">arrangement</span>
        <span className="toolbar-tip">
          {totalBars} bars · {sections.length} section{sections.length === 1 ? '' : 's'} · {modeLabel} · drag the ruler or a track to select bars · click a track name to select it, double-click to rename it · click a section's name or clip to view/edit its content below
        </span>
        <div className="arr-project-controls">
          <div className="arr-addtrack">
            <button
              className="arr-toolbtn"
              data-action="add-track"
              onClick={() => setAddOpen((o) => !o)}
              disabled={addBusy}
              title="add a track"
            >
              + track
            </button>
            {addOpen && (
              <div className="arr-addtrack-menu">
                {TRACK_KINDS.map((k) => {
                  const needsSample = k === 'instrument' && (doc.media as unknown[]).length === 0
                  return (
                    <div key={k} className="arr-addtrack-item-wrap">
                      <button
                        className="arr-addtrack-item"
                        data-add-kind={k}
                        disabled={needsSample}
                        title={needsSample ? 'needs a registered SoundFont sample (beat sample)' : `add a ${k} track`}
                        onClick={() => void addTrackOfKind(k)}
                      >
                        {k}
                      </button>
                      {/* Phase 30 Stream JD, item 2 (docs/research/87/88): the disabled tooltip alone
                          ("needs a registered SoundFont sample (beat sample)") is a browser-native
                          title, invisible without a deliberate hover, and worded in CLI vocabulary
                          ("beat sample") a GUI-only user won't recognize. Point proactively at the
                          real, pleasant unlock path pilot 88 confirmed works well: the Content
                          Browser's SoundFonts section, whose own "+" button creates a ready-to-use
                          Instrument track in one click — no separate "+ track" step needed. */}
                      {needsSample && (
                        <span className="arr-addtrack-item-hint" data-add-kind-hint={k}>
                          needs a SoundFont first — add one from the Browser&apos;s SoundFonts section
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
          <button
            className="arr-toolbtn"
            data-action="group-tracks"
            disabled={groupPick.size < 2 || groupBusy}
            title={groupPick.size < 2 ? 'pick at least 2 tracks (checkbox in each track header) to group' : `fold ${groupPick.size} picked tracks into a group`}
            onClick={() => void createGroup()}
          >
            + group{groupPick.size >= 2 ? ` (${groupPick.size})` : ''}
          </button>
          <button
            className="arr-toolbtn"
            data-action="open-folder"
            disabled={!isTauri()}
            title={isTauri() ? 'open a different project folder' : 'available in the desktop app — switches the daemon to another project folder'}
            onClick={() => void openProjectFolder()}
          >
            open folder…
          </button>
          <button
            className="arr-toolbtn"
            data-action="new-project"
            disabled={projectBusy}
            title="create a brand new .beat project from scratch"
            onClick={() => void createNewProject()}
          >
            new project…
          </button>
          <button
            className="arr-toolbtn"
            data-action="new-from-template"
            disabled={projectBusy}
            title="start a new project as a fresh copy of a saved template"
            onClick={() => void newProjectFromTemplate()}
          >
            new from template…
          </button>
          <button
            className="arr-toolbtn"
            data-action="save-template"
            disabled={projectBusy}
            title="save a copy of THIS project as a template (never mutates this project)"
            onClick={() => void saveAsTemplate()}
          >
            save as template…
          </button>
        </div>
      </div>

      {/* Length controls (Phase 19). Loop mode: shrink/grow loop_bars, or split into sections. Song
          mode: per-section resize/delete + append (the section's right-edge handle in the ruler drags
          the same lengths). */}
      <div className="arr-length-bar">
        {songMode ? (
          <>
            <span className="arr-length-label">sections</span>
            {doc.song!.map((s, i) => {
              const isDragging = sectionDrag.draggingIndex === i
              const isDropTarget = sectionDrag.overIndex === i && sectionDrag.draggingIndex !== null && sectionDrag.draggingIndex !== i
              const shareCount = sceneShareCounts.get(s.scene) ?? 1
              // Phase 32 Stream LB: the chip shows the scene's own display name when it has one
              // (underscores rendered as spaces — the internal slug/display-label split other
              // per-id fields in this format already lean on), falling back to the raw scene id —
              // never blank, matching the existing "section chips show something" contract.
              const sceneObj = doc.scenes.find((sc) => sc.id === s.scene)
              const sceneDisplayName = (sceneObj?.name ?? s.scene).replace(/_/g, ' ')
              // Scoped by sectionIndex, not just sceneId — see the sceneRename declaration's comment
              // above for why (two sections can share one scene; only the double-clicked CHIP should
              // open an input, even though the commit still applies scene-wide).
              const isRenamingThis = sceneRename?.sceneId === s.scene && sceneRename.sectionIndex === i
              const chipClasses = [
                'arr-section-chip',
                isDragging && 'dragging',
                isDropTarget && 'drop-target',
                selectedSectionIndex === i && 'selected-section',
              ]
                .filter(Boolean)
                .join(' ')
              return (
              <span
                className={chipClasses}
                data-section-chip={i}
                key={i}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = 'move'
                  e.dataTransfer.setData('text/plain', String(i))
                  setSectionDrag({ draggingIndex: i, overIndex: null })
                }}
                onDragOver={(e) => {
                  if (sectionDrag.draggingIndex === null) return
                  e.preventDefault()
                  if (sectionDrag.draggingIndex !== i) setSectionDrag((d) => ({ ...d, overIndex: i }))
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  const from = sectionDrag.draggingIndex
                  setSectionDrag({ draggingIndex: null, overIndex: null })
                  if (from === null || from === i) return
                  void postSong({ op: 'move', from, to: i })
                }}
                onDragEnd={() => setSectionDrag({ draggingIndex: null, overIndex: null })}
              >
                <span className="arr-chip-drag-handle" data-section-drag-handle={i} title="drag to reorder">
                  ⠿
                </span>
                {isRenamingThis ? (
                  <input
                    className="arr-chip-name-input"
                    data-rename-scene={s.scene}
                    autoFocus
                    value={sceneRename!.draft}
                    onChange={(e) => setSceneRename({ sceneId: s.scene, sectionIndex: i, draft: e.target.value })}
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.currentTarget.blur()
                      } else if (e.key === 'Escape') {
                        setSceneRename(null)
                      }
                    }}
                    onBlur={commitSceneRename}
                  />
                ) : (
                  <span
                    className="arr-chip-name"
                    data-section-select={i}
                    title={`scene "${s.scene}"${sceneObj?.name ? ` (named "${sceneDisplayName}")` : ''} — click to view/edit this section's content below, double-click to rename`}
                    onClick={() => setSelectedSection(i)}
                    onDoubleClick={() => {
                      setSelectedSection(i)
                      setSceneRename({ sceneId: s.scene, sectionIndex: i, draft: sceneObj?.name ?? '' })
                    }}
                  >
                    {sceneDisplayName}
                  </span>
                )}
                {shareCount > 1 && (
                  <span
                    className="arr-chip-linked"
                    data-linked-scene={s.scene}
                    style={{ background: sceneLinkColor(s.scene) }}
                    title={`shares scene "${s.scene}" with ${shareCount - 1} other section${shareCount - 1 === 1 ? '' : 's'} — editing one edits all of them (sections with a matching dot share content)`}
                  >
                    ⛓
                  </span>
                )}
                <button
                  className="arr-chip-btn"
                  data-section-move-left={i}
                  title="move left (earlier in the song)"
                  disabled={i === 0}
                  onClick={() => postSong({ op: 'move', from: i, to: i - 1 })}
                >
                  ◀
                </button>
                <button
                  className="arr-chip-btn"
                  data-section-move-right={i}
                  title="move right (later in the song)"
                  disabled={i === doc.song!.length - 1}
                  onClick={() => postSong({ op: 'move', from: i, to: i + 1 })}
                >
                  ▶
                </button>
                <button
                  className="arr-chip-btn"
                  data-section-minus={i}
                  title="one bar shorter"
                  disabled={s.bars <= LOOP_MIN}
                  onClick={() => postSong({ op: 'resize', index: i, bars: s.bars - 1, policy: overlapPolicy })}
                >
                  −
                </button>
                <span className="arr-chip-bars" data-section-bars={i}>{s.bars}</span>
                <button
                  className="arr-chip-btn"
                  data-section-plus={i}
                  title={
                    overlapPolicy === 'keep-existing' && i < doc.song!.length - 1
                      ? 'growing this section would overlap the next one, and the "keep existing" policy refuses that — switch policy or grow the last section'
                      : 'one bar longer'
                  }
                  disabled={s.bars >= LOOP_MAX || (overlapPolicy === 'keep-existing' && i < doc.song!.length - 1)}
                  onClick={() => postSong({ op: 'resize', index: i, bars: s.bars + 1, policy: overlapPolicy })}
                >
                  +
                </button>
                <button
                  className="arr-chip-btn del"
                  data-section-delete={i}
                  title="delete section"
                  disabled={doc.song!.length <= 1}
                  onClick={() => postSong({ op: 'delete', index: i })}
                >
                  ×
                </button>
                {/* Phase 24 Stream CE: loop just this section while auditioning/editing it, without
                    changing the song structure — session-only transport state (store.ts's
                    loopRegion), toggled off by clicking again. */}
                <button
                  className={`arr-chip-btn arr-chip-loop${
                    loopRegion && sections[i] && loopRegion.start === sections[i]!.startBar && loopRegion.end === sections[i]!.startBar + sections[i]!.bars
                      ? ' active'
                      : ''
                  }`}
                  data-section-loop={i}
                  title="loop just this section while auditioning it (click again to stop)"
                  onClick={() => loopThisSection(i)}
                >
                  ⟲
                </button>
              </span>
              )
            })}
            {/* Phase 31 Stream KE item 4 (docs/research/86/87/88/90/93, repeatedly): "+ section" is
                first, most prominent, and most inviting to click, but it's also the footgun — it
                REUSES the last section's scene by reference, so editing one section's clips silently
                edits every other section sharing that scene. The two buttons below it are the
                genuinely independent options, but "+ capture scene" (the one that actually gives
                populated, independent, editable content per track — what most pilots wanted) read as
                a performance/recording action rather than an authoring one, and sat last/least
                prominent of the three. Existing tooltips are already accurate and specific (pilot
                87) — left unchanged. This is a label/visual-prominence fix only: the visible button
                text now spells out the "shares content" vs. "independent copy" distinction directly
                (so it's legible without hovering), and `.arr-add-section-shared`/
                `-independent` give a subtle color cue (default vs. `--good`) reinforcing the same
                thing at a glance. DOM order and all three `data-*` selectors are unchanged — every
                verify-*.mjs script that drives these buttons selects by attribute, not position. */}
            <button
              className="arr-add-section arr-add-section-shared"
              data-add-section="1"
              title="append a section (duplicates the last section's content)"
              onClick={() => postSong({ op: 'append', bars: doc.song![doc.song!.length - 1]!.bars })}
            >
              + section <span className="arr-add-section-hint">(shares content)</span>
            </button>
            {/* Phase 26 Stream DJ: unlike "+ section" (which always REUSES the last section's scene
                — the exact behavior that lets editing one section's clips silently edit every other
                section sharing that scene), these two mint a genuinely NEW, independent scene id
                before inserting. "insert scene" starts it empty (place clips via the piano roll's
                own "Place in Arrangement" flow afterward); "capture scene" starts it pre-populated
                by snapshotting every track's current live (on-screen, possibly unsaved) content.
                Both land at the end of the timeline, same default position "+ section" itself uses
                — the daemon route accepts an arbitrary index for scripted/future callers. */}
            <button
              className="arr-add-section arr-add-section-independent"
              data-insert-scene="1"
              title="insert a new, empty, fully independent scene as a new section at the end of the song — no clips shared with any other section"
              onClick={() => postSong({ op: 'insert', index: doc.song!.length, bars: doc.song![doc.song!.length - 1]!.bars })}
            >
              + insert scene <span className="arr-add-section-hint">(independent, empty)</span>
            </button>
            <button
              className="arr-add-section arr-add-section-independent"
              data-capture-insert-scene="1"
              title="snapshot every track's current live content into a new, independent scene, inserted as a new section at the end of the song"
              onClick={() => postSong({ op: 'captureInsert', index: doc.song!.length, bars: doc.song![doc.song!.length - 1]!.bars })}
            >
              + capture scene <span className="arr-add-section-hint">(independent copy)</span>
            </button>
          </>
        ) : (
          <>
            <span className="arr-length-label">loop length</span>
            <button
              className="arr-chip-btn"
              data-loop-minus="1"
              title="one bar shorter"
              disabled={doc.loopBars <= LOOP_MIN}
              onClick={() => changeLoopBars(doc.loopBars - 1)}
            >
              −
            </button>
            <span className="arr-chip-bars" data-loop-bars>{doc.loopBars} bars</span>
            <button
              className="arr-chip-btn"
              data-loop-plus="1"
              title="one bar longer"
              disabled={doc.loopBars >= LOOP_MAX}
              onClick={() => changeLoopBars(doc.loopBars + 1)}
            >
              +
            </button>
            <button
              className="arr-add-section"
              data-add-section="1"
              title="split into arrangement sections (keeps this loop as the first section)"
              onClick={() => postSong({ op: 'append', bars: doc.loopBars })}
            >
              + section
            </button>
          </>
        )}
        {/* Phase 22 Stream AG: the overlap-resolution preference every resize (chips above + the
            ruler's drag handle below) reads. Only ever matters in song mode with 2+ sections (a
            single section, or growing the last one, never overlaps anything — every policy behaves
            identically there), but it's always shown so it's discoverable/settable ahead of time. */}
        <label className="arr-overlap-policy" title="what happens when resizing a section would grow it into the next one's space (docs/research/22-opendaw-editing-workflow.md §2.1)">
          overlap
          <select
            className="arr-overlap-select"
            data-overlap-policy=""
            value={overlapPolicy}
            onChange={(e) => setOverlapPolicy(e.target.value as OverlapPolicy)}
          >
            {OVERLAP_POLICIES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        {/* Phase 41 Stream D: one wrappable cluster for every navigation control. Stream D added
            four buttons (zoom-to-selection, zoom-back, + marker, follow) to a row that was already
            at capacity, and pushed "loop selection" clean off the right edge at 1280px — caught by
            reading this stream's own verify screenshot, not by any assertion. Grouping them means
            the whole cluster wraps to a second line together instead of the last item overflowing. */}
        <div className="arr-nav-controls">
        {/* Phase 24 Stream CD: timeline zoom, independent of container width. "fit" (disabled once
            already at fit) returns to the pre-Stream-CD default; +/- step pxPerBar by ZOOM_FACTOR;
            Cmd/Ctrl+scroll-wheel over the timeline (onWheelZoom below) does the same, anchored to the
            pointer. The readout doubles as a live pxPerBar probe for verification. */}
        <div className="arr-zoom-controls" title="timeline zoom (or Cmd/Ctrl+scroll over the timeline)">
          <button className="arr-toolbtn" data-action="zoom-out" disabled={pxPerBar <= MIN_PX_PER_BAR + 0.01} title="zoom out" onClick={zoomOut}>
            −
          </button>
          <span className="arr-zoom-readout" data-pxperbar={pxPerBar.toFixed(2)}>
            {Math.round(pxPerBar)}px/bar
          </span>
          <button className="arr-toolbtn" data-action="zoom-in" disabled={pxPerBar >= MAX_PX_PER_BAR - 0.01} title="zoom in" onClick={zoomIn}>
            +
          </button>
          <button className="arr-toolbtn" data-action="zoom-fit" disabled={zoomPxPerBar === null} title="fit to width" onClick={zoomFit}>
            fit
          </button>
          {/* Phase 41 Stream D: zoom-to-selection (Z) and its matching way back (X). The stack
              depth is on the button so "how many levels am I in" is visible rather than felt. */}
          <button
            className="arr-toolbtn"
            data-action="zoom-selection"
            disabled={!selection.bars}
            title={selection.bars ? `zoom to bars ${selection.bars.start + 1}–${selection.bars.end} (Z)` : 'drag the ruler or a track to select a bar range first (Z)'}
            onClick={zoomToSelection}
          >
            ⤢ sel
          </button>
          <button
            className="arr-toolbtn"
            data-action="zoom-back"
            data-zoom-stack={zoomStack.length}
            disabled={zoomStack.length === 0}
            title={zoomStack.length ? `back to the previous view (X) — ${zoomStack.length} level${zoomStack.length === 1 ? '' : 's'} deep` : 'no previous zoom to go back to (X)'}
            onClick={zoomBack}
          >
            ↩{zoomStack.length > 0 ? ` ${zoomStack.length}` : ''}
          </button>
        </div>
        {/* Phase 41 Stream D: drop a named marker at the playhead (or, stopped with a bar range
            selected, at the start of that range). Opens its rename field immediately — an unnamed
            marker at bar 101 is barely better than no marker. */}
        <button
          className="arr-toolbtn"
          data-action="add-locator"
          title={`drop a marker at bar ${Math.min(Math.max(1, newLocatorBar()), Math.max(1, totalBars))} and name it`}
          onClick={addLocator}
        >
          + marker
        </button>
        {/* Phase 41 Stream D: follow-the-playhead toggle. `data-follow` is the live probe the verify
            scripts read; the button itself is the only user-facing control for the effect above. */}
        <button
          className={`arr-toolbtn arr-follow-btn${follow ? ' on' : ''}`}
          data-action="follow-toggle"
          data-follow={follow ? '1' : '0'}
          aria-pressed={follow}
          title={follow ? 'following the playhead during playback — click to stop following' : 'not following the playhead — click to auto-scroll to it during playback'}
          onClick={() => setFollow((f) => !f)}
        >
          {follow ? '⦿ follow' : '○ follow'}
        </button>
        {/* Phase 24 Stream CE: loop-region controls — loop just the currently-SELECTED bar range
            (the same drag-the-ruler/a-track selection axis docs/phase-13-views.md's "Selection
            wired to /selection" and `beat vary --scope selection` already use) instead of the whole
            song/loop. Session-only (store.ts's loopRegion), never written to the .beat file. */}
        <div className="arr-loop-region">
          {loopRegion ? (
            <>
              <span className="arr-loop-badge" data-loop-region-active="1">
                looping bars {loopRegion.start + 1}–{loopRegion.end}
              </span>
              <button
                className="arr-toolbtn"
                data-loop-clear="1"
                title="stop looping just this range — back to the full song/loop"
                onClick={() => setLoopRange(null)}
              >
                clear loop
              </button>
            </>
          ) : (
            <button
              // Phase 41 Stream D: was `.arr-chip-btn` — an 18px FIXED SQUARE meant for the section
              // chips' single-glyph +/-/x/o icons. A two-word text label never fitted it: Phase 24
              // Stream CE's own verify screenshot shows "loop selection" spilling out of the box as
              // bare unstyled text, and it stayed that way for seventeen phases because nothing
              // asserts layout and nobody re-read the screenshot. `.arr-toolbtn` is the auto-width
              // padded text button the rest of this toolbar already uses.
              className="arr-toolbtn"
              data-loop-selection="1"
              disabled={!selection.bars}
              title={selection.bars ? `loop bars ${selection.bars.start + 1}–${selection.bars.end}` : 'drag the ruler or a track to select a bar range first'}
              onClick={loopThisSelection}
            >
              loop selection
            </button>
          )}
        </div>
        </div>
      </div>

      {/* Phase 41 Stream D: the overview strip. The whole song at a fixed screen width, whatever
          the main timeline is zoomed to — sections, markers, playhead, and the current viewport as
          a draggable window. Click or drag to move the main view. */}
      <div
        className="arr-minimap"
        ref={miniRef}
        data-minimap="1"
        data-total-bars={totalBars}
        title="overview — click or drag to move the timeline view"
        onPointerDown={beginMiniDrag}
        style={{ touchAction: 'none' }}
      >
        {sections.map((s, i) => (
          <div
            key={`mini-sec-${i}`}
            className="arr-minimap-section"
            data-minimap-section={i}
            style={{ left: `${(s.startBar / Math.max(1, totalBars)) * 100}%`, width: `${(s.bars / Math.max(1, totalBars)) * 100}%` }}
          />
        ))}
        {locators.map((l) => (
          <div
            key={`mini-loc-${l.id}`}
            className="arr-minimap-locator"
            data-minimap-locator={l.id}
            style={{ left: `${((l.bar - 1) / Math.max(1, totalBars)) * 100}%` }}
          />
        ))}
        {showPlayhead && (
          <div className="arr-minimap-playhead" style={{ left: `${(currentStep / 16 / Math.max(1, totalBars)) * 100}%` }} />
        )}
        <div className="arr-minimap-window" ref={miniWindowRef} data-minimap-window="1" />
      </div>

      <div className="arr-scroll" ref={scrollRef} onWheel={onWheelZoom} onScroll={syncMiniWindow}>
        {/* Ruler: section labels + boundaries; dragging it selects a bar range across all tracks. */}
        <div className="arr-ruler-row" style={{ height: RULER_H }}>
          <div className="arr-ruler-corner" style={{ width: HEADER_W }} />
          <div
            className="arr-ruler"
            data-pxperbar={renderPxPerBar.toFixed(2)}
            style={{ width: renderTotalBars * renderPxPerBar, touchAction: 'none' }}
            onPointerDown={(e) => beginDrag('ruler', e)}
          >
            {renderSections.map((s, i) => {
              const shareCount = sceneShareCounts.get(s.scene) ?? 1
              // Phase 32 Stream LB: same name-with-id-fallback the SECTIONS toolbar chip uses
              // (above) — a read-only display here (rename lives on the chip, not the ruler), but
              // showing the raw id in one place and the name in the other would read as two
              // different sections at a glance, so both surfaces stay in sync.
              const rulerSceneName = (doc.scenes.find((sc) => sc.id === s.scene)?.name ?? s.scene).replace(/_/g, ' ')
              return (
              <div
                key={i}
                className="arr-section-label"
                style={{ left: s.startBar * renderPxPerBar, width: s.bars * renderPxPerBar, top: LOCATOR_ROW_H, height: SECTION_LABEL_H }}
                title={
                  shareCount > 1
                    ? `${rulerSceneName} · ${s.bars} bars · shares this scene with ${shareCount - 1} other section${shareCount - 1 === 1 ? '' : 's'}`
                    : `${rulerSceneName} · ${s.bars} bars`
                }
              >
                {shareCount > 1 && (
                  <span className="arr-section-linked" style={{ background: sceneLinkColor(s.scene) }} />
                )}
                <span className="arr-section-name">{rulerSceneName}</span>
                <span className="arr-section-bars">{s.bars}</span>
              </div>
              )
            })}
            {/* Bar-number ticks (Phase 24 Stream CD): a thin strip along the bottom of the ruler,
                below the section-label row, one tick per `tickInterval` bars (zoom-aware — see
                tickIntervalFor). pointer-events:none (styles.css) so they never intercept the
                ruler's own drag-to-select/click-to-seek gestures. */}
            <div className="arr-bar-ticks" style={{ top: RULER_H - TICK_ROW_H, height: TICK_ROW_H }}>
              {barTicks.map((b) => (
                <div key={`tick-${b}`} className="arr-bar-tick" data-bar-tick={b} style={{ left: b * renderPxPerBar }}>
                  <span className="arr-bar-tick-num">{b + 1}</span>
                  {/* Phase 41 Stream D: a secondary wall-clock label on the ruler. On a 7-minute
                      arrangement "where am I" is as often a time question as a bar question, and
                      the answer shouldn't require arithmetic. Shown only when consecutive labelled
                      ticks are far enough apart to fit both figures without colliding — the same
                      level-of-detail instinct tickIntervalFor already applies to the numbers. */}
                  {showTickClock && <span className="arr-bar-tick-time">{formatClock(b * secPerBar)}</span>}
                </div>
              ))}
              {showBeatTicks &&
                barTicks.flatMap((b) =>
                  [1, 2, 3].map((q) => (
                    <div key={`beat-${b}-${q}`} className="arr-bar-tick-minor" style={{ left: (b + q / 4) * renderPxPerBar }} />
                  )),
                )}
            </div>
            {/* Phase 41 Stream D: the locator strip, along the top of the ruler. Each flag is a
                real button — click jumps the transport there (same rule as clicking the ruler
                itself: relocate while playing, start from there while stopped), double-click opens
                an inline rename, and the × removes it. `data-locator`/`data-locator-bar` are the
                probes the verify scripts read. onPointerDown stops propagation so grabbing a flag
                never also starts the ruler's own drag-to-select-bars gesture underneath it. */}
            <div className="arr-locator-strip" style={{ height: LOCATOR_ROW_H }}>
              {locators.map((l, i) => {
                const label = l.name.replace(/_/g, ' ')
                const renaming = locatorRename?.id === l.id
                // Level-of-detail, the same instinct tickIntervalFor applies to bar numbers. Two
                // markers closer together than a label's width used to draw their names ON TOP of
                // each other — the usability pilot photographed "Breakdown" and "Main 2" rendering
                // as the literal string "BMaiakd2own". At the default 5.6px/bar on a 242-bar song
                // any two markers within ~8 bars collide, which for an 8-section track is the
                // normal case, not an edge one. So when the next marker is too close, this one
                // collapses to just its pin: still visible, still clickable, still jumps, and its
                // name is still in the tooltip — but it never becomes illegible mush.
                const nextGapPx = i + 1 < locators.length ? (locators[i + 1]!.bar - l.bar) * renderPxPerBar : Infinity
                const compact = !renaming && nextGapPx < LOCATOR_LABEL_MIN_PX
                return (
                  <div
                    key={l.id}
                    className={`arr-locator${renaming ? ' renaming' : ''}${compact ? ' compact' : ''}`}
                    data-locator={l.id}
                    data-locator-bar={l.bar}
                    data-locator-name={l.name}
                    style={{ left: (l.bar - 1) * renderPxPerBar }}
                    onPointerDown={(e) => e.stopPropagation()}
                  >
                    {renaming ? (
                      <input
                        className="arr-locator-input"
                        data-locator-input={l.id}
                        autoFocus
                        value={locatorRename.draft}
                        placeholder={l.name}
                        onChange={(e) => setLocatorRename((cur) => (cur ? { ...cur, draft: e.target.value } : cur))}
                        onBlur={commitLocatorRename}
                        onKeyDown={(e) => {
                          e.stopPropagation() // never let typing a name reach the arrangement's own key handler
                          if (e.key === 'Enter') commitLocatorRename()
                          if (e.key === 'Escape') setLocatorRename(null)
                        }}
                      />
                    ) : (
                      <>
                        <button
                          className="arr-locator-flag"
                          data-locator-jump={l.id}
                          title={`${label} — bar ${l.bar}. Click to jump here (starts playback if stopped, relocates if already playing); double-click to rename.`}
                          onClick={() => jumpToLocator(l.bar)}
                          onDoubleClick={() => setLocatorRename({ id: l.id, draft: label })}
                        >
                          {compact ? '' : label}
                        </button>
                        <button
                          className="arr-locator-del"
                          data-locator-delete={l.id}
                          title={`delete the "${label}" marker`}
                          onClick={() => removeLocator(l.id)}
                        >
                          ×
                        </button>
                      </>
                    )}
                  </div>
                )
              })}
            </div>
            {rulerBand && (
              <div
                className="arr-ruler-band"
                style={{ left: rulerBand.start * pxPerBar, width: (rulerBand.end - rulerBand.start) * pxPerBar }}
              />
            )}
            {/* A resize handle occupying the last few px of each section (just inside its right
                boundary) — drag to change its bar count (loop_bars in loop mode). Renders from
                renderSections/renderPxPerBar so it tracks the LIVE preview (including growing the
                last section outward — the fit-to-width gap Phase 19 deferred, see the render*
                comment above). Sits above the ruler's own bar-select drag; its pointerdown stops
                propagation so a resize never also starts a selection. */}
            {renderSections.map((s, i) => (
              <div
                key={`resize-${i}`}
                className="arr-section-resize"
                data-section-resize={i}
                style={{ left: Math.max(0, (s.startBar + s.bars) * renderPxPerBar - 6) }}
                title={`drag to resize (${s.bars} bars)`}
                onPointerDown={(e) => beginResize(i, sections[i]!.startBar, sections[i]!.bars, e)}
              />
            ))}
            {resize && (
              <div
                className="arr-resize-guide"
                style={{ left: (renderSections[resize.index]!.startBar + renderSections[resize.index]!.bars) * renderPxPerBar }}
              >
                <span className="arr-resize-label">{renderSections[resize.index]!.bars} bars</span>
              </div>
            )}
          </div>
        </div>

        {rowPlan.map((row) => {
          if (row.kind === 'group-header') {
            return (
              <GroupHeaderRow
                key={`group-${row.group.id}`}
                group={row.group}
                collapsed={!!collapsedGroups[row.group.id]}
                onToggleCollapse={() => toggleGroupCollapsed(row.group.id)}
                onUngroup={() => void ungroup(row.group.id)}
              />
            )
          }
          const flat = row.flat
          const occ = occurrencesByTrack.get(flat.track.id) ?? []
          const canAutomate = occ.length > 0 && autoOptionsFor(flat.track.kind).length > 0
          const visible = visibleParamsFor(flat.track)
          const primaryClip = occ[0]?.clipId
          const open = !!autoOpen[flat.track.id]
          return (
            <div key={flat.track.id} className={row.grouped ? 'arr-grouped-track' : undefined}>
              <TrackRow
                flat={flat}
                totalBars={renderTotalBars}
                pxPerBar={renderPxPerBar}
                detail={detail}
                sections={renderSections}
                band={bandForTrack()}
                selected={!!selTracks && selTracks.includes(flat.track.id)}
                onHeaderClick={() => clickHeader(flat.track)}
                renameRequest={renameRequest && renameRequest.trackId === flat.track.id ? renameRequest : null}
                onRowPointerDown={(e) => beginDrag(flat.track.id, e)}
                groupPickChecked={groupPick.has(flat.track.id)}
                onToggleGroupPick={() => toggleGroupPick(flat.track.id)}
                alreadyGrouped={!!row.grouped}
                occurrences={occ}
                selectedOcc={selectedOcc}
                dragPreview={clipDrag}
                onOccPointerDown={(occ, e) => beginClipDrag(flat.track, occ, e)}
                headerExtra={
                  <>
                    <button
                      className={`arr-auto-toggle ${open ? 'on' : ''}`}
                      data-auto-toggle={flat.track.id}
                      disabled={!canAutomate}
                      title={canAutomate ? 'automation lanes' : 'add this track to a scene to automate its clip'}
                      onClick={() => setAutoOpen((p) => ({ ...p, [flat.track.id]: !p[flat.track.id] }))}
                    >
                      A
                    </button>
                    {flat.track.kind === 'audio' && (
                      <button
                        className="arr-auto-toggle"
                        data-audio-split={flat.track.id}
                        title="split-at-playhead: cut this track's clip at the current playhead position"
                        onClick={() => void splitAudioAtPlayhead(flat.track)}
                      >
                        ✂
                      </button>
                    )}
                  </>
                }
              />
              {open && canAutomate && (
                <AutomationPicker
                  track={flat.track}
                  available={autoOptionsFor(flat.track.kind).filter((o) => !visible.includes(o.key))}
                  onAdd={(param) => addLane(flat.track.id, param)}
                />
              )}
              {/* Phase 30 Stream JE: the audio-region trim/gain/warp editor no longer renders here
                  as a separate, small, unlabeled strip wedged between the arrangement grid and the
                  bottom panel — it's folded into the bottom Clip/Device panel itself
                  (AudioClipEditor.tsx, routed by App.tsx's BottomPane), the same "one editing
                  surface, always in the same place" treatment every other track kind already gets. */}
              {primaryClip &&
                visible.map((param) => (
                  <AutomationLane
                    key={param}
                    track={flat.track}
                    clipId={primaryClip}
                    param={param}
                    occurrences={occ.filter((o) => o.clipId === primaryClip)}
                    totalBars={renderTotalBars}
                    pxPerBar={renderPxPerBar}
                    loopSteps={loopSteps}
                    onRemoveLane={() => removeLane(flat.track, param)}
                  />
                ))}
            </div>
          )
        })}

        {showPlayhead && (
          <div
            className="arr-playhead"
            style={{ left: playheadLeft, top: RULER_H, height: contentRowsHeight + autoExtra }}
          />
        )}
      </div>
    </div>
  )
}
