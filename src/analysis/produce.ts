// Produced defaults (docs/research/115-production-layer-techniques.md, plan item A1) — the shared,
// role-aware production layer that every generated project ships with, so a gen-kit output or a
// taste seed reads as a list of deliberate production decisions instead of the canonical dry / mono
// / static init patch (D9: "an init patch is still 9 lines").
//
// WHY this exists: the blind source-showdown eval found dotbeat's synth loses to commercial chops
// on production RICHNESS, not cleanliness — measured gaps are mono output (stereo width ≈ -52 dB vs
// ≈ -11 dB for real records), near-zero air-band energy, and the lowest production-COMPLEXITY
// scores, while production-QUALITY was flat across sources. An ablation that added ONLY production
// edits (width / air / glue — same notes, same patch) moved the engine from 3% to 29% of blind
// pairwise wins (63% on lead). The format already owns all the DSP; nothing in the generation path
// ever TOUCHED it. This module is that touch.
//
// The moves are intensify-only (Math.max against the patch's own settings), so a patch that already
// carries some production keeps it — the taste loop searches FROM a produced starting point instead
// of asking CMA-ES/vary to rediscover mixing practice. Everything here is a deterministic function
// of role: no rng, byte-stable per caller-seed. `applyProducedDefaults` is the one primitive;
// `applyProductionTreatment` (src/taste/showdown.ts) is a thin wrapper over it whose engineplus
// ablation semantics are FROZEN science.

import {
  addEffect,
  type BeatDocument,
  type BeatSynth,
} from '../core/index.js'

export class BeatProduceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BeatProduceError'
  }
}

const rnd2 = (x: number): number => Math.round(x * 100) / 100

/** The musical roles the production profiles cover. Callers map their own track identity onto one
 * of these via `productionRoleFor`. */
export type ProductionRole =
  | 'kick'
  | 'snare'
  | 'hats'
  | 'perc'
  | 'bass'
  | 'sub'
  | 'lead'
  | 'pad'
  | 'chords'
  | 'arp'
  | 'kit'
  | 'default'

/** A production profile: the target intensities for one role. Every field is optional; an absent
 * field means "this role does not want this move" (e.g. bass/sub carry no width fields at all —
 * research 115 §2.2, mono-anchored low end). All numeric moves are intensify-only against the
 * patch's current value, so applying a profile never quiets an already-produced patch. */
export interface ProductionProfile {
  /** which role this profile is for — carried for diagnostics / callers */
  role: ProductionRole
  // ---- width (osc bank — synth voices only; drum/sample voices ignore the osc bank) ----
  /** a same-osc detuned second oscillator: thickness, not a new timbre. Applied only when the
   * patch has no osc2 layer yet (osc2Level <= 0). */
  osc2Layer?: { level: number; detuneCents: number }
  /** unison stereo spread (voices + width), intensify-only via Math.max. */
  unison?: { voices: number; width: number }
  /** low-level filtered-noise wash under leads/pads (research 115 §3.2), intensify-only. */
  noiseLevel?: number
  // ---- width (inserts — work on synth AND sample/drum voices, the summed track output) ----
  /** chorus insert mix, intensify-only; turns the insert on (mode chorus) when it was off. */
  chorusMix?: number
  /** utility insert stereo width (0.5 = neutral, >0.5 wider), intensify-only; adds the insert. */
  utilityWidth?: number
  // ---- glue ----
  /** saturator drive+mix — gentle harmonic density, "make it less digital" (research 115 §5). */
  saturator?: { drive: number; mix: number }
  // ---- space (shared return buses) ----
  /** reverb send (0..1) — the stereo bus is the passive width bed. Set-if-below. */
  sendReverb?: number
  /** delay send (0..1). Set-if-below. */
  sendDelay?: number
  // ---- air ----
  /** eq3 high-shelf gain (dB); set-if-below, and ensures an enabled eq3 insert carries it. */
  eqHigh?: number
  // ---- motion ----
  /** auto-pan insert (mono-safe width-via-motion — research 115 §2.1); applied when the current
   * autoPan mix is below target, and ensures the insert. */
  autoPan?: { rate: number; depth: number; mix: number }
  /** sidechain pump (research 115 §4.2) — the genre's defining glue. `source` must be an existing
   * track id whose kick lane triggers the duck. Profiles never set this themselves (they can't know
   * the source track id); a caller augments the profile with it (gen-kit points bass at the kit). */
  duck?: { source: string; amount: number }
}

/** Map a track id / gen-kit role name onto a production role. Unknown ids fall back to `default`
 * (a mild all-round profile) rather than erroring — a produced default should degrade gracefully. */
export function productionRoleFor(id: string): ProductionRole {
  const k = id.toLowerCase()
  if (k === 'kick') return 'kick'
  if (k === 'snare' || k === 'clap' || k === 'rimshot') return 'snare'
  if (k === 'hats' || k === 'hat' || k === 'openhat' || k === 'hihat') return 'hats'
  if (k === 'perc' || k === 'percussion' || k === 'cowbell' || k === 'tom' || k === 'crash' || k === 'ride') return 'perc'
  if (k === 'bass' || k === 'sub') return k === 'sub' ? 'sub' : 'bass'
  if (k === 'lead' || k === 'arp' || k === 'melody' || k === 'pluck') return 'lead'
  if (k === 'pad' || k === 'pads') return 'pad'
  if (k === 'chords' || k === 'chord' || k === 'keys' || k === 'stab') return 'chords'
  if (k === 'kit' || k === 'drums' || k === 'drum') return 'kit'
  return 'default'
}

/** The full-strength (gen-kit tier) profile per role — the concrete ranges from research 115 §6
 * P1 (width), P2 (air), and P3 (motion), grounded there:
 *   - kick: punchy, mono, DRY. Only a touch of saturation (§5) — no width, no reverb, no air shelf
 *     (§2.2: bass/kick stay dry-center; the sub/kick is the one thing that must not be widened).
 *   - bass/sub: mono-anchored low end (§1.1, §2.2). Saturation for the mid/top harmonics that let
 *     bass read on small speakers — but NO width (no unison/chorus/utility), NO reverb send.
 *   - lead: the full 2-4-layer width stack (§1.1) — osc2 detune layer + unison + chorus + utility
 *     width — plus space (reverb/delay sends, §2.1) and an air shelf (§3.3).
 *   - pad/chords: widest + most reverb (the passive width bed lives under pads), a noise wash
 *     (§3.2), slightly less air than lead.
 *   - hats/perc: air shelf (the genre's air-band carrier, §3.1) + auto-pan motion (§2.1, §4.1) +
 *     a little reverb — NO low-end width.
 *   - snare: crack/air shelf + a touch of reverb + glue.
 *   - kit: the drum-BUS profile (a single dotbeat track carries kick+snare+hats+perc as lanes, so
 *     the bus contains the kick) — conservative on purpose: air shelf (safe for the kick, lifts the
 *     hats) + light glue only. NO width, NO reverb, NO auto-pan — anything that would widen or wet
 *     the kick is withheld at the bus level (§2.2). A hats/perc track that stands alone gets the
 *     full hats/perc profile instead. */
function baseProfile(role: ProductionRole): ProductionProfile {
  switch (role) {
    case 'kick':
      return { role, saturator: { drive: 0.2, mix: 0.25 } }
    case 'bass':
    case 'sub':
      return { role, saturator: { drive: 0.3, mix: 0.35 } }
    case 'snare':
      return { role, saturator: { drive: 0.2, mix: 0.25 }, eqHigh: 2, sendReverb: 0.12 }
    case 'hats':
      return { role, eqHigh: 3, sendReverb: 0.15, autoPan: { rate: 0.2, depth: 0.4, mix: 0.25 } }
    case 'perc':
      return { role, eqHigh: 2.5, sendReverb: 0.18, autoPan: { rate: 0.25, depth: 0.35, mix: 0.2 } }
    case 'lead':
      return {
        role,
        osc2Layer: { level: 0.3, detuneCents: 8 },
        unison: { voices: 5, width: 0.65 },
        chorusMix: 0.22,
        utilityWidth: 0.6,
        saturator: { drive: 0.22, mix: 0.28 },
        sendReverb: 0.2,
        sendDelay: 0.1,
        eqHigh: 3,
      }
    case 'pad':
    case 'chords':
      return {
        role,
        osc2Layer: { level: 0.3, detuneCents: 10 },
        unison: { voices: 5, width: 0.7 },
        noiseLevel: 0.06,
        chorusMix: 0.3,
        utilityWidth: 0.68,
        saturator: { drive: 0.18, mix: 0.25 },
        sendReverb: 0.28,
        sendDelay: 0.08,
        eqHigh: 2.5,
      }
    case 'arp':
      return baseProfile('lead')
    case 'kit':
      return { role, saturator: { drive: 0.18, mix: 0.22 }, eqHigh: 2.5 }
    default:
      return {
        role: 'default',
        chorusMix: 0.15,
        utilityWidth: 0.6,
        saturator: { drive: 0.2, mix: 0.25 },
        sendReverb: 0.15,
        eqHigh: 2,
      }
  }
}

export interface ProfileOptions {
  /** `genkit` (default): full strength, deterministic function of role, no rng — every gen-kit
   * `.beat` stays byte-deterministic per seed. `seed`: ~60% strength (variation fodder — keep
   * headroom so vary batches can move in both directions), with an optional small seeded jitter. */
  tier?: 'genkit' | 'seed'
  /** seed-tier only: a deterministic rng (seeded from the caller's own seed) for the small jitter.
   * Omit for no jitter. Never read at genkit tier. */
  rng?: () => number
}

const SEED_TIER_SCALE = 0.6

/** Reduce a base profile to the seed tier: ~60% of every intensity, voices kept whole, utility
 * width scaled around its 0.5 neutral, with a small (±7.5%) seeded jitter when an rng is given.
 * Air (eqHigh) and sends scale down so seeds keep headroom for vary batches to move both ways. */
function scaleToSeedTier(p: ProductionProfile, rng?: () => number): ProductionProfile {
  const k = SEED_TIER_SCALE
  const j = (): number => (rng ? 1 + (rng() - 0.5) * 0.15 : 1)
  const out: ProductionProfile = { role: p.role }
  if (p.osc2Layer) out.osc2Layer = { level: rnd2(p.osc2Layer.level * k), detuneCents: p.osc2Layer.detuneCents }
  if (p.unison) out.unison = { voices: p.unison.voices, width: rnd2(p.unison.width * k * j()) }
  if (p.noiseLevel !== undefined) out.noiseLevel = rnd2(p.noiseLevel * k)
  if (p.chorusMix !== undefined) out.chorusMix = rnd2(p.chorusMix * k * j())
  if (p.utilityWidth !== undefined) out.utilityWidth = rnd2(0.5 + (p.utilityWidth - 0.5) * k * j())
  if (p.saturator) out.saturator = { drive: rnd2(p.saturator.drive * k), mix: rnd2(p.saturator.mix * k) }
  if (p.sendReverb !== undefined) out.sendReverb = rnd2(p.sendReverb * k * j())
  if (p.sendDelay !== undefined) out.sendDelay = rnd2(p.sendDelay * k)
  if (p.eqHigh !== undefined) out.eqHigh = rnd2(p.eqHigh * k)
  if (p.autoPan) out.autoPan = { rate: p.autoPan.rate, depth: p.autoPan.depth, mix: rnd2(p.autoPan.mix * k) }
  // duck is never on a base profile; it is caller-supplied and not scaled here.
  return out
}

/** The production profile for a role. Deterministic function of (role, tier[, seeded rng]). */
export function productionProfileFor(role: ProductionRole, opts: ProfileOptions = {}): ProductionProfile {
  const base = baseProfile(role)
  if ((opts.tier ?? 'genkit') === 'seed') return scaleToSeedTier(base, opts.rng)
  return base
}

export interface ProducedResult {
  doc: BeatDocument
  /** honest, human-readable list of what was actually changed. */
  applied: string[]
}

/** Apply a production profile to `trackId` — the one primitive. Notes/hits are untouched by
 * construction; only the synth patch and (where a move needs one) the insert chain change. Every
 * move is intensify-only, so a patch already carrying production keeps its own richer settings.
 * osc-bank moves (osc2/unison/noise) apply to synth-kind tracks only — drum and sample voices don't
 * read the osc bank, so claiming them there would be dishonest; their width comes from the chorus /
 * utility inserts and the stereo reverb bus instead. */
export function applyProducedDefaults(doc: BeatDocument, trackId: string, profile: ProductionProfile): ProducedResult {
  const track = doc.tracks.find((t) => t.id === trackId)
  if (!track) throw new BeatProduceError(`no track "${trackId}" to produce (have: ${doc.tracks.map((t) => t.id).join(', ')})`)
  if (track.kind !== 'synth' && track.kind !== 'drums') {
    throw new BeatProduceError(`production covers synth/drums tracks, and "${trackId}" is ${track.kind}`)
  }
  const isSynth = track.kind === 'synth'
  const applied: string[] = []
  const s: BeatSynth = { ...track.synth }
  let addUtility = false
  let addAutoPan = false
  let ensureEq3 = false

  // --- width: osc bank (synth voices only) ---
  if (profile.osc2Layer && isSynth && s.osc2Level <= 0) {
    s.osc2Type = s.osc // a detuned layer of the same voice — thickness, not a new timbre
    s.osc2Level = profile.osc2Layer.level
    s.osc2Detune = profile.osc2Layer.detuneCents
    applied.push(`osc2 layer (same osc, +${profile.osc2Layer.detuneCents}c, level ${profile.osc2Layer.level})`)
  }
  if (profile.unison && isSynth && (s.unisonVoices < profile.unison.voices || s.unisonWidth < profile.unison.width)) {
    s.unisonVoices = Math.max(s.unisonVoices, profile.unison.voices)
    s.unisonWidth = Math.max(s.unisonWidth, profile.unison.width)
    applied.push(`unison ${s.unisonVoices} voices width ${rnd2(s.unisonWidth)}`)
  }

  // --- width: inserts (any voiced track) ---
  if (profile.chorusMix !== undefined && (s.chorusMode === 'off' || s.chorusMix < profile.chorusMix)) {
    if (s.chorusMode === 'off') s.chorusMode = 'chorus'
    s.chorusMix = Math.max(s.chorusMix, profile.chorusMix)
    applied.push(`chorus mix ${rnd2(s.chorusMix)}`)
  }
  // utility (mid/side widener) is a reorderable-chain insert the engine wires on synth tracks; the
  // drum bus's fixed tail doesn't carry it, so a drum/sample track's width comes from chorus + the
  // stereo reverb send instead (setting an inert utility field/insert there would be dishonest).
  if (profile.utilityWidth !== undefined && isSynth && s.utilityWidth < profile.utilityWidth) {
    s.utilityWidth = Math.max(s.utilityWidth, profile.utilityWidth)
    addUtility = true
    applied.push(`utility width ${rnd2(s.utilityWidth)}`)
  }

  // --- glue ---
  if (profile.saturator && (s.saturatorDrive < profile.saturator.drive || s.saturatorMix < profile.saturator.mix)) {
    s.saturatorDrive = Math.max(s.saturatorDrive, profile.saturator.drive)
    s.saturatorMix = Math.max(s.saturatorMix, profile.saturator.mix)
    applied.push(`saturator drive ${rnd2(s.saturatorDrive)} mix ${rnd2(s.saturatorMix)}`)
  }

  // --- space ---
  if (profile.sendReverb !== undefined && s.sendReverb < profile.sendReverb) {
    s.sendReverb = profile.sendReverb
    applied.push(`sendReverb ${rnd2(profile.sendReverb)}`)
  }
  if (profile.sendDelay !== undefined && s.sendDelay < profile.sendDelay) {
    s.sendDelay = profile.sendDelay
    applied.push(`sendDelay ${rnd2(profile.sendDelay)}`)
  }

  // --- air ---
  if (profile.eqHigh !== undefined && s.eqHigh < profile.eqHigh) {
    s.eqHigh = profile.eqHigh
    ensureEq3 = true
    applied.push(`eqHigh +${rnd2(profile.eqHigh)} dB air`)
  }

  // --- texture wash (synth voices only) ---
  if (profile.noiseLevel !== undefined && isSynth && s.noiseLevel < profile.noiseLevel) {
    s.noiseLevel = Math.max(s.noiseLevel, profile.noiseLevel)
    applied.push(`noise wash ${rnd2(s.noiseLevel)}`)
  }

  // --- motion: auto-pan (reorderable-chain insert — synth tracks only, same reason as utility) ---
  if (profile.autoPan && isSynth && s.autoPanMix < profile.autoPan.mix) {
    s.autoPanRate = profile.autoPan.rate
    s.autoPanDepth = profile.autoPan.depth
    s.autoPanMix = Math.max(s.autoPanMix, profile.autoPan.mix)
    addAutoPan = true
    applied.push(`autoPan ${rnd2(s.autoPanRate)}Hz depth ${rnd2(s.autoPanDepth)} mix ${rnd2(s.autoPanMix)}`)
  }

  // --- motion: sidechain pump (caller-supplied source) ---
  if (profile.duck && doc.tracks.some((t) => t.id === profile.duck!.source) && (s.duckSource === null || s.duckAmount < profile.duck.amount)) {
    s.duckSource = profile.duck.source
    s.duckAmount = Math.max(s.duckAmount, profile.duck.amount)
    applied.push(`duck source ${profile.duck.source} amount ${rnd2(s.duckAmount)}`)
  }

  let out: BeatDocument = { ...doc, tracks: doc.tracks.map((t) => (t.id === trackId ? { ...t, synth: s } : t)) }
  // Inserts whose parameters we just set only sound through an enabled insert of their type. Every
  // synth/drums track carries a default eq3, but a chain explicitly emptied would not — and utility/
  // autoPan are never in the default chain — so re-add rather than silently no-op.
  if (ensureEq3 && !track.effects.some((e) => e.type === 'eq3' && e.enabled)) out = addEffect(out, trackId, 'eq3').doc
  if (addUtility && !out.tracks.find((t) => t.id === trackId)!.effects.some((e) => e.type === 'utility' && e.enabled)) {
    out = addEffect(out, trackId, 'utility').doc
  }
  if (addAutoPan && !out.tracks.find((t) => t.id === trackId)!.effects.some((e) => e.type === 'autoPan' && e.enabled)) {
    out = addEffect(out, trackId, 'autoPan').doc
  }
  return { doc: out, applied }
}

// ---- authoring helpers: the shared role/profile resolution the `beat add-track --produced` and
// `beat produce` authoring commands (and their MCP twins) use, so the two surfaces resolve a role
// and augment the one caller-supplied move (the sidechain duck) identically. Every width/air/glue
// VALUE still comes from baseProfile via productionProfileFor — these helpers only pick the role and
// point the duck at a real source; they invent no intensities. ------------------------------------

/** The sidechain-duck depth a produced bass/sub gets under the kit's kick (research 115 §4.2) — the
 * genre-defining pump. Matches the amount gen-kit wires (cli/beat.mjs genKitCmd); a caller-supplied
 * value, never on a base profile (a profile can't know the source track id). */
export const PRODUCED_DUCK_AMOUNT = 0.35

/** A drums track that carries a kick lane, to wire a bass/sub sidechain duck against. A drums track
 * with an explicit `lanes` list is checked for a lane literally named "kick"; a legacy/empty-lanes
 * drums track implicitly carries the 5 DRUM_LANES (which include kick), so it counts. Skips `exclude`
 * (never duck a track against itself) and returns the first match's id, or null. */
export function kickSourceTrack(doc: BeatDocument, exclude?: string): string | null {
  const t = doc.tracks.find(
    (t) => t.kind === 'drums' && t.id !== exclude && (t.lanes.length === 0 || t.lanes.some((l) => l.name === 'kick')),
  )
  return t?.id ?? null
}

export interface ResolvedProducedProfile {
  /** the production role this track resolved to (echoed in the receipt so the mapping is honest). */
  role: ProductionRole
  /** the profile to hand `applyProducedDefaults` — the role's base profile, plus a duck for bass/sub
   * when a kick source exists. */
  profile: ProductionProfile
}

/** Resolve the produced-defaults profile an authoring caller gets for a track. Role selection: an
 * explicit `override` (mapped through the same productionRoleFor synonym table, so user-facing
 * aliases like `keys` -> chords and `drums` -> kit resolve), else inferred from the track id; an
 * un-inferrable drums track (id that maps to `default`) falls back to the kit-bus profile rather
 * than the mild all-round default, since a drums track's bus carries the kick. Then a bass/sub
 * profile is augmented with a sidechain duck against a kick-carrying drums track when one exists —
 * the one genre-defining move a base profile can't set itself. */
export function resolveProducedProfile(doc: BeatDocument, trackId: string, override?: string): ResolvedProducedProfile {
  const kind = doc.tracks.find((t) => t.id === trackId)?.kind
  let role = productionRoleFor(override ?? trackId)
  if (role === 'default' && kind === 'drums') role = 'kit'
  let profile = productionProfileFor(role)
  if (role === 'bass' || role === 'sub') {
    const src = kickSourceTrack(doc, trackId)
    if (src) profile = { ...profile, duck: { source: src, amount: PRODUCED_DUCK_AMOUNT } }
  }
  return { role, profile }
}
