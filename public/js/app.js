// ────────────────────────────────────────────
// SAMSON Photo Report App — Q-2047
// ────────────────────────────────────────────

class SamsonApp {
  constructor() {
    try {
      this.currentStep = 1;
      this.totalSteps = 8;
      this.data = this._defaultData();
      this.batch = null;
      this.activeValveId = '';
      this._archivePromises = {};
      this._authenticated = false;
      this.localUsers = this._loadRoleDemoUsers();
      var savedUser = localStorage.getItem('samson_role_demo_current') || 'liuyang';
      this.currentUser = this.localUsers.find(function(user) { return user.username === savedUser; }) || this.localUsers[0];
      this._roleDashboard = this.currentUser.role !== 'operator';
      this._bindBaseEvents();
      window._draftChecked = true;
      this.render();
      this._initMultiValvePrototype();
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

  _normalizePosNumber(value) {
    return String(value || '').trim().replace(/^Pos\s*/i, '');
  }

  _loadRoleDemoUsers() {
    var defaults = [
      { username: 'liuyang', displayName: 'Liu Yang', role: 'operator', enabled: true, passwordHash: 'b3b130b344c28e52c7bd5347314547502cb39fec8ea539a78087539c236c6501' },
      { username: 'liuzhixin', displayName: 'Liu Zhixin', role: 'operator', enabled: true, passwordHash: 'b3b130b344c28e52c7bd5347314547502cb39fec8ea539a78087539c236c6501' },
      { username: 'yanbo', displayName: 'Yan Bo', role: 'operator', enabled: true, passwordHash: 'b3b130b344c28e52c7bd5347314547502cb39fec8ea539a78087539c236c6501' },
      { username: 'zhanglin', displayName: 'Zhang Lin', role: 'operator', enabled: true, passwordHash: 'b3b130b344c28e52c7bd5347314547502cb39fec8ea539a78087539c236c6501' },
      { username: 'zhonghaitao', displayName: 'Zhong Haitao', role: 'operator', enabled: true, passwordHash: 'b3b130b344c28e52c7bd5347314547502cb39fec8ea539a78087539c236c6501' },
      { username: 'sunqiang', displayName: 'Sun Qiang', role: 'supervisor', enabled: true, passwordHash: 'b3b130b344c28e52c7bd5347314547502cb39fec8ea539a78087539c236c6501' },
      { username: 'zhaofeng', displayName: 'Zhao Feng', role: 'admin', enabled: true, passwordHash: 'b3b130b344c28e52c7bd5347314547502cb39fec8ea539a78087539c236c6501' }
    ];
    try {
      var saved = JSON.parse(localStorage.getItem('samson_role_demo_users') || 'null');
      if (!Array.isArray(saved) || !saved.length) return defaults;
      return defaults.map(function(user) {
        var match = saved.find(function(item) { return item.username === user.username; });
        return match ? Object.assign({}, user, { role: match.role || user.role, enabled: typeof match.enabled === 'boolean' ? match.enabled : true, passwordHash: match.passwordHash || user.passwordHash }) : user;
      });
    } catch (e) { return defaults; }
  }

  _saveRoleDemoUsers() {
    localStorage.setItem('samson_role_demo_users', JSON.stringify(this.localUsers));
  }

  _roleLabel(role) {
    return ({ operator: 'Operator', supervisor: 'Supervisor', admin: 'Admin' })[role] || role;
  }

  _switchRole(username) {
    var user = this.localUsers.find(function(item) { return item.username === username; });
    if (!user) return;
    this.currentUser = user;
    this._authenticated = true;
    localStorage.setItem('samson_role_demo_current', username);
    this._roleDashboard = user.role !== 'operator';
    if (!this._roleDashboard && this.batch && this.batch.ownerUserId === user.username) {
      var active = this._getActiveValve();
      if (active) {
        this.activeValveId = active.id;
        this.data = this._deepMerge(this._defaultData(), active.data || {});
        this.currentStep = active.currentStep || 1;
      } else {
        this.currentStep = 1;
      }
    } else {
      this.currentStep = this._roleDashboard ? 0 : 1;
    }
    this.render();
    if (!this._roleDashboard && this.batch && this.batch.valves.length) this._showResumeSessionPrompt();
  }

  _showResumeSessionPrompt() {
    var existing = document.getElementById('resumeSessionModal');
    if (existing) existing.remove();
    var zh = I18n.lang === 'zh';
    var ownerMatches = !this.batch.ownerUserId || this.batch.ownerUserId === this.currentUser.username;
    var active = this._getActiveValve();
    var modal = document.createElement('div');
    modal.className = 'modal';
    modal.id = 'resumeSessionModal';
    var html = '<div class="modal-content role-picker-modal"><h3>' + (zh ? '发现未完成的 Session' : 'Unfinished Session Found') + '</h3>';
    html += '<p><strong>Session ID:</strong> ' + this._esc(this.batch.id) + '</p>';
    html += '<p>' + (zh ? '阀门数量：' : 'Valves: ') + this.batch.valves.length + '</p>';
    if (active) html += '<p>' + (zh ? '当前阀门：' : 'Current valve: ') + 'Pos' + this._normalizePosNumber(active.positionNo) + ' · ' + this._esc(active.tagNo || active.serialNo) + '</p>';
    if (!ownerMatches) {
      html += '<p class="role-login-error">' + (zh ? '该 Session 属于 ' + this.batch.ownerDisplayName + '，当前账号不能继续。' : 'This Session belongs to ' + this.batch.ownerDisplayName + ' and cannot be continued by this account.') + '</p>';
    }
    html += '<div class="appearance-prompt-actions">';
    if (ownerMatches) html += '<button class="btn btn-primary" id="resumeSessionYes">' + (zh ? '继续上次 Session' : 'Continue Session') + '</button>';
    html += '<button class="btn btn-outline" id="resumeSessionNo">' + (zh ? '开始新 Session' : 'Start New Session') + '</button></div></div>';
    modal.innerHTML = html;
    document.body.appendChild(modal);
    if (document.getElementById('resumeSessionYes')) document.getElementById('resumeSessionYes').onclick = function() { modal.remove(); this.render(); }.bind(this);
    document.getElementById('resumeSessionNo').onclick = function() { modal.remove(); this._resetSession(); }.bind(this);
  }

  _showRolePicker() {
    var modal = document.createElement('div');
    modal.className = 'modal';
    modal.id = 'rolePickerModal';
    var zh = I18n.lang === 'zh';
    var html = '<div class="modal-content role-picker-modal"><h3>' + (zh ? '登录' : 'Login') + '</h3>';
    html += '<div class="wizard-block"><label>' + (zh ? '用户 / 角色' : 'User / Role') + '</label><select id="roleUserSelect">';
    this.localUsers.forEach(function(user) {
      html += '<option value="' + user.username + '"' + (user.username === this.currentUser.username ? ' selected' : '') + '>' + this._esc(user.displayName) + ' · ' + this._roleLabel(user.role) + '</option>';
    }.bind(this));
    html += '</select></div><div class="wizard-block"><label>' + (zh ? '密码' : 'Password') + '</label><input id="rolePassword" type="password" autocomplete="current-password" /></div><div id="roleLoginError" class="role-login-error"></div>';
    html += '<div class="appearance-prompt-actions"><button class="btn btn-primary" id="roleLoginBtn">' + (zh ? '登录' : 'Login') + '</button>';
    if (this._authenticated) html += '<button class="btn btn-ghost" id="closeRolePicker">' + (zh ? '取消' : 'Cancel') + '</button>';
    html += '</div></div>';
    modal.innerHTML = html;
    document.body.appendChild(modal);
    document.getElementById('roleLoginBtn').onclick = async function() {
      var username = document.getElementById('roleUserSelect').value;
      var password = document.getElementById('rolePassword').value;
      var ok = await this._verifyLocalPassword(username, password);
      if (!ok) {
        document.getElementById('roleLoginError').textContent = zh ? '密码错误' : 'Incorrect password';
        return;
      }
      var selectedUser = this.localUsers.find(function(item) { return item.username === username; });
      if (!selectedUser || selectedUser.enabled === false) {
        document.getElementById('roleLoginError').textContent = zh ? '该账号已被禁用' : 'This account is disabled';
        return;
      }
      modal.remove();
      this._switchRole(username);
    }.bind(this);
    if (document.getElementById('closeRolePicker')) document.getElementById('closeRolePicker').onclick = function() { modal.remove(); };
  }

  async _verifyLocalPassword(username, password) {
    try {
      var bytes = new TextEncoder().encode(String(password));
      var hash = await crypto.subtle.digest('SHA-256', bytes);
      var hex = Array.from(new Uint8Array(hash)).map(function(value) { return value.toString(16).padStart(2, '0'); }).join('');
      var user = this.localUsers.find(function(item) { return item.username === username; });
      return hex === (user ? (user.passwordHash || 'b3b130b344c28e52c7bd5347314547502cb39fec8ea539a78087539c236c6501') : 'b3b130b344c28e52c7bd5347314547502cb39fec8ea539a78087539c236c6501');
    } catch (e) {
      return false;
    }
  }

  async _hashLocalPassword(password) {
    var bytes = new TextEncoder().encode(String(password));
    var hash = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(hash)).map(function(value) { return value.toString(16).padStart(2, '0'); }).join('');
  }

  _newSession() {
    var sessionId = this._nextSessionId();
    return {
      version: 2,
      id: sessionId,
      status: 'active',
      ownerUserId: this.currentUser.username,
      ownerDisplayName: this.currentUser.displayName,
      startedAt: new Date().toISOString(),
      activeValveId: '',
      valves: [],
      logs: [{ timestamp: new Date().toISOString(), user: this.currentUser.username, action: 'session_created', sessionId: sessionId }]
    };
  }

  _nextSessionId() {
    var now = new Date();
    var date = now.getFullYear() + ('0' + (now.getMonth() + 1)).slice(-2) + ('0' + now.getDate()).slice(-2);
    var operator = this.currentUser.displayName.replace(/\s+/g, '');
    var key = 'samson_session_sequence_' + operator + '_' + date;
    var sequence = parseInt(localStorage.getItem(key) || '0', 10) + 1;
    localStorage.setItem(key, String(sequence));
    return operator + '_' + date + '_' + ('000' + sequence).slice(-3);
  }

  _log(action, details) {
    if (!this.batch) return;
    if (!Array.isArray(this.batch.logs)) this.batch.logs = [];
    this.batch.logs.push({
      timestamp: new Date().toISOString(),
      user: this.currentUser.username,
      action: action,
      sessionId: this.batch.id,
      valveId: this.activeValveId || '',
      details: details || {}
    });
    this._saveBatch();
  }

  async _initMultiValvePrototype() {
    try {
      this.batch = await SamsonBatchStore.get('session');
      if (!this.batch || this.batch.version !== 2) {
        this.batch = this._newSession();
        await SamsonBatchStore.set('session', this.batch);
      }
      this.activeValveId = this.batch.activeValveId || '';
      if (!this.batch.ownerUserId) {
        this.batch.ownerUserId = this.currentUser.username;
        this.batch.ownerDisplayName = this.currentUser.displayName;
        await SamsonBatchStore.set('session', this.batch);
      }
      var active = this._getActiveValve();
      if (active) {
        this.data = this._deepMerge(this._defaultData(), active.data || {});
        this.currentStep = active.currentStep || 1;
      } else {
        this.currentStep = 1;
      }
      this.render();
      if (!this._authenticated) {
        this._showRolePicker();
      } else if (this.currentUser.role === 'operator' && this.batch.status !== 'closed' && this.batch.valves.length) {
        this._showResumeSessionPrompt();
      }
    } catch (e) {
      this.batch = this.batch || this._newSession();
      this.currentStep = 1;
      this.render();
    }
  }

  _saveBatch() {
    if (!this.batch) return;
    SamsonBatchStore.set('session', this.batch).catch(function() {});
  }

  _sortedBatchValves() {
    return this.batch ? this.batch.valves.slice() : [];
  }

  _getActiveValve() {
    if (!this.batch || !this.activeValveId) return null;
    return this.batch.valves.find(function(v) { return v.id === this.activeValveId; }.bind(this)) || null;
  }

  _latestValve() {
    if (!this.batch || !this.batch.valves.length) return null;
    return this.batch.valves[this.batch.valves.length - 1];
  }

  _expectedPhotoCount(data) {
    if (!data) return 0;
    var count = 7;
    var appearance = data.appearance || {};
    if (appearance.flowDirection) count++;
    if (appearance.pressureGauge) count++;
    if (appearance.flangeWaterline) count += 2;
    if (appearance.internalCleanliness) count += 2;
    count += (appearance.otherAppearance || []).length;
    var accessories = data.accessories || {};
    ['positioner','filterRegulator','solenoidValve','volumeBooster','quickExhaust','limitSwitch'].forEach(function(key) {
      var item = accessories[key];
      if (item && item.selected) count += (item.qty || 1) * 2;
    });
    (accessories.others || []).forEach(function(item) { count += (item.qty || 1) * 2; });
    return count;
  }

  _actualPhotoCount(data) {
    if (!data) return 0;
    var count = Object.keys(data.valvePhotos || {}).filter(function(key) { return !!data.valvePhotos[key]; }).length;
    Object.keys(data.appearancePhotos || {}).forEach(function(key) {
      (data.appearancePhotos[key] || []).forEach(function(item) { if (item && item.photo) count++; });
    });
    Object.keys(data.accessoryPhotos || {}).forEach(function(key) {
      (data.accessoryPhotos[key] || []).forEach(function(item) {
        if (!item) return;
        if (item.photo) count++;
        if (item.nameplate) count++;
      });
    });
    return count;
  }

  _calculateValveStatus(valve) {
    if (valve.reportGenerated) return 'completed';
    var actual = this._actualPhotoCount(valve.data);
    var expected = this._expectedPhotoCount(valve.data);
    if (!actual && (valve.currentStep || 1) <= 1) return 'not_started';
    if (expected > 0 && actual >= expected) return 'ready';
    return 'in_progress';
  }

  _statusLabel(status) {
    var zh = { not_started: '未开始', in_progress: '拍照中', ready: '待生成报告', completed: '已完成' };
    var en = { not_started: 'Not Started', in_progress: 'In Progress', ready: 'Ready', completed: 'Completed' };
    return (I18n.lang === 'zh' ? zh : en)[status] || status;
  }

  _persistActiveValve() {
    var valve = this._getActiveValve();
    if (!valve) return;
    this.batch.activeValveId = this.activeValveId;
    valve.data = this.data;
    valve.currentStep = this.currentStep > 0 ? this.currentStep : valve.currentStep || 1;
    valve.updatedAt = new Date().toISOString();
    this._saveBatch();
  }

  _openValve(id) {
    this._persistActiveValve();
    var valve = this.batch.valves.find(function(item) { return item.id === id; });
    if (!valve) return;
    this.activeValveId = id;
    this.data = this._deepMerge(this._defaultData(), valve.data || {});
    this.currentStep = valve.currentStep || 1;
    this._wizardMode = false;
    this.render();
  }

  _openValveQueue() {
    this._persistActiveValve();
    this.currentStep = 0;
    this._wizardMode = false;
    this.render();
  }

  _continueNextValve() {
    var valves = this._sortedBatchValves();
    var currentIndex = valves.findIndex(function(v) { return v.id === this.activeValveId; }.bind(this));
    var ordered = currentIndex >= 0 ? valves.slice(currentIndex + 1).concat(valves.slice(0, currentIndex + 1)) : valves;
    var next = ordered.find(function(v) { return this._calculateValveStatus(v) !== 'completed'; }.bind(this));
    if (next) this._openValve(next.id);
    else this._showValveWizard();
  }

  _saveAndNextValve() {
    var active = this._getActiveValve();
    if (!active || !active.serverArchive) {
      this._showToast(I18n.lang === 'zh' ? '请先生成报告并完成服务器归档' : 'Generate and archive the report first', 'error');
      return Promise.resolve();
    }
    this._persistActiveValve();
    if (this.batch && this.batch.valves.length >= 10) {
      this._showToast(I18n.lang === 'zh' ? '单轮任务最多支持 10 台阀门' : 'A session supports up to 10 valves', 'error');
      return Promise.resolve();
    }
    this.activeValveId = '';
    this.batch.activeValveId = '';
    this.data = this._defaultData();
    this._appearancePromptHandled = false;
    var previous = this._latestValve();
    if (previous) {
      this.data.valveType = previous.valveType || '';
      this.data.recorder = previous.recorder || '';
    }
    this.currentStep = 1;
    this._log('continue_next_valve', { nextFrom: active.serverArchive.id });
    this._saveBatch();
    this.render();
    return Promise.resolve();
  }

  _prepareCurrentValve() {
    var d = this._readStep1Form();
    var ifs = d.contractNo;
    var pos = this._normalizePosNumber(d.positionNo);
    var identity = d.tagNo || d.serialNo;
    if (!ifs || !pos || !identity) {
      this._showToast(I18n.lang === 'zh' ? '请填写 IFS、Pos 以及 Tag 或 Serial' : 'IFS / Pos and Tag or Serial required', 'error');
      return null;
    }
    if (this.activeValveId) {
      var active = this._getActiveValve();
      if (active) {
        active.ifsOrderNo = ifs;
        active.positionNo = pos;
        active.tagNo = d.tagNo;
        active.serialNo = d.serialNo;
        active.valveType = d.valveType;
        active.recorder = d.recorder;
        active.data = this.data;
        this._log('valve_basic_info_updated', { valveId: active.id });
        this._saveBatch();
      }
      return { isNew: false, valve: active, previous: null };
    }
    if (this.batch && this.batch.valves.length >= 10) {
      this._showToast(I18n.lang === 'zh' ? '单轮任务最多支持 10 台阀门' : 'A session supports up to 10 valves', 'error');
      return null;
    }
    var id = ifs + '::' + pos + '::' + identity;
    if (this.batch.valves.some(function(v) { return v.id === id; })) {
      this._showToast((I18n.lang === 'zh' ? '阀门已存在：' : 'Valve already exists: ') + id, 'error');
      return null;
    }
    var previous = this._latestValve();
    this.data.contractNo = ifs;
    this.data.ifsNo = ifs;
    this.data.positionNo = pos;
    var valve = {
      id: id, ifsOrderNo: ifs, positionNo: pos, tagNo: this.data.tagNo,
      serialNo: this.data.serialNo, valveType: this.data.valveType,
      recorder: this.data.recorder, currentStep: 1, reportGenerated: false,
      data: this.data, createdAt: new Date().toISOString()
    };
    this.batch.valves.push(valve);
    this.activeValveId = id;
    this.batch.activeValveId = id;
    this._saveBatch();
    this._log('valve_created', { valveId: id, ifsOrderNo: ifs, positionNo: pos, tagNo: this.data.tagNo });
    return { isNew: true, valve: valve, previous: previous };
  }

  _newValveDraft() {
    var previous = this._latestValve();
    return {
      previous: previous,
      ifsOrderNo: '',
      positionNo: '',
      multiple: false,
      tagNo: '',
      serialNo: '',
      valveType: previous ? previous.valveType || '3248' : '3248',
      recorder: previous ? previous.recorder || '' : '',
      histories: SamsonStorage.loadInputHistory()
    };
  }

  _showValveWizard() {
    this._persistActiveValve();
    if (this.batch && this.batch.valves.length >= 10) {
      this._showToast(I18n.lang === 'zh' ? '单轮任务最多支持 10 台阀门' : 'A session supports up to 10 valves', 'error');
      return;
    }
    this._wizardMode = true;
    this._wizardDraft = this._newValveDraft();
    this.currentStep = 0;
    this.render();
  }

  _renderValveWizard(c) {
    var d = this._wizardDraft;
    var zh = I18n.lang === 'zh';
    var history = d.histories || {};
    var datalist = function(id, key) {
      var values = (history[key] || []).slice(0, 8);
      return '<datalist id="' + id + '">' + values.map(function(value) { return '<option value="' + this._esc(value) + '"></option>'; }.bind(this)).join('') + '</datalist>';
    }.bind(this);
    var html = '<div class="batch-page"><div class="batch-summary"><div><strong>' +
      (zh ? '新增阀门' : 'Add Valve') + '</strong><small>' +
      (zh ? '按现场实际顺序添加，不要求连续 Pos' : 'Add in any on-site order') +
      '</small></div></div>';
    html += '<div class="wizard-block"><label>IFS Order No.</label><input id="wizIfs" list="histIfs" value="' + this._esc(d.ifsOrderNo) + '" />' + datalist('histIfs', 'ifsOrderNo') + '</div>';
    html += '<div class="wizard-block"><label>Pos No.</label><div class="quick-values">' + ['001','002','003','004'].map(function(value) { return '<button type="button" class="quick-chip" data-pos="' + value + '">' + value + '</button>'; }).join('') + '</div><input id="wizPos" list="histPos" value="' + this._esc(d.positionNo) + '" />' + datalist('histPos', 'positionNo') + '</div>';
    html += '<div class="wizard-block"><label>Tag No.</label><div class="quick-values">' + ['HV-','PV-','LV-','TV-'].map(function(value) { return '<button type="button" class="quick-chip" data-prefix="' + value + '">' + value + '</button>'; }).join('') + '</div><input id="wizTag" list="histTag" value="' + this._esc(d.tagNo) + '" />' + datalist('histTag', 'tagNo') + '</div>';
    html += '<div class="wizard-block"><label>Serial No.</label><input id="wizSerial" list="histSerial" value="' + this._esc(d.serialNo) + '" />' + datalist('histSerial', 'serialNo') + '</div>';
    html += '<div class="wizard-block"><label>Valve Type</label><div class="quick-values">' + ['3241','3251','3248','Ltr43-2'].map(function(value) { return '<button type="button" class="quick-chip" data-type="' + value + '">' + value + '</button>'; }).join('') + '</div><input id="wizType" list="histType" value="' + this._esc(d.valveType) + '" />' + datalist('histType', 'valveType') + '</div>';
    html += '<div class="wizard-block"><label>Recorder</label><input id="wizRecorder" list="histRecorder" value="' + this._esc(d.recorder) + '" />' + datalist('histRecorder', 'recorder') + '</div>';
    if (d.previous) html += '<div class="wizard-note">' + (zh ? '保存后会询问是否沿用上一台拍照范围。' : 'After saving, you will be asked whether to reuse the previous photo scope.') + '</div>';
    html += '<div class="batch-actions"><button class="btn btn-primary" id="wizardStart">' + (zh ? '开始拍照' : 'Start Capture') + '</button><button class="btn btn-ghost" id="wizardCancel">' + (zh ? '取消' : 'Cancel') + '</button></div></div>';
    c.innerHTML = html;

    var sync = function() {
      d.ifsOrderNo = document.getElementById('wizIfs').value.trim();
      d.positionNo = document.getElementById('wizPos').value.trim();
    }.bind(this);
    document.getElementById('wizIfs').oninput = sync;
    document.getElementById('wizPos').oninput = sync;
    c.querySelectorAll('[data-pos]').forEach(function(button) { button.onclick = function() { document.getElementById('wizPos').value = button.dataset.pos; sync(); }; });
    c.querySelectorAll('[data-prefix]').forEach(function(button) {
      button.onclick = function() {
        var input = document.getElementById('wizTag');
        var start = typeof input.selectionStart === 'number' ? input.selectionStart : input.value.length;
        var end = typeof input.selectionEnd === 'number' ? input.selectionEnd : start;
        input.value = input.value.slice(0, start) + button.dataset.prefix + input.value.slice(end);
        var caret = start + button.dataset.prefix.length;
        input.focus();
        input.setSelectionRange(caret, caret);
        sync();
      };
    });
    c.querySelectorAll('[data-type]').forEach(function(button) { button.onclick = function() { document.getElementById('wizType').value = button.dataset.type; sync(); }; });
    document.getElementById('wizardCancel').onclick = function() { this._wizardMode = false; this.render(); }.bind(this);
    document.getElementById('wizardStart').onclick = function() { this._createValveFromWizard(); }.bind(this);
    sync();
  }

  _createValveFromWizard() {
    var d = this._wizardDraft;
    var ifs = document.getElementById('wizIfs').value.trim();
    var pos = this._normalizePosNumber(document.getElementById('wizPos').value);
    var tagNo = document.getElementById('wizTag').value.trim();
    var serialNo = document.getElementById('wizSerial').value.trim();
    if (!ifs || !pos || (!tagNo && !serialNo)) { this._showToast('IFS / Pos and Tag or Serial required', 'error'); return; }
    var id = ifs + '::' + pos + '::' + (tagNo || serialNo);
    if (this.batch.valves.some(function(v) { return v.id === id; })) { this._showToast('Valve already exists: ' + id, 'error'); return; }
    var data = this._defaultData();
    data.contractNo = ifs; data.ifsNo = ifs; data.positionNo = pos; data.tagNo = tagNo; data.serialNo = serialNo; data.valveType = document.getElementById('wizType').value.trim(); data.recorder = document.getElementById('wizRecorder').value.trim();
    var valve = { id: id, ifsOrderNo: ifs, positionNo: pos, multiple: false, tagNo: data.tagNo, serialNo: data.serialNo, valveType: data.valveType, recorder: data.recorder, currentStep: 1, reportGenerated: false, data: data, createdAt: new Date().toISOString() };
    this.batch.valves.push(valve);
    this.activeValveId = id;
    this.batch.activeValveId = id;
    SamsonStorage.addInputValue('ifsOrderNo', ifs);
    SamsonStorage.addInputValue('positionNo', pos);
    if (data.tagNo) SamsonStorage.addInputValue('tagNo', data.tagNo);
    if (data.serialNo) SamsonStorage.addInputValue('serialNo', data.serialNo);
    if (data.valveType) SamsonStorage.addInputValue('valveType', data.valveType);
    if (data.recorder) SamsonStorage.addInputValue('recorder', data.recorder);
    this._wizardMode = false;
    this._saveBatch();
    this.currentStep = 1;
    this.data = data;
    this.render();
    if (d.previous) this._showScopeInheritancePrompt(valve, d.previous);
  }

  _showScopeInheritancePrompt(valve, previous, onDone) {
    var zh = I18n.lang === 'zh';
    var differentContext = String(valve.ifsOrderNo) !== String(previous.ifsOrderNo) || String(valve.positionNo) !== String(previous.positionNo);
    var modal = document.createElement('div');
    modal.className = 'modal';
    modal.id = 'scopeInheritancePrompt';
    modal.innerHTML = '<div class="modal-content appearance-scope-prompt"><h3>' + (zh ? '拍照范围确认' : 'Photo Scope Confirmation') + '</h3><p>' +
      (differentContext
        ? (zh ? '当前合同或 Pos 与上一台不同，拍照范围通常可能不一样。是否仍沿用上一台拍照范围？' : 'This contract or Pos differs from the previous valve. Photo scope may differ. Reuse the previous scope?')
        : (zh ? '当前合同和 Pos 与上一台相同，是否沿用上一台拍照范围？' : 'Same contract and Pos as the previous valve. Reuse the previous photo scope?')) +
      '</p><div class="appearance-prompt-actions"><button class="btn btn-primary" id="scopeInheritYes">' + (zh ? '沿用上一台' : 'Reuse Previous') + '</button><button class="btn btn-outline" id="scopeInheritNo">' + (zh ? '重新选择' : 'Choose Again') + '</button></div></div>';
    document.body.appendChild(modal);
    var finish = function(inherit) {
      if (inherit) {
        valve.data.accessories = JSON.parse(JSON.stringify(previous.data.accessories || valve.data.accessories));
        valve.data.appearance = JSON.parse(JSON.stringify(previous.data.appearance || valve.data.appearance));
        valve.data.appearance.otherAppearance = (valve.data.appearance.otherAppearance || []).map(function(item) { return { name: item.name }; });
        valve.data._scopeInherited = true;
        valve.scopeInherited = true;
        this.data = valve.data;
      } else {
        valve.data._scopeInherited = false;
        valve.scopeInherited = false;
        this.data = valve.data;
        this._appearancePromptHandled = false;
      }
      this._saveBatch();
      modal.remove();
      if (onDone) onDone(inherit);
      else this.render();
    }.bind(this);
    document.getElementById('scopeInheritYes').onclick = function() { finish(true); };
    document.getElementById('scopeInheritNo').onclick = function() { finish(false); };
  }

  _downloadValvePdf(valve) {
    var backupData = this.data;
    var backupStep = this.currentStep;
    this.data = this._deepMerge(this._defaultData(), valve.data || {});
    this._buildPDF().then(function(doc) { doc.save(this._genReportFileName()); this.data = backupData; this.currentStep = backupStep; }.bind(this)).catch(function() { this.data = backupData; this.currentStep = backupStep; }.bind(this));
  }

  async _packageValve(valve) {
    var backupData = this.data;
    var backupId = this.activeValveId;
    var backupStep = this.currentStep;
    this.activeValveId = valve.id;
    this.data = this._deepMerge(this._defaultData(), valve.data || {});
    this.currentStep = 8;
    var result = await this._saveAndDownload(this._genReportFileName());
    if (result) {
      valve.reportGenerated = true;
      valve.reportGeneratedAt = new Date().toISOString();
      valve.currentStep = 8;
      valve.data = this.data;
      this._saveBatch();
    }
    this.activeValveId = backupId;
    this.data = backupData;
    this.currentStep = backupStep;
    this.render();
  }

  _renderValveQueue(c) {
    if (this._wizardMode) { this._renderValveWizard(c); return; }
    if (!this.batch) { c.innerHTML = '<p style="padding:30px;text-align:center;">Loading…</p>'; return; }
    var valves = this._sortedBatchValves();
    var completed = valves.filter(function(v) { return this._calculateValveStatus(v) === 'completed'; }.bind(this)).length;
    var atLimit = valves.length >= 10;
    var html = '<div class="batch-page">';
    html += '<div class="batch-summary"><div><strong>' + (I18n.lang === 'zh' ? '一轮拍照任务' : 'Capture Session') + '</strong><small>' + new Date(this.batch.startedAt).toLocaleString() + '</small></div><span>' + completed + ' / ' + valves.length + '</span></div>';
    html += '<div class="batch-actions"><button class="btn btn-primary" id="batchAddValve"' + (atLimit ? ' disabled' : '') + '>' + (I18n.lang === 'zh' ? '新增一台阀门' : 'Add Valve') + '</button><button class="btn btn-outline" id="batchContinue">' + (I18n.lang === 'zh' ? '继续未完成' : 'Continue Incomplete') + '</button><button class="btn btn-ghost" id="batchReset">' + (I18n.lang === 'zh' ? '结束本轮任务' : 'End Session') + '</button></div>';
    if (!valves.length) html += '<div class="batch-empty">' + (I18n.lang === 'zh' ? '本轮任务还没有阀门，点击“新增一台阀门”开始。' : 'No valves yet. Add the first valve to start.') + '</div>';
    valves.forEach(function(valve, index) {
      var status = this._calculateValveStatus(valve);
      var code = 'Pos' + this._normalizePosNumber(valve.positionNo);
      html += '<div class="batch-valve-row ' + status + (valve.id === this.activeValveId ? ' active' : '') + '">';
      html += '<span class="batch-order">' + (index + 1) + '</span>';
      html += '<button class="batch-valve-main" data-valve="' + this._esc(valve.id) + '"><strong>' + code + '</strong><span>' + this._esc(valve.ifsOrderNo + ' · ' + (valve.tagNo || '')) + '</span></button>';
      html += '<div class="batch-links"><span class="batch-status">' + this._statusLabel(status) + '</span><button class="btn btn-sm btn-outline" data-pdf="' + this._esc(valve.id) + '">PDF</button><button class="btn btn-sm btn-outline" data-zip="' + this._esc(valve.id) + '">ZIP</button></div></div>';
    }.bind(this));
    html += '</div>';
    c.innerHTML = html;
    c.querySelectorAll('[data-valve]').forEach(function(button) { button.onclick = function() { this._openValve(button.dataset.valve); }.bind(this); }.bind(this));
    c.querySelectorAll('[data-pdf]').forEach(function(button) { button.onclick = function() { var valve = this.batch.valves.find(function(v) { return v.id === button.dataset.pdf; }.bind(this)); if (valve) this._downloadValvePdf(valve); }.bind(this); }.bind(this));
    c.querySelectorAll('[data-zip]').forEach(function(button) { button.onclick = function() { var valve = this.batch.valves.find(function(v) { return v.id === button.dataset.zip; }.bind(this)); if (valve) this._packageValve(valve); }.bind(this); }.bind(this));
    document.getElementById('batchAddValve').onclick = function() { this._showValveWizard(); }.bind(this);
    document.getElementById('batchContinue').onclick = function() { this._continueNextValve(); }.bind(this);
    document.getElementById('batchReset').onclick = function() { if (confirm(I18n.lang === 'zh' ? '结束本轮任务并开始新任务？' : 'End this session and start a new one?')) { this.batch = this._newSession(); this.activeValveId = ''; this._saveBatch(); this.render(); } }.bind(this);
  }

  _renderRoleDashboard(c) {
    var zh = I18n.lang === 'zh';
    var user = this.currentUser;
    var operatorOptions = this.localUsers.map(function(item) { return '<option value="' + this._esc(item.displayName) + '">' + this._esc(item.displayName) + '</option>'; }.bind(this)).join('');
    var html = '<div class="batch-page">';
    html += '<div class="batch-summary"><div><strong>' + this._esc(user.displayName) + '</strong><small>' + this._roleLabel(user.role) + ' · ' + (zh ? '后台管理' : 'Backend') + '</small></div></div>';
    if (user.role === 'admin') {
      html += '<div class="admin-tabs"><button class="admin-tab active" data-admin-tab="status">Status</button><button class="admin-tab" data-admin-tab="reports">Reports</button><button class="admin-tab" data-admin-tab="users">Users</button><button class="admin-tab" data-admin-tab="audit">Audit</button></div>';
      html += '<div id="adminSectionStatus" class="admin-section active"><div id="adminSummary" class="admin-summary"></div></div>';
      html += '<div id="adminSectionReports" class="admin-section">' + this._dashboardFilterHtml(operatorOptions) + '<div id="dashboardResults" class="dashboard-results"></div></div>';
      html += '<div id="adminSectionUsers" class="admin-section">' + this._adminUsersHtml() + '</div>';
      html += '<div id="adminSectionAudit" class="admin-section"><div class="role-panel"><h3>' + (zh ? '审计日志' : 'Audit Log') + '</h3><p class="role-note">' + (zh ? '点击下方按钮打开审计日志详情。' : 'Click below to open the audit log.') + '</p><button class="btn btn-primary" id="openAuditPanel">' + (zh ? '打开审计日志' : 'Open Audit Log') + '</button></div></div>';
    } else {
      html += this._dashboardFilterHtml(operatorOptions);
      html += '<div id="dashboardResults" class="dashboard-results"></div>';
    }
    html += '</div>';
    c.innerHTML = html;
    this._dashboardReports = [];
    if (user.role === 'admin') {
      c.querySelectorAll('[data-admin-tab]').forEach(function(button) {
        button.onclick = function() { this._showAdminTab(button.dataset.adminTab); }.bind(this);
      }.bind(this));
      if (document.getElementById('openAuditPanel')) document.getElementById('openAuditPanel').onclick = () => this._showAuditLog();
      if (document.getElementById('addUserBtn')) document.getElementById('addUserBtn').onclick = () => this._showAddUserModal();
      c.querySelectorAll('[data-user-role]').forEach(function(select) {
        select.onchange = function() {
          var target = this.localUsers.find(function(item) { return item.username === select.dataset.userRole; });
          if (target) { target.role = select.value; this._saveRoleDemoUsers(); this._renderRoleDashboard(document.getElementById('mainContent')); }
        }.bind(this);
      }.bind(this));
      c.querySelectorAll('[data-user-enabled]').forEach(function(checkbox) {
        checkbox.onchange = function() {
          var target = this.localUsers.find(function(item) { return item.username === checkbox.dataset.userEnabled; });
          if (target) { target.enabled = checkbox.checked; this._saveRoleDemoUsers(); }
        }.bind(this);
      }.bind(this));
      c.querySelectorAll('[data-delete-user]').forEach(function(button) {
        button.onclick = function() { this._deleteUser(button.dataset.deleteUser); }.bind(this);
      }.bind(this));
      this._loadAdminSummary();
    } else {
      document.getElementById('dashQuery').onclick = () => this._queryDashboardReports();
      document.getElementById('dashReset').onclick = () => { document.getElementById('dashDate').value = ''; document.getElementById('dashOperator').value = ''; document.getElementById('dashIfs').value = ''; document.getElementById('dashPos').value = ''; this._queryDashboardReports(); };
      this._queryDashboardReports();
    }
  }

  _dashboardFilterHtml(operatorOptions) {
    var zh = I18n.lang === 'zh';
    return '<div class="role-panel"><h3>' + (zh ? '全部照片报告' : 'All Photo Reports') + '</h3><div class="dashboard-filters">' +
      '<label>' + (zh ? '日期' : 'Date') + '<input type="date" id="dashDate" /></label>' +
      '<label>Operator<input id="dashOperator" list="dashboardOperatorList" /></label><datalist id="dashboardOperatorList">' + operatorOptions + '</datalist>' +
      '<label>IFS Order No.<input id="dashIfs" /></label>' +
      '<label>Pos No.<input id="dashPos" /></label>' +
      '<button class="btn btn-sm btn-primary" id="dashQuery">' + (zh ? '查询' : 'Search') + '</button>' +
      '<button class="btn btn-sm btn-ghost" id="dashReset">' + (zh ? '重置' : 'Reset') + '</button>' +
      '</div>';
  }

  _adminUsersHtml() {
    var zh = I18n.lang === 'zh';
    var html = '<div class="role-panel"><div class="user-toolbar"><h3>' + (zh ? '用户与角色管理' : 'Users & Roles') + '</h3><button class="btn btn-sm btn-primary" id="addUserBtn">+ ' + (zh ? '增加账户' : 'Add User') + '</button></div>';
    this.localUsers.forEach(function(item) {
      html += '<div class="user-role-row"><div><strong>' + this._esc(item.displayName) + '</strong><small>' + item.username + '</small></div><div class="user-role-controls"><label><input type="checkbox" data-user-enabled="' + item.username + '"' + (item.enabled !== false ? ' checked' : '') + ' /> ' + (zh ? '启用' : 'Enabled') + '</label><select data-user-role="' + item.username + '"><option value="operator"' + (item.role === 'operator' ? ' selected' : '') + '>Operator</option><option value="supervisor"' + (item.role === 'supervisor' ? ' selected' : '') + '>Supervisor</option><option value="admin"' + (item.role === 'admin' ? ' selected' : '') + '>Admin</option></select><button class="btn btn-sm btn-ghost" data-delete-user="' + item.username + '">✕</button></div></div>';
    }.bind(this));
    html += '<div class="role-panel"><h3>30 ' + (zh ? '天数据保留策略' : 'Day Retention Policy') + '</h3><p class="role-note">' + (zh ? '报告、照片、PDF 和 ZIP 从生成之日起保留 30 个自然日，到期后服务器自动彻底删除，不提供恢复。' : 'Reports, photos, PDF and ZIP are kept for 30 calendar days, then permanently deleted by the server.') + '</p></div></div>';
    return html;
  }

  _showAddUserModal() {
    var zh = I18n.lang === 'zh';
    var modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = '<div class="modal-content role-picker-modal"><h3>' + (zh ? '增加账户' : 'Add User') + '</h3>' +
      '<div class="wizard-block"><label>Username</label><input id="newUsername" /></div>' +
      '<div class="wizard-block"><label>' + (zh ? '显示名' : 'Display Name') + '</label><input id="newDisplayName" /></div>' +
      '<div class="wizard-block"><label>' + (zh ? '密码' : 'Password') + '</label><input id="newPassword" type="password" /></div>' +
      '<div class="wizard-block"><label>Role</label><select id="newRole"><option value="operator">Operator</option><option value="supervisor">Supervisor</option><option value="admin">Admin</option></select></div>' +
      '<div class="appearance-prompt-actions"><button class="btn btn-primary" id="saveNewUser">' + (zh ? '保存' : 'Save') + '</button><button class="btn btn-ghost" id="cancelNewUser">' + (zh ? '取消' : 'Cancel') + '</button></div></div>';
    document.body.appendChild(modal);
    document.getElementById('cancelNewUser').onclick = function() { modal.remove(); };
    document.getElementById('saveNewUser').onclick = async function() {
      var username = document.getElementById('newUsername').value.trim();
      var displayName = document.getElementById('newDisplayName').value.trim();
      var password = document.getElementById('newPassword').value;
      var role = document.getElementById('newRole').value;
      if (!username || !displayName || !password) { this._showToast('Fields required', 'error'); return; }
      if (this.localUsers.some(function(item) { return item.username === username; })) { this._showToast('Username exists', 'error'); return; }
      var passwordHash = await this._hashLocalPassword(password);
      this.localUsers.push({ username: username, displayName: displayName, role: role, enabled: true, passwordHash: passwordHash });
      this._saveRoleDemoUsers();
      modal.remove();
      this._renderRoleDashboard(document.getElementById('mainContent'));
    }.bind(this);
  }

  _deleteUser(username) {
    if (username === this.currentUser.username) { this._showToast(I18n.lang === 'zh' ? '不能删除当前账户' : 'Cannot delete current account', 'error'); return; }
    this._confirmDanger(I18n.lang === 'zh' ? '删除账户' : 'Delete User', I18n.lang === 'zh' ? '确认删除账户 ' + username + '？' : 'Delete user ' + username + '?', function() {
      this.localUsers = this.localUsers.filter(function(item) { return item.username !== username; });
      this._saveRoleDemoUsers();
      this._renderRoleDashboard(document.getElementById('mainContent'));
    }.bind(this));
  }

  _showAdminTab(section) {
    document.querySelectorAll('[data-admin-tab]').forEach(function(button) { button.classList.toggle('active', button.dataset.adminTab === section); });
    document.querySelectorAll('.admin-section').forEach(function(item) { item.classList.toggle('active', item.id === 'adminSection' + section.charAt(0).toUpperCase() + section.slice(1)); });
    if (section === 'reports') this._queryDashboardReports();
  }

  _dashboardFilters() {
    return {
      date: document.getElementById('dashDate').value.trim(),
      operator: document.getElementById('dashOperator').value.trim(),
      ifs: document.getElementById('dashIfs').value.trim(),
      pos: document.getElementById('dashPos').value.trim()
    };
  }

  async _queryDashboardReports() {
    var results = document.getElementById('dashboardResults');
    if (!results) return;
    results.innerHTML = '<p class="dashboard-loading">Loading…</p>';
    var filters = this._dashboardFilters();
    var query = new URLSearchParams(filters);
    query.set('actor', this.currentUser.displayName);
    query.set('role', this.currentUser.role);
    try {
      var response = await fetch('api/dashboard/reports?' + query.toString());
      if (!response.ok) throw new Error('Failed to load reports');
      var reports = await response.json();
      this._dashboardReports = reports;
      this._renderDashboardResults(reports);
    } catch (err) {
      results.innerHTML = '<p style="color:red;">' + (I18n.lang === 'zh' ? '加载报告失败：' : 'Failed to load reports: ') + err.message + '</p>';
    }
  }

  async _loadAdminSummary() {
    var root = document.getElementById('adminSummary');
    if (!root) return;
    var zh = I18n.lang === 'zh';
    root.innerHTML = '<p class="dashboard-loading">Loading…</p>';
    try {
      var days = this._adminSummaryRange || '7';
      var summary = await fetch('api/admin/dashboard/summary').then(function(res) { if (!res.ok) throw new Error(); return res.json(); });
      var workload = await fetch('api/admin/dashboard/operator-workload').then(function(res) { if (!res.ok) throw new Error(); return res.json(); });
      var activity = await fetch('api/admin/dashboard/recent-activity').then(function(res) { if (!res.ok) throw new Error(); return res.json(); });
      var trends = await fetch('api/admin/dashboard/trends?days=' + days).then(function(res) { if (!res.ok) throw new Error(); return res.json(); });
      var actions = await fetch('api/admin/dashboard/activity-summary?days=' + days).then(function(res) { if (!res.ok) throw new Error(); return res.json(); });
      var storage = await fetch('api/admin/dashboard/storage').then(function(res) { if (!res.ok) throw new Error(); return res.json(); });
      var retention = await fetch('api/admin/dashboard/retention').then(function(res) { if (!res.ok) throw new Error(); return res.json(); });
      var recentSessions = await fetch('api/admin/dashboard/recent-sessions').then(function(res) { if (!res.ok) throw new Error(); return res.json(); });
      var recentReports = await fetch('api/admin/dashboard/recent-reports').then(function(res) { if (!res.ok) throw new Error(); return res.json(); });
      var cutoff = days === 'all' ? 0 : Date.now() - Number(days) * 86400000;
      var withinDays = function(item) {
        if (days === 'all') return true;
        return new Date(item.createdAt || item.timestamp || item.date).getTime() >= cutoff;
      };
      var maxTrend = Math.max.apply(null, trends.map(function(item) { return item.reports; }).concat([1]));
      var maxWorkload = Math.max.apply(null, workload.map(function(item) { return item.reports; }).concat([1]));
      var maxAction = Math.max.apply(null, actions.map(function(item) { return item.count; }).concat([1]));
      var html = '<div class="admin-overview-toolbar"><select id="adminOverviewRange"><option value="7"' + (days === '7' ? ' selected' : '') + '>7 days</option><option value="30"' + (days === '30' ? ' selected' : '') + '>1 month</option><option value="all"' + (days === 'all' ? ' selected' : '') + '>all</option></select></div>';
      html += '<div class="admin-summary-cards">' +
        '<div class="admin-card"><strong>' + summary.totalReports + '</strong><span>' + (zh ? '总报告' : 'Total Reports') + '</span></div>' +
        '<div class="admin-card"><strong>' + summary.todayReports + '</strong><span>' + (zh ? '今日报告' : 'Today') + '</span></div>' +
        '<div class="admin-card"><strong>' + summary.totalSessions + '</strong><span>' + (zh ? 'Session 数' : 'Sessions') + '</span></div>' +
        '<div class="admin-card"><strong>' + summary.totalOperators + '</strong><span>' + (zh ? 'Operator 数' : 'Operators') + '</span></div>' +
        '<div class="admin-card"><strong>' + storage.diskUsagePercent + '%</strong><span>' + (zh ? '磁盘：已用 ' + this._formatBytes(storage.diskUsedBytes) + ' / 可用 ' + this._formatBytes(storage.diskFreeBytes) : 'Disk: ' + this._formatBytes(storage.diskUsedBytes) + ' used / ' + this._formatBytes(storage.diskFreeBytes) + ' free') + '</span></div>' +
        '<div class="admin-card"><strong>' + retention.expiring.length + '</strong><span>' + (zh ? '7天内到期' : 'Expiring Soon') + '</span></div></div>';
      html += '<div class="admin-alert-grid">';
      if (storage.diskUsagePercent >= 75) html += '<div class="admin-alert danger"><strong>' + storage.diskUsagePercent + '%</strong><span>' + (zh ? '服务器磁盘使用率较高' : 'Server disk usage is high') + '</span></div>';
      html += '<div class="admin-alert info"><strong>' + this._formatBytes(storage.last24ArchiveBytes) + '</strong><span>' + (zh ? '最近 24 小时归档大小' : 'Archived in last 24h') + '</span></div>';
      if (retention.expiring.length) html += '<div class="admin-alert warning"><strong>' + retention.expiring.length + '</strong><span>' + (zh ? '份报告将在 7 天内自动删除' : 'reports will be deleted within 7 days') + '</span></div></div>';
      html += '<div class="admin-chart-grid"><div class="admin-chart"><h4>' + (zh ? '报告趋势' : 'Report Trend') + '</h4><div class="admin-scroll-h"><div class="mini-bar-chart">' + trends.map(function(item) { return '<div class="mini-bar-item"><span>' + item.reports + '</span><i style="height:' + Math.round((item.reports / maxTrend) * 100) + '%"></i><small>' + item.date.slice(5) + '</small></div>'; }).join('') + '</div></div></div>';
      html += '<div class="admin-chart"><h4>' + (zh ? 'Operator 工作量' : 'Operator Workload') + '</h4><div class="admin-scroll-list"><div class="admin-hbar-list">' + workload.slice(0, 8).map(function(item) { return '<div class="admin-hbar-row"><strong>' + this._esc(item.operator) + '</strong><div class="admin-hbar-track"><i style="width:' + Math.round((item.reports / maxWorkload) * 100) + '%"></i></div><span>' + item.reports + '</span></div>'; }.bind(this)).join('') + '</div></div></div></div>';
      html += '<div class="admin-chart-grid"><div class="admin-chart"><h4>' + (zh ? '动作分布' : 'Action Distribution') + '</h4><div class="admin-scroll-list"><div class="mini-bar-chart horizontal">' + actions.slice(0, 8).map(function(item) { return '<div class="mini-bar-item"><span>' + item.count + '</span><i style="width:' + Math.round((item.count / maxAction) * 100) + '%"></i><small>' + this._esc(item.action) + '</small></div>'; }.bind(this)).join('') + '</div></div></div></div>';
      var filteredActivity = activity.filter(withinDays);
      if (filteredActivity.length) {
        html += '<div class="admin-summary-activity"><h4>' + (zh ? '最近活动' : 'Recent Activity') + '</h4><div class="admin-scroll-list">' + filteredActivity.slice(0, 30).map(function(item) { return '<div class="admin-activity-row"><strong>' + this._esc(item.actor || '-') + '</strong><span>' + this._esc(item.action || '-') + '</span></div>'; }.bind(this)).join('') + '</div></div>';
      }
      var filteredSessions = recentSessions.filter(withinDays);
      var filteredReports = recentReports.filter(withinDays);
      html += '<div class="admin-recent-grid">';
      html += '<div class="admin-chart"><h4>' + (zh ? '最近 Session' : 'Recent Sessions') + '</h4><div class="admin-scroll-list"><div class="admin-table-list">' + filteredSessions.map(function(item) { return '<div class="admin-table-row"><strong>' + this._esc(item.sessionId) + '</strong><span>' + this._esc(item.operator) + ' · ' + item.reports + ' ' + (zh ? '份报告' : 'reports') + '</span></div>'; }.bind(this)).join('') + '</div></div></div>';
      html += '<div class="admin-chart"><h4>' + (zh ? '最近报告' : 'Recent Reports') + '</h4><div class="admin-scroll-list"><div class="admin-table-list">' + filteredReports.map(function(item) { return '<div class="admin-table-row"><strong>' + this._esc(item.contractNo || '-') + ' · Pos' + this._esc(item.positionNo || '-') + '</strong><span>' + this._esc(item.tagNo || '-') + ' · ' + this._esc(item.operator || '-') + '</span></div>'; }.bind(this)).join('') + '</div></div></div></div>';
      root.innerHTML = html;
      document.getElementById('adminOverviewRange').onchange = function() {
        this._adminSummaryRange = document.getElementById('adminOverviewRange').value;
        this._loadAdminSummary();
      }.bind(this);
    } catch (e) {
      root.innerHTML = '<p style="color:red;">' + (zh ? '无法加载驾驶舱数据' : 'Unable to load dashboard') + '</p>';
    }
  }

  _formatBytes(bytes) {
    if (!bytes) return '0 B';
    var units = ['B', 'KB', 'MB', 'GB'];
    var value = bytes, index = 0;
    while (value >= 1024 && index < units.length - 1) { value /= 1024; index++; }
    return value.toFixed(1) + ' ' + units[index];
  }

  _renderDashboardResults(reports) {
    var results = document.getElementById('dashboardResults');
    if (!results) return;
    var zh = I18n.lang === 'zh';
    if (!reports.length) { results.innerHTML = '<p class="batch-empty">' + (zh ? '没有匹配的报告' : 'No matching reports') + '</p>'; return; }
    var html = '';
    if (this.currentUser.role === 'admin') html += '<div class="dashboard-bulk-actions"><button class="btn btn-sm btn-danger" id="deleteSelectedReports">' + (zh ? '删除选中报告' : 'Delete Selected') + '</button></div>';
    html += '<div class="dashboard-report-list">';
    reports.forEach(function(report, index) {
      var date = String(report.createdAt || '').slice(0, 10);
      html += '<div class="dashboard-report-row"><div class="dashboard-report-main">' + (this.currentUser.role === 'admin' ? '<label class="dashboard-check"><input type="checkbox" data-report-id="' + this._esc(report.id) + '" /></label>' : '') + '<strong>' + this._esc(report.contractNo || '-') + ' · Pos' + this._esc(report.positionNo || '-') + '</strong><small>' + this._esc(report.tagNo || '-') + ' · ' + this._esc(report.operator || '-') + ' · ' + date + '</small></div><div class="completed-report-actions">' +
        '<button class="btn btn-sm btn-outline" data-dashboard-view="' + index + '">' + (zh ? '查看' : 'View') + '</button>' +
        '<button class="btn btn-sm btn-outline" data-dashboard-pdf="' + index + '">PDF</button>' +
        '<button class="btn btn-sm btn-outline" data-dashboard-zip="' + index + '">ZIP</button></div></div>';
    }.bind(this));
    html += '</div>';
    results.innerHTML = html;
    results.querySelectorAll('[data-dashboard-view]').forEach(function(button) { button.onclick = function() { this._viewDashboardReport(this._dashboardReports[Number(button.dataset.dashboardView)]); }.bind(this); }.bind(this));
    results.querySelectorAll('[data-dashboard-pdf]').forEach(function(button) { button.onclick = function() { this._downloadDashboardReport(this._dashboardReports[Number(button.dataset.dashboardPdf)], 'report'); }.bind(this); }.bind(this));
    results.querySelectorAll('[data-dashboard-zip]').forEach(function(button) { button.onclick = function() { this._downloadDashboardReport(this._dashboardReports[Number(button.dataset.dashboardZip)], 'zip'); }.bind(this); }.bind(this));
    if (document.getElementById('deleteSelectedReports')) document.getElementById('deleteSelectedReports').onclick = function() { this._deleteSelectedReports(); }.bind(this);
  }

  _deleteSelectedReports() {
    var checked = Array.from(document.querySelectorAll('[data-report-id]:checked')).map(function(input) { return input.dataset.reportId; });
    if (!checked.length) { this._showToast(I18n.lang === 'zh' ? '请先选择要删除的报告' : 'Select reports to delete', 'error'); return; }
    this._confirmDanger(I18n.lang === 'zh' ? '删除报告' : 'Delete Reports', I18n.lang === 'zh' ? '将永久删除选中的 ' + checked.length + ' 份报告及照片，无法恢复。' : 'This will permanently delete ' + checked.length + ' reports and photos. This cannot be undone.', function() {
      fetch('api/reports/bulk-delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: checked, actor: this.currentUser.displayName, role: this.currentUser.role }) }).then(function(res) { return res.json(); }).then(function() { this._queryDashboardReports(); this._loadAdminSummary(); }.bind(this)).catch(function() { this._showToast(I18n.lang === 'zh' ? '删除失败' : 'Delete failed', 'error'); }.bind(this));
    }.bind(this));
  }

  _viewDashboardReport(report) {
    if (!report) return;
    this._logDashboardAction('report_viewed', report);
    window.open(report.reportUrl, '_blank');
  }

  _downloadDashboardReport(report, type) {
    if (!report) return;
    this._logDashboardAction(type === 'report' ? 'report_downloaded_pdf' : 'report_downloaded_zip', report);
    var link = document.createElement('a');
    link.href = type === 'report' ? report.reportUrl : report.downloadUrl;
    link.download = type === 'report' ? report.id + '.pdf' : report.id + '.zip';
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  async _logDashboardAction(action, report, extra) {
    try {
      await fetch('api/dashboard/audit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: action,
          actor: this.currentUser.displayName,
          role: this.currentUser.role,
          reportId: report && report.id,
          contractNo: report && report.contractNo,
          positionNo: report && report.positionNo,
          tagNo: report && report.tagNo,
          operator: report && report.operator,
          filters: this._dashboardFilters(),
          details: extra || {}
        })
      });
    } catch (e) {}
  }

  async _showAuditLog() {
    var existing = document.getElementById('auditLogPanel');
    if (existing) existing.remove();
    var zh = I18n.lang === 'zh';
    this._auditLogs = [];
    this._auditVisibleCount = 20;
    var panel = document.createElement('div');
    panel.className = 'audit-panel';
    panel.id = 'auditLogPanel';
    panel.innerHTML = '<div class="audit-panel-header"><strong>' + (zh ? '审计日志' : 'Audit Log') + '</strong><button class="btn btn-ghost" id="closeAuditPanel">✕</button></div>' +
      '<div class="audit-panel-toolbar">' +
      '<input id="auditKeyword" placeholder="' + (zh ? '搜索 IFS / Pos / Tag / 报告ID' : 'Search IFS / Pos / Tag / Report ID') + '" />' +
      '<select id="auditAction">' + ['', 'dashboard_viewed', 'report_viewed', 'report_downloaded_pdf', 'report_downloaded_zip', 'report_generated', 'session_closed', 'session_reset'].map(function(action) { return '<option value="' + action + '">' + (action || (zh ? '全部动作' : 'All Actions')) + '</option>'; }).join('') + '</select>' +
      '<button class="btn btn-sm btn-primary" id="refreshAuditLog">' + (zh ? '刷新' : 'Refresh') + '</button>' +
      '<button class="btn btn-sm btn-outline" id="copyAuditJson">JSON</button>' +
      '<button class="btn btn-sm btn-outline" id="exportAuditCsv">CSV</button>' +
      '</div><div id="auditLogList" class="audit-panel-list"></div><div class="audit-panel-actions"><button class="btn btn-sm btn-outline" id="loadMoreAudit">' + (zh ? '加载更多' : 'Load More') + '</button></div>';
    document.body.appendChild(panel);
    document.body.style.overflow = 'hidden';

    var close = function() { panel.remove(); document.body.style.overflow = ''; document.removeEventListener('keydown', onKey); };
    var onKey = function(e) { if (e.key === 'Escape') close(); };
    document.getElementById('closeAuditPanel').onclick = close;
    document.addEventListener('keydown', onKey);

    var self = this;
    var filtered = function() {
      var keyword = document.getElementById('auditKeyword').value.trim().toLowerCase();
      var action = document.getElementById('auditAction').value;
      return self._auditLogs.filter(function(item) {
        if (action && item.action !== action) return false;
        if (!keyword) return true;
        return JSON.stringify(item).toLowerCase().indexOf(keyword) >= 0;
      });
    };
    var render = function() {
      var list = document.getElementById('auditLogList');
      var items = filtered();
      var visible = items.slice(0, self._auditVisibleCount);
      list.innerHTML = visible.length ? visible.map(function(item, index) {
        return '<div class="audit-log-row" data-audit-index="' + index + '"><div><strong>' + self._esc(item.actor || '-') + '</strong><span>' + self._esc(item.action || '-') + '</span></div><small>' + self._esc(item.timestamp || '') + '</small><pre class="audit-log-detail">' + self._esc(JSON.stringify(item, null, 2)) + '</pre></div>';
      }).join('') : '<p class="batch-empty">' + (zh ? '没有匹配日志' : 'No matching logs') + '</p>';
      document.getElementById('loadMoreAudit').style.display = items.length > self._auditVisibleCount ? '' : 'none';
      list.querySelectorAll('[data-audit-index]').forEach(function(row) {
        row.onclick = function() { row.classList.toggle('expanded'); };
      });
    };
    var load = async function() {
      document.getElementById('auditLogList').innerHTML = '<p class="dashboard-loading">Loading…</p>';
      try {
        var response = await fetch('api/dashboard/audit?limit=500');
        self._auditLogs = await response.json();
        self._auditVisibleCount = 20;
        render();
      } catch (e) {
        document.getElementById('auditLogList').innerHTML = '<p style="color:red;">' + e.message + '</p>';
      }
    };
    document.getElementById('auditKeyword').oninput = render;
    document.getElementById('auditAction').onchange = render;
    document.getElementById('refreshAuditLog').onclick = load;
    document.getElementById('loadMoreAudit').onclick = function() { self._auditVisibleCount += 20; render(); };
    document.getElementById('copyAuditJson').onclick = async function() {
      var data = filtered();
      try { await navigator.clipboard.writeText(JSON.stringify(data, null, 2)); self._showToast(zh ? '已复制' : 'Copied'); } catch (e) { self._showToast(zh ? '复制失败' : 'Copy failed', 'error'); }
    };
    document.getElementById('exportAuditCsv').onclick = function() {
      var data = filtered();
      var headers = ['timestamp', 'actor', 'role', 'action', 'reportId', 'contractNo', 'positionNo', 'tagNo'];
      var rows = data.map(function(item) { return headers.map(function(h) { return '"' + String(item[h] || '').replace(/"/g, '""') + '"'; }).join(','); });
      var csv = headers.join(',') + '\n' + rows.join('\n');
      var blob = new Blob([csv], { type: 'text/csv' });
      var url = URL.createObjectURL(blob);
      var link = document.createElement('a'); link.href = url; link.download = 'audit-log.csv'; link.click(); URL.revokeObjectURL(url);
    };
    await load();
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
    document.getElementById('btnRefreshCurrent').onclick = () => this._confirmDanger(
      I18n.lang === 'zh' ? '刷新当前阀门' : 'Refresh Current Valve',
      I18n.lang === 'zh' ? '将清空当前阀门的全部照片和拍照范围，并回到基础信息页。此操作不可撤销。' : 'This will clear all photos and photo scope for the current valve and return to Basic Info. This cannot be undone.',
      () => this._refreshCurrentValve());
    document.getElementById('btnResetSession').onclick = () => this._confirmDanger(
      I18n.lang === 'zh' ? '重置 Session' : 'Reset Session',
      I18n.lang === 'zh' ? '将清空本轮 Session 的全部阀门、照片、报告和进度，并创建新的 Session。此操作不可撤销。' : 'This will clear all valves, photos, reports and progress in this Session and create a new Session. This cannot be undone.',
      () => this._resetSession());
    document.getElementById('btnCloseSession').onclick = () => this._confirmDanger(
      I18n.lang === 'zh' ? '关闭 Session' : 'Close Session',
      I18n.lang === 'zh' ? '确认完成本轮拍照任务？关闭后将显示 Session ID、阀门清单和下载入口。此操作代表本轮任务结束。' : 'Finish this capture session? After closing, the Session ID, valve list and download links will be shown.',
      () => this._closeSession());
    document.getElementById('btnRoleSwitch').onclick = () => this._showRolePicker();
    var completedBtn = document.getElementById('btnCompletedReports');
    if (completedBtn) completedBtn.onclick = () => this._showCompletedReports();
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

  _updateCompletedButton() {
    var btn = document.getElementById('btnCompletedReports');
    if (!btn) return;
    var count = this.batch ? this.batch.valves.filter(function(v) { return !!v.serverArchive; }).length : 0;
    btn.textContent = I18n.lang === 'zh' ? '已完成 ' + count : 'Completed ' + count;
  }

  _confirmDanger(title, message, action) {
    var modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = '<div class="modal-content appearance-scope-prompt"><h3>' + this._esc(title) + '</h3><p>' + this._esc(message) + '</p><div class="appearance-prompt-actions"><button class="btn btn-primary" id="dangerConfirm">' + (I18n.lang === 'zh' ? '确认执行' : 'Confirm') + '</button><button class="btn btn-ghost" id="dangerCancel">' + (I18n.lang === 'zh' ? '取消' : 'Cancel') + '</button></div></div>';
    document.body.appendChild(modal);
    document.getElementById('dangerCancel').onclick = function() { modal.remove(); };
    document.getElementById('dangerConfirm').onclick = function() { modal.remove(); action(); };
  }

  _refreshCurrentValve() {
    var identity = {
      contractNo: this.data.contractNo, ifsNo: this.data.ifsNo,
      positionNo: this.data.positionNo, tagNo: this.data.tagNo,
      serialNo: this.data.serialNo, valveType: this.data.valveType,
      recorder: this.data.recorder
    };
    this._log('current_valve_refreshed', identity);
      this.data = this._defaultData();
    Object.assign(this.data, identity);
    this._appearancePromptHandled = false;
    this.data._scopeInherited = false;
    this.currentStep = 1;
    this._persistActiveValve();
    this.render();
  }

  _archiveAuditLog() {
    if (!this.batch) return;
    try {
      var audit = JSON.parse(localStorage.getItem('samson_session_audit_log') || '[]');
      audit.push({ sessionId: this.batch.id, closedAt: new Date().toISOString(), logs: this.batch.logs || [] });
      localStorage.setItem('samson_session_audit_log', JSON.stringify(audit.slice(-50)));
    } catch (e) {}
  }

  _resetSession() {
    this._log('session_reset');
    this._archiveAuditLog();
    this.batch = this._newSession();
    this.activeValveId = '';
    this.data = this._defaultData();
    this._appearancePromptHandled = false;
    this.currentStep = 1;
    this._saveBatch();
    this.render();
  }

  _closeSession() {
    this._persistActiveValve();
    this._log('session_closed', { valveCount: this.batch.valves.length });
    this.batch.status = 'closed';
    this.batch.closedAt = new Date().toISOString();
    this._archiveAuditLog();
    this._saveBatch();
    var zh = I18n.lang === 'zh';
    var modal = document.createElement('div');
    modal.className = 'modal';
    var html = '<div class="modal-content completed-reports-modal"><h3>' + (zh ? 'Session 已关闭' : 'Session Closed') + '</h3><p><strong>Session ID:</strong> ' + this._esc(this.batch.id) + '</p>';
    html += '<p class="role-note">' + (zh ? '报告和照片将在服务器上保存 30 个自然日，到期后永久删除。请及时下载。' : 'Reports and photos are kept on the server for 30 calendar days, then permanently deleted. Please download promptly.') + '</p>';
    if (this.batch.valves.length) {
      this.batch.valves.forEach(function(valve) {
        html += '<div class="completed-report-row"><div><strong>Pos' + this._normalizePosNumber(valve.positionNo) + '</strong><small>' + this._esc(valve.tagNo || valve.serialNo) + '</small></div><div class="completed-report-actions">';
        if (valve.serverArchive) {
          html += '<a class="btn btn-sm btn-outline" href="' + valve.serverArchive.reportUrl + '" download>PDF</a><a class="btn btn-sm btn-outline" href="' + valve.serverArchive.downloadUrl + '" download>ZIP</a>';
        } else {
          html += '<span>' + this._statusLabel(this._calculateValveStatus(valve)) + '</span>';
        }
        html += '</div></div>';
      }.bind(this));
    } else {
      html += '<p class="completed-empty">' + (zh ? '本轮没有阀门记录。' : 'No valves in this session.') + '</p>';
    }
    html += '<div class="appearance-prompt-actions"><button class="btn btn-primary" id="closeSessionDialog">' + (zh ? '关闭' : 'Close') + '</button></div></div>';
    modal.innerHTML = html;
    document.body.appendChild(modal);
    document.getElementById('closeSessionDialog').onclick = function() {
      modal.remove();
      this._authenticated = false;
      this.activeValveId = '';
      this.batch.activeValveId = '';
      this._saveBatch();
      this.currentStep = 1;
      this._roleDashboard = false;
      this.render();
      this._showRolePicker();
    }.bind(this);
  }

  // ── Auto-save ──────────────────────────────
  _autoSave() {
    const d = Object.assign({}, this.data, { _currentStep: this.currentStep });
    SamsonStorage.saveDraft(d);
    if (this.activeValveId && this.currentStep > 0) this._persistActiveValve();
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
    var sessionCount = this.batch ? this.batch.valves.length : 0;
    var sessionId = this.batch ? this.batch.id : '-';
    document.getElementById('appSubtitle').textContent = this.t('appSubtitle');
    document.getElementById('sessionProgressBadge').textContent = I18n.lang === 'zh'
      ? 'Session: ' + sessionId + ' · 本轮 ' + sessionCount + '/10(Max)'
      : 'Session: ' + sessionId + ' · ' + sessionCount + '/10(Max)';
    document.getElementById('langToggle').textContent = I18n.t('langSwitch');
    document.getElementById('btnRoleSwitch').textContent = this.currentUser.displayName + ' · ' + this._roleLabel(this.currentUser.role);
    this._updateCompletedButton();
    var operatorSessionActive = this._authenticated && this.currentUser.role === 'operator' && !this._roleDashboard &&
      this.batch && this.batch.status !== 'closed';
    document.getElementById('btnCompletedReports').style.display = operatorSessionActive ? '' : 'none';
    document.getElementById('sessionProgressBadge').style.display = operatorSessionActive ? '' : 'none';
    document.getElementById('sessionToolbar').style.display =
      this._authenticated && this.currentUser.role === 'operator' && !this._roleDashboard && this.batch && this.batch.status !== 'closed' ? 'flex' : 'none';
    document.getElementById('btnRefreshCurrent').textContent = I18n.lang === 'zh' ? '刷新' : 'Refresh';
    document.getElementById('btnResetSession').textContent = I18n.lang === 'zh' ? '重置' : 'Reset';
    document.getElementById('btnCloseSession').textContent = I18n.lang === 'zh' ? '关闭' : 'Close';

    const dots = document.getElementById('stepIndicators');
    dots.style.display = 'flex';
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
    if (this._roleDashboard) { this._renderRoleDashboard(c); return; }
    switch (this.currentStep) {
      case 0: this._renderValveQueue(c); break;
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
    if (this._roleDashboard) return;

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
    if (this.currentStep === 1) {
      this._saveInputHistory();
      var prepared = this._prepareCurrentValve();
      if (!prepared) return;
      if (prepared.isNew && prepared.previous) {
        this._showScopeInheritancePrompt(prepared.valve, prepared.previous, function(inherited) {
          this.currentStep = inherited ? 4 : 2;
          this.render();
        }.bind(this));
        return;
      }
      if (this.data._scopeInherited) {
        this.currentStep = 4;
        this.render();
        return;
      }
    }
    if ((this.currentStep === 2 || this.currentStep === 3) && this.data._scopeInherited) {
      this.currentStep = 4;
      this.render();
      return;
    }
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
      const requiredFields = [
        ['contractNo', 'contractNo'],
        ['positionNo', 'positionNo'],
        ['tagNo', 'tagNo'],
        ['valveType', 'valveType'],
        ['recorder', 'recorder']
      ];
      const missing = requiredFields.filter(function(field) {
        return !String(d[field[0]] || '').trim();
      }).map(function(field) { return this.t(field[1]); }.bind(this));
      if (missing.length > 0) {
        this._showToast(this.t('missingFields') + ': ' + missing.join(' / '), 'error');
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
      { key: 'contractNo',   label: this.t('contractNo'),   required: true },
      { key: 'positionNo',   label: this.t('positionNo'),   required: true },
      { key: 'tagNo',        label: this.t('tagNo'),        required: true },
      { key: 'serialNo',     label: this.t('serialNo'),     required: false },
      { key: 'valveType',    label: this.t('valveType'),    required: true },
      { key: 'recorder',     label: this.t('recorder'),     required: true },
    ];

    let html = '<div class="step1-form">';

    fields.forEach((f, idx) => {
      const val = this.data[f.key] || '';
      html += '<div class="form-group"><label>' + f.label + (f.required ? ' <span class="required">*</span>' : '') + '</label>';

      if (f.key === 'positionNo') {
        html += '<div class="quick-values">' + ['001','002','003','004'].map(function(value) { return '<button type="button" class="quick-chip" data-pos="' + value + '">' + value + '</button>'; }).join('') + '</div>';
      }
      if (f.key === 'tagNo') {
        html += '<div class="quick-values">' + ['HV-','PV-','LV-','TV-'].map(function(value) { return '<button type="button" class="quick-chip" data-tag-value="' + value + '">' + value + '</button>'; }).join('') + '</div>';
      }
      if (f.key === 'valveType') {
        html += '<div class="quick-values">' + ['3241','3251','3248','Ltr43-2'].map(function(value) { return '<button type="button" class="quick-chip" data-type="' + value + '">' + value + '</button>'; }).join('') + '</div>';
      }

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

    c.querySelectorAll('[data-pos]').forEach(function(button) {
      button.onclick = function() { self.data.positionNo = button.dataset.pos; self.render(); };
    });
    c.querySelectorAll('[data-tag-value]').forEach(function(button) {
      button.onclick = function() {
        var input = document.getElementById('input_tagNo');
        var start = typeof input.selectionStart === 'number' ? input.selectionStart : input.value.length;
        var end = typeof input.selectionEnd === 'number' ? input.selectionEnd : start;
        input.value = input.value.slice(0, start) + button.dataset.tagValue + input.value.slice(end);
        var caret = start + button.dataset.tagValue.length;
        self.data.tagNo = input.value;
        input.focus();
        input.setSelectionRange(caret, caret);
        self._autoSave();
      };
    });
    c.querySelectorAll('[data-type]').forEach(function(button) {
      button.onclick = function() { self.data.valveType = button.dataset.type; self.render(); };
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
    html += `<div class="acc-item${acc.cleaningLabel ? ' checked' : ''}" data-key="cleaningLabel">
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
        el.classList.toggle('checked', chk.checked);
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
          el.classList.remove('checked');
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
        cleanRow.classList.toggle('checked', cleanChk.checked);
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
        else { cleanChk.checked = false; cleanRow.classList.remove('checked'); this.data.accessories.cleaningLabel = false; cleanStepper.style.display = 'none'; this._autoSave(); }
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
      <div class="acc-item${it.selected ? ' checked' : ''}" data-key="${it.key}">
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

    if (!this.data._scopeInherited && !this._appearancePromptHandled) this._showAppearanceScopePrompt();
  }

  _showAppearanceScopePrompt() {
    var existing = document.getElementById('appearanceScopePrompt');
    if (existing) existing.remove();

    var modal = document.createElement('div');
    modal.id = 'appearanceScopePrompt';
    modal.className = 'modal';
    modal.innerHTML = `
      <div class="modal-content appearance-scope-prompt">
        <h3>${this.t('appearancePromptTitle')}</h3>
        <p>${this.t('appearancePromptMessage')}</p>
        <div class="appearance-prompt-actions">
          <button class="btn btn-primary" id="appearancePromptChoose">${this.t('appearancePromptChoose')}</button>
          <button class="btn btn-outline" id="appearancePromptSkip">${this.t('appearancePromptSkip')}</button>
        </div>
      </div>`;
    document.body.appendChild(modal);

    var choose = document.getElementById('appearancePromptChoose');
    var skip = document.getElementById('appearancePromptSkip');
    choose.onclick = function() {
      this._appearancePromptHandled = true;
      modal.remove();
    }.bind(this);
    skip.onclick = function() {
      this._appearancePromptHandled = true;
      this.data.appearance.flowDirection = false;
      this.data.appearance.pressureGauge = false;
      this.data.appearance.flangeWaterline = false;
      this.data.appearance.internalCleanliness = false;
      this.data.appearance.otherAppearance = [];
      this.data.appearancePhotos = {};
      modal.remove();
      this.currentStep = 4;
      this.render();
    }.bind(this);
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
        <button class="btn btn-primary" id="btnGenerateReport">${I18n.lang === 'zh' ? '生成报告' : 'Generate Report'}</button>
        <button class="btn btn-primary is-disabled" id="btnSaveNextValve" data-disabled="true">${I18n.lang === 'zh' ? '继续拍照下一台' : 'Continue to Next Valve'}</button>
      </div>
      <div id="genStatus" class="gen-status"></div>
    </div>`;
    c.innerHTML = html;

    document.getElementById('btnPreview').onclick = () => this._previewReport(fileName);
    document.getElementById('btnGenerateReport').onclick = () => this._generateServerReport(fileName);
    document.getElementById('btnSaveNextValve').onclick = () => this._saveAndNextValve();

    var status = document.getElementById('genStatus');
    var active = this._getActiveValve();
    if (active && active.serverArchive) {
      if (status) status.innerHTML = '<p style="color:green;">' + (I18n.lang === 'zh' ? '照片报告已生成，暂存服务器，请尽快下载。' : 'Report generated and archived. Please download soon.') + '</p>';
      document.getElementById('btnSaveNextValve').classList.remove('is-disabled');
      document.getElementById('btnSaveNextValve').setAttribute('data-disabled', 'false');
      document.getElementById('btnGenerateReport').disabled = true;
      this._updateCompletedButton();
    } else if (status) {
      status.innerHTML = '<p>' + (I18n.lang === 'zh' ? '请先预览报告，然后生成报告，最后继续下一台拍照。' : 'Preview the report first, then generate it, and finally continue to the next valve.') + '</p>';
    }
  }

  async _generateServerReport(fileName) {
    var status = document.getElementById('genStatus');
    if (status) status.innerHTML = '<p>' + (I18n.lang === 'zh' ? '正在生成报告并归档服务器…' : 'Generating and archiving report…') + '</p>';
    var archive = await this._ensureServerArchive(fileName);
    if (!archive) return;
    if (status) status.innerHTML = '<p style="color:green;">✅ ' + (I18n.lang === 'zh' ? '照片报告已生成，暂存服务器，请尽快下载。' : 'Report generated and archived. Please download soon.') + '</p>';
    document.getElementById('btnSaveNextValve').classList.remove('is-disabled');
    document.getElementById('btnSaveNextValve').setAttribute('data-disabled', 'false');
    document.getElementById('btnGenerateReport').disabled = true;
    this._updateCompletedButton();
  }

  _downloadArchivedFile(type, fileName) {
    var active = this._getActiveValve();
    if (!active || !active.serverArchive) return;
    var url = type === 'report' ? active.serverArchive.reportUrl : active.serverArchive.downloadUrl;
    this._log(type === 'report' ? 'report_downloaded' : 'photos_downloaded', { reportName: active.serverArchive.reportName });
    var link = document.createElement('a');
    link.href = url;
    link.download = type === 'report' ? fileName : active.serverArchive.reportName + '.zip';
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  _genReportFileName() {
    var d = new Date();
    var ds = d.getFullYear() + ('0' + (d.getMonth()+1)).slice(-2) + ('0' + d.getDate()).slice(-2);
    var reportNo = 'PR_' + this._reportFilePart(this.data.contractNo) +
      '_Pos' + this._reportFilePart(this.data.positionNo) +
      '_' + this._reportFilePart(this.data.tagNo || this.data.serialNo) + '_' + ds;
    return reportNo + '.pdf';
  }

  _reportFilePart(value) {
    return String(value || 'NA').trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '-') || 'NA';
  }

  _photoFilePart(value) {
    return String(value || 'Photo').trim().replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'Photo';
  }

  _imageExtension(dataURL) {
    return /^data:image\/png/i.test(dataURL || '') ? '.png' : '.jpg';
  }

  _collectReportPhotos() {
    var photos = [];
    var sequence = 1;
    var add = function(key, label, dataURL) {
      if (!dataURL) return;
      var number = ('0' + sequence).slice(-2);
      photos.push({
        key: key,
        filename: number + '_' + this._photoFilePart(label) + this._imageExtension(dataURL),
        dataURL: dataURL
      });
      sequence++;
    }.bind(this);

    var valveFields = [
      ['frontView', 'Valve_Front_View'],
      ['rightView', 'Valve_Right_View'],
      ['leftView', 'Valve_Left_View'],
      ['rearView', 'Valve_Rear_View'],
      ['valveNameplate', 'Valve_Nameplate'],
      ['tagNameplate', 'Tag_Nameplate'],
      ['actuatorNameplate', 'Actuator_Nameplate']
    ];
    valveFields.forEach(function(field) {
      add(field[0], field[1], this.data.valvePhotos[field[0]]);
    }.bind(this));

    this._getAllAppearanceItems().forEach(function(item) {
      add(item.key, 'Appearance_' + (item.enLabel || item.label), this._getAppearancePhoto(item.accKey, item.idx, item.type));
    }.bind(this));

    this._getAllAccessoryItems().forEach(function(item) {
      var base = item.enLabel || item.label;
      if (item.type === 'nameplate') base = base.replace(/ Nameplate$/i, '') + '_Nameplate';
      else base = base + '_Photo';
      add(item.key, 'Accessory_' + base, this._getAccessoryPhoto(item.accKey, item.idx, item.type));
    }.bind(this));
    return photos;
  }

  async _saveAndDownload(fileName) {
    const status = document.getElementById('genStatus');
    if (status) status.innerHTML = `<p>${I18n.lang === 'zh' ? '正在确认服务器归档...' : 'Checking server archive...'}</p>`;
    var archive = await this._ensureServerArchive(fileName);
    if (!archive) return null;
    if (status) status.innerHTML = `<p style="color:green;">✅ ${this.t('saved')}</p>`;
    var download = document.createElement('a');
    download.href = archive.downloadUrl;
    download.download = archive.reportName + '.zip';
    document.body.appendChild(download);
    download.click();
    download.remove();
    return archive;
  }

  _ensureServerArchive(fileName) {
    var valve = this._getActiveValve();
    if (valve && valve.serverArchive) return Promise.resolve(valve.serverArchive);
    if (valve && this._archivePromises[valve.id]) return this._archivePromises[valve.id];

    var work = (async function() {
      var reportName = fileName.replace(/\.pdf$/i, '');
      var images = {};
      var uploads = [];
      var pdfDoc = await this._buildPDF();
      uploads.push(SamsonStorage.uploadImage(pdfDoc.output('blob'), reportName, reportName + '.pdf')
        .then(function(result) { images.reportPdf = result.filename; }));
      this._collectReportPhotos().forEach(function(photo) {
        uploads.push(this._uploadDataURL(photo.dataURL, reportName, photo.filename)
          .then(function(filename) { images[photo.key] = filename; }));
      }.bind(this));
      await Promise.all(uploads);
      var meta = {
        contractNo: this.data.contractNo,
        ifsNo: this.data.ifsNo,
        positionNo: this.data.positionNo,
        tagNo: this.data.tagNo,
        serialNo: this.data.serialNo,
        valveType: this.data.valveType,
        recorder: this.data.recorder,
        accessories: this.data.accessories,
        appearance: this.data.appearance,
        operatorId: this.currentUser.username,
        operatorName: this.currentUser.displayName,
        sessionId: this.batch ? this.batch.id : ''
      };
      var result = await SamsonStorage.saveReport(meta, images, reportName);
      var archive = {
        id: result.id,
        reportName: result.reportName,
        downloadUrl: result.downloadUrl,
        reportUrl: result.reportUrl,
        archivedAt: new Date().toISOString()
      };
      if (valve) {
        valve.serverArchive = archive;
        valve.reportGenerated = true;
        valve.data = this.data;
        this._log('report_generated', { reportName: reportName, archiveId: result.id });
        this._saveBatch();
        this._updateCompletedButton();
      }
      return archive;
    }.bind(this))();

    if (valve) {
      this._archivePromises[valve.id] = work;
      work.finally(function() { delete this._archivePromises[valve.id]; }.bind(this));
    }
    return work.catch(function(err) {
      var status = document.getElementById('genStatus');
      if (status) status.innerHTML = `<p style="color:red;">${this.t('errorUpload')}: ${err.message}</p>`;
      this._showToast(this.t('errorUpload') + ': ' + err.message, 'error');
      return null;
    }.bind(this));
  }

  _showCompletedReports() {
    var completed = (this.batch ? this.batch.valves : []).filter(function(valve) { return !!valve.serverArchive; });
    var modal = document.createElement('div');
    modal.className = 'modal';
    modal.id = 'completedReportsModal';
    var zh = I18n.lang === 'zh';
    var html = '<div class="modal-content completed-reports-modal"><h3>' + (zh ? '已完成报告' : 'Completed Reports') + '</h3>';
    if (!completed.length) {
      html += '<p class="completed-empty">' + (zh ? '当前还没有已归档的阀门报告。' : 'No archived valve reports yet.') + '</p>';
    } else {
      completed.forEach(function(valve) {
        var code = 'Pos' + this._normalizePosNumber(valve.positionNo);
        html += '<div class="completed-report-row"><div><strong>' + this._esc(valve.ifsOrderNo) + ' · ' + code + '</strong><small>' + this._esc(valve.tagNo || valve.serialNo) + '</small></div><div class="completed-report-actions"><a class="btn btn-sm btn-outline" href="' + valve.serverArchive.reportUrl + '" download>PDF</a><a class="btn btn-sm btn-outline" href="' + valve.serverArchive.downloadUrl + '" download>' + (zh ? '照片 ZIP' : 'Photos ZIP') + '</a></div></div>';
      }.bind(this));
    }
    html += '<div class="appearance-prompt-actions">';
    if (completed.length) html += '<button class="btn btn-primary" id="downloadSessionPackage">' + (zh ? '下载整个 Session' : 'Download Entire Session') + '</button>';
    html += '<button class="btn btn-outline" id="closeCompletedReports">' + (zh ? '关闭' : 'Close') + '</button></div></div>';
    modal.innerHTML = html;
    document.body.appendChild(modal);
    document.getElementById('closeCompletedReports').onclick = function() { modal.remove(); };
    if (document.getElementById('downloadSessionPackage')) document.getElementById('downloadSessionPackage').onclick = function() { this._downloadSessionPackage(completed); }.bind(this);
  }

  async _downloadSessionPackage(completed) {
    if (!completed || !completed.length) return;
    var status = document.getElementById('genStatus');
    if (status) status.innerHTML = '<p>' + (I18n.lang === 'zh' ? '正在打包整个 Session…' : 'Packaging entire session…') + '</p>';
    try {
      var response = await fetch('api/sessions/package', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: this.batch.id,
          reports: completed.map(function(valve) { return valve.serverArchive.id; })
        })
      });
      if (!response.ok) throw new Error('Session package failed');
      var result = await response.json();
      this._log('session_package_downloaded', { sessionId: this.batch.id, reports: completed.map(function(v) { return v.serverArchive.id; }) });
      var link = document.createElement('a');
      link.href = result.downloadUrl;
      link.download = result.sessionId + '.zip';
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (err) {
      this._showToast((I18n.lang === 'zh' ? 'Session 打包失败: ' : 'Session package failed: ') + err.message, 'error');
    }
  }

  async _uploadDataURL(dataURL, reportName, filename) {
    const blob = this._dataURLtoBlob(dataURL);
    const result = await SamsonStorage.uploadImage(blob, reportName, filename);
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
    this._log('report_previewed', { reportName: fileName.replace(/\.pdf$/i, '') });
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
    var doc = new jsPDF({ orientation: 'p', unit: 'pt', format: 'a4' });
    doc.setProperties({
      title: 'Photo Report_Q2047',
      author: 'SAMSON CONTROLS (CHINA) CO., LTD.',
      subject: 'unspecified',
      creator: 'anonymous'
    });
    var pageW = 595.2756;
    var pageH = 841.8898;
    var Y = function(pdfY) { return pageH - pdfY; };
    var now = new Date();
    var reportDate = now.getFullYear() + '-' + ('0' + (now.getMonth() + 1)).slice(-2) + '-' + ('0' + now.getDate()).slice(-2);
    var reportNo = this._genReportFileName().replace(/\.pdf$/i, '');
    var imageCache = new Map();

    var loadImage = function(dataURL) {
      if (!dataURL) return Promise.resolve(null);
      if (!imageCache.has(dataURL)) {
        imageCache.set(dataURL, new Promise(function(resolve) {
          var img = new Image();
          img.onload = function() { resolve(img); };
          img.onerror = function() { resolve(null); };
          img.src = dataURL;
        }));
      }
      return imageCache.get(dataURL);
    };

    var drawContainedImage = async function(dataURL, box, label, captionGap) {
      if (!dataURL) return;
      var img = await loadImage(dataURL);
      if (!img) return;
      var ratio = img.width / img.height;
      var boxRatio = box.w / box.h;
      var drawW = ratio > boxRatio ? box.w : box.h * ratio;
      var drawH = ratio > boxRatio ? box.w / ratio : box.h;
      var drawX = box.x + (box.w - drawW) / 2;
      var drawY = box.y + (box.h - drawH) / 2;
      var format = /^data:image\/png/i.test(dataURL) ? 'PNG' : 'JPEG';
      doc.addImage(dataURL, format, drawX, drawY, drawW, drawH);
      if (label) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);
        doc.setTextColor(0, 0, 0);
        doc.text(label, box.x + box.w / 2, drawY + drawH + (captionGap || 8), { align: 'center' });
      }
    };

    var boxWithWidth = function(box, width) {
      var h = box.h * (width / box.w);
      var x = box.x + (box.w - width) / 2;
      var y = box.y + (box.h - h) / 2;
      return { x: x, y: y, w: width, h: h };
    };

    var centeredBox = function(box, width, height, anchorBottom) {
      var x = box.x + (box.w - width) / 2;
      var y = anchorBottom ? box.y + box.h - height : box.y + (box.h - height) / 2;
      return { x: x, y: y, w: width, h: height };
    };

    var photoSize = { w: 128.8189, h: 171.7585 };

    var drawRule = function(pdfY) {
      doc.setDrawColor(204, 204, 204);
      doc.setLineWidth(0.5);
      doc.line(25, Y(pdfY), 570.2756, Y(pdfY));
    };

    try {
      // Header — coordinates reproduced from the approved PDF.
      await drawContainedImage('assets/samson-logo.jpg', {
        x: 513.5827, y: 14.3071, w: 56.69291, h: 56.69291
      }, null, 0);

      doc.setFont('helvetica', 'normal');
      doc.setTextColor(0, 0, 0);
      doc.setFontSize(14);
      doc.text('Photo Report_Q2047', 25, Y(774.9));
      drawRule(735.8898);

      doc.setFontSize(14);
      doc.text('Report Information', pageW / 2, Y(723.9), { align: 'center' });
      doc.setFontSize(9);
      doc.text('Contract / IFS No.: ' + (this.data.contractNo || '-'), 45, Y(703.9));
      doc.text('Valve Type: ' + (this.data.valveType || '-'), 285, Y(703.9));
      doc.text('Position No.: ' + (this.data.positionNo || '-'), 45, Y(689.9));
      doc.text('Recorder: ' + (this.data.recorder || '-'), 285, Y(689.9));
      doc.text('Tag No.: ' + (this.data.tagNo || '-'), 45, Y(675.9));
      doc.text('Date: ' + reportDate, 285, Y(675.9));
      doc.text('Report No.: ' + reportNo, 45, Y(661.9));

      drawRule(625.8898);
      doc.setFontSize(10);
      doc.text('Valve Photos', pageW / 2, Y(611.9), { align: 'center' });

      var valveViewKeys = ['frontView', 'rightView', 'leftView', 'rearView'];
      var valveViewLabels = ['Front View', 'Right View', 'Left View', 'Rear View'];
      var valveViewX = [49.16405, 186.4829, 323.8018, 461.1207];
      var valveViewTop = Y(480.5687 + 113.3211);
      for (var vi = 0; vi < valveViewKeys.length; vi++) {
        var valveViewBox = centeredBox({
          x: valveViewX[vi], y: valveViewTop, w: 84.9908, h: 113.3211
        }, photoSize.w, photoSize.h, false);
        valveViewBox.y = 238;
        await drawContainedImage(this.data.valvePhotos[valveViewKeys[vi]], valveViewBox,
          valveViewLabels[vi], 7);
      }

      var nameplateKeys = ['valveNameplate', 'tagNameplate', 'actuatorNameplate'];
      var nameplateLabels = ['Valve Nameplate', 'Tag Nameplate', 'Actuator Nameplate'];
      var nameplateX = [25, 162.3189, 299.6378];
      var nameplateTop = Y(390.6376 + 46.54109);
      for (var ni = 0; ni < nameplateKeys.length; ni++) {
        var nameplateBox = boxWithWidth({
          x: nameplateX[ni], y: nameplateTop, w: 133.3189, h: 46.54109
        }, photoSize.w);
        nameplateBox.y = 425;
        await drawContainedImage(this.data.valvePhotos[nameplateKeys[ni]], nameplateBox,
          nameplateLabels[ni], 6);
      }

      drawRule(351.8898);
      doc.setFontSize(10);
      doc.text('Accessory Photos', pageW / 2, Y(337.8898), { align: 'center' });

      var accessoryBoxes = [
        { x: 49.16405, y: Y(189.9266 + 113.3211), w: 84.9908, h: 113.3211 },
        { x: 162.3189, y: Y(196.5925 + 99.98917), w: 133.3189, h: 99.98917 },
        { x: 323.8018, y: Y(189.9266 + 113.3211), w: 84.9908, h: 113.3211 },
        { x: 461.1207, y: Y(189.9266 + 113.3211), w: 84.9908, h: 113.3211 }
      ];
      var accessoryItems = this._getAllAccessoryItems().map(function(item) {
        var label = item.enLabel || item.label;
        if (item.type === 'nameplate') label = label.replace(/ Nameplate$/i, '') + ' - Nameplate';
        else label = label + ' - Photo';
        return {
          dataURL: this._getAccessoryPhoto(item.accKey, item.idx, item.type),
          label: label,
          type: item.type
        };
      }.bind(this)).filter(function(item) { return !!item.dataURL; });

      for (var ai = 0; ai < Math.min(accessoryItems.length, accessoryBoxes.length); ai++) {
        var accessoryBox = accessoryItems[ai].type === 'nameplate'
          ? boxWithWidth(accessoryBoxes[ai], photoSize.w)
          : centeredBox(accessoryBoxes[ai], photoSize.w, photoSize.h, false);
        if (accessoryItems[ai].type !== 'nameplate') accessoryBox.y = 516;
        await drawContainedImage(accessoryItems[ai].dataURL, accessoryBox,
          accessoryItems[ai].label, 7);
      }

      drawRule(129);
      if (this.data.accessories.cleaningLabel) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.text('Cleanliness Requirement Label: ' + (this.data.accessories.cleaningQty || 1) + ' pc(s)', 25, Y(116));
      }

      // Overflow protection: preserve the approved first page and continue with the same 4-column geometry.
      var overflow = [];
      var appearanceItems = this._getAllAppearanceItems().map(function(item) {
        return {
          dataURL: this._getAppearancePhoto(item.accKey, item.idx, item.type),
          label: item.enLabel || item.label
        };
      }.bind(this)).filter(function(item) { return !!item.dataURL; });
      if (appearanceItems.length) overflow.push({ title: 'Appearance Photos', items: appearanceItems });
      if (accessoryItems.length > 4) overflow.push({ title: 'Accessory Photos (continued)', items: accessoryItems.slice(4) });

      for (var oi = 0; oi < overflow.length; oi++) {
        doc.addPage();
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(0, 0, 0);
        doc.setFontSize(14);
        doc.text('Photo Report_Q2047', 25, 67);
        drawRule(735.8898);
        doc.setFontSize(10);
        doc.text(overflow[oi].title, pageW / 2, 118, { align: 'center' });
        var overflowItems = overflow[oi].items;
        for (var xi = 0; xi < overflowItems.length; xi++) {
          if (xi > 0 && xi % 4 === 0) {
            doc.addPage();
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(0, 0, 0);
            doc.setFontSize(14);
            doc.text('Photo Report_Q2047', 25, 67);
            drawRule(735.8898);
            doc.setFontSize(10);
            doc.text(overflow[oi].title, pageW / 2, 118, { align: 'center' });
          }
          var col = xi % 4;
          var row = Math.floor(xi / 4) % 2;
          var oiX = 25 + col * (photoSize.w + 10);
          var oiY = 145 + row * (photoSize.h + 14);
          var overflowBox = { x: oiX, y: oiY, w: photoSize.w, h: photoSize.h };
          if (overflowItems[xi].type === 'nameplate') {
            var refBox = accessoryBoxes[col];
            overflowBox = boxWithWidth(refBox, photoSize.w);
            overflowBox.x = oiX + (photoSize.w - overflowBox.w) / 2;
            overflowBox.y = oiY + (photoSize.h - overflowBox.h) / 2;
          }
          await drawContainedImage(overflowItems[xi].dataURL, overflowBox,
            overflowItems[xi].label, 7);
        }
      }

      var pageCount = doc.internal.getNumberOfPages();
      for (var pi = 1; pi <= pageCount; pi++) {
        doc.setPage(pi);
        drawRule(42);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);
        doc.setTextColor(0, 0, 0);
        doc.text('SAMSON CONTROLS (CHINA) CO., LTD. Beijing, China', 25, Y(30));
        doc.text(pi + ' / ' + pageCount, 570.2756, Y(30), { align: 'right' });
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
