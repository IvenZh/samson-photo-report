const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;

// Directories
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const BACKUPS_DIR = path.join(__dirname, 'backups');
const CACHE_DIR = path.join(__dirname, 'cache');
[UPLOADS_DIR, BACKUPS_DIR, CACHE_DIR].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

// Middleware
app.use(express.json({ limit: '100mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Multer for image uploads
const imageStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `${uuidv4()}${ext}`);
  }
});
const upload = multer({ storage: imageStorage, limits: { fileSize: 20 * 1024 * 1024 } });

// ── API: Upload a single image
app.post('/api/upload', upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image file' });
  res.json({ filename: req.file.filename, size: req.file.size });
});

// ── API: Save full report (metadata JSON + already-uploaded image refs)
app.post('/api/reports', (req, res) => {
  const { meta, images } = req.body;
  if (!meta || !images) return res.status(400).json({ error: 'Missing meta or images' });
  const reportId = uuidv4();
  const report = { id: reportId, meta, images, createdAt: new Date().toISOString() };

  // Save as JSON
  fs.writeFileSync(path.join(UPLOADS_DIR, `${reportId}.json`), JSON.stringify(report, null, 2));

  // Backup copy
  fs.writeFileSync(path.join(BACKUPS_DIR, `${reportId}.json`), JSON.stringify(report, null, 2));

  res.json({ id: reportId });
});

// ── API: Get report by ID
app.get('/api/reports/:id', (req, res) => {
  const filePath = path.join(UPLOADS_DIR, `${req.params.id}.json`);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });
  res.json(JSON.parse(fs.readFileSync(filePath, 'utf-8')));
});

// ── API: List all reports (summary)
app.get('/api/reports', (req, res) => {
  const files = fs.readdirSync(UPLOADS_DIR).filter(f => f.endsWith('.json'));
  const summaries = files.map(f => {
    const data = JSON.parse(fs.readFileSync(path.join(UPLOADS_DIR, f), 'utf-8'));
    return { id: data.id, contractNo: data.meta.contractNo, serialNo: data.meta.serialNo, createdAt: data.createdAt };
  });
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
