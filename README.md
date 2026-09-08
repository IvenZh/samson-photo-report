# SAMSON Photo Report (Q-2047)

Mobile-first web app for SAMSON control valve photo documentation. Workers follow a guided multi-step workflow to capture valve views, nameplates, accessory and appearance photos, then generate a bilingual (EN) PDF photo report and upload it to cloud storage.

## Stack

- Node.js + Express backend
- Vanilla JS SPA frontend (no build step)
- jsPDF for PDF report generation
- localStorage draft recovery + server-side backup

## Run

```bash
npm install
npm start
```

Opens on http://localhost:3000

## Structure

- `server.js` — Express API, uploads, report storage
- `public/` — frontend (index.html, css, js)

## Notes

Uploaded photos, generated reports and caches are stored under `uploads/`, `backups/` and `cache/` (git-ignored).
