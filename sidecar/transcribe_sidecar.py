#!/usr/bin/env python3
"""
GhostMind local transcription sidecar.

Replaces the Chrome Helper (localhost:8844 + Google SpeechRecognition).
Protocol: JSON lines on stdin/stdout — no network port, no CORS, nothing
for another local page to talk to. One request per line:

  in : {"id": 1, "wav_base64": "...", "speaker": "them", "start_ms": 12340}
  out: {"id": 1, "speaker": "them", "start_ms": 12340,
        "text": "what was said", "avg_logprob": -0.31, "language": "en"}

Engine selection (first that imports):
  1. faster-whisper  (pip install faster-whisper) — CPU/GPU, any OS
  2. mlx-whisper     (pip install mlx-whisper)    — Apple Silicon native
Model: GHOSTMIND_WHISPER_MODEL env, default "base.en" (small.en is the
accuracy/latency sweet spot on M-series; tiny.en for a first smoke test).
The model downloads once, on first run, then works fully offline.

Mock engine for CI / plumbing tests only:
  GHOSTMIND_ASR_MOCK=1  -> returns {"text": "[mock transcript]"} without
  loading a model, so the capture -> segment -> IPC -> UI path can be
  tested end-to-end without a model download.

CLI smoke test:
  python3 transcribe_sidecar.py --file sample.wav --speaker them
"""
import sys, os, io, json, base64, argparse

MODEL = os.environ.get("GHOSTMIND_WHISPER_MODEL", "base.en")
MOCK = os.environ.get("GHOSTMIND_ASR_MOCK") == "1"

_engine = None

def load_engine():
    global _engine
    if _engine is not None or MOCK:
        return _engine
    try:
        from faster_whisper import WhisperModel
        _engine = ("faster-whisper", WhisperModel(MODEL, device="auto", compute_type="auto"))
    except Exception:
        try:
            import mlx_whisper  # noqa: F401
            _engine = ("mlx-whisper", None)  # stateless API, no model object
        except Exception as e:
            raise RuntimeError(
                "No local ASR engine found. Install one: "
                "pip install faster-whisper  (any OS)  or  "
                "pip install mlx-whisper  (Apple Silicon)"
            ) from e
    return _engine

def wav_bytes_to_float32(wav_bytes):
    """Decode 16-bit PCM WAV with the stdlib only -> float32 mono 16kHz array.
    Deliberately avoids PyAV (faster-whisper's decode_audio path): passing
    a numpy array is stable across PyAV versions, and our capture pipeline
    always produces WAV, so we lose nothing."""
    import wave, numpy as np
    with wave.open(io.BytesIO(wav_bytes), "rb") as w:
        frames = w.readframes(w.getnframes())
        channels, rate = w.getnchannels(), w.getframerate()
    audio = np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0
    if channels > 1:
        audio = audio.reshape(-1, channels).mean(axis=1)
    if rate != 16000 and len(audio) > 0:
        n = int(len(audio) * 16000 / rate)
        audio = np.interp(np.linspace(0, len(audio) - 1, n), np.arange(len(audio)), audio).astype(np.float32)
    return audio

def transcribe_wav_bytes(wav_bytes):
    if MOCK:
        return {"text": "[mock transcript]", "avg_logprob": None, "language": "en"}
    engine_name, model = load_engine()
    if engine_name == "faster-whisper":
        segments, info = model.transcribe(wav_bytes_to_float32(wav_bytes), beam_size=1, vad_filter=False)
        segs = list(segments)
        text = " ".join(s.text.strip() for s in segs).strip()
        logprob = (sum(s.avg_logprob for s in segs) / len(segs)) if segs else None
        return {"text": text, "avg_logprob": logprob, "language": getattr(info, "language", "en")}
    else:  # mlx-whisper needs a file path
        import tempfile, mlx_whisper
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
            f.write(wav_bytes); path = f.name
        try:
            model_ref = MODEL if "/" in MODEL else f"mlx-community/whisper-{MODEL}-mlx"
            result = mlx_whisper.transcribe(path, path_or_hf_repo=model_ref)
            return {"text": result["text"].strip(), "avg_logprob": None,
                    "language": result.get("language", "en")}
        finally:
            os.unlink(path)

def handle(req):
    wav = base64.b64decode(req["wav_base64"])
    result = transcribe_wav_bytes(wav)
    return {"id": req.get("id"), "speaker": req.get("speaker", "them"),
            "start_ms": req.get("start_ms", 0), **result}

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--file", help="transcribe one WAV file and exit")
    ap.add_argument("--speaker", default="them")
    args = ap.parse_args()

    if args.file:
        with open(args.file, "rb") as f:
            print(json.dumps({"speaker": args.speaker, **transcribe_wav_bytes(f.read())}))
        return

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
            out = handle(req)
        except Exception as e:  # never die on one bad segment
            out = {"error": str(e)}
            try: out["id"] = json.loads(line).get("id")
            except Exception: pass
        sys.stdout.write(json.dumps(out) + "\n")
        sys.stdout.flush()

if __name__ == "__main__":
    main()
