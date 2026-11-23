'use strict';
// ─── v3.12 MULTI-PROVIDER AI LAYER ──────────────────────────────────────────
// Hush!'s renderer speaks one canonical dialect (Anthropic-style
// messages: { role, content: string | [{type:'text'|'image', ...}] } and
// expects Anthropic-shaped replies: { content: [{ type:'text', text }] }).
// This module translates that dialect to and from OpenAI's Chat Completions
// API (also used by every OpenAI-compatible endpoint: OpenRouter, Groq,
// Together, Ollama, LM Studio…) and Google's Gemini API, so the rest of
// the app never needs to know which provider is active.
//
// The Anthropic path itself is NOT routed through here — it stays in
// index.js, untouched, with its prompt-caching / thinking handling.

const PROVIDERS = {
  anthropic: { name: 'Claude (Anthropic)', def: 'claude-sonnet-5-5', small: 'claude-haiku-5-5', family: (id) => /^claude-/.test(id || '') },
  openai:    { name: 'OpenAI (GPT)',       def: 'gpt-5.1',          small: 'gpt-5-mini',      family: (id) => /^(gpt-|o[0-9]|chatgpt)/.test(id || '') },
  gemini:    { name: 'Google (Gemini)',    def: 'gemini-2.5-pro',   small: 'gemini-2.5-flash', family: (id) => /^gemini/.test(id || '') },
  custom:    { name: 'Custom endpoint',    def: '',                 small: '',                 family: () => true },
};

const OPENAI_BASE = 'https://api.openai.com/v1';
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';

function activeProvider(settings) {
  const p = settings && settings.provider;
  return Object.prototype.hasOwnProperty.call(PROVIDERS, p) ? p : 'anthropic';
}

function providerKey(settings, p) {
  const keys = (settings && settings.keys) || {};
  if (keys[p]) return keys[p];
  if (p === 'anthropic') return (settings && settings.apiKey) || '';
  return '';
}

function baseUrl(settings) {
  const b = ((settings && settings.baseUrl) || '').trim().replace(/\/+$/, '');
  return b || OPENAI_BASE;
}

// The model a request should actually use: the requested one when it
// belongs to the active provider's family, else the user's saved pick
// for that provider, else the provider default. This makes stale Claude
// model ids in old call sites harmless after a provider switch.
function resolveModel(settings, requested) {
  const p = activeProvider(settings);
  const meta = PROVIDERS[p];
  if (requested && meta.family(requested)) return requested;
  const saved = settings && settings.models && settings.models[p];
  if (saved && meta.family(saved)) return saved;
  if (p === 'anthropic' && settings && settings.model && meta.family(settings.model)) return settings.model;
  return meta.def || requested || '';
}

function requireKey(settings, p) {
  const key = providerKey(settings, p);
  if (!key && p !== 'custom') {
    throw new Error(`${PROVIDERS[p].name} API key is not configured in Settings.`);
  }
  if (p === 'custom' && !(settings && settings.baseUrl)) {
    throw new Error('Custom endpoint: set the Base URL in Settings first (e.g. https://openrouter.ai/api/v1).');
  }
  return key;
}

async function httpError(r) {
  const t = await r.text().catch(() => '');
  let msg = '';
  try {
    const j = JSON.parse(t);
    msg = (j.error && (j.error.message || j.error.status)) || '';
  } catch (_) {}
  const e = new Error(msg ? `${msg} (HTTP ${r.status})` : `HTTP ${r.status}: ${t.slice(0, 200)}`);
  e.status = r.status;
  return e;
}

function blocksOf(content) {
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  if (Array.isArray(content)) return content;
  if (content == null) return [];
  return [{ type: 'text', text: String(content) }];
}

// ── Translators ──────────────────────────────────────────────────────────────
function toOpenAIMessages(messages, system) {
  const out = [];
  if (system) out.push({ role: 'system', content: system });
  for (const m of messages || []) {
    const parts = [];
    for (const b of blocksOf(m.content)) {
      if (b.type === 'text' && b.text) parts.push({ type: 'text', text: b.text });
      else if (b.type === 'image' && b.source && b.source.data) {
        parts.push({ type: 'image_url', image_url: { url: `data:${b.source.media_type || 'image/png'};base64,${b.source.data}` } });
      }
    }
    if (!parts.length) continue;
    out.push({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: parts.length === 1 && parts[0].type === 'text' ? parts[0].text : parts,
    });
  }
  return out;
}

function toGeminiBody(messages, system, maxTokens) {
  const contents = [];
  for (const m of messages || []) {
    const parts = [];
    for (const b of blocksOf(m.content)) {
      if (b.type === 'text' && b.text) parts.push({ text: b.text });
      else if (b.type === 'image' && b.source && b.source.data) {
        parts.push({ inline_data: { mime_type: b.source.media_type || 'image/png', data: b.source.data } });
      }
    }
    if (!parts.length) continue;
    const role = m.role === 'assistant' ? 'model' : 'user';
    const last = contents[contents.length - 1];
    if (last && last.role === role) last.parts.push(...parts); // Gemini wants alternating roles
    else contents.push({ role, parts });
  }
  const body = { contents };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  if (maxTokens) body.generationConfig = { maxOutputTokens: maxTokens };
  return body;
}

function geminiText(j) {
  const parts = j && j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts;
  if (!Array.isArray(parts)) return '';
  return parts.map((p) => (p && p.text) || '').join('');
}

async function readSSE(r, onJson) {
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line.startsWith('data:')) continue;
      const s = line.slice(5).trim();
      if (!s || s === '[DONE]') continue;
      try { onJson(JSON.parse(s)); } catch (_) {}
    }
  }
}

// ── Chat: non-streaming ──────────────────────────────────────────────────────
async function chatComplete(settings, { messages, model, systemPrompt, maxTokens }) {
  const p = activeProvider(settings);
  const key = requireKey(settings, p);
  const m = resolveModel(settings, model);
  const system = systemPrompt || settings.systemPrompt || '';
  const max = maxTokens || 2048;

  if (p === 'openai' || p === 'custom') {
    const r = await fetch(`${baseUrl(settings)}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
      body: JSON.stringify({ model: m, max_tokens: max, messages: toOpenAIMessages(messages, system) }),
    });
    if (!r.ok) throw await httpError(r);
    const j = await r.json();
    const text = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
    const out = { content: [{ type: 'text', text }] };
    if (j.usage) out.usage = { input_tokens: j.usage.prompt_tokens || 0, output_tokens: j.usage.completion_tokens || 0 };
    return out;
  }

  if (p === 'gemini') {
    const r = await fetch(`${GEMINI_BASE}/models/${encodeURIComponent(m)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(toGeminiBody(messages, system, max)),
    });
    if (!r.ok) throw await httpError(r);
    const j = await r.json();
    const out = { content: [{ type: 'text', text: geminiText(j) }] };
    if (j.usageMetadata) out.usage = { input_tokens: j.usageMetadata.promptTokenCount || 0, output_tokens: j.usageMetadata.candidatesTokenCount || 0 };
    return out;
  }

  throw new Error('chatComplete called for the Anthropic provider — that path lives in index.js.');
}

// ── Chat: streaming (onDelta receives answer text chunks) ────────────────────
async function chatStream(settings, { messages, model, systemPrompt, maxTokens }, onDelta) {
  const p = activeProvider(settings);
  const key = requireKey(settings, p);
  const m = resolveModel(settings, model);
  const system = systemPrompt || settings.systemPrompt || '';
  const max = maxTokens || 2048;
  let full = '';

  if (p === 'openai' || p === 'custom') {
    const r = await fetch(`${baseUrl(settings)}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
      body: JSON.stringify({ model: m, max_tokens: max, stream: true, messages: toOpenAIMessages(messages, system) }),
    });
    if (!r.ok) throw await httpError(r);
    await readSSE(r, (ev) => {
      const d = ev.choices && ev.choices[0] && ev.choices[0].delta && ev.choices[0].delta.content;
      if (d) { full += d; onDelta(d); }
    });
    return full;
  }

  if (p === 'gemini') {
    const r = await fetch(`${GEMINI_BASE}/models/${encodeURIComponent(m)}:streamGenerateContent?alt=sse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(toGeminiBody(messages, system, max)),
    });
    if (!r.ok) throw await httpError(r);
    await readSSE(r, (ev) => {
      const t = geminiText(ev);
      if (t) { full += t; onDelta(t); }
    });
    return full;
  }

  throw new Error('chatStream called for the Anthropic provider — that path lives in index.js.');
}

// ── Truthful connection check (a real 1-token request) ───────────────────────
async function check(settings) {
  const p = activeProvider(settings);
  const key = providerKey(settings, p);
  if (!key && p !== 'custom') return { ok: false, error: 'No API key saved' };
  if (p === 'custom' && !(settings && settings.baseUrl)) return { ok: false, error: 'No endpoint URL saved' };
  const model = resolveModel(settings, null);
  const started = Date.now();
  try {
    if (p === 'openai' || p === 'custom') {
      const r = await fetch(`${baseUrl(settings)}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
        body: JSON.stringify({ model, max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] }),
      });
      if (r.ok) return { ok: true, model, ms: Date.now() - started };
      const e = await httpError(r);
      return { ok: false, model, error: e.message };
    }
    if (p === 'gemini') {
      const r = await fetch(`${GEMINI_BASE}/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'ping' }] }], generationConfig: { maxOutputTokens: 1 } }),
      });
      if (r.ok) return { ok: true, model, ms: Date.now() - started };
      const e = await httpError(r);
      return { ok: false, model, error: e.message };
    }
  } catch (e) {
    return { ok: false, model, error: e.message };
  }
  return { ok: false, model, error: 'Unknown provider' };
}

// ── Live model list for the active provider (null on any failure) ────────────
async function listModels(settings) {
  const p = activeProvider(settings);
  const key = providerKey(settings, p);
  try {
    if (p === 'openai' || p === 'custom') {
      if (!key && p === 'openai') return null;
      const r = await fetch(`${baseUrl(settings)}/models`, {
        headers: { ...(key ? { Authorization: `Bearer ${key}` } : {}) },
      });
      if (!r.ok) return null;
      const j = await r.json();
      const ids = (j.data || []).map((x) => x && x.id).filter(Boolean);
      const chat = ids.filter((id) => !/embedding|whisper|tts|dall|image|audio|realtime|moderation|transcribe|sora/i.test(id));
      const list = (p === 'openai' ? chat.filter((id) => PROVIDERS.openai.family(id)) : chat);
      return list.length ? list.slice(0, 40).map((id) => ({ id, name: id })) : null;
    }
    if (p === 'gemini') {
      if (!key) return null;
      const r = await fetch(`${GEMINI_BASE}/models?pageSize=100`, { headers: { 'x-goog-api-key': key } });
      if (!r.ok) return null;
      const j = await r.json();
      const list = (j.models || [])
        .filter((x) => x && Array.isArray(x.supportedGenerationMethods) && x.supportedGenerationMethods.includes('generateContent'))
        .map((x) => ({ id: String(x.name || '').replace(/^models\//, ''), name: x.displayName || String(x.name || '').replace(/^models\//, '') }))
        .filter((x) => x.id.startsWith('gemini'));
      return list.length ? list.slice(0, 40) : null;
    }
  } catch (_) {
    return null;
  }
  return null;
}

module.exports = { PROVIDERS, activeProvider, providerKey, resolveModel, chatComplete, chatStream, check, listModels, toOpenAIMessages, toGeminiBody };
