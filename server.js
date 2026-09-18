const express = require('express');
const multer = require('multer');
const archiver = require('archiver');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;
app.set('trust proxy', 1);

// Directories
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const REPORTS_DIR = path.join(__dirname, 'reports');
const SESSIONS_DIR = path.join(__dirname, 'sessions');
const BACKUPS_DIR = path.join(__dirname, 'backups');
const CACHE_DIR = path.join(__dirname, 'cache');
const DATA_DIR = path.join(__dirname, 'data');
const AUDIT_LOG_FILE = path.join(BACKUPS_DIR, 'audit.jsonl');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SESSION_SECRET_FILE = path.join(DATA_DIR, '.session-secret');
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_PASSWORD_HASH = 'b3b130b344c28e52c7bd5347314547502cb39fec8ea539a78087539c236c6501';
[UPLOADS_DIR, REPORTS_DIR, SESSIONS_DIR, BACKUPS_DIR, CACHE_DIR, DATA_DIR].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

const DEFAULT_USERS = [
  { username: 'liuyang', displayName: 'Liu Yang', role: 'operator', enabled: true, passwordHash: DEFAULT_PASSWORD_HASH },
  { username: 'liuzhixin', displayName: 'Liu Zhixin', role: 'operator', enabled: true, passwordHash: DEFAULT_PASSWORD_HASH },
  { username: 'yanbo', displayName: 'Yan Bo', role: 'operator', enabled: true, passwordHash: DEFAULT_PASSWORD_HASH },
  { username: 'zhanglin', displayName: 'Zhang Lin', role: 'operator', enabled: true, passwordHash: DEFAULT_PASSWORD_HASH },
  { username: 'zhonghaitao', displayName: 'Zhong Haitao', role: 'operator', enabled: true, passwordHash: DEFAULT_PASSWORD_HASH },
  { username: 'sunqiang', displayName: 'Sun Qiang', role: 'supervisor', enabled: true, passwordHash: DEFAULT_PASSWORD_HASH },
  { username: 'zhaofeng', displayName: 'Zhao Feng', role: 'admin', enabled: true, passwordHash: DEFAULT_PASSWORD_HASH }
];

function loadUsers() {
  try {
    var users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    if (Array.isArray(users) && users.length) return users.map(function(user) { return Object.assign({}, user, { sessionVersion: Number(user.sessionVersion || 0) }); });
  } catch (e) {}
  fs.writeFileSync(USERS_FILE, JSON.stringify(DEFAULT_USERS, null, 2));
  return DEFAULT_USERS.slice();
}

function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

function publicUser(user) {
  return { username: user.username, displayName: user.displayName, role: user.role, enabled: user.enabled !== false };
}

function sessionSecret() {
  try {
    var secret = fs.readFileSync(SESSION_SECRET_FILE, 'utf8').trim();
    if (secret) return secret;
  } catch (e) {}
  var secret = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(SESSION_SECRET_FILE, secret, { mode: 0o600 });
  return secret;
}

function signSession(user) {
  var payload = Buffer.from(JSON.stringify({ username: user.username, sessionVersion: Number(user.sessionVersion || 0), exp: Date.now() + SESSION_TTL_MS })).toString('base64url');
  var signature = crypto.createHmac('sha256', sessionSecret()).update(payload).digest('base64url');
  return payload + '.' + signature;
}

function parseCookies(req) {
  var cookies = {};
  String(req.headers.cookie || '').split(';').forEach(function(part) {
    var index = part.indexOf('=');
    if (index < 0) return;
    cookies[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  });
  return cookies;
}

function authenticatedUser(req) {
  var token = parseCookies(req).samson_session || '';
  var parts = token.split('.');
  if (parts.length !== 2) return null;
  var expected = crypto.createHmac('sha256', sessionSecret()).update(parts[0]).digest('base64url');
  var received = Buffer.from(parts[1]);
  var expectedBuffer = Buffer.from(expected);
  if (received.length !== expectedBuffer.length || !crypto.timingSafeEqual(received, expectedBuffer)) return null;
  try {
    var payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    if (!payload.username || Number(payload.exp) < Date.now()) return null;
    return loadUsers().find(function(user) {
      return user.username === payload.username && user.enabled !== false && Number(user.sessionVersion || 0) === Number(payload.sessionVersion || 0);
    }) || null;
  } catch (e) {
    return null;
  }
}

function setSessionCookie(req, res, user) {
  var secure = req.secure || String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
  res.setHeader('Set-Cookie', 'samson_session=' + encodeURIComponent(signSession(user)) + '; HttpOnly; SameSite=Strict; Path=/; Max-Age=' + Math.floor(SESSION_TTL_MS / 1000) + (secure ? '; Secure' : ''));
}

function clearSessionCookie(req, res) {
  var secure = req.secure || String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
  res.setHeader('Set-Cookie', 'samson_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' + (secure ? '; Secure' : ''));
}

function requireAuth(req, res, next) {
  var user = authenticatedUser(req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });
  req.user = user;
  next();
}

function requireRole() {
  var roles = Array.prototype.slice.call(arguments);
  return function(req, res, next) {
    if (!req.user || roles.indexOf(req.user.role) < 0) return res.status(403).json({ error: 'Forbidden' });
    next();
  };
}

function reportMeta(reportId) {
  try {
    return JSON.parse(fs.readFileSync(path.join(reportDirectory(reportId), 'report.json'), 'utf8')).meta || {};
  } catch (e) {
    return null;
  }
}

function canAccessReport(user, reportId) {
  if (!user || user.role !== 'operator') return !!user;
  var meta = reportMeta(reportId);
  return !!meta && (meta.operatorId === user.username || meta.operatorName === user.displayName);
}

function safeName(value, fallback) {
  var name = String(value || '').trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '-').replace(/[. ]+$/g, '');
  return name || fallback;
}

function reportDirectory(reportName) {
  return path.join(REPORTS_DIR, safeName(reportName, 'unnamed-report'));
}

function uniqueFilename(dir, filename) {
  var ext = path.extname(filename);
  var base = path.basename(filename, ext);
  var candidate = filename;
  var index = 1;
  while (fs.existsSync(path.join(dir, candidate))) {
    candidate = base + '_' + index + ext;
    index++;
  }
  return candidate;
}

function createZip(sourceDir, zipPath, rootName) {
  return new Promise(function(resolve, reject) {
    var output = fs.createWriteStream(zipPath);
    var archive = archiver('zip', { zlib: { level: 6 } });
    output.on('close', resolve);
    archive.on('error', reject);
    archive.pipe(output);
    archive.directory(sourceDir, rootName);
    archive.finalize();
  });
}

function appendAudit(entry) {
  try {
    fs.appendFileSync(AUDIT_LOG_FILE, JSON.stringify(Object.assign({ timestamp: new Date().toISOString() }, entry)) + '\n');
  } catch (e) {}
}

function readReports() {
  var reports = [];
  if (!fs.existsSync(REPORTS_DIR)) return reports;
  fs.readdirSync(REPORTS_DIR, { withFileTypes: true }).filter(function(entry) { return entry.isDirectory(); }).forEach(function(dir) {
    try {
      var file = path.join(REPORTS_DIR, dir.name, 'report.json');
      if (!fs.existsSync(file)) return;
      var data = JSON.parse(fs.readFileSync(file, 'utf8'));
      var meta = data.meta || {};
      reports.push({
        id: data.id || dir.name,
        createdAt: data.createdAt || '',
        contractNo: meta.contractNo || meta.ifsNo || '',
        ifsNo: meta.ifsNo || meta.contractNo || '',
        positionNo: meta.positionNo || '',
        tagNo: meta.tagNo || '',
        serialNo: meta.serialNo || '',
        valveType: meta.valveType || '',
        operator: meta.operatorName || meta.operatorId || '',
        operatorId: meta.operatorId || meta.operatorName || '',
        sessionId: meta.sessionId || '',
        reportUrl: `api/reports/${encodeURIComponent(dir.name)}/files/${encodeURIComponent(dir.name + '.pdf')}`,
        downloadUrl: `api/reports/${encodeURIComponent(dir.name)}/download`
      });
    } catch (e) {}
  });
  reports.sort(function(a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); });
  return reports;
}

function dirSize(dir) {
  if (!fs.existsSync(dir)) return 0;
  var total = 0;
  fs.readdirSync(dir, { withFileTypes: true }).forEach(function(entry) {
    var full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += dirSize(full);
    else total += fs.statSync(full).size;
  });
  return total;
}

function cleanupExpiredData() {
  var cutoff = Date.now() - RETENTION_MS;
  var deleted = [];
  if (fs.existsSync(REPORTS_DIR)) {
    fs.readdirSync(REPORTS_DIR, { withFileTypes: true }).forEach(function(entry) {
      if (!entry.isDirectory()) return;
      var dir = path.join(REPORTS_DIR, entry.name);
      var timestamp = 0;
      try {
        var report = JSON.parse(fs.readFileSync(path.join(dir, 'report.json'), 'utf8'));
        timestamp = new Date(report.createdAt).getTime();
      } catch (e) {}
      if (!timestamp) {
        try { timestamp = fs.statSync(dir).mtimeMs; } catch (e) {}
      }
      if (!timestamp || timestamp >= cutoff) return;
      try {
        fs.rmSync(dir, { recursive: true, force: true });
        fs.rmSync(path.join(REPORTS_DIR, entry.name + '.zip'), { force: true });
        fs.rmSync(path.join(BACKUPS_DIR, entry.name + '.json'), { force: true });
        deleted.push(entry.name);
      } catch (e) {}
    });
  }
  [SESSIONS_DIR, REPORTS_DIR].forEach(function(folder) {
    if (!fs.existsSync(folder)) return;
    fs.readdirSync(folder, { withFileTypes: true }).filter(function(entry) { return entry.isFile() && /\.zip$/i.test(entry.name); }).forEach(function(entry) {
      var file = path.join(folder, entry.name);
      try {
        if (fs.statSync(file).mtimeMs < cutoff) {
          fs.rmSync(file, { force: true });
          if (folder === SESSIONS_DIR) fs.rmSync(path.join(SESSIONS_DIR, entry.name.replace(/\.zip$/i, '.json')), { force: true });
        }
      } catch (e) {}
    });
  });
  if (deleted.length) appendAudit({ action: 'retention_cleanup', actor: 'system', role: 'system', reports: deleted, retentionDays: 30 });
  return deleted;
}

// Middleware
app.use(express.json({ limit: '100mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── API: Authentication
app.post('/api/auth/login', (req, res) => {
  var username = String((req.body && req.body.username) || '').trim().toLowerCase();
  var suppliedHash = String((req.body && req.body.passwordHash) || '').trim().toLowerCase();
  var user = loadUsers().find(function(item) { return item.username === username; });
  var expectedHash = user && user.enabled !== false ? String(user.passwordHash || '') : '';
  var supplied = Buffer.from(suppliedHash);
  var expected = Buffer.from(expectedHash);
  var valid = !!user && user.enabled !== false && supplied.length === expected.length && supplied.length > 0 && crypto.timingSafeEqual(supplied, expected);
  if (!valid) {
    appendAudit({ action: 'login_failed', actor: username, role: user ? user.role : '' });
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  setSessionCookie(req, res, user);
  appendAudit({ action: 'login_succeeded', actor: user.displayName, role: user.role, username: user.username });
  res.json(publicUser(user));
});

app.get('/api/auth/session', (req, res) => {
  var user = authenticatedUser(req);
  if (!user) return res.json({ authenticated: false });
  res.json({ authenticated: true, user: publicUser(user) });
});

app.post('/api/auth/logout', (req, res) => {
  var user = authenticatedUser(req);
  if (user) appendAudit({ action: 'logout', actor: user.displayName, role: user.role, username: user.username });
  clearSessionCookie(req, res);
  res.json({ ok: true });
});

app.use('/api', requireAuth);

// ── API: Admin user management
app.get('/api/admin/users', requireRole('admin'), (req, res) => {
  res.json(loadUsers().map(publicUser));
});

app.post('/api/admin/users', requireRole('admin'), (req, res) => {
  var username = String((req.body && req.body.username) || '').trim().toLowerCase();
  var displayName = String((req.body && req.body.displayName) || '').trim();
  var role = String((req.body && req.body.role) || '').trim();
  var passwordHash = String((req.body && req.body.passwordHash) || '').trim().toLowerCase();
  if (!/^[A-Za-z][A-Za-z0-9._-]{1,31}$/.test(username)) return res.status(400).json({ error: 'Invalid username' });
  if (!displayName) return res.status(400).json({ error: 'Display name required' });
  if (['operator', 'supervisor', 'admin'].indexOf(role) < 0) return res.status(400).json({ error: 'Invalid role' });
  if (!/^[a-f0-9]{64}$/.test(passwordHash)) return res.status(400).json({ error: 'Invalid password' });
  var users = loadUsers();
  if (users.some(function(user) { return user.username === username; })) return res.status(409).json({ error: 'Username exists' });
  var user = { username: username, displayName: displayName, role: role, enabled: true, passwordHash: passwordHash };
  users.push(user);
  saveUsers(users);
  appendAudit({ action: 'user_created', actor: req.user.displayName, role: req.user.role, username: username, targetRole: role });
  res.status(201).json(publicUser(user));
});

app.patch('/api/admin/users/:username', requireRole('admin'), (req, res) => {
  var users = loadUsers();
  var user = users.find(function(item) { return item.username === req.params.username; });
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (req.body && typeof req.body.displayName === 'string' && req.body.displayName.trim()) user.displayName = req.body.displayName.trim();
  if (req.body && typeof req.body.role === 'string' && ['operator', 'supervisor', 'admin'].indexOf(req.body.role) >= 0) {
    if (user.username === req.user.username && req.body.role !== 'admin') return res.status(400).json({ error: 'Cannot remove current admin role' });
    user.role = req.body.role;
  }
  if (req.body && typeof req.body.enabled === 'boolean') {
    if (!req.body.enabled && user.username === req.user.username) return res.status(400).json({ error: 'Cannot disable current account' });
    if (!req.body.enabled && user.enabled !== false) user.sessionVersion = Number(user.sessionVersion || 0) + 1;
    user.enabled = req.body.enabled;
  }
  if (req.body && typeof req.body.passwordHash === 'string') {
    var passwordHash = req.body.passwordHash.trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(passwordHash)) return res.status(400).json({ error: 'Invalid password' });
    user.passwordHash = passwordHash;
    user.sessionVersion = Number(user.sessionVersion || 0) + 1;
  }
  saveUsers(users);
  appendAudit({ action: 'user_updated', actor: req.user.displayName, role: req.user.role, username: user.username, targetRole: user.role, enabled: user.enabled !== false });
  res.json(publicUser(user));
});

app.delete('/api/admin/users/:username', requireRole('admin'), (req, res) => {
  if (req.params.username === req.user.username) return res.status(400).json({ error: 'Cannot delete current account' });
  var users = loadUsers();
  var user = users.find(function(item) { return item.username === req.params.username; });
  if (!user) return res.status(404).json({ error: 'User not found' });
  saveUsers(users.filter(function(item) { return item.username !== user.username; }));
  appendAudit({ action: 'user_deleted', actor: req.user.displayName, role: req.user.role, username: user.username, targetRole: user.role });
  res.json({ deleted: user.username });
});

// Multer for image uploads
const imageStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = reportDirectory(req.body.reportName || 'unnamed-report');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const dir = reportDirectory(req.body.reportName || 'unnamed-report');
    const ext = path.extname(file.originalname) || '.jpg';
    const base = safeName(path.basename(file.originalname, ext), uuidv4());
    cb(null, uniqueFilename(dir, `${base}${ext}`));
  }
});
const upload = multer({ storage: imageStorage, limits: { fileSize: 20 * 1024 * 1024 } });

// ── API: Upload a single image
app.post('/api/upload', requireRole('operator', 'admin'), upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image file' });
  res.json({
    filename: req.file.filename,
    reportName: safeName(req.body.reportName, 'unnamed-report'),
    size: req.file.size
  });
});

// ── API: Save full report (metadata JSON + already-uploaded image refs)
app.post('/api/reports', requireRole('operator', 'admin'), async (req, res) => {
  const { meta, images, reportName } = req.body;
  if (!meta || !images) return res.status(400).json({ error: 'Missing meta or images' });
  const reportId = safeName(reportName, uuidv4());
  meta.operatorId = req.user.username;
  meta.operatorName = req.user.displayName;
  if (req.user.role === 'operator' && meta.sessionId) {
    var sessionReports = readReports().filter(function(report) { return report.operatorId === req.user.username && report.sessionId === meta.sessionId; });
    if (sessionReports.length >= 10) return res.status(409).json({ error: 'Session valve limit reached' });
  }
  const report = { id: reportId, meta, images, createdAt: new Date().toISOString() };
  const dir = reportDirectory(reportId);
  fs.mkdirSync(dir, { recursive: true });

  fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify(report, null, 2));

  // Backup copy
  fs.writeFileSync(path.join(BACKUPS_DIR, `${reportId}.json`), JSON.stringify(report, null, 2));

  const zipPath = path.join(REPORTS_DIR, `${reportId}.zip`);
  await createZip(dir, zipPath, reportId);
  appendAudit({ action: 'report_generated', actor: req.user.displayName, role: req.user.role, reportId: reportId, contractNo: meta.contractNo || meta.ifsNo || '', positionNo: meta.positionNo || '', tagNo: meta.tagNo || '', sessionId: meta.sessionId || '' });
  res.json({
    id: reportId,
    reportName: reportId,
    downloadUrl: `api/reports/${encodeURIComponent(reportId)}/download`,
    reportUrl: `api/reports/${encodeURIComponent(reportId)}/files/${encodeURIComponent(reportId + '.pdf')}`
  });
});

app.get('/api/reports/:id/download', (req, res) => {
  const reportId = safeName(req.params.id, '');
  const zipPath = path.join(REPORTS_DIR, `${reportId}.zip`);
  if (!reportId || !fs.existsSync(zipPath)) return res.status(404).json({ error: 'Not found' });
  if (!canAccessReport(req.user, reportId)) return res.status(403).json({ error: 'Forbidden' });
  appendAudit({ action: 'report_downloaded_zip', actor: req.user.displayName, role: req.user.role, reportId: reportId });
  res.download(zipPath, `${reportId}.zip`);
});

app.get('/api/reports/:id/files/:filename', (req, res) => {
  const reportId = safeName(req.params.id, '');
  const filename = safeName(req.params.filename, '');
  if (!reportId || !filename) return res.status(404).json({ error: 'Not found' });
  const filePath = path.join(reportDirectory(reportId), filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });
  if (!canAccessReport(req.user, reportId)) return res.status(403).json({ error: 'Forbidden' });
  appendAudit({ action: 'report_viewed', actor: req.user.displayName, role: req.user.role, reportId: reportId, filename: filename });
  res.download(filePath, filename);
});

app.post('/api/reports/bulk-delete', requireRole('admin'), (req, res) => {
  var requested = Array.isArray(req.body && req.body.ids) ? req.body.ids : [];
  var deleted = [];
  requested.forEach(function(id) {
    var reportId = safeName(id, '');
    if (!reportId) return;
    var dir = reportDirectory(reportId);
    var zip = path.join(REPORTS_DIR, `${reportId}.zip`);
    try {
      var existed = fs.existsSync(dir) || fs.existsSync(zip);
      if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
      if (fs.existsSync(zip)) fs.rmSync(zip, { force: true });
      fs.rmSync(path.join(BACKUPS_DIR, `${reportId}.json`), { force: true });
      if (existed) deleted.push(reportId);
    } catch (e) {}
  });
  appendAudit({ action: 'reports_deleted', actor: req.user.displayName, role: req.user.role, reports: deleted });
  res.json({ deleted: deleted });
});

app.get('/api/dashboard/reports', requireRole('supervisor', 'admin'), (req, res) => {
  const date = String(req.query.date || '').trim();
  const operator = String(req.query.operator || '').trim().toLowerCase();
  const ifs = String(req.query.ifs || '').trim().toLowerCase();
  const pos = String(req.query.pos || '').replace(/^Pos\s*/i, '').toLowerCase();
  const reports = [];
  if (fs.existsSync(REPORTS_DIR)) {
    fs.readdirSync(REPORTS_DIR, { withFileTypes: true }).filter(function(entry) { return entry.isDirectory(); }).forEach(function(dir) {
      try {
        var file = path.join(REPORTS_DIR, dir.name, 'report.json');
        if (!fs.existsSync(file)) return;
        var data = JSON.parse(fs.readFileSync(file, 'utf8'));
        var meta = data.meta || {};
        var report = {
          id: data.id || dir.name,
          createdAt: data.createdAt || '',
          contractNo: meta.contractNo || meta.ifsNo || '',
          ifsNo: meta.ifsNo || meta.contractNo || '',
          positionNo: meta.positionNo || '',
          tagNo: meta.tagNo || '',
          serialNo: meta.serialNo || '',
          valveType: meta.valveType || '',
          operator: meta.operatorName || meta.operatorId || '',
          operatorId: meta.operatorId || meta.operatorName || '',
          sessionId: meta.sessionId || '',
          reportUrl: `api/reports/${encodeURIComponent(dir.name)}/files/${encodeURIComponent(dir.name + '.pdf')}`,
          downloadUrl: `api/reports/${encodeURIComponent(dir.name)}/download`
        };
        if (date && String(report.createdAt).slice(0, 10) !== date) return;
        if (operator && String(report.operator).toLowerCase().replace(/[._-]+/g, ' ').indexOf(operator.replace(/[._-]+/g, ' ')) < 0) return;
        if (ifs && String(report.contractNo).toLowerCase().indexOf(ifs) < 0 && String(report.ifsNo).toLowerCase().indexOf(ifs) < 0) return;
        if (pos && String(report.positionNo).replace(/^Pos\s*/i, '').toLowerCase().indexOf(pos) < 0) return;
        reports.push(report);
      } catch (e) {}
    });
  }
  reports.sort(function(a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); });
  appendAudit({ action: 'dashboard_viewed', actor: req.user.displayName, role: req.user.role, filters: { date: date, operator: operator, ifs: ifs, pos: pos } });
  res.json(reports);
});

app.post('/api/dashboard/audit', (req, res) => {
  var entry = Object.assign({}, req.body || {}, { actor: req.user.displayName, role: req.user.role, username: req.user.username });
  delete entry.password;
  delete entry.passwordHash;
  appendAudit(entry);
  res.json({ ok: true });
});

app.get('/api/dashboard/audit', requireRole('admin'), (req, res) => {
  var limit = Math.min(Number(req.query.limit) || 100, 500);
  if (!fs.existsSync(AUDIT_LOG_FILE)) return res.json([]);
  var lines = fs.readFileSync(AUDIT_LOG_FILE, 'utf8').trim().split('\n').filter(Boolean).map(function(line) {
    try { return JSON.parse(line); } catch (e) { return null; }
  }).filter(Boolean);
  res.json(lines.slice(-limit).reverse());
});

app.get('/api/admin/dashboard/summary', requireRole('admin'), (req, res) => {
  var reports = readReports();
  var now = new Date();
  var today = now.toISOString().slice(0, 10);
  var todayReports = reports.filter(function(r) { return String(r.createdAt).slice(0, 10) === today; });
  var sessions = {};
  var operators = {};
  reports.forEach(function(r) {
    if (r.sessionId) sessions[r.sessionId] = true;
    if (r.operator) operators[r.operator] = true;
  });
  res.json({
    totalReports: reports.length,
    todayReports: todayReports.length,
    totalSessions: Object.keys(sessions).length,
    totalOperators: Object.keys(operators).length
  });
});

app.get('/api/admin/dashboard/operator-workload', requireRole('admin'), (req, res) => {
  var reports = readReports();
  var workload = {};
  reports.forEach(function(r) {
    if (!r.operator) return;
    if (!workload[r.operator]) workload[r.operator] = { operator: r.operator, reports: 0, sessions: {} };
    workload[r.operator].reports++;
    if (r.sessionId) workload[r.operator].sessions[r.sessionId] = true;
  });
  res.json(Object.keys(workload).map(function(key) {
    return { operator: workload[key].operator, reports: workload[key].reports, sessions: Object.keys(workload[key].sessions).length };
  }));
});

app.get('/api/admin/dashboard/recent-activity', requireRole('admin'), (req, res) => {
  if (!fs.existsSync(AUDIT_LOG_FILE)) return res.json([]);
  var lines = fs.readFileSync(AUDIT_LOG_FILE, 'utf8').trim().split('\n').filter(Boolean).map(function(line) {
    try { return JSON.parse(line); } catch (e) { return null; }
  }).filter(Boolean);
  res.json(lines.slice(-20).reverse());
});

app.get('/api/admin/dashboard/trends', requireRole('admin'), (req, res) => {
  var days = req.query.days === 'all' ? 365 : Math.min(Math.max(Number(req.query.days) || 7, 1), 30);
  var reports = readReports();
  var today = new Date();
  var result = [];
  for (var i = days - 1; i >= 0; i--) {
    var date = new Date(today);
    date.setDate(today.getDate() - i);
    var key = date.toISOString().slice(0, 10);
    result.push({ date: key, reports: reports.filter(function(report) { return String(report.createdAt).slice(0, 10) === key; }).length });
  }
  res.json(result);
});

app.get('/api/admin/dashboard/activity-summary', requireRole('admin'), (req, res) => {
  var days = req.query.days === 'all' ? 365 : Math.min(Math.max(Number(req.query.days) || 7, 1), 30);
  if (!fs.existsSync(AUDIT_LOG_FILE)) return res.json([]);
  var now = Date.now();
  var counts = {};
  fs.readFileSync(AUDIT_LOG_FILE, 'utf8').trim().split('\n').filter(Boolean).forEach(function(line) {
    try {
      var item = JSON.parse(line);
      if (now - new Date(item.timestamp).getTime() > days * 86400000) return;
      counts[item.action] = (counts[item.action] || 0) + 1;
    } catch (e) {}
  });
  res.json(Object.keys(counts).map(function(action) { return { action: action, count: counts[action] }; }).sort(function(a, b) { return b.count - a.count; }));
});

app.get('/api/admin/dashboard/storage', requireRole('admin'), (req, res) => {
  var reportsSize = dirSize(REPORTS_DIR);
  var last24 = Date.now() - 86400000;
  var last24ArchiveBytes = 0;
  if (fs.existsSync(REPORTS_DIR)) {
    fs.readdirSync(REPORTS_DIR, { withFileTypes: true }).filter(function(entry) { return entry.isDirectory(); }).forEach(function(entry) {
      try {
        var stats = fs.statSync(path.join(REPORTS_DIR, entry.name));
        if (stats.mtimeMs >= last24) last24ArchiveBytes += dirSize(path.join(REPORTS_DIR, entry.name));
      } catch (e) {}
    });
  }
  var diskTotal = 0, diskFree = 0, diskUsed = 0, diskUsagePercent = 0;
  try {
    var stats = fs.statfsSync('/');
    diskTotal = stats.blocks * stats.bsize;
    diskFree = stats.bfree * stats.bsize;
    diskUsed = diskTotal - diskFree;
    diskUsagePercent = diskTotal ? Math.round(((diskTotal - diskFree) / diskTotal) * 100) : 0;
  } catch (e) {}
  res.json({ reportsSizeBytes: reportsSize, last24ArchiveBytes: last24ArchiveBytes, diskTotalBytes: diskTotal, diskFreeBytes: diskFree, diskUsedBytes: diskUsed, diskUsagePercent: diskUsagePercent });
});

app.get('/api/admin/dashboard/retention', requireRole('admin'), (req, res) => {
  var reports = readReports().map(function(report) {
    var created = new Date(report.createdAt).getTime();
    var expires = created + 30 * 86400000;
    return Object.assign({}, report, { expiresAt: new Date(expires).toISOString(), remainingDays: Math.max(0, Math.ceil((expires - Date.now()) / 86400000)) });
  });
  var expiring = reports.filter(function(report) { return report.remainingDays <= 7; }).sort(function(a, b) { return a.remainingDays - b.remainingDays; });
  res.json({ reports: reports, expiring: expiring });
});

app.get('/api/admin/dashboard/recent-sessions', requireRole('admin'), (req, res) => {
  var reports = readReports();
  var sessions = {};
  reports.forEach(function(report) {
    if (!report.sessionId) return;
    if (!sessions[report.sessionId]) sessions[report.sessionId] = { sessionId: report.sessionId, operator: report.operator, createdAt: report.createdAt, reports: 0 };
    sessions[report.sessionId].reports++;
    if (String(report.createdAt) > String(sessions[report.sessionId].createdAt)) sessions[report.sessionId].createdAt = report.createdAt;
  });
  res.json(Object.keys(sessions).map(function(key) { return sessions[key]; }).sort(function(a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); }).slice(0, 10));
});

app.get('/api/admin/dashboard/recent-reports', requireRole('admin'), (req, res) => {
  res.json(readReports().slice(0, 10));
});

app.post('/api/sessions/package', async (req, res) => {
  const sessionId = safeName((req.body && req.body.sessionId) || '', uuidv4());
  const requested = Array.isArray(req.body && req.body.reports) ? req.body.reports : [];
  const reportIds = requested.map(function(id) { return safeName(id, ''); }).filter(function(id, index, all) {
    return id && all.indexOf(id) === index && fs.existsSync(reportDirectory(id)) && canAccessReport(req.user, id);
  });
  if (!reportIds.length) return res.status(400).json({ error: 'No reports to package' });
  const zipPath = path.join(SESSIONS_DIR, `${sessionId}.zip`);
  await new Promise(function(resolve, reject) {
    var output = fs.createWriteStream(zipPath);
    var archive = archiver('zip', { zlib: { level: 6 } });
    output.on('close', resolve);
    archive.on('error', reject);
    archive.pipe(output);
    reportIds.forEach(function(id) { archive.directory(reportDirectory(id), id); });
    archive.append(JSON.stringify({ sessionId: sessionId, reports: reportIds, createdAt: new Date().toISOString() }, null, 2), { name: `${sessionId}/session-manifest.json` });
    archive.finalize();
  });
  fs.writeFileSync(path.join(SESSIONS_DIR, `${sessionId}.json`), JSON.stringify({ sessionId: sessionId, reports: reportIds, createdAt: new Date().toISOString() }, null, 2));
  res.json({
    sessionId: sessionId,
    downloadUrl: `api/sessions/${encodeURIComponent(sessionId)}/download`
  });
});

app.get('/api/sessions/:id/download', (req, res) => {
  const sessionId = safeName(req.params.id, '');
  const zipPath = path.join(SESSIONS_DIR, `${sessionId}.zip`);
  if (!sessionId || !fs.existsSync(zipPath)) return res.status(404).json({ error: 'Not found' });
  try {
    var manifest = JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, `${sessionId}.json`), 'utf8'));
    if (req.user.role === 'operator' && !(manifest.reports || []).every(function(reportId) { return canAccessReport(req.user, reportId); })) return res.status(403).json({ error: 'Forbidden' });
  } catch (e) {
    if (req.user.role === 'operator') return res.status(403).json({ error: 'Forbidden' });
  }
  appendAudit({ action: 'session_downloaded', actor: req.user.displayName, role: req.user.role, sessionId: sessionId });
  res.download(zipPath, `${sessionId}.zip`);
});

// ── API: Get report by ID
app.get('/api/reports/:id', (req, res) => {
  const reportId = safeName(req.params.id, '');
  const filePath = path.join(reportDirectory(reportId), 'report.json');
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });
  if (!canAccessReport(req.user, reportId)) return res.status(403).json({ error: 'Forbidden' });
  appendAudit({ action: 'report_viewed', actor: req.user.displayName, role: req.user.role, reportId: reportId });
  res.json(JSON.parse(fs.readFileSync(filePath, 'utf-8')));
});

// ── API: List all reports (summary)
app.get('/api/reports', (req, res) => {
  const dirs = fs.readdirSync(REPORTS_DIR, { withFileTypes: true }).filter(d => d.isDirectory());
  const summaries = dirs.map(d => {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(REPORTS_DIR, d.name, 'report.json'), 'utf-8'));
      if (!canAccessReport(req.user, d.name)) return null;
      return { id: data.id, contractNo: data.meta.contractNo, serialNo: data.meta.serialNo, createdAt: data.createdAt };
    } catch (e) { return null; }
  }).filter(Boolean);
  res.json(summaries);
});

// ── API: Serve uploaded images
app.use('/uploads', requireAuth, express.static(UPLOADS_DIR));

// ── API: Input cache
app.get('/api/cache/inputs', (req, res) => {
  const cacheFile = path.join(CACHE_DIR, `inputs-${safeName(req.user.username, 'user')}.json`);
  if (!fs.existsSync(cacheFile)) return res.json({});
  res.json(JSON.parse(fs.readFileSync(cacheFile, 'utf-8')));
});

app.post('/api/cache/inputs', (req, res) => {
  fs.writeFileSync(path.join(CACHE_DIR, `inputs-${safeName(req.user.username, 'user')}.json`), JSON.stringify(req.body, null, 2));
  res.json({ ok: true });
});

// ── API: Save draft (for auto-recovery)
app.post('/api/draft', (req, res) => {
  fs.writeFileSync(path.join(CACHE_DIR, `draft-${safeName(req.user.username, 'user')}.json`), JSON.stringify(req.body, null, 2));
  res.json({ ok: true });
});

app.get('/api/draft', (req, res) => {
  const draftFile = path.join(CACHE_DIR, `draft-${safeName(req.user.username, 'user')}.json`);
  if (!fs.existsSync(draftFile)) return res.json(null);
  res.json(JSON.parse(fs.readFileSync(draftFile, 'utf-8')));
});

// ── Start
cleanupExpiredData();
setInterval(cleanupExpiredData, 6 * 60 * 60 * 1000).unref();

app.listen(PORT, '0.0.0.0', () => {
  console.log(`SAMSON Photo Report server running on http://0.0.0.0:${PORT}`);
});
