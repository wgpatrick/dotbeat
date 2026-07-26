#!/usr/bin/env python3
"""dotbeat Composer's Assistant 2 figure sidecar (the showdown `ca2` figure source,
research/124 §A.4 "LLM-as-orchestrator", research/125 §4 "Integration shape").

Composer's Assistant 2 (Malandro, ISMIR 2024 — MIT code, public-domain/permissive training data)
is a multi-track MIDI *infilling* T5. It is a strong note-generator with no idea what the track
needs, so dotbeat wires it the way research/124 §A.4's evidence supports: **our deterministic
theory layer decides key / chord track / register / density, and CA2 only proposes the notes**.
This sidecar is the note-proposal half. It knows nothing about dotbeat — it takes a resolved
request (role, key, bpm, an already-built chord track, register, seed), builds a scaffold MIDI
whose CONTEXT track carries that harmony and whose TARGET track is empty, masks every measure of
the target, runs CA2, and prints the generated notes on a 16th-step grid. The TypeScript side
(src/taste/ca2.ts) owns the chord track, the register/scale guards, the lint, and the reseed loop.

Sixth sibling on the analyze.py / gen.py / embed.py / surge_render.py / midi_extract.py template:
stdlib-only top level, lazy heavy imports, JSON on stdout, chatter on stderr, exit codes 0/2/3/4,
`--doctor` probing deps with importlib only.

WEIGHTS NEVER ENTER THE REPO. CA2's checkout, its 716MB release weights, and the torch venv all
live outside it, located by env:

  BEAT_CA2_DIR      the `composers_assistant_v2` script dir (or any parent of it). Default: the
                    compose-lab trial location, <dotbeat>/../taste-dataset/compose-lab/tools/
                    ca2_release/Scripts/composers_assistant_v2 (research/125 §2).
  BEAT_CA2_MODEL    the fine-tuned T5 dir. Default: <ca2 dir>/models_permuted_labels/unjoined/
                    infill/finetuned_epoch_49_0/model
  BEAT_CA2_DEVICE   mps | cpu | cuda. Default: mps when available, else cpu.

(The INTERPRETER is chosen by the TS side via BEAT_CA2_PYTHON — this file just has to run under
one that has torch + transformers + miditoolkit + mido.)

CONTRACT

  --doctor                 probe deps + CA2 dir + weights; JSON on stdout, always exit 0
  --smoke                  --doctor plus ONE tiny real generation (the setup gate)
  --request <path>|-       generate; the request is JSON (`-` reads stdin):
      {"role":"bassline"|"chords"|"lead",
       "key":{"root":48,"minor":true,"mode":"natural-minor"},
       "bpm":124, "bars":4, "seed":7,
       "register":{"lo":36,"hi":55},
       "chordTrack":[{"bar":0,"bars":2,"root":48,"tones":[48,51,55]}, ...],
       "density":{"horiz":2,"vert":1},     # optional; defaults to the role's bins
       "temperature":1.0, "topP":0.85}     # optional
    stdout:
      {"backend":"ca2","contract":1,"model":"unjoined/infill/finetuned_epoch_49_0",
       "device":"mps","role":"bassline","seed":7,"bars":4,
       "notes":[{"start":0,"pitch":45,"duration":2,"velocity":0.85}, ...],
       "wallSeconds":0.9,"generatedNotes":9}
    `notes` are on the 16th-STEP grid (16 per bar, 0..bars*16-1), velocity normalized 0..1 —
    exactly the ComposedNote shape applyComposedPhrase consumes.

  exit: 0 ok - 2 usage/bad request - 3 CA2 dir/weights/deps missing - 4 generation unusable.

DETERMINISM: CA2 samples (top-p). `seed` is fed to torch.manual_seed immediately before generate,
so the same request + seed + device reproduces the same notes (verified in the TS integration
test). Different devices may differ — the device is reported in the payload.
"""

import argparse
import importlib.util
import json
import os
import sys
import time

CONTRACT_VERSION = 1

SETUP_FIX = (
    "Composer's Assistant 2 is an OUT-OF-REPO dependency (MIT code, 716MB release weights).\n"
    "  1. clone https://github.com/m-malandro/composers-assistant-REAPER and unzip the v2.1.0\n"
    "     release (composers.assistant.v.2.1.0.zip) somewhere outside the repo\n"
    "  2. point BEAT_CA2_DIR at its Scripts/composers_assistant_v2 directory\n"
    "  3. make a python3.10 venv with: pip install -r python/requirements-ca2.txt\n"
    "  4. point BEAT_CA2_PYTHON at that venv's python3\n"
    "  then: beat showdown --ca2-doctor"
)

STEPS_PER_BAR = 16  # the .beat 16th grid
TICKS_PER_BEAT = 480
TICKS_PER_STEP = TICKS_PER_BEAT // 4

ROLES = ("bassline", "chords", "lead")

# GM programs for the scaffold. The TARGET track's program tells CA2 what kind of voice it is
# filling in; the CONTEXT track's program tells it what it is playing against.
ROLE_TARGET_PROGRAM = {"bassline": 33, "chords": 0, "lead": 80}
ROLE_CONTEXT_PROGRAM = {"bassline": 0, "chords": 33, "lead": 0}

# Per-role density asks, as CA2 measurement BINS (constants.py: HORIZ_NOTE_ONSET_DENSITY_SLICES
# [0.5,1,2,4,4.5] onsets/beat, VERT_NOTE_ONSET_DENSITY_SLICES [1,2,3,4] notes/onset). This is the
# "our code decides density" half of §A.4: a bass rolls ~1-2 onsets a beat monophonically, chords
# land under 1 onset a beat as 3-note stacks, a lead runs 2-4 onsets a beat monophonically.
ROLE_DENSITY_BINS = {
    "bassline": {"horiz": 2, "vert": 1},
    "chords": {"horiz": 1, "vert": 3},
    "lead": {"horiz": 3, "vert": 1},
}


class UsageError(Exception):
    """Bad argv / malformed request — exit 2."""


class DependencyError(Exception):
    """CA2 dir, weights, or a python package is missing — exit 3."""


class GenerateError(Exception):
    """CA2 ran but produced nothing usable — exit 4."""


# ---- environment discovery ----------------------------------------------------------------------


def _repo_root():
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def default_ca2_dir_candidates():
    """Where the compose-lab trial (research/125 §2) left CA2, in preference order. The first two
    walk out of the repo (and out of a .claude/worktrees/<name> worktree) to the sibling private
    dataset dir; the last is the absolute owner-machine location."""
    root = _repo_root()
    tail = os.path.join("taste-dataset", "compose-lab", "tools", "ca2_release", "Scripts",
                        "composers_assistant_v2")
    return [
        os.path.abspath(os.path.join(root, "..", tail)),
        os.path.abspath(os.path.join(root, "..", "..", "..", "..", tail)),
        os.path.join(os.path.expanduser("~"), "Documents", "dotbeat", tail),
    ]


def _looks_like_ca2(path):
    return os.path.isfile(os.path.join(path, "encoding_functions.py")) and \
        os.path.isfile(os.path.join(path, "midisong.py"))


def resolve_ca2_dir():
    """The composers_assistant_v2 dir, or None. BEAT_CA2_DIR may point AT it or at any parent
    (the release zip nests it under Scripts/), so a couple of known sub-paths are probed too."""
    env = os.environ.get("BEAT_CA2_DIR", "").strip()
    candidates = []
    if env:
        candidates += [
            env,
            os.path.join(env, "composers_assistant_v2"),
            os.path.join(env, "Scripts", "composers_assistant_v2"),
            os.path.join(env, "ca2_release", "Scripts", "composers_assistant_v2"),
            os.path.join(env, "tools", "ca2_release", "Scripts", "composers_assistant_v2"),
        ]
    else:
        candidates += default_ca2_dir_candidates()
    for c in candidates:
        if _looks_like_ca2(c):
            return os.path.abspath(c)
    return None


def resolve_model_dir(ca2_dir):
    env = os.environ.get("BEAT_CA2_MODEL", "").strip()
    if env:
        return env
    if ca2_dir is None:
        return None
    return os.path.join(ca2_dir, "models_permuted_labels", "unjoined", "infill",
                        "finetuned_epoch_49_0", "model")


def _model_ready(model_dir):
    if model_dir is None or not os.path.isdir(model_dir):
        return False
    names = set(os.listdir(model_dir))
    has_weights = any(n.startswith("pytorch_model") or n.startswith("model.safetensors") for n in names)
    return has_weights and "config.json" in names


def _have(mod):
    try:
        return importlib.util.find_spec(mod) is not None
    except (ImportError, ValueError):
        return False


def resolve_device():
    env = os.environ.get("BEAT_CA2_DEVICE", "").strip()
    if env:
        return env
    try:
        import torch  # noqa: PLC0415
        if torch.backends.mps.is_available():
            return "mps"
        if torch.cuda.is_available():
            return "cuda"
    except Exception:
        pass
    return "cpu"


def doctor():
    ca2_dir = resolve_ca2_dir()
    model_dir = resolve_model_dir(ca2_dir)
    deps = {m: _have(m) for m in ("torch", "transformers", "miditoolkit", "mido")}
    missing = sorted(m for m, ok in deps.items() if not ok)
    report = {
        "backend": "ca2",
        "contract": CONTRACT_VERSION,
        "interpreter": sys.executable,
        "pythonVersion": "%d.%d.%d" % sys.version_info[:3],
        "ca2Dir": ca2_dir,
        "ca2DirFound": ca2_dir is not None,
        "modelDir": model_dir,
        "weightsFound": _model_ready(model_dir),
        "packages": deps,
        "missing": missing,
        "device": resolve_device() if deps["torch"] else None,
    }
    report["available"] = bool(report["ca2DirFound"] and report["weightsFound"] and not missing)
    if not report["available"]:
        report["fix"] = SETUP_FIX
    return report


# ---- scaffold MIDI -------------------------------------------------------------------------------


def _write_scaffold_midi(tracks, bpm, path):
    """tracks: [(program, [note...])]. Notes are on the 16th-step grid."""
    import mido  # noqa: PLC0415
    mid = mido.MidiFile(ticks_per_beat=TICKS_PER_BEAT)
    for program, notes in tracks:
        tr = mido.MidiTrack()
        mid.tracks.append(tr)
        tr.append(mido.MetaMessage("set_tempo", tempo=mido.bpm2tempo(int(round(bpm))), time=0))
        tr.append(mido.Message("program_change", program=int(program), time=0))
        events = []
        for n in notes:
            start = int(round(n["start"])) * TICKS_PER_STEP
            dur = max(1, int(round(n["duration"]))) * TICKS_PER_STEP
            vel = max(1, min(127, int(round(float(n.get("velocity", 0.8)) * 127))))
            pitch = int(n["pitch"])
            events.append((start, 1, pitch, vel))
            events.append((start + dur, 0, pitch, vel))
        events.sort(key=lambda e: (e[0], e[1]))
        t = 0
        for tick, kind, pitch, vel in events:
            tr.append(mido.Message("note_on" if kind else "note_off", note=pitch,
                                   velocity=vel if kind else 0, time=tick - t))
            t = tick
    mid.save(path)


def context_notes(role, chord_track, bars):
    """The harmonic CONTEXT CA2 composes against — our chord track, rendered as MIDI.

    For bass/lead the context is the chord track as sustained block voicings (the pad the figure
    plays over). For the chords role the block voicings ARE the answer, so the context is instead
    the chord ROOTS in the bass register — enough harmony to pin the progression without handing
    CA2 the voicing to copy."""
    notes = []
    for chord in chord_track:
        start = int(chord["bar"]) * STEPS_PER_BAR
        span = max(1, int(chord.get("bars", 1))) * STEPS_PER_BAR
        if start >= bars * STEPS_PER_BAR:
            continue
        span = min(span, bars * STEPS_PER_BAR - start)
        if role == "chords":
            root = int(chord["root"])
            while root >= 48:
                root -= 12
            # one root per BAR of the chord's span, so a 2-bar chord still marks every downbeat
            for b in range(0, span, STEPS_PER_BAR):
                notes.append({"pitch": root, "start": start + b, "duration": STEPS_PER_BAR, "velocity": 0.8})
        else:
            for tone in chord["tones"]:
                notes.append({"pitch": int(tone), "start": start, "duration": span, "velocity": 0.7})
    if not notes:
        raise UsageError("chordTrack produced no context notes")
    return notes


def placeholder_note(register):
    """CA2 needs the target track to EXIST in the input MIDI; one throwaway note in the target
    register creates it (research/125 §2 — the W2 accompaniment scaffold). Every measure is masked,
    so this note is never part of the output."""
    centre = int(round((int(register["lo"]) + int(register["hi"])) / 2))
    return [{"pitch": max(0, min(127, centre)), "start": 0, "duration": 1, "velocity": 0.3}]


# ---- request validation --------------------------------------------------------------------------


def validate_request(req):
    if not isinstance(req, dict):
        raise UsageError("request must be a JSON object")
    role = req.get("role")
    if role not in ROLES:
        raise UsageError("role must be one of %s (got %r)" % (", ".join(ROLES), role))
    bars = req.get("bars", 4)
    if not isinstance(bars, int) or bars < 1 or bars > 16:
        raise UsageError("bars must be an integer 1..16")
    seed = req.get("seed")
    if not isinstance(seed, int):
        raise UsageError("seed must be an integer")
    bpm = req.get("bpm", 120)
    if not isinstance(bpm, (int, float)) or not (20 <= bpm <= 300):
        raise UsageError("bpm must be a number 20..300")
    reg = req.get("register") or {}
    if not isinstance(reg, dict) or not isinstance(reg.get("lo"), int) or not isinstance(reg.get("hi"), int):
        raise UsageError("register must be {lo:int, hi:int}")
    if not (0 <= reg["lo"] < reg["hi"] <= 127):
        raise UsageError("register must satisfy 0 <= lo < hi <= 127")
    track = req.get("chordTrack")
    if not isinstance(track, list) or not track:
        raise UsageError("chordTrack must be a non-empty array")
    for i, chord in enumerate(track):
        if not isinstance(chord, dict):
            raise UsageError("chordTrack[%d] must be an object" % i)
        if not isinstance(chord.get("bar"), int) or chord["bar"] < 0:
            raise UsageError("chordTrack[%d].bar must be a non-negative integer" % i)
        if not isinstance(chord.get("root"), int):
            raise UsageError("chordTrack[%d].root must be an integer midi pitch" % i)
        tones = chord.get("tones")
        if not isinstance(tones, list) or not tones or not all(isinstance(t, int) for t in tones):
            raise UsageError("chordTrack[%d].tones must be a non-empty array of integer pitches" % i)
    density = dict(ROLE_DENSITY_BINS[role])
    given = req.get("density")
    if given is not None:
        if not isinstance(given, dict):
            raise UsageError("density must be {horiz:int, vert:int}")
        for k, hi in (("horiz", 5), ("vert", 4)):
            if k in given:
                v = given[k]
                if not isinstance(v, int) or not (0 <= v <= hi):
                    raise UsageError("density.%s must be an integer 0..%d" % (k, hi))
                density[k] = v
    return {
        "role": role,
        "bars": bars,
        "seed": seed,
        "bpm": float(bpm),
        "register": {"lo": reg["lo"], "hi": reg["hi"]},
        "chordTrack": track,
        "density": density,
        "temperature": float(req.get("temperature", 1.0)),
        "topP": float(req.get("topP", 0.85)),
    }


# ---- CA2 -----------------------------------------------------------------------------------------


class _CA2:
    """Lazily imported CA2 modules + the loaded T5. One per process."""

    def __init__(self):
        self.dir = resolve_ca2_dir()
        if self.dir is None:
            raise DependencyError("no Composer's Assistant 2 checkout found (set BEAT_CA2_DIR)")
        self.model_dir = resolve_model_dir(self.dir)
        if not _model_ready(self.model_dir):
            raise DependencyError("no CA2 weights at %s (set BEAT_CA2_MODEL)" % self.model_dir)
        missing = [m for m in ("torch", "transformers", "miditoolkit", "mido") if not _have(m)]
        if missing:
            raise DependencyError("missing python packages: %s" % ", ".join(missing))
        if self.dir not in sys.path:
            sys.path.insert(0, self.dir)
        import torch  # noqa: PLC0415
        import transformers  # noqa: PLC0415
        import constants as cs  # noqa: PLC0415
        import midisong as ms  # noqa: PLC0415
        import encoding_functions as enc  # noqa: PLC0415
        import preprocessing_functions as pre  # noqa: PLC0415
        import unjoined_vocab_tokenizer as ujt  # noqa: PLC0415
        import nn_str_functions as nns  # noqa: PLC0415
        self.torch, self.cs, self.ms, self.enc, self.pre, self.nns = torch, cs, ms, enc, pre, nns
        self.cpq = ms.extended_lcm(cs.QUANTIZE)          # 24
        self.clicks_per_step = self.cpq // 4             # a 16th = 6 clicks
        self.device = resolve_device()
        # No SentencePiece model ships in the release, so the pure-python unjoined tokenizer is
        # the supported path (research/125 §2).
        self.tok = ujt.UnjoinedTokenizer("unjoined_include_note_duration_commands")
        self.model = transformers.T5ForConditionalGeneration.from_pretrained(self.model_dir)
        self.model = self.model.to(self.device).eval()

    # -- commands ---------------------------------------------------------------------------------

    def track_measure_commands(self, bins, register, target_track, n_measures):
        """The "our code decides register/density" controls, per masked (track, measure) cell:
        loose lowest/highest note bounds from the theory layer's register, plus the caller's
        horizontal/vertical onset-density bins."""
        enc = self.enc
        cmd = (enc.instruction_str(int(register["lo"]), enc.ENCODING_INSTRUCTION_LOWEST_NOTE_LOOSE)
               + enc.instruction_str(int(register["hi"]), enc.ENCODING_INSTRUCTION_HIGHEST_NOTE_LOOSE)
               + enc.instruction_str(bins["horiz"], enc.MEASUREMENT_HORIZ_NOTE_ONSET_DENSITY)
               + enc.instruction_str(bins["vert"], enc.MEASUREMENT_VERT_NOTE_ONSET_DENSITY))
        return {(target_track, m): cmd for m in range(n_measures)}

    # -- generation -------------------------------------------------------------------------------

    def _pick_target_track(self, song, target_program):
        """CA2's loader may reorder/merge tracks, so the target is re-identified after loading:
        by GM program when that survives, else as the track with the fewest notes (the
        one-note placeholder)."""
        n = len(song.tracks)
        if n == 0:
            raise GenerateError("CA2 dropped every scaffold track")
        by_inst = [i for i in range(n) if getattr(song.tracks[i], "inst", None) == target_program]
        if len(by_inst) == 1:
            return by_inst[0]
        counts = []
        for i in range(n):
            total = sum(len(song.get_measure(measure_idx=m)[i].notes) for m in range(song.get_n_measures()))
            counts.append((total, i))
        counts.sort()
        return counts[0][1]

    def _decode(self, out_str, mask_locations, measure_lengths, bars):
        """Walk CA2's N/d/w instructions per extra_id back to 16th-grid notes."""
        notes = []
        by_eid = self.nns.instructions_by_extra_id(out_str)
        max_step = bars * STEPS_PER_BAR
        for eid, instrs in by_eid.items():
            if not eid.startswith("<extra_id_"):
                continue
            try:
                idx = int(eid[len("<extra_id_"):-1])
            except ValueError:
                continue
            if idx >= len(mask_locations):
                continue
            _track_i, measure_i = mask_locations[idx]
            pos = 0
            dur = self.clicks_per_step * 2  # default 8th
            mlen = measure_lengths[measure_i] if measure_i < len(measure_lengths) else self.cpq * 4
            for ins in instrs:
                parts = ins.split(":")
                if parts[0] == "d":
                    dur = int(parts[1])
                elif parts[0] == "w":
                    pos += int(parts[1])
                elif parts[0] == "N":
                    if pos >= mlen:
                        continue
                    start = measure_i * STEPS_PER_BAR + int(round(pos / self.clicks_per_step))
                    if start < 0 or start >= max_step:
                        continue
                    length = max(1, int(round(dur / self.clicks_per_step)))
                    notes.append({"pitch": int(parts[1]), "start": start,
                                  "duration": min(length, max_step - start), "velocity": 0.85})
        notes.sort(key=lambda n: (n["start"], n["pitch"]))
        return notes

    def generate(self, req, scratch_path):
        role, bars = req["role"], req["bars"]
        target_program = ROLE_TARGET_PROGRAM[role]
        _write_scaffold_midi(
            [(ROLE_CONTEXT_PROGRAM[role], context_notes(role, req["chordTrack"], bars)),
             (target_program, placeholder_note(req["register"]))],
            req["bpm"], scratch_path)
        song = self.pre.load_and_clean_midisongbymeasure_from_midi_path(scratch_path, quantize=None)
        n_measures = min(song.get_n_measures(), bars)
        if n_measures < 1:
            raise GenerateError("scaffold MIDI produced no measures")
        target = self._pick_target_track(song, target_program)
        mask = [(target, m) for m in range(n_measures)]
        s, _labels = self.enc.encode_midisongbymeasure_with_masks(
            song, mask_locations=mask, include_heads_for_empty_masked_measures=True,
            return_labels_too=False,
            track_measure_commands=self.track_measure_commands(req["density"], req["register"], target, n_measures))

        torch = self.torch
        torch.manual_seed(req["seed"])
        ids = torch.tensor([self.tok.Encode(s)], dtype=torch.long, device=self.device)
        out = self.model.generate(
            input_ids=ids, num_return_sequences=1, do_sample=True,
            temperature=req["temperature"], top_p=req["topP"], min_length=6, max_new_tokens=800,
            decoder_start_token_id=self.tok.pad_id(), pad_token_id=self.tok.pad_id(),
            bos_token_id=self.tok.bos_id(), eos_token_id=self.tok.eos_id(), use_cache=True)
        decoded = self.tok.Decode([x.item() for x in out[0][1:]])
        notes = self._decode(decoded, mask, song.get_measure_lengths(), bars)
        if not notes:
            raise GenerateError("CA2 generated no notes for role %s (seed %d)" % (role, req["seed"]))
        return notes


_INSTANCE = None


def ca2():
    global _INSTANCE
    if _INSTANCE is None:
        _INSTANCE = _CA2()
    return _INSTANCE


def run_request(req):
    import tempfile  # noqa: PLC0415
    engine = ca2()
    fd, scratch = tempfile.mkstemp(prefix="beat-ca2-", suffix=".mid")
    os.close(fd)
    try:
        t0 = time.time()
        notes = engine.generate(req, scratch)
        wall = time.time() - t0
    finally:
        try:
            os.remove(scratch)
        except OSError:
            pass
    return {
        "backend": "ca2",
        "contract": CONTRACT_VERSION,
        "model": os.path.basename(os.path.dirname(engine.model_dir)) or "ca2",
        "device": engine.device,
        "role": req["role"],
        "seed": req["seed"],
        "bars": req["bars"],
        "generatedNotes": len(notes),
        "wallSeconds": round(wall, 3),
        "notes": notes,
    }


SMOKE_REQUEST = {
    "role": "bassline",
    "key": {"root": 48, "minor": True},
    "bpm": 124,
    "bars": 2,
    "seed": 1,
    "register": {"lo": 36, "hi": 55},
    "chordTrack": [{"bar": 0, "bars": 1, "root": 48, "tones": [48, 51, 55]},
                   {"bar": 1, "bars": 1, "root": 53, "tones": [53, 56, 60]}],
}


def main(argv):
    p = argparse.ArgumentParser(prog="ca2_figures.py",
                                description="dotbeat Composer's Assistant 2 figure sidecar")
    p.add_argument("--doctor", action="store_true", help="probe CA2 dir, weights, and packages")
    p.add_argument("--smoke", action="store_true", help="--doctor plus one tiny real generation")
    p.add_argument("--request", help="path to a request JSON file, or - for stdin")
    args = p.parse_args(argv)

    if args.doctor or args.smoke:
        report = doctor()
        if args.smoke:
            if not report["available"]:
                report["smoke"] = {"ok": False, "error": "CA2 unavailable — see fix"}
            else:
                try:
                    out = run_request(validate_request(SMOKE_REQUEST))
                    report["smoke"] = {"ok": True, "notes": out["generatedNotes"],
                                       "wallSeconds": out["wallSeconds"], "device": out["device"]}
                except Exception as e:  # a smoke failure is a REPORT, not a crash
                    report["smoke"] = {"ok": False, "error": "%s: %s" % (type(e).__name__, e)}
                    report["available"] = False
                    report.setdefault("fix", SETUP_FIX)
        print(json.dumps(report))
        return 0

    if not args.request:
        raise UsageError("need --request <file.json|-> (or --doctor / --smoke)")
    raw = sys.stdin.read() if args.request == "-" else open(args.request, encoding="utf-8").read()
    try:
        req = json.loads(raw)
    except json.JSONDecodeError as e:
        raise UsageError("request is not valid JSON: %s" % e) from e
    print(json.dumps(run_request(validate_request(req))))
    sys.stdout.flush()
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except UsageError as e:
        print("usage error: %s" % e, file=sys.stderr)
        sys.exit(2)
    except DependencyError as e:
        print("dependency error: %s" % e, file=sys.stderr)
        print(SETUP_FIX, file=sys.stderr)
        sys.exit(3)
    except GenerateError as e:
        print("generate error: %s" % e, file=sys.stderr)
        sys.exit(4)
