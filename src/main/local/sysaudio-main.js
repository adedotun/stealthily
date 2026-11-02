'use strict';
// GhostMind MAIN process: native system-audio capture manager (v3.6).
//
// Spawns the ScreenCaptureKit helper (native/system-audio — packaged via
// extraResources, see package.json) in --stream mode and forwards its
// framed Int16 PCM (48 kHz mono, one 100 ms frame per message) to the
// renderer on 'sysaudio-pcm'. The renderer feeds it into the same
// segmenter the microphone track uses, so [Them] transcription needs
// no virtual audio driver installed and no routing changes.
//
// Wire format from the helper's stdout: UInt32 little-endian payload
// byte count, then that many bytes of Int16 PCM. Helper logs go to its
// stderr and are mirrored to GhostMind's debug log. Status and failures
// are reported on 'sysaudio-status' — a dead capture is never silent.

const { spawn } = require('child_process');
const fs = require('fs');

class SystemAudioCapture {
  // opts: { helperPath (string | () => string|null), sendToRenderer, log }
  constructor(opts) {
    this.helperPath = opts.helperPath;
    this.sendToRenderer = opts.sendToRenderer;  // (channel, data) => void
    this.log = opts.log || (() => {});
    this.proc = null;
    this._buf = Buffer.alloc(0);
    this._stopping = false;
    this._stderrTail = '';
  }

  _resolvePath() {
    return typeof this.helperPath === 'function' ? this.helperPath() : this.helperPath;
  }

  start() {
    if (this.proc) return { ok: true, already: true };
    const p = this._resolvePath();
    if (!p || !fs.existsSync(p)) {
      const message = 'The system-audio helper is missing from this install — call audio (the other side) cannot be captured.';
      this.sendToRenderer('sysaudio-status', { state: 'error', message });
      return { ok: false, error: 'helper-missing' };
    }
    this._stopping = false;
    this._buf = Buffer.alloc(0);
    this._stderrTail = '';
    let proc;
    try {
      proc = spawn(p, ['--stream'], { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      const message = `Could not start system audio: ${e.message || e}`;
      this.sendToRenderer('sysaudio-status', { state: 'error', message });
      return { ok: false, error: String(e.message || e) };
    }
    this.proc = proc;
    proc.stdout.on('data', (d) => this._onData(d));
    proc.stderr.on('data', (d) => {
      const s = d.toString();
      this._stderrTail = (this._stderrTail + s).slice(-2000);
      const line = s.trim();
      if (line) this.log(`[sysaudio] ${line}`);
    });
    proc.on('error', (e) => {
      this.log(`[sysaudio] spawn error: ${e.message || e}`);
    });
    proc.on('exit', (code) => {
      const intentional = this._stopping;
      this.proc = null;
      if (intentional) {
        this.sendToRenderer('sysaudio-status', { state: 'stopped' });
        return;
      }
      let message = `System audio capture stopped unexpectedly (exit ${code}).`;
      if (/NO_DEVICE/i.test(this._stderrTail)) {
        message = 'No playback device found — call audio capture needs a default output device (speakers or headphones) that is not muted or disconnected.';
      } else if (/-3801|declined TCC|permission/i.test(this._stderrTail)) {
        message = 'System audio needs the Screen & System Audio Recording permission — check System Settings → Privacy & Security → Screen & System Audio Recording and make sure GhostMind is switched on, then start listening again.';
      } else if (/STREAM STOPPED/i.test(this._stderrTail)) {
        message = 'macOS stopped the system audio stream. Start listening again to retry.';
      }
      this.sendToRenderer('sysaudio-status', { state: 'error', message });
    });
    this.sendToRenderer('sysaudio-status', { state: 'running' });
    return { ok: true };
  }

  _onData(d) {
    this._buf = Buffer.concat([this._buf, d]);
    for (;;) {
      if (this._buf.length < 4) return;
      const n = this._buf.readUInt32LE(0);
      if (n === 0 || n > 1048576) {
        // A length that can't be a real frame means the stream is
        // corrupt; stop loudly instead of forwarding garbage audio.
        this.sendToRenderer('sysaudio-status', { state: 'error', message: 'System audio stream became unreadable — it has been stopped.' });
        this.stop();
        return;
      }
      if (this._buf.length < 4 + n) return;
      const payload = this._buf.subarray(4, 4 + n);
      this._buf = this._buf.subarray(4 + n);
      this.sendToRenderer('sysaudio-pcm', payload);
    }
  }

  stop() {
    this._stopping = true;
    if (this.proc) {
      try { this.proc.kill(); } catch (_) {}
      this.proc = null;
    }
    this.sendToRenderer('sysaudio-status', { state: 'stopped' });
  }
}

// IPC wiring — call once from the main ipcMain setup, mirroring
// registerLocalTranscription:
//   registerSystemAudio({ ipcMain, helperPath, sendToRenderer, log });
function registerSystemAudio({ ipcMain, helperPath, sendToRenderer, log }) {
  const capture = new SystemAudioCapture({ helperPath, sendToRenderer, log });
  ipcMain.handle('sysaudio-start', () => capture.start());
  ipcMain.handle('sysaudio-stop', () => { capture.stop(); return { ok: true }; });
  return capture;
}

module.exports = { SystemAudioCapture, registerSystemAudio };
