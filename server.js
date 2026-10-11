// NoteVault — local, auto-saving, searchable scratchpad.
// Run:  node server.js --open        (start if needed + open a fresh note window)
//       node server.js --background  (just start the server, e.g. at login)
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const { importNotepadTabs } = require('./notepad-import');
const { buildDemoNotes } = require('./demo-notes');

const PORT = Number(process.env.NOTEVAULT_PORT || 47823);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const DATA_DIR = process.env.NOTEVAULT_DATA || path.join(process.env.LOCALAPPDATA || os.homedir(), 'NoteVault');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const IMAGES_DIR = path.join(DATA_DIR, 'images');
const IMAGE_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/bmp': 'bmp' };
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const INDEX_HTML = path.join(__dirname, 'public', 'index.html');
const WALLPAPER = path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Themes', 'TranscodedWallpaper');
const args = new Set(process.argv.slice(2));

const SNAPSHOT_GAP_MS = 10 * 60 * 1000; // keep a version at most every 10 min of editing
const BACKUPS_TO_KEEP = 14;

// ---------- database ----------
fs.mkdirSync(BACKUP_DIR, { recursive: true });
fs.mkdirSync(IMAGES_DIR, { recursive: true });
const db = new DatabaseSync(path.join(DATA_DIR, 'notes.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY,
    client_key TEXT UNIQUE,
    title TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER,
    pinned INTEGER NOT NULL DEFAULT 0,
    source TEXT
  );
  CREATE INDEX IF NOT EXISTS notes_updated ON notes(updated_at);
  CREATE TABLE IF NOT EXISTS note_days (
    note_id INTEGER NOT NULL REFERENCES notes(id),
    day TEXT NOT NULL,
    edits INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (note_id, day)
  );
  CREATE INDEX IF NOT EXISTS note_days_day ON note_days(day);
  CREATE TABLE IF NOT EXISTS versions (
    id INTEGER PRIMARY KEY,
    note_id INTEGER NOT NULL REFERENCES notes(id),
    body TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS versions_note ON versions(note_id, created_at);
  CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
    title, body, content='notes', content_rowid='id', tokenize='trigram'
  );
  CREATE TRIGGER IF NOT EXISTS notes_ai AFTER INSERT ON notes BEGIN
    INSERT INTO notes_fts(rowid, title, body) VALUES (new.id, new.title, new.body);
  END;
  CREATE TRIGGER IF NOT EXISTS notes_ad AFTER DELETE ON notes BEGIN
    INSERT INTO notes_fts(notes_fts, rowid, title, body) VALUES ('delete', old.id, old.title, old.body);
  END;
  CREATE TRIGGER IF NOT EXISTS notes_au AFTER UPDATE OF title, body ON notes BEGIN
    INSERT INTO notes_fts(notes_fts, rowid, title, body) VALUES ('delete', old.id, old.title, old.body);
    INSERT INTO notes_fts(rowid, title, body) VALUES (new.id, new.title, new.body);
  END;
`);

// Rich-text notes keep their formatted HTML next to the plain text (which is what gets searched).
for (const t of ['notes', 'versions']) {
  if (!db.prepare(`PRAGMA table_info(${t})`).all().some((c) => c.name === 'html')) db.exec(`ALTER TABLE ${t} ADD COLUMN html TEXT`);
}

const q = {
  byId: db.prepare('SELECT * FROM notes WHERE id = ?'),
  byKey: db.prepare('SELECT * FROM notes WHERE client_key = ?'),
  insert: db.prepare(`INSERT INTO notes (client_key, title, body, created_at, updated_at, source, html)
                      VALUES (?, ?, ?, ?, ?, ?, ?)`),
  update: db.prepare('UPDATE notes SET title = ?, body = ?, html = ?, updated_at = ? WHERE id = ?'),
  touchDay: db.prepare(`INSERT INTO note_days (note_id, day) VALUES (?, ?)
                        ON CONFLICT(note_id, day) DO UPDATE SET edits = edits + 1`),
  lastVersion: db.prepare('SELECT body, html, created_at FROM versions WHERE note_id = ? ORDER BY created_at DESC LIMIT 1'),
  addVersion: db.prepare('INSERT INTO versions (note_id, body, html, created_at) VALUES (?, ?, ?, ?)'),
  versions: db.prepare(`SELECT id, created_at, length(body) AS chars, substr(body, 1, 200) AS preview
                        FROM versions WHERE note_id = ? ORDER BY created_at DESC`),
  version: db.prepare('SELECT * FROM versions WHERE id = ?'),
  setDeleted: db.prepare('UPDATE notes SET deleted_at = ? WHERE id = ?'),
  togglePin: db.prepare('UPDATE notes SET pinned = 1 - pinned WHERE id = ?'),
  heatmap: db.prepare(`SELECT d.day, COUNT(*) AS n FROM note_days d JOIN notes n ON n.id = d.note_id
                       WHERE n.deleted_at IS NULL AND (n.body <> '' OR n.html IS NOT NULL) AND d.day >= ? GROUP BY d.day`),
  hasBody: db.prepare('SELECT 1 FROM notes WHERE body = ? LIMIT 1'),
};

function localDay(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function titleOf(body, html) {
  const line = body.split(/\r?\n/).find((l) => l.trim()) || '';
  if (!line && html && html.includes('<img')) return 'Image';
  // drop Markdown formatting marks ("# Title", "- [ ] task", "**bold**") from the title
  return line.replace(/^\s*(#{1,6}\s+|>\s?|[-*+]\s+\[[ xX]\]\s*|[-*+]\s+|\d+[.)]\s+)/, '')
    .replace(/\*\*|~~|==|`/g, '').trim().slice(0, 120);
}

function noteOut(n) {
  return n && { id: n.id, key: n.client_key, title: n.title, body: n.body, html: n.html, created_at: n.created_at,
    updated_at: n.updated_at, deleted_at: n.deleted_at, pinned: !!n.pinned };
}

// Create-or-update. New notes are identified by a client-generated key so a retried
// or beaconed save can never create a duplicate.
function saveNote({ id, key, body, html = null, snapshot }) {
  if (typeof body !== 'string') throw httpError(400, 'body must be a string');
  if (html !== null && typeof html !== 'string') throw httpError(400, 'html must be a string');
  const now = Date.now();
  let note = id ? q.byId.get(id) : key ? q.byKey.get(key) : null;
  if (id && !note) throw httpError(404, 'note not found');

  if (!note) {
    if (!body.trim() && !html) return null; // never store empty scratch notes
    const r = q.insert.run(key || null, titleOf(body, html), body, now, now, 'app', html);
    q.touchDay.run(r.lastInsertRowid, localDay(now));
    return noteOut(q.byId.get(r.lastInsertRowid));
  }

  if (note.body === body && (note.html ?? null) === html) return noteOut(note);
  const old = note.body;
  if (old.trim()) {
    const last = q.lastVersion.get(note.id);
    const since = Math.max(last ? last.created_at : 0, note.created_at);
    const bigDeletion = old.length > 200 && body.length < old.length * 0.6;
    const want = snapshot || bigDeletion || now - since > SNAPSHOT_GAP_MS || now - note.updated_at > SNAPSHOT_GAP_MS;
    if (want && (!last || last.body !== old || last.html !== note.html)) q.addVersion.run(note.id, old, note.html, now);
  }
  q.update.run(titleOf(body, html), body, html, now, note.id);
  q.touchDay.run(note.id, localDay(now));
  return noteOut(q.byId.get(note.id));
}

// Split "foo bar" / "\"exact phrase\"" into terms.
function parseTerms(text) {
  const terms = [];
  for (const m of (text || '').matchAll(/"([^"]+)"|(\S+)/g)) terms.push(m[1] ?? m[2]);
  return terms.filter(Boolean);
}

function listNotes(params) {
  const terms = parseTerms(params.get('q'));
  const day = params.get('day');
  const trash = params.get('trash') === '1';
  const limit = Math.min(Number(params.get('limit')) || 300, 2000);
  const where = [trash ? 'n.deleted_at IS NOT NULL' : 'n.deleted_at IS NULL', "(n.body <> '' OR n.html IS NOT NULL)"];
  const vals = [];

  // Trigram FTS handles terms of 3+ chars (substring match, works inside code);
  // shorter terms fall back to LIKE.
  const ftsTerms = terms.filter((t) => t.length >= 3);
  if (ftsTerms.length) {
    where.push('n.id IN (SELECT rowid FROM notes_fts WHERE notes_fts MATCH ?)');
    vals.push(ftsTerms.map((t) => `"${t.replace(/"/g, '""')}"`).join(' AND '));
  }
  for (const t of terms.filter((t) => t.length < 3)) {
    where.push("n.body LIKE ? ESCAPE '\\'");
    vals.push(`%${t.replace(/[\\%_]/g, (c) => '\\' + c)}%`);
  }
  if (day) {
    where.push('n.id IN (SELECT note_id FROM note_days WHERE day = ?)');
    vals.push(day);
  }
  const rows = db.prepare(`SELECT n.id, n.title, n.body, n.created_at, n.updated_at, n.pinned, n.deleted_at,
      instr(coalesce(n.html, ''), '<img') > 0 AS has_img
    FROM notes n WHERE ${where.join(' AND ')}
    ORDER BY ${terms.length || day || trash ? '' : 'n.pinned DESC, '}n.updated_at DESC LIMIT ?`).all(...vals, limit);

  return rows.map((r) => ({
    id: r.id, title: r.title, created_at: r.created_at, updated_at: r.updated_at,
    pinned: !!r.pinned, deleted_at: r.deleted_at, chars: r.body.length,
    snippet: snippetOf(r.body, terms) || (r.has_img ? '🖼 Image' : ''),
  }));
}

function snippetOf(body, terms) {
  // The first line is already shown as the title, so the snippet comes from the rest,
  // starting just before the first match so the match is visible.
  const firstNl = body.indexOf('\n');
  const rest = firstNl >= 0 ? body.slice(firstNl + 1).replace(/^\s+/, '') : '';
  const lower = rest.toLowerCase();
  let at = -1;
  for (const t of terms) {
    const i = lower.indexOf(t.toLowerCase());
    if (i >= 0 && (at < 0 || i < at)) at = i;
  }
  if (at < 0) return rest.replace(/\s+/g, ' ').trim().slice(0, 160);
  const start = Math.max(0, at - 30);
  return (start > 0 ? '…' : '') + rest.slice(start, at + 130).replace(/\s+/g, ' ') + (at + 130 < rest.length ? '…' : '');
}

function heatmap() {
  const since = localDay(Date.now() - 372 * 86400000);
  const days = {};
  for (const r of q.heatmap.all(since)) days[r.day] = r.n;
  return { days, today: localDay(Date.now()) };
}

function runImport() {
  let imported = 0, skipped = 0;
  for (const tab of importNotepadTabs()) {
    if (!tab.text.trim() || q.hasBody.get(tab.text)) { skipped++; continue; }
    const ts = Math.round(tab.mtime);
    const r = q.insert.run(null, titleOf(tab.text), tab.text, ts, ts, 'notepad', null);
    q.touchDay.run(r.lastInsertRowid, localDay(ts));
    imported++;
  }
  return { imported, skipped };
}

function demoCount() {
  return db.prepare("SELECT COUNT(*) AS n FROM notes WHERE source = 'demo'").get().n;
}

function addDemo() {
  if (demoCount()) return { added: 0 };
  const notes = buildDemoNotes();
  db.exec('BEGIN');
  try {
    for (const n of notes) {
      const updated = n.edits.length ? n.edits[n.edits.length - 1] : n.created_at;
      const r = q.insert.run(null, titleOf(n.body), n.body, n.created_at, updated, 'demo', null);
      q.touchDay.run(r.lastInsertRowid, localDay(n.created_at));
      for (const t of n.edits) q.touchDay.run(r.lastInsertRowid, localDay(t));
      for (const v of n.versions) q.addVersion.run(r.lastInsertRowid, v.body, null, v.at);
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return { added: notes.length };
}

function removeDemo() {
  const ids = "(SELECT id FROM notes WHERE source = 'demo')";
  db.exec('BEGIN');
  db.exec(`DELETE FROM versions WHERE note_id IN ${ids}; DELETE FROM note_days WHERE note_id IN ${ids};`);
  const r = db.prepare("DELETE FROM notes WHERE source = 'demo'").run();
  db.exec('COMMIT');
  return { removed: r.changes };
}

function dailyBackup() {
  const file = path.join(BACKUP_DIR, `notes-${localDay(Date.now())}.db`);
  try {
    if (!fs.existsSync(file)) db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
    const old = fs.readdirSync(BACKUP_DIR).filter((f) => /^notes-\d{4}-\d\d-\d\d\.db$/.test(f)).sort();
    for (const f of old.slice(0, Math.max(0, old.length - BACKUPS_TO_KEEP))) fs.unlinkSync(path.join(BACKUP_DIR, f));
  } catch (e) {
    console.error('backup failed:', e.message);
  }
}

// ---------- http ----------
function httpError(status, message) { return Object.assign(new Error(message), { status }); }

// Pasted/dropped images are stored as files named by their content hash (same picture = one file).
function saveImage(req) {
  return new Promise((resolve, reject) => {
    const ext = IMAGE_TYPES[(req.headers['content-type'] || '').split(';')[0].trim()];
    if (!ext) return reject(httpError(415, 'only PNG, JPEG, GIF, WebP or BMP images'));
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_IMAGE_BYTES) { reject(httpError(413, 'image is larger than 25 MB')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (size > MAX_IMAGE_BYTES) return;
      const buf = Buffer.concat(chunks);
      if (!buf.length) return reject(httpError(400, 'empty image'));
      const name = require('node:crypto').createHash('sha256').update(buf).digest('hex').slice(0, 24) + '.' + ext;
      const file = path.join(IMAGES_DIR, name);
      if (!fs.existsSync(file)) fs.writeFileSync(file, buf);
      resolve({ url: '/img/' + name, bytes: buf.length });
    });
    req.on('error', reject);
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      try { resolve(text ? JSON.parse(text) : {}); } catch { reject(httpError(400, 'invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function send(res, status, data, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(type.startsWith('application/json') ? JSON.stringify(data) : data);
}

async function handle(req, res) {
  // Only answer this machine, and only our own page (blocks DNS rebinding / cross-site writes).
  const host = req.headers.host || '';
  if (host !== `127.0.0.1:${PORT}` && host !== `localhost:${PORT}`) return send(res, 403, { error: 'bad host' });
  if (req.method !== 'GET' && req.headers.origin && req.headers.origin !== ORIGIN &&
      req.headers.origin !== `http://localhost:${PORT}`) return send(res, 403, { error: 'bad origin' });

  const url = new URL(req.url, ORIGIN);
  const p = url.pathname;
  let m;

  if (req.method === 'GET' && (p === '/' || p === '/index.html')) {
    return send(res, 200, fs.readFileSync(INDEX_HTML), 'text/html; charset=utf-8');
  }
  if (req.method === 'GET' && p === '/editor.js') {
    return send(res, 200, fs.readFileSync(path.join(__dirname, 'public', 'editor.js')), 'text/javascript; charset=utf-8');
  }
  if (p === '/api/ping') return send(res, 200, { app: 'notevault' });
  if (req.method === 'GET' && p === '/api/notes') return send(res, 200, listNotes(url.searchParams));
  if (req.method === 'GET' && (m = p.match(/^\/api\/notes\/(\d+)$/))) {
    const n = q.byId.get(Number(m[1]));
    return n ? send(res, 200, noteOut(n)) : send(res, 404, { error: 'not found' });
  }
  if (req.method === 'POST' && p === '/api/save') return send(res, 200, { note: saveNote(await readBody(req)) });
  if (req.method === 'POST' && (m = p.match(/^\/api\/notes\/(\d+)\/(delete|restore|pin)$/))) {
    const id = Number(m[1]);
    if (m[2] === 'pin') q.togglePin.run(id);
    else q.setDeleted.run(m[2] === 'delete' ? Date.now() : null, id);
    return send(res, 200, { note: noteOut(q.byId.get(id)) });
  }
  if (req.method === 'GET' && (m = p.match(/^\/api\/notes\/(\d+)\/versions$/))) {
    return send(res, 200, q.versions.all(Number(m[1])));
  }
  if (req.method === 'GET' && (m = p.match(/^\/api\/versions\/(\d+)$/))) {
    const v = q.version.get(Number(m[1]));
    return v ? send(res, 200, v) : send(res, 404, { error: 'not found' });
  }
  if (req.method === 'GET' && p === '/api/heatmap') return send(res, 200, heatmap());
  if (req.method === 'GET' && p === '/api/demo') return send(res, 200, { count: demoCount() });
  if (req.method === 'POST' && p === '/api/demo') return send(res, 200, addDemo());
  if (req.method === 'POST' && p === '/api/demo/remove') return send(res, 200, removeDemo());
  if (req.method === 'POST' && p === '/api/images') return send(res, 200, await saveImage(req));
  if (req.method === 'GET' && (m = p.match(/^\/img\/([a-f0-9]{24})\.(png|jpg|gif|webp|bmp)$/))) {
    const file = path.join(IMAGES_DIR, `${m[1]}.${m[2]}`);
    if (!fs.existsSync(file)) return send(res, 404, { error: 'image not found' });
    const type = Object.keys(IMAGE_TYPES).find((t) => IMAGE_TYPES[t] === m[2]);
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' });
    return fs.createReadStream(file).pipe(res);
  }
  if (req.method === 'GET' && p === '/api/wallpaper') {
    // The current Windows desktop wallpaper, used to imitate Notepad's translucent (Mica) look.
    if (!fs.existsSync(WALLPAPER)) return send(res, 404, { error: 'no wallpaper' });
    res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'max-age=3600' });
    return fs.createReadStream(WALLPAPER).pipe(res);
  }
  if (req.method === 'POST' && p === '/api/import-notepad') return send(res, 200, runImport());
  if (req.method === 'POST' && p === '/api/open-data-folder') {
    spawn('explorer.exe', [DATA_DIR], { detached: true, stdio: 'ignore' }).unref();
    return send(res, 200, { ok: true });
  }
  return send(res, 404, { error: 'not found' });
}

function findEdge() {
  const candidates = [
    path.join(process.env['ProgramFiles(x86)'] || '', 'Microsoft/Edge/Application/msedge.exe'),
    path.join(process.env.ProgramFiles || '', 'Microsoft/Edge/Application/msedge.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Microsoft/Edge/Application/msedge.exe'),
  ];
  return candidates.find((c) => fs.existsSync(c));
}

function openWindow() {
  const target = `${ORIGIN}/?new=1`;
  const edge = findEdge();
  if (edge) spawn(edge, [`--app=${target}`, '--window-size=1200,800'], { detached: true, stdio: 'ignore' }).unref();
  else spawn('cmd.exe', ['/c', 'start', '', target], { detached: true, stdio: 'ignore' }).unref();
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((e) => send(res, e.status || 500, { error: e.message }));
});

server.on('error', (e) => {
  if (e.code !== 'EADDRINUSE') throw e;
  // Already running — just open a window against the existing instance.
  http.get(`${ORIGIN}/api/ping`, (r) => {
    r.resume();
    if (args.has('--open')) openWindow();
    setTimeout(() => process.exit(0), 300);
  }).on('error', () => { console.error(`Port ${PORT} is used by something else.`); process.exit(1); });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`NoteVault on ${ORIGIN}  (data: ${DATA_DIR})`);
  if (args.has('--open')) openWindow();
  dailyBackup();
  setInterval(dailyBackup, 60 * 60 * 1000).unref();
});

module.exports = { saveNote, listNotes, parseTerms };
