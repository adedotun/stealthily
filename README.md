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

---

## ⬇ Download

**[Download GhostMind for Mac (.dmg)](https://github.com/adedotun/stealthily/releases/latest/download/GhostMind.dmg)** — this link always serves the latest stable release. ([.zip version](https://github.com/adedotun/stealthily/releases/latest/download/GhostMind.zip) if you prefer.)

- macOS on Apple Silicon.
- The app is signed but not yet notarized with Apple, so macOS blocks the first launch with an "unidentified developer" warning — there's a one-time, 30-second way through it in **Step 2** of the guide below.
- You'll need your own [Anthropic API key](https://console.anthropic.com) for the AI answers (the guide shows you how to get one), and — only if you want to hear the other side of calls — the free BlackHole driver. Both are covered step by step below.
- Building from source instead? See **Part D** of the guide.

## Installation Guide

Welcome — let's get you set up. There are two ways in:

- **Just want to use GhostMind?** Follow **Part A** (about five minutes). If you also want it to hear the *other side* of your calls, do **Part B** as well (about ten more minutes, one restart).
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
4. **Devices:** the wizard asks which microphone is *you*. Pick your usual mic (for most people, "MacBook Pro Microphone"). The *Them* (call audio) side is Part B — if you're not setting that up yet, just continue; GhostMind works fine hearing only you.

**You'll know it worked when** the little pill in the app's top bar turns green and says the AI is connected, and asking a question in the chat gets you an answer.

**Step 4: One more permission, the first time you take a screenshot (Snipe).**
GhostMind's screenshot feature (Cmd+Shift+S) needs macOS's **Screen & System Audio Recording** permission. The first time you snipe, macOS will prompt you; if it doesn't take effect right away:

1. **System Settings → Privacy & Security → Screen & System Audio Recording** — turn **GhostMind** on.
2. **Quit GhostMind completely and reopen it.** macOS insists on the restart for this one permission; after that, Snipe just works.

**Step 5: Give the first launch a moment.**
The first time GhostMind starts, it quietly downloads its speech model (about 150 MB) in the background. On a decent connection that's under a minute; on a slow one, a few minutes. It happens **once, ever** — after that, transcription starts in seconds and works completely offline.

### Part B — Hear the other side of the call (BlackHole)

Here's the thing: macOS doesn't let any app record what the *other person* on a call is saying — apps can only hear your microphone. The workaround is a free, open-source virtual audio cable called **BlackHole**. You route the call's sound through it, GhostMind listens to the cable, and you still hear everything exactly as before. It's a one-time setup.

**Step 1: Install BlackHole, then restart your Mac.**

- **Easiest:** go to [existential.audio/blackhole](https://existential.audio/blackhole), enter your email to get the download, choose **BlackHole 2ch**, and run the installer (it will ask for your Mac password — that's the audio driver being installed).
- **Or, with Homebrew:** `brew install --cask blackhole-2ch`
- **Then restart your Mac.** The driver only loads after a restart; skipping this is the #1 reason "BlackHole isn't showing up" for people.

**Step 2: Build the "Call + Hear" output (two minutes, in Audio MIDI Setup).**
BlackHole alone is a one-way street — sound sent to it is sound *you* can't hear. The fix is a combined output that sends sound to your ears **and** to BlackHole at the same time:

1. Open **Audio MIDI Setup** (press Cmd+Space, type "Audio MIDI", hit Enter).
2. Bottom-left corner: click **+** → **Create Multi-Output Device**.
3. In the list on the right, tick **your speakers or headphones first**, then tick **BlackHole 2ch**. (Your speakers first means they stay the clock source — sound stays in sync. Tick **Drift Correction** for BlackHole.)
4. Right-click the new device and **rename it `Call + Hear`** so you can spot it later.

**Step 3: Point your sound at it.**

- **Simplest (covers every app):** System Settings → **Sound → Output → Call + Hear**. Now everything you hear also flows past GhostMind's ears.
- **Or per call app:** in Zoom / Teams / Meet / Webex, set **Speaker = Call + Hear**.
- **Either way, one golden rule:** your **Microphone** in the call app stays on your **real mic** — never BlackHole. If the call app uses BlackHole as its microphone, everyone on the call hears themselves echo. (GhostMind's own mic setting is separate and already points at your real mic.)

**Step 4: Tell GhostMind which side is which.**
Open GhostMind → **Settings**. You should see **You** = your microphone and **Them** = **BlackHole 2ch**, then **Save Settings**. Good news: current versions check this for you — if the two sides ever end up pointing at the same device (the classic mistake, where your own voice gets labelled [Them]), the app spots it, repairs it, and tells you.

**Step 5: Try it without a call.**
Play any video with someone talking, then press **🎧 Start Listening** in GhostMind. You should see the video's speech arrive labelled **[Them]** and your own voice labelled **[You]**. If the voice on the video asks a question, watch closely — GhostMind hears it and answers automatically. That's the whole trick working end to end.

### Part C — Check yourself in ten seconds

Any time something feels off, open **Settings → 🩺 Run checks**. It tests everything and speaks plainly: AI connection, transcription engine, microphone, call audio, screenshot permission, and secure input. Green ticks mean you're fully set up; anything else comes with a hint about what to fix.

### Troubleshooting

| What you're seeing | What's going on, and the fix |
|---|---|
| macOS won't open the app / "unidentified developer" | Notarization is still pending — do the one-time **Open Anyway** in Step A2. |
| The AI pill is red / no answers come back | The API key is missing, mistyped, or the Anthropic account has no credit. Re-paste the key in Settings and check the account balance at console.anthropic.com. |
| I see **[You]** but the call side is silent | The call's sound isn't reaching BlackHole. Check Step B3: system output (or the call app's speaker) must be **Call + Hear**, and in GhostMind's Settings, **Them** must be BlackHole 2ch. Test with a video (Step B5). |
| Everything — even my voice — is labelled **[Them]** (or the reverse) | Both sides are set to the same device. Open Settings, set **You** = your mic and **Them** = BlackHole 2ch, and Save. Current versions detect and fix this automatically on launch. |
| People on the call can hear themselves | Your call app's **microphone** is set to BlackHole. Set it back to your real mic (Step B3's golden rule). |
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
| BlackHole 2ch | As Part B |

```bash
git clone <this repo> ghostmind && cd ghostmind
npm install
npm run setup:sidecar   # one time: creates sidecar/.venv with faster-whisper
npm run dev             # run in development (macOS permissions name it "Electron")
npm run build:mac       # distributable .dmg + .zip (arm64 on Apple Silicon)
```

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