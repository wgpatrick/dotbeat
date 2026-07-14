import { useStore } from '../state/store'
import { postEdit } from '../daemon/bridge'
import { TIME_SIG_DENOMINATORS, firstPlacementClip, type BeatClip, type BeatDocument, type BeatTrack } from '../types'

// Phase 22 Stream AG — the GUI face of v0.10's clip-level loop range / time signature
// (src/core/document.ts's BeatClipLoop/BeatTimeSignature; docs/research/18-ableton-ui-
// architecture.md's Clip View table: "Main Clip Properties: Start/End … Loop Position & Length,
// Clip Loop toggle … time signature"). A small properties strip docked at the top of the Clip
// View (NoteView / StepSequencer), Ableton's own layout (the property panels sit above/beside the
// note/hit editor, not inside it).
//
// dotbeat's Clip View edits a track's LIVE content (track.notes/track.hits), not a named BeatClip
// object directly — there's no per-clip "which clip am I editing" selector in the GUI yet. So this
// panel targets the same "primary clip" AutomationLane already picked in ArrangementView.tsx: the
// first song-section's scene that maps this track to a real, existing clip (v1: one editable clip
// per track, documented there as a deliberate scope cut — multi-clip editing is a future slice).
// In loop mode (no song block) there is no saved clip at all, so the panel shows a hint instead.

/** Same resolution rule as ArrangementView.tsx's trackOccurrences/visibleParamsFor: the first
 * song section whose scene maps this track to a clip that actually exists. Duplicated locally
 * (not imported) because ArrangementView doesn't export it and pulling in its whole module for one
 * helper isn't worth the coupling — it's four lines, kept in lockstep by the shared "primary clip"
 * comment above. Exported (Phase 24 Stream CJ) so NoteView.tsx's own clip-loop drag handle resolves
 * the SAME "which clip am I editing" target as this panel's numeric loop fields — one definition,
 * two entry points (typed fields here, a drag gesture there) editing the same clip. Also reused
 * (Phase 24 Stream CI) by NoteView.tsx's "Place in Arrangement" affordance for the SAME "does this
 * track already have an occurrence?" check this panel already makes — NoteView already imports
 * this file for <ClipPropertiesPanel>, so importing one more helper from it doesn't add real
 * coupling, unlike pulling from ArrangementView's much larger module.
 *
 * Phase 29 Stream GA: `preferredSceneId` — store.ts's new `selectedSectionIndex`, resolved to a
 * scene id by the caller — lets the user's own "which section am I looking at" choice win over the
 * unconditional first-occurrence scan below. Before this parameter existed, this function (and
 * everything built on it: the clip-properties strip, NoteView's loop-drag handle, and Place in
 * Arrangement) could only ever resolve to the FIRST song section's clip for a track, which is
 * exactly the bug docs/research/83, 84, and 86 all independently reproduced — once a song had a
 * second section, there was no way to view, edit, or place into it from the GUI at all. When the
 * preferred scene doesn't map this track to a clip (an empty section, or nothing selected yet),
 * this falls straight through to the old first-occurrence scan — the documented fallback for loop
 * mode and "no clip in the selected section" alike. */
export function primaryClipFor(track: BeatTrack, doc: BeatDocument, preferredSceneId?: string | null): BeatClip | null {
  if (!doc.song) return null
  // Phase 36 PC/PD: "the" clip of a (track, scene) pair is still the at-0/first placement's —
  // per-placement clip-editor targeting is Stream PD's work.
  if (preferredSceneId) {
    const scene = doc.scenes.find((s) => s.id === preferredSceneId)
    const clipId = scene ? firstPlacementClip(scene.slots, track.id) : undefined
    const clip = clipId ? track.clips.find((c) => c.id === clipId) : undefined
    if (clip) return clip
  }
  for (const section of doc.song) {
    const scene = doc.scenes.find((s) => s.id === section.scene)
    const clipId = scene ? firstPlacementClip(scene.slots, track.id) : undefined
    if (!clipId) continue
    const clip = track.clips.find((c) => c.id === clipId)
    if (clip) return clip
  }
  return null
}

/** The scene id `selectedSectionIndex` currently points at, or null when nothing's selected or the
 * index doesn't resolve (loop mode, or a stale index store.ts's setDoc hasn't reset yet mid-render).
 * One tiny helper so every consumer (this panel, NoteView's three primaryClipFor call sites, its
 * live-buffer sync effect) derives the SAME scene id from the SAME store field instead of
 * re-deriving it slightly differently in three places. */
export function selectedSceneId(doc: BeatDocument | null, selectedSectionIndex: number | null): string | null {
  if (!doc?.song || selectedSectionIndex === null) return null
  return doc.song[selectedSectionIndex]?.scene ?? null
}

export function ClipPropertiesPanel({ track }: { track: BeatTrack }) {
  const doc = useStore((s) => s.doc)
  const selectedSectionIndex = useStore((s) => s.selectedSectionIndex)
  if (!doc) return null
  const clip = primaryClipFor(track, doc, selectedSceneId(doc, selectedSectionIndex))
  if (!clip) {
    return (
      <div className="clip-props" data-clip-props="none">
        <span className="clip-props-hint">
          clip properties: add this track to a scene (song mode) to edit a saved clip&apos;s loop range / signature
        </span>
      </div>
    )
  }

  const loop = clip.loop
  const sig = clip.signature
  const path = `${track.id}.clip.${clip.id}`

  return (
    <div className="clip-props" data-clip-props={clip.id}>
      <span className="clip-props-label" title={`editing clip "${clip.id}"'s properties`}>
        clip &quot;{clip.id}&quot;
      </span>

      <label className="clip-props-field" title="clip-local loop range, in bars — overrides the section length just for this clip when set">
        <span className="clip-props-field-name">loop</span>
        <input
          type="number"
          className="clip-props-num"
          min={0}
          step={1}
          value={loop ? loop.start : ''}
          placeholder="off"
          data-clip-loop-start={clip.id}
          onChange={(e) => {
            if (e.target.value.trim() === '') {
              postEdit(`${path}.loop`, '')
              return
            }
            const start = Math.max(0, Math.round(Number(e.target.value)))
            const end = Math.max(start + 1, loop?.end ?? start + 1)
            postEdit(`${path}.loop`, `${start} ${end}`)
          }}
        />
        <span className="clip-props-sep">–</span>
        <input
          type="number"
          className="clip-props-num"
          min={(loop?.start ?? 0) + 1}
          step={1}
          value={loop ? loop.end : ''}
          placeholder="off"
          disabled={!loop}
          data-clip-loop-end={clip.id}
          onChange={(e) => {
            if (!loop) return
            const end = Math.max(loop.start + 1, Math.round(Number(e.target.value)))
            postEdit(`${path}.loop`, `${loop.start} ${end}`)
          }}
        />
        <span className="clip-props-unit">bars</span>
        {loop && (
          <button className="clip-props-clear" data-clip-loop-clear={clip.id} title="clear the loop override" onClick={() => postEdit(`${path}.loop`, '')}>
            ×
          </button>
        )}
      </label>

      <label className="clip-props-field" title="clip-level time signature — metadata only for now; the audio engine still plays constant-tempo 4/4">
        <span className="clip-props-field-name">sig</span>
        <input
          type="number"
          className="clip-props-num narrow"
          min={1}
          max={32}
          step={1}
          value={sig ? sig.numerator : ''}
          placeholder="4"
          data-clip-sig-num={clip.id}
          onChange={(e) => {
            if (e.target.value.trim() === '') {
              postEdit(`${path}.signature`, '')
              return
            }
            const numerator = Math.min(32, Math.max(1, Math.round(Number(e.target.value))))
            postEdit(`${path}.signature`, `${numerator} ${sig?.denominator ?? 4}`)
          }}
        />
        <span className="clip-props-sep">/</span>
        <select
          className="clip-props-select"
          value={sig ? sig.denominator : 4}
          disabled={!sig}
          data-clip-sig-den={clip.id}
          onChange={(e) => postEdit(`${path}.signature`, `${sig?.numerator ?? 4} ${e.target.value}`)}
        >
          {TIME_SIG_DENOMINATORS.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        {sig && (
          <button className="clip-props-clear" data-clip-sig-clear={clip.id} title="clear the signature override" onClick={() => postEdit(`${path}.signature`, '')}>
            ×
          </button>
        )}
      </label>
    </div>
  )
}
