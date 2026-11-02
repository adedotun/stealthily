# 👻 GhostMind v3.5 — Native Electron App

Stealth AI assistant. Invisible to screen capture. Runs natively on macOS and Windows.
**v2.1 headline change:** transcription is now fully local and on-device. The old Chrome Helper (a Google Chrome tab on `localhost:8844` using Google's speech service) and the OpenAI Whisper API option are **removed** — see [What changed in v2.1](#what-changed-in-v21).
**v2.2:** interface themes, and a stealth fix for the Snipe cursor — see [What changed in v2.2](#what-changed-in-v22).
**v2.3:** zero-trace capture — hidden pointer, keyboard selection, and full-screen capture with no overlay at all — see [What changed in v2.3](#what-changed-in-v23).
**v3.0:** the friendly redesign — a calmer modern interface and a 2-minute setup wizard, so non-technical people can use it — see [What changed in v3.0](#what-changed-in-v30).
**v3.1:** effortless + a little magic — Keychain-encrypted API key, faster transcription, live call summary, automatic post-call summary with a follow-up email draft, and the groundwork for one-click installs (bundled engine) and auto-updates — see [What changed in v3.1](#what-changed-in-v31).
**v3.2:** live-feeling transcription (provisional words appear while someone is still speaking) and a real database memory — see [What changed in v3.2](#what-changed-in-v32).
**v3.3:** speed — chat answers now stream in token by token, the models' built-in "thinking" pause is off by default, and the default system prompt was rewritten for a glance-and-go copilot — see [What changed in v3.3](#what-changed-in-v33).
**v3.4:** trust + polish — the app now verifies itself (truthful AI status, live model list, one-tap health check), transcription got smarter (Silero filtering, pre-roll, echo guard), and the call experience gained compact mode, live suggestion chips, session export, and ask-my-past-sessions — see [What changed in v3.4](#what-changed-in-v34).
**v3.5:** fixes from the first real-world test pass — multi-snapshot snipes (queue several captures, send them together), a dead Settings toggle repaired, and transcription that can no longer fail silently: engine errors surface in the chat, the Silero filter fails safe, and a slow first-run model download says so — see [What changed in v3.5](#what-changed-in-v35).
**v3.9:** declutter — everything folds away until it is needed: auto-collapse to just the bar + Ask box when idle, status in a popover, contextual quick actions, captures as attachments, two-level Settings, a model pill beside Submit, and a keyboard-shortcut sheet — see [What changed in v3.9](#what-changed-in-v39).
**v3.10:** Windows reaches full parity — a WASAPI loopback helper gives Windows the same driver-free call audio as macOS, CI verifies the whole Windows model (sidecar, helper, install, first launch), and the installer no longer demands admin rights — see [What changed in v3.10](#what-changed-in-v310).
**v3.10.1:** macOS floor fix — the call-audio helper was accidentally built requiring macOS 27; it now targets macOS 13 (Ventura), so the full app runs on macOS 13 and later — see [What changed in v3.10.1](#what-changed-in-v3101).

---

## ⬇ Download

**[Download GhostMind for Mac (.dmg)](https://github.com/adedotun/stealthily/releases/latest/download/GhostMind.dmg)** — this link always serves the latest stable release. ([.zip version](https://github.com/adedotun/stealthily/releases/latest/download/GhostMind.zip) if you prefer.)

- macOS on Apple Silicon.
- The app is signed but not yet notarized with Apple, so macOS blocks the first launch with an "unidentified developer" warning — there's a one-time, 30-second way through it in **Step 2** of the guide below.
- You'll need your own [Anthropic API key](https://console.anthropic.com) for the AI answers (the guide shows you how to get one). Hearing the other side of calls needs nothing extra — GhostMind captures your Mac's system audio natively.
- Building from source instead? See **Part D** of the guide.

## Installation Guide

Welcome — let's get you set up. There are two ways in:

- **Just want to use GhostMind?** Follow **Part A** (about five minutes) — that's the whole setup, including hearing the *other side* of your calls: GhostMind captures your Mac's system audio natively, so there's no audio driver to install and nothing to route. **Part B** explains how that works and how to test it.
- **Building from source?** Skip to **Part D**.

You don't need to be technical. Every step says what you'll see and how you'll know it worked. The only things you'll need along the way:

- A Mac with Apple Silicon (M1 or later).
- Your own **Anthropic API key** for the AI answers (Step A3 shows you how to get one — it takes two minutes, and usage is pay-as-you-go; a typical call's worth of answers costs a few cents). Transcription itself is free and runs entirely on your Mac.

### Part A — Install the app

**Step 1: Download and install.**
Download the `.dmg` from the link above, open it, and drag **GhostMind** into the **Applications** folder. That's the whole install — the transcription engine is built into the app, so there's no Python or anything else to set up.

**Step 2: The first launch (macOS will grumble once — this is normal).**
Double-click GhostMind in Applications. Because the app isn't yet notarized with Apple, macOS will refuse with a message like *"GhostMind was blocked to protect your Mac"* or *"unidentified developer"*. This happens once, and here's the way through:

1. Open **System Settings → Privacy & Security**.
2. Scroll down — you'll see a line saying GhostMind was blocked, with an **Open Anyway** button. Click it.
3. Confirm **Open** on the dialog that follows.

GhostMind opens, and macOS never asks again. *(Terminal-comfortable alternative: `xattr -cr /Applications/GhostMind.app`, then launch normally.)*

**Step 3: The setup wizard — your API key.**
GhostMind opens a short setup wizard the first time it runs.

1. **Get a key:** go to [console.anthropic.com](https://console.anthropic.com), sign up or sign in, open **API Keys**, click **Create Key**, give it any name, and copy the key (it starts with `sk-ant-`). You'll need a little credit on the account for the key to work — Anthropic's billing page handles that.
2. **Paste it into the wizard** and continue. Your key is stored **encrypted on this Mac** (in the macOS Keychain's secure storage) — it is never sent anywhere except to Anthropic when you ask a question.
3. **Microphone:** when macOS asks whether GhostMind may use the microphone, click **Allow**. No mic permission, no transcription — the app can't hear you without it.
4. **Microphone:** the wizard asks which microphone is *you*. Pick your usual mic (for most people, "MacBook Pro Microphone"). The *Them* side needs no picking — GhostMind hears it from your Mac's system audio (Part B explains).

**You'll know it worked when** the little pill in the app's top bar turns green and says the AI is connected, and asking a question in the chat gets you an answer.

**Step 4: One more permission — Screen & System Audio Recording.**
Two features need macOS's **Screen & System Audio Recording** permission: screenshots (Snipe, Cmd+Shift+S) and hearing the other side of your calls (your Mac's system audio). The first time you use either, macOS will prompt you; if it doesn't take effect right away:

1. **System Settings → Privacy & Security → Screen & System Audio Recording** — turn **GhostMind** on.
2. **Quit GhostMind completely and reopen it.** macOS insists on the restart for this one permission; after that, both features just work.

**Step 5: Give the first launch a moment.**
The first time GhostMind starts, it quietly downloads its speech model (about 150 MB) in the background. On a decent connection that's under a minute; on a slow one, a few minutes. It happens **once, ever** — after that, transcription starts in seconds and works completely offline.

### Part B — Hear the other side of the call (built in)

Older versions of GhostMind needed a free virtual audio cable (BlackHole) and a fair amount of routing to hear the other side of a call. **Not anymore.** GhostMind now captures your Mac's **system audio** directly, using the same macOS technology screen recorders use:

- Whatever your Mac plays — the call app's speaker output, a video, a voice note — GhostMind hears it and labels it **[Them]**.
- There's **no driver to install, no Multi-Output device to build, and no sound settings to change**. Your call apps keep working exactly as they did.
- It rides on the **Screen & System Audio Recording** permission from Step A4 — if you skipped that step, do it now and reopen the app once.

Two honest consequences of hearing *everything* the Mac plays:

- **Notification sounds and music are in the mix too.** A notification ding mid-call is part of the system audio. If it distracts you, silence notifications during calls (macOS Focus / Do Not Disturb). Speech is what Whisper transcribes; dings mostly pass through unnoticed.
- **Use headphones on calls when you can.** If the other person's voice comes out of your speakers, your microphone hears it too, and the transcript can show an echo. GhostMind quietly suppresses exact echo copies it recognises, but headphones remove the problem at the source.

**Try it without a call:** play any video with someone talking, then press **🎧 Start Listening** in GhostMind. You should see the video's speech arrive labelled **[Them]**, and your own voice labelled **[You]**. If the voice on the video asks a question, watch closely — GhostMind hears it and answers automatically. That's the whole trick working end to end.

### Part C — Check yourself in ten seconds

Any time something feels off, open **Settings → 🩺 Run checks**. It tests everything and speaks plainly: AI connection, transcription engine, microphone, call audio, screenshot permission, and secure input. Green ticks mean you're fully set up; anything else comes with a hint about what to fix.

### Troubleshooting

| What you're seeing | What's going on, and the fix |
|---|---|
| macOS won't open the app / "unidentified developer" | Notarization is still pending — do the one-time **Open Anyway** in Step A2. |
| The AI pill is red / no answers come back | The API key is missing, mistyped, or the Anthropic account has no credit. Re-paste the key in Settings and check the account balance at console.anthropic.com. |
| I see **[You]** but the call side is silent | Call audio rides on the **Screen & System Audio Recording** permission — check GhostMind is ON in that pane (Step A4), then quit and reopen the app. Also make sure the call itself is audible (volume up, not muted in the call app) and test with a video (Part B). 🩺 Run checks has a "Call audio" row that flags a missing capture helper. |
| Notification dings and music show up as **[Them]** | **[Them]** is everything your Mac plays (Part B) — that's by design. Silence notifications during calls (Focus / Do Not Disturb) if it bothers you. |
| The other person's words also appear as **[You]** | That's your speakers feeding your microphone — an echo, not a mix-up: the two tracks come from physically separate sources. Use headphones, or lower the speaker volume. |
| People on the call can hear themselves | Your call app's **microphone** is set to something other than your real mic (a virtual device, or your speakers echoing into it). Set the call app's microphone back to your real microphone and try headphones. |
| The first transcription seems stuck | It's the one-time model download (Step A5). Give it a minute on a first-ever launch — after that, starts are quick. |
| Snipe screenshots come out black or nothing happens | The Screen Recording permission from Step A4 — turn GhostMind on in Privacy & Security, then quit and reopen the app once. |
| Something mentions `localhost:8844`, a Chrome helper tab, or an OpenAI key | That's GhostMind v2 — long gone. This guide is the current one. |

### Part D — Building from source (developers)

End users don't need any of this — the .dmg above has the transcription engine frozen inside it. For developers:

| Requirement | Notes |
|---|---|
| Node.js 20+ | `node -v` |
| Python 3.12–3.14 | For the *dev* sidecar only (3.15 has no ctranslate2 wheels yet) |
| Anthropic API key | As Step A3 |

```bash
git clone <this repo> ghostmind && cd ghostmind
npm install
npm run setup:sidecar   # one time: creates sidecar/.venv with faster-whisper
npm run dev             # run in development (macOS permissions name it "Electron")
npm run build:mac       # distributable .dmg + .zip (arm64 on Apple Silicon)
```

The system-audio helper (`native/system-audio`, Swift) is committed prebuilt; if you change its source, rebuild it with `zsh native/system-audio/build.sh` before `npm run build:mac` so the new binary gets packaged.

Smoke tests without a call: `npm run test:local` for the segmenter unit tests, and `GHOSTMIND_ASR_MOCK=1 sidecar/.venv/bin/python sidecar/transcribe_sidecar.py --file <any.wav>` for the sidecar. If the app reports "Could not start local transcription" in dev, the sidecar venv is missing (run `setup:sidecar`) or your Python lives somewhere unusual — set `localPythonPath` in `settings.json` (in the app's userData folder) to its full path.

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
Full AI chat with Claude (default model `claude-sonnet-5-5`, selectable in Settings). Answers stream in as they're generated. Conversation history maintained per session. Markdown rendered including code blocks. The live transcript is injected as context into AI messages automatically.

### 👁 Stealth Snipe (`Cmd+Shift+S`)
- Press hotkey → drag to select any region of your screen — or don't touch the mouse at all:
  - **Keyboard selection:** arrow keys move a selection box, `Alt`+arrows resize it, `Shift` gives 1px fine steps, `Enter` captures
  - **Full-screen capture:** `Cmd+Shift+F` grabs the whole screen with no overlay at all
- Your pointer is **hidden** for the whole snipe (v2.3), and the guide lines and selection box live inside the capture-protected overlay — a screen-share audience sees a still screen and no pointer: nothing moves, nothing appears
- GhostMind captures it, no picker dialog, no yellow border
- One-click: **Solve** / **Explain** / **Extract text** / **Debug** or a custom question
- The screenshot goes to Claude with vision

### 🎙 Local audio capture & transcription
- **Two tracks, never mixed:** your mic is transcribed as `[You]`, your Mac's system audio as `[Them]` — speaker separation without a diarization model
- Your microphone is picked **exactly, inside the app** (Settings); the call side needs no picking at all — since v3.7 it comes from a native ScreenCaptureKit helper, so there's no virtual audio driver (BlackHole and friends) to install or route
- Capture runs through a Web Audio worklet at 16kHz with a voice-activity segmenter: only speech segments reach Whisper, cut on natural pauses
- Transcription by **faster-whisper / mlx-whisper running on your machine**. Audio never leaves the device; only the resulting transcript text is sent to Claude, as chat context
- Live waveform, full transcript panel, one-click **Analyze Full Transcript** (summary, decisions, action items)
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
├── native/system-audio/          # Swift ScreenCaptureKit helper (system audio → PCM stream)
├── build/
│   └── entitlements.mac.plist
└── src/
    ├── main/
    │   ├── index.js                # window, hotkeys, capture, IPC, settings
    │   ├── local/transcriber-main.js  # spawns/manages the Python sidecar
    │   └── local/sysaudio-main.js     # spawns the ScreenCaptureKit helper, forwards its PCM
    ├── preload/
    │   └── index.js                # secure contextBridge API surface
    └── renderer/
        ├── index.html              # UI shell
        ├── app.js                  # AI engine, proactive logic, capture UI
        ├── local/
        │   ├── capture.js          # mic getUserMedia track + system-audio track
        │   ├── segmenter.js        # voice-activity segmentation (per track)
        │   └── wav.js              # Float32 PCM → WAV
        └── sniper.html             # fullscreen region selector
```

### Audio flow

```
Mic ──(exact deviceId)──→ AudioWorklet 16kHz ──┐
                                                ├─→ Segmenter (VAD) → WAV segment
Mac system audio ──(ScreenCaptureKit helper,    │        (per track, never mixed)
   framed PCM 48kHz → downsampled in renderer) ─┘
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

## What changed in v3.10.1

- **Fixed: the macOS build now runs on macOS 13 (Ventura) and later.** The ScreenCaptureKit system-audio helper had been compiled on macOS 27 with no deployment target, so the binary itself refused to run on anything older and call audio silently died on macOS 13–26 — the app shell (Electron) was fine at 12 all along. The helper is now built with an explicit `arm64-apple-macos13.0` target (13 is ScreenCaptureKit audio's own floor), the one macOS-15-only setting is availability-guarded, and the app declares `minimumSystemVersion: 13.0` so the promise is honest. Verified: helper binary reports minos 13.0, captures with a strong signal, and the installed app declares 13.0.
- Windows is unchanged in this release — the v3.10.0 `GhostMind.exe` is attached here as-is so the download links keep working.

## What changed in v3.10

Windows parity. GhostMind's [Them] call-audio track was macOS-only (ScreenCaptureKit); v3.10 adds a Windows WASAPI loopback helper (`native/system-audio-win`, C# + NAudio, self-contained — no .NET runtime needed on the target PC) that emits the identical framed-PCM stream, so the app cannot tell the platforms apart. The main process resolves the right helper per platform, with a plain-language error when no playback device exists. The Windows release workflow now builds everything on a Windows runner and proves it before attaching the installer: the Whisper sidecar transcribes a speech fixture, the loopback helper's frame stream is validated, and the packaged app passes a silent install + first-launch test with both helpers confirmed inside the install. The Windows installer also drops its administrator requirement (per-user install). The one remaining gap on both platforms is a paid code-signing certificate (Gatekeeper/SmartScreen first-launch warnings until then) — a purchase, not code.

## What changed in v3.9

Declutter, with zero functionality removed. The window now **auto-collapses** to just the pill bar and the Ask box after 90 idle seconds on the Chat tab (capture, streaming, queued captures and the wizard all block it; any activity expands it again — the chevron in the bar toggles it manually, and the window stays bottom-anchored while resizing). The Mic / Call audio / AI status pills, Setup and Compact moved into a **status popover** opened by clicking the status dot, which also hosts Run checks. The quick-action chips only appear during or after a call. There is now **one Listen control** — the Audio panel's duplicate Start Transcription button and the capture bar's Stop button are gone (Listen toggles). Screen captures became an **attachments strip** directly above the Ask row instead of a block inside the chat. Settings folds **Hotkeys** and **Proactive & Copilot** under an "Advanced settings" toggle, Quit moved to the bottom of Settings, and a **model pill** beside Submit switches the model (two-way synced with Settings). Press **?** anywhere for the keyboard-shortcut sheet.

## What changed in v3.8.1

- **Fixed: the caller's words could appear as [You].** The labels themselves were never wrong — the system-audio feed is correctly tagged [Them] end to end. But when the call plays through speakers, the microphone hears it too and transcribes the caller's speech a second time, as [You], and the old echo guard only warned about it. Now it's **echo suppression**: a [You] line that matches a recent [Them] line is dropped, and if the echo lands first, the [Them] line relabels it in place (bubble, stored transcript, and the Audio panel mirror). [Them] always wins — it's the direct feed. Headphones still give the cleanest capture, but the transcript no longer misattributes the caller to you when you use speakers.

## What changed in v3.8

- **The Cluely look, faithfully.** The window is restructured into Cluely's two floating pieces, studied from their own screenshots: a glass **pill bar** — logo and live status, a blue Listen pill, a session timer while capturing, round icon buttons (region snipe, hide, quit) — above one rounded glass **card** holding the mode tabs (Chat / Audio / Memory / Settings), the Mic / Call audio / AI status chips, and the content. The window is a bit wider (600×680) and now uses macOS vibrancy, so the translucent fills blur the real desktop behind them like Cluely's overlay. All five themes still recolor everything underneath; Cluely blue is used only for the two primary actions (Listen and Submit).
- **The Ask box moved up, Cluely-style.** The composer now sits at the top of the card, visible on every tab, with quick actions under it; sending from any tab lands you on Chat where the answer streams. Inside the input row: a dashed **📷 Quick Answer** chip and a blue **Submit** pill.
- **Full-screen capture is a button now.** Quick Answer captures the entire screen in one click (the same no-overlay path as Cmd+Shift+F) and drops it into the snipe queue for Solve / Explain / Extract / Ask. Region snipe hasn't gone anywhere — it's the ◎ button in the pill bar, Ctrl+Shift+S, and the tray's ＋ Add.

## What changed in v3.7

- **BlackHole is gone — call audio is system audio, full stop.** The Settings source toggle from v3.6 is removed: the [Them] track now *only* comes from the native ScreenCaptureKit helper. The Call Audio device picker, the device-repair logic that guarded it, and the setup wizard's call-audio step are all deleted, along with the long-dead Chrome Helper server code (and its BlackHole/VB-Cable instructions) in the main process. Setup is now: pick your microphone, grant one permission, done. The Installation Guide's old Part B (install BlackHole, restart, build a Multi-Output device, route your call apps) is replaced by a short explainer — there's nothing to install or route. One honest trade-off to know: [Them] is *everything* the Mac plays, so notification sounds are in the mix, and playing the call through speakers can echo into your mic (headphones fix it; the echo guard still suppresses recognised copies).
- **Cleaner, calmer UI (Cluely-style pass).** Quieter chrome: a slimmer title bar with a sentence-case wordmark (the hardcoded version tag is gone), pill-shaped tabs, borderless home and composer areas, Setup/Compact as proper pills, sentence-case Settings section titles, and a calmer Audio panel. All additive CSS overrides — the five themes are untouched underneath.
- The home **Call audio** pill is now truthful about system audio: it probes for the bundled helper at launch and follows live capture status. The live waveform now follows your microphone (the [Them] track has no stream to visualise anymore).

## What changed in v3.6

- **Native system-audio capture (ScreenCaptureKit) as an alternative [Them] source.** A signed Swift helper (`native/system-audio`) captures the Mac's output mix — no BlackHole install, no restart, no Multi-Output routing — and streams framed 48 kHz PCM to the renderer, which downsamples it into the same segmenter the device track used. Settings gained a Call Audio Source choice (System audio / BlackHole device), defaulting to BlackHole so existing setups didn't change. Failures surface in chat and the debug log instead of going silent. Two engineering notes: the helper must be signed with a stable identity or TCC refuses it with -3801, and ScreenCaptureKit delivers planar stereo, so the AudioBufferList needs room for two buffers or extraction fails with -12737.

## What changed in v3.5.10

- **Code Only mode is now on by default.** New installs (and anyone who never toggled it) get bare-code answers — no comments, no explanation — out of the box. If you switched it off yourself, your saved choice still wins; the toggle lives in Settings.

## What changed in v3.5.9

- **Secure Event Input while GhostMind is focused.** Monitoring software that watches keystrokes system-wide works through CGEvent taps. While any GhostMind window is focused, the app now enables macOS Secure Event Input (the mechanism behind Terminal's "Secure Keyboard Entry" and password fields), and event taps receive no keyboard events at all — nothing typed into GhostMind can be observed. It releases the moment no GhostMind window is focused, and on quit. A tiny native helper (`native/secure-input`, a raw N-API wrapper over the Carbon calls) ships inside the app; if it ever fails to load, the feature quietly disables itself and everything else keeps working. Status shows in Settings → 🩺 Run checks. Note: macOS offers no equivalent shield for mouse events — clicks remain visible to a permitted monitor, which is why GhostMind's flows are keyboard-first.

## What changed in v3.5.8

- **Copilot detection tightened.** v3.5.7's loosened detector over-fired on rambling speech (7 auto-answers in ~100 s of monologue, several not questions). Detection now judges only the FIRST sentence of each segment: a "?" buried mid-segment no longer triggers, sentence fragments starting with auxiliary verbs ("Are going to be…", "Is why some of your…") count only with a trailing "?", and the copilot is asked the first sentence alone instead of the whole multi-sentence blob. Real questions — including short ones and requests like "Write a function that…" / "Tell me how…" — still fire.
- **Whisper pre-warm at launch.** The speech model used to load on the first segment after Start Listening, costing several seconds before the first transcript line. The app now spawns the engine at launch and runs one second of silence through it, so the model is already loaded when you press Start Listening. (Stopping transcription still unloads the engine.)

## What changed in v3.5.7

- **Copilot auto-answer actually triggers now.** The auto-answer engine received every transcript line with its speaker prefix attached ("[Them] What is…"), and the prefix silently defeated every question-starter check — only a segment that happened to end in "?" could ever fire, so in real speech the feature looked missing. Detection now runs on the clean text (both speakers' questions count), the minimum length dropped from 15 to 10 characters so short questions ("What is Rust?") qualify, each auto-answer is recorded in `audio-debug.log`, and the question bubble shows the clean question instead of the prefixed line.

## What changed in v3.5.6

- **Audio startup is diagnosable and per-track resilient.** v3.5.5's device resolution could still leave a session silent if one track failed to start, with nothing anywhere saying why. Now: each track starts independently — a failing call-audio device no longer takes the microphone track down with it, and vice versa — and every track failure is announced in chat with its actual error. The renderer also appends what it enumerated, what it resolved, and any start errors to `audio-debug.log` in the app's data folder. The microphone resolver now prefers the physical device behind the "Default" pseudo-device (so a sleeping Continuity/iPhone mic that enumerates first can't steal the You track), and a repaired device choice is saved immediately when the Settings panel populates, not only at capture start.

## What changed in v3.5.5

- **Call audio can no longer end up pointing at your own microphone.** Chromium exposes a pseudo-device called `default` (the system default input — almost always the mic). If it was ever saved as the Call Audio device — an easy accident in the setup wizard or Settings — both tracks recorded the microphone, the echo guard kept one copy, and your own voice was transcribed as **[Them]**. Device selection is now resolved everywhere it happens (Settings pickers, setup wizard, and again at capture start): a Call Audio id that is empty, `default`, stale, or the same as the microphone is treated as unset and auto-resolved to a BlackHole/Loopback device when one exists, the repair is announced in chat and saved, and when no call-audio device exists at all the app says so and explains the one-time BlackHole setup. The wizard and Settings also carry a plain warning: never pick "Default" for call audio.

## What changed in v3.5.4

- **The app now actually quits.** The main and sniper windows are created `closable: false` (stealth), which silently defeated every standard quit path — Dock Quit, System Settings' "Quit & Reopen", Activity Monitor's Quit, SIGTERM — because quitting tries to close all windows first and the windows refused; only the in-app Quit button (which destroys the windows itself) worked. A `before-quit` handler now destroys both windows first, so all quit paths complete, and SIGTERM is routed through the normal quit path for the same cleanup.
- **Screen capture can recover from a wrong "denied".** Previously, if the system's preflight permission check said `denied`, capture gave up immediately — a dead end when the permission record was missing entirely (the preflight could never turn "granted" because the capture attempt that registers the app never ran) or stale. Now the first capture of a session forces one real attempt anyway: a missing record registers with the system, a wrong preflight is bypassed, and a genuine denial simply produces no image, as before.
- **Batch snipes are reconciled, not answered one by one.** Multiple queued snapshots now carry an explicit instruction: work out how they relate first — snapshots captured together are usually parts of one thing (a question and its options, a problem and its code, a screen and its continuation after scrolling, an error and its cause) — and give one unified answer, merging overlaps and continuations. Separate answers are reserved for snapshots that are clearly unrelated.

## What changed in v3.5.3

- **Session auto-save.** Quitting no longer loses an unsaved conversation. The app now keeps a running draft summary of the live session (built locally, no API call — topic, latest exchange, transcript size) and writes it into the session database automatically as the app quits, by any quit path. It appears in the Memory tab labelled "Auto-saved chat…". Pressing **Save Session** still stores the richer AI-written summary and clears the draft, so a conversation is never stored twice.

## What changed in v3.5.2

- **Code Only mode.** A new Settings toggle — *Code Only — no comments, no explanations*. When it's on, coding answers (chat, quick actions, and Snipe) come back as a single block of bare code: no comments inside the code, no preamble, no step-by-step explanation. It works by appending an explicit override to the system prompt, and Snipe's Solve button swaps its prompt too (it normally asks for well-commented code). Non-code questions and the call features (summaries, post-call email) are unaffected.

## What changed in v3.5.1

- **Settings scroll fix.** A stray `</div>` in the Health Check row (v3.4) closed the Settings scroll container early, pushing the Hotkeys, Proactive, Window sections and the Save button outside it — visible but clipped, with no way to scroll and no way to save. One line removed; Settings now scrolls end to end (verified in a browser harness: panel 520px, content 1262px, wheel scrolling works over every control).

## What changed in v3.5

- **Multi-snapshot Snipe.** Captures now queue in the tray: take a snipe, tap **＋ Add** (or press Cmd+Shift+S again) to stack more, remove any single one with its ×, then send the whole batch to Claude with one Solve / Explain / Extract / Debug / custom question. A single snapshot works exactly as before.
- **Settings toggle fix.** The Deep Thinking switch (added in v3.3) had never been wired to a click handler and was dead; all Settings toggles are now bound by class, so a future toggle can't silently ship unwired.
- **Transcription can no longer fail silently.** Engine errors (model problems, engine crashes) appear as a warning in the chat instead of vanishing; the Silero VAD pass fails safe — if it ever throws, transcription retries without it and carries on; and if the first-ever transcription takes more than ~25 s (the one-time model download), the app says so instead of looking broken.

## What changed in v3.4

- **The AI pill tells the truth.** "AI connected" is green only after a real 1-token probe request with your key and selected model succeeds (hover it to see the model and response time). Amber while checking, red with the actual error when it fails — no more green light over a dead connection.
- **A model list that can't go stale.** The Settings model picker is populated from the Anthropic API's live model list (your saved model is always kept as an option); the built-in list remains as a fallback when offline. This removes the failure mode that broke chat when a hardcoded model was retired.
- **🩺 Run checks.** A Health Check button in Settings verifies, in plain English: API key saved, AI answering, microphone present, call-audio device (BlackHole/Loopback) present, and the transcription engine ready — each with a fix hint when it fails.
- **Smarter transcription.** Final segments now pass through faster-whisper's built-in **Silero VAD** filter, stripping non-speech (breaths, keyboard, room noise) that produced phantom lines (partials skip it for speed). The segmenter gained a **300ms pre-roll** so word onsets are no longer clipped, and an **adaptive noise floor** that makes it more sensitive in quiet rooms without changing behaviour in noise. Segmenter tests still pass 5/5.
- **Echo guard.** If your mic starts transcribing the caller's own words back as "You" (speaker leak), GhostMind warns you once a minute with the fix: headphones, or check the call app's mic routing.
- **Compact mode.** A 🗗 Compact button on the home bar hides chat/input and shrinks the window to the Listen button + pills + live transcript for during-call minimalism; 🗖 Expand restores.
- **Live suggestion chips.** When the caller asks a question, one-tap chips appear over the transcript — ✍️ Draft my reply, ❓ Explain that, 📋 Summarize so far — and dismiss themselves after 25 seconds.
- **Export + ask your history.** The Memory tab can export the current session (transcript + chat) as a Markdown file to Downloads, and **Ask my past sessions** answers questions over your saved session summaries, saying so plainly when they don't cover the question.

## Release checklist (first public release)

1. `npm install` (picks up electron-updater if not yet installed)
2. `npm run setup:sidecar` then `npm run build:sidecar` — builds the bundled `ghostmind-whisper` engine into `sidecar/bin/` (macOS only; must be built on a Mac)
3. `npm run build:mac` — produces `dist/GhostMind.dmg`, `dist/GhostMind.zip`, `dist/latest-mac.yml`
4. GitHub → Releases → Draft new release, tag `v3.4.0`, attach all three files, publish (not prerelease) — the evergreen link `https://github.com/adedotun/stealthily/releases/latest/download/GhostMind.dmg` then serves this build
5. Verify auto-update: install the previous release, then launch it after publishing — it should offer this update
6. Verify stealth on Webex: join a Webex meeting from a phone as guest, share the Mac screen, confirm GhostMind is invisible on the phone's view
7. Note: the app is unsigned — first-open needs right-click → Open until an Apple Developer certificate is added

## What changed in v3.3

- **Streaming chat.** Chat answers now arrive token by token (Anthropic SSE → `ai-stream-chunk` events → the answer types itself into the bubble) instead of appearing only after the full response completes. First words show in well under a second. Copilot auto-answers and the summary features still use the non-streaming path.
- **No more thinking pause.** The current models think adaptively before answering, which delayed every reply. Thinking is now disabled by default; turn on **Deep Thinking** in Settings when you want slower, more thorough answers.
- **A sharper default prompt.** The system prompt was rewritten for how GhostMind is actually used: lead with the answer, keep it tight and scannable, be specific and actionable, draft say-it-out-loud replies from live transcript context. If your saved prompt is still the untouched old default, it upgrades automatically; a prompt you edited yourself is never touched.
- **Model currency fixes (from the v3.2 test pass).** Anthropic retired `claude-sonnet-4-5-20250929` (HTTP 404), so defaults moved to `claude-sonnet-5-5` / `claude-haiku-5-5`, retired saved models migrate on launch, a 404 retries once with the current model, the Settings model list offers only current models, and responses are normalized so a thinking block can no longer render as an empty reply.

## What changed in v3.2

- **Live partial transcription.** While a person is mid-sentence, GhostMind now shows provisional words (dimmed, italic, marked with …) that update as they speak, then get replaced by the polished final line. Implemented as segmenter snapshots → provisional sidecar passes flagged `partial` end-to-end (capture → main → sidecar → renderer), with at most one partial in flight per speaker track so finals are never starved.
- **SQLite session memory.** Sessions moved from a flat `sessions.json` to a real database (`ghostmind.db`, Node's built-in `node:sqlite` — no new dependencies), retaining the last 200 sessions while the app still surfaces the most recent 10. The old JSON file is migrated automatically on first run and remains as a fallback if SQLite is unavailable.
- **Memory search.** The Memory tab has a search box — past sessions filter as you type.

## What changed in v3.1

- **Your API key now lives in the Keychain.** Settings are saved with the key encrypted via Electron `safeStorage` (macOS Keychain / Windows DPAPI) as `apiKeyEnc` — the plaintext key no longer sits in `settings.json`. Existing installs migrate automatically on first launch.
- **Faster transcription.** Segments flush after ~0.55s of silence (was 0.8s) and long monologues surface every ~8s (was 15s), so words appear noticeably sooner.
- **Live summary.** While listening, a 🧭 "So far: …" line in the transcript bar quietly refreshes as the call develops.
- **Post-call magic.** When you stop listening after a real conversation, GhostMind automatically writes a **call summary** (decisions, action items) and a **follow-up email draft**, each with a one-tap Copy button.
- **One-click install groundwork.** `npm run build:sidecar` (PyInstaller spec in `sidecar/ghostmind-whisper.spec`) produces a standalone `ghostmind-whisper` engine in `sidecar/bin/`; the app prefers it automatically when present, so packaged installs need **no Python**. Build order for a fully bundled DMG: `npm run setup:sidecar` → `npm run build:sidecar` → `npm run build:mac`.
- **Auto-update.** Packaged builds check this repo's GitHub Releases once at launch (electron-updater, `build.publish` in package.json) and offer updates through the standard dialog. Dev builds are unaffected.
- Note: `npm install` is needed once after upgrading, for the new `electron-updater` dependency.

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