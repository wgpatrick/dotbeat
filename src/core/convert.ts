import type { BeatDocument, BeatDrumPattern, BeatNote, BeatSynth, BeatTrack, OscType, TrackKind } from './document.js'
import { DRUM_LANES, OSC_TYPES, SYNTH_PARAM_ORDER } from './document.js'

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
}
export interface ExternalSandboxPayload {
  v: number
  tracks: ExternalTrack[]
  bpm: number
  loopBars: number
  selectedTrackId: string
}

const BEAT_FORMAT_VERSION = '0.2'

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
}

function isOscType(x: unknown): x is OscType {
  return typeof x === 'string' && (OSC_TYPES as readonly string[]).includes(x)
}

function toBeatSynth(source: Record<string, unknown>, trackId: string, report: ConversionReport): BeatSynth {
  const known = new Set<string>(SYNTH_PARAM_ORDER)
  const dropped = Object.keys(source).filter((k) => !known.has(k))
  if (dropped.length) report.droppedSynthParams[trackId] = dropped

  const osc = source.osc
  if (!isOscType(osc)) throw new Error(`track "${trackId}": synth.osc is not a known oscillator type: ${String(osc)}`)
  const num = (key: keyof BeatSynth): number => {
    const v = source[key]
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`track "${trackId}": synth.${key} is not a finite number: ${String(v)}`)
    return v
  }
  return {
    osc,
    volume: num('volume'),
    cutoff: num('cutoff'),
    resonance: num('resonance'),
    attack: num('attack'),
    decay: num('decay'),
    sustain: num('sustain'),
    release: num('release'),
    pan: num('pan'),
  }
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
  const report: ConversionReport = { droppedTracks: [], droppedSynthParams: {}, selectedTrackFellBack: false }

  const tracks: BeatTrack[] = payload.tracks.map((t) => ({
    id: t.id,
    name: t.name,
    color: t.color,
    kind: t.kind,
    synth: toBeatSynth(t.synth, t.id, report),
    notes: t.kind === 'synth' ? t.notes.map(toBeatNote) : [],
    ...(t.kind === 'drums' ? { pattern: toBeatPattern(t.pattern, t.id) } : {}),
  }))

  let selectedTrack = payload.selectedTrackId
  if (!tracks.some((t) => t.id === selectedTrack)) {
    report.selectedTrackFellBack = true
    selectedTrack = tracks[0]?.id ?? ''
  }

  const doc: BeatDocument = {
    formatVersion: BEAT_FORMAT_VERSION,
    bpm: payload.bpm,
    loopBars: payload.loopBars,
    selectedTrack,
    tracks,
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
}

export function beatDocumentToPartialTracks(doc: BeatDocument): {
  bpm: number
  loopBars: number
  selectedTrackId: string
  tracks: PartialTrack[]
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
    })),
  }
}
