// GhostMind — Main Process
// Electron entry point: stealth window creation, OS-level capture bypass,
// global hotkeys, system audio capture, proactive screen watcher

'use strict';

const { app, BrowserWindow, ipcMain, screen, clipboard,
        systemPreferences, desktopCapturer, nativeImage, shell, dialog } = require('electron');
const { exec } = require('child_process');
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

function openInChrome(url) {
  if (process.platform === 'darwin') {
    exec(`open -a "Google Chrome" "${url}"`, (err) => {
      if (err) {
        safeLog('Failed to launch Google Chrome specifically, falling back to default browser:', err.message);
        shell.openExternal(url);
      }
    });
  } else if (process.platform === 'win32') {
    exec(`start chrome "${url}"`, (err) => {
      if (err) {
        shell.openExternal(url);
      }
    });
  } else {
    shell.openExternal(url);
  }
}

let sseClients = [];

function sendControlToChrome(command) {
  const data = JSON.stringify({ command });
  sseClients.forEach(res => {
    try {
      res.write(`data: ${data}\n\n`);
    } catch (_) {}
  });
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
let helperServer = null;

// ─── SETTINGS ─────────────────────────────────────────────────────────────────
function loadSettings() {
  const defaults = {
    apiKey: '',
    openAIKey: '',
    transcriptionMethod: 'chrome',
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
      return { ...defaults, ...saved };
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
      return Array.isArray(data) ? data.slice(-5) : []; // keep last 5 sessions
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

const http = require('http');

function startHelperServer() {
  try {
    helperServer = http.createServer((req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      
      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      if (req.method === 'GET' && req.url.startsWith('/control')) {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive'
        });
        res.write('\n');
        sseClients.push(res);
        
        req.on('close', () => {
          sseClients = sseClients.filter(c => c !== res);
        });
        return;
      }

      if (req.method === 'POST' && req.url === '/state') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
          try {
            const data = JSON.parse(body);
            if (data && data.active !== undefined) {
              sendToRenderer('external-state', { active: data.active });
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true }));
          } catch (e) {
            res.writeHead(400);
            res.end();
          }
        });
        return;
      }

      if (req.method === 'POST' && req.url === '/transcript') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
          try {
            const data = JSON.parse(body);
            if (data && data.line) {
              sendToRenderer('external-transcript', { line: data.line });
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true }));
          } catch (e) {
            res.writeHead(400);
            res.end();
          }
        });
      } else {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <!DOCTYPE html>
          <html>
          <head>
            <title>GhostMind Transcriber Helper</title>
            <style>
              body {
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                background: #121214;
                color: #00ff88;
                padding: 40px 20px;
                text-align: center;
                margin: 0;
              }
              .container {
                max-width: 600px;
                margin: 0 auto;
                background: #1a1a1e;
                border: 1px solid rgba(0, 255, 136, 0.15);
                border-radius: 12px;
                padding: 30px;
                box-shadow: 0 8px 30px rgba(0,0,0,0.5);
              }
              h1 {
                font-size: 20px;
                letter-spacing: 2px;
                text-transform: uppercase;
                margin-top: 0;
                margin-bottom: 10px;
                text-shadow: 0 0 10px rgba(0, 255, 136, 0.3);
              }
              p { color: #8a8a93; font-size: 13px; line-height: 1.5; }
              #status {
                font-size: 16px;
                color: #ffffff;
                margin: 24px 0;
                padding: 12px;
                background: rgba(255,255,255,0.05);
                border-radius: 6px;
                font-weight: 500;
                cursor: pointer;
                transition: background 0.2s;
              }
              #status:hover {
                background: rgba(255,255,255,0.08);
              }
              #log {
                text-align: left;
                background: #0e0e10;
                padding: 15px;
                border-radius: 6px;
                height: 200px;
                overflow-y: auto;
                color: #a0a0a5;
                font-family: monospace;
                font-size: 12px;
                border: 1px solid rgba(255,255,255,0.05);
              }
              .log-item { margin: 4px 0; border-bottom: 1px solid rgba(255,255,255,0.02); padding-bottom: 4px; }
            </style>
          </head>
          <body>
            <div class="container">
              <h1>GhostMind Transcriber Helper</h1>
              <p>Since packaged Electron apps cannot natively access Google Speech API, keep this tab open in Google Chrome to stream your browser/mic transcriptions directly to GhostMind.</p>
              
              <div id="keep-alive-banner" style="font-size:11px; color:#ffaa00; margin:10px 0; background:rgba(255,170,0,0.1); border:1px dashed #ffaa00; padding:8px; border-radius:6px; cursor:pointer;">
                🔔 Click anywhere on this page to enable background keep-alive audio (prevents Chrome from sleeping when minimized).
              </div>
              
              <div id="status">Click here to start dictation</div>
              <div id="log"><div class="log-item" style="color: #666;">Waiting for connection...</div></div>
              
              <div style="margin:20px 0; text-align:left;">
                <label style="font-size:11px; font-family:monospace; color:#8a8a93; display:block; margin-bottom:6px;">🎤 DETECTED AUDIO INPUTS:</label>
                <select id="device-select" style="width:100%; background:#0e0e10; color:#00ff88; border:1px solid rgba(0,255,136,0.2); padding:8px; border-radius:6px; font-size:12px; font-family:monospace; outline:none;"></select>
                <p style="font-size:10px; color:#666; margin:4px 0 0 0;">Note: Chrome transcribes from its default microphone. Set your desired default input in Chrome settings at: <code>chrome://settings/content/microphone</code></p>
              </div>

              <div class="guide-box" style="margin-top:20px; text-align:left; background:#0e0e10; border:1px solid rgba(255,255,255,0.05); padding:16px; border-radius:8px; font-size:11px; color:#8a8a93; line-height:1.6;">
                <strong style="color:#ffffff; font-size:12px; display:block; margin-bottom:8px;">💡 Senior System Guide: Capturing System & Room Audio</strong>
                <strong>1. Room Audio / Physical Mic:</strong> Any sound played from physical devices in the room (your phone, speaker, talking) is automatically picked up by your computer's built-in microphone. Ensure the physical device is close enough to the mic.
                <br><br>
                <strong>2. Background Sleeping:</strong> Keep this Chrome window active or clicked at least once. Playing silent audio (automatically activated upon click) keeps Google Chrome from suspending this tab when in the background.
                <br><br>
                <strong>3. Capture Other Apps (Zoom, YouTube, System Audio):</strong> Chrome cannot natively listen to other apps' internal audio outputs. To route internal computer audio to GhostMind:
                <ul style="margin:6px 0; padding-left:18px;">
                  <li>Install a free audio loopback driver like <a href="https://github.com/ExistentialAudio/BlackHole" target="_blank" style="color:#00ff88; text-decoration:underline;">BlackHole (macOS)</a> or <a href="https://vb-audio.com/Cable/" target="_blank" style="color:#00ff88; text-decoration:underline;">VB-Cable (Windows)</a>.</li>
                  <li>In system settings, set your Audio Output/Speaker to the loopback device.</li>
                  <li>In Chrome's microphone settings (or clicking the camera/mic icon in Chrome's URL bar on this tab), set the Default Microphone to the loopback device.</li>
                </ul>
              </div>
            </div>
            <script>
              const statusEl = document.getElementById('status');
              const logEl = document.getElementById('log');
              const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
              
              if (!SR) {
                statusEl.textContent = "Error: SpeechRecognition not supported in this browser. Please open this link in Google Chrome.";
                statusEl.style.color = "#ff4466";
              } else {
                const rec = new SR();
                rec.continuous = true;
                rec.interimResults = true;
                rec.lang = 'en-US';
                let lastFinal = '';
                let active = false;

                // SSE Connection for control commands from Electron
                const sse = new EventSource('/control');
                sse.onmessage = (event) => {
                  try {
                    const data = JSON.parse(event.data);
                    if (data.command === 'start') {
                      if (!active) {
                        try { rec.start(); } catch(err) { console.error(err); }
                      }
                    } else if (data.command === 'stop') {
                      if (active) {
                        active = false;
                        rec.stop();
                      }
                    }
                  } catch (e) {
                    console.error("SSE parse error:", e);
                  }
                };

                // Keep-alive silent audio loop
                let audioCtx = null;
                let silentOsc = null;

                function initKeepAliveAudio() {
                  if (audioCtx) return;
                  try {
                    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
                    const osc = audioCtx.createOscillator();
                    const gain = audioCtx.createGain();
                    
                    osc.type = 'sine';
                    osc.frequency.setValueAtTime(10, audioCtx.currentTime); // Inaudible 10Hz tone
                    gain.gain.setValueAtTime(0, audioCtx.currentTime); // 0 volume
                    
                    osc.connect(gain);
                    gain.connect(audioCtx.destination);
                    osc.start();
                    silentOsc = osc;
                    
                    document.getElementById('keep-alive-banner').style.display = 'none';
                    console.log("Background keep-alive audio initialized.");
                  } catch (e) {
                    console.error("Keep-alive initialization failed:", e);
                  }
                }

                document.body.addEventListener('click', initKeepAliveAudio, { once: false });
                document.getElementById('keep-alive-banner').addEventListener('click', initKeepAliveAudio);

                // Enumerate audio input devices
                async function updateDevices() {
                  try {
                    // Force a dummy capture to make sure permissions are granted so we can see device labels
                    try {
                      const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true });
                      tempStream.getTracks().forEach(t => t.stop());
                    } catch (_) {}

                    const devices = await navigator.mediaDevices.enumerateDevices();
                    const select = document.getElementById('device-select');
                    select.innerHTML = '';
                    
                    const audioInputs = devices.filter(d => d.kind === 'audioinput');
                    if (audioInputs.length === 0) {
                      const opt = document.createElement('option');
                      opt.textContent = "No microphone inputs found";
                      select.appendChild(opt);
                      return;
                    }

                    audioInputs.forEach(device => {
                      const opt = document.createElement('option');
                      opt.value = device.deviceId;
                      opt.textContent = device.label || ("Microphone (" + device.deviceId.slice(0, 5) + "...)");
                      select.appendChild(opt);
                    });
                  } catch (e) {
                    console.error("Failed to enumerate devices:", e);
                  }
                }

                // Initial device list and update on device change
                updateDevices();
                navigator.mediaDevices.ondevicechange = updateDevices;

                function reportState(isActive) {
                  fetch('/state', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ active: isActive })
                  }).catch(err => console.error("State report failed:", err));
                }

                rec.onstart = () => {
                  active = true;
                  statusEl.textContent = "● TRANSCRIBING LIVE (Click to Pause)";
                  statusEl.style.color = "#00ff88";
                  logEl.innerHTML = '<div class="log-item" style="color: #00ff88;">● Listening... Speak into your microphone.</div>';
                  reportState(true);
                  initKeepAliveAudio(); // Attempt to initialize keep-alive audio if gestured
                };

                rec.onerror = (e) => {
                  console.error(e);
                  statusEl.textContent = "Error: " + e.error;
                  statusEl.style.color = "#ff4466";
                  if (e.error === 'not-allowed') {
                    logEl.innerHTML = '<div class="log-item" style="color: #ff4466; font-weight: bold; border: 1px dashed #ff4466; padding: 10px; margin-top: 10px;">' +
                      '🔒 MICROPHONE PERMISSION BLOCKED!<br><br>' +
                      'Please click the settings icon in the URL bar (on the left of "localhost:8844"), ' +
                      'change Microphone from "Block" to "Allow", and reload this page.' +
                      '</div>';
                  } else {
                    logEl.innerHTML = '<div class="log-item" style="color: #ff4466;">Error: ' + e.error + '. Please check mic access.</div>';
                  }
                  reportState(false);
                };

                rec.onend = () => {
                  if (active) {
                    try { rec.start(); } catch(err) {}
                  } else {
                    statusEl.textContent = "Click to Resume Live Transcription";
                    statusEl.style.color = "#ffffff";
                    logEl.innerHTML = '<div class="log-item" style="color: #666;">Paused. Click the button above to start.</div>';
                    reportState(false);
                  }
                };

                rec.onresult = (e) => {
                  let final = '';
                  for (let i = e.resultIndex; i < e.results.length; i++) {
                    if (e.results[i].isFinal) final += e.results[i][0].transcript;
                  }
                  if (final && final !== lastFinal) {
                    lastFinal = final;
                    const line = final.trim();
                    
                    // Clear instructional banners on first result
                    const firstItem = logEl.querySelector('.log-item');
                    if (firstItem && (firstItem.textContent.includes('Listening...') || firstItem.textContent.includes('Waiting for connection...') || firstItem.textContent.includes('Paused.'))) {
                      logEl.innerHTML = '';
                    }

                    // Log locally
                    const div = document.createElement('div');
                    div.className = 'log-item';
                    div.textContent = ">> " + line;
                    logEl.appendChild(div);
                    logEl.scrollTop = logEl.scrollHeight;

                    // Send to Electron
                    fetch('/transcript', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ line })
                    }).catch(err => console.error("Failed to send to GhostMind:", err));
                  }
                };

                statusEl.addEventListener('click', () => {
                  initKeepAliveAudio();
                  if (active) {
                    active = false;
                    rec.stop();
                  } else {
                    try { rec.start(); } catch(e) {}
                  }
                });

                // Auto-start on load
                try {
                  rec.start();
                } catch(e) {
                  console.error("Auto-start speech recognition failed:", e);
                }
              }
            </script>
          </body>
          </html>
        `);
      }
    });

    helperServer.on('error', (err) => {
      safeLog('Helper HTTP Server error:', err.message);
      if (err.code === 'EADDRINUSE') {
        dialog.showErrorBox(
          'Port Conflict Detected',
          'GhostMind Helper Server cannot start because port 8844 is already in use.\n\n' +
          'Please ensure that any previous instances of GhostMind are completely closed. You can restart your computer or force-quit existing GhostMind processes in Activity Monitor to resolve this.'
        );
      }
    });

    helperServer.listen(8844, '127.0.0.1', () => {
      safeLog('Helper HTTP Server running on http://127.0.0.1:8844');
    });
  } catch (e) {
    safeLog('Failed to start Helper HTTP Server:', e.message);
  }
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
  if (settings.transcriptionMethod === 'chrome' && !isTest) {
    openInChrome(`http://localhost:8844/?t=${Date.now()}`);
  }
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

  if (helperServer) {
    try { helperServer.close(); } catch(_) {}
    helperServer = null;
  }

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
  if (url && (url.includes('localhost:8844') || url.includes('127.0.0.1:8844'))) {
    openInChrome(url);
  } else {
    shell.openExternal(url);
  }
  return { ok: true };
});

ipcMain.handle('send-control', (_, { command }) => {
  sendControlToChrome(command);
  return { ok: true };
});

ipcMain.handle('get-audio-sources', async () => {
  try {
    const sources = await desktopCapturer.getSources({
      types: ['window', 'screen'],
      thumbnailSize: { width: 1, height: 1 },
    });
    return sources.map(s => ({ id: s.id, name: s.name }));
  } catch (e) {
    safeLog('get-audio-sources failed:', e.message);
    return [];
  }
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

ipcMain.handle('transcribe-audio', async (_, b64Data) => {
  const settings = loadSettings();
  if (!settings.openAIKey) {
    throw new Error('OpenAI API Key is missing in Settings. Please configure it to use Whisper transcription.');
  }

  try {
    const formData = new FormData();
    const buffer = Buffer.from(b64Data, 'base64');
    const blob = new Blob([buffer], { type: 'audio/webm' });
    formData.append('file', blob, 'audio.webm');
    formData.append('model', 'whisper-1');

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${settings.openAIKey}`,
      },
      body: formData
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorJson;
      try {
        errorJson = JSON.parse(errorText);
      } catch (_) {}
      const errorMsg = errorJson?.error?.message || errorText;
      throw new Error(`OpenAI Whisper Error: ${errorMsg}`);
    }

    const data = await response.json();
    return data.text || '';
  } catch (e) {
    safeLog('Whisper transcription failed:', e.message);
    throw e;
  }
});

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
  startHelperServer();

  // Automatically trigger localhost Chrome Helper if configured
  const settings = loadSettings();
  if (settings.transcriptionMethod === 'chrome' && !isTest) {
    openInChrome(`http://localhost:8844/?t=${Date.now()}`);
  }

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
  if (helperServer) {
    try { helperServer.close(); } catch(_) {}
    helperServer = null;
  }
});

// Prevent broken stderr from showing the native error dialog
process.on('uncaughtException', (err) => {
  if (err.code === 'EIO') return;
  safeLog('Uncaught exception:', err);
});

process.on('unhandledRejection', (err) => {
  safeLog('Unhandled rejection:', err?.message || err);
});
