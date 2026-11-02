'use strict';
// GhostMind RENDERER: dual-track local capture.
//
//   track "you"  -> your real microphone (exact deviceId from Settings,
//                   via getUserMedia)
//   track "them" -> the Mac's system audio, captured natively by the
//                   ScreenCaptureKit helper in the main process and
//                   streamed here as PCM — see startSystemTrack and
//                   feedSystemAudio below. (Until v3.6 this track needed
//                   a BlackHole/Loopback virtual device; v3.7 removed
//                   that path entirely.)
//
// Each track: samples -> Segmenter -> WAV segment -> IPC
// 'transcribe-local-segment'. Main replies on 'external-transcript'.
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
    const segmenter = this._makeSegmenter(speaker);
    if (this.onStream) { try { this.onStream(stream, speaker); } catch (_) {} }
    node.port.onmessage = (ev) => segmenter.push(ev.data);
    source.connect(node); // do NOT connect to ctx.destination — no playback
    const track = { stream, ctx, segmenter, speaker, partialInFlight: false, partialTimer: null };
    this._startPartials(track);
    this.tracks.push(track);
  }

  // Segmenter wired to sendSegment, shared by the device tracks and
  // the v3.6 system-audio track.
  _makeSegmenter(speaker) {
    const segmenter = new Segmenter({
      speaker, sampleRate: 16000,
      onSegment: (seg) => {
        const wavBase64 = float32ToWavBase64(seg.samples, seg.sampleRate);
        this.sendSegment({ wavBase64, speaker: seg.speaker, startMs: seg.startMs })
          .catch(e => console.error('[capture] segment failed', e));
      },
    });
    segmenter.startedAtMs = performance.now();
    // v3.11: publish a live level per track for the listening strip.
    // Both feed paths (mic worklet, system-audio frames) funnel through
    // segmenter.push, so wrapping it here covers every track.
    const origPush = segmenter.push.bind(segmenter);
    segmenter.push = (frame) => {
      try {
        let sum = 0;
        for (let i = 0; i < frame.length; i += 4) sum += frame[i] * frame[i];
        const rms = Math.sqrt(sum / Math.max(1, Math.ceil(frame.length / 4)));
        const L = (globalThis.__gmLevels = globalThis.__gmLevels || {});
        L[speaker] = { v: Math.min(1, rms * 3.2), t: performance.now() };
      } catch (_) {}
      return origPush(frame);
    };
    return segmenter;
  }

  // v3.2 live partials: every 3s, if an utterance is in progress, send a
  // snapshot for a provisional transcription (shown dimmed, replaced by
  // the final segment). One partial in flight per track, max.
  _startPartials(track) {
    track.partialTimer = setInterval(() => {
      if (track.partialInFlight) return;
      const snap = track.segmenter.snapshot();
      if (!snap) return;
      track.partialInFlight = true;
      const wavBase64 = float32ToWavBase64(snap.samples, snap.sampleRate);
      this.sendSegment({ wavBase64, speaker: snap.speaker, startMs: snap.startMs, partial: true })
        .catch(() => {})
        .finally(() => { track.partialInFlight = false; });
    }, 3000);
  }

  // The [Them] track from native system audio (ScreenCaptureKit).
  // Main runs the helper and forwards 100 ms frames of Int16 PCM at
  // 48 kHz; feedSystemAudio() downsamples them into the 16 kHz frames
  // the segmenter expects, so segmentation, partials and the echo
  // guard behave exactly as they do for the microphone track.
  startSystemTrack() {
    const segmenter = this._makeSegmenter('them');
    const track = { system: true, segmenter, speaker: 'them',
                    partialInFlight: false, partialTimer: null,
                    _pend48: [], _frame16: [] };
    this._startPartials(track);
    this.tracks.push(track);
  }

  // One Int16 PCM chunk from main (48 kHz mono), delivered as a
  // Uint8Array. Chunks are whole 100 ms frames in practice, but the
  // carry buffers below tolerate any size.
  feedSystemAudio(u8) {
    const track = this.tracks.find(t => t.system);
    if (!track || !u8 || u8.length < 2) return;
    let view = u8;
    if ((view.byteOffset || 0) % 2 !== 0) {  // Int16Array needs even alignment
      const copy = new Uint8Array(view.length);
      copy.set(view);
      view = copy;
    }
    const i16 = new Int16Array(view.buffer, view.byteOffset || 0, Math.floor(view.length / 2));
    for (let i = 0; i < i16.length; i++) track._pend48.push(i16[i] / 32768);
    // 48k -> 16k: box-average each group of 3 samples (a cheap
    // anti-alias filter, plenty for speech).
    let n = 0;
    while (track._pend48.length - n >= 3) {
      track._frame16.push((track._pend48[n] + track._pend48[n + 1] + track._pend48[n + 2]) / 3);
      n += 3;
    }
    track._pend48 = track._pend48.slice(n);
    while (track._frame16.length >= 1600) {
      const frame = new Float32Array(track._frame16.splice(0, 1600));
      try { track.segmenter.push(frame); } catch (_) {}
    }
  }

  async start({ youDeviceId }) {
    let started = 0;
    let firstError = null;
    // [Them] comes from main's system-audio stream, not from a device.
    // The track object cannot fail to start — if the helper is down,
    // main reports it on sysaudio-status and the track stays silent.
    this.startSystemTrack();
    started++;
    // v3.5.6: the microphone track starts independently — its failure
    // is reported per-track instead of taking the whole capture down.
    const wanted = [];
    if (youDeviceId) wanted.push({ deviceId: youDeviceId, speaker: 'you' });
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
      if (t.stream) t.stream.getTracks().forEach(tr => tr.stop());
      if (t.ctx) t.ctx.close();
    }
    this.tracks = [];
  }
}

if (typeof window !== 'undefined') window.LocalCapture = LocalCapture;
if (typeof module !== 'undefined') module.exports = { LocalCapture, WORKLET_SRC };
