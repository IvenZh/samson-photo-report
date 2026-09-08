// ────────────────────────────────────────────
// SAMSON Photo Report App — Q-2047
// ────────────────────────────────────────────

class SamsonApp {
  constructor() {
    try {
      this.currentStep = 1;
      this.totalSteps = 8;
      this.data = this._defaultData();
      this._bindBaseEvents();
      this._checkDraft();
      this.render();
    } catch(e) {
      document.getElementById('mainContent').innerHTML =
        '<div style="padding:16px;color:red;font-family:monospace;font-size:13px;">' +
        '<h3>JS Error</h3><pre>' + (e.stack || e.message || e) + '</pre></div>';
    }
  }

  // ── Default data structure ─────────────────
  _defaultData() {
    return {
      contractNo: '', ifsNo: '', positionNo: '', tagNo: '',
      serialNo: '', valveType: '', recorder: '',
      accessories: {
        positioner:       { qty: 1, selected: true  },
        filterRegulator:  { qty: 1, selected: true  },
        solenoidValve:    { qty: 1, selected: false },
        volumeBooster:    { qty: 1, selected: false },
        quickExhaust:     { qty: 1, selected: false },
        limitSwitch:      { qty: 1, selected: false },
        others:           [],
        cleaningLabel:    false,
        cleaningQty:      1
      },
      valvePhotos: {},   // key → dataURL
      accessoryPhotos: {}, // key → { photo: dataURL, nameplate: dataURL }
      appearance: {
        flowDirection: false,
        pressureGauge: false,
        flangeWaterline: false,
        internalCleanliness: false,
        otherAppearance: []
      },
      appearancePhotos: {}
    };
  }

  // ── Lang helpers ───────────────────────────
  t(key) { return I18n.t(key); }

  // ── Draft / recovery ───────────────────────
  _checkDraft() {
    if (window._draftChecked) return;
    window._draftChecked = true;
    var draft = SamsonStorage.loadDraft();
    // Also try server draft as fallback
    if (!draft || !draft.contractNo) {
      SamsonStorage.loadServerDraft().then(function(srv) {
        if (srv && (srv.contractNo || srv.serialNo || srv._currentStep > 1)) {
          document.getElementById('recoverBanner').style.display = 'flex';
          document.getElementById('recoverBanner').querySelector('span').textContent = this.t('draftRecovered') +
            ' (' + (srv.contractNo || '?') + ' / ' + (srv.serialNo || '?') + ')';
          // Store server draft locally so _recoverYes can use it
          SamsonStorage.saveDraft(srv);
        }
      }.bind(this));
      return;
    }
    // Check if draft has meaningful data (contractNo, serialNo, valveType, or any photos)
    var hasData = draft.contractNo || draft.serialNo || draft.valveType;
    var hasPhotos = Object.keys(draft.valvePhotos || {}).length > 0 || Object.keys(draft.accessoryPhotos || {}).length > 0 || Object.keys(draft.appearancePhotos || {}).length > 0;
    if (draft && (hasData || hasPhotos || draft._currentStep > 1)) {
      document.getElementById('recoverBanner').style.display = 'flex';
      document.getElementById('recoverBanner').querySelector('span').textContent = this.t('draftRecovered') +
        ' (' + (draft.contractNo || '?') + ' / ' + (draft.serialNo || '?') + ' / ' + this.t('step') + ' ' + (draft._currentStep || 1) + ')';
    }
  }

  _deepMerge(target, source) {
    var out = Object.assign({}, target);
    for (var key in source) {
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key]) && target[key] && typeof target[key] === 'object' && !Array.isArray(target[key])) {
        out[key] = this._deepMerge(target[key], source[key]);
      } else {
        out[key] = source[key];
      }
    }
    return out;
  }

  _recoverYes() {
    var draft = SamsonStorage.loadDraft();
    if (draft) {
      var base = this._defaultData();
      this.data = this._deepMerge(base, draft);
      this.currentStep = draft._currentStep || 1;
    }
    document.getElementById('recoverBanner').style.display = 'none';
    this.render();
  }

  _recoverNo() {
    SamsonStorage.clearDraft();
    document.getElementById('recoverBanner').style.display = 'none';
  }

  // ── Base events (lang toggle, recover, steps indicator taps) ──
  _bindBaseEvents() {
    document.getElementById('langToggle').onclick = () => {
      I18n.toggle();
      document.getElementById('langToggle').textContent = I18n.t('langSwitch');
      this.render();
    };
    document.getElementById('recoverYes').onclick = () => this._recoverYes();
    document.getElementById('recoverYes').textContent = this.t('recoverYes');
    document.getElementById('recoverNo').textContent = this.t('recoverNo');
    document.getElementById('recoverNo').onclick = () => this._recoverNo();

    document.getElementById('stepIndicators').onclick = (e) => {
      const dot = e.target.closest('.step-dot');
      if (!dot) return;
      const step = parseInt(dot.dataset.step);
      if (step <= this._maxAccessibleStep()) {
        this.currentStep = step;
        this.render();
      }
    };
  }

  _maxAccessibleStep() {
    // Any step up to current or already-completed steps
    return this.currentStep;
  }

  // ── Auto-save ──────────────────────────────
  _autoSave() {
    const d = Object.assign({}, this.data, { _currentStep: this.currentStep });
    SamsonStorage.saveDraft(d);
  }

  // ── Main render ────────────────────────────
  render() {
    this._renderHeader();
    this._renderContent();
    this._renderFooter();
    this._renderCameraModal();
    this._renderCropperModal();
    this._autoSave();
  }

  _renderHeader() {
    document.getElementById('appTitle').textContent = this.t('appTitle');
    document.getElementById('appSubtitle').textContent = this.t('appSubtitle');
    document.getElementById('langToggle').textContent = I18n.t('langSwitch');

    const dots = document.getElementById('stepIndicators');
    dots.innerHTML = '';
    for (let i = 1; i <= this.totalSteps; i++) {
      const cls = i === this.currentStep ? 'active' : (i < this.currentStep ? 'done' : '');
      dots.innerHTML += `<div class="step-dot ${cls}" data-step="${i}">
        <span>${i}</span><small>${this.t('step' + i)}</small></div>`;
    }
  }

  _renderContent() {
    const c = document.getElementById('mainContent');
    c.innerHTML = '';
    switch (this.currentStep) {
      case 1: this._renderStep1(c); break;
      case 2: this._renderStep2(c); break;
      case 3: this._renderStep3_appearance(c); break;
      case 4: this._renderStep4(c); break;
      case 5: this._renderStep5_appearancePhotos(c); break;
      case 6: this._renderStep6(c); break;
      case 7: this._renderStep7(c); break;
      case 8: this._renderStep8(c); break;
    }
  }

  _renderFooter() {
    const f = document.getElementById('stepFooter');
    f.innerHTML = '';

    const backBtn = document.createElement('button');
    backBtn.className = 'btn btn-outline';
    backBtn.textContent = this.t('back');
    backBtn.onclick = () => { if (this.currentStep > 1) { this.currentStep--; this.render(); } };
    if (this.currentStep <= 1) backBtn.style.visibility = 'hidden';
    f.appendChild(backBtn);

    if (this.currentStep < this.totalSteps) {
      const skipBtn = document.createElement('button');
      skipBtn.className = 'btn btn-ghost';
      skipBtn.textContent = this.t('skip');
      skipBtn.onclick = () => { this.currentStep++; this.render(); };

      f.appendChild(skipBtn);
    }

    if (this.currentStep < this.totalSteps) {
      const nextBtn = document.createElement('button');
      nextBtn.className = 'btn btn-primary';
      nextBtn.textContent = this.t('next');
      nextBtn.onclick = () => this._nextStep();
      f.appendChild(nextBtn);
    }
  }

  _nextStep() {
    console.log("_nextStep called, currentStep:", this.currentStep);
    try {
      this._doNextStep();
    } catch(e) {
      this._showToast("Error: " + (e.message || e), "error");
    }
  }

  _doNextStep() {
    console.log("_doNextStep called, step:", this.currentStep);
    if (!this._validateStep()) return;
    if (this.currentStep === 1) this._saveInputHistory();
    // Step 7→8: check for missing photos
    if (this.currentStep === 7) {
      var missing = this._collectMissingPhotos();
      if (missing.length > 0) {
        this._showMissingWarning(missing, () => {
          this.currentStep++;
          this.render();
        });
        return;
      }
    }
    if (this.currentStep < this.totalSteps) {
      this.currentStep++;
      this.render();
    }
  }

  _collectMissingPhotos() {
    var missing = [];
    // Valve photos
    var vks = ['frontView','rightView','leftView','rearView','valveNameplate','tagNameplate','actuatorNameplate'];
    vks.forEach((k) => { if (!this.data.valvePhotos[k]) missing.push(this.t(k)); });
    // Appearance photos
    var app = this._getAllAppearanceItems();
    app.forEach((a) => {
      var p = this._getAppearancePhoto(a.accKey, a.idx, a.type);
      if (!p) missing.push(a.label);
    });
    // Accessory photos
    var acc = this._getAllAccessoryItems();
    acc.forEach((a) => {
      var p = this._getAccessoryPhoto(a.accKey, a.idx, a.type);
      if (!p) missing.push(a.label);
    });
    return missing;
  }

  _showMissingWarning(missing, onContinue) {
    var isZh = I18n.lang === 'zh';
    var msg = isZh
      ? '以下 ' + missing.length + ' 个项目缺少照片：'
      : 'The following ' + missing.length + ' items are missing photos:';
    var list = missing.map(function(m) { return '• ' + m; }).join('\n');
    var confirmMsg = isZh
      ? msg + '\n\n' + list + '\n\n确定继续生成报告吗？（缺失项不会出现在报告中）'
      : msg + '\n\n' + list + '\n\nContinue generating report? (Missing items will be omitted)';
    if (confirm(confirmMsg)) {
      onContinue();
    }
  }

  _validateStep() {
    if (this.currentStep === 1) {
      const d = this._readStep1Form();
      console.log("_validateStep d:", d);
      if (!d.contractNo.trim() || !d.serialNo.trim()) {
        this._showToast(this.t("missingFields") + ": " + this.t("contractNo") + " + " + this.t("serialNo"), "error");
        return false;
      }
    }
    return true;
  }

  _saveInputHistory() {
    ['contractNo','ifsNo','positionNo','tagNo','serialNo','valveType','recorder'].forEach(f => {
      SamsonStorage.addInputValue(f, this.data[f] || '');
    });
  }

  // ═══════════════════════════════════════════
  // STEP 1 — Project Info
  // ═══════════════════════════════════════════
  _renderStep1(c) {
    const history = SamsonStorage.loadInputHistory();
    const fields = [
      { key: 'contractNo',   label: this.t('contractNo'),   required: true, scan: true },
      { key: 'positionNo',   label: this.t('positionNo'),   required: true, scan: true },
      { key: 'tagNo',        label: this.t('tagNo'),        required: true },
      { key: 'serialNo',     label: this.t('serialNo'),     required: false },
      { key: 'valveType',    label: this.t('valveType'),    required: true },
      { key: 'recorder',     label: this.t('recorder'),     required: true },
    ];

    let html = '<div class="step1-form">';

    fields.forEach((f, idx) => {
      const val = this.data[f.key] || '';
      html += '<div class="form-group"><label>' + f.label + (f.required ? ' <span class="required">*</span>' : '') + '</label>';

      const histVals = (history[f.key] || []).slice(0, 5);
      if (histVals.length > 0) {
        html += '<input type="text" id="input_' + f.key + '" value="' + this._esc(val) + '" list="datalist_' + f.key + '" autocomplete="off" />';
        try {
        html += '<datalist id="datalist_' + f.key + '">' + histVals.filter(function(v){ return typeof v==='string' && v.length<200; }).map(function(v) { return '<option value="' + this._esc(v) + '">'; }.bind(this)).join('') + '</datalist>';
      } catch(e) {}
      } else {
        html += '<input type="text" id="input_' + f.key + '" value="' + this._esc(val) + '" autocomplete="off" />';
      }
      if (f.hint) html += '<span class="hint">' + f.hint + '</span>';
      html += '</div>';

      // Insert scan button after contractNo (index 0) and positionNo (index 1)
      if (f.scan) {
        html += '<div class="scan-bar"><button class="btn-scan-field" data-field="' + f.key + '">📷 ' + this.t('scanBarcode') + ': ' + f.label + '</button></div>';
      }
    });
    html += '</div>';
    c.innerHTML = html;

    // Real-time saving: update this.data on every keystroke
    var self = this;
    ["contractNo","positionNo","tagNo","serialNo","valveType","recorder"].forEach((k) => {
      var inp = document.getElementById('input_' + k);
      if (inp) inp.oninput = function() {
        self.data[k] = this.value;
        self._autoSave();
      };
    });

    // Bind barcode scan

    // Highlight datalist entries as clickable for mobile
    fields.forEach((f) => {
      var inp = document.getElementById('input_' + f.key);
      if (inp) inp.onfocus = function() { inp.select(); };
    });
  }


  _readStep1Form() {
    const d = {};
    ['contractNo','positionNo','tagNo','serialNo','valveType','recorder'].forEach(k => {
      const el = document.getElementById('input_' + k);
      d[k] = el ? el.value.trim() : (this.data[k] || '');
      this.data[k] = d[k];
    });
    return d;
  }

  // ── Barcode scanner ────────────────────────
  _openScanner() {
    document.getElementById('cancelScan').textContent = this.t('cancelScan');
    const modal = document.getElementById('scannerModal');
    modal.style.display = 'flex';
    modal.querySelector('h3').textContent = this.t('scanBarcode');
    const reader = document.getElementById('scannerReader');
    reader.innerHTML = `<p>${this.t('scanTip')}</p>`;

    // Try BarcodeDetector API first (Chrome 83+)
    if ('BarcodeDetector' in window) {
      this._startBarcodeAPI();
    } else {
      reader.innerHTML += `<p style="margin-top:16px;"><button class="btn btn-primary" id="btnScanFallback">
        📷 ${I18n.lang === 'zh' ? '打开相机扫描' : 'Open Camera to Scan'}</button></p>`;
    }

    document.getElementById('cancelScan').onclick = () => {
      this._stopScanner();
      modal.style.display = 'none';
    };
  }

  _startBarcodeAPI() {
    const video = document.createElement('video');
    video.id = 'scannerVideo';
    video.autoplay = true;
    video.playsInline = true;
    video.style.cssText = 'width:100%;max-width:320px;border-radius:8px;';
    const reader = document.getElementById('scannerReader');
    reader.appendChild(video);

    const detector = new BarcodeDetector({ formats: ['qr_code','ean_13','ean_8','code_128','code_39','upc_a','upc_e'] });
    let scanning = true;

    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }).then(stream => {
      video.srcObject = stream;
      this._scannerStream = stream;

      const scan = async () => {
        if (!scanning) return;
        try {
          const barcodes = await detector.detect(video);
          if (barcodes.length > 0) {
            this._parseBarcode(barcodes[0].rawValue);
            scanning = false;
            this._stopScanner();
            document.getElementById('scannerModal').style.display = 'none';
            return;
          }
        } catch (e) {}
        if (scanning) requestAnimationFrame(scan);
      };
      scan();
    }).catch(() => {
      document.getElementById('scannerReader').innerHTML =
        `<p style="color:red;">${I18n.lang === 'zh' ? '无法访问相机，请检查权限或使用相册扫码' : 'Cannot access camera. Check permissions.'}</p>`;
    });
  }

  _scanFallback() {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'image/*';
    inp.capture = 'environment';
    inp.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      // Use basic image-based barcode detection or just show the image
      // For now, we just capture and try to read with BarcodeDetector
      const img = new Image();
      img.src = URL.createObjectURL(file);
      img.onload = () => {
        if ('BarcodeDetector' in window) {
          const detector = new BarcodeDetector({ formats: ['qr_code','ean_13','ean_8','code_128','code_39','upc_a','upc_e'] });
          detector.detect(img).then(barcodes => {
            if (barcodes.length > 0) {
              this._parseBarcode(barcodes[0].rawValue);
              document.getElementById('scannerModal').style.display = 'none';
            } else {
              alert(I18n.lang === 'zh' ? '未识别到条形码，请重试' : 'No barcode detected, please retry');
            }
          }).catch(() => alert('Scan failed'));
        } else {
          alert(I18n.lang === 'zh' ? '浏览器不支持扫码功能' : 'Browser does not support barcode scanning');
        }
      };
    };
    inp.click();
  }

  _parseBarcode(rawValue) {
    // Fill the targeted field (set by scan button data-field attr)
    var targetField = this._scanTargetField;
    this._scanTargetField = null;

    // Try to parse as pipe-separated or newline-separated key-value pairs
    try {
      var pairs = rawValue.split(/[|\n]/);
      var map = {};
      pairs.forEach(function(p) {
        var parts = p.split(/[=:]/);
        if (parts[0] && parts[1]) map[parts[0].trim().toUpperCase()] = parts[1].trim();
      });

      var keyMap = {
        'CONTRACT': 'contractNo', 'IFS': 'contractNo', 'CONTRACTNO': 'contractNo',
        'POSITION': 'positionNo', 'POS': 'positionNo',
        'TAG': 'tagNo', 'TAGNO': 'tagNo',
        'SERIAL': 'serialNo', 'SN': 'serialNo', 'SERIALNO': 'serialNo',
        'TYPE': 'valveType', 'MODEL': 'valveType'
      };

      if (targetField && Object.keys(map).length === 0) {
        // Single value scanned, fill target field
        this.data[targetField] = rawValue.trim();
      } else {
        Object.keys(map).forEach((k) => {
          var field = keyMap[k] || keyMap[k.replace(/[^A-Z]/g, '')];
          if (field && targetField) {
            // Only fill if field matches target
            if (field === targetField) this.data[field] = map[k];
          } else if (field) {
            this.data[field] = map[k];
          }
        });
      }
    } catch(e) {
      if (targetField) this.data[targetField] = rawValue.trim();
    }
    this.render();
  }

  _stopScanner() {
    if (this._scannerStream) {
      this._scannerStream.getTracks().forEach(t => t.stop());
      this._scannerStream = null;
    }
  }

  // ═══════════════════════════════════════════
  // STEP 2 — Accessories
  // ═══════════════════════════════════════════
  _renderStep2(c) {
    const acc = this.data.accessories;
    const defaultItems = [
      { key: 'positioner',      label: this.t('positioner'),      selected: acc.positioner.selected,      qty: acc.positioner.qty },
      { key: 'filterRegulator', label: this.t('filterRegulator'), selected: acc.filterRegulator.selected, qty: acc.filterRegulator.qty },
    ];
    const optItems = [
      { key: 'solenoidValve',   label: this.t('solenoidValve'),    selected: acc.solenoidValve.selected,   qty: acc.solenoidValve.qty },
      { key: 'volumeBooster',   label: this.t('volumeBooster'),    selected: acc.volumeBooster.selected,   qty: acc.volumeBooster.qty },
      { key: 'quickExhaust',    label: this.t('quickExhaustValve'),selected: acc.quickExhaust.selected,    qty: acc.quickExhaust.qty },
      { key: 'limitSwitch',     label: this.t('limitSwitch'),      selected: acc.limitSwitch.selected,     qty: acc.limitSwitch.qty },
    ];

    let html = '<div class="step2-form">';
    html += `<h3 class="section-title">${this.t('accessoriesDefault')}</h3>`;
    html += this._accItemGroup(defaultItems);

    html += `<h3 class="section-title">${this.t('accessoriesOptional')}</h3>`;
    html += this._accItemGroup(optItems);

    // Others (dynamic)
    html += '<div class="others-group" id="othersGroup">';
    html += `<h4>${this.t('otherAccessory')}</h4>`;
    (acc.others || []).forEach((o, i) => {
      html += `<div class="other-row" data-idx="${i}">
        <input type="text" class="other-name" value="${this._esc(o.name||'')}" placeholder="${this.t('otherNamePlaceholder')}" />
        <div class="qty-stepper">
          <button class="qty-minus btn-icon">−</button>
          <span class="qty-val">${o.qty||1}</span>
          <button class="qty-plus btn-icon">+</button>
        </div>
        <button class="btn-icon btn-del-other" data-idx="${i}">✕</button></div>`;
    });
    html += `<button class="btn btn-sm" id="btnAddOther">+ ${this.t('otherAccessory')}</button>`;
    html += '</div>';

    // Cleanliness requirement label (with quantity stepper)
    html += `<div class="acc-item" data-key="cleaningLabel">
      <label class="acc-label">
        <input type="checkbox" class="acc-chk" ${acc.cleaningLabel ? 'checked' : ''} />
        <span>${this.t('cleaningLabel')}</span>
      </label>
      <div class="qty-stepper"${acc.cleaningLabel ? '' : ' style="display:none"'}>
        <button class="qty-minus btn-icon">−</button>
        <span class="qty-val">1</span>
        <button class="qty-plus btn-icon">+</button>
      </div>
    </div>`;

    html += '</div>';
    c.innerHTML = html;

    // Bindings
    c.querySelectorAll('.acc-item').forEach(el => {
      const key = el.dataset.key;
      const chk = el.querySelector('.acc-chk');
      const stepper = el.querySelector('.qty-stepper');
      const valSpan = el.querySelector('.qty-val');
      chk.onchange = () => {
        this.data.accessories[key].selected = chk.checked;
        stepper.style.display = chk.checked ? 'flex' : 'none';
        this._autoSave();
      };
      el.querySelector('.qty-plus').onclick = () => {
        const a = this.data.accessories[key];
        if (a.qty < 10) { a.qty++; valSpan.textContent = a.qty; this._autoSave(); }
      };
      el.querySelector('.qty-minus').onclick = () => {
        const a = this.data.accessories[key];
        if (a.qty > 1) {
          a.qty--;
          valSpan.textContent = a.qty;
          this._autoSave();
        } else {
          a.selected = false;
          a.qty = 1;
          chk.checked = false;
          stepper.style.display = 'none';
          valSpan.textContent = '1';
          this._autoSave();
        }
      };
    });

    document.getElementById('btnAddOther').onclick = () => {
      if (!this.data.accessories.others) this.data.accessories.others = [];
      this.data.accessories.others.push({ name: '', qty: 1 });
      this._renderStep2(c);
    };

    c.querySelectorAll('.btn-del-other').forEach(btn => {
      btn.onclick = () => {
        const idx = parseInt(btn.dataset.idx);
        this.data.accessories.others.splice(idx, 1);
        this._renderStep2(c);
      };
    });

    // Cleanliness label stepper & checkbox
    var cleanRow = c.querySelector('[data-key="cleaningLabel"]');
    if (cleanRow) {
      var cleanChk = cleanRow.querySelector('.acc-chk');
      var cleanStepper = cleanRow.querySelector('.qty-stepper');
      var cleanVal = cleanRow.querySelector('.qty-val');
      cleanChk.onchange = function() {
        this.data.accessories.cleaningLabel = cleanChk.checked;
        cleanStepper.style.display = cleanChk.checked ? 'flex' : 'none';
        if (!cleanChk.checked) this.data.accessories.cleaningQty = 1;
        this._autoSave();
      }.bind(this);
      cleanRow.querySelector('.qty-plus').onclick = function() {
        var q = this.data.accessories.cleaningQty || 1;
        if (q < 10) { this.data.accessories.cleaningQty = q + 1; cleanVal.textContent = q + 1; this._autoSave(); }
      }.bind(this);
      cleanRow.querySelector('.qty-minus').onclick = function() {
        var q = this.data.accessories.cleaningQty || 1;
        if (q > 1) { this.data.accessories.cleaningQty = q - 1; cleanVal.textContent = q - 1; this._autoSave(); }
        else { cleanChk.checked = false; this.data.accessories.cleaningLabel = false; cleanStepper.style.display = 'none'; this._autoSave(); }
      }.bind(this);
    }

    // Read others on change
    // Stepper bindings for other accessory rows
    c.querySelectorAll('.other-row').forEach(row => {
      const valSpan = row.querySelector('.qty-val');
      const idx = parseInt(row.dataset.idx);
      const plusBtn = row.querySelector('.qty-plus');
      const minusBtn = row.querySelector('.qty-minus');
      if (plusBtn) plusBtn.onclick = () => {
        const o = this.data.accessories.others[idx];
        if (o && o.qty < 10) { o.qty++; valSpan.textContent = o.qty; this._autoSave(); }
      };
      if (minusBtn) minusBtn.onclick = () => {
        const o = this.data.accessories.others[idx];
        if (o && o.qty > 1) { o.qty--; valSpan.textContent = o.qty; this._autoSave(); }
      };
    });
    c.querySelectorAll('.other-name').forEach(el => {
      el.onchange = () => this._readStep2Others();
    });
  }

  _accItemGroup(items) {
    return items.map(it => `
      <div class="acc-item" data-key="${it.key}">
        <label class="acc-label">
          <input type="checkbox" class="acc-chk" ${it.selected ? 'checked' : ''} />
          <span>${it.label}</span>
        </label>
        <div class="qty-stepper"${it.selected ? '' : ' style="display:none"'}>
          <button class="qty-minus btn-icon">−</button>
          <span class="qty-val">${it.qty}</span>
          <button class="qty-plus btn-icon">+</button>
        </div>
      </div>`).join('');
  }

  _readStep2Others() {
    const rows = document.querySelectorAll('.other-row');
    const others = [];
    rows.forEach(row => {
      const nameEl = row.querySelector('.other-name');
      const qtyEl = row.querySelector('.qty-val');
      if (nameEl && qtyEl) {
        others.push({ name: nameEl.value.trim(), qty: parseInt(qtyEl.textContent) || 1 });
      }
    });
    this.data.accessories.others = others;
    this._autoSave();
  }

  // ═══════════════════════════════════════════
  // STEP 3 — Valve Photos
  // ═══════════════════════════════════════════
  _renderStep3_appearance(c) {
    var app = this.data.appearance;
    var items = [
      { key: 'flowDirection',      label: this.t('flowDirection'),      selected: app.flowDirection,      subs: null },
      { key: 'pressureGauge',      label: this.t('pressureGauge'),      selected: app.pressureGauge,      subs: null },
      { key: 'flangeWaterline',    label: this.t('flangeWaterline'),    selected: app.flangeWaterline,    subs: [this.t('flangeLeft'), this.t('flangeRight')], subCount: 2 },
      { key: 'internalCleanliness',label: this.t('internalCleanliness'),selected: app.internalCleanliness,subs: [this.t('inlet'), this.t('outlet')], subCount: 2 },
    ];
    var html = '<h3 class="section-title">' + this.t('appearanceTitle') + '</h3><div class="step2-form">';
    items.forEach((it) => {
      html += '<div class="acc-item" data-key="' + it.key + '">';
      html += '<label class="acc-label"><input type="checkbox" class="app-chk" ' + (it.selected ? 'checked' : '') + ' /><span>' + it.label + '</span>';
      if (it.subs) html += '<span class="chk-sub-hint">（' + (I18n.lang==='zh'?'需拍':'Need') + ' ' + it.subCount + ' ' + (I18n.lang==='zh'?'张':'photos') + '）</span>';
      html += '</label>';
      if (it.subs) {
        html += '<div class="chk-subs" style="' + (it.selected ? '' : 'display:none') + '">';
        it.subs.forEach(function(s) { html += '<span class="chk-sub-tag">' + s + '</span>'; });
        html += '</div>';
      }
      html += '</div>';
    });
    html += '<h4 style="margin-top:12px">' + this.t('otherAppearance') + '</h4>';
    (app.otherAppearance || []).forEach(function(o, i) {
      html += '<div class="other-row" data-idx="' + i + '"><input type="text" class="other-name" value="' + this._esc(o.name||'') + '" placeholder="..."><button class="btn-icon btn-del-other" data-idx="' + i + '">✕</button></div>';
    }.bind(this));
    html += '<button class="btn btn-sm" id="btnAddAppOther">+ ' + this.t('otherAppearance') + '</button></div>';
    c.innerHTML = html;
    var self = this;
    c.querySelectorAll('.app-chk').forEach(function(chk) {
      var item = chk.closest('.acc-item');
      var key = item.dataset.key;
      chk.onchange = function() {
        self.data.appearance[key] = chk.checked;
        var subs = item.querySelector('.chk-subs');
        if (subs) subs.style.display = chk.checked ? '' : 'none';
        item.classList.toggle('checked', chk.checked);
        self._autoSave();
      };
      // Set initial checked state
      item.classList.toggle('checked', chk.checked);
    });
    var addBtn = document.getElementById('btnAddAppOther');
    if (addBtn) addBtn.onclick = function() { if (!self.data.appearance.otherAppearance) self.data.appearance.otherAppearance = []; self.data.appearance.otherAppearance.push({ name: '' }); self.render(); };
    c.querySelectorAll('.btn-del-other').forEach(function(btn) {
      btn.onclick = function() { var i = parseInt(btn.dataset.idx); self.data.appearance.otherAppearance.splice(i, 1); self.render(); };
    });
    c.querySelectorAll('.other-name').forEach(function(el) {
      el.onchange = function() {
        var rows = document.querySelectorAll('.other-row'), others = [];
        rows.forEach(function(r) { var n = r.querySelector('.other-name'); if (n && n.value.trim()) others.push({ name: n.value.trim() }); });
        self.data.appearance.otherAppearance = others; self._autoSave();
      };
    });
  }



  _renderStep4(c) {
    const views = [
      { key: 'frontView',    label: this.t('frontView'),    orientation: 'portrait',  crop: false },
      { key: 'rightView',    label: this.t('rightView'),    orientation: 'portrait',  crop: false },
      { key: 'leftView',     label: this.t('leftView'),     orientation: 'portrait',  crop: false },
      { key: 'rearView',     label: this.t('rearView'),     orientation: 'portrait',  crop: false },
      { key: 'valveNameplate',     label: this.t('valveNameplate'),     orientation: 'landscape', crop: true },
      { key: 'tagNameplate',       label: this.t('tagNameplate'),       orientation: 'landscape', crop: true },
      { key: 'actuatorNameplate',  label: this.t('actuatorNameplate'),  orientation: 'landscape', crop: true },
    ];

    let html = `<h3 class="section-title">${this.t('valvePhotosTitle')}</h3>`;
    html += '<div class="photo-grid">';
    views.forEach(v => {
      const hasPhoto = !!this.data.valvePhotos[v.key];
      html += `<div class="photo-slot" data-key="${v.key}" data-crop="${v.crop}" data-orientation="${v.orientation}">
        <div class="photo-preview">${hasPhoto
          ? `<img src="${this.data.valvePhotos[v.key]}" alt="" />`
          : `<div class="photo-placeholder">
              <span class="orient-icon">${v.orientation === 'portrait' ? '📱' : '↔️'}</span>
              <small>${v.orientation === 'portrait' ? this.t('portrait') : this.t('landscape')}</small>
            </div>`}
        </div>
        <div class="photo-label">${v.label}</div>
        <div class="photo-actions">
          ${hasPhoto ? `<button class="btn btn-sm btn-retake">${this.t('retake')}</button>` : ''}
          ${hasPhoto && v.crop ? `<button class="btn btn-sm btn-crop">${this.t('crop')}</button>` : ''}
          <button class="btn btn-sm btn-capture">${hasPhoto ? this.t('retake') : this.t('tapToCapture')}</button>
        </div>
      </div>`;
    });
    html += '</div>';
    c.innerHTML = html;

    // Bind capture buttons
    c.querySelectorAll('.btn-capture').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const slot = btn.closest('.photo-slot');
        this._capturePhoto(slot.dataset.key, slot.dataset.orientation, !!JSON.parse(slot.dataset.crop));
      };
    });

    // Bind retake
    c.querySelectorAll('.btn-retake').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const slot = btn.closest('.photo-slot');
        this._capturePhoto(slot.dataset.key, slot.dataset.orientation, !!JSON.parse(slot.dataset.crop));
      };
    });

    // Bind crop
    c.querySelectorAll('.btn-crop').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const slot = btn.closest('.photo-slot');
        this._openCropper(slot.dataset.key, 'valve');
      };
    });
  }

  // ═══════════════════════════════════════════
  // Shared: Capture photo
  // ═══════════════════════════════════════════
  _capturePhoto(key, orientation, needsCrop) {
    var t = { key: key, orientation: orientation, needsCrop: needsCrop };
    // Parse key to extract accKey, idx, type for app_ and acc_ prefixes
    if (key.startsWith('app_')) {
      var pa = key.split('_');
      t.type = pa.pop();
      t.idx = parseInt(pa.pop()) || 0;
      t.accKey = pa.slice(1).join('_');
    } else if (key.startsWith('acc_')) {
      var pa2 = key.split('_');
      t.type = pa2.pop();
      t.idx = parseInt(pa2.pop()) || 0;
      t.accKey = pa2.slice(1).join('_');
    }
    this._captureTarget = t;
    const modal = document.getElementById('cameraModal');
    modal.style.display = 'flex';
    document.getElementById('camOrientation').textContent =
      orientation === 'portrait' ? this.t('portrait') : this.t('landscape');
    document.querySelector('#cameraModal .cam-hint').textContent = orientation === 'portrait' ? '请保持手机竖直拍摄' : '请将手机横置拍摄';
  }

  // ── Camera modal bindings (done once) ──────
  _renderCameraModal() {
    if (this._cameraBound) return;
    this._cameraBound = true;
    document.querySelector('#btnTakePhoto .cam-btn-label').textContent = this.t('takePhoto');
    document.querySelector('#btnFromGallery .gal-btn-label').textContent = this.t('fromGallery');
    document.getElementById('cancelCapture').textContent = this.t('cancel');

    document.getElementById('btnTakePhoto').onclick = () => {
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = 'image/*';
      inp.capture = 'environment';
      inp.onchange = (e) => {
        if (e.target.files[0]) this._handlePhotoFile(e.target.files[0]);
      };
      inp.click();
    };

    document.getElementById('btnFromGallery').onclick = () => {
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = 'image/*';
      inp.onchange = (e) => {
        if (e.target.files[0]) this._handlePhotoFile(e.target.files[0]);
      };
      inp.click();
    };

    document.getElementById('cancelCapture').onclick = () => {
      document.getElementById('cameraModal').style.display = 'none';
      this._captureTarget = null;
    };
  }

  _handlePhotoFile(file) {
    var self = this;
    var reader = new FileReader();
    reader.onload = function(e) {
      self._compressImage(e.target.result, 1200, 0.85, function(compressed) {
      const t = self._captureTarget;
      document.getElementById('cameraModal').style.display = 'none';

      // Determine storage target
      if (t.key.startsWith('app_')) {
        // Appearance photo
        if (!self.data.appearancePhotos[t.accKey]) self.data.appearancePhotos[t.accKey] = [];
        if (!self.data.appearancePhotos[t.accKey][t.idx]) self.data.appearancePhotos[t.accKey][t.idx] = {};
        self.data.appearancePhotos[t.accKey][t.idx][t.type] = compressed;
      } else if (t.key.startsWith('acc_')) {
        // Accessory photo — key format: acc_<accKey>_<idx>_<type> (accKey may contain _)
        // Use t.accKey, t.idx, t.type from parsed target
        var accKey = t.accKey || t.key.split('_').slice(1, -2).join('_');
        var idx = t.idx !== undefined ? t.idx : 0;
        var ptype = t.type || t.key.split('_').pop();
        if (!self.data.accessoryPhotos[accKey]) self.data.accessoryPhotos[accKey] = [];
        if (!self.data.accessoryPhotos[accKey][idx]) self.data.accessoryPhotos[accKey][idx] = {};
        self.data.accessoryPhotos[accKey][idx][ptype] = compressed;
      } else {
        self.data.valvePhotos[t.key] = compressed;
      }

      self._autoSave();

      // If needs crop, open cropper; otherwise render
      if (t.needsCrop && self._captureTarget) {
        const cropKey = t.key.startsWith('acc_') ? t.key : t.key;
        const category = t.key.startsWith('acc_') ? 'accessory' : 'valve';
        self._openCropper(cropKey, category);
      } else {
        self._captureTarget = null;
        self.render();
      }
      });
    };
    reader.readAsDataURL(file);
  }

  _compressImage(dataURL, maxDim, quality, callback) {
    var img = new Image();
    img.onload = function() {
      var w = img.width, h = img.height;
      if (w <= maxDim && h <= maxDim) { callback(dataURL); return; }
      var scale = maxDim / Math.max(w, h);
      var cw = Math.round(w * scale), ch = Math.round(h * scale);
      var canvas = document.createElement('canvas');
      canvas.width = cw; canvas.height = ch;
      var ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, cw, ch);
      callback(canvas.toDataURL('image/jpeg', quality));
    };
    img.src = dataURL;
  }

  // ═══════════════════════════════════════════
  // CROPPER — Simple touch-friendly cropper
  // ═══════════════════════════════════════════
  _renderCropperModal() {
    if (this._cropperBound) return;
    this._cropperBound = true;
    document.getElementById('doneCrop').textContent = this.t('doneCrop');
    document.getElementById('cancelCropBtn').textContent = this.t('cancelCrop');

    this._cropState = { x: 0, y: 0, w: 0, h: 0, dragging: false, resizing: false, handle: null, startX: 0, startY: 0 };

    const canvas = document.getElementById('cropCanvas');
    const ctx = canvas.getContext('2d');

    const redraw = () => {
      if (!this._cropImg) return;
      canvas.width = canvas.parentElement.clientWidth;
      canvas.height = Math.min(canvas.parentElement.clientHeight, window.innerHeight * 0.6);

      const s = this._cropState;
      if (!s.w) { s.w = canvas.width * 0.6; s.h = s.w * 0.35; s.x = (canvas.width - s.w) / 2; s.y = (canvas.height - s.h) / 2; }

      // Draw image
      const imgRatio = this._cropImg.width / this._cropImg.height;
      const canvasRatio = canvas.width / canvas.height;
      let dw, dh;
      if (imgRatio > canvasRatio) { dw = canvas.width; dh = dw / imgRatio; }
      else { dh = canvas.height; dw = dh * imgRatio; }
      const dx = (canvas.width - dw) / 2, dy = (canvas.height - dh) / 2;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(this._cropImg, dx, dy, dw, dh);

      // Darken outside crop area
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(0, 0, canvas.width, s.y);
      ctx.fillRect(0, s.y + s.h, canvas.width, canvas.height - s.y - s.h);
      ctx.fillRect(0, s.y, s.x, s.h);
      ctx.fillRect(s.x + s.w, s.y, canvas.width - s.x - s.w, s.h);

      // Crop border
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 3]);
      ctx.strokeRect(s.x, s.y, s.w, s.h);
      ctx.setLineDash([]);
    };

    // Touch/mouse handlers
    const getPos = (e) => {
      const rect = canvas.getBoundingClientRect();
      const touch = e.touches ? e.touches[0] : e;
      return { x: touch.clientX - rect.left, y: touch.clientY - rect.top };
    };

    canvas.onpointerdown = (e) => {
      if (!this._cropImg) return;
      const pos = getPos(e);
      const s = this._cropState;
      const margin = 20;
      if (pos.x > s.x - margin && pos.x < s.x + margin && pos.y > s.y - margin && pos.y < s.y + margin) {
        this._cropState.resizing = true; this._cropState.handle = 'tl';
      } else if (pos.x > s.x + s.w - margin && pos.x < s.x + s.w + margin && pos.y > s.y - margin && pos.y < s.y + margin) {
        this._cropState.resizing = true; this._cropState.handle = 'tr';
      } else if (pos.x > s.x - margin && pos.x < s.x + margin && pos.y > s.y + s.h - margin && pos.y < s.y + s.h + margin) {
        this._cropState.resizing = true; this._cropState.handle = 'bl';
      } else if (pos.x > s.x + s.w - margin && pos.x < s.x + s.w + margin && pos.y > s.y + s.h - margin && pos.y < s.y + s.h + margin) {
        this._cropState.resizing = true; this._cropState.handle = 'br';
      } else if (pos.x > s.x && pos.x < s.x + s.w && pos.y > s.y && pos.y < s.y + s.h) {
        this._cropState.dragging = true;
      }
      this._cropState.startX = pos.x; this._cropState.startY = pos.y;
      this._cropState.startW = s.w; this._cropState.startH = s.h;
      this._cropState.startSX = s.x; this._cropState.startSY = s.y;
      canvas.setPointerCapture(e.pointerId);
    };

    canvas.onpointermove = (e) => {
      if (!this._cropImg) return;
      const s = this._cropState;
      const pos = getPos(e);
      if (s.dragging) {
        s.x = Math.max(0, Math.min(canvas.width - s.w, s.startSX + pos.x - s.startX));
        s.y = Math.max(0, Math.min(canvas.height - s.h, s.startSY + pos.y - s.startY));
      } else if (s.resizing) {
        const dx = pos.x - s.startX, dy = pos.y - s.startY;
        let nw = s.startW, nh = s.startH, nx = s.startSX, ny = s.startSY;
        if (s.handle.includes('r')) nw = Math.max(50, s.startW + dx);
        if (s.handle.includes('l')) { nw = Math.max(50, s.startW - dx); nx = s.startSX + dx; }
        if (s.handle.includes('b')) nh = Math.max(30, s.startH + dy);
        if (s.handle.includes('t')) { nh = Math.max(30, s.startH - dy); ny = s.startSY + dy; }
        s.w = Math.min(nw, canvas.width - nx);
        s.h = Math.min(nh, canvas.height - ny);
        s.x = Math.max(0, nx);
        s.y = Math.max(0, ny);
      }
      redraw();
    };

    canvas.onpointerup = () => {
      this._cropState.dragging = false;
      this._cropState.resizing = false;
      canvas.releasePointerCapture && canvas.releasePointerCapture();
    };

    document.getElementById('doneCrop').onclick = () => this._applyCrop(redraw);
    document.getElementById('cancelCropBtn').onclick = () => {
      document.getElementById('cropperModal').style.display = 'none';
      this._cropImg = null;
      this._cropTargetKey = null;
      this.render();
    };

    this._cropRedraw = redraw;
  }

  _openCropper(key, category) {
    const dataURL = category === 'valve'
      ? this.data.valvePhotos[key]
      : (() => {
          const parts = key.split('_');
          if (parts[0] === 'acc') {
            var ptype = parts.pop();
            var idx = parseInt(parts.pop()) || 0;
            var accKey = parts.slice(1).join('_');
            return this.data.accessoryPhotos[accKey]?.[idx]?.[ptype];
          }
          return null;
        })();

    if (!dataURL) return;
    this._cropTargetKey = key;
    this._cropTargetCategory = category;

    const img = new Image();
    img.onload = () => {
      this._cropImg = img;
      this._cropState = { x: 0, y: 0, w: 0, h: 0, dragging: false, resizing: false };
      document.getElementById('cropperModal').style.display = 'flex';
      setTimeout(() => this._cropRedraw(), 100);
    };
    img.src = dataURL;
  }

  _applyCrop(redraw) {
    if (!this._cropImg || !this._cropTargetKey) return;
    const canvas = document.getElementById('cropCanvas');
    const s = this._cropState;

    // Calculate image-to-canvas scale
    const imgRatio = this._cropImg.width / this._cropImg.height;
    const canvasRatio = canvas.width / canvas.height;
    let dw, dh, dx, dy;
    if (imgRatio > canvasRatio) { dw = canvas.width; dh = dw / imgRatio; dx = 0; dy = (canvas.height - dh) / 2; }
    else { dh = canvas.height; dw = dh * imgRatio; dx = (canvas.width - dw) / 2; dy = 0; }

    const scaleX = this._cropImg.width / dw;
    const scaleY = this._cropImg.height / dh;

    const sx = (s.x - dx) * scaleX;
    const sy = (s.y - dy) * scaleY;
    const sw = s.w * scaleX;
    const sh = s.h * scaleY;

    const outCanvas = document.createElement('canvas');
    outCanvas.width = sw;
    outCanvas.height = sh;
    const outCtx = outCanvas.getContext('2d');
    outCtx.drawImage(this._cropImg, Math.max(0, sx), Math.max(0, sy), sw, sh, 0, 0, sw, sh);

    const cropped = outCanvas.toDataURL('image/jpeg', 0.92);

    // Save back
    if (this._cropTargetCategory === 'valve') {
      this.data.valvePhotos[this._cropTargetKey] = cropped;
    } else {
      const parts = this._cropTargetKey.split('_');
      if (parts[0] === 'acc') {
        var ctype = parts.pop();
        var cidx = parseInt(parts.pop()) || 0;
        var ckey = parts.slice(1).join('_');
        if (!this.data.accessoryPhotos[ckey]) this.data.accessoryPhotos[ckey] = [];
        if (!this.data.accessoryPhotos[ckey][cidx]) this.data.accessoryPhotos[ckey][cidx] = {};
        this.data.accessoryPhotos[ckey][cidx][ctype] = cropped;
      }
    }

    document.getElementById('cropperModal').style.display = 'none';
    this._cropImg = null;
    this._cropTargetKey = null;
    this._captureTarget = null;
    this.render();
  }

  // ═══════════════════════════════════════════
  // STEP 4 — Accessory Photos
  // ═══════════════════════════════════════════
  _renderStep5_appearancePhotos(c) {
    var app = this.data.appearance, items = [];
    if (app.flowDirection) items.push({ key: 'app_flow_0_photo', label: this.t('flowDirection'), accKey: 'flow', idx: 0, type: 'photo', orientation: 'portrait' });
    if (app.pressureGauge) items.push({ key: 'app_press_0_photo', label: this.t('pressureGauge'), accKey: 'press', idx: 0, type: 'photo', orientation: 'portrait' });
    if (app.flangeWaterline) {
      items.push({ key: 'app_flange_0_photo', label: this.t('flangeWaterline') + ' - ' + this.t('flangeLeft'), accKey: 'flange', idx: 0, type: 'photo', orientation: 'portrait' });
      items.push({ key: 'app_flange_1_photo', label: this.t('flangeWaterline') + ' - ' + this.t('flangeRight'), accKey: 'flange', idx: 1, type: 'photo', orientation: 'portrait' });
    }
    if (app.internalCleanliness) {
      items.push({ key: 'app_clean_0_photo', label: this.t('internalCleanliness') + ' - ' + this.t('inlet'), accKey: 'clean', idx: 0, type: 'photo', orientation: 'portrait' });
      items.push({ key: 'app_clean_1_photo', label: this.t('internalCleanliness') + ' - ' + this.t('outlet'), accKey: 'clean', idx: 1, type: 'photo', orientation: 'portrait' });
    }
    (app.otherAppearance || []).forEach((o, i) => { if (o.name) items.push({ key: 'app_oth_' + i + '_0_photo', label: o.name, accKey: 'oth_' + i, idx: 0, type: 'photo', orientation: 'portrait' }); });
    if (!items.length) { c.innerHTML = '<p style="text-align:center;padding:40px;color:#999">' + (I18n.lang==='zh'?'未选择外观项目，已自动跳过':'No appearance items selected, skipped.') + '</p>'; setTimeout(() => { if (this.currentStep === 5) { this.currentStep++; this.render(); } }, 600); return; }
    var html = '<h3 class="section-title">' + this.t('previewAppearance') + '</h3><div class="photo-grid">';
    var self = this;
    items.forEach(function(item) {
      var p = self._getAppearancePhoto(item.accKey, item.idx, item.type), has = !!p;
      html += '<div class="photo-slot" data-key="' + item.key + '" data-crop="false" data-orientation="' + item.orientation + '">' +
        '<div class="photo-preview">' + (has ? '<img src="' + p + '">' : '<div class="photo-placeholder"><span class="orient-icon">📱</span></div>') + '</div>' +
        '<div class="photo-label">' + item.label + '</div><div class="photo-actions">' +
        (has ? '<button class="btn btn-sm btn-retake">' + self.t('retake') + '</button>' : '') +
        '<button class="btn btn-sm btn-capture">' + (has ? self.t('retake') : self.t('tapToCapture')) + '</button></div></div>';
    });
    html += '</div>'; c.innerHTML = html;
    c.querySelectorAll('.btn-capture,.btn-retake').forEach(function(b) { b.onclick = function(e) { e.stopPropagation(); var s = b.closest('.photo-slot'); self._capturePhoto(s.dataset.key, s.dataset.orientation, false); }; });
  }

  _getAppearancePhoto(accKey, idx, type) { var p = this.data.appearancePhotos[accKey]; return p && p[idx] ? p[idx][type] || null : null; }



  _renderStep6(c) {
    const acc = this.data.accessories;
    const items = [];

    // Collect all selected accessories
    const defs = [
      { key: 'positioner',      label: this.t('positioner'),      selected: acc.positioner.selected,      qty: acc.positioner.qty },
      { key: 'filterRegulator', label: this.t('filterRegulator'), selected: acc.filterRegulator.selected, qty: acc.filterRegulator.qty },
      { key: 'solenoidValve',   label: this.t('solenoidValve'),   selected: acc.solenoidValve.selected,   qty: acc.solenoidValve.qty },
      { key: 'volumeBooster',   label: this.t('volumeBooster'),   selected: acc.volumeBooster.selected,   qty: acc.volumeBooster.qty },
      { key: 'quickExhaust',    label: this.t('quickExhaustValve'),selected: acc.quickExhaust.selected,   qty: acc.quickExhaust.qty },
      { key: 'limitSwitch',     label: this.t('limitSwitch'),     selected: acc.limitSwitch.selected,     qty: acc.limitSwitch.qty },
    ];

    defs.forEach(d => {
      if (d.selected) {
        for (let i = 0; i < d.qty; i++) {
          items.push({ key: `acc_${d.key}_${i}_photo`, label: `${d.label}${d.qty > 1 ? ' #' + (i + 1) : ''}`,
            accKey: d.key, idx: i, type: 'photo', crop: false, orientation: 'portrait' });
          items.push({ key: `acc_${d.key}_${i}_nameplate`, label: `${d.label}${d.qty > 1 ? ' #' + (i + 1) : ''} ${this.t('accessoryNameplate')}`,
            accKey: d.key, idx: i, type: 'nameplate', crop: true, orientation: 'landscape' });
        }
      }
    });

    (acc.others || []).forEach((o, oi) => {
      if (!o.name) return;
      for (let i = 0; i < (o.qty || 1); i++) {
        const label = `${o.name}${o.qty > 1 ? ' #' + (i + 1) : ''}`;
        const akey = `other_${oi}`;
        items.push({ key: `acc_${akey}_${i}_photo`, label,
          accKey: akey, idx: i, type: 'photo', crop: false, orientation: 'portrait' });
        items.push({ key: `acc_${akey}_${i}_nameplate`, label: `${label} ${this.t('accessoryNameplate')}`,
          accKey: akey, idx: i, type: 'nameplate', crop: true, orientation: 'landscape' });
      }
    });

    if (items.length === 0) {
      c.innerHTML = `<p style="text-align:center;padding:40px;color:#999;">${I18n.lang === 'zh' ? '未选择附件，已自动跳过' : 'No accessories selected, skipped.'}</p>`;
      setTimeout(() => { if (this.currentStep === 6) { this.currentStep++; this.render(); } }, 600);
      return;
    }

    let html = `<h3 class="section-title">${this.t('accessoryPhotosTitle')}</h3>`;
    html += '<div class="photo-grid">';

    items.forEach(item => {
      const photo = this._getAccessoryPhoto(item.accKey, item.idx, item.type);
      const hasPhoto = !!photo;
      html += `<div class="photo-slot" data-key="${item.key}" data-crop="${item.crop}" data-orientation="${item.orientation}">
        <div class="photo-preview">${hasPhoto
          ? `<img src="${photo}" alt="" />`
          : `<div class="photo-placeholder">
              <span class="orient-icon">${item.orientation === 'portrait' ? '📱' : '↔️'}</span>
              <small>${item.orientation === 'portrait' ? this.t('portrait') : this.t('landscape')}</small>
            </div>`}
        </div>
        <div class="photo-label">${item.label}</div>
        <div class="photo-actions">
          ${hasPhoto ? `<button class="btn btn-sm btn-retake">${this.t('retake')}</button>` : ''}
          ${hasPhoto && item.crop ? `<button class="btn btn-sm btn-crop">${this.t('crop')}</button>` : ''}
          <button class="btn btn-sm btn-capture">${hasPhoto ? this.t('retake') : this.t('tapToCapture')}</button>
        </div>
      </div>`;
    });
    html += '</div>';
    c.innerHTML = html;

    c.querySelectorAll('.btn-capture').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const slot = btn.closest('.photo-slot');
        this._capturePhoto(slot.dataset.key, slot.dataset.orientation, !!JSON.parse(slot.dataset.crop));
      };
    });

    c.querySelectorAll('.btn-retake').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const slot = btn.closest('.photo-slot');
        this._capturePhoto(slot.dataset.key, slot.dataset.orientation, !!JSON.parse(slot.dataset.crop));
      };
    });

    c.querySelectorAll('.btn-crop').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const slot = btn.closest('.photo-slot');
        const key = slot.dataset.key;
        // Parse key: acc_<accKey>_<idx>_<type>
        const parts = key.split('_');
        this._openCropper(key, 'accessory');
      };
    });
  }

  _getAccessoryPhoto(accKey, idx, type) {
    const photos = this.data.accessoryPhotos[accKey];
    if (!photos || !photos[idx]) return null;
    return photos[idx][type] || null;
  }

  // ═══════════════════════════════════════════
  // STEP 5 — Preview
  // ═══════════════════════════════════════════
  _renderStep7(c) {
    let html = `<h3 class="section-title">${this.t('previewTitle')}</h3>`;

    // Basic Info — at top
    html += `<div class="summary-card" style="margin-bottom:16px">
      <div><strong>${this.t('contractNo')}:</strong> ${this._esc(this.data.contractNo)}</div>
      <div><strong>${this.t('positionNo')}:</strong> ${this._esc(this.data.positionNo)}</div>
      <div><strong>${this.t('tagNo')}:</strong> ${this._esc(this.data.tagNo)}</div>
      <div><strong>${this.t('serialNo')}:</strong> ${this._esc(this.data.serialNo)}</div>
      <div><strong>${this.t('valveType')}:</strong> ${this._esc(this.data.valveType)}</div>
      <div><strong>${this.t('recorder')}:</strong> ${this._esc(this.data.recorder)}</div>
    </div>`;

    // Valve photos
    html += `<h4>${this.t('previewValvePhotos')}</h4><div class="preview-grid">`;
    ['frontView','rightView','leftView','rearView','valveNameplate','tagNameplate','actuatorNameplate'].forEach(k => {
      html += this._previewThumb(k, this.data.valvePhotos[k], 'valve');
    });
    html += '</div>';

    // Appearance photos
    var appearItems = this._getAllAppearanceItems();
    if (appearItems.length > 0) {
      html += '<h4>' + this.t('previewAppearance') + '</h4><div class="preview-grid">';
      appearItems.forEach((item) => {
        var photo = this._getAppearancePhoto(item.accKey, item.idx, item.type);
        html += this._previewThumb(item.key, photo, 'appearance', item.label);
      });
      html += '</div>';
    }

    // Accessory photos
    const accItems = this._getAllAccessoryItems();
    if (accItems.length > 0) {
      html += `<h4>${this.t('previewAccessories')}</h4><div class="preview-grid">`;
      accItems.forEach(item => {
        const photo = this._getAccessoryPhoto(item.accKey, item.idx, item.type);
        html += this._previewThumb(item.key, photo, 'accessory', item.label);
      });
      html += '</div>';
    }

    c.innerHTML = html;

    // Bind retake
    c.querySelectorAll('.preview-retake').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const key = btn.dataset.key;
        if (key.startsWith('app_') || key.startsWith('acc_')) {
          this._capturePhoto(key, 'portrait', btn.dataset.crop === 'true');
        } else {
          const v = ['valveNameplate','tagNameplate','actuatorNameplate'].includes(key) ? 'landscape' : 'portrait';
          this._capturePhoto(key, v, ['valveNameplate','tagNameplate','actuatorNameplate'].includes(key));
        }
      };
    });
  }

  _previewThumb(key, dataURL, category, extraLabel) {
    const cropNeeded = ['valveNameplate','tagNameplate','actuatorNameplate'].includes(key) || (key.startsWith('acc_') && key.endsWith('_nameplate'));
    const label = extraLabel || this.t(key.replace('valveNameplate','valveNameplate').replace('tagNameplate','tagNameplate').replace('actuatorNameplate','actuatorNameplate')
      .replace('frontView','frontView').replace('rightView','rightView').replace('leftView','leftView').replace('rearView','rearView')) || key;
    return `<div class="preview-thumb">
      ${dataURL ? `<img src="${dataURL}" alt="" />` : `<div class="preview-empty">—</div>`}
      <small>${label}</small>
      <button class="btn btn-sm preview-retake" data-key="${key}" data-crop="${cropNeeded}">${this.t('retake')}</button>
    </div>`;
  }

  _getAllAppearanceItems() {
    var app = this.data.appearance;
    var items = [];
    if (app.flowDirection) {
      items.push({ key: 'app_flow_0_photo', label: this.t('flowDirection'), enLabel: 'Flow Direction',
        accKey: 'flow', idx: 0, type: 'photo' });
    }
    if (app.pressureGauge) {
      items.push({ key: 'app_press_0_photo', label: this.t('pressureGauge'), enLabel: 'Pressure Gauge',
        accKey: 'press', idx: 0, type: 'photo' });
    }
    if (app.flangeWaterline) {
      items.push({ key: 'app_flange_0_photo', label: this.t('flangeWaterline') + ' - ' + this.t('flangeLeft'),
        enLabel: 'Flange Water Line - Left', accKey: 'flange', idx: 0, type: 'photo' });
      items.push({ key: 'app_flange_1_photo', label: this.t('flangeWaterline') + ' - ' + this.t('flangeRight'),
        enLabel: 'Flange Water Line - Right', accKey: 'flange', idx: 1, type: 'photo' });
    }
    if (app.internalCleanliness) {
      items.push({ key: 'app_clean_0_photo', label: this.t('internalCleanliness') + ' - ' + this.t('inlet'),
        enLabel: 'Internal Cleanliness - Inlet', accKey: 'clean', idx: 0, type: 'photo' });
      items.push({ key: 'app_clean_1_photo', label: this.t('internalCleanliness') + ' - ' + this.t('outlet'),
        enLabel: 'Internal Cleanliness - Outlet', accKey: 'clean', idx: 1, type: 'photo' });
    }
    (app.otherAppearance || []).forEach((o, oi) => {
      if (!o.name) return;
      items.push({ key: 'app_oth_' + oi + '_0_photo', label: o.name, enLabel: o.name,
        accKey: 'oth_' + oi, idx: 0, type: 'photo' });
    });
    return items;
  }

  _getAllAccessoryItems() {
    const acc = this.data.accessories;
    const items = [];
    const defs = [
      { key: 'positioner',      label: this.t('positioner'),      enLabel: 'Positioner',      selected: acc.positioner.selected,      qty: acc.positioner.qty },
      { key: 'filterRegulator', label: this.t('filterRegulator'), enLabel: 'Filter Regulator', selected: acc.filterRegulator.selected, qty: acc.filterRegulator.qty },
      { key: 'solenoidValve',   label: this.t('solenoidValve'),   enLabel: 'Solenoid Valve',   selected: acc.solenoidValve.selected,   qty: acc.solenoidValve.qty },
      { key: 'volumeBooster',   label: this.t('volumeBooster'),   enLabel: 'Volume Booster',   selected: acc.volumeBooster.selected,   qty: acc.volumeBooster.qty },
      { key: 'quickExhaust',    label: this.t('quickExhaustValve'),enLabel: 'Quick Exhaust Valve', selected: acc.quickExhaust.selected,   qty: acc.quickExhaust.qty },
      { key: 'limitSwitch',     label: this.t('limitSwitch'),     enLabel: 'Limit Switch',     selected: acc.limitSwitch.selected,     qty: acc.limitSwitch.qty },
    ];
    defs.forEach(d => {
      if (d.selected) {
        for (let i = 0; i < d.qty; i++) {
          const lbl = `${d.label}${d.qty > 1 ? ' #' + (i + 1) : ''}`;
          const enLbl = `${d.enLabel}${d.qty > 1 ? ' #' + (i + 1) : ''}`;
          items.push({ key: `acc_${d.key}_${i}_photo`, label: lbl, enLabel: enLbl, accKey: d.key, idx: i, type: 'photo' });
          items.push({ key: `acc_${d.key}_${i}_nameplate`, label: lbl + ' ' + this.t('accessoryNameplate'), enLabel: enLbl + ' Nameplate', accKey: d.key, idx: i, type: 'nameplate' });
        }
      }
    });
    (acc.others || []).forEach((o, oi) => {
      if (!o.name) return;
      for (let i = 0; i < (o.qty || 1); i++) {
        const lbl = `${o.name}${o.qty > 1 ? ' #' + (i + 1) : ''}`;
        const akey = `other_${oi}`;
        items.push({ key: `acc_${akey}_${i}_photo`, label: lbl, enLabel: lbl, accKey: akey, idx: i, type: 'photo' });
        items.push({ key: `acc_${akey}_${i}_nameplate`, label: lbl + ' ' + this.t('accessoryNameplate'), enLabel: lbl + ' Nameplate', accKey: akey, idx: i, type: 'nameplate' });
      }
    });
    return items;
  }

  // ═══════════════════════════════════════════
  // STEP 6 — Generate report
  // ═══════════════════════════════════════════
  _renderStep8(c) {
    // Clear any stale genStatus content
    var oldStatus = document.getElementById('genStatus');
    if (oldStatus) oldStatus.innerHTML = '';
    const fileName = this._genReportFileName();
    let html = `<h3 class="section-title">${this.t('generateTitle')}</h3>`;
    html += `<div class="generate-card">
      <p><strong>${this.t('reportFileName')}:</strong></p>
      <code>${this._esc(fileName)}</code>
      <div class="gen-actions">
        <button class="btn btn-outline" id="btnPreview">🔍 ${I18n.lang === 'zh' ? '预览报告' : 'Preview Report'}</button>
        <button class="btn btn-primary" id="btnGenPDF">📄 ${this.t('downloadPDF')}</button>
        <button class="btn btn-outline" id="btnGenLink">🔗 ${this.t('shareLink')}</button>
      </div>
      <div id="genStatus" class="gen-status"></div>
    </div>`;
    c.innerHTML = html;

    document.getElementById('btnPreview').onclick = () => this._previewReport(fileName);
    document.getElementById('btnGenPDF').onclick = () => this._generatePDF(fileName);
    document.getElementById('btnGenLink').onclick = () => this._saveAndShare(fileName);
  }

  _genReportFileName() {
    var d = new Date();
    var ds = d.getFullYear() + ('0' + (d.getMonth()+1)).slice(-2) + ('0' + d.getDate()).slice(-2);
    var parts = ["Photo Report", this.data.contractNo, this.data.positionNo, this.data.tagNo, this.data.serialNo, ds].filter(Boolean);
    return parts.join('_').replace(/\s+/g, '-') + '.pdf';
  }

  async _saveAndShare(fileName) {
    const status = document.getElementById('genStatus');
    status.innerHTML = `<p>${this.t('generating')}</p>`;

    try {
      // Upload all images first
      const images = {};
      const uploads = [];

      for (const [key, dataURL] of Object.entries(this.data.valvePhotos)) {
        if (!dataURL) continue;
        uploads.push(this._uploadDataURL(dataURL).then(filename => { images[key] = filename; }));
      }

      for (const [accKey, photos] of Object.entries(this.data.accessoryPhotos)) {
        if (!Array.isArray(photos)) continue;
        for (let i = 0; i < photos.length; i++) {
          if (!photos[i]) continue;
          if (photos[i].photo) {
            uploads.push(this._uploadDataURL(photos[i].photo).then(fn => {
              images[`acc_${accKey}_${i}_photo`] = fn;
            }));
          }
          if (photos[i].nameplate) {
            uploads.push(this._uploadDataURL(photos[i].nameplate).then(fn => {
              images[`acc_${accKey}_${i}_nameplate`] = fn;
            }));
          }
        }
      }

      await Promise.all(uploads);

      const meta = {
        contractNo: this.data.contractNo,
        ifsNo: this.data.ifsNo,
        positionNo: this.data.positionNo,
        tagNo: this.data.tagNo,
        serialNo: this.data.serialNo,
        valveType: this.data.valveType,
        recorder: this.data.recorder,
        accessories: this.data.accessories
      };

      const result = await SamsonStorage.saveReport(meta, images);
      const link = `${window.location.origin}/report.html?id=${result.id}`;

      status.innerHTML = `
        <p style="color:green;">✅ ${this.t('saved')}</p>
        <p><a href="${link}" target="_blank">${link}</a></p>
        <button class="btn btn-sm" id="btnCopyLink">${this.t('copyLink')}</button>`;

      document.getElementById('btnCopyLink').onclick = () => {
        navigator.clipboard.writeText(link).then(() => {
          alert(this.t('copied'));
        });
      };

      SamsonStorage.clearDraft();
    } catch (err) {
      status.innerHTML = `<p style="color:red;">${this.t('errorUpload')}: ${err.message}</p>`;
    }
  }

  async _uploadDataURL(dataURL) {
    const blob = this._dataURLtoBlob(dataURL);
    const result = await SamsonStorage.uploadImage(blob);
    return result.filename;
  }

  _dataURLtoBlob(dataURL) {
    const parts = dataURL.split(',');
    const mime = parts[0].match(/:(.*?);/)[1];
    const bytes = atob(parts[1]);
    const arr = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }

  async _previewReport(fileName) {
    var status = document.getElementById('genStatus');
    status.innerHTML = '<p>' + (I18n.lang === 'zh' ? '正在生成预览...' : 'Generating preview...') + '</p>';
    try {
      var doc = await this._buildPDF();
      var blob = doc.output('blob');
      var url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      status.innerHTML = '<p style="color:green;">' + (I18n.lang === 'zh' ? '预览已在新标签页中打开' : 'Preview opened in new tab') + '</p>';
    } catch(err) {
      status.innerHTML = '<p style="color:red;">Error: ' + err.message + '</p>';
    }
  }

  async _generatePDF(fileName) {
    var status = document.getElementById('genStatus');
    status.innerHTML = '<p>' + this.t('generating') + '</p>';
    try {
      var doc = await this._buildPDF();
      doc.save(fileName);
      status.innerHTML = '<p style="color:green;">PDF ' + this.t('saved') + '</p>';
      SamsonStorage.clearDraft();
    } catch(err) {
      status.innerHTML = '<p style="color:red;">Error: ' + err.message + '</p>';
    }
  }

    _textToImage(text, fontSize, color) {
    if (!text) return null;
    var canvas = document.createElement('canvas');
    var ctx = canvas.getContext('2d');
    var pxSize = Math.round(fontSize * 2.8);
    ctx.font = pxSize + 'px "PingFang SC","Microsoft YaHei","Noto Sans SC","Helvetica Neue",sans-serif';
    var m = ctx.measureText(text);
    canvas.width = Math.max(Math.ceil(m.width) + 8, 10);
    canvas.height = Math.ceil(pxSize * 1.5);
    ctx.fillStyle = color || '#000000';
    ctx.font = pxSize + 'px "PingFang SC","Microsoft YaHei","Noto Sans SC","Helvetica Neue",sans-serif';
    ctx.textBaseline = 'top';
    ctx.fillText(text, 2, 2);
    return canvas.toDataURL('image/png');
  }

  async _buildPDF() {
    if (!window.jspdf) {
      await this._loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
    }
    var { jsPDF } = window.jspdf;
    var doc = new jsPDF('p', 'mm', 'a4');
    var self = this;
    var L = function(key) { return I18n.dict['en'][key] || key; };

    // Canvas-based text — consistent rendering for Chinese + English
    var T = function(text, size, color) {
      if (!text) return null;
      var c = document.createElement('canvas');
      var ctx = c.getContext('2d');
      var px = Math.round(size * 3);
      ctx.font = 'bold ' + px + 'px "PingFang SC","Microsoft YaHei","Noto Sans SC",sans-serif';
      var m = ctx.measureText(text);
      c.width = Math.max(Math.ceil(m.width) + 10, 20);
      c.height = Math.ceil(px * 1.6);
      ctx.fillStyle = color || '#000000';
      ctx.font = 'bold ' + px + 'px "PingFang SC","Microsoft YaHei","Noto Sans SC",sans-serif';
      ctx.textBaseline = 'top';
      ctx.fillText(text, 3, 2);
      return c.toDataURL('image/png');
    };

    var addTextImg = function(text, x, y, size, color, maxW) {
      var img = T(text, size, color);
      if (!img) return;
      try {
        var h = size * 0.42; // approximate mm height
        doc.addImage(img, 'PNG', x, y, maxW || 60, h);
      } catch(e) {}
    };

    // Photo helper: aspect-ratio aware placement
    var addPhoto = function(dataURL, x, y, maxW, maxH) {
      return new Promise(function(resolve) {
        var img = new Image();
        img.onload = function() {
          var ratio = img.width / img.height;
          var slotRatio = maxW / maxH;
          var dw, dh;
          if (ratio > slotRatio) { dw = maxW; dh = maxW / ratio; }
          else { dh = maxH; dw = maxH * ratio; }
          // Center in slot
          var dx = x + (maxW - dw) / 2;
          var dy = y + (maxH - dh) / 2;
          try { doc.addImage(dataURL, 'JPEG', dx, dy, dw, dh); } catch(e) {}
          resolve({ w: dw, h: dh });
        };
        img.src = dataURL;
      });
    };

    try {
      var pageW = doc.internal.pageSize.getWidth();
      var pageH = doc.internal.pageSize.getHeight();
      var margin = 12;
      var currentY = margin;

      var addPage = function() { doc.addPage(); currentY = margin; };

      // ── Title
      var titleImg = T('SAMSON  —  Control Valve Photo Documentation  —  Q-2047', 11, '#003D79');
      if (titleImg) {
        try { doc.addImage(titleImg, 'PNG', margin, currentY - 1, 150, 7); } catch(e) {}
      }
      currentY += 9;
      doc.setDrawColor(0, 61, 121);
      doc.setLineWidth(0.6);
      doc.line(margin, currentY, pageW - margin, currentY);
      currentY += 5;

      // ── Basic Info — all canvas images
      var labels = [
        'IFS No.',
        'Pos.',
        'Tag No.',
        'Serial No.',
        'Type',
        'Recorder'
      ];
      var vals = [
        this.data.contractNo || '-',
        this.data.positionNo || '-',
        this.data.tagNo || '-',
        this.data.serialNo || '-',
        this.data.valveType || '-',
        this.data.recorder || '-',
      ];
      var infoY = currentY;
      labels.forEach(function(lbl, i) {
        var rowY = infoY + i * 8;
        addTextImg(lbl + ':', margin, rowY, 7, '#444444', 55);
        addTextImg(vals[i], margin + 57, rowY, 7, '#000000', 55);
      }.bind(this));
      currentY = infoY + labels.length * 8 + 4;
      doc.setDrawColor(200, 200, 200);
      doc.setLineWidth(0.3);
      doc.line(margin, currentY, pageW - margin, currentY);
      currentY += 5;

      // ── Photo layout settings
      var slotW = (pageW - margin * 2 - 6) / 2;
      var slotH = slotW * 0.8;

      // ── Valve Photos
      addTextImg('Valve Photos', margin, currentY, 8, '#003D79', 80);
      currentY += 6;
      var valveKeys = ['frontView','rightView','leftView','rearView','valveNameplate','tagNameplate','actuatorNameplate'];
      var valveEn = ['Front View','Right View','Left View','Rear View','Valve Nameplate','Tag Nameplate','Actuator Nameplate'];
      var photoIdx = 0;

      for (var vi = 0; vi < valveKeys.length; vi++) {
        var dataURL = this.data.valvePhotos[valveKeys[vi]];
        if (!dataURL) continue;
        if (currentY + slotH + 10 > pageH - margin) addPage();
        var col = photoIdx % 2;
        var x = margin + col * (slotW + 6);
        if (col === 0 && photoIdx > 0) currentY += slotH + 8;
        await addPhoto(dataURL, x, currentY, slotW, slotH);
        addTextImg(valveEn[vi], x, currentY + slotH + 1, 5.5, '#555555', slotW);
        photoIdx++;
      }

      // ── Appearance Photos
      var appearItems = this._getAllAppearanceItems();
      if (appearItems.length > 0) {
        currentY += slotH + 12;
        if (currentY > pageH - 30) addPage();
        addTextImg('Appearance Photos', margin, currentY, 8, '#003D79', 80);
        currentY += 6;
        var ai = 0;
        for (var ai2 = 0; ai2 < appearItems.length; ai2++) {
          var a = appearItems[ai2];
          var p = this._getAppearancePhoto(a.accKey, a.idx, a.type);
          if (!p) continue;
          if (currentY + slotH + 10 > pageH - margin) addPage();
          var acol = ai % 2;
          var ax = margin + acol * (slotW + 6);
          if (acol === 0 && ai > 0) currentY += slotH + 8;
          await addPhoto(p, ax, currentY, slotW, slotH);
          addTextImg(a.enLabel || a.label, ax, currentY + slotH + 1, 5.5, '#555555', slotW);
          ai++;
        }
      }

      // ── Accessory Photos
      var accItems = this._getAllAccessoryItems();
      if (accItems.length > 0) {
        currentY += slotH + 12;
        if (currentY > pageH - 30) addPage();
        addTextImg('Accessory Photos', margin, currentY, 8, '#003D79', 80);
        currentY += 6;
        var accSlotH = slotW * 0.65;
        var aci = 0;
        for (var aci2 = 0; aci2 < accItems.length; aci2++) {
          var aa = accItems[aci2];
          var pp = this._getAccessoryPhoto(aa.accKey, aa.idx, aa.type);
          if (!pp) continue;
          if (currentY + accSlotH + 10 > pageH - margin) addPage();
          var acccol = aci % 2;
          var accx = margin + acccol * (slotW + 6);
          if (acccol === 0 && aci > 0) currentY += accSlotH + 8;
          await addPhoto(pp, accx, currentY, slotW, accSlotH);
          addTextImg(aa.enLabel || aa.label, accx, currentY + accSlotH + 1, 5.5, '#555555', slotW);
          aci++;
        }
      }

      // ── Footer
      var pageCount = doc.internal.getNumberOfPages();
      for (var pi = 1; pi <= pageCount; pi++) {
        doc.setPage(pi);
        addTextImg(new Date().toISOString().slice(0,10) + '  |  Page ' + pi + '/' + pageCount, margin, pageH - 6, 5.5, '#999999', 100);
      }
      return doc;
    } catch(err) {
      console.error('_buildPDF error:', err);
      throw err;
    }
  }
  _loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  // ── Utilities ──────────────────────────────
  _showToast(msg, type) {
    var existing = document.getElementById('samsonToast');
    if (existing) existing.remove();
    var toast = document.createElement('div');
    toast.id = 'samsonToast';
    toast.style.cssText = 'position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:999;' +
      'padding:10px 20px;border-radius:8px;font-size:.85rem;font-weight:500;max-width:90vw;text-align:center;' +
      'box-shadow:0 4px 16px rgba(0,0,0,.2);animation:slideDown .3s ease;' +
      (type === 'error'
        ? 'background:#FFF0F0;color:#DC3545;border:1px solid #F5C6CB;'
        : 'background:#F0FFF4;color:#198754;border:1px solid #C3E6CB;');
    toast.textContent = msg;
    document.body.appendChild(toast);
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(function() {
      if (toast.parentNode) toast.remove();
    }, 3000);
  }

  _esc(s) {
    if (!s) return '';
    if (typeof s !== 'string') s = String(s);
    try {
      return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    } catch(e) {
      return s;
    }
  }
}

// ── Init ─────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  window.app = new SamsonApp();
});
