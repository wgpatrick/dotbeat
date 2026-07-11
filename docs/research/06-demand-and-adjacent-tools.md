# Research 06 — Demand Signal & Adjacent Tools (live-coding landscape), the last flagged gaps

> **Fully adversarially verified** (deep-research harness). {"angles": 5, "sourcesFetched": 20, "claimsExtracted": 89, "claimsVerified": 25, "confirmed": 21, "killed": 4, "unverified": 0, "afterSynthesis": 11, "urlDupes": 0, "budgetDropped": 10, "agentCalls": 102} — run 2026-07-10, 102 agents, 0 errors.
>
> Resolves `ROADMAP.md` §11 items (b) live-coding comparison and (c) demand signal — both had
> returned zero verified evidence in two prior passes. Instructed to treat thin evidence as a
> finding rather than inflate it; it did.

## Question

> The demand side and adjacent-tools landscape for a git-native, agent-native DAW (the dotbeat project) — the two remaining flagged research gaps from its roadmap (§11 items b and c, both returned zero verified evidence in two prior passes). Research questions: (1) LIVE-CODING LANGUAGE COMPARISON: Strudel, TidalCycles, Sonic Pi, Glicol, FoxDot — for each: does it have any GUI editing surface (or is it code-only), what is its file/project format on disk, does it support headless/CLI rendering to audio files, how does it handle the "round-trip trap" (can a visual edit be written back into code?), size/activity of its community. Primary sources: official docs/repos, maintainer talks/posts. (2) DIRECT DEMAND SIGNAL: verifiable evidence that producers-who-code exist as a market — TidalCycles/algorave community size and longevity, usage of ableton-mcp and similar agent-music tools (stars, forks, activity), forum/survey/complaint evidence that musicians want version control for DAW projects (beyond DAWproject issue #40 which we already verified), Splice/version-control-for-music products and their fate, any published surveys of DAW feature usage or musician workflows with data. (3) What do these communities say is MISSING from their tools — especially anything matching "GUI + diffable text + CLI" (the gap this project targets)? Prefer primary sources; adversarially verify; explicitly flag community-size numbers as of-date; don't inflate weak signals — if the demand evidence is thin, saying so IS the finding.

## Executive summary

Across the surviving evidence, every live-coding language examined is code-first with no native GUI editing surface, and none offers first-class headless/offline rendering to audio files — the gaps dotbeat targets are real and unoccupied. The demand-side signal is asymmetric: demand for CLI/local/headless workflows among live-coders is repeatedly documented but thin in volume (an unanswered 2018 TidalCycles issue, a small 2022-2024 Glicol thread that nonetheless drove the maintainer to ship glicol-cli), while demand for agent control of DAWs is the strongest verified signal (ableton-mcp at ~2.8k stars/365 forks with active maintenance through June 2026). The round-trip trap is confirmed as unsolved: the only working code<->GUI round-trip found anywhere is Strudel's narrow inline slider widget, while the one third-party GUI over Strudel (xyflow's strudel-flow) is strictly one-directional and sidesteps rather than solves the problem. Notably, no verified evidence emerged for Sonic Pi or FoxDot, for algorave community-size numbers, for Splice-style version-control products' fate, or for musician surveys — after three passes, the broad "musicians want version control" demand case remains unproven beyond DAWproject #40, and that thinness is itself a finding.

## Verified findings

### 1. [HIGH] — vote 3-0

Glicol is code-only: its primary editing surface is a browser text editor at glicol.org (plus code-only surfaces glicol-cli and glicol-vst), with no GUI/node-based editor documented and therefore no visual-to-code round-trip mechanism. 'Graph-oriented' in its name refers to the textual audio signal graph, not a visual canvas.

*Evidence: README: "The easiest way to try Glicol: https://glicol.org ... just change the code and update"; verifier search for a visual/node editor surfaced only code-based surfaces. (Merged claims 0.)*

Sources: <https://github.com/chaosprint/glicol>, <https://github.com/glicol/glicol-cli>, <https://github.com/glicol/glicol-vst>

### 2. [HIGH] — vote 3-0

Glicol supports headless execution (embeddable Rust DSP library for VST/Bela; glicol-cli terminal live-coding since March 2023) but has no documented CLI for offline rendering of compositions to audio files — glicol-cli plays in real time to an audio device only (its --headless flag merely disables the TUI).

*Evidence: README: "Glicol can run on many different platforms such as browsers, VST plugins and Bela board"; glicol-cli options are only -b/--bpm, -d/--device, -H/--headless — no export path. Maintainer announced glicol-cli in discussion #110 on 2023-03-11. (Merged claims 1 and 9.)*

Sources: <https://github.com/chaosprint/glicol>, <https://github.com/glicol/glicol-cli>, <https://github.com/chaosprint/glicol/discussions/110>

### 3. [HIGH] — vote 3-0

Glicol's own history is direct evidence of demand for local/CLI workflows among live-coders: as of 2022 users were confined to the browser playground and resorted to headless-Chromium hacks to edit in Vim/VSCode; the maintainer responded by shipping glicol-cli (March 2023); community members then self-built the missing tooling (tree-sitter grammar, glicol-lsp language server, Emacs glicol-mode) and flagged robustness gaps (invalid programs cut audio locally, unlike the browser which keeps the last working version).

*Evidence: flexabyte (Aug 2022) described a "hacky solution" using headless Chromium + Chrome Remote Interface to run Glicol from local editors; chaosprint confirmed no local tool existed and later announced glicol-cli; TenStrings (Sep 2023) shipped tree-sitter grammar + LSP; khtdr (Dec 2024) shipped Emacs mode. Thread has only ~6 participants — evidences the gap, not broad demand. (Merged claims 8 and 10.)*

Sources: <https://github.com/chaosprint/glicol/discussions/110>, <https://github.com/TenStrings/glicol-lsp>, <https://github.com/khtdr/glicol-mode>

### 4. [HIGH] — vote 3-0

Glicol's community is modest: ~3,000 GitHub stars, 98 forks, 669 commits on chaosprint/glicol as of 2026-07-10, authored and maintained primarily by one person (Qichao Lan).

*Evidence: Live repo page on 2026-07-10 shows 3k stars / 98 forks / 669 commits. 'Single-maintainer-scale' is a reasonable gloss, not a verified contributor count; note 3k stars is comparable to TidalCycles' repo (~2.4k), so 'smaller ecosystem' refers to users/longevity, not raw stars. (Claim 2.)*

Sources: <https://github.com/chaosprint/glicol>

### 5. [HIGH] — vote 3-0

Strudel is the official JavaScript port of TidalCycles, runs as a browser REPL/PWA, and integrates with external setups via MIDI/OSC; its editing surface is code-first. The only verified code<->GUI round-trip mechanism anywhere in the surveyed landscape is Strudel v1.0.0's (Jan 2024) inline 'slider' widget, whose value lives in the code text and is rewritten when the GUI slider is dragged — an explicit but very narrow round-trip.

*Evidence: Docs: "It is an official port of the Tidal Cycles pattern language to JavaScript"; v1.0.0 release notes: "The new slider function inlines a draggable slider element into the code, bridging the gap between code and GUI ... When the slider is moved, the value in the code will change as well, so the code will always be in sync." (Merged claims 16 and 17.)*

Sources: <https://strudel.cc/>, <https://strudel.cc/blog/>, <https://strudel.cc/workshop/getting-started/>

### 6. [HIGH] — vote 3-0

Strudel lacks a first-class headless/CLI rendering or editing path: the proposed .wav export (Codeberg PR #1414, opened June 2025, still unmerged as of Feb 2026 activity) records live browser audio via an AudioWorklet through GUI controls with zero discussion of headless/CLI rendering; and third-party tooling (strudel.nvim) must resort to Puppeteer remote-controlling a real Chromium browser running the web editor because no headless engine/API exists.

*Evidence: PR #1414: "Adds a RecorderProcessor AudioWorklet that records audio output when enabled ... a toggle button to enable/disable recording"; strudel.nvim README: "It uses Puppeteer to control a real browser instance allowing you to write Strudel code from Neovim"; maintainer embedding recommendations in tidalcycles/strudel#381 are all browser-based. Note: the broader 'Strudel has no audio export at all' framing was refuted — the web REPL has an export tab; the verified gap is specifically headless/CLI/offline rendering. (Merged claims 3 and 15.)*

Sources: <https://codeberg.org/uzu/strudel/pulls/1414>, <https://github.com/gruvw/strudel.nvim>, <https://strudel.cc/learn/faq>

### 7. [HIGH] — vote 3-0 (existence/one-directionality); 2-1 (demand-signal framing)

A third-party node-based GUI over Strudel exists — xyflow's (React Flow team) experimental 'Strudel Flow' (~218 stars, Show HN Aug 2025) — but it is strictly one-directional: the node graph generates and executes Strudel code, with no documented ability to parse existing Strudel code back into nodes. It sidesteps the round-trip trap by making the graph the sole source of truth rather than solving code<->GUI bidirectionality.

*Evidence: xyflow labs page: "Under the hood, it generates a Strudel program, and executes it in the browser"; README lists only "View generated Strudel code for each node" (read-only preview). Caveat: this is a vendor tech demo built to showcase React Flow — supply-side promotion, not organic Strudel-community demand — so treat it as weak/suggestive GUI-demand evidence only. (Merged claims 11, 12, 13, 14.)*

Sources: <https://github.com/xyflow/strudel-flow>, <https://xyflow.com/labs/strudel-flow>

### 8. [MEDIUM] — vote 3-0 (facts); 2-1 (weak-engagement interpretation)

TidalCycles had no built-in offline/headless render-to-audio-file as of December 2018, and the one user who requested it (issue #410) explicitly wanted a fully code/CLI workflow with no GUI — "I don't want to mouse around in the IDE ... I am using sclang dirt_startup.scd" — but the request drew zero comments, no maintainer response, and no implementation over its lifetime: direct but n=1 evidence of headless-rendering demand.

*Evidence: Issue text: "render the sound of a tidal pattern (set) to an audio file, for a given length of time ... call this function programmatically ... from inside a ghci session." Closed with no discussion. Important context: the repo was archived June 2025 (development moved to Codeberg uzu/tidal), so closure was likely administrative, not rejection; emoji reactions and post-migration Codeberg discussion could not be checked. Zero-engagement interpretation drew a 2-1 split vote. (Merged claims 4, 5, 6.)*

Sources: <https://github.com/tidalcycles/Tidal/issues/410>

### 9. [HIGH] — vote 3-0

The strongest verified demand signal for agent-native music tooling is ableton-mcp: ~2,800 GitHub stars and 365 forks as of 2026-07-10, whose explicit purpose is letting Claude directly control Ableton Live via MCP, and which is actively maintained (commits June 4, 2026; merged external-contributor feature PRs through May 2026 covering audio clip creation, plugin loading, playback state; PR numbers reaching #101 from at least five distinct contributors) — sustained activity a year-plus after launch, not a one-time hype spike.

*Evidence: README: "AbletonMCP connects Ableton Live to Claude AI through the Model Context Protocol (MCP), allowing Claude to directly interact with and control Ableton Live." Live metrics 2.8k stars / 365 forks / 32 issues / 30 open PRs on 2026-07-10. Caveats: stars measure attention not adoption (forks + merged external PRs partially corroborate real usage); do not conflate with the maintainer's "11k+ stars" claim which spans all his MCP projects. (Merged claims 18, 19, 20.)*

Sources: <https://github.com/ahujasid/ableton-mcp>, <https://github.com/ahujasid/ableton-mcp/commits/main>

### 10. [MEDIUM] — vote ?

Synthesis across the landscape: no surveyed tool occupies the 'GUI + diffable text + CLI-renderable' triangle dotbeat targets. Glicol and Strudel have diffable text and partial CLI paths but no GUI; strudel-flow has a GUI but one-way code generation; TidalCycles is text-only with headless rendering requested but never built; ableton-mcp bridges agents to a GUI DAW whose project format is neither diffable nor its state text-authoritative. Every community's self-built workarounds (headless Chromium, Puppeteer, LSPs, node-graph overlays) point at exactly the seams between these three properties.

*Evidence: Inferential synthesis over the verified per-tool findings above; medium confidence because it is an interpretation (the gap's existence is well-evidenced; that filling it is valuable is supported only by thin, small-n demand signals).*

Sources: <https://github.com/chaosprint/glicol/discussions/110>, <https://github.com/gruvw/strudel.nvim>, <https://github.com/xyflow/strudel-flow>, <https://github.com/tidalcycles/Tidal/issues/410>, <https://github.com/ahujasid/ableton-mcp>

### 11. [MEDIUM] — vote ?

The direct demand case for 'producers-who-code as a market' and 'musicians want version control for DAW projects' remains largely unverified after three research passes: no claims survived on algorave/TidalCycles community size or longevity, Splice-style version-control products and their fate, published DAW-usage or musician-workflow surveys, or forum complaint evidence beyond the already-verified DAWproject issue #40. The thinness of verifiable demand evidence is itself the finding.

*Evidence: The research question explicitly instructed that thin demand evidence be reported as such. What survived is supply-side and workaround evidence (tools people built) plus small-n direct requests (Tidal #410, Glicol #110) plus one strong agent-tooling signal (ableton-mcp); nothing survived quantifying the musician-version-control market.*

Sources: `(absence of surviving claims across two prior passes and this one)`

## Refuted claims (do not cite)

- As of the PR's opening (June 2025) through February 2026, Strudel's audio recording/.wav export feature was still an unmerged work-in-progress pull request, implying the mainline Strudel REPL lacked built-in audio file export during that period.
- strudel.nvim implements bidirectional (two-way) sync between a Neovim text buffer and the Strudel web editor, meaning edits made in Strudel's GUI editing surface can be written back into the code buffer — a working example of escaping the 'round-trip trap' for Strudel, albeit via browser automation rather than a native file format.
- Strudel's primary editing surface is a text code editor (CodeMirror); its visual features (pianoroll, pitch circle, oscilloscope, spectrum analyzer) are described only as display-only visualizations rendered behind/alongside the code, with no documented GUI editing that writes back to code.
- Strudel's official docs and release notes document no headless/CLI rendering of patterns to audio files; the only Node/CLI tooling mentioned is @strudel/sampler, which serves sample files from disk to the browser REPL, and the docs do not describe an on-disk project/file format (patterns live in the browser REPL).

## Caveats

Time-sensitivity: all community-size numbers (Glicol ~3k stars/98 forks; ableton-mcp 2.8k stars/365 forks; strudel-flow ~218 stars) are as of 2026-07-10 and should be re-checked before publication. Repository migrations complicate activity metrics: tidalcycles/Tidal (GitHub) was archived June 2025 with development moved to Codeberg uzu/tidal, and tidalcycles/strudel likewise moved to codeberg.org/uzu/strudel (June 2025) — GitHub metrics for these understate current activity, and the Codeberg Tidal issue tracker could not be checked (anti-scraper block), so post-migration discussion of headless rendering cannot be excluded. Coverage gap: the research question named five languages but verified evidence covers only Glicol, Strudel, and (partially, historically) TidalCycles — nothing on Sonic Pi or FoxDot survived, so per-language comparison is incomplete; Sonic Pi's ~11k stars appears only as a passing verifier aside, unverified. Several negative claims are documentation-absence claims (e.g., no round-trip in strudel-flow, no offline render in glicol-cli) — weaker than positive demonstrations, and four related claims were refuted in verification precisely for over-broad negative framing (notably, Strudel's web REPL does have an export tab, so the verified gap is specifically headless/CLI rendering, not audio export generally). Demand signals are small-n: Tidal #410 is one requester with zero engagement (and its closure was likely administrative archival, not triage); Glicol #110 has ~6 participants; strudel-flow is a vendor tech demo (supply-side promotion). ableton-mcp stars measure attention, not confirmed production adoption.

## Open questions

- Sonic Pi and FoxDot were never covered by surviving evidence — do they have GUI surfaces, headless rendering, or community demand signals that change the comparison (Sonic Pi in particular is the largest community in this space by reputation)?
- What happened to Splice Studio (its DAW-project version-control feature) and comparable products (e.g., Blend, Audiomovers/Kits) — were they discontinued for lack of demand or for business reasons, and is there any usage data?
- Does the post-migration Codeberg Tidal/Strudel community (issues, Discord, club.tidalcycles.org forum) contain demand discussion for headless rendering or diffable project formats that the blocked Codeberg tracker hid from this research?
- Can quantitative algorave/live-coding community size be established from primary sources (TOPLAP membership, club.tidalcycles.org user counts, event counts over time) to replace the still-unverified 'producers-who-code market size' premise?

## Sources

- <https://github.com/chaosprint/glicol>
- <https://codeberg.org/uzu/strudel/pulls/1414>
- <https://github.com/tidalcycles/Tidal/issues/410>
- <https://strudel.cc/learn/pwa/>
- <https://creativecodingtech.com/music/live-coding/comparison/2024/10/22/sonic-pi-vs-tidalcycles-vs-strudel.html>
- <https://github.com/chaosprint/glicol/discussions/110>
- <https://github.com/xyflow/strudel-flow>
- <https://xyflow.com/labs/strudel-flow>
- <https://github.com/gruvw/strudel.nvim>
- <https://strudel.cc/>
- <https://news.ycombinator.com/item?id=39924210>
- <https://www.illmuzik.com/threads/daws-are-nice-but-have-you-ever-tried-live-coding-music.45405/>
- <https://github.com/ahujasid/ableton-mcp>
- <https://github.com/search?q=ableton+mcp+in%3Aname&type=repositories>
- <https://github.com/dschuler36/reaper-mcp-server>
- <https://splice.com/blog/studio-shutdown/>
- <https://news.ycombinator.com/item?id=14212691>
- <https://gearspace.com/board/ableton-live/835969-version-control-ableton-live.html>
- <https://uzu.lurk.org/t/the-state-of-tidalcycles-and-strudel/5522>
- <https://algorave.com/>

## What this means for dotbeat (our synthesis)

1. **The empty quadrant survives its third audit.** Every surveyed live-coding tool is
   code-only (no GUI editing surface), and none has first-class headless render-to-file. The
   round-trip trap is confirmed *unsolved everywhere* — the only working code↔GUI round-trip in
   the whole landscape is Strudel's single inline slider widget. Our M1 daemon already
   round-trips an entire project both directions; that is a genuinely differentiated position,
   now verified rather than asserted.
2. **The demand evidence is asymmetric, and we should build accordingly.** The strongest
   verified demand signal is for *agent control of music tools* (ableton-mcp ~2.8k stars,
   actively maintained) — which is the part of this project that already works (`beat mcp`).
   Demand for CLI/local workflows among live-coders is real but small (Glicol's community
   literally hand-built the missing local tooling; Strudel users puppet Chromium from Neovim
   because no headless engine exists). The broad "musicians want version control" case remains
   UNPROVEN beyond DAWproject #40 after three passes — the positioning should lead with
   agent-native + hackable-workflow value, and treat git-for-musicians as a bet, not a fact.
3. **Concrete corroborating patterns for our own choices:** Strudel's slider (value lives in
   the code text, GUI rewrites it) is exactly our knob→file mechanism generalized; Glicol
   shipping glicol-cli in response to a six-person thread shows maintainers in this space
   validate demand at small n — and that headless-Chromium-as-a-workaround (their 2022 hack,
   strudel.nvim's Puppeteer approach) keeps being independently reinvented, which is precisely
   the workflow our Phase 4 offline renderer just eliminated the browser from.
