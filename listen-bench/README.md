# listen-bench — every owner-flagged listening miss, banked as a labeled case

The standing practice: **when the owner's ear disagrees with a measured result, that disagreement
becomes a case here, with the owner's verdict as the label.** Not a note in a report, not a line in
a commit message — a case, with the audio, the numbers that were wrong, and the number (if any) that
would have been right.

The point is not to record complaints. It is to have a fixed, growing set the critic can be scored
against, so "we improved the critic" is a measurement rather than a claim. A feature that ranks
these pairs the way the owner did is a feature worth adding; one that does not is not, no matter how
principled it looks.

## What a case is

One JSON file per case in `cases/`, named `<date>-<slug>.json`. Audio is NOT committed — the clips
live in the private `taste-dataset/` tree and every case names its files by path, with a sha256 so a
moved or re-rendered file is detectable rather than silently substituted.

Required fields:

| field | meaning |
|---|---|
| `id` | the case's stable id, matching the filename |
| `date` | when the owner gave the verdict |
| `kind` | `preference` (A beats B), `defect` (this clip has a flaw), or `control` (nothing wrong) |
| `verdict` | **the label** — the owner's own words, verbatim, plus the machine-readable outcome |
| `clips` | each clip's path, sha256, and what produced it |
| `measured` | the feature values at the time of the verdict, per clip |
| `whatTheMetricsSaid` | which gates ranked the clips, and how — including the ones that got it wrong |
| `metricGap` | the feature that WOULD have ranked them correctly, or `null` if none exists yet |

## Why the audio is not in git

The reference clips are purchased pack loops whose vendor terms prohibit redistribution, and the
renders are large. Paths + sha256 is the same contract `taste-dataset/` uses everywhere else.

## Related

`taste-dataset/listen-bench/` (private) holds the 2026-07-24 audio bench: 18 DSP-defect cases with
an `answers.json` key and the MoSQITo/Gemini scoring tools. Cases banked here that have audio are
also filed there as numbered `case-NN.wav` entries so the existing tooling can score them; the JSON
here is the durable, version-controlled record of WHY the case exists.
