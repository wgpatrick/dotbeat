# Research 120 — high-quality eval refs: replacing Demucs chops with pro role-isolated audio

*2026-07-22. Web-research pass for the showdown/taste evals (`docs/source-showdown-eval.md`,
research 119). PROBLEM: the current ref pool is Demucs-separated stems of commercial tracks, and
the owner reports they "often just sound noisy and not quite right" — separation artifacts both
degrade the ceiling the eval measures against and make refs recognizable in a blind batch. Wanted:
genuinely commercial-production-standard role-isolated audio (basslines, chord/synth parts, leads,
drum loops) in the house / melodic house / deep house / electronica lane (Dom Dolla, Lane 8,
Four Tet, Keinemusik, Fred again.., Disclosure adjacent), preferably NOT from the owner's favorite
tracks (recognition bias). Confidence labels: **high** = read on the vendor's own page/license;
**medium** = consistent secondary sources or a search-result summary of the vendor page; **low** =
single or informal source.*

## Headline

**Professional sample-pack loops are the answer, and they are cheap.** Commercial house sample
packs are *natively role-isolated* — the standard pack layout is literally folders named Bass
Loops / Music Loops / Synth Loops / Drum Loops / Top Loops — produced to release standard by
label sound-design teams (Toolroom, Defected, Sample Magic), tempo-labeled in the filename, sold
royalty-free, and by construction **not anyone's favorite track**, so recognition bias is zero.
One month of Splice Creator (**$19.99, 200 credits = 200 hand-picked loops**) or one Loopmasters
bundle (**$62 for ~1,000 loops** including 190 bass + 256 music + 167 full drum loops) fills a
100-200-clip pool this week. Remix-contest stems and multitrack libraries are worse fits (see §2,
§3): contest stems are scarce in-genre and often vanish when contests close; free multitracks are
raw unmixed tracking, i.e. *below* commercial production standard by design.

---

## 1. Professional sample-pack loops as eval refs

### Why the format fits exactly

A house sample pack's folder structure maps 1:1 onto the showdown's roles:

| showdown role | pack folder convention | example counts (real packs, below) |
|---|---|---|
| bassline | Bass Loops | Defected/Rizardo: 22; Ultimate Deep House: 190 |
| chords | Music Loops (chords/pads/stabs), Synth/Chord Loops | Rizardo: 41 music loops; UDH: 256 |
| lead | Synth Loops / Lead Loops / melodic Music Loops | Toolroom Tech House: 10 synth loops |
| drum-loop | (Full) Drum Loops — **not** "Top Loops" (tops = drums minus kick) | Rizardo: 21 kick + 25 top; UDH: 167 full drum loops |

Loops are 24-bit WAV, produced *through* a finished production chain (the exact width/air/glue
axes the engine measured as its loss in the 21-batch feature-mining pass), and tempo-labeled — most
pack contents cluster at 118-128 BPM, squarely in the house lane. One curation caveat: "Music
Loops" folders mix chord parts and melodic parts, so filling the chords-vs-lead split takes a
listen-and-sort pass, not just a folder copy.

### The services

- **Splice** (splice.com) — subscription with per-sound credits. Current plans: Sounds+
  **100 credits/mo** ($12.99/mo), Creator **200 credits/mo** ($19.99/mo), Creator+ 500/mo;
  every sample costs 1 credit; unused credits roll over while subscribed; **the license to
  downloaded sounds is perpetual after cancellation** (high — Splice plans FAQ + licensing FAQ:
  https://support.splice.com/en/articles/8652592-splice-plans-faq,
  https://support.splice.com/en/articles/8652642-splice-sounds-licensing-faq; prices medium —
  https://splice.com/plans via search summary, https://subger.com/en/us/service/splice).
  The win over buying packs outright: per-loop cherry-picking across *every* label's packs —
  200 credits spent across 15 packs beats 3 whole packs for pool diversity.
- **Loopmasters** (loopmasters.com) — per-pack purchase, the deepest house/deep-house catalog,
  and the distributor for label packs (Toolroom, Defected). Owned by Beatport;
  **Beatport Sounds** (sounds.beatport.com) carries largely the same label catalog (medium).
- **Loopcloud** (loopcloud.com) — Loopmasters' subscription twin: Artist $7.99/100 points,
  Studio $11.99/300, Professional $21.99/600, same 4M-sound library, points roll over up to 36
  months (medium — https://www.loopcloud.com/cloud/subscriptions/plans via search summary).
  Gap: I did not verify the points-per-loop rate (Splice is flat 1 credit/sample; Loopcloud
  sounds may cost variable points), so the effective cost per loop is unconfirmed.
- **ADSR Sounds** (adsrsounds.com) — per-pack store, "100% royalty-free" across categories
  (medium — https://www.adsrsounds.com/genre/edm/); carries Black Octopus and similar vendors.
  Nothing here is unavailable via Splice/Loopmasters; useful mainly for sales.
- **Black Octopus Sound** (blackoctopus-sound.com) — vendor with strong melodic-house titles,
  sold direct and via Loopmasters/ADSR/Splice; also gives away a free 1GB sampler
  (https://blackoctopus-sound.com/product/free-1gb-of-black-octopus-samples/) — a zero-cost way
  to smoke-test the whole refs-packs mechanic before spending (license of the free pack
  unverified — low).

### Concrete packs in the target lane (all found by name)

- **Defected House Samples by Franky Rizardo** (Defected × Loopmasters) — modern deep house;
  205 24-bit WAVs: **22 bass loops, 41 music loops**, 21 kick loops, 25 top loops, 10 hat loops
  (medium — https://www.loopmasters.com/genres/25-House/products/4743-Defected-Franky-Rizardo).
  Also **Defected House by Copyright** (600MB: drum loops, bass loops, chord stabs;
  https://www.loopmasters.com/genres/25-House/products/3799-Defected-House-Copyright) and
  **Defected House Samples by Sample Magic on Splice**
  (https://splice.com/sounds/packs/sample-magic/defected-house-samples).
- **Toolroom label packs** — Toolroom Samples 01-05 series, **Toolroom Tech House** (25 bass
  loops, 10 synth loops, 10 kick loops, 14 top loops;
  https://www.loopmasters.com/genres/66-Tech-House/products/12047-Toolroom-Tech-House),
  Toolroom Academy Underground House & Tech (670MB). Sold at ~£19.99/pack via Toolroom Academy
  (medium — https://toolroomacademy.com/shop/sample-packs/), and as a label on Splice
  (https://splice.com/sounds/labels/toolroom-records) and Beatport Sounds. This is the
  Dom-Dolla-adjacent tech-house end of the target.
- **Loopmasters Ultimate Deep House** (bundle) — **$62**, 2.43GB, 24-bit: **190 bass loops,
  167 full drum loops, 256 music loops**, 96 top loops, 42 perc loops, plus one-shots; 118-126
  BPM (high — fetched https://www.pluginboutique.com/product/99-Sample-Packs/128-House-Deep-House/2119-Loopmasters-Ultimate-Deep-House).
  A single purchase that over-fills the whole pool, at the cost of one vendor's sound.
- **Melodic Deep House by Bound To Divide** (Black Octopus) — **$30.45**: 40 bass loops,
  40 drum loops, 40 music loops + one-shots/MIDI (high — fetched
  https://www.loopmasters.com/genres/50-Deep-House/products/8045-Melodic-Deep-House). The
  Lane 8 / melodic end. Sibling: **Warm Melodic House**
  (https://www.producerloops.com/Download-Black-Octopus-Sound-Warm-Melodic-House-.html).
- **Splice melodic/deep house packs** (per-loop via credits): Sample Magic **Deep Melodic
  House** (540 samples; https://splice.com/sounds/packs/sample-magic/deep-melodic-house) and
  **Melodic House**, Zenhiser **Melodic Deep House** (541 samples), Dropgun **Melodic Deep
  House** (514), Freshly Squeezed **Organic Deep House Essentials**
  (https://splice.com/sounds/packs/freshly-squeezed-samples/organic-deep-house-essentials/samples);
  genre browse pages: https://splice.com/sounds/genres/melodic-house/packs,
  https://splice.com/sounds/genres/deep-house/packs.
- **Keinemusik Werkzeug II by Rampa** — the label's own official sample pack: 618 files,
  1.22GB, 24-bit WAV, loops at 123 BPM (medium — https://keinemusik.com/new-samplepack-out-now/,
  https://soundcloud.com/keinemusik/werkzeug-sample-pack-by-rampa). Scene-authentic (an actual
  target-list artist making the sounds) without being a chart track. Price/availability on the
  Keinemusik shop unverified (gap); Slooply also lists Keinemusik samples
  (https://slooply.com/samples/category/keinemusik).

### Licensing — is eval use unambiguous?

**Yes for the eval itself (high confidence).** Both major licenses grant *more* than the eval
needs: Splice — use/reuse/remix in any production including commercial, perpetual after
cancellation; prohibited only: redistributing sounds as samples/loops, sublicensing in isolation
(https://support.splice.com/en/articles/8652642-splice-sounds-licensing-faq). Loopmasters —
royalty-free use in commercial releases "with no conditions"; prohibited only: reselling as
samples or in a commercial instrument, and using sounds *in isolation* in a commercially
released project (https://help.loopmasters.com/hc/en-us/articles/7718315377044,
https://help.loopmasters.com/hc/en-us/articles/7718328554772-Loopmasters-License-Agreement).
A private, never-distributed blind listening batch distributes nothing and releases nothing —
it is far inside both licenses. The "isolation" clauses target *commercial release* of bare
loops, not private playback.

**Two real caveats:**

1. **Splice's AI clause.** "Use of content downloaded from Splice for the purposes of
   training/modeling data for AI is not permitted by our Terms of Use" (high — verbatim from
   the licensing FAQ). The taste program logs a DSP feature vector for every scored clip and
   plans to train a taste model on those logs. Whether "features + owner ratings of a clip"
   constitutes "training data for AI" is arguable — it is not audio and not generative — but it
   is not obviously outside the clause either. Mitigation options, cheapest first: (a) keep
   Splice-sourced clips kind-only in the scores log like refs already are, and exclude the
   `ref`-kind feature vectors from any model-training data mix (a one-line filter — the log
   already tags source kind); (b) prefer Loopmasters for the pool — its license agreement as
   read contains no AI clause (**medium — I did not exhaustively read the current agreement for
   a recently added AI term; verify before training on pack-derived features**).
2. **Still no repo commits.** Royalty-free ≠ redistributable: raw loops in a public repo is
   exactly the prohibited "distributing as samples." The existing ref machinery already handles
   this (per-batch `.gitignore`, kind-only scores log) — keep the pack pool under
   `~/Documents/dotbeat/taste-dataset/` like everything else and change nothing.

### Cost for a 100-200-loop pool

| path | cost | what you get |
|---|---|---|
| Splice Creator, 1 month, cancel | **$19.99** | 200 cherry-picked loops across all labels/packs; license survives cancellation |
| Splice Sounds+, 2 months | $25.98 | 200 loops, slower drip |
| Loopmasters Ultimate Deep House | $62 | ~1,000 loops, one vendor's deep-house sound |
| Melodic Deep House + one Toolroom pack | ~$56 | ~240 loops, two curated sounds |
| Loopcloud Artist 1-2 mo | $8-16 | 100-200 points; points-per-loop rate unverified |

## 2. Official remix-contest stem packs

- **SKIO Music** (skiomusic.com) — the main standing platform; free account, per-contest
  "Download Stems" button (high — https://skiomusic.com/faq/remix-contests/how-do-i-download-the-stems-for-a-remix-contest/).
  EDM-leaning; has hosted target-adjacent artists (a **Lane 8 "Diamonds" remix stem pack** page
  exists: https://skiomusic.com/wishlist/lane-8-diamonds-original-mix/ — a *wishlist* entry, so
  availability is not guaranteed; low). **Whether stems remain downloadable after a contest
  closes is not documented** — the FAQ covers active contests only (checked; gap). Contest
  terms invariably license stems for creating the contest entry, not general reuse — a private
  eval is low-risk in practice but *not* the licensed purpose, unlike sample packs.
- **LANDR Challenges** — host artist provides stems, fan-vote + host judging (medium —
  https://blog.landr.com/remix-contest/). Sporadic; no evidence of a current house contest.
- **Metapop (Native Instruments)** — the historically richest source (700 challenges, stems
  from Flume, Jacques Greene, etc.) but **shut down 2023-04-30** (high —
  https://vi-control.net/community/threads/metapop-being-closed-down-as-of-end-of-april-2023.138701/).
  Old packs are gone from official channels.
- **Directories**: RemixComps.io (https://remixcomps.io/) and LabelRadar's contest hub
  (https://greenroom.beatport.com/labels/labelradar/remix) aggregate live contests — worth a
  weekly glance for an in-genre contest, not a this-week plan.
- **Artist-posted official stems**: Fred again.. publicly released stems for **"Jungle"**
  (co-produced by Four Tet) via social media in 2022 (medium —
  https://en.wikipedia.org/wiki/Jungle_(Fred_Again_song); mirrors on stem-sharing sites like
  clubremixer.com/songstems.net are **unofficial redistribution — treat like the private chops,
  or skip**). Note these are precisely the owner's favorite artists, i.e. the recognition-bias
  case the owner wants to avoid.

**Verdict**: contest stems are a bonus channel, not the plan — supply is thin in-genre this
week, persistence after close is undocumented, terms are contest-scoped, and full-mix stems
still need chopping to 4-bar role clips (unlike loops, which arrive eval-shaped).

## 3. Purchasable official stems / multitracks

- **Cambridge Music Technology 'Mixing Secrets' library** — 500+ free multitrack projects, with
  an Electronica/Dance/Experimental genre section; 24/16-bit 44.1kHz WAV (high —
  https://cambridge-mt.com/ms/mtk/, search at https://multitracksearch.cambridge-mt.com/ms-mtk-search.htm).
  Two disqualifiers for THIS eval: (1) tracks are deliberately provided **raw — unprocessed
  tracking, pre-mix** ("every effort to provide audio 'raw'") because the library exists for
  mixing practice, so the stems are *below* commercial production standard by design — the
  opposite of what the ref slot needs; (2) content is largely unsigned/semi-pro artists, so
  "commercial release quality" is not guaranteed even post-mix. License is
  educational-use-only, which a private eval satisfies. Useful someday for research 119's
  complement-generation tasks (real paired stems, better than Demucs separations of the same
  material); not for the ceiling slot.
- **Native Instruments Stems format (.stem.mp4)** — the 4-stem DJ format Beatport/Traxsource/
  Juno adopted in 2015; adoption stalled and it survives only as a Traktor-niche catalog
  (medium — https://www.digitaldjtips.com/beatport-pro-can-now-play-stems-files/,
  https://www.stems-music.com/stems-is-for-djs/). Also technically wrong for the eval: stems
  are **lossy AAC** inside the MP4, and 4 coarse stems (drums/bass/melody/vocal) of a full
  track — some catalog exists in-genre but per-track cost is high and quality is below a WAV
  loop. Skip.
- **Traxsource / Beatport DJ-tools stems** — both stores intermittently sell artist/label stem
  packs as ordinary releases (medium — https://djbooth.net/pro-audio/the-best-places-to-find-stems-for-your-set/,
  https://www.gemtracks.com/resources/guides/view.php?title=top-website-to-buy-music-stems&id=5913).
  Real but sparse and search-hostile; per-track pricing.
- **Bandcamp** — some electronic artists sell official stem packs directly (tag page:
  https://bandcamp.com/discover/stems; e.g. Psymbionic's album stems
  https://psymbionic.bandcamp.com/album/song-stems). Legitimately licensed, artist-supported,
  and usually NOT owner-favorite material — a genuine but slow channel: in-genre supply must be
  hunted release by release.
- **Stem-sharing sites** (songstems.net, clubremixer.com) — free, large, in-genre, and
  **unlicensed redistribution** except where the artist posted stems officially. If ever used,
  they get the full private-chop posture; better to just not.

## 4. Fit to the eval pipeline

Near-zero integration work — the ref slot already takes "a directory of wavs":

- **Drop-in**: `taste-dataset/refs-packs/<role>/*.wav` (bassline / chords / lead / drum-loop),
  private like the rest of the dataset dir; `beat showdown ~/showdown --ref-dir
  ~/Documents/dotbeat/taste-dataset/refs-packs` works today — the `<ref-dir>/<role>/` scoping
  already exists.
- **Provenance split**: a third pool (`refs-packs`) alongside the existing familiar/unfamiliar
  chop pools keeps "pro loop" refs distinguishable from "commercial chop" refs in the report,
  so the ceiling's provenance is never ambiguous. Worth a small addition: record the pool name
  (not the pack/filename) in the scores log the way `figureSource` is recorded, so the split
  survives batch-dir deletion. Until then the batch manifest's origin path carries it locally.
- **BPM matching gets easier**: loops arrive tempo-labeled in the filename (`..._125bpm_...`),
  and most are dead-on-grid — the beatthis sidecar detection still runs (the pipeline keys off
  detected tempo), but detection on a gridded loop is far more reliable than on a Demucs stem
  with bleed. Many filenames carry key labels too — free metadata if key-matching ever joins
  tempo-matching.
- **Length**: house loops are typically 2/4/8 bars; the batch's duration-match (trim-with-fade
  / zero-pad) already conforms whatever it picks; 4-bar-and-longer loops are ideal.
- **Curation pass required** (the one real task): sort "Music Loops" into chords vs lead by
  ear, and exclude loops with heavy vocal content or FX-only content. Budget an hour or two
  for a 150-loop pool.
- **Posture**: purchased loops are licensed, but keep the existing ref treatment anyway
  (private dir, per-batch `.gitignore`, kind-only in the scores log) — it costs nothing, it's
  already built, and it covers the Splice-AI-clause mitigation (§1) for free.

## 5. Recommendation: cheapest path to 100+ clips this week

**Do: one month of Splice Creator — $19.99, cancel after downloading.** 200 credits = 200
loops, cherry-picked per-loop across every label on the platform, perpetual license, all four
roles, tempo-labeled 24-bit WAV. Shopping list for the session (~50 bass / ~50 chords-ish
music / ~30 lead-ish synth / ~50 full drum loops, ~20 spare credits):

1. Toolroom Records label packs — https://splice.com/sounds/labels/toolroom-records (tech-house
   bass + drums; the Dom Dolla end)
2. Sample Magic **Defected House Samples** + **Deep Melodic House** —
   https://splice.com/sounds/packs/sample-magic/defected-house-samples,
   https://splice.com/sounds/packs/sample-magic/deep-melodic-house
3. Zenhiser **Melodic Deep House** — https://splice.com/sounds/packs/zenhiser/melodic-deep-house-zenhiser
   (the Lane 8 end)
4. Dropgun **Melodic Deep House**, Freshly Squeezed **Organic Deep House Essentials** (Four
   Tet-ish organic textures) — per-loop from the genre browse pages
   (https://splice.com/sounds/genres/deep-house/packs)

**Alternative (no subscription, more bulk, one sound)**: Loopmasters **Ultimate Deep House**,
$62 — ~1,000 loops in one purchase, over-fills every role; add the $30.45 Black Octopus
**Melodic Deep House** if the melodic end feels thin. **Optional flavor add-on**: Keinemusik
**Werkzeug II** (price unverified) for scene-authentic percussion/texture.

**Don't**: buy .stem.mp4 stems (lossy, coarse), build on Cambridge MT for the ceiling slot
(raw-by-design), or pull from stem-sharing sites (unlicensed).

**Expected total: $20 (Splice month) — worst case ~$92 (Loopmasters bundle + Black Octopus) if
the subscription route is unwanted.**

## Open questions / gaps

1. Loopcloud's points-per-loop rate (whether $7.99/100 points really means 100 loops).
2. Whether the current Loopmasters license agreement has grown an AI-training clause —
   **verify before any model trains on pack-derived feature vectors**; and decide whether the
   taste model's DSP-feature training data even falls under Splice's AI clause (conservative:
   filter ref-kind rows out of the training mix — they're tagged already).
3. SKIO stem availability after contest close (undocumented; ask support if the channel ever
   matters).
4. Keinemusik Werkzeug II current price/storefront.
5. The Black Octopus free 1GB sampler's exact license terms (would make a $0 pilot pool).
