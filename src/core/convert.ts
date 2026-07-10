import type { BeatDocument, BeatDrumPattern, BeatNote, BeatSynth, BeatTrack, OscType, TrackKind } from './document.js'
import { DRUM_LANES, OSC_TYPES, SYNTH_FIELDS, SYNTH_PARAM_ORDER, defaultSynthFields } from './document.js'

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
  clips?: { id: string; name?: string; notes: ExternalTrack['notes']; pattern?: Record<string, number[]>; automation?: Record<string, unknown> }[]
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

const BEAT_FORMAT_VERSION = '0.4'

/** SynthParams fields the format deliberately does NOT model (each needs grammar design of its
 * own — large arrays, ordered lists, or redundant pairs; see docs/phase-5-plan.md). These are
 * the only fields a conversion is allowed to drop. */
export const DELIBERATELY_UNMODELED = [
  'wtCustomA',
  'wtCustomB',
  'lfoSteps',
  'insertOrder',
  'lfoSync',
  'lfoSyncRate',
  'lfo2Sync',
  'lfo2SyncRate',
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
   * clip automation ("<track>.<clip>.automation"), scene display names ("scenes[].name"),
   * non-timeline arrangement modes ("arrangement(mode=energy)"), and scene slots that pointed at
   * nonexistent clips ("scene <id>: dangling slot <track>"). */
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

  const tracks: BeatTrack[] = payload.tracks.map((t) => ({
    id: t.id,
    name: t.name,
    color: t.color,
    kind: t.kind,
    synth: toBeatSynth(t.synth, t.id, report),
    clips: (t.clips ?? []).map((c) => {
      if (c.automation && Object.keys(c.automation).length > 0) report.droppedFields.push(`${t.id}.${c.id}.automation`)
      if (c.name !== undefined && c.name !== c.id) report.droppedFields.push(`${t.id}.${c.id}.name`)
      return {
        id: c.id,
        notes: t.kind === 'synth' ? c.notes.map(toBeatNote) : [],
        ...(t.kind === 'drums' ? { pattern: toBeatPattern(c.pattern, `${t.id} clip ${c.id}`) } : {}),
      }
    }),
    notes: t.kind === 'synth' ? t.notes.map(toBeatNote) : [],
    ...(t.kind === 'drums' ? { pattern: toBeatPattern(t.pattern, t.id) } : {}),
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
    tracks,
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
   * separate display name; pattern always present because beatlab clips carry one). */
  clips?: { id: string; name: string; notes: BeatNote[]; pattern: BeatDrumPattern }[]
}

const EMPTY_PATTERN = (): BeatDrumPattern =>
  Object.fromEntries(DRUM_LANES.map((lane) => [lane, Array<number>(16).fill(0)])) as BeatDrumPattern

export function beatDocumentToPartialTracks(doc: BeatDocument): {
  bpm: number
  loopBars: number
  selectedTrackId: string
  tracks: PartialTrack[]
  scenes: { id: string; name: string; clipIds: Record<string, string> }[]
  song: { sceneId: string; bars: number }[] | null
} {
  return {
    bpm: doc.bpm,
    loopBars: doc.loopBars,
    selectedTrackId: doc.selectedTrack,
    tracks: doc.tracks.map((t) => ({
      id: t.id,
      name: t.name,
      color: t.color,
      kind: t.kind,
      notes: t.notes,
      synth: { ...t.synth },
      ...(t.pattern ? { pattern: structuredClone(t.pattern) } : {}),
      ...(t.clips.length > 0
        ? {
            clips: t.clips.map((c) => ({
              id: c.id,
              name: c.id,
              notes: c.notes.map((n) => ({ ...n })),
              pattern: c.pattern ? structuredClone(c.pattern) : EMPTY_PATTERN(),
            })),
          }
        : {}),
    })),
    scenes: doc.scenes.map((s) => ({ id: s.id, name: s.id, clipIds: { ...s.slots } })),
    song: doc.song ? doc.song.map((x) => ({ sceneId: x.scene, bars: x.bars })) : null,
  }
}
