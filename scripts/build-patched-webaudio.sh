#!/usr/bin/env bash
# Build node-web-audio-api against the UPSTREAM MAIN of the web-audio-api-rs crate and install
# it into this repo — docs/upstream/node-web-audio-api-findings.md has the full story.
#
# Why: the npm release (2.0.0) pins the crate's 1.6.0 release, which explodes when native
# square/sawtooth oscillators are FM-modulated through zero into negative frequencies (exactly
# Tone.MetalSynth — beatlab's hats). Upstream main already fixed it ("OscillatorNode: also guard
# for negative nquist freqs" and follow-ups) but hasn't cut a release. This script builds the
# binding against the fixed crate, pinned to revisions we verified.
#
# Requirements: rust toolchain (cargo), ALSA headers (debian: libasound2-dev), node/npm.
# Delete this script (and switch package.json back to the npm version) once upstream releases
# a crate >1.6.0 and a binding built against it.

set -euo pipefail

CRATE_REV="4522d99"    # orottier/web-audio-api-rs main, verified 2026-07-10 (post-1.6.0 oscillator guards)
BINDING_REV="ea0b2ff"  # ircam-ismm/node-web-audio-api main, verified 2026-07-10
WORK="${WEBAUDIO_BUILD_DIR:-$HOME/upstream}"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

mkdir -p "$WORK"
cd "$WORK"

if [ ! -d web-audio-api-rs ]; then git clone https://github.com/orottier/web-audio-api-rs.git; fi
git -C web-audio-api-rs fetch -q origin && git -C web-audio-api-rs checkout -q "$CRATE_REV"

if [ ! -d node-web-audio-api ]; then git clone https://github.com/ircam-ismm/node-web-audio-api.git; fi
git -C node-web-audio-api fetch -q origin && git -C node-web-audio-api checkout -q "$BINDING_REV"

cd node-web-audio-api
# point the binding at the fixed crate (the maintainers' own dev flow — the path line ships
# commented out in their Cargo.toml)
sed -i.bak 's|^web-audio-api = "1.6"|web-audio-api = { path = "../web-audio-api-rs" }|' Cargo.toml
npm install
npm run build

cd "$REPO_ROOT"
npm install "$WORK/node-web-audio-api"

echo
echo "verifying the fix (native square oscillator under FM through zero)..."
node -e "
import('node-web-audio-api').then(async ({ OfflineAudioContext }) => {
  const ctx = new OfflineAudioContext(1, 22050, 44100)
  const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = 200
  const mod = ctx.createOscillator(); mod.frequency.value = 1020
  const g = ctx.createGain(); g.gain.value = 6400
  mod.connect(g); g.connect(o.frequency); o.connect(ctx.destination); o.start(0); mod.start(0)
  const d = (await ctx.startRendering()).getChannelData(0)
  let peak = 0; for (const v of d) if (Number.isFinite(v)) peak = Math.max(peak, Math.abs(v))
  if (peak > 2) { console.error('STILL BROKEN: peak ' + peak.toExponential(2)); process.exit(1) }
  console.log('OK: peak ' + peak.toFixed(2) + ' (npm 2.0.0 gives ~8.5e6 here)')
  process.exit(0)
})"
