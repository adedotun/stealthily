#!/usr/bin/env python3
"""Make a WAV fixture: 1s silence, a loud tone burst, 1s silence.
Good enough to exercise capture/segmentation plumbing end-to-end.
For a real transcription smoke test, record yourself instead:
  Say a known sentence into your mic, save as tests/sample.wav,
  then: python3 sidecar/transcribe_sidecar.py --file tests/sample.wav
"""
import wave, struct, math

SR = 16000
def frame(t, freq=None, amp=0.3):
    return int(32767 * amp * math.sin(2 * math.pi * freq * t)) if freq else 0

samples = []
for i in range(SR):        samples.append(frame(i / SR))                 # silence
for i in range(SR * 2):    samples.append(frame(i / SR, freq=220))       # tone
for i in range(SR):        samples.append(frame(i / SR))                 # silence

with wave.open("tests/tone_fixture.wav", "wb") as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes(b"".join(struct.pack("<h", s) for s in samples))
print("wrote tests/tone_fixture.wav")
