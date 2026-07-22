#!/usr/bin/env python3
"""dotbeat MIDI part-extraction sidecar (the showdown midi-figure source,
docs/source-showdown-eval.md "The midi figure source").

Reads a Standard MIDI File and extracts ONE musical part (bass / chords / lead) as a normalized
note list the TypeScript side (src/taste/midifig.ts) converts into a showdown ComposedPhrase.
Fifth sibling on the analyze.py / gen.py / embed.py / surge_render.py template: a tiny, dumb,
pure function of its inputs that knows NOTHING about dotbeat — the TS side owns validation, key
transposition, and the showdown clip pipeline.

WHY: the showdown eval entangles SOUND quality with the COMPOSITION quality of dotbeat's internal
archetype bank. Feeding it figures extracted from MIDI transcriptions of commercial tracks holds
composition at commercial quality so ratings compare sound realization only. The MIDI files
themselves are derivative works of copyrighted songs and live OUTSIDE the repo (private dataset
dir); this sidecar only ever reads a path it is handed.

CONTRACT (mirrors surge_render.py: stdlib-only top level, lazy mido import, JSON on stdout,
chatter on stderr, exit codes 0/2/3/4, --doctor probing deps with importlib only):

  --doctor                    probe mido availability (+ version)
  --scan --input f.mid        classify every voice (track x channel): stats + best-part guess —
                              the "does this file actually parse / what's in it?" tool
  --input f.mid --part bass   extract the part; JSON on stdout:
      {"backend":"midi","input",...,"part","picked":{track,channel,name},
       "bpm":124.0|null,"timeSignature":"4/4","totalBars":N,
       "window":{"startBar":8,"bars":4},
       "key":{"rootPc":9,"minor":true}|null,
       "notes":[{"pitch":45,"start":0,"duration":2,"velocity":0.72},...]}
      notes are quantized to 16th-note STEPS (16/bar, the .beat grid) relative to the window
      start; velocity is normalized 0..1. --bars picks the window length (4 or 8; default 4).

  exit: 0 ok - 2 usage/bad input - 3 mido missing - 4 file unparseable / no usable part.
"""

import argparse
import importlib.util
import json
import os
import sys

MIDO_FIX = "pip install -r python/requirements-midi.txt (installs mido into python/.venv)"

STEPS_PER_BAR = 16  # 16th-note grid, 4/4 — the .beat loop grid midifig.ts expects

MAJOR_SCALE = (0, 2, 4, 5, 7, 9, 11)
NATURAL_MINOR_SCALE = (0, 2, 3, 5, 7, 8, 10)

# name hints, lowercase substring match on the MIDI track name
PART_NAME_HINTS = {
    "bass": ("bass", "sub", "808"),
    "chords": ("chord", "pad", "piano", "keys", "rhodes", "epiano", "e-piano", "organ", "stab",
               "string", "guitar", "harmony", "comp"),
    "lead": ("lead", "melody", "arp", "pluck", "hook", "theme", "vocal", "voice", "bell",
             "flute", "saw", "synth"),
}
# a voice whose name matches these never carries a pitched part
NEGATIVE_NAME_HINTS = ("drum", "perc", "kick", "snare", "hat", "clap", "cymbal", "fx", "sfx",
                       "riser", "noise", "impact", "sweep")


class UsageError(Exception):
    """Bad argv / missing input — exit 2."""


class DependencyError(Exception):
    """mido isn't importable — exit 3."""


class ExtractError(Exception):
    """File unparseable, or no voice usable for the requested part — exit 4."""


def _mido_available():
    return importlib.util.find_spec("mido") is not None


def doctor():
    report = {"backend": "midi", "mido": {"available": _mido_available()}}
    if report["mido"]["available"]:
        try:
            import importlib.metadata as md  # noqa: PLC0415
            report["mido"]["version"] = md.version("mido")
        except Exception:
            report["mido"]["version"] = None
    else:
        report["mido"]["missing"] = ["mido"]
        report["mido"]["fix"] = MIDO_FIX
    return report


# ---- midi -> voices ----------------------------------------------------------------------------

def load_voices(path):
    """Parse the file into VOICES — one per (track, channel) pair that carries note events — plus
    file-level metadata. Notes come back as dicts with absolute tick start/duration. Channel 10
    (index 9, GM drums) voices are kept (for --scan honesty) but flagged percussive."""
    if not _mido_available():
        raise DependencyError("missing Python module 'mido'")
    import mido  # noqa: PLC0415

    try:
        mid = mido.MidiFile(path)
    except Exception as e:
        raise ExtractError(f"could not parse {path}: {e}")
    tpb = mid.ticks_per_beat or 480

    bpm = None
    time_sig = None
    voices = {}  # (track_idx, channel) -> {"name": str, "notes": [..]}
    for ti, track in enumerate(mid.tracks):
        tick = 0
        name = ""
        open_notes = {}  # (channel, pitch) -> (start_tick, velocity)
        for msg in track:
            tick += msg.time
            if msg.type == "track_name" and not name:
                name = msg.name.strip()
            elif msg.type == "set_tempo" and bpm is None:
                bpm = round(mido.tempo2bpm(msg.tempo), 2)
            elif msg.type == "time_signature" and time_sig is None:
                time_sig = f"{msg.numerator}/{msg.denominator}"
            elif msg.type == "note_on" and msg.velocity > 0:
                open_notes.setdefault((msg.channel, msg.note), []).append((tick, msg.velocity))
            elif msg.type == "note_off" or (msg.type == "note_on" and msg.velocity == 0):
                stack = open_notes.get((msg.channel, msg.note))
                if stack:
                    start, vel = stack.pop(0)
                    v = voices.setdefault((ti, msg.channel), {"name": name, "notes": []})
                    v["notes"].append({"pitch": msg.note, "tick": start,
                                       "ticks": max(1, tick - start), "velocity": vel})
        # notes never closed (truncated file): close them at track end
        for (ch, pitch), stack in open_notes.items():
            for start, vel in stack:
                v = voices.setdefault((ti, ch), {"name": name, "notes": []})
                v["notes"].append({"pitch": pitch, "tick": start,
                                   "ticks": max(1, tick - start), "velocity": vel})
        # a name meta arriving before any note lands on every voice of this track
        for key, v in voices.items():
            if key[0] == ti and not v["name"]:
                v["name"] = name

    out = []
    for (ti, ch), v in sorted(voices.items()):
        if not v["notes"]:
            continue
        v["notes"].sort(key=lambda n: (n["tick"], n["pitch"]))
        out.append({"track": ti, "channel": ch, "name": v["name"], "notes": v["notes"],
                    "percussive": ch == 9})
    if not out:
        raise ExtractError(f"{path}: no note events in any track")
    return {"voices": out, "ticksPerBeat": tpb, "bpm": bpm, "timeSignature": time_sig or "4/4"}


# ---- voice stats + part scoring ----------------------------------------------------------------

def voice_stats(voice, tpb):
    """Register / polyphony / sustain stats driving the part heuristics. Onsets within half a
    16th-step are one onset-group; a group of >=2 notes is a chord onset."""
    notes = voice["notes"]
    step = tpb / 4.0
    pitches = [n["pitch"] for n in notes]
    mean_pitch = sum(pitches) / len(pitches)
    var = sum((p - mean_pitch) ** 2 for p in pitches) / len(pitches)
    groups = []
    for n in notes:  # notes are tick-sorted
        if groups and n["tick"] - groups[-1][0] <= step / 2:
            groups[-1][1].append(n)
        else:
            groups.append((n["tick"], [n]))
    chord_groups = sum(1 for _, g in groups if len(g) >= 2)
    mean_group = len(notes) / len(groups)
    mean_dur_steps = sum(n["ticks"] for n in notes) / len(notes) / step
    last = max(n["tick"] + n["ticks"] for n in notes)
    return {
        "notes": len(notes),
        "meanPitch": round(mean_pitch, 1),
        "pitchStd": round(var ** 0.5, 2),
        "chordFrac": round(chord_groups / len(groups), 3),
        "meanChordSize": round(mean_group, 2),
        "meanDurSteps": round(mean_dur_steps, 2),
        "totalBars": max(1, int(last / (step * STEPS_PER_BAR)) + 1),
        "onsetGroups": len(groups),
    }


def _name_hit(name, part):
    low = name.lower()
    return any(h in low for h in PART_NAME_HINTS[part])


def part_scores(voice, stats):
    """Score this voice for each pitched part. Percussive channels and negative-named tracks are
    disqualified outright. Heuristics (task spec): bass = lowest monophonic-ish voice in bass
    register; chords = polyphonic voice with sustained simultaneous notes; lead = monophonic
    melodic voice in mid/high register."""
    low = voice["name"].lower()
    if voice["percussive"] or any(h in low for h in NEGATIVE_NAME_HINTS):
        return {"bass": -99.0, "chords": -99.0, "lead": -99.0}
    if stats["notes"] < 6 or stats["onsetGroups"] < 4:
        return {"bass": -99.0, "chords": -99.0, "lead": -99.0}
    mp, cf, cs = stats["meanPitch"], stats["chordFrac"], stats["meanChordSize"]

    bass = 3.0 * _name_hit(voice["name"], "bass")
    bass += max(0.0, min(3.0, (52.0 - mp) / 6.0))       # the lower the better; ~0 above E3
    bass += 2.0 if cf < 0.2 else (1.0 if cf < 0.4 else -1.0)  # monophonic-ish
    if mp > 55:
        bass -= 4.0                                      # not a bass register at all

    chords = 3.0 * _name_hit(voice["name"], "chords")
    chords += 2.0 if cf >= 0.5 else (1.0 if cf >= 0.3 else -2.0)  # simultaneous notes
    chords += min(2.0, max(0.0, cs - 1.0))               # bigger stacks score higher
    chords += 1.0 if stats["meanDurSteps"] >= 2.0 else 0.0  # sustained
    chords += 1.0 if 48 <= mp <= 76 else -1.0            # harmonic register

    lead = 3.0 * _name_hit(voice["name"], "lead")
    lead += 2.0 if mp >= 58 else -2.0                    # mid/high register
    lead += 2.0 if cf < 0.25 else -1.0                   # monophonic
    lead += 1.0 if stats["pitchStd"] >= 1.5 else 0.0     # actually melodic, not a drone
    return {"bass": round(bass, 2), "chords": round(chords, 2), "lead": round(lead, 2)}


MIN_PART_SCORE = 1.0  # a voice must clear this to be picked at all


def classify(loaded):
    """--scan payload: per-voice stats + scores + best-part label."""
    rows = []
    for v in loaded["voices"]:
        stats = voice_stats(v, loaded["ticksPerBeat"])
        scores = part_scores(v, stats)
        best = max(scores, key=lambda k: scores[k])
        rows.append({"track": v["track"], "channel": v["channel"], "name": v["name"],
                     "percussive": v["percussive"], **stats, "scores": scores,
                     "bestPart": best if scores[best] >= MIN_PART_SCORE else None})
    return rows


# ---- window + key ------------------------------------------------------------------------------

def best_window(notes, tpb, bars):
    """Densest contiguous `bars`-bar window (bar-aligned, onset count; earliest wins ties).
    Returns (startBar, notes-rebased-to-steps) with starts/durations quantized to 16th steps and
    clipped to the window."""
    step = tpb / 4.0
    total_steps = max(int(round((n["tick"] + n["ticks"]) / step)) for n in notes)
    total_bars = max(1, (total_steps + STEPS_PER_BAR - 1) // STEPS_PER_BAR)
    win_steps = bars * STEPS_PER_BAR
    best_start, best_count = 0, -1
    for start_bar in range(0, max(1, total_bars - bars + 1)):
        lo, hi = start_bar * STEPS_PER_BAR * step, (start_bar * STEPS_PER_BAR + win_steps) * step
        count = sum(1 for n in notes if lo <= n["tick"] < hi)
        if count > best_count:
            best_start, best_count = start_bar, count
    lo = best_start * STEPS_PER_BAR * step
    out = []
    seen = {}
    for n in notes:
        if not (lo <= n["tick"] < lo + win_steps * step):
            continue
        start = int(round((n["tick"] - lo) / step))
        if start >= win_steps:
            continue
        dur = max(1, min(int(round(n["ticks"] / step)), win_steps - start))
        key = (n["pitch"], start)
        if key in seen:  # duplicate onset (layered tracks) — keep the louder
            if n["velocity"] > seen[key]["velocity"]:
                seen[key]["velocity"] = n["velocity"]
            continue
        note = {"pitch": n["pitch"], "start": start, "duration": dur, "velocity": n["velocity"]}
        seen[key] = note
        out.append(note)
    out.sort(key=lambda n: (n["start"], n["pitch"]))
    return best_start, total_bars, out


def infer_key(voices):
    """Best-fit (rootPc, minor) over ALL pitched voices' pitch classes — the same score-the-scales
    approach as showdown.ts inferSeedKey, with the anchor bonus on the lowest voice's opening
    note. None when there are no pitched notes."""
    counts = [0] * 12
    lowest = None  # (meanPitch, first-note-pc)
    for v in voices:
        if v["percussive"]:
            continue
        pitches = [n["pitch"] for n in v["notes"]]
        if not pitches:
            continue
        for p in pitches:
            counts[p % 12] += 1
        mean = sum(pitches) / len(pitches)
        first = min(v["notes"], key=lambda n: (n["tick"], n["pitch"]))
        if lowest is None or mean < lowest[0]:
            lowest = (mean, first["pitch"] % 12)
    if not any(counts):
        return None
    anchor = lowest[1] if lowest else -1
    best = None
    for root in range(12):
        for minor, scale in ((False, MAJOR_SCALE), (True, NATURAL_MINOR_SCALE)):
            score = sum(counts[pc] for pc in range(12) if (pc - root) % 12 in scale)
            if root == anchor:
                score += 2
            if best is None or score > best[2]:
                best = (root, minor, score)
    return {"rootPc": best[0], "minor": best[1]}


def extract(path, part, bars):
    if part not in ("bass", "chords", "lead"):
        raise UsageError(f"--part must be bass, chords, or lead (got {part!r})")
    if bars not in (4, 8):
        raise UsageError(f"--bars must be 4 or 8 (got {bars})")
    loaded = load_voices(path)
    scored = []
    for v in loaded["voices"]:
        stats = voice_stats(v, loaded["ticksPerBeat"])
        scores = part_scores(v, stats)
        scored.append((scores[part], stats, v))
    scored.sort(key=lambda t: -t[0])
    score, stats, voice = scored[0]
    if score < MIN_PART_SCORE:
        raise ExtractError(f"{os.path.basename(path)}: no voice scores as a usable {part} part "
                           f"(best {score:.1f}; run --scan to see the classification)")
    start_bar, total_bars, notes = best_window(voice["notes"], loaded["ticksPerBeat"], bars)
    if len(notes) < bars:  # fewer than ~1 onset/bar is not a figure
        raise ExtractError(f"{os.path.basename(path)}: picked {part} voice is too sparse "
                           f"({len(notes)} notes in the best {bars}-bar window)")
    return {
        "backend": "midi",
        "input": os.path.abspath(path),
        "part": part,
        "picked": {"track": voice["track"], "channel": voice["channel"], "name": voice["name"],
                   "score": score},
        "bpm": loaded["bpm"],
        "timeSignature": loaded["timeSignature"],
        "totalBars": total_bars,
        "window": {"startBar": start_bar, "bars": bars},
        "key": infer_key(loaded["voices"]),
        "notes": [{**n, "velocity": round(n["velocity"] / 127.0, 3)} for n in notes],
    }


def main(argv):
    p = argparse.ArgumentParser(prog="midi_extract.py", description="dotbeat MIDI part-extraction sidecar")
    p.add_argument("--doctor", action="store_true", help="probe mido availability")
    p.add_argument("--scan", action="store_true", help="classify every voice in the file")
    p.add_argument("--input", help="path to a .mid file")
    p.add_argument("--part", help="bass | chords | lead")
    p.add_argument("--bars", type=int, default=4, help="window length in bars (4 or 8)")
    args = p.parse_args(argv)

    if args.doctor:
        print(json.dumps(doctor()))
        return 0
    if not args.input:
        raise UsageError("need --input <file.mid> (or --doctor)")
    if not os.path.isfile(args.input):
        raise UsageError(f"no file at {args.input}")
    if args.scan:
        loaded = load_voices(args.input)
        print(json.dumps({"backend": "midi", "input": os.path.abspath(args.input),
                          "bpm": loaded["bpm"], "timeSignature": loaded["timeSignature"],
                          "ticksPerBeat": loaded["ticksPerBeat"],
                          "key": infer_key(loaded["voices"]),
                          "voices": classify(loaded)}))
        return 0
    if not args.part:
        raise UsageError("need --part bass|chords|lead (or --scan)")
    print(json.dumps(extract(args.input, args.part, args.bars)))
    sys.stdout.flush()
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except UsageError as e:
        print(f"usage error: {e}", file=sys.stderr)
        sys.exit(2)
    except DependencyError as e:
        print(f"dependency error: {e}", file=sys.stderr)
        print(MIDO_FIX, file=sys.stderr)
        sys.exit(3)
    except ExtractError as e:
        print(f"extract error: {e}", file=sys.stderr)
        sys.exit(4)
