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
  snipeImages:   [],          // v3.5: queue of base64 PNGs from the sniper
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
  // v3.5.8: warm the Whisper engine in the background so the first
  // Start Listening picks up in a couple of seconds (see below).
  prewarmTranscription();
  // First run (no AI key yet): greet with the friendly setup wizard.
  if (!state.settings.apiKey && !state.settings.anthropicKey) {
    setTimeout(() => openWizard(), 600);
  }
}

window.ghostmind.on('init', handleInit);

// v3.5: transcription problems are VISIBLE now. Before this, a failing
// engine produced permanent silence behind a healthy-looking CAPTURING bar.
// Errors are throttled: the same error re-appears at most every 30 s.
let lastTxError = { text: '', at: 0 };
window.ghostmind.on('transcription-error', ({ error }) => {
  if (!error) return;
  const now = Date.now();
  if (error === lastTxError.text && now - lastTxError.at < 30000) return;
  lastTxError = { text: error, at: now };
  addMsg('system', `⚠ Transcription problem: ${error}`);
});
let txNoticeShown = false;
window.ghostmind.on('transcription-notice', ({ text }) => {
  if (!text || txNoticeShown) return;
  txNoticeShown = true;
  addMsg('system', `⏳ ${text}`);
});

window.ghostmind.on('external-transcript', ({ line, partial, speaker }) => {
  if (!line) return;

  // v3.2 live partials: provisional words for an utterance still being
  // spoken — shown dimmed in the transcript bar, never stored, and
  // cleared when the final segment for that speaker lands.
  const partialEl = document.getElementById('live-partial');
  if (partial) {
    if (partialEl) {
      partialEl.textContent = line + ' …';
      partialEl.dataset.speaker = speaker || '';
      partialEl.style.display = 'block';
      document.getElementById('transcript-bar').classList.add('visible');
    }
    return;
  }
  if (partialEl && partialEl.dataset.speaker === (speaker || '')) {
    partialEl.style.display = 'none';
    partialEl.textContent = '';
  }

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
  trackEchoAndChips(line);

  if (state.transcript.length % 6 === 0 && state.settings.proactiveMode) {
    triggerProactiveInsight();
  }
  if (state.transcript.length % 12 === 0) {
    updateLiveSummary();
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
  if (state.callCaptureWanted) syncHomeListen(active);
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

// Memory search (v3.2): filter the session list as you type.
document.getElementById('memory-search')?.addEventListener('input', () => {
  renderMemory(state.sessions);
});

// ─── LIVE SUMMARY + POST-CALL MAGIC (v3.1) ───────────────────────────────────
// A running "so far" line in the transcript bar, refreshed every 12 lines,
// and — when a call ends — an automatic summary + follow-up email draft.
let summaryBusy = false;
async function updateLiveSummary() {
  if (summaryBusy || !state.settings?.apiKey || state.transcript.length < 6) return;
  summaryBusy = true;
  try {
    const data = await window.ghostmind.sendAIRequest({
      messages: [{ role: 'user', content: state.transcript.slice(-40).join('\n') }],
      model: 'claude-haiku-5-5',
      systemPrompt: 'Summarize this call transcript so far in ONE friendly sentence (max 25 words) starting with "So far:". Plain words, no preamble.',
      maxTokens: 90,
    });
    const text = data.content?.[0]?.text?.trim();
    const el = document.getElementById('live-summary');
    if (text && el) { el.textContent = '🧭 ' + text; el.style.display = 'block'; }
  } catch (_) {}
  summaryBusy = false;
}

let postCallBusy = false;
async function generatePostCall() {
  if (postCallBusy || !state.settings?.apiKey || state.transcript.length < 4) return;
  postCallBusy = true;
  try {
    const transcript = state.transcript.slice(-80).join('\n');
    const data = await window.ghostmind.sendAIRequest({
      messages: [{ role: 'user', content: transcript }],
      model: state.settings.model || 'claude-sonnet-5-5',
      systemPrompt: 'You are GhostMind. From the call transcript, reply with exactly two sections headed "SUMMARY" and "EMAIL". SUMMARY: 3-5 short bullet lines (decisions, key points, action items with owners). EMAIL: a short, warm follow-up email the user could send (subject line first, then 3-5 sentences, sign off as the user). Plain language. No other text.',
      maxTokens: 700,
    });
    const text = data.content?.[0]?.text?.trim();
    if (!text) return;
    const idx = text.indexOf('EMAIL');
    const summary = (idx >= 0 ? text.slice(0, idx) : text).replace(/^SUMMARY\s*/i, '').trim();
    const email = idx >= 0 ? text.slice(idx).replace(/^EMAIL\s*/i, '').trim() : '';

    const wrap = document.createElement('div');
    wrap.className = 'msg system';
    const card = document.createElement('div');
    card.className = 'postcall-card';
    const h1 = document.createElement('h4'); h1.textContent = '📋 Call summary';
    const p1 = document.createElement('div'); p1.textContent = summary;
    card.appendChild(h1); card.appendChild(p1);
    if (email) {
      const h2 = document.createElement('h4'); h2.textContent = '✉️ Follow-up email draft';
      const p2 = document.createElement('div'); p2.textContent = email;
      card.appendChild(h2); card.appendChild(p2);
    }
    const actions = document.createElement('div');
    actions.className = 'pc-actions';
    const mkBtn = (label, getText) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.addEventListener('click', () => {
        navigator.clipboard.writeText(getText()).catch(() => {});
        b.textContent = 'Copied ✓';
        setTimeout(() => { b.textContent = label; }, 1500);
      });
      return b;
    };
    actions.appendChild(mkBtn('Copy summary', () => summary));
    if (email) actions.appendChild(mkBtn('Copy email', () => email));
    card.appendChild(actions);
    wrap.appendChild(card);
    const messages = document.getElementById('messages');
    messages.appendChild(wrap);
    messages.scrollTop = messages.scrollHeight;
  } catch (_) {}
  postCallBusy = false;
}

// ─── FRIENDLY HOME BAR + SETUP WIZARD (v3.0) ─────────────────────────────────
function syncHomeListen(active) {
  const b = document.getElementById('home-listen-btn');
  if (!b) return;
  b.textContent = active ? '⏹ Stop Listening' : '🎧 Start Listening';
  b.classList.toggle('listening', !!active);
  const call = document.getElementById('pill-call');
  if (call) {
    call.classList.toggle('live', !!active);
    if (active) call.classList.add('ok');
  }
}

function updatePills() {
  const mic  = document.getElementById('pill-mic');
  const call = document.getElementById('pill-call');
  const ai   = document.getElementById('pill-ai');
  if (ai) {
    // v3.4: the AI pill tells the truth — green only after a real probe
    // request succeeded (see checkAIConnection below). Before the first
    // probe completes it falls back to "a key exists".
    ai.classList.toggle('ok', aiProbe.state === 'ok' || (aiProbe.state === 'unknown' && !!(state.settings && state.settings.apiKey)));
    ai.classList.toggle('bad', aiProbe.state === 'fail');
    ai.classList.toggle('checking', aiProbe.state === 'checking');
    ai.title = aiProbe.state === 'ok' ? `AI verified — ${aiProbe.model} answered in ${aiProbe.ms}ms`
      : aiProbe.state === 'fail' ? `AI check failed: ${aiProbe.error}`
      : aiProbe.state === 'checking' ? 'Checking the AI connection…'
      : 'AI connection not verified yet';
  }
  const youSel  = document.getElementById('s-you-device');
  const themSel = document.getElementById('s-them-device');
  if (mic  && youSel)  mic.classList.toggle('ok', youSel.options.length > 0);
  if (call && themSel) call.classList.toggle('ok', !!themSel.value);
}

document.getElementById('home-listen-btn')?.addEventListener('click', () => {
  document.getElementById('local-transcription-toggle-btn')?.click();
});
document.getElementById('home-setup-btn')?.addEventListener('click', () => openWizard());

// ─── v3.4: TRUTHFUL AI PILL, LIVE MODEL LIST, DIAGNOSTICS ────────────────────
let aiProbe = { state: 'unknown', model: '', ms: 0, error: '', at: 0 };

async function checkAIConnection(force = false) {
  if (!state.settings || !state.settings.apiKey) {
    aiProbe = { state: 'unknown', model: '', ms: 0, error: '', at: Date.now() };
    updatePills();
    return;
  }
  if (!force && aiProbe.state === 'ok' && Date.now() - aiProbe.at < 30000) return;
  aiProbe = { ...aiProbe, state: 'checking' };
  updatePills();
  try {
    const r = await window.ghostmind.checkAI();
    aiProbe = r.ok
      ? { state: 'ok', model: r.model || '', ms: r.ms || 0, error: '', at: Date.now() }
      : { state: 'fail', model: r.model || '', ms: 0, error: r.error || 'Unknown error', at: Date.now() };
  } catch (e) {
    aiProbe = { state: 'fail', model: '', ms: 0, error: e.message, at: Date.now() };
  }
  updatePills();
}

async function populateModels() {
  const sel = document.getElementById('s-model');
  if (!sel) return;
  try {
    const models = await window.ghostmind.listModels();
    if (!models || !models.length) return; // keep the built-in fallback list
    const current = (state.settings && state.settings.model) || sel.value;
    sel.innerHTML = '';
    for (const m of models.slice(0, 12)) {
      const o = document.createElement('option');
      o.value = m.id;
      o.textContent = m.name === m.id ? m.id : `${m.name} — ${m.id}`;
      sel.appendChild(o);
    }
    if (current && ![...sel.options].some(o => o.value === current)) {
      const o = document.createElement('option');
      o.value = current;
      o.textContent = `${current} (saved)`;
      sel.prepend(o);
    }
    if (current) sel.value = current;
  } catch (_) {}
}

document.getElementById('run-checks-btn')?.addEventListener('click', async () => {
  const box = document.getElementById('diag-results');
  if (!box) return;
  box.style.display = 'block';
  box.innerHTML = '';
  const mkRow = (icon, title, hint) => {
    const row = document.createElement('div');
    row.className = 'diag-row';
    const ico = document.createElement('span');
    ico.className = 'diag-ico';
    ico.textContent = icon;
    const body = document.createElement('span');
    body.textContent = title;
    if (hint) {
      const h = document.createElement('span');
      h.className = 'diag-hint';
      h.textContent = hint;
      body.appendChild(h);
    }
    row.appendChild(ico);
    row.appendChild(body);
    box.appendChild(row);
  };
  mkRow('⏳', 'Running checks…', '');

  const hasKey = !!(state.settings && state.settings.apiKey);
  const probe = hasKey ? await window.ghostmind.checkAI().catch(e => ({ ok: false, error: e.message })) : { ok: false, error: 'No key' };
  if (probe.ok) checkAIConnection(true);

  let devs = [];
  try {
    const all = await navigator.mediaDevices.enumerateDevices();
    devs = all.filter(d => d.kind === 'audioinput');
  } catch (_) {}
  const labels = devs.map(d => (d.label || '').toLowerCase());
  const themSel = document.getElementById('s-them-device');
  const callOk = !!(themSel && themSel.value) || labels.some(l => l.includes('blackhole') || l.includes('loopback'));
  const diag = await window.ghostmind.getDiagnostics().catch(() => null);

  box.innerHTML = '';
  mkRow(hasKey ? '✅' : '❌', 'API key saved', hasKey ? '' : 'Add your Anthropic key in Settings, then Save.');
  mkRow(probe.ok ? '✅' : '❌', probe.ok ? `AI answers — ${probe.model} in ${probe.ms}ms` : 'AI is not answering', probe.ok ? '' : (probe.error || ''));
  mkRow(devs.length ? '✅' : '❌', devs.length ? `Microphone found — ${devs.length} input device${devs.length === 1 ? '' : 's'}` : 'No microphone found', devs.length ? '' : 'Check the macOS Microphone permission, and that a mic is connected.');
  mkRow(callOk ? '✅' : '⚠️', 'Call audio device', callOk ? '' : 'No BlackHole/Loopback device selected — GhostMind can only hear the caller through one. See the README routing guide.');
  if (diag) {
    const eng = diag.engine || {};
    const engOk = eng.bundled || (eng.python && eng.sidecar);
    mkRow(engOk ? '✅' : '❌', eng.bundled ? 'Transcription engine — bundled binary' : 'Transcription engine — Python sidecar', engOk ? '' : 'Run: npm run setup:sidecar (README install guide).');
    const si = diag.secureInput || {};
    mkRow(si.available ? '✅' : '⚠️', si.available ? `Secure input — ${si.enabled ? 'ON (this window is focused)' : 'ready, engages when this window is focused'}` : 'Secure input unavailable', si.available ? '' : 'The native helper is missing from this build; keystrokes typed here are not shielded from event taps.');
  }
});

// ─── v3.4: ECHO GUARD + LIVE SUGGESTION CHIPS ────────────────────────────────
const themRecent = [];
let lastEchoWarnAt = 0;
let chipsTimer = null;

function wordSet(t) {
  return new Set(t.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 2));
}

function trackEchoAndChips(line) {
  const now = Date.now();
  if (line.startsWith('[Them]')) {
    const text = line.replace(/^\[Them\]\s*/, '');
    themRecent.push({ text, t: now });
    while (themRecent.length && now - themRecent[0].t > 5000) themRecent.shift();
    if (text.includes('?')) showSuggestChips();
    return;
  }
  if (line.startsWith('[You]')) {
    const yw = wordSet(line.replace(/^\[You\]\s*/, ''));
    if (yw.size < 4) return;
    for (const th of themRecent) {
      const tw = wordSet(th.text);
      if (!tw.size) continue;
      let inter = 0;
      yw.forEach(w => { if (tw.has(w)) inter++; });
      const sim = inter / Math.max(yw.size, tw.size);
      if (sim >= 0.7 && now - lastEchoWarnAt > 60000) {
        lastEchoWarnAt = now;
        addMsg('system', '⚠ Echo check: your microphone seems to be picking up the caller. Headphones fix this — or check that your call app is using your real microphone, not Loopback/BlackHole.');
        break;
      }
    }
  }
}

function showSuggestChips() {
  const box = document.getElementById('suggest-chips');
  if (!box) return;
  box.innerHTML = '';
  const chips = [
    ['✍️ Draft my reply', 'Draft my reply to the caller'],
    ['❓ Explain that', 'Explain what the caller just said, simply and briefly'],
    ['📋 Summarize so far', 'Summarize the call so far'],
  ];
  for (const [label, prompt] of chips) {
    const b = document.createElement('button');
    b.className = 'schip';
    b.textContent = label;
    b.addEventListener('click', () => { hideSuggestChips(); askAI(prompt); });
    box.appendChild(b);
  }
  box.classList.add('visible');
  clearTimeout(chipsTimer);
  chipsTimer = setTimeout(hideSuggestChips, 25000);
}

function hideSuggestChips() {
  const box = document.getElementById('suggest-chips');
  if (box) { box.classList.remove('visible'); box.innerHTML = ''; }
}

// ─── v3.4: COMPACT MODE, EXPORT, ASK-MY-CALLS ────────────────────────────────
document.getElementById('home-compact-btn')?.addEventListener('click', () => {
  const on = document.body.classList.toggle('compact');
  const btn = document.getElementById('home-compact-btn');
  if (btn) btn.textContent = on ? '🗖 Expand' : '🗗 Compact';
  if (on) document.getElementById('transcript-bar')?.classList.add('visible');
  try { window.ghostmind.resizeWindow(window.innerWidth, on ? 320 : 700); } catch (_) {}
});

document.getElementById('export-session-btn')?.addEventListener('click', async () => {
  const lines = [`# GhostMind session — ${new Date().toLocaleString()}`];
  if (state.transcript.length) {
    lines.push('', '## Call transcript', '', ...state.transcript);
  }
  const chat = (state.messages || []).filter(m => typeof m.content === 'string');
  if (chat.length) {
    lines.push('', '## Chat', '');
    for (const m of chat) lines.push(`**${m.role === 'user' ? 'You' : 'GhostMind'}:** ${m.content}`, '');
  }
  try {
    const r = await window.ghostmind.exportSession(lines.join('\n'));
    addMsg('system', `⬇ Session exported to ${r.path}`);
    switchTab('chat');
  } catch (e) {
    addMsg('system', `✗ Export failed: ${e.message}`);
  }
});

document.getElementById('ask-calls-btn')?.addEventListener('click', async () => {
  const input = document.getElementById('ask-calls-input');
  const out = document.getElementById('ask-calls-answer');
  const q = (input?.value || '').trim();
  if (!q || !out) return;
  out.style.display = 'block';
  if (!state.sessions || !state.sessions.length) {
    out.textContent = 'No saved sessions yet — have a call, save the session, then ask about it here.';
    return;
  }
  out.textContent = 'Thinking…';
  try {
    const ctx = state.sessions.map(s => `- ${s.date}: ${s.summary}`).join('\n');
    const data = await window.ghostmind.sendAIRequest({
      messages: [{ role: 'user', content: `Here are summaries of my past GhostMind sessions:\n\n${ctx}\n\nQuestion: ${q}\n\nAnswer using only these summaries. If they don't cover the question, say so plainly.` }],
      model: 'claude-haiku-5-5',
      maxTokens: 600,
    });
    out.innerHTML = renderMarkdown(data.content?.[0]?.text || 'No answer.');
  } catch (e) {
    out.textContent = `✗ ${e.message}`;
  }
});

// Wizard ---------------------------------------------------------------
let wizStep = 1;
function wizShow(step) {
  wizStep = step;
  document.querySelectorAll('.wiz-step').forEach(el => {
    el.classList.toggle('active', Number(el.dataset.step) === step);
  });
  const dots = document.getElementById('wiz-dots');
  if (dots) dots.textContent = [1, 2, 3, 4].map(i => (i === step ? '●' : '○')).join(' ');
}
function openWizard() {
  const w = document.getElementById('wizard');
  if (!w) return;
  const keyInput = document.getElementById('wiz-key');
  if (keyInput && state.settings?.apiKey) keyInput.value = state.settings.apiKey;
  w.classList.add('open');
  wizShow(1);
}
function closeWizard() {
  document.getElementById('wizard')?.classList.remove('open');
  stopWizTest();
}

let wizStream = null, wizRaf = null;
function stopWizTest() {
  if (wizRaf) cancelAnimationFrame(wizRaf);
  wizRaf = null;
  if (wizStream) { wizStream.getTracks().forEach(t => t.stop()); wizStream = null; }
  const fill = document.getElementById('wiz-level-fill');
  if (fill) fill.style.width = '0%';
}

async function wizFillDevices() {
  try {
    try {
      const tmp = await navigator.mediaDevices.getUserMedia({ audio: true });
      tmp.getTracks().forEach(t => t.stop());
    } catch (_) {}
    const devices = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput');
    const fill = (id, preferCall) => {
      const sel = document.getElementById(id);
      if (!sel) return;
      sel.innerHTML = '';
      devices.forEach((d, i) => {
        const opt = document.createElement('option');
        opt.value = d.deviceId;
        opt.textContent = d.label || `Microphone ${i + 1}`;
        sel.appendChild(opt);
      });
      // v3.5.5: resolve through the shared helpers — a saved 'default'
      // (the microphone) must never land on the Call audio picker.
      if (preferCall) {
        const youVal = document.getElementById('wiz-you')?.value || state.settings?.youDeviceId;
        const r = resolveThemDeviceId(devices, state.settings?.themDeviceId, youVal);
        if (r) sel.value = r;
      } else {
        const r = resolveYouDeviceId(devices, state.settings?.youDeviceId, state.settings?.themDeviceId);
        if (r) sel.value = r;
      }
    };
    fill('wiz-you', false);
    fill('wiz-them', true);
  } catch (e) { console.warn('Wizard device list failed', e); }
}

async function wizSave(patch) {
  const current = (await window.ghostmind.getSettings()) || {};
  const merged = { ...current, ...(state.settings || {}), ...patch };
  await window.ghostmind.saveSettings(merged);
  state.settings = merged;
  applySettings(merged);
  return merged;
}

document.getElementById('wiz-start-btn')?.addEventListener('click', () => wizShow(2));
document.getElementById('wiz-skip-1')?.addEventListener('click', closeWizard);
document.getElementById('wiz-skip-2')?.addEventListener('click', () => { wizFillDevices(); wizShow(3); });
document.getElementById('wiz-skip-3')?.addEventListener('click', () => wizShow(4));
document.getElementById('wiz-key-btn')?.addEventListener('click', async () => {
  const key = document.getElementById('wiz-key').value.trim();
  if (key) await wizSave({ apiKey: key, anthropicKey: key });
  await wizFillDevices();
  wizShow(3);
});
document.getElementById('wiz-test-btn')?.addEventListener('click', async () => {
  stopWizTest();
  try {
    const deviceId = document.getElementById('wiz-you').value;
    wizStream = await navigator.mediaDevices.getUserMedia({
      audio: deviceId ? { deviceId: { exact: deviceId } } : true,
    });
    const ctx = new AudioContext();
    const src = ctx.createMediaStreamSource(wizStream);
    const an = ctx.createAnalyser();
    an.fftSize = 512;
    src.connect(an);
    const buf = new Uint8Array(an.fftSize);
    const fill = document.getElementById('wiz-level-fill');
    const started = Date.now();
    const tick = () => {
      an.getByteTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) { const d = (v - 128) / 128; sum += d * d; }
      const rms = Math.sqrt(sum / buf.length);
      if (fill) fill.style.width = Math.min(100, Math.round(rms * 260)) + '%';
      if (Date.now() - started < 6000) { wizRaf = requestAnimationFrame(tick); }
      else { stopWizTest(); ctx.close(); }
    };
    tick();
  } catch (e) {
    addMsg('system', '⚠ Microphone test failed — check the Microphone permission in macOS Settings');
  }
});
document.getElementById('wiz-sound-btn')?.addEventListener('click', async () => {
  stopWizTest();
  const you  = document.getElementById('wiz-you').value;
  const them = document.getElementById('wiz-them').value;
  await wizSave({ youDeviceId: you, themDeviceId: them, transcriptionMethod: 'local' });
  wizShow(4);
});
document.getElementById('wiz-finish-btn')?.addEventListener('click', () => {
  closeWizard();
  addMsg('system', '✅ You are all set — tap 🎧 Start Listening whenever a call begins');
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
  sid('s-model').value     = s.model     || 'claude-sonnet-5-5';
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

  if (s.deepThinking) document.getElementById('t-deepthinking').classList.add('on');
  else document.getElementById('t-deepthinking').classList.remove('on');

  if (s.codeOnlyMode) document.getElementById('t-codeonly').classList.add('on');
  else document.getElementById('t-codeonly').classList.remove('on');

  // Device dropdowns are populated async by populateAudioDevices();
  // apply the saved picks once options exist.
  if (s.youDeviceId)  sid('s-you-device').value  = s.youDeviceId;
  if (s.themDeviceId) sid('s-them-device').value = s.themDeviceId;
  updatePills();
  checkAIConnection();
  populateModels();
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
    deepThinking: document.getElementById('t-deepthinking').classList.contains('on'),
    codeOnlyMode: document.getElementById('t-codeonly').classList.contains('on'),
  };
  await window.ghostmind.saveSettings(s);
  state.settings = s;
  checkAIConnection(true);
  populateModels();
  setStatus(s.apiKey ? 'ready' : 'offline');
  addMsg('system', '✓ Settings saved');
  switchTab('chat');
});

// Theme picker previews live; it is persisted by Save Settings.
document.getElementById('s-theme').addEventListener('change', (e) => {
  applyTheme(e.target.value);
});

// Toggles — bind every .toggle in Settings. (v3.5 fix: t-deepthinking was
// added to the panel in v3.3 but never to the old hand-maintained list, so
// the Deep Thinking switch was dead. Binding by class makes that class of
// bug impossible for future toggles.)
document.querySelectorAll('#panel-settings .toggle').forEach(t => {
  t.addEventListener('click', () => { t.classList.toggle('on'); });
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
    // v3.5: one image or an array of queued snapshots
    const imgs = Array.isArray(imgB64) ? imgB64 : [imgB64];
    inner += imgs.map(b => `<img class="msg-img" src="data:image/png;base64,${b}" alt="screenshot">`).join('');
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

// ─── STREAMING AI (v3.3) ─────────────────────────────────────────────────────
// One dispatcher for the app's lifetime; askAI() is serialized by
// state.isThinking, so a single active stream is all we ever track.
let activeStream = null;
window.ghostmind.on('ai-stream-chunk', ({ requestId, text }) => {
  if (!activeStream || activeStream.requestId !== requestId) return;
  activeStream.full += text;
  activeStream.render();
});
window.ghostmind.on('ai-stream-done', ({ requestId, text }) => {
  if (!activeStream || activeStream.requestId !== requestId) return;
  const s = activeStream; activeStream = null;
  s.resolve(text || s.full);
});
window.ghostmind.on('ai-stream-error', ({ requestId, message }) => {
  if (!activeStream || activeStream.requestId !== requestId) return;
  const s = activeStream; activeStream = null;
  s.reject(new Error(message || 'Stream failed'));
});

function streamAIRequest(payload, typingEl) {
  return new Promise((resolve, reject) => {
    const requestId = 'r' + Date.now() + Math.random().toString(36).slice(2, 8);
    const bubble = typingEl.querySelector('.bubble');
    let renderQueued = false;
    activeStream = {
      requestId, full: '', resolve, reject,
      render() {
        if (renderQueued) return;
        renderQueued = true;
        requestAnimationFrame(() => {
          renderQueued = false;
          if (bubble && activeStream) bubble.innerHTML = renderMarkdown(activeStream.full);
          const msgs = document.getElementById('messages');
          if (msgs) msgs.scrollTop = msgs.scrollHeight;
        });
      },
    };
    window.ghostmind.sendAIRequestStream({ requestId, ...payload }).catch((e) => {
      if (activeStream && activeStream.requestId === requestId) activeStream = null;
      reject(e);
    });
  });
}

// ─── AI ENGINE ────────────────────────────────────────────────────────────────
// v3.5.2 Code Only mode: appended to the system prompt when the Settings
// toggle is on. Wording is an explicit override — the built-in Snipe Solve
// prompt asks for commented code, and this must win.
const CODE_ONLY_SUFFIX = '\n\nCODE-ONLY MODE IS ON: when the request involves code, reply with ONLY the code in a single code block. No comments inside the code, no explanations, no preamble, no follow-up notes. This overrides any other instruction asking for comments or step-by-step explanation.';

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
  const imgList = !imgB64 ? [] : (Array.isArray(imgB64) ? imgB64 : [imgB64]);
  if (imgList.length > 0) {
    apiMessages.push({
      role: 'user',
      content: [
        ...imgList.map(b => ({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: b } })),
        { type: 'text', text: sessionCtx + content }
      ]
    });
  } else {
    apiMessages.push({ role: 'user', content: sessionCtx + content });
  }

  const typingEl = addTyping();

  try {
    // Streamed (v3.3): the answer types itself into the typing bubble.
    const text = await streamAIRequest({
      messages: apiMessages,
      model: state.settings.model || 'claude-sonnet-5-5',
      systemPrompt: (state.settings.systemPrompt || 'You are GhostMind, an invisible AI copilot. Lead with the answer, keep it tight and scannable, no preamble.') + (state.settings.codeOnlyMode ? CODE_ONLY_SUFFIX : ''),
      maxTokens: 2048
    }, typingEl);
    typingEl.remove();

    addMsg('ai', text, null, false, null);
    // Update state messages correctly
    state.messages[state.messages.length - 1] = { role: 'user', content: userText };
    state.messages.push({ role: 'assistant', content: text });
    pushAutoDraft();
  } catch (e) {
    typingEl.remove();
    addMsg('system', `✗ API Error: ${e.message}`);
  }

  state.isThinking = false;
  setStatus(state.isCapturing ? 'listening' : 'ready');
  document.getElementById('send-btn').disabled = false;
}

// ─── COPILOT AUTO-ANSWER ENGINE ────────────────────────────────────────────────
// v3.5.8: the first sentence of a transcript line, terminator included.
function firstSentence(text) {
  const m = String(text).match(/^[^.!?]+[.!?]?/);
  return (m ? m[0] : String(text)).trim();
}

function isQuestion(line) {
  if (!line) return false;
  // v3.5.8: judge ONLY the first sentence of the segment. Whisper
  // segments bundle several sentences, and the old any-position checks
  // fired the copilot on ordinary statements — a "?" buried mid-segment,
  // or a fragment starting with an auxiliary verb ("Are going to be…",
  // "Is why some of your…"), produced 7 auto-answers in ~100 s of
  // monologue. Bare auxiliaries now count only with a trailing "?".
  const s = firstSentence(line);
  if (s.length < 10) return false;
  if (s.endsWith('?')) return true;
  const clean = s.toLowerCase();
  const starters = [
    'what', 'why', 'how', 'who', 'where', 'when', 'which', 'whom', 'whose',
    'can you', 'could you', 'can i', 'could i',
    'explain', 'write a', 'write an', 'implement', 'tell me',
  ];
  return starters.some(w => clean.startsWith(w));
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
      model: state.settings.model || 'claude-sonnet-5-5',
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
  if (!isCopilotEnabled) return;
  // v3.5.7: transcript lines arrive as "[Them] …" / "[You] …" — the
  // speaker prefix silently defeated every question-starter check in
  // isQuestion ("[them] what is…" never starts with "what"), so
  // auto-answer only fired when a segment happened to end in "?".
  // Detect on the clean text, and ask with the clean text.
  const clean = line.replace(/^\[(You|Them)\]\s*/, '');
  if (isQuestion(clean)) {
    // v3.5.8: ask with the first sentence only — the question that
    // triggered detection — not the whole multi-sentence segment.
    const q = firstSentence(clean);
    if (!isDuplicateQuestion(q)) {
      state.lastSolvedQuestions.push({ text: q, time: Date.now() });
      if (state.lastSolvedQuestions.length > 5) {
        state.lastSolvedQuestions.shift();
      }
      alog(`copilot: auto-answering: ${q.slice(0, 120)}`);
      askCopilotAI(q);
    }
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
  // v3.5: snipes queue up — capture several, then send one batch (or a
  // single one) to Claude with one prompt.
  state.snipeImages.push(b64);
  renderSnipeTray();
  switchTab('chat');
});

function renderSnipeTray() {
  const tray  = document.getElementById('snipe-tray');
  const wrap  = document.getElementById('snipe-thumbs');
  const count = document.getElementById('snipe-count');
  wrap.innerHTML = '';
  state.snipeImages.forEach((b64, i) => {
    const item = document.createElement('div');
    item.className = 'snipe-thumb-wrap';
    const img = document.createElement('img');
    img.src = `data:image/png;base64,${b64}`;
    img.alt = `snapshot ${i + 1}`;
    img.addEventListener('click', () => {
      const win = window.open('', '_blank', 'width=900,height=600');
      win.document.write(`<body style="margin:0;background:#000"><img src="${img.src}" style="max-width:100%;max-height:100vh;display:block;margin:auto;"></body>`);
    });
    const x = document.createElement('button');
    x.className = 'snipe-x';
    x.textContent = '×';
    x.title = 'Remove this snapshot';
    x.addEventListener('click', () => { state.snipeImages.splice(i, 1); renderSnipeTray(); });
    item.appendChild(img);
    item.appendChild(x);
    wrap.appendChild(item);
  });
  const n = state.snipeImages.length;
  count.textContent = n === 0 ? '' : (n === 1 ? '1 snapshot — or ＋ Add more' : `${n} snapshots — sent together`);
  document.getElementById('snipe-custom-prompt').placeholder =
    n > 1 ? 'Custom question about these snapshots...' : 'Custom question about this...';
  tray.classList.toggle('visible', n > 0);
}

function clearSnipeQueue() {
  state.snipeImages = [];
  renderSnipeTray();
}

document.getElementById('snipe-dismiss').addEventListener('click', clearSnipeQueue);

document.getElementById('snipe-add').addEventListener('click', () => {
  window.ghostmind.triggerSnipe();
});

document.getElementById('snipe-solve').addEventListener('click', () => {
  // Code Only mode: don't even ask for comments/explanation (the system
  // prompt override would win anyway, but don't fight it).
  if (state.settings.codeOnlyMode) {
    runSnipe('Solve the coding problem in this screenshot completely with working code.');
  } else {
    runSnipe('Analyze this screenshot carefully. If it contains a coding problem, algorithm challenge, or technical assessment — solve it completely with working, well-commented code. Explain your approach step by step.');
  }
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
  if (state.snipeImages.length === 0) return;
  const imgs = state.snipeImages.slice();
  clearSnipeQueue();
  document.getElementById('snipe-custom-prompt').value = '';
  // v3.5.4: batch snipes are usually fragments of ONE thing — a question
  // and its options, a problem and its code, a screen and its continuation
  // after scrolling, an error and what caused it. The old "(attached N
  // snapshots — consider all of them)" left the model to answer each one
  // separately. This note makes it reconcile first: one unified answer
  // when the snapshots belong together; separate answers only when they
  // are clearly unrelated.
  const batchNote = imgs.length > 1
    ? ` (I have attached ${imgs.length} snapshots, in the order I captured them. Before answering, work out how they relate: snapshots captured together are usually parts of ONE thing — a question and its options, a problem statement and its code, a screen and its continuation after scrolling, an error and the code that caused it. If they belong together, reconcile them into ONE unified answer: merge overlapping or continuing content, do not repeat yourself, and do not answer them one by one. Only if they are clearly unrelated, answer each one briefly and separately, and say they are unrelated.)`
    : '';
  askAI(prompt + batchNote, imgs);
}

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
// v3.5.5: device-id resolution, shared by the Settings pickers, the
// setup wizard and capture start. 'default' is Chromium's pseudo-device
// for the system default input — in practice always the microphone. It
// must never drive the Them track: both tracks then record the mic, the
// user's own voice comes back labelled [Them], and the echo guard hides
// the [You] copy. A saved Them id that is a placeholder, stale (device
// gone), or identical to the You device is treated as unset and resolved
// to a BlackHole/Loopback device when one exists. Explicit real choices
// are always respected. (Function declarations, so boot order is safe.)
function isCallDevice(d) { return /blackhole|loopback/i.test((d && d.label) || ''); }
function isPlaceholderId(id) { return !id || id === 'default'; }

// v3.5.6 diagnostics: append device facts to userData/audio-debug.log
// (via main) so audio problems can be diagnosed from the file — the
// app's window deliberately can't be inspected from outside.
function alog(msg) {
  try { window.ghostmind.audioDebug?.(`[${new Date().toISOString()}] ${msg}`); } catch (_) {}
}
function fmtInputs(inputs) {
  return inputs.map(d => `${d.label || '(no label)'}#${String(d.deviceId || '').slice(0, 8)}`).join(' | ');
}

function resolveYouDeviceId(inputs, savedYou, themId) {
  if (!isPlaceholderId(savedYou) && savedYou !== themId &&
      inputs.some(d => d.deviceId === savedYou)) return savedYou;
  // Prefer the physical device the 'default' pseudo-device stands for:
  // Chromium labels it "Default - <real label>" (hyphen or em dash).
  // This keeps You on the system default mic even when a sleeping
  // Continuity/iPhone mic happens to enumerate first.
  const def = inputs.find(d => d.deviceId === 'default');
  if (def && def.label) {
    const m = /^Default\s*[-—–]\s*(.+)$/.exec(def.label);
    if (m) {
      const hit = inputs.find(d => d.deviceId !== 'default' && !isCallDevice(d) && (d.label || '') === m[1]);
      if (hit && hit.deviceId !== themId) return hit.deviceId;
    }
  }
  const builtin = inputs.find(d => !isCallDevice(d) && d.deviceId !== 'default' && /macbook|built[- ]?in/i.test(d.label || ''));
  if (builtin && builtin.deviceId !== themId) return builtin.deviceId;
  const real = inputs.find(d => !isCallDevice(d) && d.deviceId !== 'default');
  if (real) return real.deviceId;
  const any = inputs.find(d => !isCallDevice(d));
  return any ? any.deviceId : '';
}

function resolveThemDeviceId(inputs, savedThem, youId) {
  if (!isPlaceholderId(savedThem) && savedThem !== youId &&
      inputs.some(d => d.deviceId === savedThem)) return savedThem;
  const call = inputs.find(isCallDevice);
  return call ? call.deviceId : '';
}

let _noCallDeviceAdvised = false;

async function populateAudioDevices() {
  try {
    // A throwaway getUserMedia call unlocks device labels.
    try {
      const tmp = await navigator.mediaDevices.getUserMedia({ audio: true });
      tmp.getTracks().forEach(t => t.stop());
    } catch (_) {}
    const inputs = await LocalCapture.listAudioInputs();
    const beforeYou = state.settings.youDeviceId, beforeThem = state.settings.themDeviceId;
    const youId  = resolveYouDeviceId(inputs, state.settings.youDeviceId, state.settings.themDeviceId);
    const themId = resolveThemDeviceId(inputs, state.settings.themDeviceId, youId);
    alog(`populate: inputs=[${fmtInputs(inputs)}] savedYou=${beforeYou || ''} savedThem=${beforeThem || ''} -> you=${youId || ''} them=${themId || ''}`);
    const fill = (selectId, resolvedId) => {
      const sel = document.getElementById(selectId);
      if (!sel) return;
      sel.innerHTML = '<option value="">— not set —</option>';
      inputs.forEach(d => {
        const o = document.createElement('option');
        o.value = d.deviceId;
        o.textContent = d.label || d.deviceId;
        sel.appendChild(o);
      });
      sel.value = resolvedId || '';
    };
    fill('s-you-device', youId);
    fill('s-them-device', themId);
    // Persist the resolved picks — this also repairs placeholder or
    // colliding saved ids the first time the panel is populated.
    if (youId)  state.settings.youDeviceId  = youId;
    if (themId) state.settings.themDeviceId = themId;
    // v3.5.6: persist a repair to disk too, so the saved config matches
    // what capture will use (previously only capture start persisted).
    if ((youId && youId !== beforeYou) || (themId && themId !== beforeThem)) {
      try {
        const current = (await window.ghostmind.getSettings()) || {};
        await window.ghostmind.saveSettings({ ...current, ...state.settings });
        alog('populate: persisted repaired device ids to settings');
      } catch (_) {}
    }
    updatePills();
  } catch (e) {
    console.log('Could not enumerate audio devices:', e);
  }
}

// v3.5.8: pre-warm the local transcription engine at launch. The
// Whisper model loads on the sidecar's first transcribe request, which
// used to be the first speech segment after Start Listening — the
// multi-second wait before the first transcript line appeared. One
// second of silence through the normal path loads it in the
// background instead. Fire-and-forget: a failure is logged, and Start
// Listening simply loads on first use as before.
let _prewarmed = false;
async function prewarmTranscription() {
  if (_prewarmed) return;
  if ((state.settings.transcriptionMethod || 'local') !== 'local') return;
  _prewarmed = true;
  try {
    const t0 = Date.now();
    await window.ghostmind.startLocalTranscription();
    const silence = float32ToWavBase64(new Float32Array(16000), 16000);
    await window.ghostmind.transcribeLocalSegment({ wavBase64: silence, speaker: 'you', startMs: 0, partial: false });
    alog(`warmup: Whisper engine warm in ${Date.now() - t0}ms`);
  } catch (e) {
    alog(`warmup: failed (${e.message}) — engine will load on first use instead`);
  }
}

async function ensureLocalCapture() {
  if (state.localCapture) return true;
  let youDeviceId  = state.settings.youDeviceId  || document.getElementById('s-you-device')?.value || '';
  let themDeviceId = state.settings.themDeviceId || document.getElementById('s-them-device')?.value || '';
  alog(`ensure: start you=${youDeviceId} them=${themDeviceId}`);
  // v3.5.5: resolve the saved ids against the devices that exist right
  // now. This repairs the classic misconfiguration — both tracks left on
  // 'default' (the microphone) — before it can label the user's own
  // voice as [Them], and advises once when no call-audio device exists.
  try {
    try {
      const tmp = await navigator.mediaDevices.getUserMedia({ audio: true });
      tmp.getTracks().forEach(t => t.stop());
    } catch (_) {}
    const inputs = await LocalCapture.listAudioInputs();
    if (inputs.length) {
      const rYou  = resolveYouDeviceId(inputs, youDeviceId, themDeviceId);
      const rThem = resolveThemDeviceId(inputs, themDeviceId, rYou);
      alog(`ensure: inputs=[${fmtInputs(inputs)}] -> rYou=${rYou || ''} rThem=${rThem || ''}`);
      if (rYou) youDeviceId = rYou;
      if (rThem && rThem !== themDeviceId) {
        const label = inputs.find(d => d.deviceId === rThem)?.label || rThem;
        addMsg('system', `🎧 Call audio fixed: now using “${label}” for the other person's voice (it was set to your microphone, which labels your own voice as [Them]).`);
        themDeviceId = rThem;
      }
      if (!rThem && !_noCallDeviceAdvised) {
        _noCallDeviceAdvised = true;
        addMsg('system', 'ℹ No call-audio device (BlackHole/Loopback) found — only your side of calls will be transcribed. Install BlackHole (free) and route the call through it; GhostMind will then pick it up automatically.');
      }
      // Remember the repaired ids so the fix sticks.
      if (youDeviceId !== state.settings.youDeviceId || themDeviceId !== state.settings.themDeviceId) {
        state.settings.youDeviceId = youDeviceId;
        state.settings.themDeviceId = themDeviceId;
        try {
          const current = (await window.ghostmind.getSettings()) || {};
          await window.ghostmind.saveSettings({ ...current, ...state.settings });
        } catch (_) {}
      }
    }
  } catch (_) {}
  if (!youDeviceId && !themDeviceId) {
    addMsg('system', '⚠ No audio devices selected — pick your mic and your BlackHole/Loopback device in Settings first.');
    return false;
  }
  try {
    await window.ghostmind.startLocalTranscription();
    const capture = new LocalCapture({
      sendSegment: (seg) => window.ghostmind.transcribeLocalSegment(seg),
      onTrackError: (speaker, e) => {
        alog(`track ${speaker} failed to start: ${e.name}: ${e.message}`);
        addMsg('system', `⚠ The ${speaker === 'you' ? 'microphone' : 'call-audio'} track failed to start (${e.name}). ${speaker === 'you' ? 'Your side will not be transcribed.' : 'Only your side will be transcribed.'}`);
      },
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
    alog(`ensure: capture.start failed: ${e.name}: ${e.message}`);
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
  syncHomeListen(false);
  setStatus('ready');
  addMsg('system', '⏹ Local transcription stopped');
  generatePostCall();
  pushAutoDraft();
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
  // Friendly chat bubbles (v3.0): "[You] …" → You, "[Them] …" → Caller.
  // The raw line is still what gets stored/copied — only the display changes.
  const you  = line.startsWith('[You]');
  const them = line.startsWith('[Them]');
  if (you || them) {
    p.className = 't-line new ' + (you ? 'you' : 'them');
    const name = document.createElement('span');
    name.className = 't-name';
    name.textContent = you ? 'You' : 'Caller';
    p.appendChild(name);
    p.appendChild(document.createTextNode(line.replace(/^\[(You|Them)\]\s*/, '')));
  } else {
    p.className  = 't-line new';
    p.textContent = line;
  }
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
      model: 'claude-haiku-5-5',
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
      model: 'claude-haiku-5-5',
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

// ─── AUTO-SAVE (v3.5.3) ───────────────────────────────────────────────────────
// The live conversation exists only in memory until the user presses Save
// Session — quitting used to lose it entirely. Now the renderer keeps a
// locally-composed draft summary (no API call) and pushes it to main after
// each exchange and at the end of a call; main writes it to the session
// store synchronously on will-quit. A manual Save Session clears the draft
// so the same conversation is never stored twice.
function pushAutoDraft() {
  try {
    const msgs = state.messages.filter(m => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string');
    if (msgs.length < 2 && state.transcript.length === 0) return;
    const first = msgs.find(m => m.role === 'user');
    const last = msgs[msgs.length - 1];
    let s = `Auto-saved chat (${msgs.length} messages).`;
    if (first) s += ` Opened with: "${first.content.slice(0, 120)}"`;
    if (last && last !== first) s += ` Latest: "${last.content.slice(0, 120)}"`;
    if (state.transcript.length > 0) s += ` Call transcript: ${state.transcript.length} lines.`;
    window.ghostmind.updateSessionDraft(s);
  } catch (_) {}
}

// ─── SESSION MEMORY ───────────────────────────────────────────────────────────
document.getElementById('save-session-btn').addEventListener('click', async () => {
  if (state.messages.length < 2) { addMsg('system', 'No conversation to save yet'); return; }
  // Ask AI to summarize the session
  try {
    const data = await window.ghostmind.sendAIRequest({
      messages: state.messages.slice(-10),
      model: 'claude-haiku-5-5',
      systemPrompt: 'Summarize this conversation in 2-3 sentences. Focus on what was discussed and any conclusions. Be concise.',
      maxTokens: 150
    });
    const summary = data.content?.[0]?.text || 'Session recorded';
    await window.ghostmind.saveSession({ summary });
    window.ghostmind.clearSessionDraft();
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
  const q = (document.getElementById('memory-search')?.value || '').trim().toLowerCase();
  const filtered = (sessions || []).filter(s => !q || String(s.summary).toLowerCase().includes(q));
  if (!sessions || sessions.length === 0) {
    list.innerHTML = '<div class="empty-state">NO SESSIONS SAVED<br>CONVERSATIONS APPEAR HERE</div>';
    return;
  }
  if (filtered.length === 0) {
    list.innerHTML = '<div class="empty-state">NO SESSIONS MATCH YOUR SEARCH</div>';
    return;
  }
  list.innerHTML = filtered.slice().reverse().map(s => `
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
