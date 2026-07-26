// The units contract for src/metrics/rich.ts.
//
// Research 131 measured its effect sizes and its 0.676 -> 0.795 held-out accuracy with a PYTHON
// pipeline (~/.claude/jobs/fc3bd856/tmp/gapanalysis/richfeat.py). Doc 140 §2-D16 recorded the
// hazard that followed: a second extractor was forked whose flux ran "~4-5x higher" and whose
// attack times ran "~2x slower", i.e. two pipelines whose UNITS disagree, so no number published
// against one could be checked against the other. This test pins the TS port to values produced
// by that same Python `features()` function on six COMMITTED clips. (Research 131's own 973 clips
// live in showdown batches carrying private Splice ref audio and are never committed — D25 — so
// the fixture uses the tracked `gen-*` batches instead.) If this fails, src/metrics/rich.ts no
// longer speaks research 131's units and every threshold derived from that doc —
// presets/role-targets.json, the grind detector, the critic's own weights — is off its calibration.
//
// Tolerance provenance: measured across a 120-clip sample on 2026-07-26, worst relative error
// 8.2e-5 (attackCv, floating-point accumulation order); 19 of the 23 features agree to 1e-11 or
// better. 1e-3 leaves three orders of headroom over the observed residual while still catching
// any real change of definition (the convolution-centring bug this port shipped with moved the
// attack family by 1.6e-2, which this tolerance would have caught).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { decodeWav, analyzeRich, type RichMetrics } from '../src/metrics/index.js'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..', '..') // dist/test -> repo root
const FIXTURE = resolve(here, 'fixtures/rich-parity.json')

const REL_TOLERANCE = 1e-3

interface ParityFixture {
  source: string
  note: string
  clips: { wav: string; expected: Record<string, number> }[]
}

test('rich DSP features reproduce research 131\'s python pipeline exactly', () => {
  assert.ok(
    existsSync(FIXTURE),
    `missing ${FIXTURE} — regenerate it by running research 131's own extractor over the clips it
     names: python/.venv/bin/python -c "import sys; sys.path.insert(0, '<gapanalysis>');
     from richfeat import features; print(features('<repo>/examples/taste-t1/gen-kick1-50884/v1.wav'))"
     then rename crest_<band>Db -> crest<Band>Db. Do NOT hand-edit the expected values.`,
  )
  const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8')) as ParityFixture
  assert.ok(fixture.clips.length >= 6, 'the parity fixture must cover at least six committed clips')

  let compared = 0
  for (const clip of fixture.clips) {
    const wavPath = resolve(repoRoot, clip.wav)
    // The wavs are committed example batches; a missing one is a broken fixture, not a skip
    // (CLAUDE.md: "a test that can silently skip is not a gate").
    assert.ok(existsSync(wavPath), `parity fixture references a missing render: ${clip.wav}`)
    const decoded = decodeWav(readFileSync(wavPath))
    const actual = analyzeRich(decoded.channels, decoded.sampleRate) as unknown as Record<string, number>
    for (const [key, expected] of Object.entries(clip.expected)) {
      const got = actual[key]
      assert.equal(typeof got, 'number', `${clip.wav}: rich metrics have no ${key}`)
      assert.ok(Number.isFinite(got!), `${clip.wav}: ${key} is not finite (${got})`)
      const relative = Math.abs(got! - expected) / Math.max(1e-6, Math.abs(expected))
      assert.ok(
        relative <= REL_TOLERANCE,
        `${clip.wav}: ${key} drifted from research 131's units — python ${expected}, ts ${got} (rel ${relative.toExponential(2)})`,
      )
      compared++
    }
  }
  assert.ok(compared >= 130, `expected >= 130 feature comparisons, made ${compared}`)
})

test('rich DSP features are finite and degenerate honestly on silence', () => {
  const silence = [new Float64Array(44100), new Float64Array(44100)]
  const m = analyzeRich(silence, 44100) as unknown as Record<string, number>
  for (const [k, v] of Object.entries(m)) assert.ok(Number.isFinite(v), `${k} is not finite on digital silence`)
  assert.equal(m.onsetRatePerSec, 0)
  assert.equal(m.onsetCount, 0)
  assert.equal(m.widthMeanDb, -80, 'silence reads as dead mono, the honest degenerate width')

  // A clip shorter than one STFT frame must not throw or emit NaN.
  const tiny = analyzeRich([new Float64Array(100)], 44100) as unknown as RichMetrics
  assert.equal(tiny.onsetCount, 0)
  assert.ok(Number.isFinite(tiny.fluxMean))
})

test('a mono render reads as dead mono, a wide one does not', () => {
  const n = 44100
  const l = new Float64Array(n)
  const r = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    l[i] = Math.sin((2 * Math.PI * 220 * i) / 44100) * 0.5
    r[i] = l[i]!
  }
  const mono = analyzeRich([l, r], 44100)
  assert.equal(mono.widthMeanDb, -80, 'identical channels are dead mono')

  // A partially decorrelated right channel: real width, mid still present. (A perfectly
  // out-of-phase pair has ZERO mid energy, so richfeat.py's activity mask -- Mr > Mr.max()*1e-4
  // -- excludes every frame and the honest answer is the floor, not "infinitely wide".)
  const rWide = new Float64Array(n)
  for (let i = 0; i < n; i++) rWide[i] = Math.sin((2 * Math.PI * 220 * i) / 44100 + 1.2) * 0.5
  const wide = analyzeRich([l, rWide], 44100)
  assert.ok(wide.widthMeanDb > -20, `decorrelated channels should read wide, got ${wide.widthMeanDb}`)
  assert.ok(wide.widthMeanDb > mono.widthMeanDb)
})
