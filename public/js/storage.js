// SAMSON Photo Report — Local storage & server sync
window.SamsonStorage = {
  API_BASE: '.',

  // ── Project data (localStorage + auto-save draft)
  saveDraft(data) {
    try {
      localStorage.setItem('samson_draft', JSON.stringify(data));
      // Also save to server if available
      if (!window.app || !window.app._authenticated) return;
      fetch(`${this.API_BASE}/api/draft`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      }).catch(() => {});
    } catch (e) { /* quota exceeded, ignore */ }
  },

  loadDraft() {
    const local = localStorage.getItem('samson_draft');
    return local ? JSON.parse(local) : null;
  },

  clearDraft() {
    localStorage.removeItem('samson_draft');
  },

  async loadServerDraft() {
    try {
      const res = await fetch(`${this.API_BASE}/api/draft`);
      if (!res.ok) return null;
      return await res.json();
    } catch { return null; }
  },

  // ── Input history (field-name → string[])
  loadInputHistory() {
    try {
      const raw = localStorage.getItem('samson_inputs');
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  },

  saveInputHistory(history) {
    try {
      localStorage.setItem('samson_inputs', JSON.stringify(history));
    } catch { /* ignore */ }
  },

  addInputValue(field, value) {
    if (!value || !value.trim()) return;
    const history = this.loadInputHistory();
    if (!history[field]) history[field] = [];
    // Remove dup and prepend
    history[field] = history[field].filter(v => v !== value);
    history[field].unshift(value);
    // Keep last 10
    history[field] = history[field].slice(0, 10);
    this.saveInputHistory(history);
  },

  // ── Report save/load via server
  async saveReport(meta, images, reportName) {
    const res = await fetch(`${this.API_BASE}/api/reports`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ meta, images, reportName })
    });
    if (!res.ok) throw new Error('Save failed');
    return await res.json();
  },

  async uploadImage(file, reportName, filename) {
    const form = new FormData();
    form.append('reportName', reportName);
    form.append('image', file, filename);
    const res = await fetch(`${this.API_BASE}/api/upload`, { method: 'POST', body: form });
    if (!res.ok) throw new Error('Upload failed');
    return await res.json();
  },

  async getReport(id) {
    const res = await fetch(`${this.API_BASE}/api/reports/${id}`);
    if (!res.ok) throw new Error('Not found');
    return await res.json();
  }
};
