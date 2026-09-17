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
