# Usability pilot 109 — `beat render --offline` (CLI)

**Goal:** Persona: a terminal-comfortable musician with no knowledge of dotbeat internals, holding a
.beat project (a copy of `examples/real-groove.beat`) and wanting a WAV they trust. They've vaguely
heard of a new "offline" render mode that's supposed to be exact/deterministic, and must decide from
the CLI's own output alone whether `--offline` is worth using for their project. Everything below was
discovered from `beat` help text and command output — no source reading until after the session.

## Narrative walkthrough

`node cli/beat.mjs` with no args dumps the full ~40KB command reference, but its very first line
says how to narrow it (`beat help <command>`), so `beat help render` was one step away. That help
block is genuinely good: it states what `--offline` is (offline context instead of realtime capture,
"same engine, deterministic exact PCM"), warns it's CPU-bound and can be *slower* than live capture
("the measured ratio is printed"), says it refuses soundfont projects, and mentions a bitcrushRate
passthrough caveat. Two dents: "See decisions D22" points at an internal doc a user doesn't have,
and any unknown command (`beat help effect-set`) re-dumps the entire 40KB reference instead of a
one-line "unknown command" hint.

`beat inspect` showed my project: 4 tracks, 4 bars, 126 bpm, drums using the legacy 5-lane kit
(kick `synth:membrane`, clap `synth:noise`, hats `synth:metal`) plus three oscillator synths, every
track with the default eq3→comp→distortion→bitcrush chain. No instrument/soundfont tracks, so
`--offline` should accept it.

**Live render:** worked first try (transparently rebuilding a stale ui/dist first), 7.62s WAV,
~12s wall. `beat metrics`: -24.1 LUFS, real spectrum. Baseline established.

**Offline render:** also worked, and printed exactly the honesty the help promised:
`offline compute: 25.02s for 7.62s of audio (0.3x realtime)` plus
`note: offline computed slower than realtime on this machine — plain live capture may be faster for
this project`. As a user I now knew offline costs ~3x live for this project. But the help's
promised bitcrush caveat did not appear despite bitcrush sitting enabled on all 4 tracks (more on
that below).

**Determinism check (the mode's whole selling point):** rendered `--offline` twice, `cmp`'d.
**Not byte-identical.** Quantified with a small script: 20.2% of samples differ, max abs diff 1860
int16 units (~5.7% of full scale) — not float dust, real waveform divergence spread across the whole
file, though `beat metrics` on the pair is near-identical (same -24.3 LUFS; peak differs 0.2 dB).
Formed the obvious musician hypothesis — my clap/hats are noise-based synths — and isolated it:
removed the drums track and offline-rendered the synth-only copy twice. Those two differ at only
0.07% of samples with max diff **1 LSB** — deterministic to int16 rounding, metrics identical, but
still not byte-exact. So: oscillator content is *near*-exact; the default drum kit's noise lanes are
audibly unseeded run-to-run; and literal "exact PCM" is true in neither case. Offline speed also
swung with content: synth-only computed at 1.0-1.1x realtime (as fast as live) versus 0.3x with the
drum track present.

**The missing bitcrush caveat:** guessed a `beat set bass.effect.bitcrush.rate` path; the error
listed every legal field (a wall of ~130 names, but the answer — `bitcrushRate` is a flat track
field — was in it). Default `bitcrushRate` is 1 and `bitcrushMix` is 0, so the silence on the first
renders was arguably correct (a passthrough bitcrush needs no caveat). But after setting
`bitcrushRate 0.5`, `bitcrushMix 1`, `bitcrushBits 6` — an unambiguously active crush — the offline
render *still* printed no caveat. The help's "(caveat printed)" promise never held in any of my
runs.

**Refusal case:** copied `examples/night-shift-song.beat` (10 tracks, 4 soundfont instruments) and
ran `--offline`. The refusal *text* is excellent ("instrument (soundfont) tracks need a native
realtime context (worklet) — offline render does not support them yet: instrument, instrument5,
..."). The delivery is not: it surfaces as a raw `page.evaluate:` JavaScript stack trace with
minified bundle frames (`at bN (http://localhost:5938/assets/index-....js:274:52862)`), it arrives
only after ~30s of daemon + headless-Chromium spin-up even though track types were printed by the
CLI's own parse line in the first second, and — worst — **the process then hangs**. It never exited;
I killed it after 7+ minutes (SIGTERM, exit 143), with its daemon and browser still alive. A
leftover chromium renderer from an earlier session's offline render was also found spinning at 101%
CPU on this box — same leak class.

**Mistaken paths:** (1) `beat render nosuchfile.beat --offline` → raw Node `ENOENT` stack trace
(exit 2, prompt, decipherable, but off-brand next to the CLI's usually friendly `error:` style).
(2) Typo'd flag `--offlin` → **silently ignored**; the CLI ran a full LIVE render and exited 0. For
a flag whose entire point is exactness, a one-letter typo silently downgrading to the non-exact
mode with zero warning is the worst possible failure shape. (3) `--offline --stems` → `--offline`
silently dropped; every stem prints "rendering (real-time capture...)" with no note that the flag
was ignored. (4) `--preview-port` is honored by plain `render` (8/8 runs landed on the exact port)
but ignored by `--stems` runs (2/2, regardless of flag position — fell back to a 590x pool).

**User verdict reached:** for *my* project — the honest goal of the session — `--offline` is not
worth it: 3x slower on this machine (the CLI itself told me so, which is great), not actually
repeatable because the stock drum kit's noise lanes differ run-to-run anyway, and the live render's
metrics match offline's to within 0.2 dB. For a synth-only project it's a different answer: same
speed as live and repeatable to ±1 LSB. I ended up trusting `live1.wav`, verified with
`beat metrics`.

## Findings summary

- **[bug] HIGH — refused `--offline` render hangs the process.** CLI-specific
  (`cli/render.mjs` `captureOfflineWav`/`renderCommand` error path). On a soundfont project the
  refusal error prints (as a raw `page.evaluate` stack trace with minified bundle frames) and then
  the process never exits — killed manually after 7+ minutes, daemon and headless Chromium left
  running. In a script or CI this is an infinite stall; interactively it's a Ctrl-C and orphaned
  processes. Repro: `beat render <soundfont-project>.beat --offline -o x.wav`. Secondary aspects of
  the same finding: the refusal should be a one-line `error:` (the message text itself is already
  excellent), and it could fire at parse time (~1s) instead of after full browser spin-up (~30s),
  since the CLI prints the track list in its first output line.
- **[bug] HIGH — "deterministic exact PCM" is not what ships.** Split responsibility: core engine +
  help copy. Two consecutive `--offline` renders of `real-groove.beat` differ at 20.2% of samples,
  max diff 1860/32767 (~5.7% FS) — the legacy kit's `synth:noise`/`synth:metal` lanes are unseeded,
  so any project using the *default drum kit* gets audibly different noise transients per run
  (metrics stay near-identical: same LUFS, peaks ±0.2 dB). Even a pure-oscillator project isn't
  byte-exact: 0.07% of samples differ by exactly 1 LSB. Either seed the noise sources in the
  offline path (engine fix, `ui/src/audio/offline.ts`) or soften the help's "deterministic exact
  PCM" to what's true ("repeatable for oscillator content to ±1 LSB; noise-based instruments vary
  per run") — right now the flag's central promise fails silently on the CLI's own default kit.
- **[bug] MEDIUM-HIGH — every `beat render` leaks a `vite preview` server process.** CLI-specific
  (`cli/render.mjs` teardown). Discovered at cleanup: all ten of this pilot's render invocations —
  the *successful* ones, not just the hung refusal — left their `node .../vite preview --port <n>`
  child alive after the CLI exited and the WAV was written. `ps` also showed ~14 more orphaned
  preview servers from earlier sessions on this box (ports 5899/592x), i.e. this is chronic, and it
  is plausibly the source of the "stale zombie processes" false-failures the usability-testing doc
  already warns about. Repro: `beat render <any>.beat -o out.wav`, wait for exit, `pgrep -f "vite
  preview"`. Each is ~90MB RSS; an agent or CI loop doing many renders will accumulate them
  indefinitely.
- **[bug] MEDIUM — unknown flags are silently ignored by `render`.** CLI-specific arg parsing.
  `beat render mytrack.beat -o y.wav --offlin` runs a full LIVE render, exit 0, no warning. A typo
  in the exactness flag silently produces the non-exact render the user was trying to avoid. An
  `error: unknown flag "--offlin"` would cost one line.
- **[bug] MEDIUM — the promised bitcrushRate caveat never prints.** `beat help render` says
  "bitcrushRate renders as passthrough (caveat printed)", but with bitcrush enabled and
  unmistakably active (`bitcrushRate 0.5`, `bitcrushMix 1`, `bitcrushBits 6`) the offline render
  printed nothing. Not-printing on the *defaults* (rate 1 / mix 0) would be fine and arguably
  correct; not printing on an active rate means an offline render silently sounds different from
  live playback with no signal. CLI-or-engine reporting path; the doc and the behavior need to
  agree either way.
- **[confusing] MEDIUM — `--offline --stems` silently drops `--offline`.** Stems render via
  real-time capture (each stem prints "real-time capture") with no note that the flag combination
  is unsupported. Either support it, reject it, or print "note: --offline is ignored with --stems".
- **[confusing] LOW — `beat render <missing-file>` throws a raw ENOENT stack trace** instead of the
  CLI's usual friendly `error:` one-liner (compare `beat sample`'s "no file at ... — put the audio
  next to the project first" from pilot 99). Exits 2 promptly, so it's cosmetic inconsistency.
- **[bug] LOW — `--preview-port` is ignored in `--stems` mode** (2/2 runs, flag order irrelevant;
  plain renders honored it 8/8). Only matters for parallel/port-disciplined automation.
- **[confusing] LOW — help block references "decisions D22"**, an internal doc pointer meaningless
  to an end user, and an unknown subcommand re-dumps the full ~40KB reference rather than a short
  "unknown command, try beat help" hint.
- **[worked well] — the speed honesty is exactly right.** Printing the measured ratio
  (`25.02s for 7.62s of audio (0.3x realtime)`) plus the plain-language advisory ("plain live
  capture may be faster for this project") let a user with zero internals knowledge make the
  correct call for their own project in one run. This is the best part of the feature's UX.
- **[worked well] — the `beat help render` block itself.** One screen documented the mode's
  purpose, tradeoff, refusal class, and caveat class; nothing during the session contradicted its
  *structure*, only two of its specific promises (exactness, caveat).
- **[worked well] — happy-path renders, auto ui rebuild, and `beat metrics`** made the trust
  verification loop (render → metrics → compare) effortless; live and offline mixes of the same
  project agree to 0.2 dB, so the offline engine path itself is producing the right mix.
- **[worked well] — `beat set` wrong-path errors are self-correcting**: the (overwhelming) full
  field list contained the right name (`bitcrushRate`), so the mistake cost one round trip.

## Where the pilot gave up on the "ideal" workflow

Nowhere fatal — the primary goal (a trusted WAV) was reached, but *not* via `--offline`: the pilot
concluded live render was the better choice for this project, partly from the CLI's own honest
speed note (good) and partly because the determinism promise didn't hold under verification (bad).
The soundfont refusal path required an external `kill` to escape — a real user hits Ctrl-C, but any
scripted/CI use of `--offline` on a soundfont project stalls forever.

## Methodology notes / stats

- Pure CLI pilot per `docs/usability-testing.md` "Variant: CLI/MCP pilots": no source read during
  the session, every command's output read before the next, all claims ground-truthed (`cmp`,
  sample-level diff scripts, `beat metrics`, `ps` for the hang).
- Scratch dir under the session scratchpad (`pilot-109/`), examples/ untouched (both fixtures
  copied out first); scratch deleted and processes killed at session end (including the ~24 leaked
  `vite preview` servers found then — see the MEDIUM-HIGH finding above, which was only caught
  *because* of the cleanup-discipline step); `git status` afterwards showed only the pre-existing
  uncommitted `--offline` implementation files plus this report.
- ~13 minutes wall, ~37 tool calls, 12 render invocations (3 live, 7 offline incl. 1 refusal and
  1 typo'd-flag run, 2 stems runs). Slow box: live 4-track render ~12s wall; offline ~25s compute
  for the same 7.62s of audio; offline synth-only ~7s.
