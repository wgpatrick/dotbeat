# openDAW: real-time collaboration, cloud storage, and versioning/sharing

> Source archaeology, same discipline as `docs/opendaw-notes.md`: read directly from
> `/private/tmp/dotbeat-scratch2/opendaw` (shallow clone, commit `de7565a`, 2026-07-11). Citations
> are real file paths, not summaries. Read `docs/opendaw-notes.md` first — this document covers
> the ground that pass explicitly did not: live collaboration mechanics, cloud storage, and
> versioning/sharing, the area most directly comparable to dotbeat's own thesis.

> **⚠️ License note**: openDAW is AGPL v3 / LGPL-3.0-or-later. Everything below is read for
> vocabulary, architecture, and product ideas (facts/ideas aren't copyrightable) — never for
> verbatim code. Treat as "read and reimplement," never "copy-paste."

## Sources read

- `docs/live-collab-conflict-resolve.md`, `docs/live-collab-deterministic-reconcile.md`,
  `docs/live-collab-fixes.md` (openDAW's own internal design docs, not marketing)
- `future-plans/nextcloud.md`, `future-plans/nextcloud-app.md` (unbuilt specs)
- `announcements/nextcloud.txt` (real, shipped-feature marketing copy — Discord/LinkedIn/
  newsletter drafts)
- `packages/studio/core/src/ysync/{YSync,YService,Reconcile,YMapper}.ts` — the live-collab engine
- `packages/studio/core/src/cloud/*.ts` — `CloudHandler`, `NextcloudHandler`, `DropboxHandler`,
  `GoogleDriveHandler`, `CloudAuthManager`, `SharedFolderSync`, `CloudBackup*`
- `packages/studio/core/src/sync-log/{SyncLogWriter,SyncLogReader,Commit}.ts` +
  `packages/app/studio/src/service/SyncLogService.ts` — a separate, unrelated-looking feature that
  turned out to be the single most git-like thing in the codebase
- `packages/studio/p2p/src/*.ts` — WebRTC asset transfer layer
- `packages/server/yjs-server/` — the hosted relay server (`server.js`, thin `y-websocket` wrapper)

---

## 1. How openDAW's live collaboration actually works

### 1.1 The split: small structured data goes through a CRDT relay; big binary assets go peer-to-peer

Two separate transports, easy to conflate but architecturally distinct:

- **The box graph** (every track/clip/note/parameter) syncs via **Yjs** (a Map/sequence CRDT)
  over a hosted WebSocket relay (`wss://live.opendaw.studio`, backed by
  `packages/server/yjs-server/server.js`, a thin wrapper around `y-websocket`). Confirmed in
  `packages/studio/core/src/ysync/YService.ts`: `getOrCreateRoom()` opens a `Y.Doc`, wraps it in
  `WebsocketProvider`, and either populates a fresh room from the local project or joins an
  existing one.
- **Audio assets** (samples, soundfonts — the megabyte-to-gigabyte payloads) transfer **directly
  peer-to-peer over WebRTC data channels**, never through the relay. `packages/studio/p2p/src/
  P2PSession.ts` wires an `AssetSignaling` channel (small signaling messages only, over the same
  relay infrastructure) to a `PeerAssetProvider`/`AssetServer` pair that does the actual chunked
  transfer (`ChunkProtocol.ts`, `AssetZip.ts`).

**Why this split matters as a lesson, independent of CRDTs**: openDAW deliberately keeps its
central server on the hook only for small, frequent, structured deltas, and pushes fat binary
payloads to a direct peer link. This is the same instinct behind git + git-lfs (small text deltas
in git proper, large binaries in a separate content store) — different mechanism, same shape of
problem, same shape of answer.

### 1.2 The actual problem CRDT convergence doesn't solve for free

Yjs guarantees every client converges on the same **document**. It has **no notion of the box
graph's referential invariants** — a pointer must resolve, an exclusive-target field accepts at
most one incoming pointer, a mandatory pointer may not dangle, no cycles
(`docs/live-collab-deterministic-reconcile.md`, "Problem" section, verbatim framing). Two edits
that are each locally valid can merge into a **document that is illegal for the graph.**

The first fix attempt (documented as superseded, not current): on a validation failure, revert the
whole incoming batch locally while leaving the shared Yjs doc untouched. Two flaws, both explicit
in the source doc:

1. **Over-broad** — one bad edge discards every unrelated edit in the batch.
2. **Non-deterministic** — each client reverts to a *different* local state, so peers **silently
   fork**: a live room where participants are editing what they believe is the same project but
   is no longer the same document, with no automatic path back to convergence. A real regression
   test (`YSyncCollab.test.ts`, exclusive-target case) reproduces this exact fork.

### 1.3 The fix: deterministic reconciliation ("repair, don't just reject")

The insight (`docs/live-collab-deterministic-reconcile.md`, "Key idea", paraphrased): you cannot
teach Yjs the graph's constraints — they live one layer above it. So instead of reverting to
per-client local history (impure, diverges), repair the illegal state with a function that is
**pure in the converged document**: given the same document `D` on every client, apply a
constraint-repair function using only data present on every client (UUIDs, field addresses —
**never** wall-clock time or arrival order), and every client computes the same repaired graph.
Convergence is restored by construction, not by luck.

Concrete implemented rule (`packages/studio/core/src/ysync/Reconcile.ts`,
`deterministicReconcile(boxGraph)`): on an exclusive-target overflow (two peers each pointed a new
edge at a slot that only accepts one), **keep the lowest-addressed incoming pointer, drop the
rest** — an arbitrary but *deterministic* tiebreak, not last-write-wins by wall-clock time (clocks
aren't trustworthy across peers) and not "whoever's update arrived first at this particular
client" (that's exactly the non-determinism that caused the fork).

**Known, explicitly documented limitation** (not swept under the rug in their own doc): repair
edits are currently *suppressed* from the shared Yjs doc rather than published back into it, so
each peer independently re-derives the same repair — sound only as long as exclusive attachments
are **append-only**. If a surviving attachment is later detached, live peers and a late joiner can
diverge, because the joiner re-derives the *next*-lowest loser from the (still over-specified) doc
while live peers already dropped it. The doc's own "Productionization roadmap" lists this as item
1 to fix (publish the repair into the doc, not just apply it locally) — i.e. **openDAW's own team
considers this shipped-but-not-finished**, a useful calibration point: even a team fully committed
to live collaboration, actively fixing convergence bugs, has an open, acknowledged correctness gap
in it as of this snapshot.

### 1.4 Transaction validity as an invariant, not a check

Underlying all of this: `BoxGraph` treats "the graph is always valid" as a hard invariant, not a
best-effort goal. Every `endTransaction()` validates affected boxes and **rolls back the entire
transaction** on failure — recorded updates are reversed via `update.inverse()`, UI-bound values
visibly snap back, and (for remote updates) the rollback is broadcast to peers as an inverse patch
(`docs/live-collab-conflict-resolve.md`). Strict validation is enforced deliberately: `#updateValue`
and `#deleteBox` **throw** rather than silently ignore a reference to a not-yet-arrived box, so
out-of-order delivery (B's edit referencing A's box arrives before A's box itself) is rejected and
retried rather than silently corrupting state. Dirty-tracking (`GraphEdges.#affected`, a sorted
UUID set) means validation only re-checks the boxes actually touched by a transaction, not the
whole graph — a real scale concession (a graph of 2000+ boxes, one touching 5).

Undo/redo in a live room is handled honestly rather than pretended away: a history step can become
invalid because another participant changed the graph underneath it. openDAW's answer is a visible
dialog — *"This history step is no longer valid due to changes from other participants"* — rather
than silently discarding or silently succeeding with wrong results
(`docs/live-collab-conflict-resolve.md`, "Undo/Redo in Live Rooms"). The invalid step stays in the
stack and can become valid again later if the conflicting change is itself undone.

### 1.5 A running bug log, not a finished feature

`docs/live-collab-fixes.md` is a live incident log (RTCDataChannel `send()` on a closed channel
during a 261 MB soundfont transfer, backpressure races, etc.) — useful mainly as confirmation that
**P2P + CRDT collaboration in a browser is genuinely hard to make production-solid**, with real
production incidents from real usage, not theoretical edge cases. Worth citing when weighing "how
much would dotbeat have to build to do this too" — the honest answer, from openDAW's own logs, is
"a lot, continuously."

---

## 2. The cloud storage model — genuinely more than "Nextcloud"

The research brief's framing ("Nextcloud integration") undersells what's actually in the source.
There are **three separate, source-confirmed cloud features**, not one:

### 2.1 `CloudHandler` — a real storage-agnostic interface, three implementations shipped

`packages/studio/core/src/cloud/CloudHandler.ts` is a five-method interface —
`upload/exists/download/list/delete/alive` — implemented by `NextcloudHandler.ts`,
`DropboxHandler.ts`, and `GoogleDriveHandler.ts` (all present as real, non-stub source, not just
planned). `CloudAuthManager.ts` handles OAuth (PKCE flow for Dropbox, implicit flow for Google
Drive) uniformly and memoizes the resulting handler per service for an hour. **This confirms the
brief's "bring your own storage" framing as real architecture, not aspiration**: the sync/backup
logic above it (`SharedFolderSync`, `CloudBackup*`) is written once against `CloudHandler` and
works unmodified against any of the three backends.

`NextcloudHandler.ts` is the most detailed implementation — WebDAV over `PROPFIND`/`MKCOL`/`PUT`/
`MOVE`, with Nextcloud's chunked-upload-v2 protocol for files over 10 MB (soundfonts are
routinely 50MB+), retry-with-backoff on transient 423/502/503/504 (423 = Nextcloud's own WebDAV
file lock), and a local-collection cache so bulk asset uploads don't re-`PROPFIND` every sibling.

### 2.2 `SharedFolderSync` — the actual dedup + catalog mechanism (this is what "nothing gets uploaded twice" means in code)

`packages/studio/core/src/cloud/SharedFolderSync.ts` is the real implementation behind the
announcement copy's "samples and soundfonts are stored once and reused across projects." Layout,
straight from the file's own header comment:

```
openDAW/index.json                                    — catalog of projects
openDAW/projects/<uuid>/{project.od, meta.json, image.bin}
openDAW/assets/samples/<uuid>/{audio.wav, peaks.bin, meta.json}      — shared, uploaded once
openDAW/assets/soundfonts/<uuid>/{soundfont.sf2, meta.json}          — shared, uploaded once
```

Mechanics worth naming individually:

- **Dedup is by content-addressed UUID, checked against the catalog, not by probing folders.**
  `index.json` is the source of truth for what's already uploaded; an asset is only recorded as
  present once it's actually confirmed uploaded (a failed upload is left out and silently retried
  next save — "self-healing" in the code's own comment, never a false claim that an asset exists).
- **Reference-counted garbage collection.** The catalog tracks which asset UUIDs each project
  references (`CatalogEntry.samples`/`.soundfonts`); deleting or re-saving a project recomputes
  the "live set" across *all* projects and only deletes assets no project references anymore
  (`collectLiveAssets`, `deleteOrphans`, `existingOrphans`). Partial-write safety: a failed asset
  upload deletes its own partial folder rather than leaving a half-written asset that looks
  complete.
- **A do-not-touch guard for humans.** `SharedFolderSync` writes a `README.txt` into the shared
  root on first use, warning that manual edits will corrupt the catalog's bookkeeping — an honest
  acknowledgment that a shared filesystem folder with an out-of-band index file is fragile if a
  human "helps" by hand.

### 2.3 `CloudBackup` — a second, different feature: whole-library mirror with an advisory lock

Distinct from `SharedFolderSync` (which syncs one project's dependency closure), `CloudBackup.ts`
mirrors the user's *entire* local library — samples, projects, templates, soundfonts, presets, via
five sub-modules (`CloudBackupSamples.ts` etc.) — to Dropbox or Google Drive. The interesting part
for dotbeat: **it does not attempt live conflict resolution at all.** It uses a plain
**advisory lock file** (`lock.json`: `{id: <browser-instance-id>, created: <timestamp>}`). If a
lock already exists and belongs to a different browser instance, the user is shown the lock's age
and asked to wait or explicitly ignore it — with a plain-language warning that ignoring a live
lock "can cause the cloud data to become inconsistent." No CRDT, no merge — just mutual exclusion
plus an honest warning when you override it.

### 2.4 The Nextcloud positioning: shipped generic connect vs. unbuilt classroom app — two different things

Read carefully, these are **not the same feature at two stages** — they're two different features,
one shipped, one only spec'd:

- **Shipped today** (confirmed by real source: `NextcloudHandler.ts` + `SharedFolderSync.ts`, plus
  marketing copy in `announcements/nextcloud.txt`): a generic "connect your own Nextcloud" flow.
  Any user with a self-hosted Nextcloud instance and an app password can browse/save/open projects
  there, with the shared-folder dedup described in §2.2. Positioning, verbatim from the real
  announcement drafts: **"Nothing passes through our servers,"** **"Your files stay yours,"** and
  (LinkedIn draft) **"No vendor lock-in: projects live on the school's own Nextcloud, never on
  openDAW's servers."**
- **Not built — a spec only** (`future-plans/nextcloud-app.md`, `future-plans/nextcloud.md`): a
  *separate*, purpose-built Nextcloud server-side app for classrooms — per-student Nextcloud
  accounts (real identity, real isolation, "auth comes for free"), a teacher view that reads all
  student folders, template distribution ("Upload to..." → student gets a copy, teacher's original
  stays read-only), teacher notification on submission, and a **shared, deduplicated, app-owned
  asset store that students cannot write to directly** (dedup *and* tamper-safety from the same
  design choice: students can't delete or overwrite what they didn't create). The doc is
  refreshingly concrete about cost: **4-8 weeks server-side + 1-2 weeks studio-side for an MVP**,
  with the honest caveat that Nextcloud's own major-version churn is an ongoing maintenance tax,
  not a one-time cost. This is a real product spec, not vaporware framing — but it is **unbuilt**,
  and should be cited as "planned/speculative," not "shipped," if referenced elsewhere.

### 2.5 A third, unrelated-looking thing that's actually the most git-like idea in the codebase: the Sync Log

`packages/studio/core/src/sync-log/{Commit,SyncLogWriter,SyncLogReader}.ts` +
`packages/app/studio/src/service/SyncLogService.ts` implement an **opt-in, hash-chained,
append-only local event log** (`.odsl` files), unrelated to live collaboration or cloud storage —
it's a local-disk feature using the File System Access API. Every transaction on the box graph
becomes a `Commit` (`prevHash`/`thisHash` chained via SHA-based `Hash.fromBuffers`, à la a git
commit's parent pointer) containing the update payload; commits are appended to the open file live
as the user edits (`SyncLogWriter`), and `SyncLogReader.unwrap()` replays the whole chain from a
snapshot `Init` commit forward to reconstruct the project. It is exposed in the UI as an explicit
"Start Sync Log" / "Append to Sync Log" action — **not the default save path**, an opt-in
recording feature, and (per its own `CommitType` doc comment) currently a "WASM CONTRACT" whose
wire format is asserted byte-for-byte by a Rust reader — i.e. explicitly not designed as a
human-readable format, consistent with `docs/opendaw-notes.md` §5's finding about the main
project bundle.

**Why this belongs in this document despite not being "collaboration" or "cloud":** it's the
closest thing in openDAW's own codebase to dotbeat's checkpoint/history model (D3/D10) — a
verifiable, hash-linked, replayable sequence of transactions — built for a completely different
reason (session recording / debugging / maybe future undo-across-sessions, not stated) and with a
deliberately opaque wire format. It independently validates D8's instinct (a `Modification`/
`Update` *is* a computed diff, reusable as the one representation for undo, sync-log, and — for
us — `beat diff`), while also reinforcing §5's lesson: openDAW, even when building something
git-shaped, still didn't reach for diff-friendly text.

---

## 3. What's fundamentally incompatible with dotbeat's thesis vs. genuinely separable

**Say this plainly, as instructed:** dotbeat adopting real-time collaboration wholesale — a hosted
relay server, a CRDT layer over the `.beat` document, WebRTC asset transfer, live presence — would
mean **becoming a different product**. It's not a feature to bolt on; it's the mechanism ROADMAP.md
§1 explicitly defines dotbeat *against* ("this is not real-time collaborative, that's a different
bet"). Running a hosted relay server alone is a different cost structure and support burden than a
local-first tool with no server at all. Don't soft-pedal this: sections 1.2-1.5 above describe a
real, ongoing, non-trivial engineering investment (a whole conflict-resolution research thread with
its own acknowledged open bugs) that only exists *because* the document is live-shared. A git-merge
model has none of that class of problem, and no server, by construction — that tradeoff was already
made correctly.

What *is* separable — genuinely independent of the live-sync mechanism, and worth dotbeat's
attention:

1. **The dedup/catalog pattern (§2.2)** is pure asset-management design, orthogonal to how the
   *project* itself syncs. It answers a question dotbeat also has: "if the same sample is
   referenced by five projects, how do we avoid five copies?" This maps directly onto dotbeat's
   own content-addressed media plan (`docs/opendaw-notes.md` §4's SHA-256-derived asset IDs) and
   D11's git-lfs media handling — git-lfs already dedupes identical blobs by content hash within
   one repo, but openDAW's catalog-with-reference-counted-GC pattern is a real answer to a
   question git-lfs itself doesn't solve: *lifecycle* (when is an asset safe to actually delete
   from storage, across multiple projects that may or may not still reference it).
2. **The advisory-lock pattern (§2.3)** is a real, low-tech answer to "prevent concurrent
   corruption without solving live merge" — directly analogous to `git lfs lock` (which dotbeat
   doesn't currently use, per D11) for exactly the class of asset git-lfs can't diff/merge
   meaningfully (binary samples). Worth a closer look independent of anything else in this
   document.
3. **`CloudHandler`'s storage-agnostic interface (§2.1)** is a clean abstraction lesson regardless
   of whether dotbeat ever needs it: define upload/download/list/delete/exists once, swap backends
   freely. If dotbeat ever wants "sync my `.beat` project folder to a drive I already pay for" as
   a *convenience* feature (explicitly not live collaboration — more like Dropbox syncing a folder
   of files, where git's own history is what handles versioning, not the sync layer), this is the
   right shape to copy.
4. **The transport split (§1.1) as a general lesson**, even without adopting live collab: keep
   small structured deltas on a cheap/free path, keep fat binaries on a separate one. dotbeat
   already does a version of this (git for `.beat` text, git-lfs for media) — openDAW's
   architecture is independent confirmation this split is the right one, not evidence dotbeat is
   missing something.
5. **Surfacing invalid/conflicting state honestly to the user (§1.4)**, as a *UX* lesson
   transferable to git-merge conflicts specifically, not the CRDT mechanism that produces it. The
   transferable idea is narrow but real: when a user's action becomes invalid because of concurrent
   changes, say so in plain language ("this history step is no longer valid due to changes from
   other participants") rather than silently discarding it or silently "resolving" it. For dotbeat,
   the analogous moment is a `git merge` conflict on a `.beat` file — today that's whatever raw
   conflict markers `git merge` produces on a text file with dotbeat's own line-oriented, ID-stable
   format (D4/D7). openDAW's lesson isn't "how to resolve it" (CRDT reconciliation doesn't apply to
   a merge workflow at all) — it's "translate the conflict into musical language before showing a
   musician a diff," which is exactly the instinct D8 already commits to for the diff view generally
   (`DiffEntry` phrased as "note moved," "kick step 3 added," not raw text). Extending that same
   phrasing to *merge conflicts specifically* (e.g. `beat merge --explain` narrating "both branches
   changed `trk_bass.cutoff`: main=1200Hz, other=800Hz" instead of raw `<<<<<<<` markers) is a small,
   concrete, separable idea worth scoping.
6. **The Sync Log's hash-chain-of-transactions idea (§2.5)** independently validates D8's existing
   direction rather than adding a new one — noted for completeness, not a new recommendation.

---

## 4. Candidate features for dotbeat

| Feature | One-line description | Adopt / Adapt / Skip | Reasoning |
|---|---|---|---|
| Live multi-user real-time editing (CRDT + relay server) | Yjs box-graph sync + WebRTC asset transfer, Google-Docs-style co-editing | **Skip** | Directly contradicts ROADMAP.md §1's thesis; requires a hosted server, a CRDT layer, and — per openDAW's own bug log (§1.5) — ongoing, non-trivial correctness engineering. Would make dotbeat a different product, not a superset. |
| Deterministic-reconcile-style conflict *philosophy* ("repair using only data every peer has, never wall-clock/arrival-order") | The specific CRDT-repair technique in §1.3 | **Skip** | The technique only exists to solve a CRDT-specific problem (referential-integrity violations from concurrent live edits). dotbeat's concurrency model is `git merge`, which is a different problem with a different, already-adequate toolset (three-way merge, conflict markers). No adaptation surface. |
| Musical-language conflict narration for `git merge` conflicts on `.beat` files | `beat merge --explain` (or similar) narrates a merge conflict in the same phrasing D8 already uses for diffs ("both changed trk_bass.cutoff: 1200Hz vs 800Hz") instead of raw `<<<<<<<` markers | **Adapt** | This is the one real UX transfer from live-collab's "always surface conflicts honestly" lesson (§1.4/§3.5) that fits dotbeat's actual mechanism. Low cost, reuses `DiffEntry` (D8) unchanged — just needs a merge-conflict-shaped input instead of a two-commit-diff-shaped one. |
| Content-addressed, reference-counted asset catalog with GC | `index.json`-style catalog tracking which assets each project references; delete/GC only what's orphaned across *all* projects (§2.2) | **Adapt** | Directly relevant to D11's git-lfs media handling. git-lfs already dedupes by content hash *within* one repo; it has no native answer to "is this LFS object still referenced by any project on this machine," which becomes a real question once dotbeat users accumulate many `.beat` projects sharing sample libraries. Worth a `beat lfs gc`-style command later, not urgent now. |
| Advisory lock file for non-live shared storage | A `lock.json`-style mutex (owner id + timestamp) warning a second writer instead of attempting live merge (§2.3) | **Adapt** | Maps directly onto `git lfs lock` (unused today per D11) for binary media specifically — the one part of a `.beat` project git genuinely can't diff/merge. Worth adopting the *pattern* (soft lock + honest override warning) via git-lfs's existing locking feature rather than inventing a new mechanism. |
| Storage-agnostic `CloudHandler`-style interface (Nextcloud/Dropbox/GDrive via one interface) | One upload/download/list/delete/exists interface, three backends (§2.1) | **Adapt, later** | Real architecture lesson if dotbeat ever ships a "sync my project folder to a drive I already pay for" convenience feature for multi-machine use — explicitly *not* live collaboration, just folder sync, with git itself still owning history/versioning. Not scoped or requested today; noted as the right shape if/when it is. |
| "Nothing passes through our servers" / self-hosted-storage positioning | Marketing framing: user's files never touch the vendor's infrastructure (§2.4) | **Adopt (already true, restate it)** | dotbeat is local-file-first with no server at all today — this positioning already applies more strongly to dotbeat than to openDAW (which still runs a relay server for live collab even though asset storage is BYO). Worth stating explicitly in dotbeat's own marketing/positioning docs as a differentiator, since openDAW proves this message resonates enough to be a dedicated announcement. |
| Per-user isolated storage / classroom multi-tenancy (unbuilt Nextcloud classroom app) | Per-student accounts, teacher distribution/template flow, teacher-notification-on-submit (§2.4) | **Skip (for now)** | Solves a specific classroom-multi-tenant problem dotbeat doesn't have a stated audience for yet, and — worth noting — this exact feature is *unbuilt* in openDAW too (spec only, 4-8 week estimate). Not evidence of a validated need, just a documented idea. Revisit only if dotbeat ever targets an education/team use case. |
| Hash-chained local transaction log (`.odsl` Sync Log) as a *second*, separate history mechanism | Every transaction appended as a hash-linked commit to a local file, replayable (§2.5) | **Skip (redundant)** | dotbeat's D3/D10 git-backed checkpoint model already provides hash-chained, replayable history (git commits) with the added benefit of being a real, tool-compatible format — building a bespoke parallel log would duplicate what git already gives for free. The only genuinely new idea here (Update-as-diff) is already captured by D8. |
| Chunked upload for large binary assets over HTTP (Nextcloud chunked-upload-v2 pattern) | Split >10MB uploads into chunks with resumable assembly (§2.1) | **Skip (not applicable)** | Solves an HTTP-upload-to-a-remote-server problem. dotbeat's media files live on local disk and sync via git-lfs, which has its own transfer/chunking behavior already. No current surface where dotbeat pushes large binaries over raw HTTP. |

---

## What changes in dotbeat's plan

Nothing here argues for a course correction — no adjacent decision (D3/D10/D11) is challenged by
this pass. The findings sharpen two things already in flight:

1. **D11 (git-lfs for binary media)** gets a concrete next step worth scoping later: a
   reference-counted GC command (openDAW's catalog pattern, adapted) and/or adopting `git lfs lock`
   (openDAW's advisory-lock pattern, adapted) — both deferred, not urgent, noted for a future
   session rather than acted on now.
2. **D8 (DiffEntry as the one changeset representation)** gets a concrete extension idea — reusing
   the same musical-language phrasing for `git merge` conflicts specifically, not just diffs — worth
   a line in a future roadmap pass, not implemented here (pure research, no code touched).

No new open decision is proposed; the strongest overall finding is negative-but-useful: openDAW's
live-collaboration investment is real, ongoing, and *still has open, acknowledged correctness gaps*
even in a codebase fully committed to it — the sharpest evidence yet, from the closest competitor's
own internal bug tracker, that dotbeat's git-merge bet avoided an entire, expensive class of problem
by construction rather than by luck.
