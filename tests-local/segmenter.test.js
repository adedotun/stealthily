'use strict';
// node --test tests-local/segmenter.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { Segmenter } = require('../src/renderer/local/segmenter');
const { float32ToWavBuffer } = require('../src/renderer/local/wav');

const SR = 16000, FRAME = 1600; // 100ms frames
const silence = () => new Float32Array(FRAME);
const tone = (amp = 0.3) => {
  const f = new Float32Array(FRAME);
  for (let i = 0; i < FRAME; i++) f[i] = amp * Math.sin(2 * Math.PI * 220 * i / SR);
  return f;
};
function collect(opts) {
  const out = [];
  const seg = new Segmenter({ speaker: 'them', onSegment: s => out.push(s), ...opts });
  return { seg, out };
}
const pushN = (seg, frame, n) => { for (let i = 0; i < n; i++) seg.push(frame()); };

test('speech then 0.8s silence emits one segment', () => {
  const { seg, out } = collect();
  pushN(seg, silence, 5);            // leading silence: dropped
  pushN(seg, tone, 20);              // 2s speech
  pushN(seg, silence, 8);            // 0.8s silence -> flush
  assert.equal(out.length, 1);
  assert.equal(out[0].speaker, 'them');
  assert.ok(out[0].speechMs >= 2000);
});

test('short blip under minSpeechMs is dropped', () => {
  const { seg, out } = collect();
  pushN(seg, tone, 3);               // 300ms
  pushN(seg, silence, 10);
  assert.equal(out.length, 0);
});

test('long monologue flushes at maxSegmentMs', () => {
  const { seg, out } = collect();
  pushN(seg, tone, 160);             // 16s continuous
  assert.ok(out.length >= 1);
});

test('two utterances separated by silence emit two segments', () => {
  const { seg, out } = collect();
  pushN(seg, tone, 20); pushN(seg, silence, 9);
  pushN(seg, tone, 20); pushN(seg, silence, 9);
  assert.equal(out.length, 2);
});

test('segment samples encode to a valid WAV', () => {
  const { seg, out } = collect();
  pushN(seg, tone, 20); pushN(seg, silence, 8);
  const buf = float32ToWavBuffer(out[0].samples, SR);
  const header = Buffer.from(buf.slice(0, 4)).toString();
  assert.equal(header, 'RIFF');
  assert.equal(buf.byteLength, 44 + out[0].samples.length * 2);
});
