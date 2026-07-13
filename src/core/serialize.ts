import type { BeatAudioRegion, BeatAutomationLane, BeatAutomationPoint, BeatClip, BeatDrumHit, BeatDocument, BeatDrumLaneDecl, BeatEffect, BeatGroup, BeatNote, BeatScene, BeatTrack } from './document.js'
import { AUTOMATION_POINT_FIELD_DEFAULTS, DRUM_LANES, DRUM_VOICE_PARAM_DEFAULTS, INSTRUMENT_EFFECT_FIELD_KEYS, NOTE_FIELD_DEFAULTS, SAMPLE_LANE_PARAM_DEFAULTS, SAMPLE_LANE_PARAM_KEYS, SYNTH_FIELDS, SYNTH_PARAM_ORDER, declaredLaneNames, isDefaultEffectChain } from './document.js'
import { formatNumber } from './format.js'

// v0.10: the effect chain serializes iff it differs from the canonical default (isDefaultEffectChain)
// — same canonical-elision discipline as v0.3's synth fields. An unmodified (or pre-v0.10) track
// emits ZERO effect lines and round-trips byte-identically; an explicitly emptied chain emits the
// `effects none` sentinel (there'd otherwise be no way to tell "emptied" from "never declared"
// apart on the next parse); anything else emits one `effect <id> <type>[ bypassed]` line per
// entry, IN LIST ORDER — the file's order IS the chain order, no re-sorting.
function serializeEffectLines(effects: BeatEffect[], indent: string): string[] {
  if (isDefaultEffectChain(effects)) return []
  if (effects.length === 0) return [`${indent}effects none`]
  return effects.map((e) => `${indent}effect ${e.id} ${e.type}${e.enabled ? '' : ' bypassed'}`)
}

// Phase 26 Stream DC: an instrument track's own effect-chain serializer. Unlike synth/drums (whose
// canonical "never declared" default is the non-empty legacy 4-effect chain, so an EXPLICITLY
// emptied chain needs the `effects none` sentinel to stay distinguishable — see serializeEffectLines
// above), an instrument track's canonical default IS the empty list (it never had a fixed insert to
// preserve backward compatibility with). "Never declared" and "explicitly emptied" are therefore
// the SAME state for an instrument track, so there's nothing to disambiguate: elide entirely
// whenever the chain is empty, and never emit the `effects none` sentinel for this kind at all.
function serializeInstrumentEffectLines(effects: BeatEffect[], indent: string): string[] {
  if (effects.length === 0) return []
  return effects.map((e) => `${indent}effect ${e.id} ${e.type}${e.enabled ? '' : ' bypassed'}`)
}

// v0.10: the optional per-note fields, canonical-elided (iff != NOTE_FIELD_DEFAULTS) and always
// emitted in THIS fixed order — one `key=value` token per field, so changing just one (e.g. a
// chance tweak) is a one-token diff on an otherwise-unchanged note line.
function noteOptionalTokens(n: BeatNote): string {
  const parts: string[] = []
  if (n.chance !== NOTE_FIELD_DEFAULTS.chance) parts.push(`chance=${n.chance}`)
  if (formatNumber(n.cent) !== formatNumber(NOTE_FIELD_DEFAULTS.cent)) parts.push(`cent=${formatNumber(n.cent)}`)
  if (n.ratchetCount !== NOTE_FIELD_DEFAULTS.ratchetCount) parts.push(`ratchetCount=${n.ratchetCount}`)
  if (formatNumber(n.ratchetCurve) !== formatNumber(NOTE_FIELD_DEFAULTS.ratchetCurve)) parts.push(`ratchetCurve=${formatNumber(n.ratchetCurve)}`)
  if (formatNumber(n.ratchetLength) !== formatNumber(NOTE_FIELD_DEFAULTS.ratchetLength)) parts.push(`ratchetLength=${formatNumber(n.ratchetLength)}`)
  return parts.length ? ` ${parts.join(' ')}` : ''
}

// Phase 22 Stream AE: one audio-region clip's entire content, one bundled line (no per-field
// elision — see BeatAudioRegion's doc comment in document.ts for why this follows the note/hit
// discipline instead of the SYNTH_FIELDS elision discipline).
function serializeAudioLine(region: BeatAudioRegion, indent: string): string {
  return `${indent}audio ${region.media} ${formatNumber(region.in)} ${formatNumber(region.out)} ${formatNumber(region.gainDb)} ${region.warp} ${formatNumber(region.rate)}`
}

// Canonical note order: (start, pitch, id) ascending — see format-spec.md's "canonical ordering".
function sortedNoteLines(notes: BeatNote[], indent: string): string[] {
  return [...notes]
    .sort((a, b) => a.start - b.start || a.pitch - b.pitch || a.id.localeCompare(b.id))
    .map((n) => `${indent}note ${n.id} ${n.pitch} ${formatNumber(n.start)} ${formatNumber(n.duration)} ${formatNumber(n.velocity)}${noteOptionalTokens(n)}`)
}

// v0.8: canonical drum-hit order is (start, lane-in-declared-order, id) ascending — one hit per
// line, so an added/moved hit is a one-line diff. Hits are free-timed events (research 12); the
// old fixed-grid `pattern` lines are gone from the grammar (migrated on parse). Phase 22 Stream AB:
// "declared order" is the track's OWN `lanes` list when it has one, else DRUM_LANES (unchanged) —
// so a legacy track's hits still sort exactly as before.
function sortedHitLines(hits: BeatDrumHit[], laneOrder: readonly string[], indent: string): string[] {
  const laneIndex = (lane: string) => {
    const i = laneOrder.indexOf(lane)
    return i === -1 ? laneOrder.length : i
  }
  return [...hits]
    .sort((a, b) => a.start - b.start || laneIndex(a.lane) - laneIndex(b.lane) || a.id.localeCompare(b.id))
    .map((h) => `${indent}hit ${h.id} ${h.lane} ${formatNumber(h.start)} ${formatNumber(h.velocity)}${h.duration !== undefined ? ` ${formatNumber(h.duration)}` : ''}`)
}

// Phase 22 Stream AB: one `lane <name> <backing>` declaration line, canonical-eliding synth params
// that equal that voice type's default (DRUM_VOICE_PARAM_DEFAULTS) — same discipline as SYNTH_FIELDS.
function serializeLaneBacking(backing: BeatDrumLaneDecl['backing']): string {
  if (backing.type === 'synth') {
    const defaults = DRUM_VOICE_PARAM_DEFAULTS[backing.voice]
    const parts = [`synth:${backing.voice}`]
    for (const [key, value] of Object.entries(backing.params)) {
      if (formatNumber(value) === formatNumber(defaults[key] ?? Number.NaN)) continue
      parts.push(`${key}=${formatNumber(value)}`)
    }
    return parts.join(' ')
  }
  if (backing.type === 'sample') {
    const parts = [`sample`, backing.sample, formatNumber(backing.gainDb), formatNumber(backing.tune)]
    // Phase 26 Stream DK: Start/Length/AHD-envelope/filter params, canonical-elided against
    // SAMPLE_LANE_PARAM_DEFAULTS in fixed key order (same discipline as synth-backed lanes' own
    // params bag just above), then `filter=` iff non-default, then `fx=` iff any effects declared.
    for (const key of SAMPLE_LANE_PARAM_KEYS) {
      const value = backing.params[key]
      if (value === undefined) continue
      if (formatNumber(value) === formatNumber(SAMPLE_LANE_PARAM_DEFAULTS[key])) continue
      parts.push(`${key}=${formatNumber(value)}`)
    }
    if (backing.filterType !== 'lowpass') parts.push(`filter=${backing.filterType}`)
    if (backing.effects.length > 0) parts.push(`fx=${backing.effects.map((e) => e.type).join(',')}`)
    return parts.join(' ')
  }
  return `sf ${backing.sample} ${formatNumber(backing.program)} ${formatNumber(backing.note)}`
}

// Phase 26 Stream DI: the one optional per-point field (interpolation), canonical-elided (iff !=
// AUTOMATION_POINT_FIELD_DEFAULTS) as a trailing `key=value` token — same discipline and same
// token grammar as noteOptionalTokens above, scaled down to BeatAutomationPoint's single field.
function pointOptionalTokens(p: BeatAutomationPoint): string {
  const parts: string[] = []
  if ((p.interpolation ?? AUTOMATION_POINT_FIELD_DEFAULTS.interpolation) !== AUTOMATION_POINT_FIELD_DEFAULTS.interpolation) parts.push(`interpolation=${p.interpolation}`)
  return parts.length ? ` ${parts.join(' ')}` : ''
}

// v0.9: canonical automation point order is (time, id) ascending, same discipline as notes/hits.
function sortedPointLines(points: BeatAutomationPoint[], indent: string): string[] {
  return [...points]
    .sort((a, b) => a.time - b.time || a.id.localeCompare(b.id))
    .map((p) => `${indent}point ${p.id} ${formatNumber(p.time)} ${formatNumber(p.value)}${pointOptionalTokens(p)}`)
}

// v0.9: automation lanes serialize in source order (first-seen — like clips themselves; order
// of creation is meaningful, not alphabetized). `trackId` prefixes the target so each `auto`
// line is self-describing (same <track>.<param> addressing `beat set` already uses).
function serializeAutomationLanes(trackId: string, lanes: BeatAutomationLane[], indent: string): string[] {
  const lines: string[] = []
  for (const lane of lanes) {
    lines.push(`${indent}auto ${trackId}.${lane.param}`)
    lines.push(...sortedPointLines(lane.points, `${indent}  `))
  }
  return lines
}

// v0.10 groove/shuffle: a single `groove <amount> <grid>` line, entirely absent while amount is
// 0 (the canonical default — see BeatTrack.shuffleAmount). Shared by both the instrument and the
// synth/drums branches below so there's exactly one place that knows the line's shape.
function grooveLine(t: BeatTrack): string[] {
  return t.shuffleAmount !== 0 ? [`  groove ${formatNumber(t.shuffleAmount)} ${formatNumber(t.shuffleGrid)}`] : []
}

// v0.10: clip-level loop range + time signature, emitted iff set (canonical elision — no line =
// no override, see BeatClip.loop/.signature). Ordered first, as Ableton's Clip View orders "Main
// Clip Properties" before the note/hit content.
function serializeClipProps(clip: BeatClip, indent: string): string[] {
  const lines: string[] = []
  if (clip.loop) lines.push(`${indent}loop ${formatNumber(clip.loop.start)} ${formatNumber(clip.loop.end)}`)
  if (clip.signature) lines.push(`${indent}signature ${formatNumber(clip.signature.numerator)} ${formatNumber(clip.signature.denominator)}`)
  return lines
}

function serializeTrack(t: BeatTrack): string[] {
  const lines: string[] = []
  lines.push(`track ${t.id} ${t.name} ${t.color} ${t.kind}`)
  // Phase 22 Stream AE: audio tracks carry no synth block, lane samples, or live notes/hits —
  // every audio track's content is clip-scoped (one audio-region clip = one line + its optional
  // gain automation lane), source order preserved like every other track's clip list.
  if (t.kind === 'audio') {
    for (const clip of t.clips) {
      lines.push(`  clip ${clip.id}`)
      // Phase 29 Stream GF item 4: audio clips share the same BeatClip.loop/.signature fields as
      // every other clip kind (setClipLoop/setClipSignature in edit.ts don't gate on track kind,
      // and parse.ts's level-2 `loop`/`signature` handling is likewise kind-agnostic) — but this
      // branch used to skip `serializeClipProps` entirely, so an edit made through the GUI's clip
      // properties panel (or `beat set <track>.clip.<id>.loop`) would apply and optimistically
      // render correctly in-session, then silently vanish on the next save/reload because the
      // field was never written to the file in the first place. Confirmed via pilot 85: filling in
      // the loop fields visibly moved the range bar but a before/after diff of the raw `.beat` file
      // showed no change. Matching the instrument/synth branches' own call below fixes the
      // round-trip for real (this is a serialization gap, not audio-engine work).
      lines.push(...serializeClipProps(clip, '    '))
      if (clip.audio) lines.push(serializeAudioLine(clip.audio, '    '))
      lines.push(...serializeAutomationLanes(t.id, clip.automation, '    '))
    }
    return lines
  }
  // v0.6 instrument tracks: a soundfont voice line instead of a synth block; volume/pan elided
  // at their defaults (-10 dB, center) like every optional field.
  if (t.kind === 'instrument') {
    const inst = t.instrument!
    lines.push(`  soundfont ${inst.sample} ${formatNumber(inst.program)}`)
    if (formatNumber(inst.volume) !== '-10') lines.push(`  volume ${formatNumber(inst.volume)}`)
    if (formatNumber(inst.pan) !== '0') lines.push(`  pan ${formatNumber(inst.pan)}`)
    // Phase 26 Stream DC: an instrument track's effect-chain param fields — canonical elision
    // (iff != default), same discipline as the synth/drums branch's own optional-field loop below,
    // but restricted to INSTRUMENT_EFFECT_FIELD_KEYS (the 12 EffectType chain members' own knobs —
    // see that constant's comment in document.ts for why the rest of SYNTH_FIELDS doesn't apply to
    // a SoundFont voice). Bare field lines, no `synth` wrapper — same shape as volume/pan above.
    for (const def of SYNTH_FIELDS) {
      if (!INSTRUMENT_EFFECT_FIELD_KEYS.has(def.key)) continue
      const value = t.synth[def.key]
      if (value === def.default) continue
      if (def.kind === 'number' && formatNumber(value as number) === formatNumber(def.default as number)) continue
      const text = def.kind === 'number' ? formatNumber(value as number) : String(value)
      lines.push(`  ${def.key} ${text}`)
    }
    // v0.10: the ordered insert-effect chain — see BeatTrack.effects's comment (Phase 26 Stream DC
    // widened this from synth-only to instrument tracks too). Uses the instrument-specific elision
    // rule (serializeInstrumentEffectLines), NOT serializeEffectLines — an instrument track's
    // canonical default is [], not the non-empty legacy chain, so there's no "effects none" state
    // to represent (see that function's own comment).
    lines.push(...serializeInstrumentEffectLines(t.effects, '  '))
    lines.push(...grooveLine(t))
    // v0.8+: instrument clips carry notes only (same grammar as synth-track clips)
    for (const clip of t.clips) {
      lines.push(`  clip ${clip.id}`)
      lines.push(...serializeClipProps(clip, '    '))
      lines.push(...sortedNoteLines(clip.notes, '    '))
    }
    lines.push(...sortedNoteLines(t.notes, '  '))
    return lines
  }
  lines.push(`  synth`)
  for (const key of SYNTH_PARAM_ORDER) {
    const value = t.synth[key]
    lines.push(`    ${key} ${key === 'osc' ? String(value) : formatNumber(value as number)}`)
  }
  // v0.3 optional fields: canonical elision — emitted iff != default, in table order. One
  // canonical form per state (the elision rule is deterministic in both directions).
  for (const def of SYNTH_FIELDS) {
    const value = t.synth[def.key]
    if (value === def.default) continue
    // number defaults compare by value; formatNumber-normalized equality guards float noise
    if (def.kind === 'number' && formatNumber(value as number) === formatNumber(def.default as number)) continue
    const text = def.kind === 'number' ? formatNumber(value as number) : def.kind === 'trackref' ? (value === null ? 'none' : String(value)) : String(value)
    lines.push(`    ${def.key} ${text}`)
  }
  // v0.10: the ordered insert-effect chain. Phase 26 Stream DC folded drum tracks' old fixed
  // eq3->comp->distortion->bitcrush bus insert into this same reorderable list — see
  // BeatTrack.effects's comment — so drums now serializes it exactly like synth. (Instrument
  // tracks reach serializeEffectLines from their own branch above, before this generic one.)
  if (t.kind === 'synth' || t.kind === 'drums') lines.push(...serializeEffectLines(t.effects, '  '))
  lines.push(...grooveLine(t))
  // Phase 22 Stream AB: the OPEN lane list, declared order, one line per lane — only for tracks
  // that opted in (t.lanes.length > 0); a legacy/migrated track (t.lanes === []) emits none of
  // these, exactly as before. Comes before the legacy v0.5 lane-sample lines below so a track's
  // own declared identity reads first.
  if (t.kind === 'drums') {
    for (const decl of t.lanes) {
      lines.push(`  lane ${decl.name} ${serializeLaneBacking(decl.backing)}`)
    }
  }
  // v0.5 lane samples: DRUM_LANES order (canonical), one line per assigned lane. Unchanged —
  // still the only mechanism for a track with an empty `lanes` list (t.lanes.length === 0).
  if (t.kind === 'drums') {
    for (const lane of DRUM_LANES) {
      const ls = t.laneSamples[lane]
      if (ls) lines.push(`  lane ${lane} ${ls.sample} ${formatNumber(ls.gainDb)} ${formatNumber(ls.tune)}`)
    }
  }
  const laneOrder = t.kind === 'drums' ? declaredLaneNames(t) : DRUM_LANES
  // v0.4 clips: source order (creation order is meaningful, like tracks); content in canonical
  // form (sorted notes / sorted hits) one indent level deeper than live content.
  for (const clip of t.clips) {
    lines.push(`  clip ${clip.id}`)
    lines.push(...serializeClipProps(clip, '    '))
    if (t.kind === 'drums') lines.push(...sortedHitLines(clip.hits, laneOrder, '    '))
    lines.push(...sortedNoteLines(clip.notes, '    '))
    lines.push(...serializeAutomationLanes(t.id, clip.automation, '    '))
  }
  if (t.kind === 'drums') {
    lines.push(...sortedHitLines(t.hits, laneOrder, '  '))
  }
  lines.push(...sortedNoteLines(t.notes, '  '))
  return lines
}

// v0.10: one `group <id> <name> <color> <track-id>...` line per group — flat, no nesting. Member
// track ids serialize in the group's OWN order (its own membership list), not the document's track
// order; the color/name tokens are single tokens by construction (same whitespace-free rule as track
// names, enforced at edit time — see validateGroupIdentity in edit.ts).
function serializeGroup(g: BeatGroup): string[] {
  return [`group ${g.id} ${g.name} ${g.color} ${g.tracks.join(' ')}`]
}

// v0.4: scene slots serialize in TRACK order (not insertion order) — one canonical form, and a
// re-mapped slot is a one-line diff. v0.10 (Phase 32 Stream LB): an optional `name` line comes
// right after the header, before the slots — canonical elision (D9): omitted entirely when
// absent, so every pre-existing scene (no name) round-trips byte-identically.
function serializeScene(scene: BeatScene, trackOrder: string[]): string[] {
  const lines = [`scene ${scene.id}`]
  if (scene.name !== undefined) lines.push(`  name ${scene.name}`)
  for (const trackId of trackOrder) {
    const clipId = scene.slots[trackId]
    if (clipId !== undefined) lines.push(`  slot ${trackId} ${clipId}`)
  }
  return lines
}

// Deterministic: two BeatDocuments that are musically identical always serialize to
// byte-identical text (canonical field order, canonical number formatting, canonical note sort —
// see document.ts and format.ts). Track order is preserved as given (source order is meaningful,
// see format-spec.md), everything within a track is put in canonical form. Canonical block
// order: header, tracks, scenes, song.
export function serialize(doc: BeatDocument): string {
  const lines: string[] = [
    `format_version ${doc.formatVersion}`,
    `bpm ${formatNumber(doc.bpm)}`,
    `loop_bars ${formatNumber(doc.loopBars)}`,
    `selected_track ${doc.selectedTrack}`,
  ]
  if (doc.media.length > 0) {
    lines.push('', 'media')
    for (const m of doc.media) {
      lines.push(`  sample ${m.id} sha256:${m.sha256} ${m.path}`)
    }
  }
  for (const t of doc.tracks) {
    lines.push('', ...serializeTrack(t))
  }
  // v0.10 groups: source order (creation order is meaningful, like clips/scenes), after tracks and
  // before scenes (canonical order — parse.ts enforces the same).
  for (const g of doc.groups) {
    lines.push('', ...serializeGroup(g))
  }
  const trackOrder = doc.tracks.map((t) => t.id)
  for (const scene of doc.scenes) {
    lines.push('', ...serializeScene(scene, trackOrder))
  }
  if (doc.song) {
    lines.push('', 'song')
    for (const section of doc.song) {
      lines.push(`  section ${section.scene} ${formatNumber(section.bars)}`)
    }
  }
  return lines.join('\n') + '\n'
}
