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
  constructor({ sendSegment, onStream, onTrackError }) {
    this.sendSegment = sendSegment;
    this.onStream = onStream || null;
    // v3.5.6: per-track start failures are reported instead of taking
    // the whole capture down (or worse, failing silently).
    this.onTrackError = onTrackError || null;
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
    const track = { stream, ctx, segmenter, speaker, partialInFlight: false, partialTimer: null };
    // v3.2 live partials: every 3s, if an utterance is in progress, send a
    // snapshot for a provisional transcription (shown dimmed, replaced by
    // the final segment). One partial in flight per track, max.
    track.partialTimer = setInterval(() => {
      if (track.partialInFlight) return;
      const snap = segmenter.snapshot();
      if (!snap) return;
      track.partialInFlight = true;
      const wavBase64 = float32ToWavBase64(snap.samples, snap.sampleRate);
      this.sendSegment({ wavBase64, speaker: snap.speaker, startMs: snap.startMs, partial: true })
        .catch(() => {})
        .finally(() => { track.partialInFlight = false; });
    }, 3000);
    this.tracks.push(track);
  }

  async start({ youDeviceId, themDeviceId }) {
    // v3.5.6: start each track independently. Before this, one failing
    // track (e.g. an unplugged call-audio device) rejected the whole
    // start and could leave the session with no transcription at all.
    const wanted = [];
    if (youDeviceId)  wanted.push({ deviceId: youDeviceId,  speaker: 'you' });
    if (themDeviceId) wanted.push({ deviceId: themDeviceId, speaker: 'them' });
    let started = 0;
    let firstError = null;
    for (const t of wanted) {
      try { await this.startTrack(t); started++; }
      catch (e) {
        if (!firstError) firstError = e;
        if (this.onTrackError) { try { this.onTrackError(t.speaker, e); } catch (_) {} }
      }
    }
    if (!started && firstError) throw firstError;
  }

  stop() {
    for (const t of this.tracks) {
      if (t.partialTimer) clearInterval(t.partialTimer);
      t.segmenter.end();
      t.stream.getTracks().forEach(tr => tr.stop());
      t.ctx.close();
    }
    this.tracks = [];
  }
}

if (typeof window !== 'undefined') window.LocalCapture = LocalCapture;
if (typeof module !== 'undefined') module.exports = { LocalCapture, WORKLET_SRC };
