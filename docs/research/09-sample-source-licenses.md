# Research pass 09 — Per-source license audit: drum samples & SoundFonts

*Run 2026-07-10/11 via the deep-research harness. 5 angles, 22 sources fetched, 104 claims
extracted, 25 verified: **25 confirmed (3-0 except three 2-1 splits, each verified verbatim
against primary license text), 0 refuted.** 104 agents. Follow-up to research 07's mechanisms
pass — this one audits the CONTENT layer for Phase 7, against primary license texts, not blog
summaries.*

## Verdicts (primary-source-verified)

| Source | License | Bundle in an MIT repo? | Attribution | Provenance |
|---|---|---|---|---|
| **FreePats CC0 banks** | CC0 1.0 (per-bank; CC0 is the site's preferred license) | **YES — cleanest** | none required | site policy actively vets: original content only, known authors, unknown-origin material rejected |
| **FreePats MuldjordKit** | CC-BY 4.0 | **YES** | required (Lars Muldjord 2010; assembled by FreePats; upstream DrumGizmo asks for "Drum samples provided by DrumGizmo.org") | fully documented chain; SFZ+FLAC/WAV, **.h2drumkit (131 MiB)**, SF2 (53 MiB); velocity layers + round-robin in SFZ |
| **FluidR3 GM** | **MIT** (Frank Wen, 2000-2013) | **YES** | notice preservation (MIT's own condition) | self-attested chain (public-domain samples + own recordings, 13 named contributors), accepted by Debian/Fedora/MuseScore legal review; never independently audited |
| **GeneralUser GS** | custom "GeneralUser GS License v2.0" | **YES with caveat** — express permission to use in software projects and modify; no attribution clause | none | **self-disclosed uncertainty**: author "cannot be 100% sure where all samples originated" (though none from commercial packages); likely fails DFSG review; per-file provenance impossible |
| **Hydrogen drum kits** | **heterogeneous per kit** — GPL-2, GPL-2+, CC-BY-3.0, CC-BY-SA-3.0, CC0 all present | **per-kit only** — audit each individually | per license | machine-readable: each `.h2drumkit` is a tar.gz whose `drumkit.xml` carries a free-text `<license>` element; the **Debian hydrogen-drumkits copyright file is the best existing per-kit legal audit** (e.g. **Audiophob = CC0**; Pavlov kits = GPL-2+ confirmed by 2017 email) |

**NOT cleared (nothing survived verification — do not treat as bundleable):** Musyng Kite,
99Sounds, Bedroom Producers Blog packs, SampleSwap, MusicRadar/SampleRadar, the Amen break,
VSCO/Versilian CC0 scope, Salamander drumkit, Virtual Playing Orchestra, any GitHub
"cc0-drums" collection. The free-to-use vs free-to-*redistribute* distinction for these remains
an open question.

## Key structural findings

- **Hydrogen's `<license>` field is free-text** (no controlled vocabulary in the XSD), often
  just "GPL" unversioned, may be empty in old kits; Hydrogen's manual *assumes* GPLv2 when
  unspecified — imputation, not verification. The contribution policy gates on a declared
  license but does not verify sample provenance. So: trust the **Debian DEP-5 audit**, not the
  raw field.
- **FreePats is the gold-standard source policy**: DFSG-compatible per-bank licenses, musical
  output explicitly free under any license, provenance vetting (samples recorded from other
  sample-based instruments prohibited without manufacturer permission).
- **GPL'd kits (most Hydrogen kits) are usable but sticky in an MIT repo**: GPL applies to the
  *samples*; bundling GPL samples in the repo is possible (aggregation) but muddies "everything
  here is permissive" — prefer CC0/CC-BY kits and skip GPL content entirely.

## Bundle-today shortlist (per-file provenance required for each file)

1. **FreePats CC0 banks** — no-strings content, provenance-vetted at source.
2. **FreePats MuldjordKit** (CC-BY 4.0) — the real acoustic kit, ships as `.h2drumkit` with
   per-instrument samples → directly feeds our per-lane one-shots; carry both credit lines.
3. **Audiophob Hydrogen kit** (CC0, Debian-vetted) — electronic flavor, no attribution burden.
4. **FluidR3 GM** (MIT) — the GM percussion bank for the later spessasynth/SF2 tier rather
   than one-shots.
5. **GeneralUser GS** — last resort / user-loadable rather than bundled, given the provenance
   caveat; document the caveat wherever used.

## Still open (carried forward)

1. The unverified sources' actual terms (99Sounds et al.) — assume NOT redistributable until
   verified.
2. A verified pure-CC0 one-shot collection beyond FreePats; VSCO/Versilian CC0 scope.
3. **Drum-sample craft and prep conventions (question 3-4) produced zero verified claims** —
   the prep checklist in `scripts/prep-oneshot.mjs` stays self-derived until a book-grade pass
   (Senior, Snoman, Sound on Sound) runs; same gap as research 07/08's craft angles.
4. SF2 GM percussion structure (bank 128 mapping) — needed for the spessasynth tier, unverified.

## Consequences

- Phase 7 bundling order: MuldjordKit (acoustic) + Audiophob (electronic) as the first real
  kits, each sample through `prep-oneshot` with a provenance sidecar recording source URL,
  license, credit lines, and the Debian/FreePats audit reference.
- The starter-kit prep conventions remain self-derived: flag in docs, revisit after a
  book-grade craft pass.
- MIT license decision (D-log 2026-07-10) composes cleanly: everything on the shortlist is
  CC0/CC-BY/MIT; GPL kits are simply skipped.
