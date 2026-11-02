// Validates a captured GhostMind framed-PCM stream (helper stdout):
// UInt32 LE payload length + Int16 mono 48 kHz PCM, every frame exactly
// 9,600 bytes (100 ms). Usage: node check-frames.js <file> [seconds]
const fs = require('fs');
const [file, secs] = process.argv.slice(2);
const buf = fs.readFileSync(file);
let off = 0, frames = 0, peak = 0;
while (off + 4 <= buf.length) {
  const n = buf.readUInt32LE(off);
  if (n !== 9600) { console.error(`bad frame size ${n} at offset ${off}`); process.exit(1); }
  if (off + 4 + n > buf.length) { console.error('truncated frame'); process.exit(1); }
  for (let i = off + 4; i < off + 4 + n; i += 2) {
    const v = Math.abs(buf.readInt16LE(i));
    if (v > peak) peak = v;
  }
  off += 4 + n; frames++;
}
if (off !== buf.length) { console.error(`${buf.length - off} trailing bytes`); process.exit(1); }
const want = parseInt(secs || '0', 10);
if (want && (frames < want * 7 || frames > want * 13)) {
  console.error(`frame count ${frames} out of range for ${want}s of audio`);
  process.exit(1);
}
console.log(`FRAMES ${frames} PEAK ${peak}`);
