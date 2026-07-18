# Usability pilot 113 — vary-batch loudness normalization + osc on chord tracks

**Goal:** Persona: a producer who just updated dotbeat and heard "vary batches are
loudness-normalized now, and osc batches work on chord tracks again." Project: a copy of
`examples/night-shift.beat` (its `pad` is genuinely polyphonic — four 3-note chords, verified via
`inspect --json` before starting). Plan: run vary batches across groups including osc on the
chords track, audition/score them, opt out of normalization and see what changes, ask
`beat suggest --taste-next` what to collect next, and judge purely from printed output whether
the loudness story (targets, gains, caps) explains itself. Offline render throughout; no source
reading until the post-session attribution pass (file:line notes below are from that pass).

## Narrative walkthrough

**Discovery.** `beat help` → the vary block already tells the whole normalization story up front:
"loudness-normalized by default (pure gain to the batch-median LUFS, -1 dBTP ceiling, recorded in
the manifest) ... the taste log's 'louder wins' confound; --no-normalize keeps the raw render
loudness." `beat vary night-shift.beat pad --groups` listed the pad's real targets cleanly (osc =
osc2Level/osc2Detune/subLevel/noiseLevel/unisonVoices/unisonWidth/wtPos). So far the CLI is
self-teaching.

**First stumble — cold-start render.** `vary pad osc --count 3 --seed 11 --render` printed its
variants, the offline banner, then `building ui/ (ui/dist missing)...` and died with a bare
`Error: Command failed: npm run build` double stack trace — no build output, no hint. The actual
cause (found by trying the build myself) was `ui/node_modules` missing; `cd ui && npm install &&
npm run build` fixed it in a minute. A fresh checkout's very first `--render` hits this wall with
zero guidance.

**The headline claim holds.** Rerun: 3 offline renders of the polyphonic pad with osc mutations,
7.74s each at 2.7-2.8x realtime, no errors — "osc batches work on chord tracks again" is real
(later confirmed on the live path too). Then the new line:

```
loudness-normalized to -13.1 LUFS (batch median): v1 +0.0 dB (capped at -1 dBTP), v2 +0.0 dB, v3 -0.1 dB
```

Target, basis (batch median), per-variant gains — good. But `v1 +0.0 dB (capped at -1 dBTP)` made
me stop: a zero gain that was *capped*? The manifest (promised by help, and really there) says v1
measured -13.18 against target -13.11 — it *wanted* +0.07 dB and got 0, `capped: true`. Neither
the line nor the manifest shows the wanted gain or the measured peak, so the parenthetical is
unreadable on its own.

**Then the ceiling fell.** `beat metrics` on the three normalized wavs (my stand-in ears):
every one measures **sample peak 0.0 dBFS, true peak +0.4 dBTP** — a full 1.4 dB above the
"-1 dBTP ceiling" the normalizer just cited. `beat lint v1.wav` flags the very file its sibling
command just "capped": `WARN [true-peak-clipping] true peak 0.4 dBTP is above -1 dBTP`. A raw
sample count found ~456-488 full-scale samples per 7.7s render — the stock example renders hot
enough to clip, normalized or not, and nothing in the render path says a word about it.

**Opting out (goal 3).** Same seed with `--no-normalize --out-dir vary-osc-11-raw`: the only
output difference is the *absence* of the normalization line — no "normalization skipped" note.
Raw metrics: -13.0 LUFS, same 0.0 dBFS / +0.4 dBTP peaks. So the hot peaks are inherited from the
render; normalization neither causes nor fixes nor mentions them. The raw manifest records no
loudness at all (`normalization: None`, no per-variant `loudness`), so a raw batch leaves no
measured-LUFS trail. (Byte-diffing normalized-vs-raw wavs was useless by design — help warns
noise voices vary per run — so metrics, not cmp, is the honest comparison.)

**Audition/score loop.** `beat audition vary-osc-11` stitched a genuinely shuffled audition.wav
("listen and rank BEFORE looking at the answer key" — key verified shuffled: v1, v3, v2), and
`beat score vary-osc-11 v2 v1 v3` logged a complete entry (ranks, replayable edits, parent sha,
per-variant features) and printed the adopt command. Notably the score entry's own features
record `truePeakDb: 0.386` — the taste log quietly documents the ceiling violation.

**Do the gains ever move?** filter on bass (`--audition`, 4 variants incl. cutoff 150 vs 656):
gains still only -0.1..+0.0 — surprising until I checked the notes (bass fundamentals are 43-130
Hz, below even the 150 Hz cutoff; K-weighted loudness genuinely barely moves — my initial
"normalization must be broken" read was wrong). mix on lead: same near-zero gains, and again a
`(capped at -1 dBTP)` tag on a +0.0. On this project the cap tag shows up in *every* batch,
because the mix is permanently over the ceiling so any wanted boost caps to 0.

**Where normalization really works — and really bites.** `beat taste-seeds` + `beat taste-collect
--gen-backend stub` ran the whole collection pipeline offline. Its solo mix-group batch was the
smoking gun: v1's edit set `bass.volume -19.2584`, and the manifest shows normalization boosted
it back **+14.91 dB** (v3: volume +1.86, gain -10.89). All three variants land on the batch
median — normalization demonstrably works — but the rater will never hear the volume difference
the taste log records as the preference, and adopting v1 writes `volume -19.26` into a project
where nothing normalizes it. And taste-collect prints **no normalization line at all** (verified
with an unfiltered rerun): the manifests record gains of ±15 dB applied in complete silence.

**Goal 4 — what next for my taste data.** `beat suggest --taste-next .` (guessing that
"collection-dir" meant my project dir — it worked, keyed off beat-scores.jsonl) printed a clear
coverage table, then:

```
proposed next round:
  beat taste-collect . --per-seed 0 --gen 4   # (fal on your machine; --gen-backend stub elsewhere)
  beat taste-collect . --per-seed 0 --gen 4   # (fal on your machine; --gen-backend stub elsewhere)
```

The same command, twice — meant to be two different under-covered gen splits — while the equally
under-covered `feel` and `drum voices` splits got no command at all. Running the proposal verbatim
on my dir failed (`no seed-*.beat files in . — run beat taste-seeds . first` — good recovery
text, but the proposal skipped its own prerequisite). The repeat-probe suggestion `beat rate .`
turned out to be a blocking web UI on :4321 — it self-describes fine, but a CLI-only user can't
follow it.

**111 regression checks (in passing).** All three of pilot 111's HIGH CLI bugs are fixed:
`vary --no-normalise` (typo) → loud unknown-flag error with the known list; `vary --render
--live` → `batch rendering via live capture (--live)` with normalization running on the live
path too; `beat render --batch <dir>` is now reachable. But the last one hides this session's
worst finding:

**`render --batch` un-normalizes a batch and leaves the manifest lying.** Re-rendering the solo
mix batch with `beat render --batch collection2/vary-mix-4221` printed the offline banner, wrote
three wavs, and ended — no normalization line, no summary. `beat metrics v1.wav` → **-39.2 LUFS**
(the raw level), while manifest.json still says v1 was boosted +14.91 dB to a -24.27 target;
manifest mtime is older than the wavs. Help says `--batch` is "what vary --render calls" — no
longer true where loudness is concerned, and `render` has no `--normalize` flag to opt back in.

One last probe: `--spread` (seen in vary's known-flags error and in taste-collect's batch
headers) is accepted and works, but appears nowhere in `beat help vary`.

## Findings summary

- **[bug] HIGH — `beat render --batch` silently strips normalization and leaves a lying
  manifest.** Repro: any normalized batch with real gains (e.g. a taste-collect solo mix batch,
  v1 gain +14.91 dB) → `beat render --batch <dir>` → wavs are raw again (metrics: -39.2 LUFS vs
  the manifest's normalized -24.27 record), manifest untouched (mtime older than wavs), nothing
  printed about normalization either way. Anyone re-rendering a batch (mode switch, stale wavs)
  silently reintroduces the exact "louder wins" confound the feature exists to kill, and every
  downstream consumer (audition, rate, taste features) trusts a manifest that no longer describes
  the audio. Post-session: normalization lives in `renderVaryBatch` (`src/vary/batch.ts:462-482`),
  which only the `vary` command calls; `cli/render.mjs:551 renderBatchCommand` never calls
  `normalizeBatchLoudness`, and `beat help render` still claims `--batch` is "what vary --render
  calls". CLI-specific. Fix: have `renderBatchCommand` normalize by default (with `--no-normalize`
  through), refresh the manifest records, and print the same summary line — or at minimum print
  "renders are NOT loudness-normalized (re-render)" and delete the stale `loudness` records.
- **[confusing] HIGH — the "-1 dBTP ceiling" isn't a ceiling, and "capped" lines are unreadable.**
  Normalized output on stock `night-shift.beat` measures +0.4 dBTP / 0.0 dBFS (~480 full-scale
  samples per 7.7s render) while the CLI prints "capped at -1 dBTP" and `beat lint` flags the same
  file as over -1 dBTP. Is this real or my misreading: the *mechanism* is deliberate — the cap
  only limits upward gain ("a variant already over the ceiling as rendered is the render's
  business ... we just refuse to make it worse", `src/vary/batch.ts:230-240`), and the MCP tool
  description even words it correctly ("upward gains capped at -1 dBTP", `src/mcp/server.ts:2004`)
  — but the CLI help ("-1 dBTP ceiling") and the printed `v1 +0.0 dB (capped at -1 dBTP)` (which
  shows neither the wanted gain nor the measured peak) both promise more than is delivered, and
  on an over-hot project the tag appears on effectively every batch. Underneath sits a real
  cross-surface dent: a stock example clips on render and no render-path output says so. Fix:
  wording — e.g. `v1 +0.0 dB (wanted +0.1, held back: true peak already +0.4 dBTP, over the -1
  dBTP ceiling)` — plus a one-line lint-style clipping warning from the render/normalize path
  when measured true peak exceeds the ceiling; align `beat help vary` with the MCP phrasing.
- **[confusing] MEDIUM-HIGH — taste-collect normalizes in total silence, with gains big enough
  to cancel the edits being rated.** Its solo mix-group batches mutate `volume` (v1: -19.26 dB)
  and normalization boosts it right back (+14.91 dB) — the rater hears level-matched audio, the
  taste log records the volume edit as the preference driver, and adopting the winner reproduces
  the un-normalized volume in a project where nothing level-matches it. No console line at all:
  `cli/beat.mjs:1487` spawns the child `vary --render` with stdout ignored, so
  `formatNormalizationResult` never reaches the user. Possibly working-as-designed (level
  confound removal is the point), but ±15 dB of silent gain and the rate-vs-adopt divergence on
  volume-mutating groups deserve at least a printed note — or mix-group batches should exclude
  `volume` from mutation when normalization is on, since its audible effect is largely undone.
  Shared core/CLI (batch contract + taste-collect surfacing).
- **[bug] MEDIUM — `suggest --taste-next` proposes the same command twice and starves the other
  under-covered splits.** Both gen splits print the identical `beat taste-collect <dir>
  --per-seed 0 --gen 4` line (`cli/beat.mjs:2046-2049` branches both gen split names to one
  string), and `.slice(0, 2)` means equally under-covered `feel`/`drum voices` (0% vs 10%
  targets here) get no command at all. The proposal also skips its own prerequisite: run
  verbatim on a dir without `seed-*.beat` it errors (the error's recovery text — "run beat
  taste-seeds . first" — is good). Small vocabulary drift on the way in: suggest says
  `<collection-dir>`, taste-collect's own usage says "the taste-seeds directory". CLI-specific.
  Fix: dedupe/merge the gen proposals, print one line per under-covered split (or say why not),
  and prepend `beat taste-seeds` when the dir has no seeds.
- **[confusing] LOW-MEDIUM — first render on a fresh checkout dies in a bare stack trace.**
  `building ui/ (ui/dist missing)...` then `Error: Command failed: npm run build` twice-nested,
  with the build's own stderr swallowed (`cli/render.mjs:185 bootRenderSession`); actual cause
  was missing `ui/node_modules`. Fix: surface the build output and/or detect missing
  `ui/node_modules` and say `cd ui && npm install` — the first `--render` a new user ever runs
  should not require diagnosing npm by hand.
- **[slow-to-discover] LOW — normalization opt-out and raw batches leave no trail.**
  `--no-normalize`'s only confirmation is the absence of the summary line, and a raw batch's
  manifest records no measured LUFS at all — so you can't later tell a pre-normalization batch
  from an opted-out one, or see how loud the raw renders were. Fix: print `loudness
  normalization: skipped (--no-normalize)` and record measured LUFS (gain 0) in the manifest
  either way.
- **[slow-to-discover] LOW — `--spread` is real but undocumented.** Accepted by vary, listed in
  its unknown-flag error, used by every taste-collect batch ("spread, target solo" headers), and
  visibly produces wider all-param mutations — but absent from `beat help vary`. Fix: one usage
  line.
- **[worked well] — osc on the polyphonic chords track, both render paths.** The headline fix is
  real: 3-variant osc batches on a 4×3-note-chord pad rendered clean offline and live (pilot
  ground truth: wavs present, plausible metrics, no scheduling errors — the old failure per the
  post-session comment at `cli/beat.mjs` tasteCollectCmd was Tone's "Start time must be strictly
  greater than previous start time", fixed by a7ac2c6).
- **[worked well] — the normalization summary line's content, when it prints.** Target LUFS,
  basis ("batch median"), per-variant signed gains in one line; manifest records
  measured/gain/capped per variant plus the target/ceiling; `beat metrics` confirmed every
  normalized variant landing on the median (all four filter variants at exactly -13.1 LUFS, and
  the collection env batch's -1.71 dB gain verified). The *system* works; the cap wording and the
  two silent surfaces above are what let it down.
- **[worked well] — pilot 111's HIGH bugs are all fixed where filed**: vary rejects unknown flags
  with the known list (exit 2), `vary --render --live` really goes live (banner: "batch rendering
  via live capture (--live)") and still normalizes, and `beat render --batch` is reachable.
- **[worked well] — the taste pipeline runs fully offline**: taste-seeds → taste-collect
  `--gen-backend stub` → rate-able batches, with per-batch headers, a skip-with-warning failure
  posture, and every stage printing the literal next command. `beat lint`'s true-peak warning is
  exactly the cross-check that exposed finding 2.

## Where the pilot gave up on the "ideal" workflow

Three places, all soft. (1) Blind rating: `beat rate` is a browser UI a CLI pilot can't click, so
scoring went through `beat score` with `beat metrics` as ears — meaning my "audition" was never
actually blind (a CLI-only user auditioning per-file has the same problem; the shuffled
audition.wav is the real blind path and its protocol text is right). (2) The `--taste-next`
proposal verbatim would have used the fal backend (network); the help's own `--gen-backend stub`
note was the workaround, and it worked. (3) Explaining the +0.4 dBTP peaks required stepping
outside the render loop entirely (`beat metrics`, `beat lint`, a raw sample count) — nothing on
the vary/render path itself would ever have told me the renders clip.

## Methodology notes / stats

- Pure CLI pilot per `docs/usability-testing.md` "Variant: CLI/MCP pilots": no checklist, surface
  rediscovered via `beat help` / `beat help <cmd>`, every output read before the next command, no
  source until the post-session attribution pass.
- Ground truth: manifests and `beat-scores.jsonl` read raw after every claim; normalized-vs-raw
  compared by `beat metrics` (not `cmp` — noise lanes make byte-diffs meaningless, as help
  warns); the render-batch de-normalization proven by manifest-vs-wav mtimes plus a -39.2-LUFS
  measurement against a +14.91 dB manifest record; clipping counted from raw int16 samples;
  `pgrep`/`lsof` sweep at cleanup found zero zombies.
- Fixtures: copies only in `/tmp/dotbeat-usability-loudnorm/` (deleted at session end);
  `examples/night-shift-song.beat` untouched; green `npm test` baseline first (895 pass).
- ~40 tool calls, ~35 min wall. Render invocations: 5 vary batches (osc normalized/raw, filter,
  mix, osc --live), 2 `render --batch` re-render probes, 3 taste-collect runs (2 seeds + 1-seed
  unfiltered rerun + stub gen batch). Offline throughput on this box: 2.2-2.8x realtime for
  3.4-7.7s clips.
