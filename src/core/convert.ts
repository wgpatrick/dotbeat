import type { BeatAutomationLane, BeatDrumHit, BeatDocument, BeatDrumPattern, BeatNote, BeatSynth, BeatTrack, DrumLane, OscType, TrackKind } from './document.js'
import { AUTOMATABLE_SYNTH_PARAMS, DRUM_LANES, OSC_TYPES, SYNTH_FIELDS, SYNTH_PARAM_ORDER, defaultEffectChain, defaultSynthFields } from './document.js'

/** v0.9: the assumed shape of beatlab's per-clip automation engine state — a param name mapped
 * to its list of (time, value) points, UNORDERED and WITHOUT stable ids (beatlab's live clip
 * storage has no reason to id automation points the way the format's D6 discipline requires).
 * This is inferred from ExternalTrack's previous `automation?: Record<string, unknown>` typing
 * and phase-6-plan's note that "clip automation exists in beatlab but is not modeled by the
 * format yet" — it has NOT been verified against real beatlab source (no local checkout in this
 * worktree; test/fixtures/real-sandbox.beatlab.json's clips are all empty, so the fixture can't
 * confirm it either). See docs/phase-9-automation-plan.md's "Result" section for this caveat
 * spelled out as a documented gap rather than a verified fact. */
export type ExternalClipAutomation = Record<string, { time: number; value: number }[]>

/** v0.9: converts one clip's (assumed-shape) automation into BeatAutomationLane[], minting
 * stable point ids (`p1, p2, ...` in ascending time order) since the format requires them (D6)
 * even though the inferred source shape doesn't carry any. Params the format doesn't know how
 * to automate (not in AUTOMATABLE_SYNTH_PARAMS) are reported as dropped, same discipline as
 * unmodeled synth fields — real, deliberate loss, never silent. */
function toBeatClipAutomation(automation: ExternalClipAutomation | undefined, trackId: string, clipId: string, report: ConversionReport): BeatAutomationLane[] {
  if (!automation) return []
  const known = new Set<string>(AUTOMATABLE_SYNTH_PARAMS)
  const lanes: BeatAutomationLane[] = []
  for (const [param, points] of Object.entries(automation)) {
    if (!Array.isArray(points) || points.length === 0) continue
    if (!known.has(param)) {
      report.droppedFields.push(`${trackId}.${clipId}.automation.${param}`)
      continue
    }
    const sorted = [...points].sort((a, b) => a.time - b.time)
    lanes.push({ param, points: sorted.map((p, i) => ({ id: `p${i + 1}`, time: p.time, value: p.value })) })
  }
  return lanes
}

/** v0.8: expand a per-bar step pattern (beatlab's shape) into absolute hits, tiled across
 * `totalSteps`. The inverse of hitsToPattern. Used when importing a beatlab payload. */
function patternToHits(pattern: Record<string, number[]>, totalSteps: number): BeatDrumHit[] {
  const hits: BeatDrumHit[] = []
  for (const lane of DRUM_LANES) {
    const steps = pattern[lane]
    if (!steps || steps.length === 0) continue
    for (let k = 0; k < totalSteps; k++) {
      const v = steps[k % steps.length]!
      if (v > 0) hits.push({ id: `${lane}${k}`, lane, start: k, velocity: v })
    }
  }
  return hits
}

/** v0.8: project free-timed hits back onto beatlab's 16-step grid — a QUANTIZED VIEW for the
 * GUI/engine, which still speak patterns (research 12: the grid is a view over events). A hit
 * lands in the step nearest its start (mod 16, so it shows in the one-bar cycle); off-grid hits
 * are snapped in this projection only — the .beat file keeps their true time, and the daemon
 * carries them over on GUI pushes so they are never lost. Velocity is max-wins on collisions. */
function hitsToPattern(hits: BeatDrumHit[]): BeatDrumPattern {
  const pattern = Object.fromEntries(DRUM_LANES.map((lane) => [lane, Array<number>(16).fill(0)])) as BeatDrumPattern
  for (const h of hits) {
    const step = Math.round(h.start) % 16
    const cell = ((step % 16) + 16) % 16
    if (h.velocity > pattern[h.lane][cell]!) pattern[h.lane][cell] = h.velocity
  }
  return pattern
}

// A structural (not imported) type for BeatLab's real SandboxPayload shape
// (beatlab/src/state/sandboxPersistence.ts). Deliberately loose/local rather than a hard
// dependency on the beatlab package — core stays zero-deps on any specific host app (see
// docs/architecture.md); this converter only reads the handful of fields v0 actually models.
export interface ExternalTrack {
  id: string
  name: string
  color: string
  kind: 'drums' | 'synth'
  notes: { id: string; pitch: number; start: number; duration: number; velocity: number }[]
  synth: Record<string, unknown>
  pattern?: Record<string, number[]>
  clips?: { id: string; name?: string; notes: ExternalTrack['notes']; pattern?: Record<string, number[]>; automation?: ExternalClipAutomation }[]
}
export interface ExternalSandboxPayload {
  v: number
  tracks: ExternalTrack[]
  bpm: number
  loopBars: number
  selectedTrackId: string
  scenes?: { id: string; name?: string; clipIds: Record<string, string> }[]
  arrangement?: { enabled?: boolean; mode?: string | null; timeline?: { sceneId: string; bars: number }[] }
}

const BEAT_FORMAT_VERSION = '0.10'

/** SynthParams fields the format deliberately does NOT model (each needs grammar design of its
 * own — large arrays, ordered lists, or redundant pairs; see docs/phase-5-plan.md). These are
 * the only fields a conversion is allowed to drop. Phase 18 Stream R promoted `lfoSync`/
 * `lfoSyncRate`/`lfo2Sync`/`lfo2SyncRate` OUT of this list — they're real SYNTH_FIELDS now (a
 * well-bounded bool+enum pair, not the open-ended arrays/orderings the rest of this list is),
 * so a conversion carries them across instead of dropping them (see toBeatSynth's generic
 * SYNTH_FIELDS loop, which now covers all four automatically). */
// Phase 22 Stream AA note: 'insertOrder' here is BeatLab's own external SynthParams field (this
// converter's source shape) — still unconverted, since its exact external shape was never
// confirmed against a live BeatLab checkout (see format-spec.md's v0.9 automation section for the
// same caveat pattern). dotbeat's OWN document format gained a real, independent per-track effect
// ordering in v0.10 (BeatTrack.effects, src/core/document.ts) — the format-level gap this list
// entry used to describe is closed; only the BeatLab-import mapping remains unmodeled.
export const DELIBERATELY_UNMODELED = [
  'wtCustomA',
  'wtCustomB',
  'lfoSteps',
  'insertOrder',
  'arpOn',
  'arpRate',
  'arpPattern',
] as const

export interface ConversionReport {
  /** Track IDs present in the source payload but not carried into the .beat document. Empty
   * since v0.2 (drum tracks now convert too) — kept so tests can assert it *stays* empty. */
  droppedTracks: string[]
  /** Per synth-track-id, which SynthParams fields existed on the source but aren't part of the
   * v0 field set (osc2*, filterEnv*, lfo*, eq*, comp*, fm*, etc.) — real, deliberate data loss,
   * reported rather than silently swallowed. */
  droppedSynthParams: Record<string, string[]>
  /** True if selectedTrackId pointed at a track that got dropped (e.g. a drum track) — v0 falls
   * back to the first remaining synth track. */
  selectedTrackFellBack: boolean
  /** v0.4: structural things the format deliberately doesn't carry, dropped during conversion —
   * scene display names ("scenes[].name"), non-timeline arrangement modes
   * ("arrangement(mode=energy)"), and scene slots that pointed at nonexistent clips ("scene <id>:
   * dangling slot <track>"). v0.9: clip automation on a known numeric synth param now CONVERTS
   * (see toBeatClipAutomation) rather than dropping; only automation for a param the format has
   * no automatable field for is still reported here, as "<track>.<clip>.automation.<param>". */
  droppedFields: string[]
}

function isOscType(x: unknown): x is OscType {
  return typeof x === 'string' && (OSC_TYPES as readonly string[]).includes(x)
}

function toBeatSynth(source: Record<string, unknown>, trackId: string, report: ConversionReport): BeatSynth {
  const known = new Set<string>([...SYNTH_PARAM_ORDER, ...SYNTH_FIELDS.map((f) => f.key)])
  const dropped = Object.keys(source).filter((k) => !known.has(k))
  if (dropped.length) report.droppedSynthParams[trackId] = dropped

  const osc = source.osc
  if (!isOscType(osc)) throw new Error(`track "${trackId}": synth.osc is not a known oscillator type: ${String(osc)}`)
  const num = (key: keyof BeatSynth): number => {
    const v = source[key]
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`track "${trackId}": synth.${key} is not a finite number: ${String(v)}`)
    return v
  }
  const synth: Record<string, unknown> = {
    osc,
    volume: num('volume'),
    cutoff: num('cutoff'),
    resonance: num('resonance'),
    attack: num('attack'),
    decay: num('decay'),
    sustain: num('sustain'),
    release: num('release'),
    pan: num('pan'),
    ...defaultSynthFields(),
  }
  // v0.3 optional fields: take from source when present and type-valid; tolerate absence
  // (older payloads) by keeping the canonical default.
  for (const def of SYNTH_FIELDS) {
    const v = source[def.key]
    if (v === undefined) continue
    switch (def.kind) {
      case 'number':
        if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`track "${trackId}": synth.${def.key} is not a finite number: ${String(v)}`)
        synth[def.key] = v
        break
      case 'enum':
        if (typeof v !== 'string' || !def.values!.includes(v)) throw new Error(`track "${trackId}": synth.${def.key} is not one of ${def.values!.join('|')}: ${String(v)}`)
        synth[def.key] = v
        break
      case 'bool':
        if (typeof v !== 'boolean') throw new Error(`track "${trackId}": synth.${def.key} is not a boolean: ${String(v)}`)
        synth[def.key] = v
        break
      case 'trackref':
        if (v !== null && typeof v !== 'string') throw new Error(`track "${trackId}": synth.${def.key} is not a track id or null: ${String(v)}`)
        synth[def.key] = v
        break
    }
  }
  return synth as unknown as BeatSynth
}

function toBeatNote(n: ExternalTrack['notes'][number]): BeatNote {
  return { id: n.id, pitch: n.pitch, start: n.start, duration: n.duration, velocity: n.velocity }
}

function toBeatPattern(source: Record<string, number[]> | undefined, trackId: string): BeatDrumPattern {
  if (!source) throw new Error(`track "${trackId}": drum track has no pattern`)
  const pattern = {} as BeatDrumPattern
  for (const lane of DRUM_LANES) {
    const steps = source[lane]
    if (!Array.isArray(steps)) throw new Error(`track "${trackId}": pattern is missing lane "${lane}"`)
    pattern[lane] = steps.map((v, i) => {
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) throw new Error(`track "${trackId}": pattern.${lane}[${i}] is not a velocity in 0..1: ${String(v)}`)
      return v
    })
  }
  return pattern
}

/** Converts a real BeatLab SandboxPayload into a BeatDocument. Still lossy by design — the
 * format models notes, drum patterns, and a 9-field synth subset, nothing else (see
 * docs/format-spec.md's "deferred" list; clips/scenes/automation/swing stay app-side). Returns
 * both the document and a report of exactly what got dropped, so callers (and tests) can assert
 * on the loss being *exactly* the expected, documented set — not a silent surprise. */
export function sandboxPayloadToBeatDocument(payload: ExternalSandboxPayload): { doc: BeatDocument; report: ConversionReport } {
  const report: ConversionReport = { droppedTracks: [], droppedSynthParams: {}, selectedTrackFellBack: false, droppedFields: [] }

  // beatlab patterns are one-bar (16-step) cycles; a live track's plays every bar across the
  // loop, so migrate it across loopBars*16 steps; a clip's is one bar (16 steps). (v0.8)
  const loopSteps = payload.loopBars * 16
  const tracks: BeatTrack[] = payload.tracks.map((t) => ({
    id: t.id,
    name: t.name,
    color: t.color,
    kind: t.kind,
    synth: toBeatSynth(t.synth, t.id, report),
    laneSamples: {},
    clips: (t.clips ?? []).map((c) => {
      if (c.name !== undefined && c.name !== c.id) report.droppedFields.push(`${t.id}.${c.id}.name`)
      return {
        id: c.id,
        notes: t.kind === 'synth' ? c.notes.map(toBeatNote) : [],
        hits: t.kind === 'drums' ? patternToHits(toBeatPattern(c.pattern, `${t.id} clip ${c.id}`), 16) : [],
        // v0.9: converts (was reported as dropped through v0.8) — see toBeatClipAutomation.
        automation: toBeatClipAutomation(c.automation, t.id, c.id, report),
      }
    }),
    notes: t.kind === 'synth' ? t.notes.map(toBeatNote) : [],
    hits: t.kind === 'drums' ? patternToHits(toBeatPattern(t.pattern, t.id), loopSteps) : [],
    // v0.10: BeatLab's own insertOrder isn't converted (see DELIBERATELY_UNMODELED's comment
    // above) — every imported synth track lands on dotbeat's default chain, same as any other
    // file that never declares one explicitly.
    effects: t.kind === 'synth' ? defaultEffectChain() : [],
  }))

  let selectedTrack = payload.selectedTrackId
  if (!tracks.some((t) => t.id === selectedTrack)) {
    report.selectedTrackFellBack = true
    selectedTrack = tracks[0]?.id ?? ''
  }

  // v0.4 scenes: keep only slots that resolve to a real clip on a real track — the store keeps
  // these consistent (deleteClip unmaps), so dangling slots are data corruption worth reporting,
  // not worth failing an otherwise-good conversion for. Scene display names aren't modeled.
  const trackById = new Map(tracks.map((t) => [t.id, t]))
  const scenes = (payload.scenes ?? []).map((s) => {
    if (s.name !== undefined && s.name !== s.id) report.droppedFields.push(`scenes[${s.id}].name`)
    const slots: Record<string, string> = {}
    for (const [trackId, clipId] of Object.entries(s.clipIds)) {
      const track = trackById.get(trackId)
      if (!track || !track.clips.some((c) => c.id === clipId)) {
        report.droppedFields.push(`scene ${s.id}: dangling slot ${trackId}`)
        continue
      }
      slots[trackId] = clipId
    }
    return { id: s.id, slots }
  })

  // v0.4 song: only the timeline arrangement mode converts; energy/structure are lesson-side
  // features the format deliberately doesn't model.
  let song: BeatDocument['song'] = null
  const arr = payload.arrangement
  if (arr?.enabled && arr.mode === 'timeline' && arr.timeline && arr.timeline.length > 0) {
    const sceneIds = new Set(scenes.map((s) => s.id))
    song = arr.timeline.map((e) => {
      if (!sceneIds.has(e.sceneId)) throw new Error(`arrangement timeline references unknown scene "${e.sceneId}"`)
      if (!Number.isInteger(e.bars) || e.bars < 1 || e.bars > 64) throw new Error(`arrangement timeline section bars must be an integer 1-64, got ${String(e.bars)}`)
      return { scene: e.sceneId, bars: e.bars }
    })
  } else if (arr?.enabled && arr.mode && arr.mode !== 'timeline') {
    report.droppedFields.push(`arrangement(mode=${arr.mode})`)
  }

  const doc: BeatDocument = {
    formatVersion: BEAT_FORMAT_VERSION,
    bpm: payload.bpm,
    loopBars: payload.loopBars,
    selectedTrack,
    media: [], // browser payloads carry no media yet — lane samples arrive via the file side
    tracks,
    groups: [], // v0.10: browser payloads carry no groups — the daemon's /state route carries the
    // CURRENT document's groups over (see src/daemon/daemon.ts), same never-erase rule as media.
    scenes,
    song,
  }
  return { doc, report }
}

/** The inverse direction: a BeatDocument back into (partial) BeatLab track data — just the
 * fields the format models. Deliberately returns Partial<SynthParams>-shaped synth objects
 * rather than a fully-populated SynthParams: reconstituting *every* field beatlab's real
 * SynthParams type has (70+ fields, including large wavetable-frame arrays, and growing) would
 * mean this converter hardcoding — and inevitably drifting out of sync with — beatlab's own
 * defaults. Merging this partial onto beatlab's live DEFAULT_SYNTH is the importing side's job,
 * not core's (in practice: beatlab's dawBridge — see docs/phase-1-plan.md). */
export interface PartialTrack {
  id: string
  name: string
  color: string
  kind: TrackKind
  notes: BeatNote[]
  synth: Partial<Record<keyof BeatSynth, unknown>>
  pattern?: BeatDrumPattern
  /** v0.4: clips ride the partial in beatlab's own Clip shape (name = id — the format has no
   * separate display name; pattern always present because beatlab clips carry one). v0.9:
   * `automation` rides alongside in the ExternalClipAutomation shape (ids stripped — see
   * toBeatClipAutomation; this is the direction beatlab's own engine wiring for reading this
   * back is the documented gap, per docs/phase-9-automation-plan.md), omitted entirely when a
   * clip has none. */
  clips?: { id: string; name: string; notes: BeatNote[]; pattern: BeatDrumPattern; automation?: ExternalClipAutomation }[]
  /** v0.5: per-lane one-shot assignments (sample = media id; resolve via the media table). */
  laneSamples?: Record<string, { sample: string; gainDb: number; tune: number }>
}

const EMPTY_PATTERN = (): BeatDrumPattern =>
  Object.fromEntries(DRUM_LANES.map((lane) => [lane, Array<number>(16).fill(0)])) as BeatDrumPattern

/** v0.6+: instrument tracks ride the payload as a SEPARATE additive field, not as tracks —
 * beatlab's store has no instrument kind, but the dev-gated daw bridge plays them via
 * spessasynth's worklet (browser leg of phase 8). Consumers that don't know the field
 * ignore it. */
export interface PartialInstrument {
  id: string
  name: string
  sample: string
  program: number
  volume: number
  pan: number
  notes: BeatNote[]
  /** v0.8+: instrument clips (notes-only, like synth clips — see BeatClip). Present iff the
   * track has any; a future browser leg's clip UI would read this the same way beatlab's own
   * Clip.notes works for synth tracks. */
  clips?: { id: string; name: string; notes: BeatNote[] }[]
}

export function beatDocumentToPartialTracks(doc: BeatDocument): {
  bpm: number
  loopBars: number
  selectedTrackId: string
  tracks: PartialTrack[]
  scenes: { id: string; name: string; clipIds: Record<string, string> }[]
  song: { sceneId: string; bars: number }[] | null
  media: { id: string; sha256: string; path: string }[]
  instruments: PartialInstrument[]
} {
  return {
    bpm: doc.bpm,
    loopBars: doc.loopBars,
    selectedTrackId: doc.selectedTrack,
    // v0.6: instrument tracks are excluded — beatlab has no instrument kind yet (they render
    // via the spessasynth path headless; the daemon re-adds them on GUI pushes, like media).
    tracks: doc.tracks.filter((t) => t.kind !== 'instrument').map((t) => ({
      id: t.id,
      name: t.name,
      color: t.color,
      kind: t.kind,
      notes: t.notes,
      synth: { ...t.synth },
      // v0.8: hits projected onto the 16-step grid — the quantized VIEW the GUI/engine consume
      // (off-grid hits kept in the file, carried over by the daemon on GUI pushes)
      ...(t.kind === 'drums' ? { pattern: hitsToPattern(t.hits) } : {}),
      ...(Object.keys(t.laneSamples).length > 0 ? { laneSamples: structuredClone(t.laneSamples) as Record<string, { sample: string; gainDb: number; tune: number }> } : {}),
      ...(t.clips.length > 0
        ? {
            clips: t.clips.map((c) => ({
              id: c.id,
              name: c.id,
              notes: c.notes.map((n) => ({ ...n })),
              pattern: t.kind === 'drums' ? hitsToPattern(c.hits) : EMPTY_PATTERN(),
              // v0.9: strip stable ids back off (the assumed engine-side shape doesn't use them,
              // per toBeatClipAutomation's caveat) — omitted entirely when the clip has none.
              ...(c.automation.length > 0
                ? { automation: Object.fromEntries(c.automation.map((l) => [l.param, l.points.map((p) => ({ time: p.time, value: p.value }))])) as ExternalClipAutomation }
                : {}),
            })),
          }
        : {}),
    })),
    scenes: doc.scenes.map((s) => ({ id: s.id, name: s.id, clipIds: { ...s.slots } })),
    song: doc.song ? doc.song.map((x) => ({ sceneId: x.scene, bars: x.bars })) : null,
    media: doc.media.map((m) => ({ ...m })),
    instruments: doc.tracks
      .filter((t) => t.kind === 'instrument')
      .map((t) => ({
        id: t.id,
        name: t.name,
        sample: t.instrument!.sample,
        program: t.instrument!.program,
        volume: t.instrument!.volume,
        pan: t.instrument!.pan,
        notes: t.notes.map((n) => ({ ...n })),
        ...(t.clips.length > 0 ? { clips: t.clips.map((c) => ({ id: c.id, name: c.id, notes: c.notes.map((n) => ({ ...n })) })) } : {}),
      })),
  }
}
