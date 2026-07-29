# Usability pilot 147 — `beat export-midi` (CLI variant)

2026-07-28, same-session wrap-up for the export-midi stream (CLAUDE.md: a CLI pilot runs whenever
a phase adds a `beat` subcommand). Methodology: docs/usability-testing.md "Variant: CLI/MCP
pilots" — a fresh agent given only the end-user goal *"get my beat's melody and drums into
Ableton Live as MIDI"*, no checklist, no source reading, discovering the surface through `beat`
/ `beat help export-midi` alone. Material: a scratch copy of the twin-souls-study project (5
tracks, 9-scene / 168-bar song arrangement). 28 tool calls, ~3.5 minutes — the cheap variant
doing exactly what research/94 promised.

## Outcome

The pilot produced spec-correct files on its first successful command (two wrong turns: a typo'd
track name, and `-o` combined with `--out-dir` — both answered by clean one-line errors). Ground
truth held up under independent inspection: `MThd` header, 480 ticks/quarter, tempo meta
`07 53 00` = exactly 125 bpm, GM drum notes 36/39/42/46 on channel 10, all verified from raw
bytes. The severed-copy caveat printing on every success was called out as good
expectation-setting.

But the pilot's verdict was **goal not truly achieved**: the user would have walked away
believing they exported "the beat" when they had exported one ~4-bar loop per track out of a
168-bar arrangement, with no in-tool signal that anything was missing.

## Findings and dispositions

| Sev | Finding | Disposition |
| --- | --- | --- |
| HIGH | Song-mode projects export each track's raw loop content with **zero warning** that the 168-bar arranged timeline is not what lands in the .mid. The v1 scoping lived only in the roadmap row, invisible to a CLI user. | **Fixed this session**: `runExportMidi` now prints `NOTE: this project has a song arrangement (N sections, M bars) — export-midi v1 exports each track's own LOOP content, NOT the arranged timeline` before the file list, and the help text / MCP description say the same. The structural fix (flatten the song timeline into the SMF) is a written tail on the roadmap's "MIDI file import" row. |
| MEDIUM | A track with several saved clips (`arp_a` vs `arp_soft`) exports only its current loop content; the other variant vanishes silently — `beat inspect` was the only way to notice. | **Fixed this session**: a per-track `note: <track> has N saved clips (…) — this export is the track's CURRENT loop content` line whenever a track has >1 clip. Per-clip export itself is part of the same roadmap tail. |
| MEDIUM | `export-midi doesnotexist.beat` surfaced a raw Node ENOENT stack trace (with internal dist/ paths) while every other error path printed one clean line. | **Fixed this session**: wrapped in `BeatMidiError` — `cannot read <path>: no such file`, exit 2. |
| LOW/POLISH | The bare-`beat` usage dump is ~900 lines with no categorization; finding `export-midi` among taste-research verbs took real scrolling. | Pre-existing, surface-wide (pilot 108 already forced the "per-command help exists" banner). Not new scope for this stream; belongs with any future help-dump categorization work, roadmap "Known usability gaps" area. |

All three fixes landed with regression tests in `test/midi-export.test.ts`
("pilot-147 fixes: song-mode NOTE, multi-clip note, and a clean missing-file error") and are
visible on the real twin-souls file.

## What the pilot validates about the method

Fourth consecutive CLI pilot to find a real HIGH within minutes of a subcommand shipping, and —
same shape as pilots 109/111/112 — the bug class is *silent scope mismatch*, not incorrect
output: every byte the command wrote was right; what it didn't say is what would have burned the
user. Verify-style tests structurally cannot catch this (the author believed loop-content export
was the obvious contract); only an agent pursuing the *user's* goal ("export my beat") noticed
that the beat and the loop are not the same thing.
