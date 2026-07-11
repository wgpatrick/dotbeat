# dotbeat CLI + MCP command surface (verified)

Verified 2026-07-11 by reading `cli/beat.mjs`'s own usage text (its `USAGE` constant, printed by
`beat help`/`beat --help`/no args) and `src/mcp/server.ts`'s `TOOLS` array directly, then
cross-checked live: `npm run build`, ran every non-render command below against a scratch
project, and drove the real MCP JSON-RPC protocol over stdio (`initialize` → `tools/list` →
`tools/call`) exactly the way `docs/agent-setup.md` did for Phase 10 — 27 tools came back, matching
the list below.

All commands: `node <dotbeat-repo>/cli/beat.mjs <command> ...` (or just `beat ...` if the CLI is on
PATH). Requires `npm run build` in the dotbeat checkout first — the CLI reads compiled `dist/`.

## Full CLI usage (verbatim from `cli/beat.mjs`'s `USAGE`)

```
beat init <file> [--bpm 120] [--bars 2]               a fresh project with one starter track
beat add-track <file> <id> <synth|drums|instrument> [--name N] [--color #hex] [--soundfont <sample-id> --program N]
beat rm-track <file> <id>
beat inspect <file> [--json]
beat set <file> <path> <value> [<path> <value> ...]     e.g. beat set song.beat lead.cutoff 900 bpm 124
beat add-note <file> <track> <pitch> <start> <duration> <velocity>
beat rm-note <file> <track> <note-id>
beat add-hit <file> <track> <lane> <start> <velocity>   free-timed drum hit (start in fractional 16th steps)
beat rm-hit <file> <track> <hit-id>
beat quantize <file> <track> [--grid 1] [--amount 1] [--ends] [--no-starts] [--notes id,id]
                                                        snap notes toward the grid (grid in 16th steps:
                                                        1=16ths 2=8ths 4=quarters 0.5=32nds; amount<1 = partial)
beat humanize <file> <track> [--timing 0.15] [--velocity 0.06] [--push-late 0] [--swing 0] [--seed N] [--lanes hat,oh | --ids a,b]
                                                        make a stiff part feel played: seeded timing/velocity
                                                        jitter, behind-the-beat drag, offbeat swing; scope by lane/id
beat diff <a.beat> <b.beat>
beat diff --git <rev1> <rev2> <file>
beat presets [--json]                                   list the factory preset library
beat preset <file> <track> <name>                       apply a preset to a track (a bag of set edits)
beat vary <file> <track> <group> [--count 9] [--amount 0.25] [--seed N] [--out-dir d] [--render]
                                                        batch-generate small-diff variants of one param group
beat vary <file> <track> feel [--count 9] [--seed N] [--timing .15] [--velocity .06] [--push-late 0] [--swing 0] [--lanes hat,oh | --ids a,b] [--render]
                                                        batch humanized FEEL variants (content variation) to audition + score
beat vary <file> <track> feel --scope selection --port <p> [...same feel flags, minus --lanes/--ids]
                                                        scope to the GUI selection held by a running daemon instead of
                                                        typing --lanes/--ids by hand (lanes -> --lanes, bars/notes -> --ids)
beat vary --groups                                      list the mutation groups
beat automate <file> <track> <clip> <param> <time> <value> [--id p1]
                                                        add or move a clip automation point (time in fractional
                                                        16th steps from the clip's start; --id moves that point
                                                        if it already exists, else adds it with that id)
beat clip <file> <track> <clip-id>                      snapshot the track's live content into a clip
beat scene <file> <scene-id> [<track>=<clip> ...]       create/replace a scene's slot map
beat song <file> [<scene> <bars> ...]                   replace the song timeline (empty = loop mode)
beat sample <file> <sample-id> <wav-path>               register media (sha256 computed for you; path relative to the .beat)
beat lane <file> <track> <lane> <sample-id|none> [gain] [tune]   back a drum lane with a sample
beat score <batch-dir> <pick> [pick2 pick3] [--log f]   record a ranked pick (<=3) into the scores log
beat suggest <file> <track> [--target <lane-or-id>] [--log f]
                                                        read the scores log and propose the next beat-vary round
beat metrics <file.wav> [--json]                        LUFS, true peak, crest, spectral, stereo
beat lint <file.wav> [--target <LUFS>] [--json]         deterministic mix findings (default target -14)
beat render <file> [-o out.wav] --beatlab-dir <path>    (or BEATLAB_DIR env)
beat render --offline <file> [-o out.wav]               real engine, no browser (see phase-4 notes)
beat daemon <file> [--port 8420]
beat checkpoint <file> [--label L] [--intent I]         save a restorable version (auto-labels from the diff)
beat history <file> [--limit N] [--collapsed]           list checkpoints, newest first (--collapsed folds
                                                        unnamed runs between pins into "N more checkpoints")
beat restore <file> <ref>                               go back to a checkpoint (append-only — never destroys work)
beat pin <file> <ref> <name...>                         name a checkpoint (<=25 chars), e.g. beat pin song.beat a1b2c3 rough mix v1
beat unpin <file> <name...>                              remove a pin by name
beat pins <file>                                        list this project's pins, newest checkpoint first
beat selection --port <p> [--set "<grammar>" | --clear]  read/set the GUI selection held by a running daemon
beat mcp                                                MCP server over stdio (all of the above as tools)
beat mcp-init <file> [--force]                          write a .mcp.json next to <file> so Claude Code
                                                        (or any MCP client) auto-discovers 'beat mcp' there

paths for set: bpm | loop_bars | selected_track | <track>.<synth param> | <track>.name |
               <track>.color | <track>.pattern.<lane>[<step>]
```

`beat diff` exit codes follow `diff(1)`: 0 = no musical changes, 1 = changes, 2 = error. `beat lint`
exits 1 if any finding is `warn` level, else 0 — usable in a script/loop.

## The full MCP tool list (27 tools, confirmed live)

`beat_init, beat_add_track, beat_rm_track, beat_inspect, beat_set, beat_add_note, beat_rm_note,
beat_add_hit, beat_rm_hit, beat_automate, beat_humanize, beat_quantize, beat_diff, beat_song,
beat_presets, beat_preset, beat_metrics, beat_lint, beat_selection, beat_render, beat_suggest,
beat_checkpoint, beat_history, beat_restore, beat_pin, beat_unpin, beat_pins`

Notes on the mapping (verified by reading each tool's `inputSchema`/`handler` in `src/mcp/server.ts`):

- `beat_set` takes `{ file, edits: [{path, value}, ...] }` — same batch-edit semantics as the CLI's
  `beat set file p1 v1 p2 v2`, just structured as an array instead of alternating positional args.
- `beat_song` covers what the CLI splits into three verbs (`beat clip`/`beat scene`/`beat song`) in
  one call: optional `clips`, `scenes`, `song` arguments, applied in that order. There is no
  separate `beat_clip`/`beat_scene` MCP tool.
- `beat_render` takes `offline` (boolean, default true) instead of a `--offline` flag, and
  `beatlab_dir` instead of `--beatlab-dir`/`BEATLAB_DIR`. See `references/render-metrics-loop.md`
  for the current environment caveat on whether this actually produces audio.
- `beat_humanize`/`beat_quantize` argument names are snake_case (`push_late`, `note_ids`) where the
  CLI flag is kebab-case (`--push-late`, `--notes`) — same semantics, different naming convention
  per surface (JSON args vs CLI flags).
- **No MCP tool exists for**: `beat vary`, `beat score`, `beat sample`, `beat lane`, `beat daemon`,
  `beat presets`/`beat preset`'s underlying library lookup is covered (`beat_presets`/`beat_preset`
  do exist), but the batch-variant/audition/scoring loop and media registration/assignment do not.
  Shell out to the CLI for these regardless of MCP connection state.
- `beat_checkpoint`'s description explicitly recommends passing the user's own request as `intent`
  — this is the MCP-native equivalent of `--intent`, and matters more here than on the CLI since an
  agent is the one deciding when to call it (see the main SKILL.md "checkpoints are NOT automatic"
  section).

## Verification method (for anyone re-checking this doc later)

```bash
npm run build
node cli/beat.mjs init /tmp/x/song.beat --bpm 120
node cli/beat.mjs inspect /tmp/x/song.beat
node cli/beat.mjs set /tmp/x/song.beat lead.cutoff 900 bpm 124
# ... etc, one real invocation per documented command family
```

For the MCP list, spawn `node cli/beat.mjs mcp`, write `initialize` +
`{"jsonrpc":"2.0","method":"notifications/initialized"}` + `{"jsonrpc":"2.0","id":2,"method":"tools/list"}`
to its stdin (newline-delimited JSON-RPC 2.0), and read the `result.tools` array back from stdout —
exactly the pattern `docs/agent-setup.md` used for Phase 10's own verification.
