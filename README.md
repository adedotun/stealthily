# 👻 GhostMind v3.0 — Native Electron App

Stealth AI assistant. Invisible to screen capture. Runs natively on macOS and Windows.
**v2.1 headline change:** transcription is now fully local and on-device. The old Chrome Helper (a Google Chrome tab on `localhost:8844` using Google's speech service) and the OpenAI Whisper API option are **removed** — see [What changed in v2.1](#what-changed-in-v21).
**v2.2:** interface themes, and a stealth fix for the Snipe cursor — see [What changed in v2.2](#what-changed-in-v22).
**v2.3:** zero-trace capture — hidden pointer, keyboard selection, and full-screen capture with no overlay at all — see [What changed in v2.3](#what-changed-in-v23).
**v3.0:** the friendly redesign — a calmer modern interface and a 2-minute setup wizard, so non-technical people can use it — see [What changed in v3.0](#what-changed-in-v30).

---

## Installation Guide

Everything GhostMind needs, in the order to install it. macOS is the primary target; Windows notes are inline.

### 1. Prerequisites

| Requirement | Version | Check | Get it |
|---|---|---|---|
| Node.js | 20+ (18 works, 20 recommended) | `node -v` | nodejs.org or `brew install node` |
| Python | 3.12–3.14 (not 3.15 — no ctranslate2 wheels yet) | `python3 --version` | python.org or `brew install python@3.14` |
| Anthropic API key | — | — | console.anthropic.com |
| BlackHole 2ch (macOS, for call audio) | any recent | Audio MIDI Setup → look for “BlackHole 2ch” | `brew install blackhole-2ch`, then **restart your Mac** |
| VB-Cable (Windows, equivalent) | any | Sound settings → look for “CABLE Input” | vb-audio.com/Cable |

> The Anthropic key is the only cloud credential left. Transcription needs **no** API key and **no** OpenAI account any more.

### 2. Install the app dependencies

```bash
git clone <this repo> ghostmind && cd ghostmind   # or unzip the source
npm install
```

### 3. Install the transcription sidecar (one time)

GhostMind transcribes with a small Python sidecar running Whisper locally. Create its virtual environment — GhostMind finds it automatically at `sidecar/.venv`:

```bash
npm run setup:sidecar
# which is: python3 -m venv sidecar/.venv && sidecar/.venv/bin/pip install -r sidecar/requirements.txt
```

This installs **faster-whisper**. On Apple Silicon you may use **mlx-whisper** instead for native performance: edit `sidecar/requirements.txt` (swap the two engine lines) before running the command above.

The Whisper **model downloads once, on first transcription** (~75MB for `tiny.en`, ~150MB for `base.en` (default), ~500MB for `small.en`), then everything works fully offline. Pick the model in Settings.

### 4. Set up call-audio routing (macOS — the BlackHole step)

BlackHole alone gives you a one-way street: the call can be sent *to* it, but then you can't hear the call. The fix is a Multi-Output Device:

1. Open **Audio MIDI Setup** (Spotlight).
2. Bottom-left **+ → Create Multi-Output Device**.
3. Tick **your headphones/speakers first**, then **BlackHole 2ch**. Set the headphones as the Primary/Clock Source and tick **Drift Correction** for BlackHole.
4. Rename it `Call + Hear`.
5. In Zoom/Meet/Teams: **Speaker = `Call + Hear`**, **Microphone = your real mic** (never the Loopback/BlackHole device — that echoes the call back to everyone).

On Windows: set the call app's speaker to your headphones and use VB-Cable / Stereo Mix as the “Them” device in GhostMind Settings; the same principle applies.

### 5. Grant macOS permissions

System Settings → Privacy & Security:

- **Microphone** → enable GhostMind (in dev mode: **Electron**)
- **Screen & System Audio Recording** → enable GhostMind (dev: **Electron**) — required for Snipe screenshots

Restart the app after granting.

### 6. First run

```bash
npm run dev          # development
# or after building (step 8): install the .dmg
```

1. Launch GhostMind — it appears bottom-right, floating above everything.
2. `Cmd+Shift+G` toggles visibility.
3. **Settings tab** → paste your Anthropic API key → pick your **You** device (your mic) and **Them** device (BlackHole 2ch) → Save.
4. **Audio tab** → **Start Transcription**. Speak and have someone on a call speak: transcript lines arrive labelled `[You]` and `[Them]`.

### 7. Verify transcription works (smoke tests, no call needed)

```bash
npm run test:local                 # VAD segmenter unit tests (5 tests)
GHOSTMIND_ASR_MOCK=1 sidecar/.venv/bin/python sidecar/transcribe_sidecar.py --file <any.wav>
# real check: record yourself saying a known sentence as sample.wav, then
sidecar/.venv/bin/python sidecar/transcribe_sidecar.py --file sample.wav --speaker them
```

### 8. Build a distributable

```bash
npm run build:mac    # macOS .dmg + .zip (arm64 on Apple Silicon)
npm run build:win    # Windows .exe installer
```

The sidecar scripts are bundled as extra resources. **The Python runtime is not bundled**: a machine running a packaged build still needs Python 3.10–3.12 and the `npm run setup:sidecar` step (run inside the installed app's resources folder), unless/until the sidecar is frozen with PyInstaller — see Limitations.

### 9. Troubleshooting

| Problem | Fix |
|---|---|
| “Could not start local transcription” in the app | Sidecar not installed, or Python not found. Run step 3. If your Python lives elsewhere, set `localPythonPath` in `settings.json` (in the app's userData folder) to its full path. |
| Transcription runs but the call side is silent | The call app isn't routing to BlackHole. Check step 4: speaker must be the `Call + Hear` Multi-Output, and **Them** in Settings must be BlackHole 2ch. |
| Only `[Them]`, never `[You]` (or vice versa) | That track's device in Settings is wrong or muted. Re-pick it in Settings → Save. |
| Others on the call hear themselves | Your call app microphone is set to the loopback device. Set it back to your real mic (step 4). |
| First transcription is slow / seems stuck | It's downloading the Whisper model (once). Watch for `~/.cache/huggingface` growing, then it starts. |
| macOS “unidentified developer” on the packaged app | `xattr -cr /Applications/GhostMind.app` — the build is not yet notarized. |
| Something refers to `localhost:8844`, a Chrome tab, or an OpenAI key | That's v2 documentation/code — obsolete in v2.1. This README is the current source of truth (`INSTALL.md` now just points here). |

---

## Why this is invisible

GhostMind uses a single OS-level call that makes the window **structurally excluded** from the screen capture pipeline:

| Platform | Method | Effect |
|---|---|---|
| **macOS** | `BrowserWindow.setContentProtection(true)` → `NSWindow.sharingType = .none` | Excluded from QuickTime, Screenshot, OBS, Zoom, Meet, Teams, AirPlay, SharePlay |
| **Windows** | Same Electron API → `SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE)` | Appears black/blank in OBS, Game Bar, ShareX, Zoom, Teams, all capture tools |

The sniper overlay (region selector) uses the **same protection** — so even the selection UI is invisible while you're drawing your region.

---

## Features

### 💬 Chat
Full AI chat with Claude (default model `claude-sonnet-4-5-20250929`, selectable in Settings). Conversation history maintained per session. Markdown rendered including code blocks. The live transcript is injected as context into AI messages automatically.

### 👁 Stealth Snipe (`Cmd+Shift+S`)
- Press hotkey → drag to select any region of your screen — or don't touch the mouse at all:
  - **Keyboard selection:** arrow keys move a selection box, `Alt`+arrows resize it, `Shift` gives 1px fine steps, `Enter` captures
  - **Full-screen capture:** `Cmd+Shift+F` grabs the whole screen with no overlay at all
- Your pointer is **hidden** for the whole snipe (v2.3), and the guide lines and selection box live inside the capture-protected overlay — a screen-share audience sees a still screen and no pointer: nothing moves, nothing appears
- GhostMind captures it, no picker dialog, no yellow border
- One-click: **Solve** / **Explain** / **Extract text** / **Debug** or a custom question
- The screenshot goes to Claude with vision

### 🎙 Local audio capture & transcription (rewritten in v2.1)
- **Two tracks, never mixed:** your mic is transcribed as `[You]`, the call feed (BlackHole/Loopback) as `[Them]` — speaker separation without a diarization model
- Devices are picked **exactly, inside the app** (Settings) — no dependence on any browser's default microphone
- Capture runs through a Web Audio worklet at 16kHz with a voice-activity segmenter: only speech segments reach Whisper, cut on natural pauses
- Transcription by **faster-whisper / mlx-whisper running on your machine**. Audio never leaves the device; only the resulting transcript text is sent to Claude, as chat context
- Live waveform from the call track, full transcript panel, one-click **Analyze Full Transcript** (summary, decisions, action items)
- The chat **mic button** is dictation: it runs the same local pipeline and drops your words into the chat input

### 🎨 Interface themes (v2.2)
Five looks, switchable in **Settings → Window → Interface Theme** with live preview: **Obsidian** (black / acid green, the original), **Midnight** (deep navy / sky), **Ember** (charcoal / amber), **Violet** (plum / lilac), and **Paper** (light / ink). Themes are pure CSS-variable sets — accents, panels, text and even the waveform follow the theme.

### ⚡ Proactive intelligence
When enabled:
- **Clipboard watcher**: detect when you copy something → offer to ask AI about it
- **Screen watcher**: screenshots every N seconds (min 30, configurable) → AI volunteers insights when it notices something useful
- **Auto-insights**: every 6 transcript lines, a background call surfaces a real-time suggestion

### 🧠 Session memory
- Save any conversation as a compressed memory (AI summarizes it)
- Memories are injected as context in future sessions
- Up to **10** sessions stored locally

### ⌨️ Global hotkeys
Work from any app, even when GhostMind is hidden:
- `Cmd/Ctrl+Shift+G` — toggle visibility
- `Cmd/Ctrl+Shift+S` — Snipe mode
- `Cmd/Ctrl+Shift+A` — show + focus input

---

## Architecture

```
ghostmind/
├── package.json
├── sidecar/                        # v2.1: local transcription engine
│   ├── transcribe_sidecar.py       # faster-whisper / mlx-whisper, stdio JSON-lines
│   └── requirements.txt
├── tests-local/                    # node --test unit tests for the segmenter
├── build/
│   └── entitlements.mac.plist
└── src/
    ├── main/
    │   ├── index.js                # window, hotkeys, capture, IPC, settings
    │   └── local/transcriber-main.js  # spawns/manages the Python sidecar
    ├── preload/
    │   └── index.js                # secure contextBridge API surface
    └── renderer/
        ├── index.html              # UI shell
        ├── app.js                  # AI engine, proactive logic, capture UI
        ├── local/
        │   ├── capture.js          # dual-track getUserMedia + AudioWorklet
        │   ├── segmenter.js        # voice-activity segmentation (per track)
        │   └── wav.js              # Float32 PCM → WAV
        └── sniper.html             # fullscreen region selector
```

### Audio flow (v2.1)

```
Mic ──(exact deviceId)──┐
                        ├─→ AudioWorklet 16kHz → Segmenter (VAD) → WAV segment
BlackHole ─(exact id)───┘        (per track, never mixed)              │
                                          IPC transcribe-local-segment ▼
Main: LocalTranscriber ── stdin JSON lines ──→ Python sidecar (Whisper)
                                          ◄── {speaker, text, …} ──────┘
Renderer: 'external-transcript' → "[Them] …" / "[You] …" → transcript + Claude context
```

No HTTP server, no open port: the sidecar speaks stdio only, so nothing else on the machine can talk to it.

### Snipe flow

```
Hotkey → main creates sniper window → user drags region → IPC rect
→ desktopCapturer → crop → PNG base64 → renderer → Claude (vision)
```

---

## Privacy

- API key and settings are stored in `userData/settings.json` on your local machine only. (Plaintext JSON today — Keychain storage via Electron `safeStorage` is the planned hardening.)
- **Audio never leaves your machine.** Whisper runs locally; the *transcript text* is sent to Anthropic as part of your chat, like anything you type.
- No telemetry, no analytics. The only remote connection is the Anthropic API.
- Screenshots are sent to Claude when you trigger Snipe, and — only if you enable proactive mode — by the screen watcher.

---

## What changed in v3.0

The friendly redesign — same engine, human face:

- **Setup wizard** — first launch (no AI key yet) opens a 4-step guided setup: welcome → paste your Anthropic key → sound check (pick mic + call audio, with a speak-and-watch-the-bar voice test) → plain-English permissions explainer. Skippable at every step, re-runnable any time from the ⚙ Setup button.
- **Home bar** — one big friendly **🎧 Start Listening** button (it drives the same local transcription; the Audio tab still exists for power users), plus status pills in plain words — *Microphone · Call audio · AI connected* — with green ticks and a pulsing red dot while listening.
- **Calmer design** — Inter typeface replaces the monospace/terminal look, corners are rounder (20px cards), shadows softer, quick-action chips are now friendly pills, and the transcript reads like a chat: rounded bubbles labelled **You** and **Caller** instead of `[Them]` log lines.
- **Plain language** — panel headings and labels rewritten for humans ("Listen to my call · Private — stays on this device"). All five v2.2 themes still apply to everything, wizard included.

## What changed in v2.3

- **Zero-trace Snipe.** The v2.2 fix kept a normal arrow, but a moving arrow still traces your drag for the audience. Now: (1) the pointer is **hidden entirely** while the sniper overlay is up (`cursor: none`) — you aim with the in-window guide lines only you can see; (2) a **keyboard selection mode** — a centred box you move with arrow keys, resize with `Alt`+arrows, fine-tune with `Shift`, and capture with `Enter` — so the mouse never needs to move; (3) **`Cmd+Shift+F` full-screen capture** skips the overlay completely. Even a mouse drag is now invisible: the pointer is hidden for the duration, so the audience just sees a still screen — indistinguishable from you pausing to read.

## What changed in v2.2

- **Added: interface themes** — five CSS-variable themes (Obsidian, Midnight, Ember, Violet, Paper) in Settings → Window → Interface Theme, with live preview and persistence (`theme` setting, which existed unused since v2). The waveform now draws in the theme accent instead of hardcoded green.
- **Fixed: Snipe cursor leak** — the sniper overlay used `cursor: crosshair`. Content protection hides the *window*, but the OS pointer is drawn by the OS and included by Zoom/Meet/OBS, so share viewers saw a suspicious `+` whenever you sniped. The overlay now keeps the default arrow; the crosshair guide lines remain, inside the protected window where only you can see them.

## What changed in v2.1

- **Removed: Chrome Helper** — the `localhost:8844` HTTP server is no longer started, its `send-control` IPC and auto-launching Chrome on start/save are gone, and transcription no longer touches it. (The old `startHelperServer` body is still in `src/main/index.js` as explicitly-marked dead code with an early return — delete it in your editor at leisure; it is never called.)
- **Removed: OpenAI Whisper API transcription** — the `transcribe-audio` IPC, the OpenAI API key setting, and 8-second MediaRecorder chunk uploads.
- **Removed: in-Electron Web Speech recognition path** and the per-window/screen desktop-audio source picker (`get-audio-sources`) — superseded by exact-device capture.
- **Added: local transcription** — dual-track capture, VAD segmenter, Python Whisper sidecar over stdio (details above), model/device pickers in Settings, `npm run setup:sidecar`, sidecar bundled as an extra resource in packaged builds.
- **Settings migration:** existing installs are moved to `transcriptionMethod: 'local'` automatically; the stored OpenAI key is dropped from settings.
- **Fixed:** session memory now consistently keeps the last **10** sessions (loader previously kept 5 while the saver kept 10).
- **Fixed:** README previously claimed the vision flow used Opus while the code defaulted to Sonnet — docs now match the code default, `claude-sonnet-4-5-20250929`.
- **Cleanup:** the four runtime dependencies in `package.json` (`node-global-key-listener`, `node-record-lpcm16`, `screenshot-desktop`, `systeminformation`) were never `require`d anywhere in the app and have been removed. Run `npm install` once after upgrading to regenerate `package-lock.json`.
- `INSTALL.md` is retired as a separate guide — its contents live in the Installation Guide above.

## Limitations / next steps

- Packaged builds don't bundle a Python runtime yet (PyInstaller freeze of the sidecar, or a whisper.cpp/WhisperKit binary, is the path).
- Near-live means segment latency (~2–5s behind the speaker), not word-by-word streaming.
- Energy VAD is simple; Silero VAD would cope better with very noisy rooms.
- Headphones are assumed: on speakers, your mic hears the call and `[You]` will duplicate `[Them]`.
