# Research pass 103 — Generative-audio APIs: can generated chops/SFX legally ship inside a user's `.beat` project?

*Run 2026-07-14 for Phase 37 Stream RE. Manual web pass — WebSearch plus direct GitHub license
fetches — NOT the 3-vote adversarial harness (passes 01-09), so confidence is labeled per claim:
**confirmed** = primary source fetched directly, or a verbatim primary quote returned by search, or
2+ independent sources agree; **single-source** = one secondary source, plausible, unverified;
**inconclusive** = couldn't establish.*

***Infrastructure caveat (load-bearing for this pass):*** *this session's egress proxy denied CONNECT
(403, org policy) to **every** vendor domain that matters — `elevenlabs.io`, `stability.ai`,
`platform.stability.ai`, `huggingface.co`, `replicate.com`, `ai.meta.com`, plus third-party analysis
sites (`terms.law`, `licenseorg.com`, `undetectr.com`). Only `github.com` /
`raw.githubusercontent.com` were reachable. So the **only verbatim-primary** license text in this doc
is Meta AudioCraft's (fetched from GitHub). Everything about ElevenLabs and Stability terms/pricing
comes from **WebSearch summaries that quote the primary pages** — treated as confirmed only where the
search returned a verbatim clause or two independent summaries agreed, otherwise single-source. This
mirrors pass 102's arxiv-blocked caveat. Before betting product decisions on a specific ElevenLabs or
Stability clause, re-fetch the primary page from an unrestricted network.*

## Headline

**For dotbeat's actual thesis — a `.beat` + `media/` folder the user owns and may commit to a public
git repo — the leading generative option (ElevenLabs) is a licensing dealbreaker, and the leading
open model (Meta MusicGen/AudioGen) is non-commercial.** ElevenLabs' Sound Effects product
*explicitly* forbids distributing outputs "on a standalone basis ... as isolated files, audio samples
... or other collections of sounds" — which is a precise description of what a committed `media/`
folder of generated chops **is**. Meta's AudioCraft weights are CC-BY-NC 4.0. The one
licensing-clean, fit-for-purpose, egress-free generative path is **Stable Audio Open 1.0 run locally**
(you own the outputs, commercial use permitted under $1M revenue, no per-file attribution on outputs,
strong at exactly the short SFX/one-shot/riff material dotbeat wants) — but it costs a full
Python/PyTorch/GPU sidecar to integrate, the same plumbing pass 102 already deferred to Phase 38.
**Recommendation: do not build ElevenLabs; ship RD's Freesound-CC0 path as the near-term sound
source, and gate any generative build on the pass-102 sidecar landing, then add
`beat source gen` on Stable Audio Open.**

## 1. Licensing — the load-bearing question

### ElevenLabs — dealbreaker for the shareable-project thesis (per product)

- **Sound Effects product — the trap, stated plainly** *(confirmed: verbatim clause returned from
  `elevenlabs.io/use-policy`)*. The Prohibited Use Policy forbids: *"Selling, reselling, renting,
  leasing, loaning, assigning, distributing, performing, licensing, sublicensing or commercially
  using or exploiting any Output (or any portion thereof) generated using our Sound Effects product
  on a standalone basis for any purpose, including as isolated files, audio samples, music or sound,
  libraries, or other collections of sounds."* The intent is clearly "you may embed an SFX inside a
  finished video/song, but you may not ship the SFX *as* the deliverable (a sample pack)." dotbeat's
  `media/` folder is exactly the ambiguous middle: the chops *are* used inside a composition (the
  `.beat` arrangement references them), **but** they also sit in the repo as isolated, individually
  re-downloadable `.wav` files — "a collection of sounds" that anyone cloning the public repo can
  lift. That is squarely in the prohibited zone. **Verdict: not viable** for committing
  ElevenLabs-SFX output into a public, shareable `.beat` project.
- **Music product** *(confirmed via 2 agreeing summaries of `elevenlabs.io/music-terms`)*:
  "redistributing, reselling, sublicensing, or claiming ownership of the music is not permitted."
  Wrong shape anyway (full songs, not chops) and redistribution-prohibited. **Not viable.**
- **Text-to-Speech / Voice product** *(confirmed: 2+ summaries agree)*: on a **paid** plan you own the
  output and may use it commercially with no attribution; ElevenLabs retains a perpetual license to
  use your content to train/improve models, and outputs "may not be unique across users." The
  standalone-file prohibition above is scoped to the *Sound Effects* product, so a TTS/voice clip is
  contractually freer — **but** (a) TTS produces speech, a poor fit for musical vowel one-shots /
  vocal chops, and (b) committing raw TTS `.wav`s to a public repo as reusable files re-raises the
  same "standalone files" spirit even if that exact clause is SFX-scoped, and (c) voice-identity/IP
  concerns attach to cloned or designed voices. **Inconclusive/not recommended** as a chop source.
- **Plan tiers** *(confirmed: 2+ summaries agree)*: **Free plan = no commercial rights + mandatory
  "elevenlabs.io" attribution.** Commercial use needs a paid plan (Starter $5/mo and up). So even
  setting aside the standalone-file trap, the free tier can't be used commercially at all.

### Meta AudioCraft (MusicGen / AudioGen) — non-commercial weights *(confirmed: LICENSE files fetched
directly from GitHub)*

`facebookresearch/audiocraft`: **code is MIT** (`LICENSE`), but **model weights are CC-BY-NC 4.0**
(`LICENSE_weights`, "Attribution-NonCommercial 4.0 International"). Same weight-license trap pass 102
flagged for madmom. AudioGen is Meta's text-to-**sound-effect** model and MusicGen its
text-to-music model — either could produce short elements and both run **locally** (no egress), but
the NonCommercial weight license contradicts dotbeat's MIT posture and the "a user may sell or
publicly share their project" thesis. **Not viable** for redistributable/commercial output.

### Stability AI — the clean path (with conditions)

- **Stable Audio Open 1.0 (open weights, self-hostable)** *(confirmed: 2+ agreeing summaries of
  `stability.ai/license` + the model card; primary LICENSE.md on HF was egress-blocked)*. Governed by
  the **Stability AI Community License**: research, non-commercial, **and commercial** use permitted
  for individuals/orgs under **$1M annual revenue**, no fee (registration with Stability required for
  commercial use); the license **terminates above $1M**, where an Enterprise license is needed.
  Crucially: *"You own any outputs generated from the Models ... to the extent permitted by applicable
  law,"* and *"There will be no restrictions on the number of media files ... created."* The
  license's redistribution/attribution obligations ("provide a copy of this Agreement," a "Notice"
  file, display **"Powered by Stability AI"**) attach to distributing the **Materials/Derivative
  Works** (i.e. the *model*), **not** to distributing generated **output files** — outputs are
  separately owned. One relevant restriction: outputs may not be used to train/improve a competing
  foundational model (irrelevant to dotbeat). **Verdict: viable and clean** for a hobbyist musician
  (well under $1M) to generate locally, own the chops, and commit them to a public repo. The
  "Powered by Stability AI" attribution is a **dotbeat-integration** obligation (the tool wraps the
  model), not a per-`.wav` obligation on the user.
- **Hosted Stable Audio (stableaudio.com) & the developer platform API (Stable Audio 2.5)**
  *(mixed)*: the consumer platform grants commercial use on paid tiers with output ownership, free
  tier non-commercial; a third-party review flags a "distribution catch" I **could not read** (source
  egress-blocked) — **inconclusive** whether the hosted terms carry an ElevenLabs-style standalone-file
  restriction. The developer platform (`platform.stability.ai`, Stable Audio 2.5) is a REST API but its
  per-call output/redistribution terms were not verifiable this pass. **Treat hosted output rights as
  unconfirmed**; the *local* Community-License path is the one I can stand behind.

### Full-song generators (Suno / Udio) — categorically wrong shape *(confirmed: 2+ summaries agree)*

Noted only to close them out: **Udio** disabled all downloads and stems (Oct 2025 UMG settlement) —
streaming-only, nothing to redistribute. **Suno** retains ownership on free plans, grants commercial
release on Pro/Premier but as *finished songs*. Both produce full tracks, not chops, and neither fits
"own the file and commit it." Not candidates.

**Licensing scoreboard (fit with MIT dotbeat's shareable-`.beat` thesis):**

| Provider / product | Redistributable inside a public `.beat`? | Why |
|---|---|---|
| Stable Audio Open 1.0 (local) | **Yes** (under $1M rev, register for commercial) | own outputs; attribution is on the *model*, not output files — *confirmed via 2 summaries* |
| ElevenLabs — Sound Effects | **No** | Prohibited: distributing output as "isolated files, audio samples ... collections of sounds" — *confirmed verbatim* |
| ElevenLabs — Music | **No** | redistribution/resale of the music prohibited — *confirmed* |
| ElevenLabs — Voice/TTS (paid) | Gray zone, poor fit | own output, but speech not chops; standalone-file spirit re-raised — *inconclusive* |
| Meta MusicGen / AudioGen (local) | **No** | weights CC-BY-NC 4.0 — *confirmed (LICENSE fetched)* |
| Hosted Stable Audio API (2.5) | **Unknown** | possible "distribution catch," terms egress-blocked — *inconclusive* |
| Suno / Udio | **No** | full songs; downloads disabled / ownership retained — *confirmed* |

**Copyright posture, stated plainly:** two separate axes. (1) *Contractual* redistribution rights —
the table above; this is what governs whether a user may legally commit the file. (2) *Copyrightability*
of AI-generated audio — under the prevailing US Copyright Office stance, purely machine-generated
output is generally **not** copyrightable. For dotbeat that actually *helps* the "freely shareable"
angle (no third party holds a copyright in a clean-provider chop) while meaning the user can't stop
others copying it — an acceptable trade for a shareable-project tool. The dealbreaker is axis (1), not
axis (2): ElevenLabs' contract forbids the redistribution regardless of copyrightability.

## 2. Fit for the use case (short musical elements)

- **Stable Audio Open 1.0** *(confirmed: 2+ summaries + model card)*: variable length **up to ~47s**,
  **stereo 44.1 kHz**, and the model card / reporting explicitly position it as *stronger at sound
  effects, field recordings, drum beats, instrument riffs, foley, and "other audio samples for music
  production and sound design" than at full music* — i.e. **exactly** dotbeat's target (vocal chops,
  one-shots, risers, impacts, textures). Prompt-to-result control is text-prompt + duration + seed;
  quality is "good enough for sound design," not pristine. Best-fit generative model found.
- **ElevenLabs Sound Effects** *(confirmed)*: purpose-built text-to-SFX, up to **30s**, per-generation
  or duration-controlled; good controllability for SFX/impacts/risers. Fit is fine; **licensing is the
  blocker, not quality.**
- **Stable Audio 2.5 (hosted)** *(single-source)*: up to 3 min, audio-to-audio + inpainting, stronger
  rhythm/melody — overkill for chops and hosted-terms-unconfirmed.
- **Meta AudioGen** *(single-source)*: text-to-SFX, short clips — fit ok, license blocks it.

## 3. Cost

- **Stable Audio Open (local):** **zero marginal cost** (own GPU/CPU + electricity), zero egress.
  One-time ~model download (a couple GB). *(confirmed: local inference via `stable-audio-tools`.)*
- **ElevenLabs Sound Effects** *(confirmed: 2+ summaries)*: **$0.12 / minute** on API pricing; in
  credits, **200 credits per generation** (auto-duration) or **40 credits/sec** if you set duration
  (max 30s), **billed per generation** (not per character). A 1-2s vocal chop is well under a cent of
  audio; a session of ~50 chops is pennies to well under $1. **Cheap — cost is not the obstacle.**
- **Hosted Stable Audio 2.5 API** *(single-source)*: credits at **1 credit = $0.01**; text-to-audio /
  audio-to-audio **20 credits/generation = $0.20 each**, regardless of length; 25 free credits to
  start; $10 per 1,000-credit top-up. ~50 generations ≈ $10 — pricier per-gen than ElevenLabs but
  full-length outputs.

## 4. Network / integration reality

- **ElevenLabs** *(confirmed)*: REST + WebSocket, **API-key auth** (`xi-api-key` header), **official
  Node.js SDK**. Clean to wire from Node — **except** `elevenlabs.io` is **egress-blocked by this
  environment's org proxy** (CONNECT 403), so it can't even be built/tested here, and any dotbeat
  environment behind a similar proxy would fail at runtime. Flag loudly.
- **Stability developer platform (hosted 2.5)** *(confirmed reachability)*: REST + API key, Node-callable
  — but `platform.stability.ai` is **also egress-blocked** here.
- **Stable Audio Open (local)** *(confirmed)*: Python `stable-audio-tools` + PyTorch, model from HF,
  `torch.float16` on a consumer CUDA GPU (exact VRAM **single-source/unverified**; CPU fallback
  unproven). **Runs entirely locally → no runtime egress at all** — the only option immune to the
  proxy. Integration shape = a Python child-process sidecar emitting a `.wav`, i.e. **the same
  sidecar plumbing pass 102 recommended for `beat analyze` and Phase 37 deferred to Phase 38.**
- **Meta AudioCraft** *(confirmed)*: also local Python/PyTorch; license blocks it regardless.

## 5. Synthesis — is there a clean, good-enough, affordable option, and the first slice

**Yes, exactly one clean generative option: Stable Audio Open 1.0 run locally.** It clears all three
bars — licensing (own outputs, commercial under $1M, no per-file attribution, egress-free), fit
(purpose-built for short SFX/one-shots/riffs at 44.1 kHz stereo ≤47s), and cost (zero marginal). The
leading option the owner named, **ElevenLabs, is a licensing dealbreaker for dotbeat's core
thesis** — its Sound Effects contract forbids exactly the "commit generated chops into a public,
shareable `media/` folder" action dotbeat is built around, and its Music product forbids
redistribution outright. Meta's models are non-commercial. Say this plainly to the owner: **the
vocal-chop pain cannot be solved by wiring up ElevenLabs without violating ElevenLabs' terms the
moment a user pushes their `.beat` repo public.**

**Recommended sequencing (two moves):**

1. **Near term — lean on RD, not generation.** RD already wires Freesound **CC0** (zero licensing
   risk, per-file provenance) into `beat source search` / `beat source add`. That is the
   licensing-cleanest "real sound source" and it ships this phase. Generative buys us prompt-authored
   novelty CC0 can't, but at real integration cost — it is not worth rushing ahead of RD.

2. **First generative slice (gate on the pass-102 sidecar) — `beat source gen`.** When the Phase 38
   Python-sidecar convention from pass 102 (`beat analyze`) exists — venv/requirements, child-process
   invocation, graceful "pip install" degradation — reuse that exact plumbing to add:

   ```
   beat source gen "<prompt>" [--duration 2] [--seed N] [--provider stable-audio-open]
   ```

   → run Stable Audio Open locally → normalize via the existing `prep-oneshot.mjs` → register into
   `media` via `setMediaSample`, **mirroring RD's `beat source` shape and enforcing the same
   provenance sidecar** so every generated sample carries `{prompt, provider:"stable-audio-open-1.0",
   model, license:"Stability AI Community License", licenseUrl, date, seed}` — the generative analog
   of RD's Freesound provenance record. Plus `beat_source_gen` MCP. Ship "Powered by Stability AI"
   attribution in dotbeat's own docs/UI (the model-integration obligation).

**Effort estimate:** **large — the biggest of the plausible slices, and explicitly gated.** It
inherits the *entire* Python-sidecar burden pass 102 deferred (first Python dependency, venv, model
download, failure modes) **plus** GPU realities, on top of the CLI/MCP/provenance wiring. Realistically
larger than a normal stream; best sequenced **after** `beat analyze` proves the sidecar convention, so
the two share plumbing rather than each paying for it. If the owner instead wants a hosted, no-GPU,
smaller REST wire-in, the candidate is the **Stability developer API (Stable Audio 2.5)** — but only
*after* someone re-fetches its output/redistribution terms from an unrestricted network to confirm it
has no ElevenLabs-style standalone-file catch (see open question 1); do **not** build hosted on the
strength of this pass alone.

## Open questions / honest gaps

1. **Hosted Stable Audio (consumer + developer API) output-redistribution terms** — a third-party
   review flags a "distribution catch" I couldn't read (egress-blocked). Whether the hosted API grants
   the same clean output ownership as the *local* Community License, or carries a standalone-file
   restriction, is **unconfirmed and gating** for any hosted build.
2. **Every ElevenLabs & Stability primary page was egress-blocked** — the SFX prohibited-use clause is
   a verbatim search return (high confidence) but was not independently re-fetched; the Stability
   Community-License output/attribution boundary rests on agreeing secondary summaries, not the
   fetched LICENSE.md. Re-verify both primaries before shipping user-facing licensing copy.
3. **Stable Audio Open exact hardware floor** (VRAM, CPU-only viability, generation latency per clip) —
   single-source/unverified; spike it on a clean machine, same as pass 102's allin1 spike, before
   committing to the local path.
4. **ElevenLabs Voice/TTS as a chop source** — the standalone-file clause is SFX-scoped, so
   TTS output is contractually freer, but musical fit is poor and the public-repo gray zone remains.
   Left inconclusive; not recommended.
5. **AI-output copyrightability** stated per prevailing 2026 US Copyright Office posture (machine
   output generally not copyrightable) — jurisdiction-dependent and evolving; it *helps* dotbeat's
   shareability rather than blocking it, so not decision-gating, but revisit if the product ever makes
   ownership claims about generated media.

## Sources

- Meta AudioCraft LICENSE (MIT) + LICENSE_weights (CC-BY-NC 4.0) — fetched directly,
  raw.githubusercontent.com/facebookresearch/audiocraft
- ElevenLabs Prohibited Use Policy (elevenlabs.io/use-policy), Music Terms, Sound Effects Terms,
  pricing/API pages, "Can I publish the content I generate" help article — via WebSearch (domain
  egress-blocked)
- Stability AI License / Community License (stability.ai/license, /news-updates/license-update),
  Stable Audio Open model card, stableaudio.com pricing/FAQ, platform.stability.ai pricing — via
  WebSearch (domains egress-blocked)
- Third-party analyses (terms.law, licenseorg.com, undetectr.com, bigvu.tv, dubspot, chartlex) — via
  WebSearch (domains egress-blocked)

---

## Addendum (2026-07-14) — primary-source correction: ElevenLabs **Music** Service Terms

The owner pasted the actual ElevenLabs **Music** Service Terms (the primary source this pass
couldn't fetch — egress was blocked). This materially corrects the ElevenLabs verdict above, which
rested on the **Sound Effects** Prohibited Use Policy read via search summaries.

**The standalone-file distribution ban is NOT in the Music terms.** The clause that made this pass
call ElevenLabs a "dealbreaker" — SFX output may not be distributed "as isolated files / audio
samples / collections of sounds" — is specific to the Sound Effects product. The Music Service
Terms contain no equivalent. So the blanket verdict was **product-scoped to SFX and does not carry
to Music**. ✅ CONFIRMED (primary text).

**What the Music terms actually restrict** (primary text):
- §2(a) Prohibited *industries* (firearms/tobacco/pharma/adult/religious-orgs/political) — a music
  tool/user isn't in these. Not a blocker in general.
- §2(b) Prohibited *inputs*: the PROMPT may not contain a real artist/songwriter name, song/album
  title, label/publisher name, or substantial lyrics. A prompt-side guardrail to bake into any
  generation UX — not a limit on output use.
- §2(c/d) No infringing / no misleading impersonation of a real recording artist. Standard.
- §3 exclusivity disclaimer — the real caveat: Output "may not be unique and may be similar or
  identical to Output returned to other users… you shall have no rights in or to such third-party
  output." Not a redistribution ban, but generated audio is **non-exclusive** — a genuine limit
  where a sound must be uniquely the user's.

**The two decisive documents are still unseen** (higher precedence than the Service Terms; the
order is Model-Specific Terms > Service Terms > Underlying Agreement):
1. **The Underlying ElevenLabs Agreement (main ToS)** — the Music terms *defer Output ownership and
   redistribution to it* ("Output as defined in the Underlying Agreement… includes audio output
   generated by Music Models"). Whether a user may own and redistribute generated audio lives
   there. ⚠️ NOT SEEN.
2. **The Music Model-Specific Terms** — the owner's paste ends at "Please see below for the current
   Model-Specific Terms: Eleven Music Model-Specific Terms" and the terms themselves are cut off.
   Per §5 these **control over everything else** for that model. ⚠️ NOT SEEN — the single most
   decision-relevant text.

**Use-case mismatch (unchanged, and it dominates):** ElevenLabs **Music** generates full
compositions / sound recordings — songs, not the short vocal-chops / risers / impacts / one-shots a
producer chops into a `.beat`. Same "wrong shape" as Suno/Udio. For the vocal-chop pain
specifically, ElevenLabs' **Voice/TTS** product (short vowel one-shots) is the better contractual
*and* practical fit — and that product's terms are freer than SFX (noted in the main pass).

**Revised verdict:** ElevenLabs is **not a blanket dealbreaker** — that was an SFX-scoped
over-generalization. It splits by product: **SFX** = distribution-banned (avoid); **Music** =
undetermined (blocked only by the two unseen higher-precedence docs) but wrong-shape for chops;
**Voice/TTS** = the actually-relevant product for vocal chops, worth a separate small look. The
**strategic recommendation is unchanged**: for chops/SFX/risers the clean, cost-free, licensing-
simple path is **Stable Audio Open run locally** + **Freesound CC0** now; ElevenLabs' only real
candidacy is the Voice product, which needs its own terms fetched from an unrestricted network
before any build.
