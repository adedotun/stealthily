'use strict';
// node --test tests-local/context-profiles.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createStore, buildContextBlock, estimateTokens, JD_CAP, RESUME_CAP } = require('../src/main/context-profiles');

function tmpStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-ctx-'));
  return { store: createStore(path.join(dir, 'profiles.json')), file: path.join(dir, 'profiles.json') };
}

const JD = 'Senior QA Engineer at Acme\nWe need Playwright and Kubernetes experience.';
const RESUME = 'Adedotun Ogunwuyi\nQA Engineer at a ride-hailing platform. Playwright, Appium, Python.';

test('no profile -> empty context block (today\'s behaviour, byte-for-byte)', () => {
  assert.equal(buildContextBlock(null), '');
  assert.equal(buildContextBlock({ jdText: '   ' }), '');
  const { store } = tmpStore();
  assert.equal(store.activeContextBlock(), '');
});

test('active profile block carries role line, JD, resume and the never-invent rule', () => {
  const { store } = tmpStore();
  const { profile } = store.saveProfile({ name: 'Acme - QA', company: 'Acme', role: 'Senior QA Engineer', jdText: JD, resumeText: RESUME });
  store.setActive(profile.id);
  const block = store.activeContextBlock();
  assert.match(block, /Role: Senior QA Engineer at Acme/);
  assert.match(block, /Kubernetes/);
  assert.match(block, /ride-hailing/);
  assert.match(block, /NEVER invent/);
  assert.match(block, /not in the resume/);
});

test('JD-only profile: no-resume rules forbid all experience claims', () => {
  const block = buildContextBlock({ jdText: JD, resumeText: null });
  assert.match(block, /make NO claims/);
  assert.ok(!block.includes('RESUME:'));
});

test('caps trim and report, never silently', () => {
  const { store } = tmpStore();
  const res = store.saveProfile({ name: 'Big', jdText: 'x'.repeat(JD_CAP + 500), resumeText: 'y'.repeat(RESUME_CAP + 5) });
  assert.equal(res.trimmed.jd, true);
  assert.equal(res.trimmed.resume, true);
  assert.equal(res.profile.jdText.length, JD_CAP);
  assert.equal(res.profile.resumeText.length, RESUME_CAP);
});

test('profiles persist across store instances; delete of active deactivates', () => {
  const { store, file } = tmpStore();
  const { profile } = store.saveProfile({ name: 'Persisted', jdText: JD, resumeText: RESUME });
  store.setActive(profile.id);
  const again = createStore(file);
  assert.equal(again.list().profiles.length, 1);
  assert.equal(again.list().activeId, profile.id);
  assert.match(again.activeContextBlock(), /JOB CONTEXT/);
  again.remove(profile.id);
  assert.equal(again.list().activeId, null);
  assert.equal(again.activeContextBlock(), '');
});

test('corrupt store file loads empty instead of throwing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-ctx-'));
  const file = path.join(dir, 'profiles.json');
  fs.writeFileSync(file, '{not json');
  const store = createStore(file);
  assert.deepEqual(store.list(), { profiles: [], activeId: null });
});

test('token estimate is chars/4 rounded up', () => {
  assert.equal(estimateTokens(''), 0);
  assert.equal(estimateTokens('abcd'), 1);
  assert.equal(estimateTokens('abcde'), 2);
});

test('name defaults to the JD first line when left blank', () => {
  const { store } = tmpStore();
  const { profile } = store.saveProfile({ name: '', jdText: JD, resumeText: '' });
  assert.equal(profile.name, 'Senior QA Engineer at Acme');
});
