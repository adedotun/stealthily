// GhostMind — Preload Script
// Secure contextBridge between Electron main process and renderer UI

'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ghostmind', {

  // ── Settings ──────────────────────────────────────────────────────────────
  getSettings:    ()       => ipcRenderer.invoke('get-settings'),
  saveSettings:   (s)      => ipcRenderer.invoke('save-settings', s),
  sendAIRequest:  (data)   => ipcRenderer.invoke('send-ai-request', data),
  sendAIRequestStream: (data) => ipcRenderer.invoke('send-ai-request-stream', data),
  checkAI:        ()       => ipcRenderer.invoke('check-ai'),
  listModels:     ()       => ipcRenderer.invoke('list-models'),
  getDiagnostics: ()       => ipcRenderer.invoke('get-diagnostics'),
  exportSession:  (md)     => ipcRenderer.invoke('export-session', { markdown: md }),

  // ── Sessions / Memory ─────────────────────────────────────────────────────
  getSessions:    ()       => ipcRenderer.invoke('get-sessions'),
  saveSession:    (data)   => ipcRenderer.invoke('save-session', data),
  // v3.5.3 auto-save: fire-and-forget draft updates (send, not invoke —
  // the renderer must never block on these, including during quit)
  updateSessionDraft: (text) => ipcRenderer.send('session-draft', text),
  clearSessionDraft:  ()     => ipcRenderer.send('session-draft-clear'),
  // v3.5.6 diagnostics: fire-and-forget audio-device log lines.
  audioDebug:         (line) => ipcRenderer.send('audio-debug', line),

  // ── Window control ────────────────────────────────────────────────────────
  hide:           ()       => ipcRenderer.invoke('hide-window'),
  quit:           ()       => ipcRenderer.invoke('quit-app'),
  toggleVisible:  ()       => ipcRenderer.invoke('toggle-visibility'),
  moveWindow:     (x, y)   => ipcRenderer.invoke('move-window', { x, y }),
  resizeWindow:   (w, h)   => ipcRenderer.invoke('resize-window', { w, h }),
  openExternal:   (url)    => ipcRenderer.invoke('open-external', { url }),
  getPlatform:    ()       => ipcRenderer.invoke('get-platform'),

  // ── Screen capture ────────────────────────────────────────────────────────
  captureScreen:  (rect)   => ipcRenderer.invoke('capture-screen', rect),
  triggerSnipe:   ()       => ipcRenderer.invoke('trigger-snipe'),
  getPermissions:  ()      => ipcRenderer.invoke('get-permissions'),
  openScreenSettings: ()  => ipcRenderer.invoke('open-screen-settings'),

  // ── Local transcription (v2.1, replaces Chrome Helper + Whisper API) ─────
  startLocalTranscription: ()        => ipcRenderer.invoke('local-transcription-start'),
  stopLocalTranscription:  ()        => ipcRenderer.invoke('local-transcription-stop'),
  transcribeLocalSegment:  (segment) => ipcRenderer.invoke('transcribe-local-segment', segment),

  // ── Sniper window IPC (used by sniper.html) ───────────────────────────────
  snipeResult:    (rect)   => ipcRenderer.invoke('snipe-result', { rect }),
  snipeCancel:    ()       => ipcRenderer.invoke('snipe-cancel'),

  // ── Events from main → renderer ───────────────────────────────────────────
  on: (channel, fn) => {
    const allowed = [
      'init', 'clipboard-change', 'screen-snapshot',
      'snipe-captured', 'focus-input', 'permission-needed',
      'transcription-error', 'transcription-notice',
      'external-transcript', 'external-state',
      'ai-stream-chunk', 'ai-stream-done', 'ai-stream-error',
    ];
    if (allowed.includes(channel)) {
      ipcRenderer.on(channel, (_, data) => fn(data));
    }
  },
  off: (channel, fn) => ipcRenderer.removeListener(channel, fn),
});
