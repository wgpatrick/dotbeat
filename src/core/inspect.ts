// `beat inspect` — docs/phase-2-plan.md §2.3. A compact, deterministic overview of a document
// for humans and agents. (The CLI's --json mode doesn't come through here — it just prints the
// parsed document; this is the human-shaped view.)

import type { BeatClip, BeatDocument, BeatDrumHit, BeatGroup, BeatTrack, DrumVoiceType } from './document.js'
import { DRUM_LANES, SYNTH_FIELDS, declaredLaneNames, sortPlacements } from './document.js'
import { serializeLaneBacking } from './serialize.js'
import { formatNumber } from './format.js'
import { unplacedContentTracks, unplacedContentWarning } from './coverage.js'

// v0.9: ", auto: cutoff(3), volume(2)" — lane names + point counts, in lane order; empty when
// the clip has no automation (the common case, and every v0.8-and-earlier file).
function clipAutomationSummary(c: BeatClip): string {
  if (c.automation.length === 0) return ''
  return `, auto: ${c.automation.map((l) => `${l.param}(${l.points.length})`).join(', ')}`
}

// v0.10 (Phase 22 Stream AG): ", loop 0-4, sig 3/4" — present only when the clip declares an
// override; the common case (no override) prints nothing, matching clipAutomationSummary's elision.
function clipPropsSummary(c: BeatClip): string {
  const parts: string[] = []
  if (c.loop) parts.push(`loop ${formatNumber(c.loop.start)}-${formatNumber(c.loop.end)}`)
  if (c.signature) parts.push(`sig ${formatNumber(c.signature.numerator)}/${formatNumber(c.signature.denominator)}`)
  return parts.length ? `, ${parts.join(', ')}` : ''
}

// Phase 35 Stream OB (pilot 94 cosmetic; pilot 101 medium 2): drums tracks no longer get the
// misleading full `synth:` header line — osc/ADSR mean nothing to a drum track. What the drums
// track's shared synth block DOES drive is the drum BUS (volume/pan fader, bus filter, and the
// per-type effect knob values — see ui/src/audio/engine.ts applyDrumBusParams), so that subset is
// shown honestly as a `bus:` line, and per-lane truth gets its own `lanes:` section below.
//
// Legacy implicit-5-lane tracks (empty `lanes` list): each lane is synth-backed by the old
// track-wide drum voice unless a v0.5 laneSamples entry overrides it. The voice + the track-wide
// param fields that shape it, per lane, with defaults from SYNTH_FIELDS elided — the same
// name=value spelling `beat set <file> <track>.<field> <value>` accepts.
const LEGACY_LANE_VOICES: Record<string, { voice: DrumVoiceType; params: string[] }> = {
  kick: { voice: 'membrane', params: ['kickTune', 'kickPunch', 'kickDecay'] },
  snare: { voice: 'noise', params: ['snareTone', 'snareDecay'] },
  clap: { voice: 'noise', params: [] },
  hat: { voice: 'metal', params: ['hatDecay', 'hatTone'] },
  openhat: { voice: 'metal', params: ['openHatDecay', 'hatTone'] },
}
const SYNTH_FIELD_DEFAULTS: Map<string, unknown> = new Map(SYNTH_FIELDS.map((f) => [f.key, f.default]))

// One lane's backing truth. Declared lanes reuse serializeLaneBacking verbatim (the inspect view
// and the file's own `lane` line are the same string, so they can never drift); legacy lanes get
// the equivalent spelling built from the track-wide fields / laneSamples bag their playback
// actually reads.
function legacyLaneBackingSummary(t: BeatTrack, lane: string): string {
  const ls = t.laneSamples[lane as keyof typeof t.laneSamples]
  if (ls) return `sample ${ls.sample} ${formatNumber(ls.gainDb)} ${formatNumber(ls.tune)}`
  const v = LEGACY_LANE_VOICES[lane]
  if (!v) return 'synth' // unreachable for real legacy tracks (closed 5-lane set)
  const synth = t.synth as unknown as Record<string, number>
  const overrides = v.params
    .filter((key) => formatNumber(synth[key] ?? Number.NaN) !== formatNumber((SYNTH_FIELD_DEFAULTS.get(key) as number) ?? Number.NaN))
    .map((key) => `${key}=${formatNumber(synth[key]!)}`)
  return [`synth:${v.voice}`, ...overrides].join(' ')
}

// Phase 35 Stream OB (pilot 101 medium 1): the pattern grid renders the REAL loop length — one
// cell per 16th step across all loop bars, bars separated by a space, wrapped to a fresh row
// every 4 bars (64 cells) so long loops chunk instead of overflowing — never silently truncated
// to the first 16 steps contradicting its own hit count.
function drumGridLines(lane: string, pad: number, laneHits: BeatDrumHit[], gridSteps: number): string[] {
  const grid = Array<number>(gridSteps).fill(0)
  let offGrid = 0
  let withDuration = 0
  for (const h of laneHits) {
    if (!Number.isInteger(h.start)) offGrid++
    if (h.duration !== undefined) withDuration++
    const cell = ((Math.round(h.start) % gridSteps) + gridSteps) % gridSteps
    if (h.velocity > grid[cell]!) grid[cell] = h.velocity
  }
  const cells = grid.map((v) => (v === 0 ? '.' : v >= 0.75 ? 'X' : 'x'))
  const bars: string[] = []
  for (let i = 0; i < gridSteps; i += 16) bars.push(cells.slice(i, i + 16).join(''))
  const rows: string[] = []
  for (let i = 0; i < bars.length; i += 4) rows.push(bars.slice(i, i + 4).join(' '))
  const off = offGrid > 0 ? `, ${offGrid} off-grid` : ''
  const dur = withDuration > 0 ? `, ${withDuration} with duration` : ''
  const suffix = `  (${laneHits.length} hit${laneHits.length === 1 ? '' : 's'}${off}${dur})`
  return rows.map((row, i) => `  ${(i === 0 ? lane : '').padEnd(pad)} ${row}${i === rows.length - 1 ? suffix : ''}`)
}

// Phase 22 Stream AE: "smp_drumloop 0-8s (repitch x1.5, -3 dB)" — the audio-region equivalent of
// the note/hit summaries below, one line per clip's region.
function audioRegionSummary(c: BeatClip): string {
  if (!c.audio) return `${c.id} (no audio region)`
  const a = c.audio
  const warp = a.warp === 'off' ? 'unwarped' : a.warp === 'repitch' ? `repitch x${formatNumber(a.rate)}` : 'complex (unimplemented)'
  return `${c.id} (${a.media} ${formatNumber(a.in)}-${formatNumber(a.out)}s, ${warp}, ${formatNumber(a.gainDb)} dB${clipAutomationSummary(c)})`
}

function describeTrack(t: BeatTrack, loopSteps: number, groupByTrack: Map<string, BeatGroup>): string[] {
  const lines: string[] = []
  const s = t.synth
  // v0.10 (Phase 33 Stream MD item 1): a track's group membership, when it has one — elided
  // (matching the file's other elision conventions) for the common case of no group. research/98
  // found the plain-text view showed no trace of groups at all even though --json and
  // `diff --git` both correctly reflected them.
  const group = groupByTrack.get(t.id)
  lines.push(`${t.id}  "${t.name}"  ${t.kind}  ${t.color}${group ? `  group: ${group.id} ("${group.name}")` : ''}`)
  if (t.kind === 'instrument' && t.instrument) {
    lines.push(`  soundfont: ${t.instrument.sample} program ${formatNumber(t.instrument.program)}, ${formatNumber(t.instrument.volume)} dB, pan ${formatNumber(t.instrument.pan)}`)
  } else if (t.kind === 'audio') {
    // Phase 22 Stream AE: audio tracks carry no synth block and no live/non-clip content — every
    // audio-region clip is listed below, same as the `clips:` line other kinds get.
    lines.push(`  clips: ${t.clips.length === 0 ? 'none' : t.clips.map(audioRegionSummary).join(', ')}`)
    return lines
  } else if (t.kind === 'drums') {
    // Phase 35 Stream OB: the subset of the shared synth block a drums track actually plays
    // through (the drum bus) — no osc/ADSR line pretending the track is a synth (pilot 94/101).
    lines.push(`  bus: ${formatNumber(s.volume)} dB, cutoff ${formatNumber(s.cutoff)} Hz, res ${formatNumber(s.resonance)}, pan ${formatNumber(s.pan)}`)
  } else {
    lines.push(`  synth: ${s.osc}, ${formatNumber(s.volume)} dB, cutoff ${formatNumber(s.cutoff)} Hz, res ${formatNumber(s.resonance)}, ADSR ${formatNumber(s.attack)}/${formatNumber(s.decay)}/${formatNumber(s.sustain)}/${formatNumber(s.release)}, pan ${formatNumber(s.pan)}`)
  }
  // v0.10: the ordered insert-effect chain — always shown, even at the default order, so an agent
  // can see chain order without diffing against the format's default. Phase 26 Stream DC widened
  // this from synth-only to drums/instrument too (audio tracks carry no effects chain).
  if (t.kind === 'synth' || t.kind === 'drums' || t.kind === 'instrument') {
    const chain = t.effects.map((e) => `${e.id}(${e.type}${e.enabled ? '' : ', bypassed'})`).join(' -> ')
    lines.push(`  effects: ${chain || '(none)'}`)
  }
  if (t.kind === 'drums') {
    const laneNames = declaredLaneNames(t)
    const pad = Math.max(7, ...laneNames.map((n) => n.length))
    // Phase 35 Stream OB (pilot 101 medium 2): per-lane TRUTH — name + the backing that actually
    // plays (synth voice / sample id gain tune / sf) with non-default params, before the grids.
    // Declared lanes print their decl's exact canonical backing string; legacy tracks print the
    // equivalent built from what their playback path reads (track-wide voice fields, laneSamples).
    lines.push(`  lanes:${t.lanes.length === 0 ? ' (implicit legacy 5-lane kit)' : ''}`)
    if (t.lanes.length > 0) {
      for (const decl of t.lanes) lines.push(`    ${decl.name.padEnd(pad)} ${serializeLaneBacking(decl.backing)}`)
    } else {
      for (const lane of laneNames) lines.push(`    ${lane.padEnd(pad)} ${legacyLaneBackingSummary(t, lane)}`)
    }
    // Phase 35 Stream OB (pilot 101 low): on a DECLARED-lane track the v0.5 laneSamples bag is
    // dead data — playback reads only the declarations above. The serializer keeps round-tripping
    // it (D4: never destroy content silently), so flag it here and point at the explicit one-shot
    // cleanup. (`beat lane <track> <lane> none` is NOT that cleanup — it reverts the DECLARED
    // backing to its synth voice.)
    if (t.lanes.length > 0) {
      const stale = DRUM_LANES.filter((lane) => t.laneSamples[lane])
      if (stale.length > 0) {
        lines.push(`  legacy lane lines (ignored by playback): ${stale.join(', ')} — stale v0.5 sample assignments; the declared lanes above are what plays. Remove with \`beat lane <file> ${t.id} --clear-legacy\`.`)
      }
    }
    // v0.8: hits are free-timed events, rendered as a step-grid VIEW (X >= 0.75, x > 0, . = off —
    // a hit shows in the cell nearest its start) with off-grid hits (fractional start) counted
    // separately, so loose/tapped timing is visible without the grid lying. Phase 22 Stream AB:
    // iterate the track's own declared lanes (or the implicit 5 DRUM_LANES for a legacy/migrated
    // track) instead of the closed enum, so a custom-named lane's hits show. Phase 35 Stream OB:
    // the grid spans the WHOLE loop (chunked; see drumGridLines), not a silent first-16-steps cut.
    for (const lane of laneNames) {
      lines.push(...drumGridLines(lane, pad, t.hits.filter((h) => h.lane === lane), loopSteps))
    }
  } else {
    const n = t.notes.length
    if (n === 0) {
      lines.push('  notes: none')
    } else {
      const pitches = t.notes.map((x) => x.pitch)
      const starts = t.notes.map((x) => x.start)
      lines.push(`  notes: ${n}, pitch ${Math.min(...pitches)}-${Math.max(...pitches)}, steps ${Math.min(...starts)}-${Math.max(...starts)} of ${loopSteps}`)
    }
  }
  if (t.clips.length > 0) {
    lines.push(
      `  clips: ${t.clips
        .map((c) =>
          t.kind === 'audio'
            ? audioRegionSummary(c)
            : `${c.id} (${t.kind === 'drums' ? `${c.hits.length} hits` : `${c.notes.length} note${c.notes.length === 1 ? '' : 's'}`}${clipAutomationSummary(c)}${clipPropsSummary(c)})`,
        )
        .join(', ')}`,
    )
  }
  return lines
}

export function describeDocument(doc: BeatDocument): string {
  const loopSteps = doc.loopBars * 16
  const groupByTrack = new Map<string, BeatGroup>()
  for (const g of doc.groups) for (const trackId of g.tracks) groupByTrack.set(trackId, g)
  const lines: string[] = [
    `format ${doc.formatVersion} | ${formatNumber(doc.bpm)} bpm | ${doc.loopBars} bar${doc.loopBars === 1 ? '' : 's'} (${loopSteps} steps) | selected: ${doc.selectedTrack}`,
    `tracks: ${doc.tracks.length}`,
    '',
  ]
  for (const t of doc.tracks) {
    lines.push(...describeTrack(t, loopSteps, groupByTrack), '')
  }
  // v0.10 (Phase 33 Stream MD item 1): groups section, canonical position after tracks/before
  // scenes (matches document.ts's own field order comment). Same one-line-per-item, elided-when-
  // empty style as the `scene ${s.id}: ...` lines just below.
  for (const g of doc.groups) {
    lines.push(`group ${g.id}: "${g.name}" ${g.color} — ${g.tracks.join(', ')}`)
  }
  if (doc.groups.length > 0) lines.push('')
  for (const s of doc.scenes) {
    // v0.11: one `track=clip[@at]` token per placement, canonical (at, clip id) order within a
    // track, `@at` elided at 0 — so a pre-v0.11 scene prints exactly as before.
    const slots = Object.entries(s.slots)
      .flatMap(([tr, placements]) => sortPlacements(placements).map((p) => `${tr}=${p.clip}${p.at !== 0 ? `@${formatNumber(p.at)}` : ''}`))
      .join(' ')
    lines.push(`scene ${s.id}: ${slots || '(empty)'}`)
  }
  if (doc.scenes.length > 0) lines.push('')
  if (doc.song) {
    const total = doc.song.reduce((sum, x) => sum + x.bars, 0)
    lines.push(`song: ${doc.song.map((x) => `${x.scene}(${x.bars})`).join(' ')} — ${total} bars total`)
  }
  // Phase 39 Stream UA (pilot 105 HIGH): the silent-render trap — in song mode, a track with real
  // content that's placed in no scene the song plays renders silent with no other warning anywhere.
  // One ⚠ line per such track, after the scenes/song block. Loop mode never trips this (see
  // coverage.ts) so the block is empty and prints nothing.
  const silent = unplacedContentTracks(doc)
  if (silent.length > 0) {
    lines.push('')
    for (const t of silent) lines.push(unplacedContentWarning(t))
  }
  return lines.join('\n').replace(/\n+$/, '\n')
}
