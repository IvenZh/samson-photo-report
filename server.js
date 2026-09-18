const express = require('express');
const multer = require('multer');
const archiver = require('archiver');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;

// Directories
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const REPORTS_DIR = path.join(__dirname, 'reports');
const SESSIONS_DIR = path.join(__dirname, 'sessions');
const BACKUPS_DIR = path.join(__dirname, 'backups');
const CACHE_DIR = path.join(__dirname, 'cache');
const AUDIT_LOG_FILE = path.join(BACKUPS_DIR, 'audit.jsonl');
[UPLOADS_DIR, REPORTS_DIR, SESSIONS_DIR, BACKUPS_DIR, CACHE_DIR].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

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

// Middleware
app.use(express.json({ limit: '100mb' }));
app.use(express.static(path.join(__dirname, 'public')));

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
app.post('/api/upload', upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image file' });
  res.json({
    filename: req.file.filename,
    reportName: safeName(req.body.reportName, 'unnamed-report'),
    size: req.file.size
  });
});

// ── API: Save full report (metadata JSON + already-uploaded image refs)
app.post('/api/reports', async (req, res) => {
  const { meta, images, reportName } = req.body;
  if (!meta || !images) return res.status(400).json({ error: 'Missing meta or images' });
  const reportId = safeName(reportName, uuidv4());
  const report = { id: reportId, meta, images, createdAt: new Date().toISOString() };
  const dir = reportDirectory(reportId);
  fs.mkdirSync(dir, { recursive: true });

  fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify(report, null, 2));

  // Backup copy
  fs.writeFileSync(path.join(BACKUPS_DIR, `${reportId}.json`), JSON.stringify(report, null, 2));

  const zipPath = path.join(REPORTS_DIR, `${reportId}.zip`);
  await createZip(dir, zipPath, reportId);
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
  res.download(zipPath, `${reportId}.zip`);
});

app.get('/api/reports/:id/files/:filename', (req, res) => {
  const reportId = safeName(req.params.id, '');
  const filename = safeName(req.params.filename, '');
  if (!reportId || !filename) return res.status(404).json({ error: 'Not found' });
  const filePath = path.join(reportDirectory(reportId), filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });
  res.download(filePath, filename);
});

app.get('/api/dashboard/reports', (req, res) => {
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
  appendAudit({ action: 'dashboard_viewed', actor: req.query.actor || '', role: req.query.role || '', filters: { date: date, operator: operator, ifs: ifs, pos: pos } });
  res.json(reports);
});

app.post('/api/dashboard/audit', (req, res) => {
  var entry = req.body || {};
  appendAudit(entry);
  res.json({ ok: true });
});

app.get('/api/dashboard/audit', (req, res) => {
  var limit = Math.min(Number(req.query.limit) || 100, 500);
  if (!fs.existsSync(AUDIT_LOG_FILE)) return res.json([]);
  var lines = fs.readFileSync(AUDIT_LOG_FILE, 'utf8').trim().split('\n').filter(Boolean).map(function(line) {
    try { return JSON.parse(line); } catch (e) { return null; }
  }).filter(Boolean);
  res.json(lines.slice(-limit).reverse());
});

app.get('/api/admin/dashboard/summary', (req, res) => {
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

app.get('/api/admin/dashboard/operator-workload', (req, res) => {
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

app.get('/api/admin/dashboard/recent-activity', (req, res) => {
  if (!fs.existsSync(AUDIT_LOG_FILE)) return res.json([]);
  var lines = fs.readFileSync(AUDIT_LOG_FILE, 'utf8').trim().split('\n').filter(Boolean).map(function(line) {
    try { return JSON.parse(line); } catch (e) { return null; }
  }).filter(Boolean);
  res.json(lines.slice(-20).reverse());
});

app.get('/api/admin/dashboard/trends', (req, res) => {
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

app.get('/api/admin/dashboard/activity-summary', (req, res) => {
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

app.get('/api/admin/dashboard/storage', (req, res) => {
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

app.get('/api/admin/dashboard/retention', (req, res) => {
  var reports = readReports().map(function(report) {
    var created = new Date(report.createdAt).getTime();
    var expires = created + 30 * 86400000;
    return Object.assign({}, report, { expiresAt: new Date(expires).toISOString(), remainingDays: Math.max(0, Math.ceil((expires - Date.now()) / 86400000)) });
  });
  var expiring = reports.filter(function(report) { return report.remainingDays <= 7; }).sort(function(a, b) { return a.remainingDays - b.remainingDays; });
  res.json({ reports: reports, expiring: expiring });
});

app.get('/api/admin/dashboard/recent-sessions', (req, res) => {
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

app.get('/api/admin/dashboard/recent-reports', (req, res) => {
  res.json(readReports().slice(0, 10));
});

app.post('/api/sessions/package', async (req, res) => {
  const sessionId = safeName((req.body && req.body.sessionId) || '', uuidv4());
  const requested = Array.isArray(req.body && req.body.reports) ? req.body.reports : [];
  const reportIds = requested.map(function(id) { return safeName(id, ''); }).filter(function(id, index, all) {
    return id && all.indexOf(id) === index && fs.existsSync(reportDirectory(id));
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
  res.json({
    sessionId: sessionId,
    downloadUrl: `api/sessions/${encodeURIComponent(sessionId)}/download`
  });
});

app.get('/api/sessions/:id/download', (req, res) => {
  const sessionId = safeName(req.params.id, '');
  const zipPath = path.join(SESSIONS_DIR, `${sessionId}.zip`);
  if (!sessionId || !fs.existsSync(zipPath)) return res.status(404).json({ error: 'Not found' });
  res.download(zipPath, `${sessionId}.zip`);
});

// ── API: Get report by ID
app.get('/api/reports/:id', (req, res) => {
  const reportId = safeName(req.params.id, '');
  const filePath = path.join(reportDirectory(reportId), 'report.json');
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });
  res.json(JSON.parse(fs.readFileSync(filePath, 'utf-8')));
});

// ── API: List all reports (summary)
app.get('/api/reports', (req, res) => {
  const dirs = fs.readdirSync(REPORTS_DIR, { withFileTypes: true }).filter(d => d.isDirectory());
  const summaries = dirs.map(d => {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(REPORTS_DIR, d.name, 'report.json'), 'utf-8'));
      return { id: data.id, contractNo: data.meta.contractNo, serialNo: data.meta.serialNo, createdAt: data.createdAt };
    } catch (e) { return null; }
  }).filter(Boolean);
  res.json(summaries);
});

// ── API: Serve uploaded images
app.use('/uploads', express.static(UPLOADS_DIR));

// ── API: Input cache
app.get('/api/cache/inputs', (req, res) => {
  const cacheFile = path.join(CACHE_DIR, 'inputs.json');
  if (!fs.existsSync(cacheFile)) return res.json({});
  res.json(JSON.parse(fs.readFileSync(cacheFile, 'utf-8')));
});

app.post('/api/cache/inputs', (req, res) => {
  fs.writeFileSync(path.join(CACHE_DIR, 'inputs.json'), JSON.stringify(req.body, null, 2));
  res.json({ ok: true });
});

// ── API: Save draft (for auto-recovery)
app.post('/api/draft', (req, res) => {
  fs.writeFileSync(path.join(CACHE_DIR, 'draft.json'), JSON.stringify(req.body, null, 2));
  res.json({ ok: true });
});

app.get('/api/draft', (req, res) => {
  const draftFile = path.join(CACHE_DIR, 'draft.json');
  if (!fs.existsSync(draftFile)) return res.json(null);
  res.json(JSON.parse(fs.readFileSync(draftFile, 'utf-8')));
});

// ── Start
app.listen(PORT, '0.0.0.0', () => {
  console.log(`SAMSON Photo Report server running on http://0.0.0.0:${PORT}`);
});
