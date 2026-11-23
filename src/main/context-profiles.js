'use strict';
// --- v3.14 JOB CONTEXT PROFILES ---------------------------------------
// Before a call, the user loads a Context Profile: the job description
// for the role (plus optionally their resume). While a profile is
// active, its context block is appended to the system prompt of every
// AI request, so live answers are grounded in that specific role and in
// the user's real experience -- with a hard never-invent rule (spec:
// GhostMind_Job_Context_Loader_Spec.md, Nov 21, 2026).
//
// Storage: one JSON file in userData (context-profiles.json). Nothing
// leaves the device except as part of the AI prompt at answer time --
// the same exposure the transcript already has. No new network calls.

const fs = require('fs');
const crypto = require('crypto');

const JD_CAP = 30000;      // characters
const RESUME_CAP = 20000;  // characters

function estimateTokens(text) {
  return Math.ceil(String(text || '').length / 4);
}

function profileTokens(profile) {
  if (!profile) return 0;
  return estimateTokens(profile.jdText) + estimateTokens(profile.resumeText);
}

// The behaviour rules are the heart of the feature (spec section 5).
// They ride inside the context block itself, so they apply on every
// provider and every answer path.
const RULES_WITH_RESUME = [
  'Rules for using this context:',
  '- When a question touches the user\'s experience, answer from what the RESUME below actually shows -- specific projects, tools and outcomes -- in first person, ready to say out loud.',
  '- NEVER invent: do not attribute experience, employers, metrics or tools to the user that are not in the resume. If the job asks for something the resume does not evidence, answer the question conceptually and well -- but never claim the user has done it.',
  '- Where the job description names a responsibility or tool the resume covers, surface that match in the answer.',
  '- Keep answers short and speakable: natural first-person sentences. No bullet dumps unless the question asks for a list.',
].join('\n');

const RULES_NO_RESUME = [
  'Rules for using this context:',
  '- No resume was provided: make NO claims about the user\'s past experience, employers or tools. Answer conceptually and well, framed for the role below.',
  '- Where the job description names a responsibility or tool, speak to it directly and specifically.',
  '- Keep answers short and speakable: natural first-person sentences. No bullet dumps unless the question asks for a list.',
].join('\n');

function buildContextBlock(profile) {
  if (!profile || !String(profile.jdText || '').trim()) return '';
  const hasResume = !!(profile.resumeText && String(profile.resumeText).trim());
  const lines = [];
  lines.push('--- JOB CONTEXT (loaded by the user for this call) ---');
  const roleLine = [profile.role, profile.company].filter(Boolean).join(' at ');
  if (roleLine) lines.push('Role: ' + roleLine);
  lines.push('');
  lines.push(hasResume ? RULES_WITH_RESUME : RULES_NO_RESUME);
  lines.push('');
  lines.push('JOB DESCRIPTION:');
  lines.push(String(profile.jdText).trim());
  if (hasResume) {
    lines.push('');
    lines.push('RESUME:');
    lines.push(String(profile.resumeText).trim());
  }
  lines.push('--- END JOB CONTEXT ---');
  return lines.join('\n');
}

function createStore(filePath) {
  let data = { profiles: [], activeId: null };
  try {
    if (fs.existsSync(filePath)) {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (parsed && Array.isArray(parsed.profiles)) {
        data = { profiles: parsed.profiles, activeId: parsed.activeId || null };
      }
    }
  } catch (_) {
    data = { profiles: [], activeId: null };
  }
  if (data.activeId && !data.profiles.some((p) => p.id === data.activeId)) data.activeId = null;

  function persist() {
    const tmp = filePath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, filePath);
  }

  function list() {
    return { profiles: data.profiles, activeId: data.activeId };
  }

  function saveProfile(input) {
    const now = new Date().toISOString();
    const jdRaw = String((input && input.jdText) || '');
    const resumeRaw = String((input && input.resumeText) || '');
    const trimmed = { jd: jdRaw.length > JD_CAP, resume: resumeRaw.length > RESUME_CAP };
    const existing = (input && input.id) ? data.profiles.find((p) => p.id === input.id) : null;
    const profile = {
      id: (existing && existing.id) || (input && input.id) || crypto.randomUUID(),
      name: String((input && input.name) || '').trim(),
      company: (input && input.company) ? String(input.company).trim() : null,
      role: (input && input.role) ? String(input.role).trim() : null,
      jdText: jdRaw.slice(0, JD_CAP),
      resumeText: resumeRaw ? resumeRaw.slice(0, RESUME_CAP) : null,
      createdAt: (existing && existing.createdAt) || now,
      updatedAt: now,
      lastUsedAt: (existing && existing.lastUsedAt) || null,
    };
    if (!profile.name) {
      const firstLine = profile.jdText.split('\n').map((s) => s.trim()).find(Boolean);
      profile.name = firstLine ? firstLine.slice(0, 60) : 'Untitled profile';
    }
    const idx = data.profiles.findIndex((p) => p.id === profile.id);
    if (idx >= 0) data.profiles[idx] = profile; else data.profiles.push(profile);
    persist();
    return { ok: true, profile, trimmed };
  }

  function remove(id) {
    data.profiles = data.profiles.filter((p) => p.id !== id);
    if (data.activeId === id) data.activeId = null;
    persist();
    return { ok: true, activeId: data.activeId };
  }

  function setActive(id) {
    if (id && !data.profiles.some((p) => p.id === id)) return { ok: false, error: 'Profile not found' };
    data.activeId = id || null;
    if (id) {
      const p = data.profiles.find((x) => x.id === id);
      if (p) p.lastUsedAt = new Date().toISOString();
    }
    persist();
    return { ok: true, activeId: data.activeId };
  }

  function activeProfile() {
    if (!data.activeId) return null;
    return data.profiles.find((p) => p.id === data.activeId) || null;
  }

  function activeContextBlock() {
    return buildContextBlock(activeProfile());
  }

  return { list, saveProfile, remove, setActive, activeProfile, activeContextBlock };
}

module.exports = { createStore, buildContextBlock, estimateTokens, profileTokens, JD_CAP, RESUME_CAP };
