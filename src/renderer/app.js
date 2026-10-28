// GhostMind — Renderer Process
// AI engine, voice capture, waveform, clipboard watcher, proactive intelligence

'use strict';

// ─── STATE ────────────────────────────────────────────────────────────────────
const state = {
  settings:      {},
  messages:      [],          // full conversation history
  transcript:    [],          // live audio transcript lines
  sessions:      [],          // past session summaries
  isThinking:    false,
  snipeImage:    null,        // base64 PNG from sniper
  audioContext:  null,
  isCapturing:   false,
  isMicRecording: false,
  localCapture:  null,        // LocalCapture instance while running
  callCaptureWanted: false,   // Audio-panel toggle state
  dictationMode: false,       // mic button reroutes [You] lines to chat input
  proactiveTimer: null,
  lastScreenB64:  null,
  screenAnalysisInFlight: false,
  lastSolvedQuestions: [],
};

// ─── INIT ─────────────────────────────────────────────────────────────────────
function handleInit({ settings, sessions, permissions }) {
  state.settings = settings || {};
  state.sessions  = sessions || [];
  applySettings(state.settings);
  renderMemory(state.sessions);
  setStatus(state.settings.apiKey ? 'ready' : 'offline');
  showStartupHints(state.settings, permissions);
  refreshPermissionStatus(permissions);
  populateAudioDevices();
}

window.ghostmind.on('init', handleInit);

window.ghostmind.on('external-transcript', ({ line }) => {
  if (!line) return;

  // Dictation mode (mic button): your own lines go to the chat input
  // instead of the call transcript, and auto-send when you stop.
  if (state.dictationMode && line.startsWith('[You]')) {
    const text = line.replace(/^\[You\]\s*/, '');
    chatInput.value = (chatInput.value ? chatInput.value + ' ' : '') + text;
    chatInput.style.height = 'auto';
    chatInput.style.height = Math.min(chatInput.scrollHeight, 100) + 'px';
    return;
  }

  document.getElementById('capture-bar').classList.add('visible');
  document.getElementById('capture-label').textContent = 'CAPTURING · LOCAL WHISPER';
  document.getElementById('audio-badge').classList.add('visible');
  document.getElementById('transcript-bar').classList.add('visible');
  setStatus('listening');

  state.isCapturing = true;
  state.transcript.push(line);
  addTranscriptLine(line);
  processTranscriptLine(line);

  if (state.transcript.length % 6 === 0 && state.settings.proactiveMode) {
    triggerProactiveInsight();
  }
});

// Sidecar state from main: true = Whisper sidecar process is up.
// Capture start/stop itself is driven from this renderer.
window.ghostmind.on('external-state', ({ active }) => {
  const btn = document.getElementById('local-transcription-toggle-btn');
  if (btn && state.callCaptureWanted) {
    btn.textContent = active ? '⏹ Stop Transcription' : '🎙 Start Transcription';
    btn.style.color = active ? 'var(--amber)' : 'var(--acid)';
  }
});

// Fetch initial data immediately on load to prevent race condition in packaged app
async function fetchInitialData() {
  try {
    const settings = await window.ghostmind.getSettings();
    const sessions = await window.ghostmind.getSessions();
    const permissions = await window.ghostmind.getPermissions();
    handleInit({ settings, sessions, permissions });
  } catch (e) {
    console.error('Error fetching initial data:', e);
  }
}
fetchInitialData();

async function refreshPermissionStatus(permissions) {
  const el = document.getElementById('perm-screen-status');
  if (!el) return;
  const perms = permissions || await window.ghostmind.getPermissions();
  const status = perms?.screen || 'unknown';
  el.textContent = status.toUpperCase();
  el.style.color = status === 'granted' ? 'var(--acid)' : 'var(--amber)';
}

document.getElementById('open-screen-settings-btn')?.addEventListener('click', () => {
  window.ghostmind.openScreenSettings();
});

function showStartupHints(settings, permissions) {
  if (!settings.apiKey) {
    addMsg('system', '⚠ No API key — go to Settings, add your Anthropic key, and click Save');
  }
  if (permissions?.screen && permissions.screen !== 'granted') {
    const appName = 'Electron'; // dev mode; packaged app shows as GhostMind
    addMsg('system',
      `⚠ Screen Recording not granted (status: ${permissions.screen}). ` +
      `Enable "${appName}" in System Settings → Privacy & Security → Screen Recording, then restart.`);
  }
}

window.ghostmind.on('permission-needed', ({ type, status }) => {
  if (type === 'screen') {
    addMsg('system',
      `⚠ Screen Recording required for snipe & audio (status: ${status}). ` +
      'Open System Settings → Privacy & Security → Screen Recording, enable Electron, then restart.');
  }
});

window.ghostmind.on('focus-input', () => {
  switchTab('chat');
  document.getElementById('chat-input').focus();
});

// ─── SETTINGS ─────────────────────────────────────────────────────────────────
// Themes are pure CSS-variable sets in index.html keyed by data-theme.
function applyTheme(name) {
  document.documentElement.setAttribute('data-theme', name || 'obsidian');
}

function applySettings(s) {
  const sid = v => document.getElementById(v);
  sid('s-apikey').value    = s.apiKey    || '';
  sid('s-localmodel').value = s.localModel || 'base.en';
  sid('s-model').value     = s.model     || 'claude-sonnet-4-5-20250929';
  sid('s-system').value    = s.systemPrompt || '';
  sid('s-hotkey').value    = s.hotkey    || 'CommandOrControl+Shift+G';
  sid('s-snipe-hotkey').value = s.snipeHotkey || 'CommandOrControl+Shift+S';
  sid('s-watch').value     = s.watchInterval || 0;
  sid('s-position').value  = s.position  || 'bottom-right';
  sid('s-opacity').value   = s.opacity   || 0.97;
  sid('s-theme').value     = s.theme     || 'obsidian';
  applyTheme(s.theme || 'obsidian');
  if (s.proactiveMode) document.getElementById('t-proactive').classList.add('on');
  const copilotVal = s.copilotAutoAnswer !== undefined ? s.copilotAutoAnswer : true;
  if (copilotVal) document.getElementById('t-copilot').classList.add('on');
  else document.getElementById('t-copilot').classList.remove('on');
  
  const pcVal = s.promptCaching !== undefined ? s.promptCaching : true;
  if (pcVal) document.getElementById('t-promptcaching').classList.add('on');
  else document.getElementById('t-promptcaching').classList.remove('on');

  // Device dropdowns are populated async by populateAudioDevices();
  // apply the saved picks once options exist.
  if (s.youDeviceId)  sid('s-you-device').value  = s.youDeviceId;
  if (s.themDeviceId) sid('s-them-device').value = s.themDeviceId;
}

document.getElementById('save-settings-btn').addEventListener('click', async () => {
  const s = {
    ...state.settings,
    apiKey:        document.getElementById('s-apikey').value.trim(),
    transcriptionMethod: 'local',
    localModel:    document.getElementById('s-localmodel').value,
    youDeviceId:   document.getElementById('s-you-device').value,
    themDeviceId:  document.getElementById('s-them-device').value,
    model:         document.getElementById('s-model').value,
    systemPrompt:  document.getElementById('s-system').value.trim(),
    hotkey:        document.getElementById('s-hotkey').value.trim(),
    snipeHotkey:   document.getElementById('s-snipe-hotkey').value.trim(),
    watchInterval: (() => {
      const v = parseInt(document.getElementById('s-watch').value) || 0;
      return v === 0 ? 0 : Math.max(30, v);
    })(),
    position:      document.getElementById('s-position').value,
    theme:         document.getElementById('s-theme').value,
    opacity:       parseFloat(document.getElementById('s-opacity').value) || 0.97,
    proactiveMode: document.getElementById('t-proactive').classList.contains('on'),
    copilotAutoAnswer: document.getElementById('t-copilot').classList.contains('on'),
    promptCaching: document.getElementById('t-promptcaching').classList.contains('on'),
  };
  await window.ghostmind.saveSettings(s);
  state.settings = s;
  setStatus(s.apiKey ? 'ready' : 'offline');
  addMsg('system', '✓ Settings saved');
  switchTab('chat');
});

// Theme picker previews live; it is persisted by Save Settings.
document.getElementById('s-theme').addEventListener('change', (e) => {
  applyTheme(e.target.value);
});

// Toggles
['t-clipboard','t-proactive','t-copilot','t-promptcaching'].forEach(id => {
  document.getElementById(id).addEventListener('click', (e) => {
    e.currentTarget.classList.toggle('on');
  });
});

// ─── STATUS ───────────────────────────────────────────────────────────────────
function setStatus(s) {
  const pill = document.getElementById('status-pill');
  const text = document.getElementById('status-text');
  const map  = { offline: 'OFFLINE', ready: 'READY', thinking: 'THINKING', listening: 'LIVE' };
  pill.className  = s;
  text.textContent = map[s] || s.toUpperCase();
}

// ─── TAB SWITCHING ────────────────────────────────────────────────────────────
function switchTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelector(`.tab[data-panel="${name}"]`).classList.add('active');
  const panelMap = { chat: 'panel-chat', audio: 'panel-audio-panel', memory: 'panel-memory-panel', settings: 'panel-settings-panel' };
  document.getElementById(panelMap[name]).classList.add('active');
}

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    switchTab(tab.dataset.panel);
    if (tab.dataset.panel === 'memory') loadMemoryPanel();
  });
});

// ─── MESSAGES ─────────────────────────────────────────────────────────────────
function addMsg(role, content, imgB64, isCopilot = false, usageStats = null) {
  const now   = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const el    = document.createElement('div');
  el.className = `msg ${role} ${isCopilot ? 'copilot' : ''}`;

  let inner = '';
  if (imgB64) {
    inner += `<img class="msg-img" src="data:image/png;base64,${imgB64}" alt="screenshot">`;
  }
  let bubbleContent = renderMarkdown(content);
  if (isCopilot) {
    const label = role === 'user' ? '⬡ COPILOT AUTO-ANSWER (QUESTION)' : '⬡ COPILOT AUTO-ANSWER (ANSWER)';
    const colorStyle = role === 'user' ? 'color:var(--amber)' : 'color:var(--acid)';
    bubbleContent = `<span style="font-family:var(--font-mono);font-size:8px;letter-spacing:1px;${colorStyle};display:block;margin-bottom:4px;text-transform:uppercase;">${label}</span>` + bubbleContent;
  }
  inner += `<div class="bubble">${bubbleContent}</div>`;
  if (role !== 'system') {
    let cacheLabel = '';
    if (usageStats) {
      const read = usageStats.cache_read_input_tokens || 0;
      const created = usageStats.cache_creation_input_tokens || 0;
      if (read > 0) {
        cacheLabel = `<span class="cache-stat hit" title="Reused ${read} tokens from prompt cache">⚡ Cache Hit: ${read}</span>`;
      } else if (created > 0) {
        cacheLabel = `<span class="cache-stat write" title="Wrote ${created} tokens to prompt cache">💾 Cache Write: ${created}</span>`;
      }
    }

    inner += `<div class="msg-meta">
      <span>${now}</span>
      ${cacheLabel}
      <button class="msg-copy" onclick="copyText(this)" data-text="${escAttr(content)}">copy</button>
    </div>`;
  }
  el.innerHTML = inner;

  const msgs = document.getElementById('messages');
  msgs.appendChild(el);
  msgs.scrollTop = msgs.scrollHeight;

  if (role === 'user' || role === 'assistant') {
    state.messages.push({ role: role === 'ai' ? 'assistant' : role, content });
  }
}

function addTyping() {
  const el  = document.createElement('div');
  el.id     = 'typing-el';
  el.className = 'msg ai';
  el.innerHTML = '<div class="bubble"><div class="typing-dots"><span></span><span></span><span></span></div></div>';
  document.getElementById('messages').appendChild(el);
  document.getElementById('messages').scrollTop = 99999;
  return el;
}

window.copyText = (btn) => {
  navigator.clipboard.writeText(btn.dataset.text);
  const orig = btn.textContent;
  btn.textContent = 'copied!';
  btn.style.color = 'var(--acid)';
  setTimeout(() => { btn.textContent = orig; btn.style.color = ''; }, 1500);
};

// ─── AI ENGINE ────────────────────────────────────────────────────────────────
async function askAI(userText, imgB64, apiTextOverride) {
  if (!state.settings.apiKey) {
    addMsg('system', '⚠ Add API key in Settings');
    return;
  }
  if (state.isThinking) return;

  // Show user message
  addMsg('user', userText, imgB64);
  state.isThinking = true;
  setStatus('thinking');
  document.getElementById('send-btn').disabled = true;

  // Build messages for API — include transcript context if live
  let content = apiTextOverride || userText;
  if (state.transcript.length > 0 && !apiTextOverride) {
    const ctx = state.transcript.slice(-10).join('\n');
    content = `[LIVE TRANSCRIPT CONTEXT]\n${ctx}\n\n[QUESTION]\n${userText}`;
  }

  // Build messages array, include session memory as context prefix
  const sessionCtx = state.sessions.length > 0
    ? `[PREVIOUS SESSION MEMORY]\n${state.sessions.map(s => `${s.date}: ${s.summary}`).join('\n')}\n\n`
    : '';

  const apiMessages = state.messages.slice(0, -1); // don't re-include what we just pushed
  if (imgB64) {
    apiMessages.push({
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: imgB64 } },
        { type: 'text', text: sessionCtx + content }
      ]
    });
  } else {
    apiMessages.push({ role: 'user', content: sessionCtx + content });
  }

  const typingEl = addTyping();

  try {
    const data = await window.ghostmind.sendAIRequest({
      messages: apiMessages,
      model: state.settings.model || 'claude-sonnet-4-5-20250929',
      systemPrompt: state.settings.systemPrompt || 'You are GhostMind, a stealth AI assistant running invisibly. Be sharp, concise, maximally helpful. Analyze screenshots thoroughly.',
      maxTokens: 2048
    });
    typingEl.remove();

    const text = data.content?.[0]?.text || '';
    addMsg('ai', text, null, false, data.usage);
    // Update state messages correctly
    state.messages[state.messages.length - 1] = { role: 'user', content: userText };
    state.messages.push({ role: 'assistant', content: text });
  } catch (e) {
    typingEl.remove();
    addMsg('system', `✗ API Error: ${e.message}`);
  }

  state.isThinking = false;
  setStatus(state.isCapturing ? 'listening' : 'ready');
  document.getElementById('send-btn').disabled = false;
}

// ─── COPILOT AUTO-ANSWER ENGINE ────────────────────────────────────────────────
function isQuestion(line) {
  if (!line) return false;
  const clean = line.trim().toLowerCase();
  
  // Ignore very short phrases or single words (e.g. "what?", "who is it?")
  if (clean.length < 15) return false;

  // Ends with question mark
  if (clean.endsWith('?')) return true;

  // Common English question words/patterns as prefixes
  const starters = [
    'what', 'why', 'how', 'who', 'where', 'when', 'which', 'whom', 'whose',
    'is ', 'are ', 'can ', 'could ', 'should ', 'would ', 'do ', 'does ', 'did ',
    'was ', 'were ', 'will ', 'has ', 'have ', 'had ', 'explain ', 'write a ',
    'implement ', 'how to ', 'what is ', 'is there ', 'can you ', 'could you '
  ];

  for (const starter of starters) {
    if (clean.startsWith(starter)) {
      return true;
    }
  }

  // Common keywords mid-sentence indicating an explicit query
  if (clean.includes('?') || clean.includes('explain how') || clean.includes('tell me how') || clean.includes('difference between')) {
    return true;
  }

  return false;
}

function isDuplicateQuestion(line) {
  const normalized = line.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  for (const item of state.lastSolvedQuestions) {
    const itemNorm = item.text.replace(/[^a-z0-9]/g, '');
    if (itemNorm === normalized || itemNorm.includes(normalized) || normalized.includes(itemNorm)) {
      if (Date.now() - item.time < 120000) { // 2 minutes cooldown
        return true;
      }
    }
  }
  return false;
}

async function askCopilotAI(question) {
  if (state.isThinking) return; // avoid overlapping requests
  if (!state.settings.apiKey) return;

  state.isThinking = true;
  setStatus('thinking');
  document.getElementById('send-btn').disabled = true;

  // Show user bubble as Copilot Auto-Answer
  addMsg('user', question, null, true);

  const copilotSystemPrompt = "You are GhostMind Copilot. Solve the user's question directly, clearly, and concisely. If it is a coding question, provide working, well-commented code blocks. Keep non-essential explanations to a minimum.";
  
  const apiMessages = state.messages.slice(0, -1);
  const sessionCtx = state.sessions.length > 0
    ? `[PREVIOUS SESSION MEMORY]\n${state.sessions.map(s => `${s.date}: ${s.summary}`).join('\n')}\n\n`
    : '';
  apiMessages.push({ role: 'user', content: sessionCtx + question });

  const typingEl = addTyping();

  try {
    const data = await window.ghostmind.sendAIRequest({
      messages: apiMessages,
      model: state.settings.model || 'claude-sonnet-4-5-20250929',
      systemPrompt: copilotSystemPrompt,
      maxTokens: 2048
    });
    typingEl.remove();

    const text = data.content?.[0]?.text || '';
    addMsg('ai', text, null, true, data.usage);
    
    // Update state messages correctly
    state.messages[state.messages.length - 1] = { role: 'user', content: question };
    state.messages.push({ role: 'assistant', content: text });
  } catch (e) {
    typingEl.remove();
    addMsg('system', `✗ Copilot Error: ${e.message}`);
  }

  state.isThinking = false;
  setStatus(state.isCapturing ? 'listening' : 'ready');
  document.getElementById('send-btn').disabled = false;
}

function processTranscriptLine(line) {
  if (!line || line.trim().length === 0) return;
  const isCopilotEnabled = state.settings.copilotAutoAnswer !== undefined ? state.settings.copilotAutoAnswer : true;
  if (isCopilotEnabled && isQuestion(line) && !isDuplicateQuestion(line)) {
    state.lastSolvedQuestions.push({ text: line, time: Date.now() });
    if (state.lastSolvedQuestions.length > 5) {
      state.lastSolvedQuestions.shift();
    }
    askCopilotAI(line);
  }
}

// ─── CHAT INPUT ───────────────────────────────────────────────────────────────
const chatInput = document.getElementById('chat-input');

chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    send();
  }
});
chatInput.addEventListener('input', () => {
  chatInput.style.height = 'auto';
  chatInput.style.height = Math.min(chatInput.scrollHeight, 100) + 'px';
});

document.getElementById('send-btn').addEventListener('click', send);

function send() {
  const text = chatInput.value.trim();
  if (!text) return;
  chatInput.value = '';
  chatInput.style.height = 'auto';
  askAI(text);
}

document.querySelectorAll('.qbtn').forEach(btn => {
  btn.addEventListener('click', () => askAI(btn.dataset.p));
});

// ─── HIDE BUTTON ──────────────────────────────────────────────────────────────
document.getElementById('hide-btn').addEventListener('click', () => {
  window.ghostmind.hide();
});

document.getElementById('quit-btn').addEventListener('click', () => {
  window.ghostmind.quit();
});

// ─── SNIPE ────────────────────────────────────────────────────────────────────
document.getElementById('snipe-hotkey-btn').addEventListener('click', () => {
  window.ghostmind.triggerSnipe();
});

// Receive captured snipe image from main process
window.ghostmind.on('snipe-captured', ({ b64 }) => {
  if (!b64) {
    addMsg('system', '⚠ Screen capture failed — enable Screen Recording for Electron in System Settings → Privacy & Security, then restart the app.');
    switchTab('chat');
    return;
  }
  state.snipeImage = b64;
  showSnipeTray(b64);
  switchTab('chat');
});

function showSnipeTray(b64) {
  const tray = document.getElementById('snipe-tray');
  document.getElementById('snipe-thumb').src = `data:image/png;base64,${b64}`;
  tray.classList.add('visible');
  document.getElementById('snipe-custom-prompt').value = '';
}

document.getElementById('snipe-dismiss').addEventListener('click', () => {
  document.getElementById('snipe-tray').classList.remove('visible');
  state.snipeImage = null;
});

document.getElementById('snipe-solve').addEventListener('click', () => {
  runSnipe('Analyze this screenshot carefully. If it contains a coding problem, algorithm challenge, or technical assessment — solve it completely with working, well-commented code. Explain your approach step by step.');
});
document.getElementById('snipe-explain').addEventListener('click', () => {
  runSnipe('Explain everything visible in this screenshot in detail. Break down any code, UI elements, diagrams, or text you see.');
});
document.getElementById('snipe-extract').addEventListener('click', () => {
  runSnipe('Extract all visible text from this screenshot exactly as it appears. Format it cleanly.');
});
document.getElementById('snipe-debug').addEventListener('click', () => {
  runSnipe('Look at this code screenshot. Identify any bugs, errors, or issues. Provide the fixed version with explanation of what was wrong.');
});
document.getElementById('snipe-ask').addEventListener('click', () => {
  const q = document.getElementById('snipe-custom-prompt').value.trim();
  if (q) runSnipe(q);
});

function runSnipe(prompt) {
  if (!state.snipeImage) return;
  const img = state.snipeImage;
  document.getElementById('snipe-tray').classList.remove('visible');
  state.snipeImage = null;
  askAI(prompt, img);
}

// Zoom snipe thumbnail on click
document.getElementById('snipe-thumb').addEventListener('click', () => {
  const src = document.getElementById('snipe-thumb').src;
  const win = window.open('', '_blank', 'width=900,height=600');
  win.document.write(`<body style="margin:0;background:#000"><img src="${src}" style="max-width:100%;max-height:100vh;display:block;margin:auto;"></body>`);
});

// ─── MIC DICTATION (chat input, via the local pipeline) ─────────────────────
// The mic button turns on dictationMode and makes sure local capture is
// running. [You] transcript lines are rerouted to the chat input by the
// external-transcript handler above; stopping auto-sends, as before.
const micBtn = document.getElementById('mic-btn');

micBtn.addEventListener('click', async () => {
  if (state.isMicRecording) {
    state.isMicRecording = false;
    state.dictationMode = false;
    micBtn.classList.remove('recording');
    setStatus('ready');
    if (!state.callCaptureWanted) await stopLocalCapture();
    const val = chatInput.value.trim();
    if (val) { chatInput.value = ''; send(); }
  } else {
    chatInput.value = '';
    state.dictationMode = true;
    state.isMicRecording = true;
    micBtn.classList.add('recording');
    setStatus('listening');
    await ensureLocalCapture();
  }
});

// ─── LOCAL AUDIO CAPTURE (dual-track, on-device Whisper) ────────────────────
// Track "you"  = your microphone (exact deviceId from Settings)
// Track "them" = BlackHole / Loopback device carrying the call
// Devices are enumerated here — Electron can pick an exact device,
// which is the whole reason the Chrome Helper could be deleted.
async function populateAudioDevices() {
  try {
    // A throwaway getUserMedia call unlocks device labels.
    try {
      const tmp = await navigator.mediaDevices.getUserMedia({ audio: true });
      tmp.getTracks().forEach(t => t.stop());
    } catch (_) {}
    const inputs = await LocalCapture.listAudioInputs();
    const fill = (selectId, savedId, prefer) => {
      const sel = document.getElementById(selectId);
      if (!sel) return;
      const current = savedId || sel.value;
      sel.innerHTML = '<option value="">— not set —</option>';
      inputs.forEach(d => {
        const o = document.createElement('option');
        o.value = d.deviceId;
        o.textContent = d.label || d.deviceId;
        sel.appendChild(o);
      });
      if (current && inputs.some(d => d.deviceId === current)) sel.value = current;
      else if (prefer) {
        const hit = inputs.find(prefer);
        if (hit) sel.value = hit.deviceId;
      }
    };
    const isCall = d => /blackhole|loopback/i.test(d.label || '');
    fill('s-them-device', state.settings.themDeviceId, isCall);
    fill('s-you-device', state.settings.youDeviceId, d => !isCall(d));
    // Persist the auto-picks so main/renderer agree on first run.
    const youSel = document.getElementById('s-you-device');
    const themSel = document.getElementById('s-them-device');
    if (youSel && !state.settings.youDeviceId)  state.settings.youDeviceId  = youSel.value;
    if (themSel && !state.settings.themDeviceId) state.settings.themDeviceId = themSel.value;
  } catch (e) {
    console.log('Could not enumerate audio devices:', e);
  }
}

async function ensureLocalCapture() {
  if (state.localCapture) return true;
  const youDeviceId  = state.settings.youDeviceId  || document.getElementById('s-you-device')?.value || '';
  const themDeviceId = state.settings.themDeviceId || document.getElementById('s-them-device')?.value || '';
  if (!youDeviceId && !themDeviceId) {
    addMsg('system', '⚠ No audio devices selected — pick your mic and your BlackHole/Loopback device in Settings first.');
    return false;
  }
  try {
    await window.ghostmind.startLocalTranscription();
    const capture = new LocalCapture({
      sendSegment: (seg) => window.ghostmind.transcribeLocalSegment(seg),
      onStream: (stream, speaker) => {
        if (speaker !== 'them') return;
        try {
          if (!state.audioContext) state.audioContext = new AudioContext();
          const src = state.audioContext.createMediaStreamSource(stream);
          const analyser = state.audioContext.createAnalyser();
          analyser.fftSize = 512;
          src.connect(analyser);
          drawWaveform(analyser, 'waveform-canvas');
          drawWaveform(analyser, 'waveform-big');
        } catch (_) {}
      },
    });
    await capture.start({ youDeviceId, themDeviceId });
    state.localCapture = capture;
    state.isCapturing = true;
    document.getElementById('capture-bar').classList.add('visible');
    document.getElementById('capture-label').textContent = 'CAPTURING · LOCAL WHISPER';
    const badge = document.getElementById('audio-badge');
    if (badge) badge.classList.add('visible', 'recording');
    document.getElementById('audio-waveform-big').style.display = 'block';
    document.getElementById('transcript-full').style.display = 'flex';
    document.getElementById('transcript-bar').classList.add('visible');
    setStatus('listening');
    addMsg('system', '🎙 Local transcription started (on-device Whisper, nothing leaves this Mac)');
    return true;
  } catch (e) {
    addMsg('system', `✗ Could not start local transcription: ${e.message}. Is the sidecar installed? See README → Installation.`);
    return false;
  }
}

async function stopLocalCapture() {
  if (state.localCapture) { try { state.localCapture.stop(); } catch (_) {} state.localCapture = null; }
  try { await window.ghostmind.stopLocalTranscription(); } catch (_) {}
  if (state.audioContext) { try { state.audioContext.close(); } catch (_) {} state.audioContext = null; }
  state.isCapturing = false;
  document.getElementById('capture-bar').classList.remove('visible');
  document.getElementById('transcript-bar').classList.remove('visible');
  const badge = document.getElementById('audio-badge');
  if (badge) badge.classList.remove('visible', 'recording');
  document.getElementById('audio-waveform-big').style.display = 'none';
  const btn = document.getElementById('local-transcription-toggle-btn');
  if (btn) { btn.textContent = '🎙 Start Transcription'; btn.style.color = 'var(--acid)'; }
  setStatus('ready');
  addMsg('system', '⏹ Local transcription stopped');
}

function drawWaveform(analyser, canvasId) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx    = canvas.getContext('2d');
  const buf    = new Uint8Array(analyser.frequencyBinCount);

  const accent = getComputedStyle(document.documentElement).getPropertyValue('--acid').trim() || '#00ff88';

  function draw() {
    if (!state.isCapturing) return;
    requestAnimationFrame(draw);
    analyser.getByteTimeDomainData(buf);

    canvas.width  = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = accent;
    ctx.lineWidth   = 1.5;
    ctx.shadowColor = accent;
    ctx.shadowBlur  = 4;
    ctx.beginPath();

    buf.forEach((v, i) => {
      const x = (i / buf.length) * canvas.width;
      const y = ((v / 128) - 1) * (canvas.height / 2.2) + canvas.height / 2;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();
  }
  draw();
}

function handleTranscriptLine(line) {
  if (!line || line.trim().length === 0) return;
  state.transcript.push(line);
  addTranscriptLine(line);
  processTranscriptLine(line);
  if (state.transcript.length % 6 === 0 && state.settings.proactiveMode) {
    triggerProactiveInsight();
  }
}

function addTranscriptLine(line) {
  const scroll = document.getElementById('transcript-scroll');
  const all    = document.getElementById('transcript-all');
  const p      = document.createElement('p');
  p.className  = 't-line new';
  p.textContent = line;
  scroll.appendChild(p);
  scroll.scrollTop = scroll.scrollHeight;
  setTimeout(() => p.classList.remove('new'), 800);

  if (all) {
    all.textContent += (all.textContent ? '\n' : '') + line;
    all.scrollTop = all.scrollHeight;
  }
}

document.getElementById('capture-stop').addEventListener('click', async () => {
  state.callCaptureWanted = false;
  if (state.isMicRecording) { state.isMicRecording = false; state.dictationMode = false; micBtn.classList.remove('recording'); }
  await stopLocalCapture();
});
document.getElementById('local-transcription-toggle-btn')?.addEventListener('click', async () => {
  if (state.callCaptureWanted) {
    state.callCaptureWanted = false;
    if (!state.isMicRecording) await stopLocalCapture();
    else {
      const btn = document.getElementById('local-transcription-toggle-btn');
      if (btn) { btn.textContent = '🎙 Start Transcription'; btn.style.color = 'var(--acid)'; }
    }
  } else {
    state.callCaptureWanted = true;
    const ok = await ensureLocalCapture();
    const btn = document.getElementById('local-transcription-toggle-btn');
    if (btn && ok) { btn.textContent = '⏹ Stop Transcription'; btn.style.color = 'var(--amber)'; }
    if (!ok) state.callCaptureWanted = false;
  }
});
document.getElementById('transcript-toggle-btn').addEventListener('click', () => {
  const bar = document.getElementById('transcript-bar');
  bar.classList.toggle('visible');
});
document.getElementById('analyze-transcript-btn').addEventListener('click', () => {
  const text = state.transcript.join('\n');
  if (!text) { addMsg('system', 'No transcript yet'); return; }
  askAI(`Here is the full transcript so far. Give me: 1) A concise summary, 2) Key decisions made, 3) Action items, 4) Any open questions.\n\n${text}`);
  switchTab('chat');
});

// ─── PROACTIVE INTELLIGENCE ───────────────────────────────────────────────────
async function triggerProactiveInsight() {
  if (!state.settings.apiKey || state.isThinking) return;
  const recent = state.transcript.slice(-6).join(' ');
  try {
    const data = await window.ghostmind.sendAIRequest({
      messages: [{ role: 'user', content: `Conversation context: "${recent}"\n\nOne insight:` }],
      model: 'claude-haiku-4-5-20251001',
      systemPrompt: 'You are a silent assistant. Based on conversation context, give ONE ultra-short insight, warning, or suggestion (max 15 words). No preamble.',
      maxTokens: 80
    });
    const text = data.content?.[0]?.text?.trim();
    if (text) showProactiveBadge(text);
  } catch(_) {}
}

// Screen snapshot proactive analysis
window.ghostmind.on('screen-snapshot', async ({ b64, mediaType = 'image/png' }) => {
  if (!state.settings.proactiveMode || !state.settings.apiKey || state.isThinking) return;
  if (state.screenAnalysisInFlight || !b64) return;

  state.screenAnalysisInFlight = true;
  state.lastScreenB64 = b64;
  try {
    const data = await window.ghostmind.sendAIRequest({
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: b64 } },
          { type: 'text', text: 'What do you notice?' }
        ]
      }],
      model: 'claude-haiku-4-5-20251001',
      systemPrompt: 'You are a silent AI assistant watching someone\'s screen. If you see something interesting, a problem, or something you can help with — give ONE short proactive suggestion (max 15 words). If nothing interesting, respond with just: "ok".',
      maxTokens: 80
    });
    const text = data.content?.[0]?.text?.trim();
    if (text && text.toLowerCase() !== 'ok' && text.length > 3) {
      showProactiveBadge(text);
    }
  } catch(_) {}
  finally {
    state.screenAnalysisInFlight = false;
    state.lastScreenB64 = null;
  }
});

function showProactiveBadge(text) {
  const badge = document.getElementById('proactive-badge');
  badge.textContent = text; // setter clears ::before pseudoelement text, which is fine
  // Re-add the label via a wrapper
  badge.innerHTML = `<span style="font-family:var(--font-mono);font-size:8px;letter-spacing:1.5px;color:var(--acid);display:block;margin-bottom:4px;">⬡ INSIGHT</span>${escHtml(text)}`;
  badge.classList.add('visible');
  clearTimeout(state.proactiveTimer);
  state.proactiveTimer = setTimeout(() => badge.classList.remove('visible'), 8000);
  badge.onclick = () => {
    badge.classList.remove('visible');
    askAI('Tell me more about your last insight: ' + text);
    switchTab('chat');
  };
}

// ─── CLIPBOARD WATCHER ────────────────────────────────────────────────────────
let clipboardDismissTimer;

window.ghostmind.on('clipboard-change', ({ text }) => {
  const preview = document.getElementById('clipboard-preview');
  const toast   = document.getElementById('clipboard-toast');
  preview.textContent = text.slice(0, 80) + (text.length > 80 ? '…' : '');
  toast.classList.add('visible');
  clearTimeout(clipboardDismissTimer);
  clipboardDismissTimer = setTimeout(() => toast.classList.remove('visible'), 6000);
  // Store for use
  toast.dataset.text = text;
});

document.getElementById('clipboard-ask-btn').addEventListener('click', () => {
  const text = document.getElementById('clipboard-toast').dataset.text;
  document.getElementById('clipboard-toast').classList.remove('visible');
  askAI(`I just copied this — help me with it:\n\n${text}`);
  switchTab('chat');
});

document.getElementById('clipboard-dismiss').addEventListener('click', () => {
  document.getElementById('clipboard-toast').classList.remove('visible');
});

// ─── SESSION MEMORY ───────────────────────────────────────────────────────────
document.getElementById('save-session-btn').addEventListener('click', async () => {
  if (state.messages.length < 2) { addMsg('system', 'No conversation to save yet'); return; }
  // Ask AI to summarize the session
  try {
    const data = await window.ghostmind.sendAIRequest({
      messages: state.messages.slice(-10),
      model: 'claude-haiku-4-5-20251001',
      systemPrompt: 'Summarize this conversation in 2-3 sentences. Focus on what was discussed and any conclusions. Be concise.',
      maxTokens: 150
    });
    const summary = data.content?.[0]?.text || 'Session recorded';
    await window.ghostmind.saveSession({ summary });
    state.sessions = await window.ghostmind.getSessions();
    renderMemory(state.sessions);
    addMsg('system', '✓ Session saved to memory');
  } catch(e) {
    addMsg('system', `✗ Could not save: ${e.message}`);
  }
});

function renderMemory(sessions) {
  // Update badge if called before DOM is ready
  const list = document.getElementById('memory-list');
  if (!list) return;
  if (!sessions || sessions.length === 0) {
    list.innerHTML = '<div class="empty-state">NO SESSIONS SAVED<br>CONVERSATIONS APPEAR HERE</div>';
    return;
  }
  list.innerHTML = sessions.slice().reverse().map(s => `
    <div class="memory-item">
      <div class="memory-date">${new Date(s.date).toLocaleString()}</div>
      <div class="memory-text">${escHtml(s.summary)}</div>
      <button class="memory-load" onclick="loadMemoryContext('${escAttr(s.summary)}')">LOAD AS CONTEXT</button>
    </div>
  `).join('');
}

function loadMemoryPanel() {
  renderMemory(state.sessions);
}

window.loadMemoryContext = (summary) => {
  state.messages.unshift({ role: 'user', content: `[Past session context] ${summary}` });
  addMsg('system', '✓ Session context loaded into conversation');
  switchTab('chat');
};

// ─── MARKDOWN RENDERER ────────────────────────────────────────────────────────
function renderMarkdown(text) {
  return escHtml(text)
    .replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) =>
      `<pre><code>${code.trim()}</code></pre>`)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g,     '<em>$1</em>')
    .replace(/^### (.+)$/gm,   '<strong style="color:var(--acid);display:block;margin:8px 0 4px;">$1</strong>')
    .replace(/^## (.+)$/gm,    '<strong style="color:var(--acid);font-size:14px;display:block;margin:10px 0 4px;">$1</strong>')
    .replace(/^- (.+)$/gm,     '· $1')
    .replace(/\n/g,             '<br>');
}

// ─── UTILS ────────────────────────────────────────────────────────────────────
function escHtml(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function escAttr(s) {
  return String(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Global key shortcut for quitting (Cmd/Ctrl + Q)
window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'q') {
    e.preventDefault();
    window.ghostmind.quit();
  }
});

// ─── STEALTH VIRTUAL CURSOR ───────────────────────────────────────────────────
function initStealthCursor() {
  const cursor = document.createElement('div');
  cursor.id = 'stealth-cursor';
  document.body.appendChild(cursor);

  document.addEventListener('mousemove', (e) => {
    cursor.style.left = e.clientX + 'px';
    cursor.style.top = e.clientY + 'px';
    cursor.style.display = 'block';

    const target = e.target;
    if (!target) return;

    const computedStyle = window.getComputedStyle(target);
    const cursorType = computedStyle.cursor;

    if (cursorType === 'pointer' || target.tagName === 'BUTTON' || target.closest('a') || target.classList.contains('qbtn') || target.classList.contains('tab') || target.classList.contains('source-item') || target.id === 'status' || target.id === 'keep-alive-banner' || target.id === 'local-transcription-toggle-btn') {
      cursor.className = 'pointer';
    } else if (cursorType === 'text' || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
      cursor.className = 'text';
    } else {
      cursor.className = 'default';
    }
  });

  document.addEventListener('mouseleave', () => {
    cursor.style.display = 'none';
  });

  document.addEventListener('mouseenter', () => {
    cursor.style.display = 'block';
  });
}

initStealthCursor();
