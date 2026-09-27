'use strict';
/* ---------- lagring og endringer ----------
   Data ligger i IndexedDB, med localStorage som reserve. Navnene starter med
   «takt», fordi andre apper på samme nettadresse (som Døgn) deler lageret.
   Alle endringer i data går gjennom commit(): den lagrer, merker for
   backup og deling, tegner på nytt og gjør endringen mulig å angre. */
let state = null;

const store = {
  db: null, ok: true,
  async init() {
    try {
      this.db = await new Promise((res, rej) => {
        const r = indexedDB.open('takt', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('kv');
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
    } catch (e) { this.db = null; }
  },
  async get(key) {
    if (this.db) {
      try {
        const v = await new Promise((res, rej) => { const q = this.db.transaction('kv').objectStore('kv').get(key); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
        if (v) return JSON.parse(v);
      } catch (e) {}
    }
    try { const v = localStorage.getItem('takt-' + key); return v ? JSON.parse(v) : null; } catch (e) { return null; }
  },
  async set(key, obj) {
    const json = JSON.stringify(obj);
    let okAny = false;
    if (this.db) {
      try {
        await new Promise((res, rej) => {
          const t = this.db.transaction('kv', 'readwrite');
          t.objectStore('kv').put(json, key);
          t.oncomplete = res; t.onerror = () => rej(t.error);
        });
        okAny = true;
      } catch (e) {}
    }
    try { localStorage.setItem('takt-' + key, json); okAny = true; } catch (e) {}
    return okAny;
  },
};

let saveTimer = null;
async function save() { const ok = await store.set('state', state); if (ok !== store.ok) { store.ok = ok; render(); } }
function persist(shared) { clearTimeout(saveTimer); saveTimer = setTimeout(save, 250); markDirty(shared); driveDirty(); if (shared) calDirty(); }
function flush() { clearTimeout(saveTimer); if (state) save(); }

/* ---------- angre ----------
   Hvert angresteg husker bare de delene av dataene som ble endret. */
const UNDO_MAX = 15;
const undoStack = [];
const SHARED_PARTS = ['rota', 'items', 'travel', 'days'];   // deler som påvirker det Døgn får
function snapParts(s) { const m = new Map(); for (const k of Object.keys(s)) m.set(k, JSON.stringify(s[k])); return m; }
function diffParts(before, after) {
  const out = [];
  for (const [k, v] of before) if (after.get(k) !== v) out.push([k, v]);
  return out;
}

/* Den ene veien for endringer i data.
   label: tekst i meldingen. En streng (også tom) gjør endringen mulig å angre;
          fn kan returnere en bedre tekst. null betyr en stille endring uten angre. */
function commit(label, fn) {
  const before = snapParts(state);
  const r = fn();
  if (typeof r === 'string' && r) label = r;
  const parts = diffParts(before, snapParts(state));
  if (!parts.length) { if (label) toast(label); return; }
  if (label !== null) {
    undoStack.push({ parts, label });
    if (undoStack.length > UNDO_MAX) undoStack.shift();
  }
  persist(parts.some(([k]) => SHARED_PARTS.includes(k)));
  render();
  if (label) toast(label, label !== null);
}
function undoLast() {
  const u = undoStack.pop();
  if (!u) { toast(T.common.nothingToUndo); return; }
  for (const [k, v] of u.parts) state[k] = JSON.parse(v);
  persist(u.parts.some(([k]) => SHARED_PARTS.includes(k)));
  applyTheme();
  render();
  if (sheetOpen() && reopen) reopen();
  toast(T.common.undone(u.label));
}
