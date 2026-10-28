'use strict';
// Energy-VAD segmenter, pure JS, isomorphic (Node tests + Electron renderer).
//
// Feed it fixed-size frames of Float32 samples with push(frame).
// It emits a segment (via onSegment) when:
//   - speech has been seen, then `silenceMs` of silence follows, OR
//   - the segment reaches `maxSegmentMs` (long monologues still flush)
// Segments shorter than `minSpeechMs` of actual speech are dropped (coughs,
// clicks, keyboard hits).
//
// One Segmenter per speaker track. Tracks never mix — that is what gives
// GhostMind speaker labels for free: track "you" = mic, track "them" =
// system / BlackHole / Loopback feed.

class Segmenter {
  constructor(opts = {}) {
    this.sampleRate   = opts.sampleRate   || 16000;
    this.frameMs      = opts.frameMs      || 100;
    this.silenceMs    = opts.silenceMs    ?? 550;   // v3.1: quicker flush = lower latency
    this.minSpeechMs  = opts.minSpeechMs  ?? 1200;
    this.maxSegmentMs = opts.maxSegmentMs ?? 8000; // v3.1: was 15000 — long monologues now surface in ~8s chunks
    this.threshold    = opts.threshold    ?? 0.015; // RMS energy
    this.onSegment    = opts.onSegment    || (() => {});
    this.speaker      = opts.speaker      || 'them';

    this.frameSamples = Math.round(this.sampleRate * this.frameMs / 1000);
    this._reset();
    this.startedAtMs = 0;   // wall-clock offset of the stream, set by caller
    this.elapsedMs = 0;
  }

  _reset() {
    this.frames = [];
    this.speechMs = 0;
    this.trailingSilenceMs = 0;
    this.inSpeech = false;
  }

  _rms(frame) {
    let sum = 0;
    for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
    return Math.sqrt(sum / frame.length);
  }

  push(frame) {
    if (frame.length !== this.frameSamples) {
      throw new Error(`frame must be ${this.frameSamples} samples, got ${frame.length}`);
    }
    const isSpeech = this._rms(frame) >= this.threshold;
    this.elapsedMs += this.frameMs;

    if (isSpeech) {
      this.inSpeech = true;
      this.speechMs += this.frameMs;
      this.trailingSilenceMs = 0;
      this.frames.push(Float32Array.from(frame));
    } else if (this.inSpeech) {
      // keep trailing silence inside the buffer so words aren't clipped,
      // but count it toward the flush decision
      this.trailingSilenceMs += this.frameMs;
      this.frames.push(Float32Array.from(frame));
    } else {
      return; // leading silence: drop
    }

    const segmentMs = this.frames.length * this.frameMs;
    if ((this.inSpeech && this.trailingSilenceMs >= this.silenceMs) ||
        segmentMs >= this.maxSegmentMs) {
      this._flush();
    }
  }

  _flush() {
    const totalMs = this.frames.length * this.frameMs;
    const speechMs = this.speechMs;
    const frames = this.frames;
    const endMs = this.startedAtMs + this.elapsedMs;
    this._reset();
    if (speechMs < this.minSpeechMs || frames.length === 0) return;
    const samples = new Float32Array(frames.length * this.frameSamples);
    frames.forEach((f, i) => samples.set(f, i * this.frameSamples));
    this.onSegment({
      speaker: this.speaker,
      samples,
      sampleRate: this.sampleRate,
      startMs: endMs - totalMs,
      endMs,
      speechMs,
    });
  }

  // Call when the stream stops, to flush a final partial segment.
  end() { if (this.inSpeech) this._flush(); }
}

if (typeof module !== 'undefined') module.exports = { Segmenter };
