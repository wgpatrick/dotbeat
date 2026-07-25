# Usability pilot 128 — `beat showdown --theory` (theory-figure batches, `--gen-backend stub`)

**Persona:** a returning taste-loop user who has NOT used the new theory-composition layer. Goal:
build a blind source-showdown batch whose composed figures come from the deterministic theory-aware
layer (the `figureSource:'theory'` arm, research 124 §C.7), using the free offline `stub` gen
backend so there's no network, no key, and no spend. Judge everything from `--help` and the command's
own output — no source reading until the frictions were logged.

## Narrative walkthrough

**Discovery.** `beat showdown --help` opens with the usage line and a long prose block. The first
words are "build blind SOURCE-SHOWDOWN batches **from a taste-seeds dir**" — but the usage line
itself is just `beat showdown <dir>`, so what `<dir>` must contain isn't obvious up front. The
`related:` footer (`beat taste-seeds, beat taste-collect, …`) is what points at the seed-creation
command; a first-timer has to read to the bottom to find it. Minor, and the related line does its
job. `beat taste-seeds --help` is explicit: "Step 1 of the collect→rate→eval pipeline."

**Happy path.** `beat taste-seeds /tmp/pilot-seeds --count 2` → two seed songs, and a `next:` hint.
`beat showdown /tmp/pilot-seeds --theory --gen-backend stub --roles chords` built cleanly:

- A leading info line — `theory figures: composed pitched sources draw from the theory-aware layer
  (bank fallback for drum-loop)` — states exactly what `--theory` changed and its one caveat.
- The batch header names the arms (`engine vs gen vs keymap`), the composed figures
  (`theory:charleston, theory:lush-pad`), the seed, and the backend.
- Offline render of all clips through the engine, duration-match + LUFS-normalize, and a
  `next: beat rate … then beat showdown … --report` closing hint.

The theory arm is self-describing and the stub backend kept the whole thing free and offline. Every
stage printed its literal next command — the loop is self-guiding, consistent with pilots 108–111.

## Frictions found

1. **`--gen-backend <typo>` was accepted silently (MEDIUM).** `--gen-backend stubbb` was NOT
   validated: it echoed in the batch header as if real (`(seed 85101, stubbb)`), then every role
   failed downstream with a generic `warning: showdown <role> failed — skipping`, giving no hint the
   backend NAME was the problem. Exactly the loud-error class pilots 109–112 closed for other flags.
   **Fixed:** `beat showdown` now rejects an unknown `--gen-backend` up front —
   `error: unknown --gen-backend "stubbb" (known: fal, stub, stableaudio; stub = free offline
   placeholder audio, no network/key)`.

2. **A nonexistent `<dir>` threw a raw ENOENT stack trace (LOW).** `beat showdown /tmp/nope --theory`
   dumped `Error: ENOENT: no such file or directory, scandir …` with a Node stack — `readdirSync`
   ran before any friendly check, unlike the empty-dir case which already had a clean message.
   **Fixed** in all three seed-dir consumers (`taste-collect`, `showdown`, `prodtask`):
   `error: no directory at /tmp/nope — create seed songs first: beat taste-seeds /tmp/nope`.

3. **Info-line ordering (TRIVIAL, not fixed).** The `theory figures:` info line prints before the
   dir-existence check, so an invalid dir shows the info line and then the error. Harmless; left as
   is.

## Filed as roadmap rows

- Showdown help doesn't state on the usage line that `<dir>` is a `beat taste-seeds` output — a
  first-timer relies on the `related:` footer. Filed as a `not-started` help-text polish row.
- The showdown→rate→report loop's middle step (`beat rate`) is a browser-only web UI; a headless /
  CLI-only or agent user cannot complete a showdown they collected. Filed under the taste-loop area
  (a headless rate/score path) — bigger than a help fix, cites this pilot.
