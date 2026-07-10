# Research 04 — Text-Based Music Format Prior Art (.beat format design)

> **Fully adversarially verified.** 100 claims extracted, 25 queued for verification, **22 confirmed**, **3 refuted**, 107 verifier agent calls, **0 errors**.

## Question

> Survey historical and current text-based music/song representation formats as prior art for designing a line-oriented, diff-friendly, literal-data music document format (the ".beat" format) for a git-native DAW. This is NOT about live-coding languages (already researched separately) — focus specifically on FORMATS: their syntax design, how they represent musical events as text, and real-world evidence of git/version-control diffing. Research questions: (1) SUPERCOLLIDER: Distinguish .scd files (executable code, not data) from SuperCollider's "Score" object / non-realtime-synthesis score format — an explicit list of timestamped OSC-bundle-style events. How is a Score structured, is it commonly hand-authored or hand-edited, and how diff-friendly is it in practice? (2) CSOUND: The .sco score file format — literal one-instrument-event-per-line syntax with p-fields (start time, duration, parameters). Decades of production use. Is this the closest existing analog to a "one musical event per line, canonical, diff-friendly" format? What are its syntax conventions, strengths, and limitations? (3) LILYPOND: The most mature text-to-engraved-notation system. How does its syntax represent pitch/rhythm/dynamics/articulation as text? Find REAL evidence of LilyPond files versioned in git (public repos, commit histories) and what actual diffs look like for simple edits (transposition, added note, rhythm change) — is it genuinely diff-friendly in practice or only in theory? (4) HUMDRUM **KERN: The musicological/computational-analysis encoding standard, spine-based text format explicitly designed for computational comparison (this is the format the "musicdiff" tool operates on, per prior research). What design lessons does its spine/token structure offer for representing multiple simultaneous parts as diffable text? (5) ABC NOTATION: The lightweight folk/traditional-music text format — huge GitHub tune-collection ecosystem (abcjs, abc2midi, thesession.org exports). Real diff-friendliness evidence at scale. Its known limitations for production music (monophonic bias, no synthesis/automation parameters). (6) TRACKER FORMAT PATTERN DATA MODEL: Impulse Tracker / FastTracker / Renoise .xrns — even though the files are often binary/XML-in-zip, the ROW × CHANNEL pattern-grid data model is the direct ancestor of step sequencers. Is there a plain-text serialization anyone actually uses (export tools, MOD2TXT-style utilities)? (7) ORCA: The esoteric procedural sequencer where the source file's grid of ASCII characters IS the running program/sequence — the purest "the text file you hand-edit is the music" precedent. How does it work and what does it prove is possible? (8) MML (Music Macro Language): ultra-compact chiptune/game-music text format with decades of hand-authored, hand-diffed community usage — worth a look for information-density lessons. (9) THE PRODUCTION-PARAMETER GAP: nearly all notation formats above (LilyPond, ABC, Humdrum) represent PITCH/RHYTHM/DYNAMICS but not synthesis/production parameters (filter cutoff, envelope shapes, effects sends, automation curves). Is there any prior art — text format, tracker, or otherwise — that marries traditional notation-style event representation with synth/production parameter automation in one diff-friendly text document? (10) Real diff examples: for at least 2-3 of these formats, find or reconstruct what an actual git diff looks like for a small musical edit, to evaluate genuine (not theoretical) diff legibility. Deliver: a comparison table of these formats' syntax design choices, event representation strategies, and diff-friendliness (theoretical vs evidenced-in-practice), concrete syntax conventions worth stealing for a new format spec, and a recommendation on format style (bespoke line-oriented text vs restricted YAML vs TOML vs a Csound/tracker-hybrid) grounded in what has actually proven diff-friendly over decades of real-world use rather than untested design.

## Executive summary

Across nine formats, the strongest genuine prior art for a diff-friendly "one musical event per line" design is Csound's .sco format (single-letter statement type + space/tab-separated p-fields, with p1/p2/p3 hardwired to instrument/start-time/duration and p4+ free-form) — a stable, decades-old, literal-data, line-per-event convention. Humdrum **kern is the only format whose own documentation explicitly names the diff/version-control problem (signifier-ordering causing false "different" results in Unix diff/cmp) and prescribes a canonical token ordering to fix it, making it the most self-aware prior art on text-diffability; its spine (tab-separated column) model for concurrent parts, where a row = one time-slice and columns = simultaneous voices, is a directly reusable pattern for representing multi-track/multi-channel simultaneity in a diffable grid. LilyPond and ABC notation both have large, real, actively-maintained git-hosted corpora (Mutopia Project: 93.6% .ly by bytes, 4,174 commits with real edit/fix commits over time; TheSession-data: a long-lived, weekly-updated repository whose tunes.csv embeds literal ABC pitch/rhythm strings), confirming these text formats are genuinely used and versioned at scale in the real world, not just theoretically diffable. SuperCollider's Score is an OSC-bundle-style timestamped event list ([[time,[cmd]],...]) that can be authored as literal text via Score.newFromFile, but its actual on-disk representation for the synthesis server is binary (raw OSC + byte-size-prefixed), which undercuts its value as a diff-friendly text format; evidence on whether Scores are typically hand-authored vs. programmatically generated was inconclusive (a claim for programmatic-generation-over-hand-authoring failed verification). ORCA confirms the far end of the design space is viable: a grid of plain ASCII characters that is itself the running sequencer program, with every letter an operator — proof that literal-text-as-executable-sequence is a workable paradigm, though evidence connecting it to production/synthesis parameters (vs. pure sequencing/trigger logic) did not survive verification either way.

## Verified findings

### 1. [HIGH]

Csound's .sco format is the closest existing analog to 'one musical event per line, literal p-field data, diff-friendly': each score statement is a line beginning with a single-character type code (most commonly 'i' for instrument/note events), followed by space/tab-separated parameter fields (p1, p2, p3...); for 'i' events the first three p-fields are hardwired to instrument number/name (p1), start time (p2), and duration (p3), with all further fields (p4+) left entirely to the composer/instrument designer for arbitrary parameters (pitch, amplitude, timbre, etc.).

*Evidence: Official Csound manual (parameter-fields page) states statements begin with a type character followed by space/tab-separated p1/p2/p3... fields; the 'i Statement' manual page and FLOSS Manual both confirm p1=instrument, p2=start time, p3=duration are mandatory/hardwired and p4+ are instrument-defined free-form parameters. Corroborated by independent university Csound tutorials (Cornell, UChicago, QC/CUNY, illiMath). Stable since 1990s-era Csound documentation through current Csound 7 manual.*

Sources: <https://csound.com/manual/score/parameter-fields/>, <https://flossmanual.csound.com/miscellanea/methods-of-writing-csound-scores>, <https://csound.com/docs/manual/i.html>

### 2. [HIGH]

A SuperCollider Score is a literal list of timestamped OSC-bundle-style events in ascending time order — structurally [[time1,[oscCmd1]], [time2,[oscCmd2],[oscCmd3]], ...] where each OSC command is itself an array like ['/n_set', 1000, 'gate', 0] bound to a floating-point beat time. This data can be authored as literal text (a valid SuperCollider array expression) and loaded via Score.newFromFile, i.e., it need not only be built at runtime in code.

*Evidence: Official SuperCollider Score class docs give the exact array-of-arrays format with ascending-time ordering and note 'bundles are okay' for simultaneous commands at one beat. The Non-Realtime-Synthesis guide shows a concrete example ([0.1, [\s_new, ...]], ...) and states Score.newFromFile(path) 'reads the list in from a text file' which 'must contain a valid SC expression,' confirming literal text authoring as an alternative to runtime construction.*

Sources: <https://docs.supercollider.online/Classes/Score.html>, <https://doc.sccode.org/Guides/Non-Realtime-Synthesis.html>, <https://doc.sccode.org/Classes/Score.html>

### 3. [MEDIUM]

Despite being expressible as literal text/array data, SuperCollider's actual on-disk Score file format (as consumed for non-realtime synthesis) is binary, not plain text: each OSC command is converted to raw binary (asRawOSC) and written with a 32-bit integer byte-size prefix before the binary command bytes. This significantly limits Score's practical value as a diff-friendly text format even though its logical/in-memory structure looks like diffable literal data. Separately, whether Scores are typically hand-authored/hand-edited versus generated programmatically (e.g. from Patterns) could not be confirmed — a claim asserting the latter as the dominant practice failed adversarial verification (0-3).

*Evidence: The NRT synthesis guide's file-construction procedure explicitly instructs converting each command via cmd.asRawOSC, writing file.write(cmd.size) as a byte-size integer, then file.write(cmd) as binary — confirming the persisted score file is binary OSC data, not text, even though the logical Score object is list-shaped. The Score docs independently describe 'creation of binary OSC files for non-realtime synthesis.' A separate adversarial-verification pass rejected (0-3) the claim that Scores are typically programmatically generated rather than hand-authored, leaving the hand-authoring-frequency question genuinely unresolved rather than confirmed in either direction.*

Sources: <https://doc.sccode.org/Guides/Non-Realtime-Synthesis.html>, <https://docs.supercollider.online/Classes/Score.html>

### 4. [HIGH]

Humdrum **kern is a two-dimensional, pure-ASCII, tab-delimited plain-text grid ('spreadsheet-like,' not binary or XML): time flows vertically down the page as rows ('records'), and simultaneous/concurrent parts (spines) are arranged as tab-separated columns across the same row; each row encodes a single musical moment/sonority, spines strictly require tab characters (not spaces) as delimiters, and new events within a part are appended as new rows moving down that part's spine. Metadata/structural instructions are marked with asterisks (*/**). This grid model is a directly reusable pattern for representing multiple simultaneous instrument/channel parts as diffable text.

*Evidence: Official Humdrum kern docs state musical parts are represented as tab-separated 'spines' and each line/record represents a single musical moment/sonority; the syntax guide states explicitly 'successions of events proceed vertically down the page, whereas concurrent events extend horizontally across the page' and that 'spaces cannot be used to separate spines' (tabs required). The humdrumR docs independently describe the format as 'nothing but a simple, tab-delineated spread sheet.' A peer-reviewed ISMIR2008 paper (full text extracted) confirms ASCII-only content, spine=stave mapping, new-events-as-new-rows, and asterisk-marked metadata/interpretation tokens.*

Sources: <https://www.humdrum.org/rep/kern.html>, <https://www.humdrum.org/guide/ch05/>, <https://computational-cognitive-musicology-lab.github.io/humdrumR/articles/HumdrumSyntax.html>, <https://ismir2008.ismir.net/papers/ISMIR2008_253.pdf>

### 5. [HIGH]

Humdrum's own documentation explicitly names and addresses the diff/version-control problem: it states that differing (but musically equivalent) orderings of signifiers within a token cause standard Unix tools like diff and cmp to falsely report two otherwise-identical files as 'different,' and it prescribes a canonical, fixed ordering of signifiers specifically to prevent this and to support reliable pattern-matching/comparison tasks. This is the only format in the survey whose own spec explicitly reasons about text-diff tooling.

*Evidence: The official kern format page states nearly verbatim that when comparing two ostensibly identical **kern files, differences of signifier orderings 'will cause Unix commands such as cmp and diff to declare the files to be different,' and additionally notes such ordering differences complicate regex-based pattern matching (e.g., searching for '16f#'). It then supplies a canonical signifier-ordering table specifically to solve both problems.*

Sources: <https://www.humdrum.org/rep/kern.html>

### 6. [HIGH]

In **kern, pitch is encoded as a letter where lowercase 'c' = middle C, with case indicating octave direction (uppercase = lower octaves, lowercase = higher octaves) and letter-repetition/accumulation extending octave distance further (e.g., 'CC', 'cc'), combined with a numeric rhythmic duration value prefixed to the pitch letter (reciprocal notation: 1=whole, 2=half, 4=quarter, 8=eighth), e.g. '4GG' or '8b#' — a compact, information-dense single-token-per-event convention worth studying for a new format's syntax.

*Evidence: ISMIR2008 paper text states notes are encoded as a combination of numeric (rhythmic) value and letter (pitch), with middle C as lowercase 'c', lower octaves in uppercase, higher octaves in lowercase, and larger octave distances via accumulated lettering. Official humdrum.org kern reference independently confirms: 'Middle C (C4) is represented using the single lower-case letter c. Successive octaves are designated by letter repetition, thus C5 is represented by cc... For pitches below C4, upper-case letters are used,' with reciprocal duration numbers prefixed and accidentals (e.g. '#') appended, matching example tokens like '16ff#'.*

Sources: <https://ismir2008.ismir.net/papers/ISMIR2008_253.pdf>, <https://www.humdrum.org/rep/kern/>

### 7. [HIGH]

musicdiff (the tool referenced in prior research as operating on **kern) is not kern-specific: it computes/visualizes/describes notation differences between any two scores parseable by music21 or converter21 (MusicXML, Humdrum **kern, MEI, etc.), and is explicitly designed to detect visible/notational differences rather than only audible ones (e.g., it treats two tied eighth notes as different from one quarter note, and beamed vs. unbeamed sixteenth notes as different, even when acoustically identical) — a relevant design lesson: 'diff' for music can mean structural/notational diff rather than literal text diff.

*Evidence: musicdiff's own README states it is 'a Python3 package (and command-line tool) for computing and visualizing (or describing) the notation differences between two music scores,' works with 'any format music21 or converter21 can parse' (demonstrated with both .musicxml and .krn examples), and explicitly states it 'is focused on visible notation differences, not only on audible musical differences... two tied eighth notes are considered different from a single quarter note.'*

Sources: <https://github.com/gregchapman-dev/musicdiff>

### 8. [HIGH]

LilyPond has real, large-scale, long-running production use under git version control: the Mutopia Project's public-domain sheet-music repository is 93.6% LilyPond (.ly) source by byte count and has accumulated 4,174 commits, including genuine edits to pre-existing .ly files over time (note corrections, LilyPond-version migrations, translation/copyright updates, merged pull requests) — confirming LilyPond is a real working text format for a large corpus, not just a theoretical diff-friendly design.

*Evidence: GitHub's own language-detection API confirms LilyPond = 42,776,144 of 45,712,665 total repo bytes = 93.57% (rounds to 93.6%, matching the repo's rendered language bar). The repo page shows '4,174 Commits.' The commit history shows concrete edit commits over time, e.g. 'fix : A instead of B at bar number 6,' 'Music fix and cleanup/update to LilyPond version 2.20.0,' 'Changes to update the LilyPond version from 2.20.33 to 2.24,' and merged PRs like 'Merge pull request #1133 from ksnortum/update-chopin-o66.'*

Sources: <https://github.com/MutopiaProject/MutopiaProject>

### 9. [MEDIUM]

ABC notation has real, large-scale, long-running production use under git version control: TheSession-data repository (a mirror of thesession.org, the major folk-tune ABC database) stores each tune setting as a CSV row with metadata columns (tune_id, setting_id, name, type, meter, mode, date, username, composer) plus an 'abc' field containing the literal ABC pitch/rhythm transcription string, and has been actively maintained with roughly weekly commits over roughly a decade, still updating as of days before the current date — evidencing ABC as genuinely diffed/versioned at scale, though the ABC text is embedded inside CSV rows in this particular corpus rather than as one-tune-per-file plain .abc documents.

*Evidence: Direct fetch of raw csv/tunes.csv confirms the header 'tune_id,setting_id,name,type,meter,mode,abc,date,username,composer' and real rows with literal ABC bodies (e.g. '|:G>A B>G c>A B>G|E<E A>G F<D D2|...'). The repo's commit feed shows a consistent weekly 'Latest update' cadence extending back to at least 2014, with the most recent commit only 5 days before the query date, and the repo description confirms it is a data dump from thesession.org maintained by its owner on a roughly weekly basis.*

Sources: <https://github.com/adactio/TheSession-data>

### 10. [HIGH]

ORCA proves the extreme end of 'the text file you hand-edit IS the music/sequence': it is an esoteric programming language where the source file is literally a grid of ASCII characters, every letter of the alphabet is an operator, lowercase letters trigger on 'bang' events and uppercase letters execute every frame — demonstrating that a plain-text character grid can directly function as a running procedural sequencer without any separate compilation/interpretation layer being conceptually distinct from the visible text.

*Evidence: ORCA's own README states verbatim: 'Orca is an esoteric programming language designed to quickly create procedural sequencers, in which every letter of the alphabet is an operation, where lowercase letters operate on bang, uppercase letters operate each frame.' Independently corroborated by the esolangs.org wiki entry and multiple mirrors describing the same bang-trigger/uppercase-per-frame operator model.*

Sources: <https://github.com/hundredrabbits/Orca>

## Refuted claims (explicitly rejected — do not cite)

These were extracted and looked plausible, but failed adversarial verification. Listed so we don't accidentally re-cite them later.

- In practice, Scores are typically generated programmatically (e.g., via Patterns converted with asScore()) rather than hand-authored line-by-line as literal data, which is a key distinction from Csound's .sco format.
- Csound score syntax includes carry-forward shorthand operators for hand-edited scores: '.' repeats the previous event's value in that p-field column, '+' (unique to p2) continues the start time immediately after the prior note ends, and '>' linearly ramps a p-field from its last explicit value to the next explicit value.
- ORCA is explicitly not a synthesizer but a livecoding environment that outputs MIDI, OSC, and UDP messages to external audio/visual tools (Ableton, Renoise, VCV Rack, SuperCollider) — meaning the text grid encodes sequencing/trigger logic, not synthesis or production parameters.

## Caveats

Coverage is uneven across the ten original research questions: confirmed, high-confidence claims survived for SuperCollider Score, Csound .sco, LilyPond, Humdrum **kern, ABC notation, and ORCA, but NO claims survived verification for tracker pattern-grid plain-text serialization (research question 6), MML/Music Macro Language (question 8), or genuine prior art marrying notation-style event representation with synthesis/production-parameter automation in one diff-friendly document (question 9) — these remain open per the source list, not because they were investigated and found absent. Two specific claims were explicitly refuted by adversarial verification and should be treated as unconfirmed/likely wrong rather than omitted for lack of interest: (a) that SuperCollider Scores are 'typically generated programmatically rather than hand-authored line-by-line' (0-3, contradicts rather than confirms the hand-authoring question), and (b) Csound's well-known carry-forward shorthand operators ('.', '+', '>' for p-field repetition/continuation/ramping) failed verification (1-2) despite being a commonly cited Csound feature elsewhere — treat specifics of that syntax as unverified in this research pass, not as disproven. No confirmed claim provides an actual reconstructed git diff (research question 10); the LilyPond and ABC findings establish real commit/version history exists at scale but do not include verified before/after diff text for a specific musical edit (transposition, added note, rhythm change). The ABC evidence is weaker than the LilyPond evidence: it is a single repository (a CSV data mirror) with ABC embedded in rows rather than a broad survey of the wider 'huge GitHub tune-collection ecosystem' the question asked about, and its diff-friendliness in that CSV-embedded form is plausible but not separately confirmed. SuperCollider's Score is undercut as diff-friendly prior art because its actual on-disk NRT file format is binary despite being logically expressible as text/array literals — this is an important nuance not to lose in synthesis. Time-sensitivity: Humdrum/kern and Csound conventions are decades-stable and not time-sensitive; the LilyPond and ABC repository statistics (commit counts, last-commit dates) are current as of query time (mid-2026) and will drift.

## Open questions (not covered by surviving evidence)

- Is there any plain-text serialization of tracker pattern-grid data (Impulse Tracker/FastTracker/Renoise .xrns) that musicians actually use in practice (export tools, MOD2TXT-style utilities), and if so, how diff-friendly is it — this research pass found no verified evidence either way.
- What does MML (Music Macro Language) syntax actually look like, and what information-density lessons does its decades of hand-authored, hand-diffed chiptune community usage offer — no claims on this survived/were produced in this pass.
- Does any existing text format genuinely marry traditional notation-style event representation (pitch/rhythm/dynamics) with synthesis/production parameter automation (filter cutoff, envelope shapes, effects sends, automation curves) in one diff-friendly document, or is this gap in prior art real and confirmed to be unfilled?
- What does a real, concrete git diff actually look like (line-by-line) for a small, common musical edit (a transposition, one added note, one rhythm change) in Csound .sco, LilyPond .ly, and Humdrum **kern files pulled from real repository history — this would validate or complicate the theoretical diff-friendliness claims made here.
- How commonly are SuperCollider Scores hand-authored/hand-edited as text files in real practice (vs. only programmatically generated), given the one claim addressing this was refuted rather than confirmed either way?

## Sources

- <https://csound.com/manual/score/parameter-fields/> — *primary*
- <https://docs.supercollider.online/Classes/Score.html> — *primary*
- <https://doc.sccode.org/Guides/Non-Realtime-Synthesis.html> — *primary*
- <https://flossmanual.csound.com/miscellanea/methods-of-writing-csound-scores> — *primary*
- <https://github.com/triss/nrt-sc> — *secondary*
- <http://qcpages.qc.cuny.edu/hhowe/music733.1/cssco.html> — *unreliable*
- <https://www.humdrum.org/rep/kern.html> — *primary*
- <https://www.humdrum.org/guide/ch05/> — *primary*
- <https://computational-cognitive-musicology-lab.github.io/humdrumR/articles/HumdrumSyntax.html> — *primary*
- <https://github.com/gregchapman-dev/musicdiff> — *primary*
- <https://dl.acm.org/doi/fullHtml/10.1145/3358664.3358671> — *unreliable*
- <https://ismir2008.ismir.net/papers/ISMIR2008_253.pdf> — *primary*
- <https://github.com/MutopiaProject/MutopiaProject> — *primary*
- <https://github.com/MutopiaProject/MutopiaProject/wiki/Updating-Lilypond-files-for-the-Mutopia-Project> — *secondary*
- <https://github.com/captbaritone/lilypond-hub> — *secondary*
- <https://github.com/adactio/TheSession-data> — *primary*
- <https://github.com/paulrosen/abcjs> — *primary*
- <https://github.com/xlvector/abcmidi> — *primary*
- <https://github.com/hundredrabbits/Orca> — *primary*
- <https://esolangs.org/wiki/Orca> — *secondary*
- <https://forum.renoise.com/t/rnsgit-wrapper-script-to-help-manage-versioning-songs-with-git/43667> — *forum*
- <https://csound.com/manual/score/genroutines/> — *primary*
- <https://github.com/bitwig/dawproject> — *primary*
- <https://vi-control.net/community/threads/using-git-for-daw-project-files.70709/> — *forum*
