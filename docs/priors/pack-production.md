# Prior mining: how commercial sample-pack loops are actually produced and mastered before shipping

Research method note: mid-task the session's WebSearch budget was exhausted (shared across ~14 parallel
mining agents). Everything below came from direct WebFetch of specific URLs (label pages, publication
articles, forum threads found via DuckDuckGo HTML search as a WebSearch substitute) rather than open web
search. Confidence is marked per claim: **[VERIFIED]** = fetched the primary source page directly and it
contained the claim; **[PUBLICATION]** = a named, real publication (MusicTech, Sound on Sound, etc.);
**[FORUM/SNIPPET]** = producer forum post or search-snippet only, not a full page fetch; **[UNVERIFIED —
LOW TRUST]** = a page that reads like AI-generated SEO/aggregator content, included only because it was
directionally plausible and internally consistent with other sources, but NOT to be treated as a real
label's actual policy.

---

## 1. Splice's own published quality standard (highest-relevance source — Splice loops are our benchmark)

Fetched directly, twice, for corroboration: `splice.com/blog/splice-sounds-quality-principles/` (also
reachable as `.../splice-sounds-quality-principles`) and `support.splice.com/en/articles/8652643-how-do-i-submit-my-own-samples-packs-to-sell-on-splice`.

**[VERIFIED] Key finding: Splice's public quality principles contain NO numeric audio specs at all.**
Their five stated principles are entirely about content/legal/editorial quality, not technical mastering:

1. **Originality/licensing** — verbatim: *"All content submitted to Splice Sounds becomes royalty-free for
   our subscribers, which means that it cannot be previously licensed in any way."* Content must not be
   "repackaged content from a previous pack." Providers must be able to prove source material (project
   files / session docs) and comply with all software/hardware EULAs.
2. **Technical platform support** — only vaguely stated: must meet "established technical guidelines
   regarding file formatting, file naming, folder structure, etc." — no numbers given in the public-facing
   article; presumably supplied privately to accepted creators.
3. **Descriptive & accurate labeling** — explicitly bans non-descriptive/loaded genre terms like "urban"
   and "world," and bans false claims (e.g. calling something "a legit pack from Drake" or "live
   Wurlitzer" when it isn't).
4. **Inclusive & respectful content** — will reject/edit content containing violence, nudity, profanity,
   promotion of illegal behavior, or "cultural insensitivity (language such as 'ethnic,' 'oriental,' or
   'tribal')," or discrimination based on protected characteristics.
5. **User-centric value** — desired attributes are qualitative: "original in concept," "aesthetically
   pleasing," "engaging," "adds value," "ignites inspiration," keeps creators "in their creative workflow."

**Takeaway for dotbeat**: Splice's own bar for "good" is stated almost entirely in editorial/curatorial
language (originality, taste, not-generic, not-derivative), not in a technical spec sheet. This is
important — it implies the actual technical bar is enforced by human A&R/QC judgment and internal
guidelines given only to accepted creators, not published. Any technical numbers below therefore come from
third parties reverse-engineering or reporting on practice, not from Splice's own public statement.

**[VERIFIED]** From `splice.com/blog/tips-for-creating-your-own-sample-pack/`:
- *"Most samples are released at 44.1 kHz or 48 kHz, 24-bit."* Recommendation for in-the-box production:
  *"start your project at 48 kHz and 24 bit."*
- Loop-point QC: *"Make sure that the start and end points loop perfectly, and make sure you apply fades to
  negate any pops and clicks."* — verify by literally looping the file in the DAW.
- Explicit ban on low-quality source: don't use "mp3s or lo-fi audio quality recordings."
- File naming convention example given: one-shots as `SamplePackName_Kick_key_x`, loops as
  `SamplePackName_SynthLoop_key_bpm` — i.e. **key and BPM are expected in the filename itself**, not just
  in metadata.
- Pack sizing convention mentioned: "small packs" ~50–150 samples, "larger packs" ~300–1000 samples.
- Emphasis that originality/non-genericness is "the most important aspect" — echoes principle #5 above.

---

## 2. Loudness / level / headroom numbers found

This is the weakest-sourced area — nobody publishes a hard LUFS spec for loops the way streaming platforms
publish one for masters. What I found:

**[PUBLICATION, musictech.com — real outlet, article "Tips on how to make your own sample pack"]**
This is the single most concrete, citable number I found for loop-specific delivery levels:
> *"One platform may require true peak levels of -6dB, while another may prefer samples limited to 0dB."*
> *"24-bit [is] a safe bet"* for bit depth; sample rate "either 48kHz or 44.1kHz depending on marketplace."
> QC step: *"run all samples through the same limiter"* to keep *"perceived loudness and true peak levels
> consistent"* across the whole pack.

Interpretation: **there is no single industry-wide numeric loudness target for shipped loops.** Instead the
convention that recurs is *internal consistency* — every loop in a pack should be limited/normalized to the
**same** perceived loudness and peak ceiling as every other loop in that pack, with the specific ceiling
varying by marketplace (examples given: -6 dBFS peak on one platform, 0 dBFS-safe limiting on another).
This is a materially different framing than "hit -14 LUFS" — it's about pack-internal uniformity, not an
absolute target.

**[UNVERIFIED — LOW TRUST, plugg-supply.net, reads like AI-generated aggregator content, NOT a real
Splice/label document]** — included only as a directionally-plausible secondary signal, treat every number
here with skepticism:
- "Kicks peaking 0 dBFS get rejected. Leave headroom; Splice may normalize."
- "Loudness: consistent within pack; avoid clipping." (this part at least agrees with the musictech
  consistency framing above)
- Loop length convention claimed: "4-bar loops common for house/trap; 1–2 bar loops for some drill perc"
- QC test claimed: "Solo loop for 16 bars — if phase click at bar 1 repeat, re-trim or crossfade"
- Mono-compatibility check claimed: "Many reviewers check mono collapse; fix with utility plugin"

**General streaming loudness numbers (NOT loop-specific, adjacent knowledge only — do not apply directly)**:
Multiple sources agree on the general streaming-mastering convention of **-14 LUFS integrated** and
**-1 dBTP true peak ceiling** (Spotify-style normalization target), with -9 to -11 LUFS sometimes cited as a
"club-loud" sweet spot for dance-genre full masters. This is the number set for *finished songs targeting
streaming platforms*, and multiple sources (MusicTech, general mastering guides) do NOT claim it transfers
to sample-pack loop delivery — I'm flagging this explicitly so it isn't miscited as a loop spec.

**Headroom convention (general mixing, cross-genre, high consensus but not loop-specific)**: the "-6dB
mixing" convention — leave roughly 6 dB of headroom on the mix bus before any mastering/limiting stage —
came up repeatedly and consistently across Reddit/forum snippets (r/edmproduction "Producing at -6db myth?",
r/ableton, r/TechnoProduction "-6db mix" threads). Representative quotes surfaced: *"Trying to keep my
mixes around -6dB helps me a lot to have a better final result. It leaves room for mastering,"* and *"The
-6dB is general advice providing a comfort margin so the mix doesn't clip."* This is general mix-headroom
advice, not a loop-shipping spec, but it's the same -6dB number that recurs in the musictech.com loop-peak
quote above, which suggests -6 dBFS peak is a genuinely load-bearing number in this world, appearing in both
the mixing-headroom convention AND the cited loop delivery convention.

---

## 3. Processing conventions — dry vs. wet, and the isolation-vs-mix tension (vein #4)

This is where cross-source consensus was actually strong, via a different mechanism than I expected: **the
industry doesn't solve the "sounds good solo AND sits in a mix" tension by picking one processing level —
it solves it by shipping BOTH versions side by side and letting the buyer choose.**

Independent, unrelated listings all show the same pattern (label pages / pack descriptions found via
search, each describing their own catalog — this is cross-source consensus on a *packaging convention*,
not one label's house style):

- **[SNIPPET]** Reveal Sound "Future Rave Revolution" construction kit: *"Wav Stems Sidechained & No
  Sidechained Versions"* — ships both a sidechained (mix-ready, pumping) and non-sidechained (raw) version
  of the same stems.
- **[SNIPPET]** Function Loops "Lokka Vox" vocal pack: *"Dry and Wet Vocal Loops, FX Vocal Chops and One
  Shots"* — dry version for buyer processing, wet version for instant use/audition.
- **[SNIPPET]** Stuck in Loops "Trance Edition": *"6 Construction Kits... Wet and Dry Stems."*
- **[SNIPPET]** A vocal pack listing: *"290+ vocal samples... Dry and wet versions of every vocal."*
- **[SNIPPET]** Florian Gouello (real producer, does packs commissioned by Splice — see below) describes
  his own drum-loop pack as shipping *"4 mix variations: Dry, Reverb, Cassette, and Ultra — ranging from
  clean and tight to warm, gritty, and bold."* This is the most granular version of the pattern: not just
  dry/wet but a *ladder* of processing intensity, letting the buyer pick how much character vs. flexibility
  they want.
- **[PUBLICATION, musictech.com]** confirms this is expected practice at the file-naming level: their
  example filename literally encodes a **"dry/wet indicator"** as a standard field —
  `VOX_SIRMA_90_vocal_stack_perfect_storm_lead_wet_Emin.wav` — meaning dry/wet is treated as a first-class,
  expected piece of metadata, not an edge case.

**Forum consensus on the "pre-processed loop" complaint [FORUM/SNIPPET, r/WeAreTheMusicMakers]**: producer
sentiment runs against over-processed drum loops specifically: *"Lots of sample packs have pre-compressed
drum samples, which is usually bad"* — the recommended buyer behavior is to seek out dry source material
and apply your own processing. This is the direct voice of the tension in vein #4: heavily-processed loops
audition well in isolation but fight the buyer's own mix bus compression/glue later. The pack-industry
response (per the dry/wet/multi-variant convention above) is clearly to not force a single answer — ship
the impressive wet version for the browse-and-buy moment, ship the dry/understated version for the
producer who's going to drop it into a full arrangement.

**[FORUM/SNIPPET, W.A. Production founder Roman Trachta, via producerloops.com Sample Spotlight
interview]** — a real, named producer's actual master-bus chain for his packs:
> *"ONLY OTT (default settings, 'Depth' knob set to 20-30%) and Fabfilter Pro-L limiter on my master
> channel. And that's it!"*

He explicitly caveats this is personal style, not a house standard: *"it could possibly be connected with
my production style and it might not work for everyone."* Useful as one concrete, named data point for "how
processed is a shipped loop" — a light multiband/OTT-style glue plus a transparent limiter, nothing more —
but treat it as one producer's practice, not consensus.

**Singomakers/REZONE label interview [FORUM/SNIPPET, loopmasters.com]**: confirms a workflow pattern where
different artists record in their own home studios but everything gets a final mix/master pass at one
central studio before release — *"all my artists have their own studios, so equipment is pretty different,
but in the end, we make mixing and mastering on our main Singomakers studio."* — i.e. a two-stage pipeline:
distributed creative production, centralized final QC/polish pass. No technical numbers given.

---

## 4. Technical specs consensus (sample rate / bit depth / naming / loop mechanics)

Cross-source agreement was strong and consistent here across Splice's own pages and MusicTech:

- **Sample rate**: 44.1 kHz or 48 kHz. [VERIFIED, Splice] + [PUBLICATION, MusicTech] agree.
- **Bit depth**: 24-bit is the standard/"safe bet." [VERIFIED, Splice] + [PUBLICATION, MusicTech] agree.
  16-bit / mp3 / "lo-fi" source explicitly called out as unacceptable.
- **File format**: WAV, PCM. One secondary source [UNVERIFIED — velveteen.fm, general distribution not
  loop-specific] claims distributors specifically want `WAVE_FORMAT_PCM` (code 0x0001) and reject the
  `WAVE_FORMAT_EXTENSIBLE` variant (0xFFFE) — plausible but not corroborated elsewhere, and that source was
  about song distribution to DSPs, not sample packs, so treat as low-confidence analogy at best.
- **Filename/metadata convention**: BPM and key are expected to be encoded directly in the filename, not
  just in embedded metadata. Two independent sources gave concrete filename templates:
  - Splice: `SamplePackName_Kick_key_x` (one-shots), `SamplePackName_SynthLoop_key_bpm` (loops)
  - MusicTech: `VOX_SIRMA_90_vocal_stack_perfect_storm_lead_wet_Emin.wav` (tempo → key → instrument → loop
    type → dry/wet flag → descriptive keywords, in that order)
- **Loop-point/fade convention**: universal and unambiguous across every source that touched it — loops
  must "loop perfectly" with matched start/end points, and short fades are applied specifically to kill
  clicks/pops at the seam, not for tonal shaping. This is a technical QC gate, not a stylistic choice.
- **Loop length/labeling convention [UNVERIFIED — LOW TRUST source only]**: 4-bar loops claimed as most
  common for house/trap, 1–2 bar loops for drill-style percussion. No corroboration found elsewhere, so
  treat as plausible but unconfirmed.

---

## 5. Top rejection / QC criteria (vein #6 — quality gates stated negatively)

Ranked by source confidence:

1. **[VERIFIED, Splice quality principles]** — non-original / previously-licensed / repackaged content.
   This is stated as the #1 gate, ahead of anything technical: *"Copyrighted content of any kind, or
   content from previously-released sound packs, is strictly prohibited."*
2. **[VERIFIED, Splice quality principles]** — misleading or non-descriptive labeling: banned terms like
   "urban"/"world" as genre descriptors, false claims of celebrity/instrument provenance (e.g. fake "legit
   pack from Drake" or fake "live Wurlitzer" claims).
3. **[PUBLICATION, MusicTech pre-delivery checklist]** — inconsistent perceived loudness/true-peak across
   the pack, wrong tempo/key vs. what's labeled, inconsistent file/folder naming. Their checklist, verbatim
   as a list: confirm audio specifications → test loops in DAW for correct tempo and key → check perceived
   loudness and true peak levels → review file/folder naming consistency → listen to the demo track →
   organize artwork/promo assets. Read negatively, each of these is a distinct rejection reason if it fails.
4. **[UNVERIFIED — LOW TRUST]** additional claimed rejection triggers, unconfirmed elsewhere: clipping/
   noise floor/bad loop points, recognizable melodies or suspicious/uncleared vocal content, missing key
   tag on musical (non-percussion) loops, an unfocused "mega-folder" with no sub-organization, trademark
   violations / misleading branding.

Only items 1–3 should be treated as reasonably solid; item 4 is a single low-trust source and should not be
cited as fact, only as a plausible hypothesis to sanity-check against better sources later.

---

## 6. Workflow: idea to shipped file (vein #1)

Weakly sourced overall — most producer interviews I could reach (Splice's own Oliver interview, the
Loopmasters/REZONE interview, the zplane/Matt Pelling interview) turned out to be light on production-line
detail and heavy on business/creative-philosophy framing. What did surface:

- **[FORUM/SNIPPET] Splice's Vintage Grooves pack**: commissioned work model — Splice's in-house
  A&R/production staff (their "Senior Producer," named in the snippet as John Smythe) directly commissions
  external producers to build packs to a creative brief (in this case, "classic disco sound"), rather than
  purely accepting unsolicited submissions. I was not able to fully fetch this article (floriangouello.com
  rate-limited every retry with HTTP 429), so I could not extract the granular workflow/gear/mastering
  details it likely contains. **This is a good lead for whoever runs this vein next or re-runs it later** —
  URL: `https://www.floriangouello.com/blogs/studio-stories/splice-vintage-grooves-making-that-classic-disco-sound`.
- **[FORUM/SNIPPET] Singomakers/REZONE**: distributed recording (artists in their own studios) →
  centralized mix/master pass at the label's main studio before release. Two-stage pipeline: creative
  freedom upstream, standardized technical polish downstream.
- **[PUBLICATION, Splice + MusicTech combined]** the closest thing to an explicit "idea to shipped file"
  sequence I could reconstruct from their tips articles: pick a genre/style you know → decide in-the-box vs.
  recorded/hybrid source → build at 48kHz/24-bit → design loops + one-shots as separate categories → name
  files with the full BPM/key/type/dry-wet convention → run the whole pack through a consistent limiter pass
  → loop-test every file in a DAW for click-free seams and correct tempo/key → package folders/artwork →
  submit.

---

## 7. What I could NOT verify (be aware of these gaps)

- No label's actual numeric technical-submission spec sheet (the private document Splice/Loopmasters give
  accepted creators) was found publicly — every official label page I reached (Loopmasters submission page,
  Black Octopus, Producer Loops, Sample Magic) either 404'd, timed out, or had no public guidelines page at
  all. This suggests these specs are genuinely not public, which is itself informative: **the technical bar
  is gatekept/verbal, the editorial/taste bar is what's published.**
  Direct Attack Magazine and Sound On Sound technique-archive browsing turned up mixing/mastering tutorials
  in general but nothing specifically about sample-pack production standards — I could not locate a
  dedicated SOS or Attack feature on this topic within the search budget available.
- Reddit could not be fetched at all in this environment (`www.reddit.com` and `old.reddit.com` both
  blocked at the tool level), so forum consensus above is limited to what DuckDuckGo's result snippets
  surfaced, not full comment threads — treat forum claims as suggestive, not exhaustively sourced.
- The Splice "Making of Vintage Grooves" article (best lead found for a real ground-truth production
  workflow) could not be fetched due to persistent HTTP 429 rate-limiting from that specific domain across
  four retries — worth a fresh attempt later, URL given above.

---

## Summary for the report-back

**Loudness/level numbers found**: no universal LUFS spec for loops exists publicly. The one concrete,
citable number pair is from MusicTech: **-6 dBFS true peak on some platforms vs. limited-to-0-dBFS on
others**, with the real emphasis being *pack-internal consistency* (run every loop in the pack through the
same limiter) rather than hitting an absolute number. General streaming-master conventions (-14 LUFS
integrated / -1 dBTP) showed up repeatedly but are for finished songs, not loops — don't conflate the two.
A -6dB headroom convention recurs independently in general mixing-forum advice, which at least makes -6 dB
a recurring, load-bearing number across this whole space even though it's not a formal loop spec.

**Top-3 rejection criteria**: (1) non-original/previously-licensed/repackaged content — Splice's own #1
stated gate; (2) misleading or non-descriptive labeling (fake provenance claims, vague genre terms); (3)
inconsistent perceived loudness/true peak, wrong tempo/key vs. label, or inconsistent naming across the
pack (MusicTech's checklist, read negatively).

**Do sources agree on how processed a shipped loop should be?** Yes, and the agreement is on a
packaging-level solution rather than a single processing target: ship **both** a wet/characterful version
(for the browse-and-audition moment) **and** a dry or lightly-processed version or stems (for actually
dropping into a mix) — confirmed independently across Reveal Sound, Function Loops, Stuck in Loops, a
generic vocal-pack listing, Florian Gouello's own 4-tier dry→reverb→cassette→ultra ladder, and MusicTech's
filename convention which treats a dry/wet flag as a standard, expected field. The one named producer who
gave a specific master-bus chain (W.A. Production's Roman Trachta: OTT at 20-30% depth + Fabfilter Pro-L)
described it as his personal style, not an industry standard, and forum sentiment pushes back against
heavily pre-compressed drum loops specifically as something producers actively want to avoid buying.
