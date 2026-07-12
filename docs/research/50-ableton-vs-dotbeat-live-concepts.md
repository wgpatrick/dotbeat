# Research 50 — Ableton Live 12 vs dotbeat: feature & UI/UX comparison (Live Concepts, ch.3)

*2026-07-12. Owner-commissioned. Builds directly on
[`31-ableton-live-concepts.md`](31-ableton-live-concepts.md) (a text-only primer on the same
chapter, pp.33-59). That pass already cross-referenced several dotbeat gaps; this pass is
different in kind, not a re-run: it (a) actually views ~20 of the manual's own rendered page
images (`/Users/willpatrick/.claude/jobs/32ed678c/tmp/ableton-images/ch03/`, sample manifest read,
19-20 JPEGs viewed directly — Control Bar, Browser/Similarity Search, Session/Arrangement views,
Back-to-Arrangement, Device View, Scale Mode, Mixer, Crossfader, Routing, Automation/Clip
Envelopes, MIDI/Key Map, Saving/Exporting) to ground UI layout/iconography/terminology claims that
text alone can't carry, and (b) reads dotbeat's actual current GUI source
(`ui/src/components/*.tsx`, `ui/src/audio/engine.ts`, `src/core/document.ts`,
`src/core/pitchtime.ts`) this pass to check every claim against real code, not memory of prior
passes. Every Ableton claim is cited **[manual p.NNN]**; every dotbeat claim is cited to a real
`file:line`. Grounded throughout in `ROADMAP.md`, `docs/decisions.md`, and
`docs/product-roadmap.md` — nothing below contradicts an already-made decision or proposes
rebuilding something already shipped.*

---

## 1. Feature & UI/UX comparison

### a) Shared features / parity

- **Audio/MIDI as a structural track-kind split, not a color.** Ableton: audio clips cannot be
  added to MIDI tracks and vice versa [manual p.43]. dotbeat: `TrackKind = 'synth' | 'drums' |
  'instrument' | 'audio'` (`src/core/document.ts:8`) enforces the identical rule — dotbeat's three
  note-producing kinds map to Ableton's single "MIDI track" umbrella, `'audio'` maps to Ableton's
  audio track. **UI difference:** Ableton exposes this as one generic track type with a Browser
  clip-kind check at drag-time; dotbeat exposes it as an explicit, always-visible kind badge on
  every track row (`TrackList.tsx:27`, `MixerView.tsx:218`) — more legible at a glance, less
  flexible (no "convert this track's kind" operation exists in either tool).
- **Live Set inside a Live Project folder** [manual p.37-38] vs **`.beat` file inside a project
  folder** (`ROADMAP.md` §4-5). Same two-tier shape (a document + a folder of related media). **UI
  difference, structural, not cosmetic:** Ableton's Set is gzipped XML requiring an external
  decompress step to read/diff (`ROADMAP.md` §1's table); dotbeat's `.beat` is plain text, openable
  in any editor, diffable by plain `git diff` with zero tooling — this is the core positioning bet,
  not a detail (D4, D7 in `docs/decisions.md`).
- **Reference-based audio media with a stale-reference failure mode Ableton patches, dotbeat
  designs out.** Ableton: a sample reference can go stale if moved/deleted; **Collect All and
  Save** exists specifically to copy every referenced sample into the Project folder [manual p.58].
  dotbeat: media is content-addressed by SHA-256 with provenance sidecars, verified via git-lfs
  (`docs/decisions.md` D11). Both are "reference, don't duplicate by default" models — dotbeat's
  is the more robust version of the *same* underlying idea, not a different one (see §1c #2 for the
  differentiator framing).
- **Per-track/per-device effect chain.** Ableton: any number of audio effects, dragged from the
  Browser into Device View, freely reorderable [manual p.46-48]. dotbeat: an explicit ordered
  `BeatEffect[]` list per synth/drums track (`EFFECT_TYPES`, `src/core/document.ts:629-712`),
  add/remove/reorder/bypass via GUI or `beat effect-add`. **UI difference:** Ableton's chain is an
  open-ended drag-and-drop surface (any of dozens of built-in devices plus third-party VST/AU,
  [manual p.47]); dotbeat's is a closed enum of ~16 built-in effect types with no plugin-hosting
  story (a stated non-goal, `ROADMAP.md` §3) — same *mechanism* (ordered, per-track, bypassable),
  narrower *catalog* by design.
- **Presets, independent of the project, reusable across projects.** Ableton: every device stores/
  recalls presets in the User Library [manual p.54]. dotbeat: `presets/factory.json` (36 presets,
  `docs/product-roadmap.md`'s Preset/content library section), applied via the same edit-primitive
  path as any other change (D9 — "tooling, never grammar"). **UI difference:** Ableton drag-drops a
  preset file from Browser onto a track; dotbeat's Content Browser sidebar (`ContentBrowser.tsx`)
  does the same drag gesture but the *result* is different in kind — Ableton's preset is a stored
  external reference the Set points at, dotbeat's is expanded into literal `.beat` text at apply
  time (no indirection, no "what does this sound like depends on a library version" risk).
- **A full per-track mixer strip: volume, pan, sends, mute/solo, live metering.** Ableton's mixer
  channel [manual p.51-53] vs dotbeat's `ChannelStrip` (`MixerView.tsx:201-264`) and the arrangement
  header's `InlineStrip` (`ArrangementView.tsx:181-239`) — both real audio-gated mute/solo, both
  live post-fader meters. **UI difference:** Ableton's strip also carries an In/Out routing chooser
  and crossfader-assign buttons in the same column [manual p.51-53]; dotbeat's strip is deliberately
  narrower (no routing chooser needed — there's no arbitrary routing model to choose between, see
  §1b #16) but adds two things Ableton's base strip doesn't have inline: a live FX-badge summary
  (`MixerView.tsx:137-199`) and groove/shuffle knobs (`MixerView.tsx:225-244`).
- **Shared reverb/delay send buses, mechanically identical to return-track sends.** Ableton: any
  track can feed a send into a return track holding shared effects [manual p.51-52]. dotbeat:
  every track's `sendReverb`/`sendDelay` (`src/core/document.ts:386-387`) feeds two lazy shared
  `Tone.Reverb`/`Tone.FeedbackDelay` buses built once in `getBuses()` (`ui/src/audio/engine.ts:
  1766-1772`, fields at `1711-1712`). **UI difference, load-bearing:** Ableton's return tracks are
  user-addable, user-nameable, hold an *arbitrary* effect chain, and appear as their own mixer
  channel [manual p.51-52]; dotbeat's two buses are hardcoded (fixed reverb decay/wet, fixed delay
  time/feedback/wet), not independently processable beyond those presets, and invisible as a
  channel — only a `Rv`/`Dl` badge on the sending track (`ArrangementView.tsx:169-176`). The
  send *mechanism* is shared; the return-track *product* isn't (§1b #11).
- **Groove/shuffle as a reversible, playback-time transform, never baked into stored positions.**
  Ableton's Clip View shows a **Groove** chooser (screenshot, [manual p.50], reads "None" — this is
  Live's separate Groove Pool subsystem, referenced but not detailed in this chapter). dotbeat:
  `shuffleAmount`/`shuffleGrid` (`src/core/document.ts:721-722`), applied via `warpStep()`/
  `unwarpStep()` (`src/core/groove.ts`), mirrored live in the scheduler. **UI difference:** Ableton's
  Groove Pool is per-*clip*, extractable from real audio, shareable as named `.agr`-style templates,
  with its own Amount slider separate from the groove shape itself; dotbeat's is per-*track*, two
  literal knobs on the mixer strip (`MixerView.tsx:225-244`), no template library — same underlying
  idea (a reversible swing transform), a materially smaller feature (§1b #18).
- **Clip-level loop range + time signature override.** Ableton's Clip View Start/End/Loop/Position/
  Length/Signature block [manual p.44, screenshot p.45 and p.50]. dotbeat: `BeatClipLoop`/
  `BeatTimeSignature` (`src/core/document.ts:464-476`, `549-550`), edited via
  `ClipPropertiesPanel.tsx` and wired into real playback (Phase 24 Stream CJ). **UI difference:**
  Ableton bundles loop/signature with warp controls (audio clips) or scale controls (MIDI clips,
  [manual p.50]) in one stacked panel; dotbeat splits this across three separate panels
  (`ClipPropertiesPanel.tsx` for loop/signature, the Pitch & Time panel for scale-adjacent one-shot
  ops, a separate audio-clip warp/gain panel) — functionally equivalent data, more panel-hopping to
  reach it.
- **One-shot "fit notes to a scale" operation already exists**, just not as a *sticky, stored*
  mode. Ableton's Pitch and Time Utilities panel includes **Fit to Scale** as one operation among
  several [manual p.50 screenshot: "Fit to Scale" button]. dotbeat already ships the identical
  one-shot transform: `fitToScaleNotes(doc, trackId, root, scaleName, opts)`
  (`src/core/pitchtime.ts:139`), built on a real `SCALES` pitch-class table and `nearestScaleTone`
  matcher (`src/core/pitchtime.ts:102-134`), reachable from the GUI's Pitch & Time panel (Phase 23
  Stream BA, `docs/product-roadmap.md`'s "Pitch & Time operations" row, Done). **What's missing is
  Ableton's *other* half** — a persistent Scale Mode that stays active and constrains input/
  highlights the keyboard going forward — covered as a gap in §1b #2, not a parity item, because the
  stored/sticky/propagating behavior genuinely doesn't exist yet.
- **Undo-adjacent design instinct: "consolidate" as the escape hatch from a live transform to
  literal data.** Ableton doesn't literally have this concept in ch.3, but the *shape* — ratchets,
  shuffle, and (per §1c #6) a hypothetical arpeggiator all stay as live, re-editable parameters
  until an explicit bake — is dotbeat's own answer to the same tension Ableton's Clip Envelope
  unlinking [manual p.57] and Groove Pool amount-vs-shape split gesture at: keep transforms
  reversible for as long as possible. Listed here as a *design pattern* parity, not a literal
  feature match — `beat consolidate` already ships for ratchets (`docs/product-roadmap.md`'s "Note
  ratchet" row).

### b) In Ableton, not in dotbeat

Every row here also appears in §2's table with a decisive priority call. Session View itself is
listed for completeness but is a **documented non-decision, not a gap** (see the note on it below
and its Do-not-recreate row in §2).

1. **Native audio recording, Arm, Session Record / Arrangement Record, multi-take composite
   tracks.** Per-track Arm button (multi-arm via Ctrl/Cmd-click), Exclusive Arm auto-arming a new
   instrument-loaded track, Arrangement Record capturing every armed track's input as a new clip
   per take, Session Record for jam-then-launch capture [manual p.55-56]. dotbeat has **no capture
   path at all** today — confirmed absent from `TransportBar.tsx` (play/stop/BPM only, no record
   button) and `MixerView.tsx`/`ArrangementView.tsx` (mute/solo buttons only, no arm button anywhere
   in either channel strip). Already tracked: `docs/product-roadmap.md`'s "Native audio recording"
   row, explicitly gated on the Tauri/M4 native tier behind the confirmed ~30ms web-audio latency
   wall.
2. **Scale Awareness as a persistent, propagating mode** (Scale Mode toggle, Root Note + Scale Name
   choosers, **Highlight Scale** vs **Fold to Scale** as two distinct MIDI-Note-Editor options,
   propagation into MIDI Tools / Pitch and Time Utilities / MIDI-effect "Use Current Scale" toggles)
   [manual p.49-51]. dotbeat has the *transform* (`fitToScaleNotes`, §1a above) but zero stored
   scale field anywhere — confirmed by grep across `src/core/document.ts` this pass, zero matches
   for a scale-mode field. Already tracked, Not Started: `docs/product-roadmap.md`'s "Scale-lock
   field + scale-tone highlighting" row.
3. **Generic Fold mode** (collapse the piano roll to only pitches actually in use — a *different*,
   cheaper mechanism than Fold to Scale, confirmed by the manual's own text as a separate feature
   not detailed in this chapter [manual p.50 draws the distinction explicitly]). Already tracked,
   Not Started: `docs/product-roadmap.md`'s "Fold mode" row.
4. **Instrument-track FX chain.** Ableton's device-chain rule is stated flatly: MIDI effects →
   instrument → *any number of* audio effects, same as an audio track from that point on [manual
   p.46, p.53]. dotbeat's instrument (SoundFont) tracks stop at level/pan —
   `InstrumentPanel.tsx:147-204` renders only a program picker plus two `Knob`s (volume, pan), no
   effect chain at all, confirmed by reading the whole file this pass. Already tracked, Not
   Started: `docs/product-roadmap.md`'s "Instrument-track FX chain" row.
5. **Arrangement-timeline automation independent of any single clip.** Ableton's Automation
   Envelopes are keyed to Arrangement position (or, if recorded during Session-clip playback,
   attached to that clip) [manual p.57] — a genuinely separate mechanism from Clip Envelopes.
   dotbeat's automation is uniformly clip-scoped today (`docs/product-roadmap.md`'s Automation
   section: "Automation is currently scoped to one clip at a time," Not Started row "Multi-clip-
   per-track automation") — there's no timeline-keyed automation type at all, only the clip-envelope
   half of Ableton's two-tier model.
6. **Curved automation segments** (hold/linear/curve interpolation per breakpoint — v0.9's
   automation grammar is points-only, linear between them). Already tracked, Not Started:
   `docs/product-roadmap.md`'s "Curved segments" row.
7. **Same-row automation curve overlay** (draw the curve directly over the clip row instead of only
   in a dedicated sub-lane). Already tracked, Not Started.
8. **Log-scale y-axis for frequency-style automation params.** Already tracked, Not Started.
9. **Automation manual-override semantics: touching an automated control suspends tracking rather
   than erasing the envelope, until Re-Enable Automation is pressed** [manual p.57]. No dotbeat
   equivalent, no current roadmap row — flagged in `31-ableton-live-concepts.md` §"Gaps" item 5(b)
   as a forward design note, not yet a scoped feature.
10. **Clip envelopes independently unlinked from the clip's own loop length**, so a longer gesture
    (fade-out) or shorter one (arpeggio pattern) can superimpose on the clip's material without
    being forced to repeat at the clip's loop length [manual p.57]. No dotbeat equivalent yet
    (dotbeat has no per-clip automation lanes to unlink in the first place — this is a design
    precedent for when it does, not an independent build).
11. **Return tracks as user-addable, user-visible, arbitrarily-processable mixer channels** — vs
    dotbeat's two hardcoded reverb/delay buses (§1a above). [manual p.51-52]
12. **Group tracks as a real submixer** — member tracks' audio actually sums through a shared gain/
    FX stage before the master [manual p.55], vs dotbeat's `BeatGroup` (`src/core/document.ts:
    732-746`), which is explicitly documented as "a flat, named, colored membership list...
    Collapsed/expanded is deliberately UI-only session state... never written to the file" — a
    visual fold only, confirmed still true this pass (no gain/effects field on `BeatGroup`).
13. **MIDI effects as live, standing, removable note-transform devices** (Arpeggiator, Chord,
    Pitch, Random, Scale — each with scale-aware toggles) [manual p.46, p.50-51], processing the
    note stream *before* an instrument, distinct in kind from dotbeat's one-shot, permanent
    Pitch & Time operations (`src/core/pitchtime.ts`). No dotbeat equivalent; flagged as a genuinely
    new, D1-compatible idea in `31-ableton-live-concepts.md` §"Gaps" item 6.
14. **The crossfader** — any number of tracks/returns assignable to either side, DJ-mixer-style
    [manual p.52-53]. No dotbeat equivalent, no roadmap row.
15. **MIDI Map Mode / Key Map Mode** — remote-mapping practically any control to a hardware MIDI
    controller or a computer-keyboard key, with mapped messages filtered out of MIDI tracks before
    they'd otherwise record as notes [manual p.57-58]. Confirmed absent: no MIDI-map code anywhere
    in `ui/src/`.
16. **The In/Out routing "patchbay"** — arbitrary per-track input/output source and destination
    choosers enabling resampling, submixing, synth layering, complex effect setups [manual p.54-55]
    — plus **External Audio Effect / External Instrument** devices that route to hardware from
    inside a track's own device chain [manual p.55]. Confirmed absent from `MixerView.tsx` and
    `ArrangementView.tsx` this pass (no routing-chooser control anywhere).
17. **Sound Similarity search + Similar Sample Swapping** — reference-file audio-fingerprint
    ranking across the library, plus a one-click "swap this sample for something sonically close"
    inside Drum Rack/Simpler [manual p.36-37]. No dotbeat equivalent.
18. **A full Groove Pool** (extract groove from real audio, save/share named groove templates,
    per-clip — not just per-track — groove assignment with its own Amount slider) [manual p.50
    screenshot's "Groove: None" chooser; referenced, not detailed, in this chapter]. dotbeat's
    shuffle/grid (§1a above) is a materially narrower 2-field, per-track-only analog.
19. **Racks** (Instrument/Drum/Effect — bundle multiple devices plus their settings and macro
    mappings as one single, reloadable preset) [manual p.54]. dotbeat's presets are single-device
    bundles only (§1a above); already connected in `31-ableton-live-concepts.md` §"Gaps" item 8 to
    the scoped-but-unbuilt Macro tooling layer (`docs/research/27-macro-tooling-layer.md`).
20. **MIDI file import/export** (`.mid`) — importing copies data into the Set and stops referencing
    the original file; individual MIDI clips export as standalone `.mid` files [manual p.45,
    p.58-59]. Confirmed absent: no `.mid` import/export path found in `cli/` or `src/` this pass.
21. **Live Clip export** — dragging a Session clip to the User Library bundles not just the clip's
    own settings but the *originating track's full instrument + effect chain* as one portable,
    reloadable asset [manual p.58-59]. No dotbeat equivalent.
22. **Ableton Link / Tempo Follower** — real-time tempo sync with other apps/hardware [manual p.34].
    No dotbeat equivalent, no roadmap row.
23. **Dedicated Ableton Push 1/2/3 hardware support** [manual p.58]. No dotbeat equivalent, not
    applicable to dotbeat's positioning.

*Noted but deliberately not a numbered row:* **Session View's clip-launch grid and its whole
precedence machinery** (Session-always-wins-over-Arrangement, per-track and global **Back to
Arrangement** buttons at two granularities [manual p.40-41], Arrangement-vs-Session-clip
launch-quantization interplay) — this is real, substantial complexity in the manual [manual
p.38-42], but `docs/research/18-ableton-ui-architecture.md` already concluded dotbeat should not
build a Session-style launch grid, and nothing in this chapter reopens that call (if anything it
reinforces it — the precedence state machine is complexity a Session-less design sidesteps
entirely, per `31-ableton-live-concepts.md`'s own confirmation). Carried into §2 as a single
Do-not-recreate row rather than omitted, so the decision stays visible next to everything else.

### c) In dotbeat, not in Ableton

- **Git-native diffability as a structural property of the file itself, not a bolt-on.** Every
  `.beat` edit — a mixer knob, a note move, a clip-property change — is a one-line, human-readable
  text diff by construction (`src/core/document.ts`'s canonical field ordering + elision, D4/D7 in
  `docs/decisions.md`). Chapter 3 never once mentions diffing, version control, or text
  representation — not an oversight to correct, a confirmation that Ableton's `.als` genuinely has
  no comparable concept (`ROADMAP.md` §1's landscape table: `.als` needs `alsdiff`/`maxdiff`/
  Automator bolt-ons to become diffable at all).
- **Content-addressed, provenance-verified media makes Ableton's stale-sample-reference problem
  structurally impossible, not just fixable.** Ableton dedicates a whole named command, **Collect
  All and Save**, to repairing broken sample references after the fact [manual p.58]. dotbeat's
  media is SHA-256 content-addressed with per-file provenance sidecars, verified via git-lfs
  (`docs/decisions.md` D11) — the failure mode Ableton patches doesn't arise in the first place.
- **Every edit surface — GUI, CLI, and MCP — goes through the exact same primitive.** Every
  `postEdit()` call in `MixerView.tsx`, `ArrangementView.tsx`, `ClipPropertiesPanel.tsx`, etc. hits
  the identical daemon `/edit` route that `beat set` and the `beat_set` MCP tool use — an AI agent
  editing a project isn't puppeting a live GUI over a socket (the `ableton-mcp`-style pattern
  `ROADMAP.md` §1/§10 names as the existing competitive category), it's writing the same primitive
  a human's mouse-drag writes. Chapter 3 has no analogous concept anywhere; Ableton's own MIDI/Key
  Map Mode (§1b #15) is the closest thing, and it maps *hardware input* to controls, not *program*
  access to project state.
- **A first-class, always-on, git-backed checkpoint/history/pin/restore subsystem** (`docs/
  decisions.md` D10, `docs/product-roadmap.md`'s Versioning section) — vs. Ableton's manual Save /
  informal "Save As" backup discipline, with no equivalent concept in this chapter at all.
- **Canonical elision as a transparency guarantee**, not just a file-size optimization: every
  serialized param line in a `.beat` file is a deliberate decision a human or agent made, not a
  captured snapshot of every control's current value (D9) — so reading a `.beat` file's diff tells
  you *what changed musically*, a property chapter 3 never raises as a concern for `.als` (which,
  per `ROADMAP.md` §1, isn't even confirmed to serialize as legible text at all).

---

## 2. Prioritized recommendations

| Feature | Priority | Build recommendation |
|---|---|---|
| Native audio recording + Arm/Session Record/Arrangement Record/multi-take composite tracks | P1 | Already correctly sequenced behind the native tier (`docs/m4-native-engine-design.md`) — don't pull it forward given the confirmed ~30ms web-audio latency wall (`ROADMAP.md` §6). When M4 lands: add an "R" arm button beside the existing M/S buttons in `MixerView.tsx`'s `ChannelStrip` and `ArrangementView.tsx`'s `InlineStrip`; Arrangement Record writes new `BeatAudioRegion` clips (`src/core/document.ts:517`, already in the format) through the existing `/edit` diff path — no new format work needed, only a native capture source. |
| Scale Awareness (Scale Mode: root+scale, Highlight Scale, Fold to Scale, propagation to Pitch & Time) | P1 | Reuse `SCALES`/`nearestScaleTone` already in `src/core/pitchtime.ts:102-134` (the one-shot Fit to Scale op already uses this table). Add an optional, elided `scaleRoot`/`scaleName` field to `BeatClip` in `src/core/document.ts` (same pattern as `BeatClipLoop`/`BeatTimeSignature`, `document.ts:464-476`). Wire Highlight (tint) and Fold (filter `rowCount`) into `NoteView.tsx`'s existing row-axis adapter (already generalized for the drum-lane adapter per the "Unified drum clip editor" roadmap row) — no new rendering primitive needed, just a second adapter mode. |
| Generic Fold mode (fold to pitches in use) | P2 | Cheaper than Scale's Fold — pure computation from `track.notes`/`track.hits`, no format change. Sequence *before* Scale Awareness's Fold-to-Scale per the manual's own distinction [manual p.50] so the row-axis adapter grows one fold mode at a time. Lives entirely in `NoteView.tsx`. |
| Instrument-track FX chain (EQ/comp/sends) | P0 | The one place dotbeat's current model visibly deviates from Ableton's own stated device-chain rule, not just an incomplete feature. Extend the reorderable `EFFECT_TYPES` chain (`src/core/document.ts:629-712`, already shipped for synth/drums) to instrument-kind tracks; render it in `InstrumentPanel.tsx` reusing `SynthPanel.tsx`'s effect-chain UI (`synthParams.ts`). The real work is in `ui/src/audio/engine.ts` — instrument-track playback currently applies only level/pan (confirmed via `InstrumentPanel.tsx:147-204`), so the engine needs a `buildSynthChain`-equivalent path wired onto instrument-track output. |
| Track-level Arrangement automation independent of any single clip | P1 | A second automation-lane kind keyed to song-bar position rather than clip-local step, alongside the existing clip-scoped `BeatAutomationLane`. Surfaces in the same automation-lane UI (`docs/phase-20-automation-lanes.md`) as a second lane type per track. Real gap now that the full arrangement view (Phase 24) is built and multi-section songs are common — clip-only automation is an increasingly visible limitation, not a theoretical one. |
| Curved automation segments (hold/linear/curve) | P2 | Small format add: an interpolation enum field per `BeatAutomationPoint`, defaulting to `linear` (elided, matching D9's pattern). Playback interpolation change is local to the automation-lane read path in `ui/src/audio/engine.ts`. |
| Same-row automation curve overlay | P2 | Pure rendering change in the automation-lane component — draw the curve over the clip row using the same point data, no format or engine change. |
| Log-scale y-axis for frequency automation params | P2 | Rendering-only: a per-param axis-scale lookup (cutoff, etc. → log) in the automation-lane component. No format change. |
| Automation manual-override suspends (not erases) + Re-Enable Automation | P2 | No mechanism to trigger this exists yet (dotbeat has no live-record-while-playing automation entry point) — park as a design note for whoever builds live automation recording; when that lands, mirror Ableton's semantic exactly (`31-ableton-live-concepts.md` §"Gaps" item 5b) rather than silently overwriting drawn automation on first touch. |
| Clip envelopes unlinked from the clip's own loop length | P2 | Design precedent to reuse once per-clip automation lanes exist alongside the already-shipped clip-level loop override (`ClipPropertiesPanel.tsx`, Phase 24 Stream CJ) — an independent loop-length field on the automation lane itself, not derived from the clip's loop. No format work needed until per-clip lanes exist. |
| Return tracks (user-addable mixer channels w/ arbitrary FX, replacing the 2 hardcoded buses) | P2 | Generalize `getBuses()` (`ui/src/audio/engine.ts:1766-1772`) from 2 fixed Tone nodes to N dynamic buses, each with its own reorderable `EFFECT_TYPES` chain (reuse, don't reinvent). Generalize `sendReverb`/`sendDelay` (`document.ts:386-387`) to an arbitrary send-target-id list. Real but bounded engineering; not urgent for a solo-producer tool with only two send colors needed today. |
| Group tracks as a real submixer (shared gain/FX stage) | P2 | Deliberate, documented current scope (`BeatGroup`, `document.ts:732-746`, UI-only fold). If revisited: add an optional gain/effects field to `BeatGroup` and have `ui/src/audio/engine.ts` actually sum member-track output through one bus before the master, rather than each track hitting the master independently. Revisit only if group-level mixing becomes a real, requested workflow — not speculative work now. |
| MIDI effects as live, standing note-transform devices (Arpeggiator/Chord/Pitch/Random/Scale) | P2 | Genuinely D1-compatible (document-only, no generator-code layer) via the same precedent `src/core/groove.ts` already sets: literal per-track fields (`arpMode`/`arpRate`/`arpOctaves`, etc.), interpreted deterministically at scheduling time in `ui/src/audio/engine.ts`'s note-scheduling loop, with `beat consolidate` as the bake-to-literal-notes escape hatch (same pattern as ratchets). Worth prototyping as one device (Arpeggiator) before generalizing. |
| The crossfader (DJ-style A/B track/return assignment) | Do-not-recreate | A DJ-performance feature with no fit to dotbeat's stated git-native/agent-native production niche (`ROADMAP.md` §3's explicit non-goals). Revisit only if dotbeat's positioning ever expands toward live-performance use, which nothing in the roadmap suggests. |
| MIDI Map Mode / Key Map Mode (hardware controller + keyboard remote mapping) | P2 | Gate behind the Tauri native tier's real MIDI I/O (`docs/m4-native-engine-design.md`) — no hardware surface to map to until then. When built, store the mapping table outside the `.beat` file (session/local config), consistent with the existing "session state stays out of the document" precedent (`ui/src/state/store.ts`'s mutes/solos, per `docs/product-roadmap.md`'s Mixer section). |
| In/Out routing patchbay (internal track routing) + External Audio Effect/Instrument hardware devices | P2 (internal routing) / Do-not-recreate for now (external hardware) | Internal track-to-track routing (resampling, synth layering) is a real, bounded win with no hardware dependency — worth scoping once return tracks (above) exist, since both need the same "route signal to an arbitrary internal destination" primitive. External hardware routing has no story until M4's native MIDI/audio I/O lands and even then is a niche need for a solo bedroom-producer tool — don't scope it speculatively. |
| Sound Similarity search + Similar Sample Swapping | Do-not-recreate (for now) | Needs a large, pre-analyzed content library to be useful — Ableton's Core Library is thousands of pre-analyzed sounds [manual p.37]; dotbeat's is 36 presets (`docs/product-roadmap.md`'s Preset/content library section). The feature doesn't pay for itself at dotbeat's current content scale. Revisit only if/when the content library grows substantially (e.g. a large Freesound CC0 ingestion per `ROADMAP.md` §7's Tier 2 sound-quality plan actually ships). |
| A full Groove Pool (extract/save/share groove templates, per-clip assignment) | P2 | dotbeat's `shuffleAmount`/`shuffleGrid` (`document.ts:721-722`) already prove the core reversible-warp mechanism (`src/core/groove.ts`) — the gap is per-*track*-only scope and no template library. A named-groove-template layer could literally reuse D9's presets-as-tooling pattern: a new `presets/grooves.json` applied through the same edit-primitive path `presets/factory.json` already uses. Per-clip (not just per-track) assignment needs a `BeatClip`-level override, same shape as `BeatClipLoop`. |
| Racks (multi-device + macro bundle presets) | P2 | Sequence *after* both the Instrument-track FX chain (above) and the Macro tooling layer (`docs/research/27-macro-tooling-layer.md`, already scoped, Not Started) ship — a Rack needs a real multi-device chain to bundle and a real macro-mapping layer to attach, neither of which exists yet. Don't build Racks first and retrofit. |
| MIDI file import/export (.mid) | P2 | A `beat import-midi`/`beat export-midi` CLI verb translating between `BeatDocument` note lines and standard MIDI file events. Moderate lift given dotbeat's note model is already flat and typed (`src/core/document.ts`); real value for interoperating with non-dotbeat tools and collaborators. No GUI work required for v1 — CLI-only, matching the "CLI/MCP first, GUI later" pattern several other features have followed. |
| Live Clip export (portable clip + full instrument/FX chain bundle) | P2 | Generalize D9's presets-as-tooling pattern: a "save this track's current clip *and* its full synth/effect chain as one reusable asset" action, surfaced via the existing Content Browser (`ContentBrowser.tsx`) and stored the same way `presets/factory.json` stores synth presets today, just with note content included. Natural follow-on once Racks (above) exist, since the bundling logic is the same shape. |
| Ableton Link / Tempo Follower (real-time tempo sync) | P2 | No current roadmap row; genuinely useful for anyone jamming alongside other apps, but not urgent for a solo git-native producer workflow. Ableton Link itself is an open, well-specified protocol (not Ableton-proprietary), so this is bounded scope if it's ever prioritized — not speculative infrastructure work. |
| Dedicated Ableton Push 1/2/3 hardware support | Do-not-recreate | Single-hardware-vendor feature with no relevance to dotbeat's positioning. |

---

## Sources

Ableton Live 12 Reference Manual, chapter 3 "Live Concepts," pp. 33-59 — text (`prior_art/`,
gitignored, `pdftotext -layout` extraction, previously read for research 31) and **rendered page
images**, viewed directly this pass: `p-033.jpg` through `p-058.jpg` (19-20 sampled pages) at
`/Users/willpatrick/.claude/jobs/32ed678c/tmp/ableton-images/ch03/` (manifest:
`SAMPLE_MANIFEST.txt`). dotbeat internal (read directly this pass): `ROADMAP.md` (§1, §3-9);
`docs/decisions.md` (D1, D4, D7, D9, D10, D11); `docs/product-roadmap.md` (all sections);
`docs/research/31-ableton-live-concepts.md` (prior pass, cross-referenced throughout);
`src/core/document.ts` (`TrackKind` line 8, `sendReverb`/`sendDelay` lines 386-387,
`shuffleAmount`/`shuffleGrid` lines 721-722, `BeatGroup` lines 732-746, `BeatClipLoop`/
`BeatTimeSignature` lines 464-476, `BeatAudioRegion` line 517, `EFFECT_TYPES` lines 629-712);
`src/core/pitchtime.ts` (`SCALES`/`nearestScaleTone` lines 102-134, `fitToScaleNotes` line 139);
`ui/src/audio/engine.ts` (`reverbBus`/`delayBus` lines 1711-1712, `getBuses()` lines 1766-1772);
`ui/src/components/MixerView.tsx`, `ArrangementView.tsx`, `TransportBar.tsx`, `TrackList.tsx`,
`ClipPropertiesPanel.tsx`, `InstrumentPanel.tsx` (all read in full or by targeted section this
pass).
