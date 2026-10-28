'use strict';
// GhostMind session-memory store (v3.2).
//
// Sessions (conversation summaries) used to live in a flat sessions.json
// that was rewritten wholesale and capped by slicing. They now live in a
// real SQLite database (ghostmind.db) via Node's built-in node:sqlite —
// no new dependencies — keeping the most recent 200 sessions, with the
// existing JSON file migrated in on first run. If node:sqlite is not
// available (older runtime), the store transparently falls back to the
// JSON file with the same API and the same most-recent-10 behaviour the
// app has always exposed to the renderer.
//
// API (all synchronous, matching the old loadSessions/saveSession):
//   const store = createMemoryStore({ dbPath, jsonPath });
//   store.load()   -> [{ date, summary }, ...] most recent last, max 10
//   store.add(summary) -> appends { date: now, summary }
//   store.backend  -> 'sqlite' | 'json'

const fs = require('fs');
const path = require('path');

const KEEP_IN_DB = 200;   // retained in the database
const RETURN_MAX = 10;    // what the renderer has always received

function createMemoryStore({ dbPath, jsonPath }) {
  let db = null;
  try {
    const { DatabaseSync } = require('node:sqlite');
    db = new DatabaseSync(dbPath);
    db.exec('CREATE TABLE IF NOT EXISTS sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL, summary TEXT NOT NULL)');
  } catch (_) {
    db = null;
  }

  function readJsonSessions() {
    try {
      if (jsonPath && fs.existsSync(jsonPath)) {
        const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
        if (Array.isArray(data)) return data.filter(s => s && s.summary);
      }
    } catch (_) {}
    return [];
  }

  function writeJsonSessions(all) {
    try {
      fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
      fs.writeFileSync(jsonPath, JSON.stringify(all.slice(-KEEP_IN_DB), null, 2));
    } catch (_) {}
  }

  if (db) {
    // One-time migration: if the table is empty and a legacy JSON file
    // has sessions, import them in order.
    try {
      const row = db.prepare('SELECT COUNT(*) AS n FROM sessions').get();
      if (row.n === 0) {
        const legacy = readJsonSessions();
        const ins = db.prepare('INSERT INTO sessions (date, summary) VALUES (?, ?)');
        for (const s of legacy) ins.run(String(s.date || new Date().toISOString()), String(s.summary));
      }
    } catch (_) {}
  }

  return {
    backend: db ? 'sqlite' : 'json',

    load() {
      if (db) {
        try {
          const rows = db.prepare('SELECT date, summary FROM sessions ORDER BY id DESC LIMIT ?').all(RETURN_MAX);
          return rows.reverse();
        } catch (_) {}
      }
      return readJsonSessions().slice(-RETURN_MAX);
    },

    add(summary) {
      const entry = { date: new Date().toISOString(), summary: String(summary) };
      if (db) {
        try {
          db.prepare('INSERT INTO sessions (date, summary) VALUES (?, ?)').run(entry.date, entry.summary);
          db.prepare('DELETE FROM sessions WHERE id NOT IN (SELECT id FROM sessions ORDER BY id DESC LIMIT ?)').run(KEEP_IN_DB);
          return entry;
        } catch (_) {}
      }
      const all = readJsonSessions();
      all.push(entry);
      writeJsonSessions(all);
      return entry;
    },
  };
}

module.exports = { createMemoryStore };
