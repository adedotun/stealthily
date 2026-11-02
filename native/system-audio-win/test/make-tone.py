# Writes a 3-second 440 Hz tone WAV (16 kHz mono) for CI smoke tests.
import math
import struct
import sys
import wave

path = sys.argv[1] if len(sys.argv) > 1 else "tone.wav"
rate = 16000
with wave.open(path, "wb") as w:
    w.setnchannels(1)
    w.setsampwidth(2)
    w.setframerate(rate)
    for i in range(rate * 3):
        v = int(0.5 * 32767 * math.sin(2 * math.pi * 440 * i / rate))
        w.writeframes(struct.pack("<h", v))
print("wrote", path)
