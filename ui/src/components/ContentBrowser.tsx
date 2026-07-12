import { useEffect, useState, type ReactNode } from 'react'
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

function PreviewButton({ onPreview, title }: { onPreview: () => Promise<void>; title: string }) {
  const [busy, setBusy] = useState(false)
  return (
    <button
      className="lib-preview-btn"
      data-action="preview"
      disabled={busy}
      title={title}
      onClick={(e) => {
        e.stopPropagation()
        setBusy(true)
        onPreview()
          .catch((err) => console.warn('[library] preview failed:', err))
          .finally(() => setBusy(false))
      }}
    >
      {busy ? '…' : '▶'}
    </button>
  )
}

function PresetRow({ preset }: { preset: LibraryPreset }) {
  return (
    <div
      className="lib-row"
      draggable
      data-preset={preset.name}
      onDragStart={(e) => setDragPayload(e.dataTransfer, { type: 'preset', name: preset.name, kind: preset.kind })}
      title={preset.description}
    >
      <PreviewButton
        title={`preview ${preset.name}`}
        onPreview={() => (preset.kind === 'drums' ? engine.previewDrumPreset(preset.params) : engine.previewSynthPreset(preset.params))}
      />
      <span className="lib-row-name">{preset.name}</span>
      <span className="lib-row-meta">{Object.keys(preset.params).length}p</span>
    </div>
  )
}

function KitLaneRow({ kit, lane }: { kit: string; lane: LibraryKitLane }) {
  return (
    <div
      className="lib-row lib-kit-lane"
      draggable
      data-kit={kit}
      data-lane={lane.lane}
      onDragStart={(e) => setDragPayload(e.dataTransfer, { type: 'kit-lane', kit, lane: lane.lane })}
      title={`${kit}/${lane.file} — drag onto a drum lane`}
    >
      <PreviewButton
        title={`preview ${kit}/${lane.file}`}
        onPreview={async () => {
          const bytes = await fetchLibraryFile(`${kit}/${lane.file}`)
          await engine.previewBuffer(bytes)
        }}
      />
      <span className="lib-row-name">{(DRUM_LABELS as Record<string, string>)[lane.lane] ?? lane.lane}</span>
    </div>
  )
}

function KitGroup({ kit }: { kit: LibraryKit }) {
  return (
    <div className="lib-kit">
      <div
        className="lib-row lib-kit-head"
        draggable
        data-kit={kit.id}
        onDragStart={(e) => setDragPayload(e.dataTransfer, { type: 'kit-lane', kit: kit.id })}
        title={`drag onto a drum track to load all ${kit.lanes.length} lanes at once`}
      >
        <span className="lib-row-name">{kit.id}</span>
        <span className="lib-row-meta">{kit.lanes.length} lanes</span>
      </div>
      {kit.lanes.map((l) => (
        <KitLaneRow key={l.lane} kit={kit.id} lane={l} />
      ))}
    </div>
  )
}

function SoundfontRow({ sf }: { sf: LibrarySoundfont }) {
  const [adding, setAdding] = useState(false)
  return (
    <div
      className="lib-row"
      draggable
      data-soundfont={sf.file}
      onDragStart={(e) => setDragPayload(e.dataTransfer, { type: 'soundfont', file: sf.file })}
      title={[sf.file, sf.license, sf.source].filter(Boolean).join(' — ')}
    >
      <PreviewButton
        title={`preview ${sf.file}`}
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
                    <PresetRow key={p.name} preset={p} />
                  ))}
                </div>
              ))}
            </Section>
            <Section title="Presets — Drums" count={drumPresets.length}>
              {groupByCategory(drumPresets, DRUM_CATEGORY_ORDER).map(([cat, ps]) => (
                <div key={cat} className="lib-category">
                  <div className="lib-category-label">{cat}</div>
                  {ps.map((p) => (
                    <PresetRow key={p.name} preset={p} />
                  ))}
                </div>
              ))}
            </Section>
            <Section title="Kits" count={catalog.kits.length}>
              {catalog.kits.map((k) => (
                <KitGroup key={k.id} kit={k} />
              ))}
            </Section>
            <Section title="SoundFonts" count={catalog.soundfonts.length}>
              {catalog.soundfonts.map((s) => (
                <SoundfontRow key={s.file} sf={s} />
              ))}
            </Section>
          </>
        )}
      </div>
    </aside>
  )
}
