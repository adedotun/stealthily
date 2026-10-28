// GhostMind — Main Process
// Electron entry point: stealth window creation, OS-level capture bypass,
// global hotkeys, system audio capture, proactive screen watcher

'use strict';

const { app, BrowserWindow, ipcMain, screen, clipboard,
        systemPreferences, desktopCapturer, nativeImage, shell, dialog } = require('electron');
const path = require('path');
const fs   = require('fs');
const os   = require('os');

const isTest = process.env.NODE_ENV === 'test' || process.argv.includes('--test');
if (isTest) {
  const tempUserData = path.join(os.tmpdir(), `ghostmind-test-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`);
  try {
    fs.mkdirSync(tempUserData, { recursive: true });
  } catch (_) {}
  app.setPath('userData', tempUserData);
}

// Disable Chromium cache to force loading updated files from disk
app.commandLine.appendSwitch('disable-http-cache');

// GUI launches (Finder, .app) have no terminal — writing to stderr throws EIO
// and surfaces as an uncaught exception dialog. Swallow broken-pipe errors.
if (process.stdout) process.stdout.on('error', () => {});
if (process.stderr) process.stderr.on('error', () => {});

function safeLog(...args) {
  try { console.error(...args); } catch (_) {}
}

function sendToRenderer(channel, data) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    mainWindow.webContents.send(channel, data);
  } catch (e) {
    safeLog(`sendToRenderer(${channel}) failed:`, e.message);
  }
}

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const CONFIG = {
  width:   460,
  height:  700,
  devMode: process.argv.includes('--dev'),
  // Lazy getters — app.getPath() must not be called before app is ready
  get settingsPath() { return path.join(app.getPath('userData'), 'settings.json'); },
  get sessionPath()  { return path.join(app.getPath('userData'), 'sessions.json'); },
};

let mainWindow   = null;
let isVisible    = true;
let watcherActive = false;
let watcherTimeout = null;
let captureInProgress = false;
let lastClipboard = '';
let localTranscriber = null;

// ─── SETTINGS ─────────────────────────────────────────────────────────────────
function loadSettings() {
  const defaults = {
    apiKey: '',
    transcriptionMethod: 'local',
    localModel: 'base.en',
    localPythonPath: '',
    youDeviceId: '',
    themDeviceId: '',
    model: 'claude-sonnet-4-5-20250929',
    systemPrompt: 'You are GhostMind, a stealth AI assistant running invisibly on the user\'s screen. Be sharp, concise, and maximally helpful. When shown screenshots, analyze everything visible — code, UI, text, diagrams. Never mention that you\'re an AI assistant unless asked.',
    hotkey: 'CommandOrControl+Shift+G',
    snipeHotkey: 'CommandOrControl+Shift+S',
    watchInterval: 0,
    proactiveMode: false,
    copilotAutoAnswer: true,
    promptCaching: true,
    theme: 'obsidian',
    opacity: 0.97,
    position: 'bottom-right',
  };

  try {
    if (fs.existsSync(CONFIG.settingsPath)) {
      const saved = JSON.parse(fs.readFileSync(CONFIG.settingsPath, 'utf8'));
      const merged = { ...defaults, ...saved };
      // v2.1 migration: the Chrome Helper and OpenAI Whisper transcription
      // methods were removed; everyone lands on local transcription.
      merged.transcriptionMethod = 'local';
      delete merged.openAIKey;
      return merged;
    }
  } catch(_) {}
  return defaults;
}

function saveSettings(s) {
  fs.writeFileSync(CONFIG.settingsPath, JSON.stringify(s, null, 2));
}

// ─── SESSION MEMORY ───────────────────────────────────────────────────────────
function loadSessions() {
  try {
    if (fs.existsSync(CONFIG.sessionPath)) {
      const data = JSON.parse(fs.readFileSync(CONFIG.sessionPath, 'utf8'));
      return Array.isArray(data) ? data.slice(-10) : []; // keep last 10 sessions
    }
  } catch(_) {}
  return [];
}

function saveSession(summary) {
  const sessions = loadSessions();
  sessions.push({ date: new Date().toISOString(), summary });
  fs.writeFileSync(CONFIG.sessionPath, JSON.stringify(sessions.slice(-10), null, 2));
}

function getPermissions() {
  const perms = { screen: 'unknown', microphone: 'unknown' };
  if (process.platform === 'darwin') {
    perms.screen = systemPreferences.getMediaAccessStatus('screen');
    perms.microphone = systemPreferences.getMediaAccessStatus('microphone');
  } else {
    perms.screen = 'granted';
    perms.microphone = 'granted';
  }
  return perms;
}

function openScreenSettings() {
  if (process.platform === 'darwin') {
    shell.openExternal(
      'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
    );
  }
}

// ─── LOCAL TRANSCRIPTION ─────────────────────────────────────────────────────
// The sidecar lives in <project>/sidecar in dev and in
// process.resourcesPath/sidecar when packaged (see extraResources in
// package.json). Python resolution: explicit Settings value, then the
// sidecar venv created by `npm run setup:sidecar`, then system python3.
function resolveSidecarPath() {
  const dev = path.join(__dirname, '..', '..', 'sidecar', 'transcribe_sidecar.py');
  try { if (fs.existsSync(dev)) return dev; } catch (_) {}
  return path.join(process.resourcesPath || '', 'sidecar', 'transcribe_sidecar.py');
}
function resolvePythonPath(settings) {
  if (settings.localPythonPath) return settings.localPythonPath;
  const venvNearSidecar = path.join(path.dirname(resolveSidecarPath()), '.venv',
    process.platform === 'win32' ? 'Scripts\\python.exe' : 'bin/python');
  try { if (fs.existsSync(venvNearSidecar)) return venvNearSidecar; } catch (_) {}
  return process.platform === 'win32' ? 'python' : 'python3';
}
function registerTranscription() {
  const { registerLocalTranscription } = require('./local/transcriber-main');
  localTranscriber = registerLocalTranscription({
    ipcMain,
    sidecarPath: resolveSidecarPath(),
    pythonPath: () => resolvePythonPath(loadSettings()),
    model: () => loadSettings().localModel || 'base.en',
    sendToRenderer,
  });
}

// ─── WINDOW CREATION ──────────────────────────────────────────────────────────
function createWindow() {
  const settings = loadSettings();
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;

  // Calculate position
  const positions = {
    'bottom-right': { x: sw - CONFIG.width  - 20, y: sh - CONFIG.height - 20 },
    'bottom-left':  { x: 20,                       y: sh - CONFIG.height - 20 },
    'top-right':    { x: sw - CONFIG.width  - 20, y: 20 },
    'top-left':     { x: 20,                       y: 20 },
    'center':       { x: (sw - CONFIG.width) / 2,  y: (sh - CONFIG.height) / 2 },
  };
  const pos = positions[settings.position] || positions['bottom-right'];

  mainWindow = new BrowserWindow({
    width:  CONFIG.width,
    height: CONFIG.height,
    x: pos.x,
    y: pos.y,

    // ── STEALTH PROPERTIES ──────────────────────────────────────────────────
    frame:               false,   // no title bar
    transparent:         true,    // true transparency
    hasShadow:           true,
    alwaysOnTop:         true,
    skipTaskbar:         true,    // hidden from taskbar
    focusable:           true,
    resizable:           true,
    minimizable:         false,
    maximizable:         false,
    closable:            false,   // can't be closed via OS chrome
    // visibleOnAllWorkspaces keeps it alive through fullscreen switches
    webPreferences: {
      preload:             path.join(__dirname, '../preload/index.js'),
      contextIsolation:    true,
      nodeIntegration:     false,
      backgroundThrottling: true,
    },
  });

  // ── macOS: EXCLUDE FROM ALL SCREEN CAPTURE ──────────────────────────────
  // setContentProtection(true) maps to NSWindow.sharingType = .none
  // This is the same call that prevents screenshots in banking apps
  mainWindow.setContentProtection(true);

  // ── macOS: Visible in all Spaces and over fullscreen apps ───────────────
  if (process.platform === 'darwin') {
    mainWindow.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true,
      skipTransformProcessType: true,
    });
    // Prevent window from appearing in Mission Control
    app.dock.hide();
  }

  // ── Windows: Additional WDA_EXCLUDEFROMCAPTURE via level ────────────────
  // alwaysOnTop with 'screen-saver' level gets the highest z-order
  mainWindow.setAlwaysOnTop(true, 'screen-saver', 1);

  // Clear cache to bypass any persistent Chromium caches
  if (mainWindow.webContents && mainWindow.webContents.session) {
    mainWindow.webContents.session.clearCache();
  }
  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  if (CONFIG.devMode) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  // Pass initial data to renderer
  mainWindow.webContents.on('did-finish-load', () => {
    const settings = loadSettings();
    const sessions = loadSessions();
    sendToRenderer('init', { settings, sessions, permissions: getPermissions() });
    startClipboardWatcher();
    if (settings.proactiveMode && settings.watchInterval > 0) {
      startScreenWatcher(settings.watchInterval);
    }
  });

  // Prevent navigation away
  mainWindow.webContents.on('will-navigate', (e) => e.preventDefault());
}

// ─── GLOBAL HOTKEYS ───────────────────────────────────────────────────────────
function registerHotkeys() {
  const { globalShortcut } = require('electron');
  const settings = loadSettings();

  globalShortcut.unregisterAll();

  const bindings = [
    [settings.hotkey || 'CommandOrControl+Shift+G', () => toggleVisibility()],
    [settings.snipeHotkey || 'CommandOrControl+Shift+S', () => triggerSnipe()],
    // Full-screen capture with no overlay and no mouse movement at all:
    // the stealthiest shot — a share audience sees nothing happen.
    ['CommandOrControl+Shift+F', () => captureFullScreen()],
    ['CommandOrControl+Shift+A', () => {
      if (!isVisible) showWindow();
      sendToRenderer('focus-input');
    }],
  ];

  for (const [accel, handler] of bindings) {
    if (!globalShortcut.register(accel, handler)) {
      safeLog(`Hotkey registration failed (may be in use): ${accel}`);
    }
  }
}

function toggleVisibility() {
  if (isVisible) hideWindow();
  else showWindow();
}

function hideWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.hide();
  isVisible = false;
}

function showWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.show();
  mainWindow.focus();
  isVisible = true;
}

// ─── STEALTH SCREEN CAPTURE ───────────────────────────────────────────────────
// desktopCapturer.getSources is very expensive on macOS — never call it in parallel
// or at native Retina resolution on a timer. That can freeze the whole system.

const CAPTURE = {
  WATCHER_MIN_INTERVAL: 30,  // seconds — never poll faster than this
  WATCHER_THUMB_MAX:    960,  // px on longest edge for proactive watcher
  SNIPE_THUMB_MAX:      2560, // px on longest edge for user-initiated snipe
};

function thumbSizeForDisplay(display, maxEdge) {
  const { width, height } = display.size;
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width, height };
  const scale = maxEdge / longest;
  return {
    width:  Math.round(width * scale),
    height: Math.round(height * scale),
  };
}

async function captureScreen(regionRect, { lowQuality = false } = {}) {
  if (captureInProgress) return null;
  captureInProgress = true;

  try {
    if (process.platform === 'darwin') {
      const status = systemPreferences.getMediaAccessStatus('screen');
      if (status === 'denied' || status === 'restricted') {
        safeLog('Screen capture denied — grant Screen Recording in System Settings');
        return null;
      }
    }

    const display = screen.getPrimaryDisplay();
    const thumbSize = thumbSizeForDisplay(
      display,
      lowQuality ? CAPTURE.WATCHER_THUMB_MAX : CAPTURE.SNIPE_THUMB_MAX,
    );

    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: thumbSize,
    });

    if (!sources.length) return null;

    const source = sources.find(s => s.id.startsWith('screen:')) || sources[0];
    let image = source.thumbnail;
    if (image.isEmpty()) return null;

    if (regionRect) {
      const { x, y, w, h } = regionRect;
      const imgSize = image.getSize();
      const scale = imgSize.width / display.size.width;
      image = image.crop({
        x: Math.round(x * scale),
        y: Math.round(y * scale),
        width: Math.round(w * scale),
        height: Math.round(h * scale),
      });
    }

    // JPEG for watcher saves ~80% memory vs full PNG at Retina sizes
    if (lowQuality) {
      return image.toJPEG(55).toString('base64');
    }
    return image.toPNG().toString('base64');
  } catch (e) {
    safeLog('Capture failed:', e.message);
    return null;
  } finally {
    captureInProgress = false;
  }
}

// ─── REGION SELECTION ─────────────────────────────────────────────────────────
// Creates a fullscreen transparent overlay for region selection
// The overlay window ALSO has setContentProtection(true) — invisible to capture
let sniperWindow = null;

function triggerSnipe() {
  if (sniperWindow) return;

  const { bounds } = screen.getPrimaryDisplay();

  sniperWindow = new BrowserWindow({
    x: bounds.x, y: bounds.y,
    width: bounds.width, height: bounds.height,
    frame: false, transparent: true,
    alwaysOnTop: true, skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Sniper overlay is ALSO capture-protected
  sniperWindow.setContentProtection(true);
  sniperWindow.setAlwaysOnTop(true, 'screen-saver', 2);
  sniperWindow.loadFile(path.join(__dirname, '../renderer/sniper.html'));

  if (process.platform === 'darwin') {
    sniperWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }

  sniperWindow.on('closed', () => { sniperWindow = null; });
}

// Full-screen capture (Cmd+Shift+F): skips the overlay entirely, so there
// is no pointer movement, no drag pattern — nothing for a share to show.
async function captureFullScreen() {
  const { bounds } = screen.getPrimaryDisplay();
  const rect = { x: 0, y: 0, w: bounds.width, h: bounds.height };
  const b64 = await captureScreen(rect);
  if (b64) sendToRenderer('snipe-captured', { b64, rect });
}

// ─── CLIPBOARD WATCHER ────────────────────────────────────────────────────────
let clipboardTimer = null;

function startClipboardWatcher() {
  if (clipboardTimer) return;
  clipboardTimer = setInterval(() => {
    const text = clipboard.readText();
    if (text && text !== lastClipboard && text.length > 10) {
      lastClipboard = text;
      sendToRenderer('clipboard-change', { text });
    }
  }, 1000);
}

// ─── PROACTIVE SCREEN WATCHER ─────────────────────────────────────────────────
// Uses sequential setTimeout (not setInterval) so captures never stack up.
function startScreenWatcher(intervalSeconds) {
  stopScreenWatcher();

  const intervalMs = Math.max(CAPTURE.WATCHER_MIN_INTERVAL, intervalSeconds) * 1000;
  watcherActive = true;

  const tick = async () => {
    if (!watcherActive) return;

    const b64 = await captureScreen(null, { lowQuality: true });
    if (b64) sendToRenderer('screen-snapshot', { b64, mediaType: 'image/jpeg' });

    if (watcherActive) {
      watcherTimeout = setTimeout(tick, intervalMs);
    }
  };

  // Delay first capture — don't hammer the system on startup
  watcherTimeout = setTimeout(tick, intervalMs);
}

function stopScreenWatcher() {
  watcherActive = false;
  if (watcherTimeout) {
    clearTimeout(watcherTimeout);
    watcherTimeout = null;
  }
}

// ─── IPC HANDLERS ─────────────────────────────────────────────────────────────
ipcMain.handle('capture-screen', async (_, rect) => {
  return await captureScreen(rect);
});

ipcMain.handle('trigger-snipe', async () => {
  triggerSnipe();
  return { ok: true };
});

ipcMain.handle('snipe-result', async (_, { rect }) => {
  // Called from sniper window after selection
  const b64 = await captureScreen(rect);
  if (sniperWindow) sniperWindow.close();
  sendToRenderer('snipe-captured', { b64, rect });
  return { ok: true };
});

ipcMain.handle('snipe-cancel', () => {
  if (sniperWindow) sniperWindow.close();
  return { ok: true };
});

ipcMain.handle('get-settings', () => loadSettings());

ipcMain.handle('save-settings', (_, settings) => {
  saveSettings(settings);
  stopScreenWatcher();
  if (settings.proactiveMode && settings.watchInterval > 0) {
    startScreenWatcher(settings.watchInterval);
  }
  if (mainWindow) mainWindow.setOpacity(settings.opacity ?? 0.97);
  return { ok: true };
});

ipcMain.handle('save-session', (_, { summary }) => {
  saveSession(summary);
  return { ok: true };
});

ipcMain.handle('get-sessions', () => loadSessions());

ipcMain.handle('toggle-visibility', () => {
  toggleVisibility();
  return { visible: isVisible };
});

ipcMain.handle('hide-window', () => {
  hideWindow();
  return { ok: true };
});

ipcMain.handle('quit-app', () => {
  // Clear watches/timers
  if (clipboardTimer) { clearInterval(clipboardTimer); clipboardTimer = null; }
  stopScreenWatcher();
  try {
    const { globalShortcut } = require('electron');
    globalShortcut.unregisterAll();
  } catch(_) {}

  if (localTranscriber) { try { localTranscriber.stop(); } catch(_) {} localTranscriber = null; }

  // Force destroy windows to bypass closable: false restriction
  if (sniperWindow) {
    try { sniperWindow.destroy(); } catch (_) {}
  }
  if (mainWindow) {
    try { mainWindow.destroy(); } catch (_) {}
  }

  app.exit(0);
});

ipcMain.handle('move-window', (_, { x, y }) => {
  mainWindow.setPosition(Math.round(x), Math.round(y));
  return { ok: true };
});

ipcMain.handle('resize-window', (_, { w, h }) => {
  mainWindow.setSize(Math.round(w), Math.round(h));
  return { ok: true };
});

ipcMain.handle('open-external', (_, { url }) => {
  if (url) shell.openExternal(url);
  return { ok: true };
});

ipcMain.handle('get-permissions', () => getPermissions());

ipcMain.handle('open-screen-settings', () => {
  openScreenSettings();
  return { ok: true };
});

ipcMain.handle('get-platform', () => ({
  platform: process.platform,
  arch: os.arch(),
  version: os.release(),
}));

ipcMain.handle('send-ai-request', async (_, { messages, model, systemPrompt, maxTokens }) => {
  const settings = loadSettings();
  if (!settings.apiKey) {
    throw new Error('Anthropic API key is not configured in Settings.');
  }

  const requestModel = model || settings.model || 'claude-3-5-sonnet-20241022';
  const system = systemPrompt || settings.systemPrompt || '';
  const max_tokens = maxTokens || 2048;

  const isPromptCachingEnabled = settings.promptCaching !== false && requestModel.startsWith('claude-');

  // Convert system prompt to blocks if prompt caching is enabled, to apply block-level caching
  let systemBody = system;
  if (isPromptCachingEnabled && typeof system === 'string' && system.trim() !== '') {
    systemBody = [
      {
        type: 'text',
        text: system,
        cache_control: { type: 'ephemeral' }
      }
    ];
  }

  const requestBody = {
    model: requestModel,
    max_tokens,
    system: systemBody,
    messages,
  };

  if (isPromptCachingEnabled) {
    requestBody.cache_control = { type: 'ephemeral' };
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': settings.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text();
    let errorJson;
    try {
      errorJson = JSON.parse(errorText);
    } catch (_) {}
    const errorMsg = errorJson?.error?.message
      ? `${errorJson.error.message} (HTTP ${response.status})`
      : `HTTP ${response.status}: ${errorText}`;
    throw new Error(errorMsg);
  }

  return await response.json();
});

// ─── APP LIFECYCLE ────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  // Prevent multiple instances — must be inside whenReady (skip in test mode)
  if (!isTest) {
    const gotLock = app.requestSingleInstanceLock();
    if (!gotLock) { app.quit(); return; }
    app.on('second-instance', () => {
      if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
    });
  }

  createWindow();
  registerHotkeys();
  registerTranscription();

  if (process.platform === 'darwin') {
    const status = systemPreferences.getMediaAccessStatus('screen');
    if (status !== 'granted') {
      safeLog('Screen Recording permission not granted — open System Settings → Privacy → Screen Recording');
      setTimeout(() => sendToRenderer('permission-needed', { type: 'screen', status }), 1500);
    }
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  if (clipboardTimer) { clearInterval(clipboardTimer); clipboardTimer = null; }
  stopScreenWatcher();
  try {
    const { globalShortcut } = require('electron');
    globalShortcut.unregisterAll();
  } catch(_) {}
  if (localTranscriber) { try { localTranscriber.stop(); } catch(_) {} localTranscriber = null; }
});

// Prevent broken stderr from showing the native error dialog
process.on('uncaughtException', (err) => {
  if (err.code === 'EIO') return;
  safeLog('Uncaught exception:', err);
});

process.on('unhandledRejection', (err) => {
  safeLog('Unhandled rejection:', err?.message || err);
});
