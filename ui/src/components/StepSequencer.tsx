import { DRUM_LABELS, DRUM_LANES, type BeatTrack, type DrumLane } from '../types'
import { engine } from '../audio/engine'
import { postEdit, postSelection } from '../daemon/bridge'
import { useStore } from '../state/store'

// Adapted from BeatLab's src/components/StepSequencer.tsx (docs/research/15 §4). Changes:
//   - the `mode === 'sandbox'` clip-strip branch is removed (dotbeat has no lesson tri-state)
//   - generalized from a fixed 16-step, one-bar pattern to the whole loop (loop_bars * 16), since
//     dotbeat's drums are free-timed hits ABSOLUTE across the loop, not a one-bar cycle
//   - reads/writes the raw hit model: a cell is on iff a hit rounds to that absolute step; a
//     toggle POSTs the `<track>.pattern.<lane>[<step>]` edit primitive (one hit → one file line)

const velClass = (v: number) => (v <= 0 ? '' : v < 0.6 ? 'vel-soft' : v < 0.9 ? 'vel-med' : 'vel-hard')
const DEFAULT_VEL = 0.8

/** Project a track's absolute hits onto a per-lane array of `totalSteps` velocities (0 = off).
 * Max-wins on the rare collision of two hits rounding to the same step+lane. */
function laneSteps(track: BeatTrack, lane: DrumLane, totalSteps: number): number[] {
  const row = new Array<number>(totalSteps).fill(0)
  for (const h of track.hits) {
    if (h.lane !== lane) continue
    const step = Math.round(h.start)
    if (step >= 0 && step < totalSteps && h.velocity > row[step]!) row[step] = h.velocity
  }
  return row
}

export function StepSequencer({ track }: { track: BeatTrack }) {
  const loopBars = useStore((s) => s.doc?.loopBars ?? 1)
  const currentStep = useStore((s) => s.currentStep)
  const totalSteps = loopBars * 16

  return (
    <div className="stepseq">
      <div className="editor-toolbar">
        <span className="editor-title" style={{ color: track.color }}>
          {track.name}
        </span>
        <span className="toolbar-tip">
          {loopBars} bar{loopBars === 1 ? '' : 's'} · 16 steps/bar · click a step to toggle · click a lane label to select + preview (scopes vary to that lane)
        </span>
      </div>
      <div className="seq-scroll">
        <div className="seq-grid">
          <div className="seq-header" style={{ gridTemplateColumns: `var(--lane-w) repeat(${totalSteps}, 1fr)` }}>
            <div className="seq-label" />
            {Array.from({ length: totalSteps }, (_, i) => (
              <div key={i} className={`seq-num ${i % 4 === 0 ? 'beat' : ''} ${i % 16 === 0 ? 'bar' : ''} ${i === currentStep ? 'playing' : ''}`}>
                {i % 16 === 0 ? i / 16 + 1 : i % 4 === 0 ? '·' : ''}
              </div>
            ))}
          </div>
          {DRUM_LANES.map((lane) => {
            const row = laneSteps(track, lane, totalSteps)
            return (
              <div key={lane} className="seq-row" style={{ gridTemplateColumns: `var(--lane-w) repeat(${totalSteps}, 1fr)` }}>
                <button
                  className="seq-label"
                  data-lane-select={lane}
                  onClick={() => {
                    // Lane-granular selection (Phase 16 Stream J / Phase 15 Stream I's deferred item):
                    // clicking a lane label posts a lane-scoped selection so the vary affordance's
                    // group inference (daemon's resolveVaryTarget) picks the lane's own param group
                    // (hat/openhat -> hats, kick -> kick, snare/clap -> snare) instead of the track's
                    // default. Preview still fires so the click stays a useful "audition this lane" too.
                    postSelection({ tracks: [track.id], lanes: [{ track: track.id, lane }] })
                    void engine.previewDrum(lane)
                  }}
                  title="Click to select this lane (scopes vary) + preview"
                >
                  {DRUM_LABELS[lane]}
                </button>
                {row.map((v, i) => (
                  <button
                    key={i}
                    data-lane={lane}
                    data-step={i}
                    className={`step ${v > 0 ? 'on' : ''} ${velClass(v)} ${Math.floor(i / 4) % 2 === 0 ? 'grp-a' : 'grp-b'} ${i % 16 === 0 ? 'barline' : ''} ${i === currentStep ? 'playing' : ''}`}
                    title={v > 0 ? `velocity ${v}` : 'off'}
                    onClick={() => postEdit(`${track.id}.pattern.${lane}[${i}]`, v > 0 ? '0' : String(DEFAULT_VEL))}
                  />
                ))}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
