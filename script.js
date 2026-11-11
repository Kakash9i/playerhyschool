/**
 * HYSCHOOL PLAYER — Cloud Admin Panel Script
 * Direct Firebase Realtime Database Sync (https://media-3a958-default-rtdb.europe-west1.firebasedatabase.app)
 * Includes: Customer & Multi-Device Management + Hyschool App Auto-Updater Manager
 */
(function () {
  if (window.__HYSCHOOL_ADMIN_INIT__) return;
  window.__HYSCHOOL_ADMIN_INIT__ = true;

  const FIREBASE_URL = 'https://media-3a958-default-rtdb.europe-west1.firebasedatabase.app';
  const ADMIN_PASS_DEFAULT = '123123';

  let allUsers = [];
  let rawUsersMap = {};
  let pendingResetHwids = false;
  let pollTimer = null;
  let currentAppUpdate = {
    version: '0.9.0',
    url: 'https://kakash9i.github.io/Hyschool_Player.exe',
    notes: 'Neue Verbesserungen, 33 Profil-Avatare, TMDB-Integration & Bugfixes.',
    active: false,
    updatedAt: '-',
  };

  function showToast(msg, isError = false) {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.style.borderLeftColor = isError ? '#ef4444' : '#facc15';
    t.style.display = 'block';
    clearTimeout(window.__toastTimer);
    window.__toastTimer = setTimeout(() => {
      t.style.display = 'none';
    }, 3500);
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function normalizeUserRecord(key, u) {
    const hwids = Array.isArray(u.hwids)
      ? u.hwids.filter(Boolean)
      : u.hwid
      ? [u.hwid]
      : key.startsWith('MAC-')
      ? [key.replace(/^MAC-/i, '')]
      : [];

    const customerName = u.account_username || u.name || key.replace(/^MAC-|^USER-/i, '');
    const xtreamUrl = u.xtream_url || u.url || '';
    const xtreamUser = u.xtream_user || u.username || '';
    const xtreamPass = u.xtream_pass || u.password || '';
    const accountPassword = u.account_password !== undefined ? u.account_password : '123';
    const expiresAt = u.expires_at || (u.is_lifetime ? '2099-12-31' : '2027-06-04');
    const isLifetime = Boolean(
      u.is_lifetime ||
        expiresAt === 'lifetime' ||
        String(expiresAt).startsWith('2099') ||
        String(expiresAt).startsWith('2100')
    );

    return {
      id: key,
      username: customerName,
      email: u.email || '',
      password: accountPassword,
      hwid: hwids[0] || '',
      hwids,
      max_devices: Math.max(1, Number(u.max_devices) || 1),
      xtream_url: xtreamUrl,
      xtream_user: xtreamUser,
      xtream_pass: xtreamPass,
      active: u.active !== false,
      expires_at: isLifetime ? '2099-12-31' : expiresAt,
      is_lifetime: isLifetime,
      notes: u.notes || '',
      created_at: u.created_at || '-',
    };
  }

  async function logActivity(actor, message) {
    try {
      const entry = {
        time: new Date().toLocaleString('de-DE', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        }),
        user: actor || 'Admin',
        message,
      };
      await fetch(`${FIREBASE_URL}/logs.json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry),
      });
    } catch {}
  }

  // =========================================================================
  // APP AUTO-UPDATER MANAGEMENT (/app_update.json)
  // =========================================================================
  async function loadAppUpdateConfig() {
    try {
      const res = await fetch(`${FIREBASE_URL}/app_update.json?t=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      if (data && typeof data === 'object') {
        currentAppUpdate = {
          version: data.version || '0.9.0',
          url: data.url || '',
          notes: data.notes || '',
          active: data.active !== false,
          updatedAt: data.updatedAt || '-',
        };
      }
      const statVer = document.getElementById('stat-update-ver');
      const statSub = document.getElementById('stat-update-sub');
      if (statVer) {
        statVer.textContent = 'v' + (currentAppUpdate.version || '0.9.0');
      }
      if (statSub) {
        statSub.textContent = currentAppUpdate.active ? '🟢 Auto-Popup Aktiv' : '⚪ Kein Update aktiv';
        statSub.style.color = currentAppUpdate.active ? '#10b981' : '#9ca3af';
      }
    } catch {}
  }

  function openUpdateModal() {
    const vEl = document.getElementById('upd-version');
    const uEl = document.getElementById('upd-url');
    const nEl = document.getElementById('upd-notes');
    const aEl = document.getElementById('upd-active');
    if (vEl) vEl.value = currentAppUpdate.version || '0.9.1';
    if (uEl) uEl.value = currentAppUpdate.url || '';
    if (nEl) nEl.value = currentAppUpdate.notes || 'Neues Hyschool Player Update verfügbar!';
    if (aEl) aEl.value = currentAppUpdate.active ? '1' : '0';
    const modal = document.getElementById('update-modal');
    if (modal) modal.classList.add('open');
  }

  function closeUpdateModal() {
    const modal = document.getElementById('update-modal');
    if (modal) modal.classList.remove('open');
  }

  async function saveAppUpdateConfig() {
    const version = (document.getElementById('upd-version')?.value || '').trim().replace(/^v/i, '');
    const url = (document.getElementById('upd-url')?.value || '').trim();
    const notes = (document.getElementById('upd-notes')?.value || '').trim();
    const active = document.getElementById('upd-active')?.value === '1';

    if (!version) {
      showToast('Bitte eine Versionsnummer eingeben (z.B. 0.9.1 oder 1.0.0)!', true);
      return;
    }

    const saveBtn = document.getElementById('btn-save-update');
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.textContent = '⏳ Veröffentlicht...';
    }

    const payload = {
      version,
      url,
      notes: notes || `Neues Hyschool Player Update v${version} ist verfügbar!`,
      active,
      updatedAt: new Date().toISOString().replace('T', ' ').slice(0, 19),
    };

    try {
      const res = await fetch(`${FIREBASE_URL}/app_update.json`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      currentAppUpdate = payload;
      await loadAppUpdateConfig();
      await logActivity(
        'Admin',
        active
          ? `hat Hyschool Player Update v${version} veröffentlicht (Auto-Popup im Player aktiviert).`
          : `hat Hyschool Player Update v${version} gespeichert (Popup deaktiviert).`
      );
      showToast(
        active
          ? `🚀 Update v${version} ist LIVE! Alle Player zeigen jetzt das Update-Popup.`
          : `💾 Update v${version} gespeichert (Popup deaktiviert).`
      );
      closeUpdateModal();
      await pollFeeds();
    } catch (e) {
      showToast('Fehler beim Speichern des Updates: ' + e.message, true);
    } finally {
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = '🚀 Update jetzt veröffentlichen';
      }
    }
  }

  // Optional file picker helper: pre-fills filename / uploads or generates GitHub release URL
  function handleUpdateFileSelect(e) {
    const file = e.target?.files?.[0];
    if (!file) return;
    const urlInput = document.getElementById('upd-url');
    if (urlInput && !urlInput.value.trim()) {
      urlInput.value = `https://kakash9i.github.io/${encodeURIComponent(file.name)}`;
    }
    showToast(`📁 Datei "${file.name}" ausgewählt — lade sie in dein GitHub-Repo hoch oder trage den Direktlink ein!`);
  }

  // =========================================================================
  // CUSTOMERS & DEVICES MANAGEMENT (/users.json)
  // =========================================================================
  async function loadUsers(showSuccessToast = false) {
    const refreshBtn = document.getElementById('btn-refresh-users');
    if (refreshBtn) {
      refreshBtn.disabled = true;
      refreshBtn.textContent = '⏳ Lädt...';
    }
    try {
      const res = await fetch(`${FIREBASE_URL}/users.json?t=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) || {};
      rawUsersMap = data;

      allUsers = Object.entries(data)
        .filter(([, val]) => val && typeof val === 'object')
        .map(([key, val]) => normalizeUserRecord(key, val));

      filterUsers();
      updateStats(allUsers);
      await loadAppUpdateConfig();
      if (showSuccessToast) {
        showToast(`✅ Aktualisiert (${allUsers.length} Kunden geladen)`);
      }
    } catch (e) {
      showToast('Fehler beim Laden: ' + e.message, true);
    } finally {
      if (refreshBtn) {
        refreshBtn.disabled = false;
        refreshBtn.textContent = '🔄 Aktualisieren';
      }
    }
  }

  function updateStats(users) {
    const elTotal = document.getElementById('stat-total');
    const elActive = document.getElementById('stat-active');
    const elConf = document.getElementById('stat-configured');
    const elDev = document.getElementById('stat-devices');

    if (elTotal) elTotal.textContent = String(users.length);
    if (elActive) elActive.textContent = String(users.filter((u) => u.active).length);
    if (elConf) elConf.textContent = String(users.filter((u) => u.xtream_url && u.xtream_user).length);
    if (elDev) {
      const totalDevices = users.reduce((sum, u) => sum + (Array.isArray(u.hwids) ? u.hwids.length : 0), 0);
      elDev.textContent = String(totalDevices);
    }
  }

  function renderTable(users) {
    const tbody = document.getElementById('user-table-body');
    if (!tbody) return;

    if (!users || users.length === 0) {
      tbody.innerHTML =
        '<tr><td colspan="7" style="text-align: center; color: var(--text-muted); padding: 34px;">Noch keine Kunden registriert. Klicke oben auf <b>➕ Neuer Kunde</b>.</td></tr>';
      return;
    }

    tbody.innerHTML = '';

    users.forEach((u) => {
      const tr = document.createElement('tr');
      const isConfigured = Boolean(u.xtream_url && u.xtream_user);
      const hwids = Array.isArray(u.hwids) ? u.hwids : [];
      const maxDev = u.max_devices || 1;
      const expStr = u.expires_at || '2027-06-04';

      let daysLeftHtml = '';
      if (u.is_lifetime || expStr === 'lifetime' || expStr.startsWith('2099')) {
        daysLeftHtml =
          '<span class="status-badge active" style="background: rgba(250,204,21,0.16); color: #facc15; border-color: rgba(250,204,21,0.4);">👑 Lifetime</span>';
      } else {
        const expD = new Date(expStr + 'T23:59:59');
        const dLeft = Math.ceil((expD.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
        if (dLeft <= 0) {
          daysLeftHtml = '<span class="status-badge inactive">⚠️ Abgelaufen</span>';
        } else {
          daysLeftHtml =
            `<div style="font-weight: 800; color: #facc15; font-size: 12.5px;">👑 ${dLeft} Tage</div>` +
            `<div style="font-size: 11px; color: var(--text-muted);">${escapeHtml(expStr)}</div>`;
        }
      }

      const hwidPills =
        hwids.length > 0
          ? hwids.map((m) => `<span class="hwid-badge" style="margin-right:4px;margin-top:3px;">${escapeHtml(m)}</span>`).join('')
          : '<span class="hwid-badge" style="opacity:0.55;">Kein Gerät gebunden</span>';

      tr.innerHTML = `
        <td>
          <div style="font-weight: 800; font-size: 14px; color: #fff;">${escapeHtml(u.username || 'Unbekannt')}</div>
          <div style="font-size: 12px; color: var(--text-muted); margin-top: 2px;">
            ${escapeHtml(u.email || 'Keine E-Mail')} ${u.password ? `• <span style="color:#fef08a;">PW: ${escapeHtml(u.password)}</span>` : ''}
          </div>
          ${u.notes ? `<div style="font-size: 11px; color: #a1a1aa; margin-top: 2px;">📝 ${escapeHtml(u.notes)}</div>` : ''}
        </td>
        <td>
          <div style="font-weight: 700; color: #facc15; font-size: 12px; margin-bottom: 3px;">📱 ${hwids.length} / ${maxDev} Gerät(e)</div>
          <div>${hwidPills}</div>
        </td>
        <td>${daysLeftHtml}</td>
        <td>
          <span class="xtream-pill ${isConfigured ? 'configured' : ''}">
            ${isConfigured ? `✓ ${escapeHtml(u.xtream_url)}` : '⚠️ Nicht zugewiesen'}
          </span>
          ${isConfigured ? `<div style="font-size: 11px; color: var(--text-muted); margin-top: 2px;">User: ${escapeHtml(u.xtream_user)}</div>` : ''}
        </td>
        <td>
          <span class="status-badge ${u.active ? 'active' : 'inactive'}">
            ● ${u.active ? 'Aktiv' : 'Gesperrt'}
          </span>
        </td>
        <td style="color: var(--text-muted); font-size: 12px; white-space: nowrap;">${escapeHtml(u.created_at || '-')}</td>
        <td class="action-cell">
          <div class="action-buttons-wrap">
            <button type="button" class="btn btn-outline btn-edit-row">✏️ Bearbeiten</button>
            <button type="button" class="btn btn-danger btn-delete-row" title="Kunde löschen">🗑️ Löschen</button>
          </div>
        </td>
      `;

      const editBtn = tr.querySelector('.btn-edit-row');
      const delBtn = tr.querySelector('.btn-delete-row');

      if (editBtn) {
        editBtn.addEventListener('click', () => openEditModal(u.id));
      }
      if (delBtn) {
        delBtn.addEventListener('click', () => deleteUser(u.id));
      }

      tbody.appendChild(tr);
    });
  }

  function filterUsers() {
    const searchEl = document.getElementById('search-input');
    const q = (searchEl ? searchEl.value : '').trim().toLowerCase();
    if (!q) {
      renderTable(allUsers);
      return;
    }
    const filtered = allUsers.filter((u) => {
      const hwidsStr = Array.isArray(u.hwids) ? u.hwids.join(' ').toLowerCase() : '';
      return (
        (u.username && u.username.toLowerCase().includes(q)) ||
        (u.email && u.email.toLowerCase().includes(q)) ||
        (u.hwid && u.hwid.toLowerCase().includes(q)) ||
        hwidsStr.includes(q) ||
        (u.notes && u.notes.toLowerCase().includes(q))
      );
    });
    renderTable(filtered);
  }

  function calcDaysLeft() {
    const expInput = document.getElementById('edit-expires-at');
    const badge = document.getElementById('badge-days-left');
    if (!expInput || !badge) return;
    const val = expInput.value;
    if (!val || val === 'lifetime' || val.startsWith('209') || val.startsWith('210')) {
      badge.textContent = '👑 Lifetime (Unbegrenzt)';
      badge.style.color = '#facc15';
      return;
    }
    const exp = new Date(val + 'T23:59:59');
    const diff = Math.ceil((exp.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    if (diff < 0) {
      badge.textContent = '⚠️ Abgelaufen!';
      badge.style.color = '#ef4444';
    } else {
      badge.textContent = diff + ' Tage übrig';
      badge.style.color = '#facc15';
    }
  }

  function addMonths(months) {
    const expInput = document.getElementById('edit-expires-at');
    if (!expInput) return;
    const cur = expInput.value;
    let d = cur && !cur.startsWith('209') ? new Date(cur) : new Date();
    if (isNaN(d.getTime()) || d < new Date()) d = new Date();
    d.setMonth(d.getMonth() + months);
    expInput.value = d.toISOString().split('T')[0];
    calcDaysLeft();
  }

  function setLifetime() {
    const expInput = document.getElementById('edit-expires-at');
    if (!expInput) return;
    expInput.value = '2099-12-31';
    calcDaysLeft();
  }

  function openAddModal() {
    pendingResetHwids = false;
    document.getElementById('modal-title-text').textContent = '➕ Neuen Kunden anlegen';
    document.getElementById('edit-id').value = '';
    document.getElementById('edit-username').value = '';
    document.getElementById('edit-email').value = '';
    document.getElementById('edit-password').value = '123';
    document.getElementById('edit-max-devices').value = '1';
    document.getElementById('edit-hwid').value = '';
    document.getElementById('edit-xtream-url').value = 'http://cmc.exchange-cdn.com:8080';
    document.getElementById('edit-xtream-user').value = '22e7694ca4';
    document.getElementById('edit-xtream-pass').value = 'd32992aeea';
    document.getElementById('edit-status').value = '1';
    document.getElementById('edit-notes').value = 'Manuell im Admin-Panel erstellt';
    document.getElementById('edit-expires-at').value = '2027-06-04';
    calcDaysLeft();
    document.getElementById('edit-modal').classList.add('open');
  }

  function openEditModal(id) {
    const u = allUsers.find((x) => x.id === id);
    if (!u) {
      showToast('Kunde nicht gefunden — bitte aktualisieren', true);
      return;
    }
    pendingResetHwids = false;
    document.getElementById('modal-title-text').textContent = `✏️ Kunde bearbeiten: ${u.username}`;
    document.getElementById('edit-id').value = u.id;
    document.getElementById('edit-username').value = u.username || '';
    document.getElementById('edit-email').value = u.email || '';
    document.getElementById('edit-password').value = u.password || '';
    document.getElementById('edit-max-devices').value = String(u.max_devices || 1);
    const hwids = Array.isArray(u.hwids) ? u.hwids : u.hwid ? [u.hwid] : [];
    document.getElementById('edit-hwid').value = hwids.join('\n');
    document.getElementById('edit-xtream-url').value = u.xtream_url || 'http://cmc.exchange-cdn.com:8080';
    document.getElementById('edit-xtream-user').value = u.xtream_user || '22e7694ca4';
    document.getElementById('edit-xtream-pass').value = u.xtream_pass || 'd32992aeea';
    document.getElementById('edit-status').value = u.active ? '1' : '0';
    document.getElementById('edit-notes').value = u.notes || '';
    document.getElementById('edit-expires-at').value = u.expires_at || '2027-06-04';
    calcDaysLeft();
    document.getElementById('edit-modal').classList.add('open');
  }

  function closeModal() {
    document.getElementById('edit-modal').classList.remove('open');
  }

  function resetHwids() {
    if (confirm('Wirklich alle gebundenen MAC-Adressen für diesen Kunden zurücksetzen?')) {
      document.getElementById('edit-hwid').value = '';
      pendingResetHwids = true;
      showToast('MAC-Bindung geleert — klicke jetzt auf Speichern!');
    }
  }

  async function saveUser() {
    const existingId = document.getElementById('edit-id').value.trim();
    const isNew = !existingId;
    const customerName = document.getElementById('edit-username').value.trim();
    const email = document.getElementById('edit-email').value.trim().toLowerCase();
    const accountPassword = document.getElementById('edit-password').value.trim();
    const maxDevices = Math.max(1, parseInt(document.getElementById('edit-max-devices').value, 10) || 1);
    const rawHwidLines = document
      .getElementById('edit-hwid')
      .value.split(/[\r\n,]+/)
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    const hwids = pendingResetHwids && rawHwidLines.length === 0 ? [] : rawHwidLines;

    const xtreamUrl = document.getElementById('edit-xtream-url').value.trim();
    const xtreamUser = document.getElementById('edit-xtream-user').value.trim();
    const xtreamPass = document.getElementById('edit-xtream-pass').value.trim();
    const isActive = document.getElementById('edit-status').value === '1';
    const expiresAt = document.getElementById('edit-expires-at').value || '2027-06-04';
    const isLifetime = expiresAt === 'lifetime' || expiresAt.startsWith('2099') || expiresAt.startsWith('2100');
    const notes = document.getElementById('edit-notes').value.trim();

    if (!customerName) {
      showToast('Bitte einen Benutzernamen eingeben!', true);
      return;
    }

    let firebaseKey = existingId;
    if (!firebaseKey) {
      if (hwids.length > 0) {
        firebaseKey = hwids[0].startsWith('MAC-') ? hwids[0] : `MAC-${hwids[0]}`;
      } else {
        const safeSlug = customerName.toUpperCase().replace(/[^A-Z0-9_-]/g, '') || Date.now();
        firebaseKey = `USER-${safeSlug}`;
      }
    }

    const existingRaw = rawUsersMap[firebaseKey] || {};
    const nowStr = new Date().toISOString().replace('T', ' ').slice(0, 19);

    const record = {
      ...existingRaw,
      id: firebaseKey,
      name: customerName,
      account_username: customerName,
      email,
      account_password: accountPassword,
      hwid: hwids[0] || '',
      hwids,
      max_devices: maxDevices,
      url: xtreamUrl,
      xtream_url: xtreamUrl,
      username: xtreamUser,
      xtream_user: xtreamUser,
      password: xtreamPass,
      xtream_pass: xtreamPass,
      active: isActive,
      expires_at: expiresAt,
      is_lifetime: isLifetime,
      notes,
      created_at: existingRaw.created_at || nowStr,
    };

    const saveBtn = document.getElementById('btn-save-user');
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.textContent = '⏳ Speichert...';
    }

    try {
      const res = await fetch(`${FIREBASE_URL}/users/${encodeURIComponent(firebaseKey)}.json`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(record),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      await logActivity(
        'Admin',
        isNew
          ? `hat Kunden '${customerName}' (${email || firebaseKey}) neu angelegt.`
          : `hat Kunden '${customerName}' (${firebaseKey}) aktualisiert (Geräte: ${hwids.length}/${maxDevices}, Gültig bis: ${isLifetime ? 'Lifetime' : expiresAt}).`
      );

      showToast(isNew ? '✅ Neuer Kunde erfolgreich gespeichert!' : '✅ Änderungen erfolgreich gespeichert!');
      closeModal();
      await loadUsers(false);
      await pollFeeds();
    } catch (e) {
      showToast('Fehler beim Speichern: ' + e.message, true);
    } finally {
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = '💾 Speichern';
      }
    }
  }

  async function deleteUser(id) {
    const u = allUsers.find((x) => x.id === id);
    const label = u ? `${u.username} (${u.email || id})` : id;
    if (!confirm(`Möchtest du den Kunden "${label}" wirklich unwiderruflich löschen?\n\nE-Mail-Adresse und MAC-Adresse werden dadurch sofort wieder zur Neuregistrierung freigegeben.`)) {
      return;
    }

    try {
      const res = await fetch(`${FIREBASE_URL}/users/${encodeURIComponent(id)}.json`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      await logActivity('Admin', `hat den Kunden '${label}' gelöscht (E-Mail & MAC wieder freigegeben).`);
      showToast('🗑️ Kunde gelöscht & E-Mail/MAC freigegeben!');
      await loadUsers(false);
      await pollFeeds();
    } catch (e) {
      showToast('Fehler beim Löschen: ' + e.message, true);
    }
  }

  async function pollFeeds() {
    try {
      const resLogs = await fetch(`${FIREBASE_URL}/logs.json?orderBy="$key"&limitToLast=35`, { cache: 'no-store' });
      if (resLogs.ok) {
        const logs = (await resLogs.json()) || {};
        const logsEl = document.getElementById('logs-list');
        if (logsEl) {
          const items = Object.values(logs)
            .filter((v) => v && v.time && v.message)
            .reverse();
          logsEl.innerHTML =
            items.length > 0
              ? items
                  .map(
                    (v) =>
                      `<div class="feed-item"><span class="feed-time">[${escapeHtml(v.time)}]</span><span class="feed-user">${escapeHtml(v.user || 'System')}:</span> ${escapeHtml(v.message)}</div>`
                  )
                  .join('')
              : '<div style="color:var(--text-muted);text-align:center;padding:20px;">Keine Logs vorhanden.</div>';
        }
      }
    } catch {}

    try {
      const resChat = await fetch(`${FIREBASE_URL}/chat.json?orderBy="$key"&limitToLast=35`, { cache: 'no-store' });
      if (resChat.ok) {
        const chats = (await resChat.json()) || {};
        const chatEl = document.getElementById('chat-list');
        if (chatEl) {
          const items = Object.values(chats).filter((v) => v && v.time && v.message);
          chatEl.innerHTML =
            items.length > 0
              ? items
                  .map(
                    (v) =>
                      `<div class="feed-item"><span class="feed-time">[${escapeHtml(v.time)}]</span><span class="feed-user">${escapeHtml(v.user || 'Admin')}:</span> ${escapeHtml(v.message)}</div>`
                  )
                  .join('')
              : '<div style="color:var(--text-muted);text-align:center;padding:20px;">Keine Nachrichten.</div>';
          chatEl.scrollTop = chatEl.scrollHeight;
        }
      }
    } catch {}
  }

  async function sendChat() {
    const input = document.getElementById('chat-input');
    if (!input) return;
    const msg = input.value.trim();
    if (!msg) return;
    input.value = '';
    try {
      await fetch(`${FIREBASE_URL}/chat.json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          time: new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }),
          user: 'Admin',
          message: msg,
        }),
      });
      await pollFeeds();
    } catch {}
  }

  async function clearFeed(type) {
    const pin = prompt(`Bitte Sicherheits-PIN eingeben, um ${type === 'logs' ? 'die Logs' : 'den Chat'} zu leeren (Standard: 1337):`);
    if (pin === null) return;
    if (pin.trim() !== '1337' && pin.trim() !== '123123') {
      showToast('Falsche PIN!', true);
      return;
    }
    try {
      await fetch(`${FIREBASE_URL}/${type}.json`, { method: 'DELETE' });
      showToast(`✅ ${type === 'logs' ? 'Logs' : 'Chat'} geleert!`);
      await pollFeeds();
    } catch (e) {
      showToast('Fehler: ' + e.message, true);
    }
  }

  function unlockPanel() {
    const loginScreen = document.getElementById('login-screen');
    if (loginScreen) loginScreen.style.display = 'none';
    loadUsers(false);
    pollFeeds();
    clearInterval(pollTimer);
    pollTimer = setInterval(() => {
      loadUsers(false);
      pollFeeds();
    }, 8000);
  }

  function doLogin(e) {
    if (e) e.preventDefault();
    const passInput = document.getElementById('login-pass');
    const p = passInput ? passInput.value.trim() : '';
    if (p === ADMIN_PASS_DEFAULT || p === '1337' || p === 'admin') {
      localStorage.setItem('hyschool_admin_pass', p);
      unlockPanel();
    } else {
      showToast('❌ Falsches Admin-Passwort! (Standard: 123123)', true);
    }
  }

  function doLogout() {
    localStorage.removeItem('hyschool_admin_pass');
    clearInterval(pollTimer);
    const loginScreen = document.getElementById('login-screen');
    if (loginScreen) loginScreen.style.display = 'flex';
    const passInput = document.getElementById('login-pass');
    if (passInput) passInput.value = '';
  }

  // Expose globals
  window.openAddModal = openAddModal;
  window.openEditModal = openEditModal;
  window.closeModal = closeModal;
  window.saveUser = saveUser;
  window.deleteUser = deleteUser;
  window.loadUsers = loadUsers;
  window.filterUsers = filterUsers;
  window.calcDaysLeft = calcDaysLeft;
  window.addMonths = addMonths;
  window.setLifetime = setLifetime;
  window.resetHwids = resetHwids;
  window.openUpdateModal = openUpdateModal;
  window.closeUpdateModal = closeUpdateModal;
  window.saveAppUpdateConfig = saveAppUpdateConfig;
  window.doLogin = doLogin;
  window.doLogout = doLogout;

  function bindEvents() {
    const loginForm = document.getElementById('login-form');
    if (loginForm) loginForm.addEventListener('submit', doLogin);

    const btnAdd = document.getElementById('btn-add-user');
    if (btnAdd) btnAdd.addEventListener('click', openAddModal);

    const btnUpd = document.getElementById('btn-open-updater');
    if (btnUpd) btnUpd.addEventListener('click', openUpdateModal);

    const cardUpd = document.getElementById('card-open-updater');
    if (cardUpd) cardUpd.addEventListener('click', openUpdateModal);

    const btnCloseUpd = document.getElementById('btn-close-update-modal');
    if (btnCloseUpd) btnCloseUpd.addEventListener('click', closeUpdateModal);

    const btnCancelUpd = document.getElementById('btn-cancel-update-modal');
    if (btnCancelUpd) btnCancelUpd.addEventListener('click', closeUpdateModal);

    const btnSaveUpd = document.getElementById('btn-save-update');
    if (btnSaveUpd) btnSaveUpd.addEventListener('click', saveAppUpdateConfig);

    const fileUpd = document.getElementById('upd-file-picker');
    if (fileUpd) fileUpd.addEventListener('change', handleUpdateFileSelect);

    const btnRefresh = document.getElementById('btn-refresh-users');
    if (btnRefresh) btnRefresh.addEventListener('click', () => loadUsers(true));

    const btnLogout = document.getElementById('btn-logout');
    if (btnLogout) btnLogout.addEventListener('click', doLogout);

    const searchInput = document.getElementById('search-input');
    if (searchInput) searchInput.addEventListener('input', filterUsers);

    const btnClose = document.getElementById('btn-close-modal');
    if (btnClose) btnClose.addEventListener('click', closeModal);

    const btnCancel = document.getElementById('btn-cancel-modal');
    if (btnCancel) btnCancel.addEventListener('click', closeModal);

    const btnSave = document.getElementById('btn-save-user');
    if (btnSave) btnSave.addEventListener('click', saveUser);

    const btnResetHwids = document.getElementById('btn-reset-hwids');
    if (btnResetHwids) btnResetHwids.addEventListener('click', resetHwids);

    const expInput = document.getElementById('edit-expires-at');
    if (expInput) expInput.addEventListener('change', calcDaysLeft);

    document.querySelectorAll('[data-add-months]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const m = parseInt(btn.getAttribute('data-add-months'), 10);
        if (m) addMonths(m);
      });
    });

    const btnLifetime = document.getElementById('btn-set-lifetime');
    if (btnLifetime) btnLifetime.addEventListener('click', setLifetime);

    const btnSendChat = document.getElementById('btn-send-chat');
    if (btnSendChat) btnSendChat.addEventListener('click', sendChat);

    const chatInput = document.getElementById('chat-input');
    if (chatInput) {
      chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          sendChat();
        }
      });
    }

    const btnClearLogs = document.getElementById('btn-clear-logs');
    if (btnClearLogs) btnClearLogs.addEventListener('click', () => clearFeed('logs'));

    const btnClearChat = document.getElementById('btn-clear-chat');
    if (btnClearChat) btnClearChat.addEventListener('click', () => clearFeed('chat'));

    const savedPass = localStorage.getItem('hyschool_admin_pass');
    if (savedPass === ADMIN_PASS_DEFAULT || savedPass === '1337' || savedPass === 'admin') {
      unlockPanel();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindEvents);
  } else {
    bindEvents();
  }
})();
