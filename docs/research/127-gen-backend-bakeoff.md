# Research 127 — Gen-backend bake-off: can a leaderboard model beat Stable Audio 3 for 4-bar loops?

*Run 2026-07-24, prompted by the owner's question after blind showdown rounds put the fal/Stable
Audio 3 `gen` source level with commercial sample-pack loops: the Artificial Analysis instrumental
leaderboard ranks the Stability family near the bottom of 17 models, far below Suno/Mureka/Lyria —
so is a better hosted backend the cheapest big quality win, and do any of the leaders have workable
licenses? Method: parallel primary-source web pass — official API docs, pricing pages, and Terms of
Service fetched directly (four research agents + direct fal.ai model-page fetches), everything cited
with a URL and fetched **2026-07-24**. These pages churn fast (one provider was acquired and shut
down mid-research-window); re-verify before betting user-facing licensing copy on any clause here.
Confidence labels per claim: **confirmed** = primary source fetched (verbatim where quoted);
**single-source** = one secondary source, plausible, unverified; **inconclusive** = couldn't
establish. Companions: `docs/source-showdown-eval.md` (the eval machinery any new backend enters),
`docs/research/103-generative-audio-apis.md` (the 2026-07-14 licensing pass this updates —
several of its verdicts have since changed), `src/analysis/gen-fal.ts` (the integration surface).*

## Headline answers

1. **Yes, test — three leaderboard families are already ON fal.ai, so the marginal integration
   cost is a provider-param mapping, not a new backend.** fal hosts **Google Lyria 2 / Lyria 3 /
   Lyria 3 Pro**, the **MiniMax music family through v2.6**, and **ElevenLabs Music** as partner
   models, callable through the exact `fal.run/<provider>` POST `gen-fal.ts` already speaks.
   (High — model pages fetched.) §2.3, §2.4, §2.5, §4.2
2. **The leaderboard's #1 (Suno) and #9–12 (Producer.ai FUZZ) are not buildable-against at all.**
   Suno has **no official API** — only a partner-program intake form opened 2026-07-01, and its ToS
   bans using outputs to train any AI model; everything sold as a "Suno API" is an unofficial,
   ToS-violating wrapper. Producer.ai **no longer exists**: Google acquired the (ex-Riffusion) team
   ~Feb 2026 and relaunched it as Flow Music on Lyria 3 Pro, with no API. (High — primary fetches.)
   §2.1, §2.6
3. **Rights split cleanly into three tiers.** *Clean*: Google Lyria (you own outputs, paid tier
   never trains on your data, only a competing-model training restriction — a taste-preference
   model is arguably outside it) and the Stability baseline. *Usable-with-a-training-holdout-tag*:
   ElevenLabs (licensed training data — the best provenance in the field — but a categorical ban on
   using outputs "as input for any machine learning or training"), Mureka (you own outputs, but a
   broad ban on training *any* other ML model, plus an active training-data lawsuit). *Avoid*:
   Suno (no API + training ban + two majors still suing), MiniMax direct (API-tier terms
   unverifiable). (High on the quoted clauses; see per-provider caveats.) §3
4. **Loop-control fit is the field's weak axis — almost nobody does short clips.** Only two
   surfaces give real duration control near 4–8 s: **ElevenLabs Music** (`music_length_ms`, 3 s
   minimum) and **Lyria RealTime** (a continuous stream you capture 8 s of — plus the only *typed*
   BPM (60–200), key/scale enum, and seed in the field, free on the owner's existing
   GEMINI_API_KEY, but experimental and WebSocket-shaped). Everything else emits a fixed 30 s to
   ~5 min track you chop — which the showdown's duration-matching already does mechanically, at the
   cost of bar-boundary alignment. (High.) §2, §4.3
5. **All Google Lyria audio is SynthID-watermarked (inaudible, mandatory); MiniMax reserves the
   right to watermark; nobody else documents one.** Not a quality or usage blocker for loops
   embedded in a user's own music, but it should land in the provenance sidecar. (High for
   Google — confirmed verbatim; medium elsewhere.) §3
6. **Trial picks: `fal-ai/lyria2`, `fal-ai/minimax-music/v2.6`, `fal-ai/elevenlabs/music` —
   in that order of rights-cleanliness, entering the existing showdown as three new gen variants.**
   A 30-loop round on all three plus the SA-3 baseline is ≈ **$33** (ElevenLabs' round-up billing
   is $24 of that; a 10-loops-each screen is ≈ $11). Verdict rule: a backend is adopted as the new
   `FAL_DEFAULT_PROVIDER` only if it beats SA-3 gen clips head-to-head in blind pairwise at the
   showdown's own smoke threshold. (Medium — design proposal; the blind eval decides.) §4
7. **Honest caveat: the leaderboard measures full-song Elo, not 4-bar-loop quality, and our
   baseline isn't even on it.** The ranked Stability entry is Stable Audio 2.0 (Elo 958); dotbeat
   runs SA-**3 medium**, which already ties commercial packs in the owner's blind ratings. Short
   isolated instrumental loops are much closer to Stable Audio's training distribution
   (samples/loops) than to Suno's (songs) — the leaderboard gap may shrink or invert at our clip
   shape. That is exactly why this is a bake-off and not a swap. (High confidence in the caveat
   itself.) §1

---

## §1 The leaderboard, verified (fetched 2026-07-24)

[artificialanalysis.ai/music/leaderboard/instrumental](https://artificialanalysis.ai/music/leaderboard/instrumental)
(“blind user votes in the Music Arena”; no last-updated date shown) — **confirmed**:

| # | Model | Creator | Elo |
|---|-------|---------|-----|
| 1 | Suno V5.5 | Suno | 1190 |
| 2 | Mureka V8 | Mureka | 1167 |
| 3 | Suno V5 | Suno | 1159 |
| 4 | Lyria 3 Pro | Google | 1119 |
| 5 | Suno V4.5 | Suno | 1085 |
| 6 | Music 2.6 | MiniMax | 1069 |
| 7 | Eleven Music v2 | ElevenLabs | 1064 |
| 8 | MiniMax Music 2.5+ | MiniMax | 1053 |
| 9 | FUZZ-1.1 Pro | Producer.ai | 1038 |
| 10 | Eleven Music | ElevenLabs | 1031 |
| 11–12 | FUZZ-2.0 Raw / FUZZ-2.0 | Producer.ai | 1028 / 1021 |
| 13 | Lyria 2 | Google | 1000 |
| 14 | **Stable Audio 2.0** | Stability.ai | 958 |
| 15–17 | Udio v1.5 / Sonauto V2.1 / MusicGen | — | 955 / 937 / 866 |

**Reading it honestly.** (a) The arena rates *full tracks* on open prompts; dotbeat needs 8-second
single-instrument loops at a target BPM/key — a different task where arrangement/vocal/structure
skill (Suno's edge) counts for nothing and timbre-per-second is everything. (b) The Stability entry
is **2.0**; dotbeat's default is **`fal-ai/stable-audio-3/medium`** (1.4 B params, licensed data),
which is not ranked — the true gap from our baseline is unknown and smaller than 232 Elo.
(c) FUZZ's producer-oriented positioning suggested it might punch above its rank on loop-shaped
material — moot now, since it no longer exists as an addressable vendor (§2.6). The leaderboard is
a *shortlist generator*, not a verdict; the showdown's blind pairwise is the verdict.

## §2 Per-provider verification

### §2.1 Suno — no API, and a ToS training ban. Out.

- **API**: **none.** On **2026-07-01** Suno's CPO announced it is *"beginning to explore a
  developer API, starting with a curated group of partners"* — a Typeform intake, no docs, no
  pricing, no launch date (**confirmed** — [MBW](https://www.musicbusinessworldwide.com/suno-explores-developer-api-seeking-apps-that-unlock-experiences-generative-music-makes-possible-for-the-first-time/);
  suno.com/api redirects to marketing, fetched). Everything sold as a "Suno API" (sunoapi.org,
  apibox, gcui-art/suno-api) is an unofficial reverse-engineered wrapper that violates Suno's own
  anti-scraping terms and documents no duration/BPM/key/seed params (**confirmed** —
  docs.sunoapi.org fetched).
- **Pricing** (consumer product): Free 50 credits/day non-commercial; Pro $10/mo (~500 songs);
  Premier $30/mo (~2,000 songs + Suno Studio) — **confirmed** (suno.com + help.suno.com).
- **Loop controls**: no duration control (full songs to ~8 min), no seed anywhere, BPM/key by
  prompt only and known-unreliable ("wobbly BPM" — single-source). Instrumental toggle: yes.
  Stems: up to 12 time-aligned WAV stems on paid tiers (**confirmed**) — product-side only.
- **Rights** (suno.com/terms, rev. 2026-03-26, fetched — **confirmed verbatim**): paid tiers get
  an assignment — *"Suno hereby assigns to you all of its right, title and interest in and to any
  Output"*; free tier is personal/non-commercial with attribution. **Training ban**: users may not
  use *"the Services (and any Output or Voice Model) to create, develop or improve any competing
  products or services or to power, enable or train other artificial intelligence and machine
  learning models"* — applies to outputs on every tier. Watermark: no ToS clause; third-party
  vendors claim an inaudible fingerprint (**inconclusive**).
- **Provenance**: sued by the three majors June 2024. **Warner settled Nov 2025** with a licensing
  deal; **UMG and Sony remain active** — claims moved (May 2026) to expand to ~61,000 recordings,
  potential statutory damages >$9 B (**confirmed** settlement / **single-source** case tracking).
- **fal**: not hosted (**confirmed** — zero matches on fal.ai/models).

**Verdict: not testable** (no API), and even via a wrapper the training ban plus two live
major-label suits make it the worst rights posture in the field.

### §2.2 Mureka (Skywork AI Pte. Ltd. / Kunlun Tech) — real API, clean ownership, broad training ban, live lawsuit

- **API**: **GA** — REST at `api.mureka.ai`, Bearer key, async task model, with a **dedicated
  instrumental endpoint**: `POST /v1/instrumental/generate` + `GET /v1/instrumental/query/{id}`
  (**confirmed** — [platform.mureka.ai/docs](https://platform.mureka.ai/docs/)). Also song gen,
  **stem separation** (`/v1/song/stem`, billed separately), extension, remix. Docs headline V7.5 +
  O1; aggregator WaveSpeed exposes V8/V9/O2 BGM endpoints (**single-source** for those versions).
- **Pricing**: official pricing page is JS-rendered and wouldn't fetch (**inconclusive** from
  primary); prepaid credits, 12-month expiry (**confirmed**, FAQ). Third-party: ~$0.03–0.05/track
  (WaveSpeed resells V7.5 BGM at $0.03 — **confirmed** on WaveSpeed).
- **Loop controls**: instrumental-only mode **yes** (dedicated endpoint). **No duration, BPM, key,
  or seed parameters found** — prompt text only; expect full-length BGM you trim (the official
  operation page's schema didn't render — **inconclusive** whether hidden params exist). Stems
  export **yes**.
- **Rights** (API Service Agreement PDF, 2025-12-03, fetched in full — **confirmed verbatim**):
  §3.2 *"you… own all Output. We hereby assign to you all our right, title, and interest, if any,
  in and to Output"*; paid API calls carry *"full usage rights and commercial authorization"*
  (FAQ). §3.5: outputs *"may not be unique."* **Training ban, §2(f) — broader than anyone
  else's**: you may not *"use the Services or any output from the Services for model retraining or
  development… to train, develop, optimize, or create **any other machine learning models**."*
  That is not scoped to competing models — it reaches dotbeat's taste critic. No attribution; no
  watermark clause (**inconclusive**). Governing law **Singapore**, SIAC arbitration. Notable:
  §10.1 Mureka indemnifies IP claims *"including training data we use to train a model"*
  (conditional).
- **Provenance**: no licensed-data claims; **active lawsuit** *Attack the Sound LLC v. Kunlun
  Tech* (N.D. Ill., Dec 2025) alleging training on copyrighted recordings and false "royalty-free"
  marketing (**confirmed** — complaint fetched). Allegations, not findings.
- **fal**: **not hosted** (**confirmed**); on WaveSpeed/eachlabs/302.AI + an unofficial
  useapi.net wrapper.

**Verdict: testable but deferred** — #2 Elo and a real instrumental endpoint, but no fal path
(a new backend module + new key), an any-ML training ban (every clip needs the training-holdout
tag), a live provenance suit, and Singapore-law terms. Re-visit if the fal-hosted trio disappoints.

### §2.3 Google Lyria — three surfaces, the cleanest rights, mandatory SynthID

**Landscape shift since research/103**: Lyria 3 (Feb 2026) and Lyria 3 Pro (Mar 2026) are in
**public preview on Vertex AI and the Gemini API** (**confirmed** —
[Google Cloud blog, 2026-04-07](https://cloud.google.com/blog/products/ai-machine-learning/lyria-3-and-lyria-3-pro-on-vertex-ai)) —
the leaderboard's "Lyria 3 Pro" is a real API model, not just a Flow Music/Sandbox toy.

- **Surface A — Lyria RealTime (Gemini API, `models/lyria-realtime-exp`)**: **experimental**, a
  persistent bidirectional **WebSocket** (`client.aio.live.music.connect()`, `google-genai`
  v1alpha) streaming raw **16-bit 48 kHz stereo PCM** you capture any window of (**confirmed** —
  [ai.google.dev docs](https://ai.google.dev/gemini-api/docs/music-generation)). **The only typed
  loop controls in the field**: `bpm` int 60–200, `scale` enum (12 circle-of-fifths values),
  `seed`, `guidance`/`density`/`brightness`/`temperature`, `mute_bass`/`mute_drums`/
  `only_bass_and_drums`. *"The model generates instrumental music only"* (verbatim). Pricing: not
  on the pricing page; usable free at experimental limits (**inconclusive** when billing starts).
  Caveat: as an unpaid service, *"Google uses the content you submit… and any generated responses
  to provide, improve, and develop Google products and services and machine learning
  technologies"* (**confirmed verbatim**, [terms](https://ai.google.dev/gemini-api/terms)) — fine
  for genre-prompt loops, worth knowing.
- **Surface B — batch models**: `lyria-002` **GA** on Vertex (REST `:predict`; `prompt`,
  `negative_prompt`, `seed`, `sample_count` — *"Use either seed or sample_count"*, mutually
  exclusive; ~30 s (max 32.8 s) **48 kHz WAV**; **instrumental-only, vocal prompts rejected**;
  needs a GCP project + OAuth, **a GEMINI_API_KEY does not call Vertex**) — **confirmed** from the
  model card. `lyria-3-clip-preview` (30 s, 44.1 kHz MP3, vocals + lyrics tags or instrumental
  mode, prompt-level BPM, **no seed/negative_prompt**) and `lyria-3-pro-preview` (to 184 s) are
  **Preview** on Vertex and the Gemini API (paid tier only — *"Free tier: not available"*); a
  forum thread suggests allowlist friction (**single-source**).
- **Pricing** (**confirmed**, Vertex + Gemini pricing pages): Lyria 2 **$0.06/30 s** ($1.80/clip
  equivalent per the card's per-second framing — the two agents' readings differed; the pricing
  page's operative line is "$0.06 per 30 seconds"… flagged **inconclusive between $0.06 and
  $1.80 per 30 s clip on Vertex**); Lyria 3 **$0.04/30 s clip**; Lyria 3 Pro **$0.08/song (≤3
  min)**. **On fal (the path that matters here): `fal-ai/lyria2` = $0.10 per 30 s WAV clip,
  `fal-ai/lyria3` (30 s MP3), `fal-ai/lyria3/pro` ($0.08, ≤3 min MP3)** — all **confirmed** via
  fal model pages; fal's lyria2 schema is `prompt` + `negative_prompt` + `seed` (fixed 30 s);
  fal's lyria3 schemas are `prompt` + `negative_prompt` + `image_url` (**no seed, no duration, no
  instrumental flag** — prompt-level only).
- **Rights** (**confirmed verbatim**, Gemini API terms + Cloud terms): *"Google won't claim
  ownership over that content"*; commercial use permitted; **paid tier**: *"Google doesn't use
  your prompts… or responses to improve our products."* Training restriction is
  competing-models-only: *"You may not use the Services to develop models that compete with the
  Services"* — a small internal taste-preference model arguably doesn't compete (not legal advice;
  tagging costs nothing). No attribution requirement. **SynthID watermark mandatory on all Lyria
  audio**: *"All generated audio includes a SynthID audio watermark… imperceptible to the human
  ear"* (**confirmed verbatim**; oddly the lyria-002 card's feature matrix says "Audio
  watermarking: Not supported" — **inconclusive** for that one model, assume watermarked).
  **Indemnity: Lyria is NOT on Google's generative-AI indemnified-services list**
  (list fetched, last modified 2026-07-20 — **confirmed**).
- **Provenance**: trained on *"materials YouTube and Google have the legal right to use"* (Cloud
  blog — posture confirmed, dataset undisclosed); YouTube Music AI Incubator partnerships.

**Verdict: the strongest overall candidate family.** Cleanest rights, instrumental-by-design
(Lyria 2), seed support, WAV, and two of three surfaces need zero new accounts (fal key covers
lyria2/lyria3; GEMINI_API_KEY covers RealTime).

### §2.4 MiniMax Music — real API and on fal, but API-tier rights unverifiable

- **API**: **GA** — `POST https://api.minimax.io/v1/music_generation` (**confirmed** —
  [platform.minimax.io docs](https://platform.minimax.io/docs/api-reference/music-generation)).
  Current models **music-3.0** / **music-2.6** (+ free 3-RPM variants). Params: `prompt` (style),
  `lyrics` (structure tags), **`is_instrumental`** (true = no lyrics needed — **confirmed**),
  `sample_rate` to 44.1 kHz, `format` mp3/**wav**/pcm, `stream`. **No duration, BPM, key, or seed
  params** — output up to ~5 min, typically 2:30–4:30 (single-source); trim to loop.
- **Pricing**: **$0.15/generation** for music-3.0/2.6 (single-source; official price page
  unfetchable). **On fal: `fal-ai/minimax-music/v2.6` = $0.15 per audio, with `is_instrumental`,
  `lyrics_optimizer`, and `audio_setting` (44.1 kHz WAV available)** — **confirmed** via fal API
  page; older `fal-ai/minimax-music` ($0.035) and `/v2` ($0.03) also live.
- **Rights**: the Open Platform ToS (the document that governs API outputs) is a JS SPA that
  returned no text — **could not be quoted; inconclusive.** Adjacent confirmed documents: the
  consumer Music Creation Terms require *"clearly labeling AI-generated Output Content"* and state
  *"We may embed identifiers or watermarks in such content"* (**confirmed**); paid-tier
  "users retain all intellectual property rights… including commercial purposes" appears only in
  Agent-subscription terms (**single-source**, unverified for the music API). Singapore law
  (single-source). **Verify the platform ToS in a real browser before relying on any of this.**
- **Provenance**: no licensed-data claims; defendant in *Disney v. MiniMax* (2025) over
  **video/image** outputs — no music-specific suit found.
- **fal**: hosted (above) — and note **fal's own ToS** adds, for all partner models: outputs of
  third-party materials may not be used to *"train any artificial intelligence or machine learning
  algorithms or models"* **that compete with those materials** (fetched, **confirmed** — the
  training clause is scoped to competing products; a taste critic is arguably outside it).
- **Verdict: testable now via fal** (#6 Elo, instrumental flag, WAV out, $0.15) — with an honest
  "rights-unverified" label and training-holdout tagging until the platform ToS is read.

### §2.5 ElevenLabs Music — best provenance, real duration control, hard training ban, priciest per loop

- **API**: **GA** — `POST https://api.elevenlabs.io/v1/music` (**confirmed** — API ref fetched):
  `prompt` or `composition_plan`, **`music_length_ms` 3,000–600,000** (3 s–10 min — the only true
  4–8 s duration control in the field), `model_id` (`music_v1`/`music_v2`), `seed` (*"not
  guaranteed across updates"*), **`force_instrumental`**, `output_format` (MP3/**PCM**/Opus),
  optional `sign_with_c2pa`.
- **Pricing**: direct API — conflicting reports ($0.15–0.40/min; help page 403'd —
  **inconclusive**); platform plans bill from the credit pool (Starter $6 → Creator $22 → Pro
  $99…). **On fal: `fal-ai/elevenlabs/music` = "$0.8 per output audio minute. The audio will be
  rounded up to the closest minute"** (**confirmed verbatim**) — so **every 8 s loop bills as
  $0.80** on fal. fal's schema: same `music_length_ms` 3 s floor + `force_instrumental` +
  `composition_plan`.
- **Loop controls**: duration ✅ (3 s min), instrumental ✅, seed ✅ (weak), BPM/key prompt-only
  (fal's own guide cites "120 BPM synthwave" as working — single-source), no stems in the API.
- **Rights** (**confirmed verbatim**, precedence per music-terms: Model-Specific Terms > Service
  Terms > main agreement): main ToS §4(c)(ii): *"you retain all rights in and to your Output"*;
  commercial rights per-plan via a "Music Commercial Rights table" (contents unfetched — secondary
  sources: Free = non-commercial, Starter+ = commercial — **single-source**). Free-tier credit
  required: *"'Created in collaboration with ElevenLabs'"* (Model-Specific Terms §5(a), verbatim).
  **Training ban (Prohibited Use Policy, verbatim)**: no *"Using any part of our Services or their
  Output as input for any machine learning or training of artificial intelligence models"* nor
  *"as part of a dataset that may be used for training, fine-tuning, developing, testing, or
  improving any machine learning or artificial intelligence technology."* Categorical — the taste
  critic can't legally see these clips: **training-holdout tag mandatory.** Outputs
  **non-exclusive** (*"may be similar or identical to Output returned to other users"*). Prompt
  restriction: no real artist/songwriter names in prompts. No mandatory watermark (C2PA optional).
- **Provenance**: launched Aug 2025 **with opt-in licensing deals (Merlin, Kobalt; 50/50 revenue
  splits)** — the best-documented licensed-data posture of any ranked model; no major-label deal
  yet (**confirmed** — MBW/Billboard).
- **fal**: hosted (**confirmed**, partner model).
- **Verdict: testable now via fal** — the only backend that can natively emit an 8 s clip, with
  the cleanest provenance story, priced ~21× the baseline per loop and hard-banned from the
  training set.

### §2.6 Producer.ai / FUZZ — acquired by Google; no longer exists as a vendor

Producer.ai was the **Riffusion** team rebranded (Aug 2025; FUZZ-2.0 Oct 2025, invite-only).
**Google acquired the company ~2026-02-24** (team into Google Labs/DeepMind — single-source but
multiply corroborated); **producer.ai now 301-redirects to flowmusic.app** (**confirmed** by
direct fetch), relaunched ~2026-04-18 as **Google Flow Music, powered by Lyria 3 Pro**. There was
never an official FUZZ API; there is no Flow Music API; "Producer APIs" on musicapi.ai etc. are
unofficial resellers, one of which admits legacy FUZZ calls are *"silently aliased to Lyria 3
Pro"* (single-source). FUZZ training data was never disclosed. **The leaderboard's FUZZ rows are
historical; the "producer-oriented model punches above its rank for loops" hypothesis now
resolves to: test Lyria 3 Pro.** Flow Music's stems-export feature (drums/bass/melody/vocals/FX —
multiply-sourced) is platform-only, rights **inconclusive** (Flow ToS 403'd).

### §2.7 Baseline — Stability Stable Audio 3 / 2.5 via fal (what a challenger must beat)

`fal-ai/stable-audio-3/medium/text-to-audio`: **$0.0376/generation** (**confirmed**, model page),
up to 6-min stereo, *"trained on fully licensed data for safe commercial use"* (fal page,
confirmed as marketing claim), duration param honored (`duration` — see the gen-fal.ts header
comment for the silent-ignore trap), seed, WAV on request — **the only backend in this doc with
real 8-second duration control at sample-pack prices**, outputs owned under the Stability
Community License posture research/103 confirmed for the family (<$1 M revenue; the hosted-2.5
platform-terms caveat from 103 still stands for `fal-ai/stable-audio-25` at $0.20/gen —
**unresolved**, we default to SA-3). Blind showdown standing: gen ties commercial sample-pack
loops in the owner's ratings. Cheap, controllable, rights-boring — the incumbent is genuinely
hard to beat *as a loop tool*, whatever the full-song Elo says.

## §3 Rights scoreboard

| Backend | Own outputs / commercial | Train taste model on outputs? | Watermark | Provenance risk | API today |
|---|---|---|---|---|---|
| **Stable Audio 3 (fal)** — baseline | ✅ paid, Community-License posture | ✅ no ban found | none | low (licensed-data claim) | ✅ GA (in prod) |
| **Google Lyria 2/3 (fal, Vertex, Gemini)** | ✅ Google claims no ownership; paid tier no data reuse | ⚠️ competing-models clause only — arguably fine; **tag anyway** | **SynthID, mandatory** | low (YouTube/licensed posture; no indemnity) | ✅ GA (L2) / preview (L3) |
| **ElevenLabs Music (fal or direct)** | ✅ paid (free = credit + non-comm.) | ❌ **categorical ban — holdout tag mandatory** | optional C2PA | **lowest** (Merlin/Kobalt deals) | ✅ GA |
| **MiniMax music-2.6/3.0 (fal or direct)** | ⚠️ likely paid-tier yes — **API ToS unverifiable** | ⚠️ unknown (fal pass-through: competing only) | reserved right | medium (Disney suit, video-side) | ✅ GA |
| **Mureka V7.5–V9** | ✅ assigned to you, paid | ❌ **bans training *any* ML model — holdout tag** | not mentioned | high (active training-data suit) | ✅ GA (no fal) |
| **Suno V5.5** | ✅ paid (product only) | ❌ banned | undocumented | **highest** (UMG+Sony live, >$9 B claim) | ❌ none |
| **Producer.ai FUZZ** | — vendor no longer exists (→ Google Flow Music, no API) | — | — | undisclosed | ❌ none |

*(The training-ban column is a **tag, not a blocker**: dotbeat's existing training-holdout
mechanism excludes tagged clips from the taste model's training set while still letting the owner
rate them.)*

## §4 The bake-off

### §4.1 Design — three new gen variants through the unchanged showdown

Same machinery, same blindness: `beat showdown` rounds where the **gen source's fal provider
varies per clip** instead of always being SA-3. Per role (bassline/chords/lead/drum-loop), per
round, the batch carries one gen clip per backend under trial **plus one SA-3 gen clip** (the
head-to-head that decides), same phrase-tier prompt (`src/taste/seeds.ts` PHRASE_VARIANTS — 4-bar
subjects with the BPM hint), same seeded style pick, then the standard prep → duration-match →
LUFS-match pipeline. The batch manifest already records per-clip provenance including the fal
provider (`GenMeta.provider` flows through `genSourceBatch`'s sidecar), so `beat showdown
--report` can split gen-vs-gen by provider forever. Composed sources (engine/keymap/surge) ride
along as usual — no change to them.

### §4.2 Integration deltas (small, honest list)

- **`--gen-provider` passthrough**: `runGenFal` and `genSourceBatch` already take `provider`;
  the showdown/taste-collect CLI only exposes `--gen-backend`. One flag + threading. For
  multi-provider batches, a `--gen-providers a,b,c` round-robin (or one round per provider).
- **Per-provider param mapping in `gen-fal.ts`**: the current body is
  `{prompt, duration|seconds_total, seed, output_format:'wav'}`. Needed: **lyria2** →
  `{prompt, seed, negative_prompt}` (no duration — fixed 30 s; unknown fields may 422, the
  existing retry only swaps the duration alias); **minimax v2.6** →
  `{prompt, is_instrumental:true, audio_setting:{format:'wav',sample_rate:44100}}` (no
  duration/seed); **elevenlabs/music** → `{prompt, music_length_ms: seconds*1000,
  force_instrumental:true}`. A small `providerBody(provider, opts)` table keeps the 422 safety
  net. `extractAudioUrl` already handles the response shapes.
- **30 s+ outputs → 8 s loops**: the showdown's duration-matcher already trims-with-fade to the
  batch's shortest clip, but it trims from the head — for full-track outputs (MiniMax) the head
  may be an intro. Cheapest robust fix: trim gen downloads to the **first detected-downbeat-aligned
  4 bars at the prompted BPM** using the existing beatthis sidecar (already wired for ref-clip BPM
  detection); fallback = first 8 s. Do this in prep, before loudness matching.
- **MP3 decode**: fal's lyria3/minimax default outputs are MP3; prep decodes MP3 via
  `node-web-audio-api` where present (gen-fal.ts note) — request WAV where the schema allows
  (minimax yes, lyria2 yes-native, lyria3 no).
- **Provenance sidecar**: record provider + `watermark: "synthid"` for Lyria clips and
  `trainingHoldout: true` for ElevenLabs (and Mureka, if ever used) clips.

### §4.3 Trial picks (quality-potential × rights × loop-fit × integration)

1. **`fal-ai/lyria2`** — cleanest rights in the field, instrumental-by-design, seed, native
   48 kHz WAV, $0.10/clip, zero new accounts. Elo +42 over ranked SA-2.0 is modest, but it's the
   best *controlled* probe of whether Google timbre beats Stability timbre at our clip shape. If
   it wins, `fal-ai/lyria3` ($0.04-class, #4-family quality, MP3/no-seed) is the follow-on, and
   **Lyria RealTime** (typed BPM 60–200 + key enum + seed + free on the existing GEMINI_API_KEY)
   is the phase-2 integration that makes Lyria the *better loop tool*, not just a better timbre.
2. **`fal-ai/minimax-music/v2.6`** — highest-Elo model reachable through fal (#6, 1069),
   `is_instrumental`, WAV out, $0.15/gen. Carries the "API rights unverified" label and a
   training-holdout tag until the platform ToS is actually read; a quality win here justifies
   that ToS errand, a loss closes the question free of it.
3. **`fal-ai/elevenlabs/music`** — the only native 8 s generation (`music_length_ms`),
   `force_instrumental`, licensed-data provenance. $0.80/loop on fal is trial-only economics
   (direct API pricing may be ~2–5× better — inconclusive); mandatory training-holdout tag.
   Include it because duration control + provenance make it the best *product* fit if quality
   lands — and its two leaderboard entries (#7, #10) sit above everything else testable.

**Deferred**: Mureka (no fal path, any-ML training ban, live suit — revisit only if all three
above lose), Lyria RealTime (phase-2, gated on a Lyria 2/3 win), Suno/FUZZ (not buildable).

### §4.4 Costs (30 loops per backend; ~8 s clips)

| Backend | Per loop | 30-loop round |
|---|---|---|
| SA-3 baseline | $0.0376 | $1.13 |
| fal-ai/lyria2 | $0.10 | $3.00 |
| fal-ai/minimax-music/v2.6 | $0.15 | $4.50 |
| fal-ai/elevenlabs/music | **$0.80** (round-up billing) | $24.00 |
| **Full round, all four** | | **≈ $33** |

A cheaper first screen: 10 loops per challenger + baseline ≈ **$11**. Rating cost dominates
anyway — 30 loops/backend ≈ 8+ additional showdown batches of owner listening time.

### §4.5 Owner errands

- **None required to start**: `FAL_KEY` (already set) covers all three trial backends; the
  existing `GEMINI_API_KEY` covers the deferred Lyria RealTime path. No Vertex/GCP project needed
  unless we outgrow fal.
- **Optional, before adopting ElevenLabs**: open an elevenlabs.io account (key
  `ELEVENLABS_API_KEY`, console at elevenlabs.io → Developers) and compare direct per-minute
  billing against fal's $0.80 round-up; also fetch the "Music Commercial Rights table" from the
  logged-in pricing page (the one rights document we couldn't read).
- **Optional, before adopting MiniMax**: open platform.minimax.io in a real browser and read the
  Open Platform ToS (the JS SPA our fetches couldn't render) — the single gating unknown for that
  backend.

### §4.6 Verdict criteria (decided before listening)

- **Adopt a challenger as `FAL_DEFAULT_PROVIDER`** only if it beats the SA-3 gen clip in blind
  pairwise **>60% overall, and in ≥2 of 4 roles individually**, at the showdown's own smoke
  threshold (≥5 batches per role — `SPLIT_SMOKE_MIN_BATCHES`), while not losing to commercial
  sample packs where SA-3 currently ties them.
- **Per-role adoption is allowed**: a backend that wins drum-loops but loses basslines becomes
  that role's provider (the manifest/scores split supports this forever).
- **Control adherence is a co-criterion**: measure detected BPM (beatthis sidecar) and key
  (pitch analysis) against the prompt across the round; a backend that wins on timbre but ignores
  the BPM hint >±3 bpm in more than a third of clips fails the loop-tool bar regardless of Elo.
- **Cost gate**: at equal blind quality, cheaper wins; ElevenLabs must beat SA-3 *decisively*
  (its per-loop price is 21×) or its adoption case is duration-control-only.

## Open questions / honest gaps

1. **MiniMax Open Platform ToS unread** (JS SPA) — the API-tier output-rights language is the one
   document standing between "trial" and "adopt" for the #6 model. Browser errand, 10 minutes.
2. **ElevenLabs "Music Commercial Rights table" unread** (login-gated) and direct-API music
   pricing conflicting ($0.15–0.40/min reports vs fal's $0.80 round-up) — resolve before any
   adoption decision, irrelevant for the trial.
3. **Vertex Lyria 2 price ambiguity** ($0.06 per 30 s vs per second readings of the same pricing
   page) — moot while we use fal's $0.10/clip, resolve only if we outgrow fal.
4. **lyria-002 watermark contradiction** (model card feature-matrix says "Not supported"; Google's
   blanket statement says all Lyria audio is SynthID-watermarked) — assume watermarked; verify
   with the SynthID Detector portal on a trial clip if it ever matters.
5. **Leaderboard-to-loop transfer is the whole bet** — no public benchmark measures 4-bar
   single-instrument loop quality; the showdown round IS the benchmark. Also unverified: whether
   fal's Lyria/MiniMax/ElevenLabs "Partner" hosting passes through each provider's own output
   terms or substitutes fal's (fal's ToS says third-party materials "may be subject to additional
   terms" — we treated provider terms as controlling, the conservative read).
6. **Suno's API partner program** — worth a free Typeform application despite the rights verdict?
   No: the training ban + live litigation means its clips could never feed the taste loop and its
   provenance risk is the field's worst. Re-check only if UMG/Sony settle with licensing terms
   like Warner's.
7. **All ToS quotes are as-of 2026-07-24** — this field re-wrote itself twice during the two
   weeks before this pass (Producer.ai acquisition/relaunch; Suno partner-API announcement).
   Re-fetch the operative clause before shipping any user-facing licensing copy.

## Sources (all fetched 2026-07-24)

- Artificial Analysis instrumental leaderboard — artificialanalysis.ai/music/leaderboard/instrumental
- fal.ai model + API pages: fal-ai/lyria2, fal-ai/lyria3, fal-ai/lyria3/pro,
  fal-ai/minimax-music (+ /v2, /v2.5, /v2.6), fal-ai/elevenlabs/music,
  fal-ai/stable-audio-3/medium/text-to-audio, fal-ai/stable-audio-25/text-to-audio; fal.ai/terms
- Suno: suno.com/terms (rev. 2026-03-26), suno.com landing/help center, MBW + Digital Music News
  (API partner program, Warner settlement), docs.sunoapi.org (unofficial wrapper, for the record)
- Mureka: platform.mureka.ai/docs + service_terms.pdf (API Service Agreement, 2025-12-03, full
  read), platform FAQ; WaveSpeed model pages; *Attack the Sound v. Kunlun* complaint PDF
- Google: ai.google.dev/gemini-api/docs/music-generation + /terms + pricing;
  cloud.google.com Vertex Lyria model cards (lyria-002, lyria-3), Vertex pricing,
  generative-ai-indemnified-services (mod. 2026-07-20); Cloud blog "Lyria 3 and Lyria 3 Pro on
  Vertex AI" (2026-04-07)
- MiniMax: platform.minimax.io/docs/api-reference/music-generation; minimax.io Music Creation
  Terms; secondary pricing (minimax-ai.chat, puter.dev) — platform ToS unfetchable (SPA)
- ElevenLabs: elevenlabs.io/docs API reference (music/compose), terms-of-use, music-terms,
  eleven-music-model-specific-terms, use-policy (all fetched); MBW/Billboard (Merlin/Kobalt deals)
- Producer.ai → Flow Music: producer.ai 301 redirect (verified), Crunchbase/musically (acquisition,
  single-source), flowmusic.app coverage (site 403'd)
