# 👻 GhostMind v2 — Native Electron App

Stealth AI assistant. Invisible to all screen capture. Runs natively on macOS and Windows.

---

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Run in development
npm run dev

# 3. Build distributable
npm run build:mac    # macOS .dmg
npm run build:win    # Windows .exe installer
```

**First run:**
1. Launch GhostMind — it appears bottom-right, floating above everything
2. Press `Ctrl+Shift+G` (or `Cmd+Shift+G` on Mac) to toggle visibility
3. Go to **Settings** tab → enter your Anthropic API key
4. Start using it

---

## Why This Is Invisible

GhostMind uses a single OS-level call that makes the window **structurally excluded** from the screen capture pipeline:

| Platform | Method | Effect |
|---|---|---|
| **macOS** | `BrowserWindow.setContentProtection(true)` → `NSWindow.sharingType = .none` | Excluded from QuickTime, Screenshot, OBS, Zoom, Meet, Teams, AirPlay, SharePlay |
| **Windows** | Same Electron API → `SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE)` | Appears black/blank in OBS, Game Bar, ShareX, Zoom, Teams, all capture tools |

The sniper overlay (region selector) uses the **same protection** — so even the selection UI is invisible while you're drawing your region.

---

## Features

### 💬 Chat
Full AI chat with Claude. Conversation history maintained per session. Markdown rendered including code blocks.

### 👁 Stealth Snipe (`Ctrl+Shift+S`)
- Press hotkey → crosshair cursor appears (invisible to screen share)
- Drag to select any region of your screen
- GhostMind captures it silently, no picker dialog, no yellow border
- One-click: **Solve** / **Explain** / **Extract text** / **Debug** or type a custom question
- The screenshot goes to Claude with vision — full analysis

### 🎙 Audio Capture
- Capture **mic input** or **any desktop audio source** (Zoom, Meet, any app)
- Live waveform visualization
- Real-time speech-to-text transcription
- Transcript injected as context into every AI message automatically
- One-click "Analyze Full Transcript" — summary, decisions, action items

### ⚡ Proactive Intelligence
When enabled:
- **Clipboard watcher**: detect when you copy something → offer to ask AI about it
- **Screen watcher**: silently screenshots every N seconds → AI watches and volunteers insights when it notices something useful
- **Auto-insights**: every 6 transcript lines, fires a quick background call to surface a real-time suggestion

### 🧠 Session Memory
- Save any conversation as a compressed memory (AI summarizes it)
- Memories are automatically injected as context in future sessions
- Up to 10 sessions stored locally

### ⌨️ Global Hotkeys
Work from any app, even when GhostMind is hidden:
- `Ctrl+Shift+G` — Toggle visibility
- `Ctrl+Shift+S` — Snipe mode
- `Ctrl+Shift+A` — Show + focus input (type immediately)

---

## Architecture

```
ghostmind-electron/
├── package.json                  # Electron + deps config
├── build/
│   └── entitlements.mac.plist   # macOS screen capture permissions
└── src/
    ├── main/
    │   └── index.js              # Main process: window, hotkeys, capture, IPC
    ├── preload/
    │   └── index.js              # Secure contextBridge API surface
    └── renderer/
        ├── index.html            # UI shell (obsidian spy terminal aesthetic)
        ├── app.js                # Full renderer: AI engine, voice, waveform, proactive
        └── sniper.html           # Fullscreen crosshair region selector
```

### Data Flow

```
User presses Ctrl+Shift+S
  → main/index.js: globalShortcut fires → creates sniperWindow
  → sniper.html: user drags selection
  → preload: ghostmind.snipeResult({ rect }) → IPC to main
  → main: desktopCapturer.getSources() → crops to rect → PNG base64
  → renderer: snipe-captured event → showSnipeTray()
  → user clicks "Solve"
  → app.js: askAI(prompt, imageBase64)
  → Anthropic API: claude-opus-4-5 with vision
  → AI response rendered in chat
```

### Audio Flow

```
User selects audio source (mic / desktop window)
  → getUserMedia / desktopCapturer stream
  → Web Audio API: AnalyserNode → waveform canvas
  → SpeechRecognition API: live transcript lines
  → Every message: transcript injected as context prefix
  → Every 6 lines (proactive mode): background Haiku call → insight badge
```

---

## Dependencies

| Package | Purpose |
|---|---|
| `electron` | Native app shell, stealth window, IPC |
| `electron-builder` | Cross-platform packaging |
| `node-global-key-listener` | Global hotkeys (fallback if Electron's globalShortcut needs it) |
| `screenshot-desktop` | Fallback screen capture if desktopCapturer unavailable |

---

## Privacy

- API key stored in `userData/settings.json` on your local machine only
- No telemetry, no analytics, no remote connections except direct calls to `api.anthropic.com`
- Audio never leaves your machine — only the transcript text is sent to the AI
- Screenshots sent to AI only when you explicitly trigger snipe + analyze

---

## Requirements

- **macOS** 10.15+ (Catalina) or **Windows** 10 2004+
- Node.js 18+
- Anthropic API key (`console.anthropic.com`)
- For screen capture on macOS: grant Screen Recording permission in System Settings → Privacy & Security
