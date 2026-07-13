import { useEffect, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react'
import { engine } from '../audio/engine'
import { useStore } from '../state/store'
import {
  fetchLibrary,
  fetchLibraryFile,
  installSoundfont,
  setDragPayload,
  type LibraryCatalog,
  type LibraryKit,
  type LibraryKitLane,
  type LibraryPreset,
  type LibrarySoundfont,
} from '../daemon/library'
import { DRUM_LABELS } from '../types'

// Phase 22 Stream AH — the content-browser sidebar (docs/research/18-ableton-ui-architecture.md §8
// "Browser/sidebar"). A collapsible LEFT rail, additive to the Phase 18 layout (App.tsx's permanent
// Arrangement main area + selection-following bottom pane are untouched): browses dotbeat's existing
// content — presets/factory.json's 36 presets (already organized by Phase 18 Stream S's taxonomy),
// presets/kit-*/ one-shot kits, presets/sf2/*.sf2 SoundFont banks — over the daemon's new GET
// /library route (src/daemon/daemon.ts).
//
// Two interactions, both drag-and-drop (research 18: "drag-and-drop is the universal creation
// idiom"):
//   - drag a preset onto a synth/drums track (ArrangementView.tsx's track header) -> applies its
//     literal params via core's applyPreset, a normal edit list (format-spec.md: presets are
//     tooling, not grammar) — same function `beat preset` calls.
//   - drag a kit one-shot onto a drum lane (StepSequencer.tsx's lane row), or a whole kit onto a
//     drum track's header -> registers the wav into the PROJECT's own media/ and assigns it via
//     setLaneSample, same as `beat sample` + `beat lane` chained by hand.
//   - drag a kit one-shot onto an AUDIO track's header (Phase 23 Stream BC) -> registers the wav the
//     same way, then creates or replaces that track's audio-region clip via addAudioClip — the
//     drag-to-create-audio-clip interaction docs/phase-22-stream-ae.md's format work left for a
//     later GUI pass.
//   - drag a soundfont onto an instrument track's header -> reassigns its bank.
// Every ▶ button previews BEFORE any of that — an ephemeral engine voice or a raw fetch-decode-play,
// never touching the store's document (engine.previewSynthPreset/previewDrumPreset/previewBuffer/
// previewSoundfont — ui/src/audio/engine.ts). Nothing in this file calls postEdit/postAddTrack
// directly except through daemon/library.ts's install* helpers, which mirror bridge.ts's existing
// "the write route returns the fresh doc, apply it straight to the store" convention.

const SYNTH_CATEGORY_ORDER = ['bass', 'lead', 'pad', 'pluck', 'keys', 'arp', 'fx']
const DRUM_CATEGORY_ORDER = ['house', '808-trap', 'techno', 'boom-bap', 'lofi', 'acoustic-rock']

function groupByCategory(presets: LibraryPreset[], order: readonly string[]): [string, LibraryPreset[]][] {
  const byCat = new Map<string, LibraryPreset[]>()
  for (const p of presets) {
    if (!byCat.has(p.category)) byCat.set(p.category, [])
    byCat.get(p.category)!.push(p)
  }
  return order.filter((c) => byCat.has(c)).map((c) => [c, byCat.get(c)!.sort((a, b) => a.name.localeCompare(b.name))])
}

// Phase 27 Stream EJ (docs/research/73-ux-browser.md §4 item 1) — every row used to render the
// identical round preview-circle as its only "icon," with zero visual differentiation between a
// synth preset, a drum preset, a whole kit, a single kit lane, and a soundfont bank. `TypeIcon`
// gives each of those five content types its own small monochrome glyph, rendered ahead of the
// (still-functional) preview button rather than replacing it — the preview button keeps doing its
// one job (audition), the type icon does the new one (say what this row IS at a glance).
type LibraryItemType = 'preset-synth' | 'preset-drums' | 'kit' | 'kit-lane' | 'soundfont'

const TYPE_ICON_LABEL: Record<LibraryItemType, string> = {
  'preset-synth': 'synth preset',
  'preset-drums': 'drum preset',
  kit: 'drum kit',
  'kit-lane': 'one-shot sample',
  soundfont: 'soundfont bank',
}

function TypeIcon({ type }: { type: LibraryItemType }) {
  return (
    <svg
      className={`lib-type-icon lib-type-icon-${type}`}
      width="12"
      height="12"
      viewBox="0 0 14 14"
      aria-hidden="true"
      role="img"
      data-type-icon={type}
    >
      <title>{TYPE_ICON_LABEL[type]}</title>
      {type === 'preset-synth' && (
        // a wavy oscillator line — the one glyph in the set that reads as "synthesized tone"
        <path
          d="M1 7c1.2 0 1.2-4 2.4-4s1.2 8 2.4 8 1.2-8 2.4-8 1.2 4 2.4 4h1.4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      {type === 'preset-drums' && (
        // a small drum/cylinder shape
        <>
          <ellipse cx="7" cy="4.2" rx="4.6" ry="2" fill="none" stroke="currentColor" strokeWidth="1.2" />
          <path
            d="M2.4 4.2v4.6c0 1.1 2.06 2 4.6 2s4.6-.9 4.6-2V4.2"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.2"
          />
        </>
      )}
      {type === 'kit' && (
        // a 2x2 grid — a bundle of lanes, distinct from the single-lane bar-chart glyph
        <>
          <rect x="1.5" y="1.5" width="4.2" height="4.2" rx="0.6" fill="none" stroke="currentColor" strokeWidth="1.1" />
          <rect x="8.3" y="1.5" width="4.2" height="4.2" rx="0.6" fill="none" stroke="currentColor" strokeWidth="1.1" />
          <rect x="1.5" y="8.3" width="4.2" height="4.2" rx="0.6" fill="none" stroke="currentColor" strokeWidth="1.1" />
          <rect x="8.3" y="8.3" width="4.2" height="4.2" rx="0.6" fill="none" stroke="currentColor" strokeWidth="1.1" />
        </>
      )}
      {type === 'kit-lane' && (
        // three solid bars — a miniature one-shot waveform, not a continuous synth curve
        <>
          <rect x="2" y="7.5" width="2" height="4.5" rx="0.4" fill="currentColor" />
          <rect x="6" y="3.5" width="2" height="8.5" rx="0.4" fill="currentColor" />
          <rect x="10" y="5.5" width="2" height="6.5" rx="0.4" fill="currentColor" />
        </>
      )}
      {type === 'soundfont' && (
        // a beamed note pair — the conventional "instrument bank" glyph
        <>
          <circle cx="4" cy="10.5" r="2.1" fill="currentColor" />
          <circle cx="10.4" cy="9.3" r="2.1" fill="currentColor" />
          <path
            d="M6 10.5V2.2l6.4-1.4v7.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      )}
    </svg>
  )
}

// Phase 29 Stream GF item 9 — Phase 27 Stream EJ's `TypeIcon` already gives all five content types
// their own glyph, but pilot 85 still dragged a genre-named drum-kit PRESET section (`808-TRAP`,
// `TECHNO`, `BOOM-BAP`, ...) expecting a real audio loop: those rows ARE `TypeIcon type="preset-
// drums"` (an outline drum/cylinder glyph) today, genuinely distinct from a `kit-lane` row's solid
// three-bar glyph, but "which of five outline/solid glyphs is this" is a subtler read than the ONE
// fact that actually matters here — "does dragging this onto a track move real sample bytes, or
// just synth params." `AudioBadge` makes exactly that binary explicit with a small labeled pill
// (not just another icon shape) on the rows that genuinely carry real, sha256-addressed `.wav`
// content (`KitLaneRow`, and `KitGroup`'s own head row — dragging a whole kit is real audio too) —
// preset rows (both synth and the drum-kit-shaped presets) get none, since neither has any audio
// content, `kind: 'drums'` or not.
function AudioBadge() {
  return (
    <span className="lib-audio-badge" title="real audio content (a .wav sample) — not a synthesized preset">
      audio
    </span>
  )
}

/** A collapsible top-level section (Synth Presets / Drum Presets / Kits / SoundFonts). Local open
 * state only — this is browse-UI state, not document/session state, so it doesn't belong in the
 * shared store. */
function Section({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  const [open, setOpen] = useState(true)
  return (
    <div className="lib-section">
      <button className="lib-section-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className={`lib-disclosure ${open ? 'open' : ''}`}>▸</span>
        <span className="lib-section-title">{title}</span>
        <span className="lib-section-count">{count}</span>
      </button>
      {open && <div className="lib-section-body">{children}</div>}
    </div>
  )
}

// Phase 27 Stream EJ (research/73 §4 item 2) — `busy` alone was never a real "playing" signal: for
// three of the four preview paths (previewSynthPreset/previewDrumPreset/previewSoundfont) the
// returned promise resolves as soon as the note/voice is FIRED, not when it finishes sounding
// (engine.ts schedules its own teardown via setTimeout well after the promise already settled), so
// the old `busy ? '…' : '▶'` swap was visible for a few milliseconds at most. `durationMs` is a
// deliberate approximation of each preview path's actual audible length (matched to the teardown
// timers in `ui/src/audio/engine.ts`: previewSynthPreset ~1800ms, previewDrumPreset ~1400ms,
// previewSoundfont ~1200ms; kit-lane one-shots don't expose a length up front, so ~900ms — a
// typical kick/snare/hat sample — is used) so the row can show a real in-place "currently playing"
// window instead of a flash. `onStart`/`onEnd` let the ROW (not just this button) carry the visual
// state — see `lib-row-previewing` in ContentBrowser's row components below.
// Phase 28 Stream FF (research/78 §3 item 3) — the active-state glyph used to be the Unicode
// `❚❚` pause character, which relies on the font's own hinting at a size it was never designed
// for: live-verified at the button's real ~20px/9px-font rendered size, the two bars fuse into a
// single indistinguishable blob rather than reading as "paused." A small hand-drawn SVG (two
// explicit thin rects, not glyph rendering) stays legible as two distinct bars at that size
// because its geometry is fixed rather than left to font hinting.
function PauseIcon() {
  return (
    <svg width="9" height="9" viewBox="0 0 10 10" aria-hidden="true" data-icon="pause-active">
      <rect x="1.5" y="1" width="2.4" height="8" rx="0.5" fill="currentColor" />
      <rect x="6.1" y="1" width="2.4" height="8" rx="0.5" fill="currentColor" />
    </svg>
  )
}

function PreviewButton({
  onPreview,
  title,
  active,
  durationMs,
  onStart,
  onEnd,
}: {
  onPreview: () => Promise<void>
  title: string
  active: boolean
  durationMs: number
  onStart: () => void
  onEnd: () => void
}) {
  const [busy, setBusy] = useState(false)
  return (
    <button
      className={`lib-preview-btn${active ? ' lib-preview-btn-active' : ''}`}
      data-action="preview"
      disabled={busy}
      title={title}
      onClick={(e) => {
        e.stopPropagation()
        setBusy(true)
        onStart()
        onPreview()
          .catch((err) => console.warn('[library] preview failed:', err))
          .finally(() => setBusy(false))
        window.setTimeout(onEnd, durationMs)
      }}
    >
      {busy ? '…' : active ? <PauseIcon /> : '▶'}
    </button>
  )
}

function PresetRow({
  preset,
  playingKey,
  setPlayingKey,
}: {
  preset: LibraryPreset
  playingKey: string | null
  setPlayingKey: Dispatch<SetStateAction<string | null>>
}) {
  const previewKey = `preset:${preset.name}`
  const isPlaying = playingKey === previewKey
  return (
    <div
      className={`lib-row${isPlaying ? ' lib-row-previewing' : ''}`}
      draggable
      data-preset={preset.name}
      data-previewing={isPlaying || undefined}
      onDragStart={(e) => setDragPayload(e.dataTransfer, { type: 'preset', name: preset.name, kind: preset.kind })}
      title={preset.description}
    >
      <TypeIcon type={preset.kind === 'drums' ? 'preset-drums' : 'preset-synth'} />
      <PreviewButton
        title={`preview ${preset.name}`}
        active={isPlaying}
        durationMs={preset.kind === 'drums' ? 1400 : 1800}
        onStart={() => setPlayingKey(previewKey)}
        onEnd={() => setPlayingKey((cur) => (cur === previewKey ? null : cur))}
        onPreview={() => (preset.kind === 'drums' ? engine.previewDrumPreset(preset.params) : engine.previewSynthPreset(preset.params))}
      />
      <span className="lib-row-name">{preset.name}</span>
      <span className="lib-row-meta">{Object.keys(preset.params).length}p</span>
    </div>
  )
}

function KitLaneRow({
  kit,
  lane,
  playingKey,
  setPlayingKey,
}: {
  kit: string
  lane: LibraryKitLane
  playingKey: string | null
  setPlayingKey: Dispatch<SetStateAction<string | null>>
}) {
  const previewKey = `kit-lane:${kit}/${lane.lane}`
  const isPlaying = playingKey === previewKey
  return (
    <div
      className={`lib-row lib-kit-lane${isPlaying ? ' lib-row-previewing' : ''}`}
      draggable
      data-kit={kit}
      data-lane={lane.lane}
      data-previewing={isPlaying || undefined}
      onDragStart={(e) => setDragPayload(e.dataTransfer, { type: 'kit-lane', kit, lane: lane.lane })}
      title={`${kit}/${lane.file} — drag onto a drum lane, or onto an audio track to create a clip`}
    >
      <TypeIcon type="kit-lane" />
      <PreviewButton
        title={`preview ${kit}/${lane.file}`}
        active={isPlaying}
        durationMs={900}
        onStart={() => setPlayingKey(previewKey)}
        onEnd={() => setPlayingKey((cur) => (cur === previewKey ? null : cur))}
        onPreview={async () => {
          const bytes = await fetchLibraryFile(`${kit}/${lane.file}`)
          await engine.previewBuffer(bytes)
        }}
      />
      <span className="lib-row-name">{(DRUM_LABELS as Record<string, string>)[lane.lane] ?? lane.lane}</span>
      <AudioBadge />
    </div>
  )
}

function KitGroup({
  kit,
  playingKey,
  setPlayingKey,
}: {
  kit: LibraryKit
  playingKey: string | null
  setPlayingKey: Dispatch<SetStateAction<string | null>>
}) {
  return (
    <div className="lib-kit">
      <div
        className="lib-row lib-kit-head"
        draggable
        data-kit={kit.id}
        onDragStart={(e) => setDragPayload(e.dataTransfer, { type: 'kit-lane', kit: kit.id })}
        title={`drag onto a drum track to load all ${kit.lanes.length} lanes at once`}
      >
        <TypeIcon type="kit" />
        <span className="lib-row-name">{kit.id}</span>
        <AudioBadge />
        <span className="lib-row-meta">{kit.lanes.length} lanes</span>
      </div>
      {kit.lanes.map((l) => (
        <KitLaneRow key={l.lane} kit={kit.id} lane={l} playingKey={playingKey} setPlayingKey={setPlayingKey} />
      ))}
    </div>
  )
}

function SoundfontRow({
  sf,
  playingKey,
  setPlayingKey,
}: {
  sf: LibrarySoundfont
  playingKey: string | null
  setPlayingKey: Dispatch<SetStateAction<string | null>>
}) {
  const [adding, setAdding] = useState(false)
  const previewKey = `soundfont:${sf.file}`
  const isPlaying = playingKey === previewKey
  return (
    <div
      className={`lib-row${isPlaying ? ' lib-row-previewing' : ''}`}
      draggable
      data-soundfont={sf.file}
      data-previewing={isPlaying || undefined}
      onDragStart={(e) => setDragPayload(e.dataTransfer, { type: 'soundfont', file: sf.file })}
      title={[sf.file, sf.license, sf.source].filter(Boolean).join(' — ')}
    >
      <TypeIcon type="soundfont" />
      <PreviewButton
        title={`preview ${sf.file}`}
        active={isPlaying}
        durationMs={1200}
        onStart={() => setPlayingKey(previewKey)}
        onEnd={() => setPlayingKey((cur) => (cur === previewKey ? null : cur))}
        onPreview={async () => {
          const bytes = await fetchLibraryFile(`sf2/${sf.file}`)
          await engine.previewSoundfont(bytes, 0)
        }}
      />
      <span className="lib-row-name">{sf.file.replace(/\.sf2$/, '')}</span>
      {/* Drag onto an EXISTING instrument track's header to reassign it; this button covers the other
          case — no instrument track exists yet — by minting a brand new one (POST /library/
          install-soundfont with no `track`). Closes the real, documented gap ArrangementView.tsx's
          addTrackOfKind flags ("the GUI has no sample-registration surface"). */}
      <button
        className="lib-add-track-btn"
        data-action="add-instrument-track"
        disabled={adding}
        title="add as a new instrument track"
        onClick={(e) => {
          e.stopPropagation()
          setAdding(true)
          installSoundfont(sf.file)
            .catch((err) => window.alert(`Could not add instrument track: ${(err as Error).message}`))
            .finally(() => setAdding(false))
        }}
      >
        {adding ? '…' : '+'}
      </button>
    </div>
  )
}

export function ContentBrowser() {
  const toggleLibrary = useStore((s) => s.toggleLibrary)
  const [catalog, setCatalog] = useState<LibraryCatalog | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Phase 27 Stream EJ: which row is currently previewing, keyed by a type-prefixed id
  // (`preset:foo`, `kit-lane:kit/lane`, `soundfont:file.sf2`) so a preset and a kit lane that
  // happen to share a name can't collide. Local browse-UI state, same rationale as `Section`'s
  // own `open` state above — never written to the document/store.
  const [playingKey, setPlayingKey] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    fetchLibrary()
      .then((c) => {
        if (live) setCatalog(c)
      })
      .catch((err) => {
        if (live) setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      live = false
    }
  }, [])

  const synthPresets = catalog ? catalog.presets.filter((p) => p.kind !== 'drums') : []
  const drumPresets = catalog ? catalog.presets.filter((p) => p.kind === 'drums') : []

  return (
    <aside className="library-rail" data-testid="content-browser">
      <div className="library-rail-head">
        <span className="library-rail-title">Browser</span>
        <button className="pane-collapse" data-action="close-library" onClick={toggleLibrary} title="close the content browser">
          ✕
        </button>
      </div>
      <div className="library-rail-body">
        {error && (
          <div className="library-status error">
            could not load the content library: {error}
            <button
              className="topbar-btn"
              onClick={() => {
                setError(null)
                fetchLibrary()
                  .then(setCatalog)
                  .catch((err) => setError(err instanceof Error ? err.message : String(err)))
              }}
            >
              retry
            </button>
          </div>
        )}
        {!catalog && !error && <div className="library-status">loading…</div>}
        {catalog && (
          <>
            <Section title="Presets — Synth" count={synthPresets.length}>
              {groupByCategory(synthPresets, SYNTH_CATEGORY_ORDER).map(([cat, ps]) => (
                <div key={cat} className="lib-category">
                  <div className="lib-category-label">{cat}</div>
                  {ps.map((p) => (
                    <PresetRow key={p.name} preset={p} playingKey={playingKey} setPlayingKey={setPlayingKey} />
                  ))}
                </div>
              ))}
            </Section>
            <Section title="Presets — Drums" count={drumPresets.length}>
              {groupByCategory(drumPresets, DRUM_CATEGORY_ORDER).map(([cat, ps]) => (
                <div key={cat} className="lib-category">
                  <div className="lib-category-label">{cat}</div>
                  {ps.map((p) => (
                    <PresetRow key={p.name} preset={p} playingKey={playingKey} setPlayingKey={setPlayingKey} />
                  ))}
                </div>
              ))}
            </Section>
            <Section title="Kits" count={catalog.kits.length}>
              {catalog.kits.map((k) => (
                <KitGroup key={k.id} kit={k} playingKey={playingKey} setPlayingKey={setPlayingKey} />
              ))}
            </Section>
            <Section title="SoundFonts" count={catalog.soundfonts.length}>
              {catalog.soundfonts.map((s) => (
                <SoundfontRow key={s.file} sf={s} playingKey={playingKey} setPlayingKey={setPlayingKey} />
              ))}
            </Section>
          </>
        )}
      </div>
    </aside>
  )
}
