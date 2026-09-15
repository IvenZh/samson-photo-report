const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;

// Directories
const ROOT_DIR = __dirname;
const UPLOADS_DIR = path.join(ROOT_DIR, 'uploads');
const BACKUPS_DIR = path.join(ROOT_DIR, 'backups');
const CACHE_DIR = path.join(ROOT_DIR, 'cache');
const DATA_DIR = path.join(ROOT_DIR, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
[DATA_DIR, UPLOADS_DIR, BACKUPS_DIR, CACHE_DIR].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

// ── Auth helpers ──────────────────────────────────────────────
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const sessions = new Map(); // token -> {username, role, expiresAt}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored || typeof stored !== 'string' || stored.indexOf(':') < 0) return false;
  const [salt, hash] = stored.split(':');
  const test = crypto.scryptSync(String(password), salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return test.length === expected.length && crypto.timingSafeEqual(test, expected);
}

function loadUsers() {
  try {
    if (fs.existsSync(USERS_FILE)) return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  } catch (e) {}
  return null;
}

function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
  try { fs.copyFileSync(USERS_FILE, path.join(BACKUPS_DIR, 'users.json')); } catch (e) {}
}

function getUsers() {
  let users = loadUsers();
  if (!users || typeof users !== 'object' || !users.users) {
    // First boot: seed admin from env, otherwise generate a random password.
    const adminUser = process.env.PHOTO_ADMIN_USER || 'admin';
    let password = process.env.PHOTO_ADMIN_PASSWORD;
    let generated = false;
    if (!password) {
      password = crypto.randomBytes(9).toString('base64url');
      generated = true;
      try {
        fs.writeFileSync(path.join(DATA_DIR, 'admin-initial.txt'), `username: ${adminUser}\npassword: ${password}\n`, { mode: 0o600 });
      } catch (e) {}
    }
    users = { users: {} };
    users.users[adminUser] = {
      password: hashPassword(password),
      role: 'admin',
      createdAt: new Date().toISOString(),
      _seedGenerated: generated ? true : undefined
    };
    if (!generated) delete users.users[adminUser]._seedGenerated;
    saveUsers(users);
    console.log(`Auth: seeded admin user "${adminUser}"${generated ? ' (random password saved to data/admin-initial.txt)' : ''}`);
  }
  return users;
}

function findUser(username) {
  const u = getUsers();
  return u.users[username] || null;
}

function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie || '';
  raw.split(';').forEach(pair => {
    const idx = pair.indexOf('=');
    if (idx > 0) out[pair.slice(0, idx).trim()] = decodeURIComponent(pair.slice(idx + 1).trim());
  });
  return out;
}

function currentSession(req) {
  const token = parseCookies(req).sp_session;
  if (!token || !sessions.has(token)) return null;
  const s = sessions.get(token);
  if (s.expiresAt < Date.now()) { sessions.delete(token); return null; }
  return s;
}

function setSessionCookie(res, token) {
  const cookie = `sp_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`;
  res.setHeader('Set-Cookie', cookie);
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', 'sp_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
}

// Public paths that never need auth.
function isPublicPath(url) {
  if (url === '/login' || url === '/favicon.ico') return true;
  if (url.startsWith('/css/') || url.startsWith('/js/') || url.startsWith('/fonts/') || url.startsWith('/assets/')) return true;
  if (url === '/api/login' || url === '/api/logout') return true;
  return false;
}

// Middleware: auth runs before static serving so app pages cannot bypass login.
app.use(express.json({ limit: '100mb' }));

app.use((req, res, next) => {
  const url = req.path;
  if (isPublicPath(url)) return next();
  const s = currentSession(req);
  if (!s) {
    if (url.startsWith('/api/')) return res.status(401).json({ error: 'unauthorized' });
    if (url.startsWith('/uploads/')) return res.status(401).json({ error: 'unauthorized' });
    const nextUrl = req.originalUrl || '/';
    return res.redirect('/login?next=' + encodeURIComponent(nextUrl));
  }
  req.session = s;
  next();
});

function requireAuth(req, res, next) {
  if (!req.session) return res.status(401).json({ error: 'unauthorized' });
  next();
}
function requireAdmin(req, res, next) {
  if (!req.session) return res.status(401).json({ error: 'unauthorized' });
  if (req.session.role !== 'admin') return res.status(403).json({ error: 'forbidden' });
  next();
}

app.get('/login', (req, res) => {
  res.sendFile(path.join(ROOT_DIR, 'public', 'login.html'));
});

// ── Auth API ──────────────────────────────────────────────────
app.post('/api/login', (req, res) => {
  const username = String((req.body && req.body.username) || '').trim();
  const password = String((req.body && req.body.password) || '');
  const user = findUser(username);
  if (!user || !verifyPassword(password, user.password)) {
    return res.status(401).json({ error: 'invalid_credentials' });
  }
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, { username, role: user.role, expiresAt: Date.now() + SESSION_TTL_MS });
  setSessionCookie(res, token);
  res.json({ ok: true, username, role: user.role, admin: user.role === 'admin' });
});

app.post('/api/logout', (req, res) => {
  const token = parseCookies(req).sp_session;
  if (token) sessions.delete(token);
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.get('/api/me', requireAuth, (req, res) => {
  res.json({ username: req.session.username, role: req.session.role, admin: req.session.role === 'admin' });
});

// ── Admin: user management ────────────────────────────────────
app.get('/api/admin/users', requireAdmin, (req, res) => {
  const u = getUsers();
  const list = Object.keys(u.users).map(name => ({
    username: name,
    role: u.users[name].role,
    createdAt: u.users[name].createdAt || null
  }));
  res.json({ users: list });
});

app.post('/api/admin/users', requireAdmin, (req, res) => {
  const username = String((req.body && req.body.username) || '').trim();
  const password = String((req.body && req.body.password) || '');
  const role = ((req.body && req.body.role) || 'user') === 'admin' ? 'admin' : 'user';
  if (!/^[A-Za-z0-9._-]{2,32}$/.test(username)) return res.status(400).json({ error: 'invalid_username' });
  if (!password) return res.status(400).json({ error: 'weak_password' });
  const u = getUsers();
  if (u.users[username]) return res.status(409).json({ error: 'exists' });
  u.users[username] = { password: hashPassword(password), role, createdAt: new Date().toISOString() };
  saveUsers(u);
  res.json({ ok: true, username, role });
});

app.put('/api/admin/users/:username', requireAdmin, (req, res) => {
  const username = req.params.username;
  const u = getUsers();
  if (!u.users[username]) return res.status(404).json({ error: 'not_found' });
  if (req.body && req.body.password) {
    if (!req.body.password) return res.status(400).json({ error: 'weak_password' });
    u.users[username].password = hashPassword(req.body.password);
  }
  if (req.body && req.body.role && (req.body.role === 'admin' || req.body.role === 'user')) {
    // Don't allow removing the last active admin.
    if (u.users[username].role === 'admin' && req.body.role !== 'admin') {
      const admins = Object.keys(u.users).filter(n => u.users[n].role === 'admin');
      if (admins.length <= 1) return res.status(400).json({ error: 'last_admin' });
    }
    u.users[username].role = req.body.role;
  }
  saveUsers(u);
  res.json({ ok: true });
});

app.delete('/api/admin/users/:username', requireAdmin, (req, res) => {
  const username = req.params.username;
  if (username === req.session.username) return res.status(400).json({ error: 'cannot_delete_self' });
  const u = getUsers();
  if (!u.users[username]) return res.status(404).json({ error: 'not_found' });
  if (u.users[username].role === 'admin') {
    const admins = Object.keys(u.users).filter(n => u.users[n].role === 'admin');
    if (admins.length <= 1) return res.status(400).json({ error: 'last_admin' });
  }
  delete u.users[username];
  saveUsers(u);
  res.json({ ok: true });
});

// ── Image uploads ─────────────────────────────────────────────
const imageStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `${uuidv4()}${ext}`);
  }
});
const upload = multer({ storage: imageStorage, limits: { fileSize: 20 * 1024 * 1024 } });

app.post('/api/upload', requireAuth, upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image file' });
  res.json({ filename: req.file.filename, size: req.file.size });
});

// ── Reports ───────────────────────────────────────────────────
app.post('/api/reports', requireAuth, (req, res) => {
  const { meta, images } = req.body;
  if (!meta || !images) return res.status(400).json({ error: 'Missing meta or images' });
  const reportId = uuidv4();
  const report = { id: reportId, meta, images, createdBy: req.session.username, createdAt: new Date().toISOString() };
  fs.writeFileSync(path.join(UPLOADS_DIR, `${reportId}.json`), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(BACKUPS_DIR, `${reportId}.json`), JSON.stringify(report, null, 2));
  res.json({ id: reportId });
});

app.get('/api/reports/:id', requireAuth, (req, res) => {
  const filePath = path.join(UPLOADS_DIR, `${req.params.id}.json`);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });
  res.json(JSON.parse(fs.readFileSync(filePath, 'utf-8')));
});

app.get('/api/reports', requireAuth, (req, res) => {
  const files = fs.readdirSync(UPLOADS_DIR).filter(f => f.endsWith('.json'));
  const summaries = files.map(f => {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(UPLOADS_DIR, f), 'utf-8'));
      return { id: data.id, contractNo: data.meta.contractNo, serialNo: data.meta.serialNo, createdBy: data.createdBy || '', createdAt: data.createdAt };
    } catch (e) { return null; }
  }).filter(Boolean);
  res.json(summaries);
});

// ── Serve uploaded images ─────────────────────────────────────
app.use('/uploads', requireAuth, express.static(UPLOADS_DIR));

// ── Per-user cache helpers ────────────────────────────────────
function cacheFile(name, req) {
  const key = (req.session && req.session.username) ? req.session.username : 'anon';
  const safe = key.replace(/[^A-Za-z0-9_.-]/g, '_');
  return path.join(CACHE_DIR, `${name}-${safe}.json`);
}

app.get('/api/cache/inputs', requireAuth, (req, res) => {
  const f = cacheFile('inputs', req);
  if (!fs.existsSync(f)) return res.json({});
  res.json(JSON.parse(fs.readFileSync(f, 'utf8')));
});

app.post('/api/cache/inputs', requireAuth, (req, res) => {
  fs.writeFileSync(cacheFile('inputs', req), JSON.stringify(req.body, null, 2));
  res.json({ ok: true });
});

// ── Drafts (per user) ─────────────────────────────────────────
app.post('/api/draft', requireAuth, (req, res) => {
  fs.writeFileSync(cacheFile('draft', req), JSON.stringify(req.body, null, 2));
  res.json({ ok: true });
});

app.get('/api/draft', requireAuth, (req, res) => {
  const f = cacheFile('draft', req);
  if (!fs.existsSync(f)) return res.json(null);
  res.json(JSON.parse(fs.readFileSync(f, 'utf8')));
});

// Static assets & app pages (after auth gate)
app.use(express.static(path.join(ROOT_DIR, 'public')));

// ── Start ─────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`SAMSON Photo Report server running on http://0.0.0.0:${PORT}`);
});
