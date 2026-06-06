# GhostMind Installation & Setup Guide

GhostMind is a stealth AI assistant running invisibly on your desktop, completely bypassed from all screen capture tools. This guide will walk you through setting up, configuring, and launching the application.

---

## 📋 Prerequisites

Ensure you have the following installed on your machine:
* **Node.js** (v18.x or higher recommended)
* **npm** (comes packaged with Node.js)
* **Google Chrome** (required for the Chrome Helper Speech-to-Text native transcription engine)

---

## 🚀 Installation Steps

1. **Clone the Repository or Download Source**:
   ```bash
   git clone https://github.com/ghostmind/ghostmind-electron.git
   cd ghostmind-electron
   ```

2. **Install Dependencies**:
   ```bash
   npm install
   ```

3. **Verify Installation**:
   Ensure you can run the test suite successfully:
   ```bash
   npm run test
   ```

---

## 🛠️ Configuration & API Setup

1. **Launch the Development Server**:
   ```bash
   npm run dev
   ```
2. **Access Settings**:
   Click the **Settings** (gear) icon in the tab bar of the Electron app.
3. **Configure API Keys**:
   * **Anthropic API Key**: Required for Claude (e.g., `claude-sonnet-4-5-20250929`) background intelligence.
   * **OpenAI API Key**: (Optional) Required if you switch the transcription method to *Whisper API* instead of *Chrome Helper*.
4. **Choose Transcription Method**:
   * Set **Speech Recognition Method** to `Chrome Helper` (recommended for zero-latency, free Google transcription).
5. Click **Save Settings**.

---

## 🎙️ Voice Capture & Chrome Helper Setup

Since packaged Electron apps cannot natively access Google’s offline Speech API without proprietary API keys, GhostMind bridges to a companion page in Google Chrome.

### How to use:
1. When you select `Chrome Helper` and click Save, GhostMind will automatically launch Google Chrome to `http://localhost:8844`.
2. Keep this Chrome tab open in the background.
3. **Microphone Permissions**:
   * Ensure you allow microphone access in Google Chrome if prompted.
   * On macOS, ensure Google Chrome has microphone access under **System Settings → Privacy & Security → Microphone**.
4. **Capturing System Audio (Zoom, YouTube, etc.)**:
   To capture internal computer audio output instead of your physical room voice:
   * Install a virtual loopback device such as **BlackHole (macOS)** or **VB-Cable (Windows)**.
   * Set your system audio output/speaker to the loopback device.
   * In Chrome's microphone settings, set the default microphone to the loopback device.

---

## 📦 Production Packaging (DMG / EXE)

To build a standalone production bundle of GhostMind:

* **macOS (Intel & Apple Silicon DMG)**:
   ```bash
   npm run build:mac
   ```
   *Note: If codesigning conflicts arise on local developer certificates, build with identity discovery disabled:*
   ```bash
   CSC_IDENTITY_AUTO_DISCOVERY=false npm run build:mac
   ```

* **Windows (NSIS Installer)**:
   ```bash
   npm run build:win
   ```

---

## 🔍 Troubleshooting

### 1. macOS Quarantine Warning
If launching the packaged `.app` displays an untrusted developer quarantine warning, open Terminal and clear the quarantine attribute:
```bash
xattr -cr /Applications/GhostMind.app
```

### 2. Port 8844 Conflict
If the companion server fails to start, another instance of GhostMind might still be running in the background. Kill any processes holding onto the port:
```bash
lsof -ti:8844 | xargs kill -9
```

### 3. Transcription Throttling
If you minimize Google Chrome, the OS might put the companion tab to sleep. To prevent this, click anywhere on the `http://localhost:8844` page to initialize the inaudible background keep-alive audio signal.
