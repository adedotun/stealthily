'use strict';
// GhostMind RENDERER: dual-track local capture.
//
// This is the piece the Chrome Helper could never do: pick the EXACT
// audio device per track, inside Electron, instead of relying on
// Chrome's default microphone.
//
//   track "you"  -> your real microphone (deviceId chosen by the user)
//   track "them" -> the Loopback Audio / BlackHole device that carries
//                   the call (deviceId chosen by the user)
//
// Each track: getUserMedia -> AudioContext(16kHz) -> AudioWorklet ->
// Segmenter -> WAV segment -> IPC 'transcribe-local-segment'.
// Main replies on 'external-transcript', same as the old helper flow.
//
// Requires segmenter.js and wav.js loaded before this file
// (renderer globals Segmenter, float32ToWavBase64), or bundling.

const WORKLET_SRC = `
class PCMTap extends AudioWorkletProcessor {
  constructor() { super(); this.buf = []; this.frame = 1600; } // 100ms @ 16kHz
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      for (let i = 0; i < ch.length; i++) this.buf.push(ch[i]);
      while (this.buf.length >= this.frame) {
        const frame = this.buf.splice(0, this.frame);
        this.port.postMessage(new Float32Array(frame));
      }
    }
    return true;
  }
}
registerProcessor('pcm-tap', PCMTap);
`;

class LocalCapture {
  // sendSegment: ({wavBase64, speaker, startMs}) => Promise<any>
  // onStream (optional): (stream, speaker) => void — lets the UI wire a
  // waveform analyser to a track without the capture layer knowing why.
  constructor({ sendSegment, onStream }) {
    this.sendSegment = sendSegment;
    this.onStream = onStream || null;
    this.tracks = [];
  }

  static async listAudioInputs() {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter(d => d.kind === 'audioinput');
    // Pick: you  = the mic whose label matches your headset
    //       them = label containing 'Loopback' or 'BlackHole'
  }

  async startTrack({ deviceId, speaker }) {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { deviceId: { exact: deviceId }, echoCancellation: false,
               noiseSuppression: false, autoGainControl: false },
    });
    // NOTE: processing stays OFF. The call feed must reach Whisper raw;
    // echoCancellation/noiseSuppression are tuned for a human voice in
    // a room and mangle system audio.
    const ctx = new AudioContext({ sampleRate: 16000 });
    const url = URL.createObjectURL(new Blob([WORKLET_SRC], { type: 'application/javascript' }));
    await ctx.audioWorklet.addModule(url);
    const source = ctx.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(ctx, 'pcm-tap');
    const segmenter = new Segmenter({
      speaker, sampleRate: 16000,
      onSegment: (seg) => {
        const wavBase64 = float32ToWavBase64(seg.samples, seg.sampleRate);
        this.sendSegment({ wavBase64, speaker: seg.speaker, startMs: seg.startMs })
          .catch(e => console.error('[capture] segment failed', e));
      },
    });
    segmenter.startedAtMs = performance.now();
    if (this.onStream) { try { this.onStream(stream, speaker); } catch (_) {} }
    node.port.onmessage = (ev) => segmenter.push(ev.data);
    source.connect(node); // do NOT connect to ctx.destination — no playback
    this.tracks.push({ stream, ctx, segmenter, speaker });
  }

  async start({ youDeviceId, themDeviceId }) {
    if (youDeviceId)  await this.startTrack({ deviceId: youDeviceId,  speaker: 'you' });
    if (themDeviceId) await this.startTrack({ deviceId: themDeviceId, speaker: 'them' });
  }

  stop() {
    for (const t of this.tracks) {
      t.segmenter.end();
      t.stream.getTracks().forEach(tr => tr.stop());
      t.ctx.close();
    }
    this.tracks = [];
  }
}

if (typeof window !== 'undefined') window.LocalCapture = LocalCapture;
if (typeof module !== 'undefined') module.exports = { LocalCapture, WORKLET_SRC };
