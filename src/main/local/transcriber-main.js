'use strict';
// GhostMind MAIN process: local transcription manager.
// Drop-in replacement for startHelperServer() — instead of a Chrome tab
// POSTing to localhost:8844, this spawns the Python sidecar once, keeps
// the Whisper model loaded, and feeds it WAV segments over stdin.
// Results are sent to the renderer on the SAME channels GhostMind
// already consumes: 'external-transcript' and 'external-state'.
// The renderer/AI code does not change.

const { spawn } = require('child_process');
const path = require('path');
const readline = require('readline');

class LocalTranscriber {
  // opts: { sidecarPath, pythonPath, model, sendToRenderer, command }
  // `command` (v3.1): path to a bundled standalone engine binary
  // (PyInstaller build of the sidecar). When set, it is spawned directly
  // with no Python involved; otherwise pythonPath runs sidecarPath.
  constructor(opts) {
    this.sidecarPath = opts.sidecarPath;              // .../sidecar/transcribe_sidecar.py
    this.command = opts.command || null;
    this.pythonPath = opts.pythonPath || 'python3';
    this.model = opts.model || 'base.en';
    this.sendToRenderer = opts.sendToRenderer;        // (channel, data) => void
    this.proc = null;
    this.nextId = 1;
    this.pending = new Map();
    this.queue = Promise.resolve();                   // serial: one segment at a time
  }

  start() {
    if (this.proc) return;
    // model / pythonPath may be getter functions so Settings changes
    // (e.g. switching base.en -> small.en) apply on the next start
    // without re-registering anything.
    const model = (typeof this.model === 'function' ? this.model() : this.model) || 'base.en';
    const pythonPath = (typeof this.pythonPath === 'function' ? this.pythonPath() : this.pythonPath) || 'python3';
    const env = { ...process.env, GHOSTMIND_WHISPER_MODEL: model };
    this.proc = this.command
      ? spawn(this.command, [], { env, stdio: ['pipe', 'pipe', 'pipe'] })
      : spawn(pythonPath, [this.sidecarPath], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    const rl = readline.createInterface({ input: this.proc.stdout });
    rl.on('line', (line) => {
      let msg; try { msg = JSON.parse(line); } catch { return; }
      const settle = this.pending.get(msg.id);
      if (settle) { this.pending.delete(msg.id); settle(msg); }
      if (msg.text) {
        const label = msg.speaker === 'you' ? 'You' : 'Them';
        this.sendToRenderer('external-transcript', {
          line: `[${label}] ${msg.text}`,
          partial: !!msg.partial,
          speaker: msg.speaker,
        });
      }
    });
    this.proc.stderr.on('data', d => console.error('[transcriber]', d.toString().trim()));
    this.proc.on('exit', () => {
      this.proc = null;
      for (const settle of this.pending.values()) settle({ error: 'sidecar exited' });
      this.pending.clear();
      this.sendToRenderer('external-state', { active: false });
    });
    this.sendToRenderer('external-state', { active: true });
  }

  stop() {
    if (this.proc) { this.proc.stdin.end(); this.proc.kill(); this.proc = null; }
    this.sendToRenderer('external-state', { active: false });
  }

  // wavBase64: one VAD segment from one speaker track.
  // partial (v3.2): a provisional transcription of an utterance still in
  // progress — the renderer shows it dimmed and the final segment
  // replaces it. Returns a promise for the sidecar's JSON result.
  transcribe(wavBase64, speaker, startMs, partial = false) {
    if (!this.proc) this.start();
    const run = () => new Promise((resolve) => {
      const id = this.nextId++;
      this.pending.set(id, resolve);
      this.proc.stdin.write(JSON.stringify({ id, wav_base64: wavBase64, speaker, start_ms: startMs, partial: !!partial }) + '\n');
    });
    this.queue = this.queue.then(run, run);
    return this.queue;
  }
}

// IPC wiring — call once from your existing ipcMain setup:
//   const transcriber = registerLocalTranscription({ ipcMain, sidecarPath, sendToRenderer });
function registerLocalTranscription({ ipcMain, sidecarPath, pythonPath, model, sendToRenderer, command }) {
  const transcriber = new LocalTranscriber({ sidecarPath, pythonPath, model, sendToRenderer, command });
  ipcMain.handle('local-transcription-start', () => { transcriber.start(); return { ok: true }; });
  ipcMain.handle('local-transcription-stop',  () => { transcriber.stop();  return { ok: true }; });
  ipcMain.handle('transcribe-local-segment', (_e, { wavBase64, speaker, startMs, partial }) =>
    transcriber.transcribe(wavBase64, speaker, startMs, partial));
  return transcriber;
}

module.exports = { LocalTranscriber, registerLocalTranscription };
