# Research 37 — Ableton Live 12 manual, ch. 9: Audio Clips, Tempo, and Warping

*2026-07-12. Parallel manual-chapter research pass (one of several run per-chapter against the
owner's locally-held Ableton Live 12 Reference Manual, `prior_art/` — gitignored, not tracked).
Source: chapter 9, "Audio Clips, Tempo, and Warping," manual pp. 219-236, extracted via
`pdftotext -layout` at `/Users/willpatrick/.claude/jobs/32ed678c/tmp/ableton-chapters/ch09.txt`.
Page numbers below are the actual PDF page numbers embedded as footer lines in the extracted text
(each `219`, `220`, ... line in the raw extract), not derived by counting — every **[manual p.NNN]**
citation below points at a real footer in the source file.*

## How this relates to research 25

`docs/research/25-audio-warp-markers-stretch.md` already did deep, code-level design work on one
specific slice of this chapter: the warp-marker grammar (`marker <id> <sourceTime>
<timelineTime>`), the signalsmith-stretch WASM integration shape, and the offline-render-and-cache
engine architecture. That pass is not re-derived or repeated here. This pass instead covers
**everything else in the chapter** research 25 explicitly scoped around: tempo (§9.1, entirely
untouched by research 25 — dotbeat has no tempo-leader/follower or tap-tempo equivalent at all),
the warp *modes* themselves as distinct, separately-parameterized algorithms (§9.3 — research 25
designed the marker *data structure*, not what Beats/Tones/Texture/Re-Pitch/Complex actually *do*
differently, which turns out to matter for scoping which modes dotbeat should even attempt), the
import-time auto-warp/tempo-detection workflow (§9.2.1-9.2.5 — dotbeat has zero BPM-estimation code
today, confirmed by source grep, §"Relevance" below), and audio quantization (§9.2.7 — which turns
out to be a near-exact structural twin of a feature dotbeat already ships for notes). Where this
doc's findings bear on research 25's marker grammar specifically (split behavior, per-sample
persistence, the "Warp From Here" command family), it says so explicitly rather than re-litigating
the grammar itself.

Confidence tagging follows the house style (`docs/research/30-ableton-clip-visualization.md`):
every claim below is **[manual p.NNN]**, sourced directly from the extracted chapter text, since
this is a first-party manual read, not web research — there is no "general/corroborated" tier to
distinguish it from here, but I flag inference vs. verbatim manual content inline where it matters.

---

## 1. Tempo (§9.1) — a whole subsystem dotbeat has no equivalent of at all

### 1.1 Setting and displaying tempo

The Control Bar's tempo field shows **both coarse BPM and fine hundredths-of-a-BPM**, each
independently key- or MIDI-mappable "which is useful for precise tempo changes during live
performances" **[manual p.219]**. Tempo can sync outward (hardware follows Live) or inward (Live
follows hardware) via MIDI Clock or Link, or Live's tempo can follow an external audio source via
"Tempo Follower" **[manual p.219]** — three distinct sync directions named as separate mechanisms,
not one generic "sync" toggle.

### 1.2 Tap tempo

A dedicated Tap Tempo button, clickable once per beat, or mappable to a computer key via Key Map
Mode (four explicit steps: enable Key Map Mode, select the button, press the key, disable Key Map
Mode) or to a MIDI note/controller (e.g. a footswitch) via MIDI Map Mode **[manual p.220]**. Two
details worth noting for accuracy: "the more you tap, the more accurate the detected tempo result
will be" (an explicit, stated confidence-improves-with-samples behavior, not just "reads the last
two taps"), and if "Start Playback with Tap Tempo" is enabled in Record/Warp/Launch settings,
tapping *also triggers transport* — in 4/4, exactly four taps starts playback at the tapped tempo,
and any Link-connected apps' playback position syncs automatically at that moment **[manual
p.220]**.

### 1.3 Nudging

Separate Phase Nudge Up/Down buttons temporarily speed up or slow down playback to re-align with an
external source "that aren't locked to a single tempo, such as live musicians or turntables"
**[manual p.221]** — explicitly a *phase* correction (catch up/fall back within a roughly-matching
tempo), not a tempo change. Also key/MIDI-mappable.

### 1.4 Clip tempo leaders and followers

This is the subsystem with no dotbeat analog whatsoever. By default, warped clips follow the Set's
tempo — but an Arrangement-View clip's Audio Utilities panel has a **Lead/Follow toggle**; when set
to Lead, "the Set plays back at the tempo determined by the clip's Warp Markers... played as if they
were unwarped," and the Control Bar's tempo field is deactivated **[manual p.221]**. Multiple clips
can be leaders simultaneously; only one determines tempo at a time, resolved by **"the tempo of the
currently playing clip on the bottom-most track"** — an explicit, deterministic tie-break rule, not
an error state **[manual p.221-222]**. The Set auto-generates (non-editable) tempo automation on the
Main track tracking the leader clips' tempo changes, which moves when leader clips are rearranged;
an explicit **"Unfollow Tempo Automation"** command in the tempo field's context menu converts every
leader clip to a follower and makes that automation editable **[manual p.222]**. This automation
"will override the tempo from any audio input being synced via Tempo Follower" — an explicit
precedence rule between the two automatic-tempo mechanisms **[manual p.223]**. The Lead/Follow
toggle is deactivated whenever Live's EXT (external sync) switch is enabled **[manual p.223]**.

**Why this matters for dotbeat, stated plainly here and expanded in §5**: this whole feature exists
because Ableton's tempo is a single Set-wide value that individual clips can *override the source
of*. dotbeat's `bpm` field (`src/core/document.ts:741`) is a single document-level integer with no
automation, no per-clip override, and no "this clip determines the project tempo" concept at all —
confirmed directly from source (`initDocument`, `src/core/edit.ts:947-952`: `bpm` is a plain
integer 20-999, no lane, no override). This isn't a gap worth closing soon (dotbeat's engine is
explicitly "constant-tempo 4/4 only" per `docs/product-roadmap.md`'s Clip-level loop/time-sig row),
but it's worth naming precisely rather than leaving implicit — see §5.1.

---

## 2. Warping fundamentals and settings (§9.2, §9.2.1-9.2.2)

### 2.1 The Warp switch and where it lives

Per-clip warping toggles in "the Clip View's Audio Utilities panel" **[manual p.223]**. Off means
"the sample plays at its original tempo, unaffected by the Set's current tempo" — explicitly
recommended for "non-rhythmic samples, such as percussion one shots, textures, sound effects, and
spoken word" **[manual p.224]**. This is a **per-clip binary switch that is a precondition for
every other mechanism in the chapter** — dotbeat's structurally close analog is `WarpMode` itself
(`off | repitch | complex`, `src/core/document.ts:481`), where `'off'` already plays this exact
role. No gap here — dotbeat's three-way enum already subsumes Ableton's binary switch plus a mode
selector in one field, which is arguably a *cleaner* design than Ableton's separate
switch-then-mode-dropdown UI, worth noting as a design win rather than a gap.

### 2.2 Import-time defaults (Warping Options in Settings)

Global defaults applied automatically at import time, all in Record/Warp/Launch Settings, not
per-clip:

- **Loop/Warp Short Samples** — four choices for what happens to a newly-imported short sample:
  *Unwarped One Shot*, *Warped One Shot* (warped but not looped), *Warped Loop*, or **Auto**
  (Live decides per-sample; the default) **[manual p.224]**.
- **Auto-Warp Long Samples** (on by default) — auto-warps long samples on import, seeding "a Warp
  Marker... to the first beat for each bar"; when off, long samples import unwarped **[manual
  p.225]**.
- **Default Warp Mode** — which of the six modes (§3 below) new warped clips get; **Beats mode is
  the factory default** **[manual p.225]**.

**None of this exists in dotbeat today** — there is no project-level or global setting governing
what happens when audio media is added to a track, no short/long sample size heuristic, and (per
§5.1) no BPM-estimation step at all, so there is nothing yet to make these decisions *about*. This
is upstream of research 25's marker-grammar work: research 25 assumes markers get placed (by a
human or by research 26's transient detector) but never addresses "what happens automatically the
moment a sample lands on a track," which is exactly what this settings triad governs in Ableton.

---

## 3. Warp Markers as a workflow, not just a data structure (§9.2.3-9.2.6)

Research 25 fully specified the marker grammar, edit primitives, and split-interaction rules. This
chapter documents the *editing workflow* around markers in much more procedural detail than
research 16 or 25 needed for the format design — several of these are concrete GUI-interaction
ideas worth carrying into whichever stream eventually builds the marker-editing UI.

### 3.1 Placement and deletion mechanics

Double-click the upper half of the Sample Editor to drop a marker at that point, or `Cmd/Ctrl+I` to
drop one at the insert-marker position; markers move via arrow keys or drag **[manual p.225]**.
**Holding Shift while dragging a selected marker moves the underlying waveform instead of the
marker** — "this lets you finely adjust the starting point of the audio under the marker" **[manual
p.225]**. Deletion is double-click, or select the time range and press Backspace/Delete **[manual
p.226]**.

### 3.2 Transients and pseudo-warp markers — the auto-suggest layer

On import, Live auto-detects transients ("amplitude peaks that indicate where notes or beats
begin") and renders them as small gray markers along the top of the Sample Editor, distinct from
real (yellow) Warp Markers **[manual p.226]**. Manual transient add/delete has its own shortcut
family, separate from Warp Marker shortcuts, plus a "Reset Transients" command that clears only
manually-added ones **[manual p.226]**.

**The genuinely reusable idea here**: **"Insert Warp Markers"** (`Cmd/Ctrl+I` over a *time
selection*, not a point) converts every transient inside the selection into a real Warp Marker in
one action; if the selection contains no transients, it drops markers at the selection's start and
end instead — a well-defined fallback, not a silent no-op **[manual p.226]**. And **pseudo-warp
markers**: hovering a transient shows a preview marker (gray, not yellow); double-clicking or
dragging it "turns it into an actual Warp Marker" — and **if there are no Warp Markers after the
newly created one, the clip's tempo also changes as a side effect of that single action** **[manual
p.226]**. Holding Cmd/Ctrl while promoting a pseudo-marker also creates markers at the *adjacent*
transients in the same gesture **[manual p.226]**.

This is a genuinely useful three-tier interaction model dotbeat's future GUI work (once research
26's transient detector lands) could adopt wholesale: (1) detected transients render as passive
hints, (2) hovering one shows a live preview of "what would happen if I committed this," (3) one
click commits it, with a modifier for "commit this and its neighbors together." That's a much
richer interaction than research 25's own scope (which stopped at "numeric inspector fields first,
no waveform" as an accepted v1 gap) — worth flagging to whoever builds the actual marker-editing
GUI as a concrete reference design, not a requirement to match on day one.

### 3.3 Saving markers with the sample file itself

Warp Markers save with the Live Set automatically, but can *also* be saved into the sample file
itself (via the clip title bar's Save button) so they reappear "anytime you drag the file into a
track" — with the caveat that this only works for the user's own samples, not Core Library/Pack
content **[manual p.227]**. Once markers are saved to the file, "Auto-Warp will have no effect,"
though manual re-warping via the "Warp From..." commands (§3.5) still works **[manual p.227]**.

**Directly relevant to dotbeat's own architecture** — see §5.2: dotbeat already content-addresses
audio media by sha256 (`BeatMediaSample.sha256`, `src/core/document.ts:578`), which is a strictly
*better* mechanism than Ableton's "save into this specific file" approach for exactly this caching
problem, and isn't being used for it yet.

### 3.4 Loop-length heuristics and their failure modes

Three named scenarios, each with a distinct manual fix:

- **Even-length loops** — Live assumes a well-cut 1/2/4/8/16-bar loop and sets tempo accordingly,
  seeding exactly two markers (start, end) **[manual p.227]**. The estimated BPM shows in the Audio
  Utilities panel's BPM field, editable directly, or fine-adjustable via Shift+drag on the slider,
  or via Shift+drag on the clip's edge directly in Arrangement View **[manual p.227-228]**. A **×2 /
  ÷2** button pair specifically corrects the classic "detector is off by an octave of tempo"
  failure mode **[manual p.228]**.
- **Odd-length loops** — Live's 4/4 default assumption misreads a 9-bar loop as 8 bars; the fix is
  dragging the end marker to the correct bar (explicitly: "a Warp Marker at the end of the sample
  needs to be placed at the beginning of an even bar, for example, bar eight in a nine-bar loop")
  **[manual p.228]** — and separately, the *visible length itself* can be wrong (a 9-bar loop
  detected as 8 hides the last bar until the end marker is dragged rightward to reveal it) **[manual
  p.228]**.
- **Uneven-length loops** (no clean edit point, no distinct beat pattern) — the fix is a completely
  different mechanism: move the insert marker to the first downbeat, use **"Set 1.1.1 Here"** to
  pin a Warp Marker there, then **"Warp From Here"** to re-derive everything after it; trailing
  silence gets trimmed by placing one more marker before it **[manual p.228-229]**.

### 3.5 The "Warp From Here" command family — four distinct re-derivation strategies

This is a richer vocabulary than research 25 scoped (which designed `addWarpMarker` /
`moveWarpMarker` / `removeWarpMarker` / `setWarpMarker` as direct manipulation primitives, but no
*bulk re-fit* operation). Four named context-menu commands, each re-deriving everything to the
*right* of a selected marker/grid position while leaving everything to the left untouched **[manual
p.232]**:

1. **Warp From Here** — re-runs the auto-warp algorithm on the audio to the right of the marker (or
   plants a new marker at the grid position if none is selected) **[manual p.232]**.
2. **Warp From Here (Start At...)** — uses the *Set's* current tempo as the baseline, with an
   explicit documented workflow for getting the Set's tempo to match a clip first: disable warping,
   tap-tempo the clip's real speed into the Control Bar, re-enable warping, then run this command
   **[manual p.232]**.
3. **Warp From Here (Straight)** — best for tempo-stable material; drops exactly one marker at the
   estimated original BPM **[manual p.232]**.
4. **Warp ... BPM From Here** — also drops one marker, but assumes the clip matches the Set's
   *already-known, precisely-typed* tempo rather than estimating **[manual p.232-233]**.

There's also **Warp Sample as...** (suggests a loop length fitting the Set's tempo, for
already-seamless material) **[manual p.231]** and **Warp Selection as...** (isolate and warp just a
selected span — e.g. lifting a breakbeat out of a longer song — auto-sizing loop points to fit)
**[manual p.230-231]**.

**Relevance**: these four "From Here" variants are really four different *tempo-source* strategies
for the same underlying re-fit operation (estimate from audio / estimate but anchor to Set tempo /
single-marker-straight / single-marker-at-typed-BPM), not four different marker-placement UX
patterns. If/when dotbeat builds real tempo estimation (§5.1) and a "re-warp everything after this
marker" bulk primitive, this is a good source of vocabulary and scope for that primitive's modes —
worth a line in whichever stream eventually builds it, but explicitly **not** something to bolt onto
research 25's already-scoped four primitives now.

### 3.6 Multi-clip warping

Selecting several same-length clips and editing markers on one applies the same edit to all
selected clips simultaneously — explicitly framed for "a recorded multitrack performance" where
timing needs correcting "uniformly" across tracks **[manual p.229]**. No dotbeat equivalent exists
(warp-marker edits are single-clip, per research 25's primitives) — flagged as a real, if
lower-priority, gap: dotbeat's own selection protocol (`daemon /selection`, already shipped per
`docs/product-roadmap.md`'s Selection protocol row) is structurally well-positioned to carry this —
a multi-clip warp-marker edit is "apply this primitive to every clip in the current selection,"
which is exactly the shape `--scope selection` already gives `beat vary`.

### 3.7 Manipulating groove creatively

Distinct from *correcting* timing: pin a marker to a transient that's "come in late" and drag it to
where it *should* be, optionally pinning the neighbors to contain the effect — explicitly framed as
"an interesting creative technique, particularly when used together with grooves" **[manual
p.233]**. This is the same "warping = both correction and creative rhythm-reshaping" duality
research 16 §1 already named for `.beat`'s purposes; nothing new to design here, but worth noting
that dotbeat *already* has a directly analogous creative-groove primitive — `shuffleAmount`/
`shuffleGrid` (`src/core/groove.ts`) — that operates on note/hit timing via a reversible Möbius-ease
warp. Once audio warp markers exist, dotbeat will have **two independent groove/timing-manipulation
mechanisms** (note-level shuffle, audio-marker manual placement) that don't currently share any code
or vocabulary — not a problem to solve now, but worth a design note for whoever eventually builds
warp-marker editing: consider whether `groove.ts`'s warp/unwarp framing has anything to lend to
warp-marker semantics (e.g. "preview the shuffled position before committing," mirroring §3.2's
pseudo-marker preview) rather than building the marker editor as an unrelated feature.

---

## 4. Quantizing Audio (§9.2.7) — a near-exact structural twin of a feature dotbeat already ships

Distinct from time-stretching via markers: **Quantize** (`Cmd/Ctrl+U`, or the Edit menu) snaps a
waveform to the grid by moving "the nearest transient to the closest grid line," configurable
against the current grid or a specific division including triplets via a separate Quantize panel
**[manual p.233]**. Critically: **"To achieve a more subtle result, use the Amount control to adjust
the level of applied quantization. This control shifts the Warp Markers by a percentage of the
chosen quantization value"** **[manual p.234]** — i.e. Amount is a 0-100% blend between "untouched"
and "fully on-grid," applied per-marker.

**This is functionally identical to a feature dotbeat already has, for a different content type.**
`quantizeNotes` (`src/core/edit.ts:408-413`) already takes an `amount` parameter, `0..1`, validated
exactly the same way ("amount must be 0..1"), and blends between the note's original position and
the fully-quantized grid position — the *exact* mechanism Ableton describes for audio Quantize
Amount, just applied to `BeatNote`/`BeatDrumHit` positions instead of transient markers. This is a
strong, concrete, low-risk recommendation (§5.3): once warp markers and/or research 26's
transient detection exist, "quantize audio" is not a new concept to design — it's the *same*
`amount`-blended-quantize primitive dotbeat's note editor already ships, retargeted at
`BeatAudioWarpMarker.timelineTime` instead of `BeatNote.start`.

---

## 5. Warp Modes (§9.3) — six distinct algorithms, not one generic "stretch"

Research 16 §1 already surveyed the five (now six, Live 12 renamed/split slightly) warp modes from
web sources, correctly identifying Complex/Complex Pro as the general-purpose target and Beats mode
as needing separate onset/transient detection. This chapter's manual text gives the actual
per-mode control surface in more depth than research 16 needed, which matters for scoping *how much
of each mode* is worth building versus treating "Complex-equivalent" as the single default:

- **Beats mode** **[manual p.234-235]** — for dominant-rhythm material (drum loops, EDM); optimized
  to preserve transients. Two real sub-controls beyond just "warp mode":
  - **Preserve** — chooses what divisions the granulation process must respect: `Transients` (most
    accurate, follows detected onsets) or a fixed grid division (for deliberate rhythmic artifacts,
    especially combined with pitch transposition) **[manual p.234-235]**.
  - **Transient Loop Mode** — governs what happens *between* transients when a segment must be
    stretched longer than its source audio: `Loop Off` (play to end, then silence), `Loop Forward`
    (loop forward from a mid-segment zero-crossing), `Loop Back-and-Forth` (ping-pong from a
    mid-segment zero-crossing — "can often result in a high-quality sound, especially at slower
    tempos") **[manual p.235]**.
  - **Transient Envelope** — per-segment fade amount, 0-100; 100 = no fade, 0 = fast decay/gating
    effect **[manual p.235]**.
- **Tones mode** **[manual p.235]** — for distinctly-pitched monophonic material (vocals,
  basslines). One control: **Grain Size**, pitch-aware (actual grain size follows detected pitch
  changes; small grains for fast pitch variation, larger grains trade artifact risk for smoothness).
- **Texture mode** **[manual p.235]** — for unpitched/atmospheric material (pads, drones,
  orchestral). **Grain Size** here is *not* pitch-aware (unlike Tones mode — an explicit, stated
  distinction), plus **Fluctuation**, which adds tunable randomness to grain processing.
- **Re-Pitch mode** **[manual p.236]** — literally varispeed (DJ turntable / vintage sampler
  behavior): tempo and pitch change together, transposition controls are disabled because "changing
  the playback speed directly affects the pitch." **This is exactly dotbeat's existing `repitch`
  warp mode** (`region.rate` as a `playbackRate` multiplier, `ui/src/audio/engine.ts` — confirmed
  directly, `region.warp === 'repitch' ? region.rate : 1`) — full parity already, no gap.
- **Complex / Complex Pro mode** **[manual p.236]** — general-purpose, for full mixed material
  (beats + melody + texture, "entire songs"). Complex Pro is a variant algorithm, "may offer higher
  quality," aimed at the same material. Two Complex-Pro-specific controls: **Formants** (0-100%;
  100% fully preserves original formants under pitch transposition — "no effect if the sample's
  transposition is not changed") and **Envelope** (default 128; lower for high-pitched material,
  higher for low-pitched). Explicit CPU-cost caveat: "Complex and Complex Pro modes may be more
  CPU-intensive than the other Warp Modes. To save CPU resources you can freeze or resample tracks
  that use these modes" **[manual p.236]**.

**What this means for scoping, concretely**: dotbeat's `WarpMode` enum (`off | repitch | complex`)
already collapses Ableton's six-mode system down to essentially two real algorithms — a rate scalar
(`repitch`, already shipped) and a single generic time-stretch (`complex`, scoped in research 25 via
signalsmith-stretch, unbuilt). That's a defensible v1 scope — Complex is explicitly Ableton's own
"handles everything reasonably" mode — but this chapter makes clear that **Beats mode is not just
"Complex mode plus transient detection,"** it's a *qualitatively different algorithm* with its own
tunable knobs (Preserve, Transient Loop Mode, Transient Envelope) that specifically produce the
tight, artifact-free stretch drum loops need and Complex mode doesn't optimize for. Research 26
("Beats-mode transient slicing") already scoped the onset-*detection* half of this; it explicitly
deferred "true independently-stretched Beats-mode playback" as later work gated on research 25's
stretch engine. This chapter's finding sharpens that deferred scope: it isn't just "stretch each
slice independently," it specifically needs a **Transient Loop Mode**-equivalent decision (what
plays in the gap when a slice is stretched longer than its source) — worth naming now so the
eventual Beats-mode build stream doesn't have to re-discover this from scratch. **Tones and Texture
modes are lower priority** — narrower material-specific optimizations of the same general
grain-based approach Complex already covers adequately for a v1; reasonable to leave permanently out
of scope unless real usage on vocal/pad material shows Complex's quality is insufficient for those
cases specifically, which mirrors the same "ship the general case, add specialization only if
evidence demands it" posture research 25 already took for Rubber Band vs. signalsmith-stretch.

---

## 6. Relevance to dotbeat — concrete recommendations

Ordered by how directly actionable each is against the current codebase and roadmap.

1. **Quantize audio should reuse `quantizeNotes`'s exact `amount` mechanism, not invent a new one.**
   §4 above. Once `BeatAudioWarpMarker` lands (research 25, format-only slice) and/or research 26's
   transient detector populates markers automatically, add a `quantizeWarpMarkers(doc, trackId,
   clipId, { amount })`-shaped primitive that blends each marker's `timelineTime` toward its nearest
   grid line by `amount` (0..1) — identical validation, identical CLI/MCP shape
   (`beat quantize-audio`/`beat_quantize_audio`, direct sibling of the existing `beat quantize`).
   This is close to zero net-new design risk: the blend math, the amount-parameter contract, and the
   CLI/MCP wiring pattern all already exist and are tested (`quantizeNotes`).

2. **Tempo estimation from imported audio is a real, confirmed-absent gap, separate from anything
   research 25/26 scoped.** Grepped directly this pass: zero matches for `detectBpm`/`estimateBpm`/
   `estimateTempo`/`bpmEstimate`/`autoWarp` anywhere in `src/`, `ui/src`, or `cli/`. Ableton's
   even-length-loop heuristic (§3.4 — assume 1/2/4/8/16 bars, estimate BPM, offer ×2/÷2 correction)
   is a small, well-scoped, dependency-free algorithm (autocorrelation or comb-filter tempo
   estimation over an already-decoded buffer — the same "offline array-domain analysis on an
   already-decoded buffer, not a real-time problem" framing research 26 used to justify a
   dependency-free onset detector applies here too; `audiojs/beat`, already surfaced by research 26
   as MIT and dependency-free, also ships tempo estimation via "autocorrelation + comb-filter,"
   §1.2's own table). Recommend scoping this as a `beat detect-tempo <file> <track> <clip>` CLI/MCP
   verb producing a *suggested* BPM (never silently overwriting `doc.bpm` — same "tool input, not
   grammar" posture `docs/decisions.md` D9 already established for quantize sensitivity) — the
   natural companion to research 26's transient detector, not a competitor to it.

3. **Cache detection/analysis results keyed by the media's existing sha256, not per-project.**
   §3.3 above: Ableton's "save Warp Markers with the sample file" mechanism exists to avoid
   re-running Auto-Warp every time the same sample is dragged into a new project. dotbeat already
   has a strictly better hook for this — `BeatMediaSample.sha256` (`src/core/document.ts:578`) is a
   stable, content-addressed key that's already computed for every audio asset, dedup and integrity
   both handled. Once tempo estimation (#2) and/or transient detection (research 26) exist, cache
   their output (a suggested BPM, a detected transient list) in a sidecar keyed by sha256 — e.g.
   alongside the existing preset provenance-sidecar pattern (`presets/sf2/*.sf2.json`, D11) — so
   dragging the same sample into a second project, or re-detecting after a no-op edit, doesn't
   recompute. This is a cheap, low-risk win that has no Ableton-side complexity to replicate (their
   version is genuinely more limited — file-embedded, lost if the file moves — dotbeat's
   content-addressing sidesteps that entirely).

4. **Beats-mode's Transient Loop Mode is a real design decision the eventual stretch-engine build
   needs, not an implementation detail to improvise.** §5 above. When research 25's Slice 2
   (signalsmith-stretch integration) or a dedicated Beats-mode build stream lands, budget for an
   explicit "what plays in the gap when a slice must be stretched longer than its source" decision —
   `Loop Off`/`Loop Forward`/`Loop Back-and-Forth` is Ableton's answer; research 22's
   `TransientPlayMode` (`Once`/`Repeat`/`Pingpong`, already referenced in research 25 §5's "explicitly
   deferred" list) is structurally the same question with different naming. Worth reconciling the
   two vocabularies (they appear to name the same three behaviors) before building either.

5. **The multi-clip warp-marker edit (§3.6) is a small, natural extension of the existing selection
   protocol, not a new mechanism.** Once single-clip marker edit primitives exist (research 25),
   extending `addWarpMarker`/`moveWarpMarker` to apply across every audio clip in the current
   `--scope selection` is a thin wrapper, not new design — dotbeat's selection protocol already
   generalizes this exact "apply one edit across everything selected" shape for `beat vary`. Low
   priority (Ableton frames it for multitrack-recording timing correction, a use case dotbeat
   doesn't obviously have yet), but cheap enough to fold into whichever stream builds marker-editing
   GUI affordances, rather than treating it as a separate future feature.

6. **Tempo leader/follower and tap tempo are explicitly NOT worth building, and it's worth writing
   that down rather than leaving it an implicit non-decision.** §1.4 above. The entire mechanism
   exists in Ableton to solve "sync the Set to whatever tempo this one clip happens to be at,"
   which only matters when (a) tempo can vary per-clip and (b) a human is triggering clips live and
   needs the Set to react in real time. dotbeat's engine is constant-tempo by design
   (`docs/product-roadmap.md`'s explicit note: "the engine is still constant-tempo 4/4"), has no
   live-performance clip-triggering surface (research 18 already ruled out a Session-style
   clip-launch grid), and its edit model is asynchronous file-then-render, not real-time-reactive.
   None of tap tempo, phase nudging, or tempo-leader/follower have a load-bearing use case in
   dotbeat's actual architecture — recommend explicitly marking this sub-area **out of scope**
   (a line in `docs/product-roadmap.md`'s "Out of scope" tier, or at minimum a decisions.md note)
   rather than leaving it an unstated gap that a future pass might mistakenly try to fill in.

7. **The "Warp From Here" four-variant vocabulary (§3.5) is good future scope for a bulk re-warp
   primitive, but should NOT be retrofitted onto research 25's four already-scoped primitives now.**
   Flagging this explicitly so a future stream doesn't feel obligated to match Ableton's exact
   four-command surface — `addWarpMarker`/`moveWarpMarker`/`removeWarpMarker`/`setWarpMarker` cover
   direct manipulation correctly; a *bulk* "re-derive everything after this point" operation is a
   different, larger primitive (needs tempo estimation from #2 as an input) that deserves its own
   design pass once tempo detection exists, not a rushed addition now.

---

## Sources

Ableton Live 12 Reference Manual, chapter 9, "Audio Clips, Tempo, and Warping," pp. 219-236
(`prior_art/`, local copy, extracted via `pdftotext -layout`). All in-chapter section numbers
(§9.1-§9.3.5) and page citations above are drawn directly from that extract. Cross-referenced
against `docs/research/16-audio-clip-editing.md`, `docs/research/25-audio-warp-markers-stretch.md`,
`docs/research/26-beats-mode-transient-slicing.md`, `docs/decisions.md` (D9, D11), and dotbeat
source read directly this pass: `src/core/document.ts` (`WarpMode`, `BeatAudioRegion`,
`BeatAudioWarpMarker`, `BeatMediaSample`, `bpm` field), `src/core/edit.ts` (`quantizeNotes`,
`initDocument`), `src/core/groove.ts`, `ui/src/audio/engine.ts` (audio-track playback/repitch
handling).
