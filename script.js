
function isAnyModalOpen() {
  return Boolean(
    document.querySelector('.modal-overlay.open') || 
    document.querySelector('.modal.open') || 
    (document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA'))
  );
}

/**
 * HYSCHOOL PLAYER - Cloud Admin Panel Script
 * Direct Firebase Realtime Database Sync
 */

(function () {
  const FIREBASE_URL = 'https://media-3a958-default-rtdb.europe-west1.firebasedatabase.app';
  const ADMIN_PASS_DEFAULT = '123123';

  // Global State
  let allUsers = [];
  let rawUsersMap = {};
  let presenceMap = {};
  let allLicenses = [];
  let filteredLicenses = [];
  let pendingResetHwids = false;
  let pollTimer = null;
  let licStatusFilter = 'all';
  let genKeyCount = 1;
  let activeCockpitUserId = null;

  let currentAppUpdate = {
    version: '1.9.0',
    url: 'https://kakash9i.github.io/Hyschool_Player.exe',
    androidUrl: '',
    notes: 'Neue Verbesserungen, 33 Profil-Avatare, TMDB-Integration & Bugfixes.',
    active: true,
    updatedAt: '-'
  };

  const PLAN_LABELS = {
    '1y1': '1 Jahr (1 Gerät)',
    '1y3': '1 Jahr (3 Geräte / Trio)',
    'lt1': 'Lifetime (1 Gerät)',
    'lt3': 'Lifetime (3 Geräte / Trio)',
    'extra': '+1 Zusatzgerät'
  };

  const PLAN_BADGE_STYLES = {
    '1y1': 'background: rgba(250,204,21,0.15); color: #facc15; border: 1px solid rgba(250,204,21,0.35);',
    '1y3': 'background: rgba(234,179,8,0.22); color: #fde047; border: 1px solid rgba(250,204,21,0.5); font-weight: 800;',
    'lt1': 'background: rgba(168,85,247,0.18); color: #c084fc; border: 1px solid rgba(168,85,247,0.4);',
    'lt3': 'background: rgba(192,132,252,0.25); color: #e9d5ff; border: 1px solid rgba(192,132,252,0.55); font-weight: 800;',
    'extra': 'background: rgba(56,189,248,0.15); color: #38bdf8; border: 1px solid rgba(56,189,248,0.35);'
  };

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function showToast(msg, isError = false) {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.style.borderLeftColor = isError ? '#ef4444' : '#facc15';
    t.style.display = 'block';
    clearTimeout(t._timer);
    t._timer = setTimeout(() => { t.style.display = 'none'; }, 3800);
  }

  function getDefaultTrialDate(days = 30) {
    const d = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    return d.toISOString().split('T')[0];
  }

  // =========================================================================
  // PRESENCE & WATCH STATUS
  // =========================================================================
  function getUserPresence(u) {
    if (!u) return { isOnline: false, lastSeenText: 'Offline', platform: 'Player', currentStream: null };
    const now = Date.now();
    const safeKey = u.id ? u.id.replace(/[\/\.\#\$\[\]]/g, '_') : '';
    let p = presenceMap[safeKey];

    if (!p && Array.isArray(u.hwids)) {
      for (const m of u.hwids) {
        const k = 'MAC-' + m.replace(/[\/\.\#\$\[\]]/g, '_');
        if (presenceMap[k]) { p = presenceMap[k]; break; }
      }
    }
    if (!p && u.username) {
      for (const item of Object.values(presenceMap)) {
        if (item && item.username && item.username.toLowerCase() === u.username.toLowerCase()) {
          p = item; break;
        }
      }
    }

    if (!p) return { isOnline: false, lastSeenText: 'Offline', platform: 'Player', currentStream: null };

    const lastSeen = Number(p.last_seen || p.lastSeen || 0);
    const diffSec = Math.floor((now - lastSeen) / 1000);
    const isOnline = Boolean(p.online || p.is_online || diffSec < 90);

    let lastSeenText = 'Offline';
    if (diffSec < 60) lastSeenText = 'Gerade eben';
    else if (diffSec < 3600) lastSeenText = 'vor ' + Math.floor(diffSec / 60) + ' Min';
    else if (diffSec < 86400) lastSeenText = 'vor ' + Math.floor(diffSec / 3600) + ' Std';
    else if (lastSeen > 0) lastSeenText = new Date(lastSeen).toLocaleDateString('de-DE');

    let streamName = null;
    let streamType = '';
    if (isOnline && (p.current_stream || p.stream_title || p.stream)) {
      streamName = p.current_stream || p.stream_title || p.stream;
      streamType = p.stream_type || 'Live TV';
    }

    return {
      isOnline,
      lastSeenText,
      platform: p.platform || 'Windows PC',
      currentStream: streamName,
      streamType
    };
  }

  // =========================================================================
  // USER NORMALIZATION (REGISTERED NAME & PASSWORD PRIORITY)
  // =========================================================================
  function normalizeUserRecord(key, u) {
    let hwids = [];
    if (Array.isArray(u.hwids)) hwids = u.hwids.filter(Boolean);
    else if (typeof u.hwid === 'string' && u.hwid.trim()) hwids = [u.hwid.trim()];
    else if (typeof u.mac === 'string' && u.mac.trim()) hwids = [u.mac.trim()];

    const customerName = u.account_username || u.name || (u.username && u.username !== u.xtream_user ? u.username : '') || u.username || key || 'Unbekannt';

    let customerPass = '123';
    if (u.account_password !== undefined && u.account_password !== null && String(u.account_password).trim() !== '') {
      customerPass = String(u.account_password).trim();
    } else if (u.password && u.password !== u.xtream_pass) {
      customerPass = String(u.password).trim();
    } else if (u.password) {
      customerPass = String(u.password).trim();
    }

    const expiresAt = u.expires_at || (u.is_lifetime ? '2099-12-31' : getDefaultTrialDate(30));
    const isLifetime = Boolean(
      u.is_lifetime ||
      expiresAt === 'lifetime' ||
      String(expiresAt).startsWith('2099') ||
      String(expiresAt).startsWith('2100')
    );

    return {
      id: key,
      username: customerName,
      account_username: customerName,
      email: u.email || '',
      password: customerPass,
      account_password: customerPass,
      max_devices: Number(u.max_devices) || 1,
      hwids,
      xtream_url: u.xtream_url || u.server_url || u.server || u.url || '',
      xtream_user: u.xtream_user || u.user || '',
      xtream_pass: u.xtream_pass || u.pass || '',
      active: u.status === undefined ? true : Boolean(u.status === 1 || u.status === '1' || u.status === true || u.active === true),
      expires_at: expiresAt,
      is_lifetime: isLifetime,
      notes: u.notes || u.note || '',
      created_at: u.created_at || u.createdAt || '',
      mac_reset: Boolean(u.mac_reset)
    };
  }

  function updateStats(users) {
    const elTotal = document.getElementById('stat-total');
    const elActive = document.getElementById('stat-active');
    const elConf = document.getElementById('stat-configured');

    if (elTotal) elTotal.textContent = String(users.length);
    if (elActive) elActive.textContent = String(users.filter(u => u.active).length);
    if (elConf) elConf.textContent = String(users.filter(u => u.xtream_url && u.xtream_user).length);
  }

  // =========================================================================
  // LOAD & RENDER USERS (COMPACT TABLE WITH ZERO HORIZONTAL SCROLL)
  // =========================================================================
  async function loadUsers(showSuccessToast = false, isBackground = false) {
  if (isBackground && isAnyModalOpen()) return;
    const refreshBtn = document.getElementById('btn-refresh-users');
    if (refreshBtn) {
      refreshBtn.disabled = true;
      refreshBtn.textContent = '⏳ Lädt...';
    }
    try {
      const [uRes, pRes] = await Promise.all([
        fetch(FIREBASE_URL + '/users.json?t=' + Date.now(), { cache: 'no-store' }),
        fetch(FIREBASE_URL + '/presence.json?t=' + Date.now(), { cache: 'no-store' }).catch(() => null)
      ]);
      if (!uRes.ok) throw new Error('HTTP ' + uRes.status);
      const data = (await uRes.json()) || {};
      rawUsersMap = data;
      if (pRes && pRes.ok) {
        presenceMap = (await pRes.json()) || {};
      }

      allUsers = Object.entries(data)
        .filter(([, val]) => val && typeof val === 'object')
        .map(([key, val]) => normalizeUserRecord(key, val));

      filterUsers();
      updateStats(allUsers);
      await loadAppUpdateConfig();
      await loadLicenses(false);

      if (showSuccessToast) {
        showToast('✅ Daten synchronisiert (' + allUsers.length + ' Kunden geladen)');
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

  function filterUsers() {
    const searchEl = document.getElementById('search-input');
    const q = (searchEl ? searchEl.value : '').toLowerCase().trim();
    if (!q) {
      renderTable(allUsers);
      return;
    }
    const filtered = allUsers.filter(u => {
      const hwidsStr = (u.hwids || []).join(' ').toLowerCase();
      return (
        (u.username && u.username.toLowerCase().includes(q)) ||
        (u.email && u.email.toLowerCase().includes(q)) ||
        (u.xtream_url && u.xtream_url.toLowerCase().includes(q)) ||
        (u.xtream_user && u.xtream_user.toLowerCase().includes(q)) ||
        hwidsStr.includes(q)
      );
    });
    renderTable(filtered);
  }

  function renderTable(users) {
    const tbody = document.getElementById('user-table-body');
    if (!tbody) return;

    if (!users || users.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color: var(--text-muted); padding: 34px;">Keine Kunden gefunden.</td></tr>';
      return;
    }

    tbody.innerHTML = '';
    users.forEach(u => {
      const tr = document.createElement('tr');
      tr.className = 'user-row';
      const presence = getUserPresence(u);
      const isConfigured = Boolean(u.xtream_url && u.xtream_user);
      const hwids = Array.isArray(u.hwids) ? u.hwids : [];
      const maxDev = u.max_devices || 1;
      const expStr = u.expires_at || getDefaultTrialDate(30);

      // Expiration calculation
      let daysLeftHtml = '';
      if (u.is_lifetime || expStr === 'lifetime' || expStr.startsWith('2099') || expStr.startsWith('2100')) {
        daysLeftHtml = '<span class="status-badge active" style="background: rgba(250,204,21,0.16); color: #facc15; border-color: rgba(250,204,21,0.4);">👑 Lifetime</span>';
      } else {
        const expD = new Date(expStr + 'T23:59:59');
        const dLeft = Math.ceil((expD.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
        if (dLeft <= 0) {
          daysLeftHtml = '<span class="status-badge inactive">⚠️ Abgelaufen</span>';
        } else {
          daysLeftHtml = '<span style="font-weight: 800; color: #facc15; font-size: 13px;">⏳ ' + dLeft + ' Tage</span> ' +
                         '<span style="font-size: 11px; color: var(--text-muted);">(' + escapeHtml(expStr) + ')</span>';
        }
      }

      tr.innerHTML = `
        <td style="width: 32%;" onclick="openCustomerCockpit('${u.id}')">
          <div class="cust-top-row">
            <span class="live-dot ${presence.isOnline ? 'online' : 'offline'}" title="${presence.isOnline ? 'Live im Hyschool Player' : 'Offline'}"></span>
            <span class="cust-name">${escapeHtml(u.username)}</span>
            <span class="platform-badge">${escapeHtml(presence.platform)}</span>
            ${presence.currentStream ? `
              <span class="live-stream-badge" title="${escapeHtml(presence.currentStream)}">
                <span class="pulse-red-dot"></span>
                <span>LIVE: ${escapeHtml(presence.currentStream)}</span>
              </span>
            ` : ''}
          </div>
          <div class="cust-sub-row">
            <span>${escapeHtml(u.email || 'Keine E-Mail')}</span>
            <span>•</span>
            <span>PW: <span class="cust-pw">${escapeHtml(u.password)}</span></span>
          </div>
        </td>
        <td style="width: 18%;" onclick="openCustomerCockpit('${u.id}')">${daysLeftHtml}</td>
        <td style="width: 20%;" onclick="openCustomerCockpit('${u.id}')">
          <span class="xtream-pill" title="${escapeHtml(u.xtream_url || '')}">
            ${isConfigured ? '📺 ' + escapeHtml(u.xtream_url.replace(/^https?:\/\//, '')) : '⚠️ Nicht zugewiesen'}
          </span>
        </td>
        <td style="width: 14%;" onclick="openCustomerCockpit('${u.id}')">
          <span style="font-weight: 700; color: #facc15; font-size: 12px;">📱 ${hwids.length} / ${maxDev}</span>
          ${hwids.length > 0 ? '<span style="font-size:10.5px; color:#4ade80; margin-left:4px;">(gebunden)</span>' : '<span style="font-size:10.5px; color:#a1a1aa; margin-left:4px;">(frei)</span>'}
        </td>
        <td style="width: 16%; text-align: right;" onclick="event.stopPropagation()">
          <div class="action-buttons-wrap">
            <button type="button" class="btn btn-outline" onclick="openCustomerCockpit('${u.id}')" title="Kunden-Cockpit öffnen" style="padding: 5px 10px; font-size: 11.5px; border-color: rgba(250,204,21,0.4); color: #facc15;">⚙️ Details</button>
            <button type="button" class="btn btn-outline" onclick="openEditModal('${u.id}')" title="Bearbeiten" style="padding: 5px 9px; font-size: 11.5px;">✏️</button>
            <button type="button" class="btn btn-danger" onclick="deleteUser('${u.id}')" title="Löschen" style="padding: 5px 9px; font-size: 11.5px;">🗑️</button>
          </div>
        </td>
      `;

      tbody.appendChild(tr);
    });
  }

  // =========================================================================
  // CUSTOMER COCKPIT MODAL (HIGH-END DETAILS POPUP)
  // =========================================================================
  function openCustomerCockpit(id) {
    const u = allUsers.find(x => x.id === id);
    if (!u) {
      showToast('Kunde nicht gefunden', true);
      return;
    }
    activeCockpitUserId = id;

    const presence = getUserPresence(u);
    const hwids = Array.isArray(u.hwids) ? u.hwids : [];
    const maxDev = u.max_devices || 1;
    const expStr = u.expires_at || getDefaultTrialDate(30);

    // Avatar Letter
    const avatarEl = document.getElementById('cockpit-avatar');
    if (avatarEl) avatarEl.textContent = (u.username || 'U')[0].toUpperCase();

    // Name & Online Status
    const nameEl = document.getElementById('cockpit-name');
    if (nameEl) nameEl.textContent = u.username;

    const subEl = document.getElementById('cockpit-status-sub');
    if (subEl) {
      if (presence.isOnline) {
        subEl.innerHTML = '<span class="live-dot online"></span> <b style="color:#4ade80;">Online im Hyschool Player (' + escapeHtml(presence.platform) + ')</b>' +
          (presence.currentStream ? ' • <span style="color:#fca5a5;">🔴 Schaut: ' + escapeHtml(presence.currentStream) + '</span>' : '');
      } else {
        subEl.innerHTML = '<span class="live-dot offline"></span> <span style="color:#a1a1aa;">Zuletzt online: ' + escapeHtml(presence.lastSeenText) + '</span>';
      }
    }

    // 3 Tiles
    const runVal = document.getElementById('cockpit-runtime-val');
    const runSub = document.getElementById('cockpit-runtime-sub');
    if (u.is_lifetime || expStr === 'lifetime' || expStr.startsWith('2099') || expStr.startsWith('2100')) {
      if (runVal) runVal.textContent = '👑 Lifetime';
      if (runSub) runSub.textContent = 'Unbegrenzter Vollzugriff';
    } else {
      const expD = new Date(expStr + 'T23:59:59');
      const dLeft = Math.ceil((expD.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
      if (runVal) runVal.textContent = dLeft > 0 ? dLeft + ' Tage übrig' : '⚠️ Abgelaufen';
      if (runSub) runSub.textContent = 'Gültig bis: ' + expStr;
    }

    const devVal = document.getElementById('cockpit-devices-val');
    const devSub = document.getElementById('cockpit-devices-sub');
    if (devVal) devVal.textContent = hwids.length + ' / ' + maxDev + ' Geräte';
    if (devSub) devSub.textContent = hwids.length > 0 ? (maxDev - hwids.length) + ' Slot(s) noch frei' : 'Alle Slots frei';

    const accVal = document.getElementById('cockpit-acc-status');
    const accSub = document.getElementById('cockpit-acc-sub');
    if (accVal) {
      accVal.textContent = u.active ? 'Aktiviert' : 'Gesperrt';
      accVal.style.color = u.active ? '#4ade80' : '#f87171';
    }
    if (accSub) accSub.textContent = u.active ? 'Darf Player nutzen' : 'Kein Zugriff';

    // Xtream Credentials
    const xtrUrl = document.getElementById('cockpit-xtream-url');
    const xtrUser = document.getElementById('cockpit-xtream-user');
    const xtrPass = document.getElementById('cockpit-xtream-pass');
    if (xtrUrl) xtrUrl.textContent = u.xtream_url || 'Nicht zugewiesen';
    if (xtrUser) xtrUser.textContent = u.xtream_user || '-';
    if (xtrPass) xtrPass.textContent = u.xtream_pass || '-';

    // Bound MACs
    const macList = document.getElementById('cockpit-mac-list');
    const resetMacBtn = document.getElementById('cockpit-btn-reset-mac');
    if (macList) {
      if (hwids.length > 0) {
        macList.innerHTML = hwids.map(m =>
          '<span class="hwid-badge" style="padding:4px 10px; font-size:12px;">' + escapeHtml(m) + '</span>'
        ).join('');
        if (resetMacBtn) resetMacBtn.style.display = 'inline-flex';
      } else {
        macList.innerHTML = '<span style="color:#4ade80; font-size:12px;">🟢 0 Geräte gebunden (Player bindet MAC automatisch beim ersten Login)</span>';
        if (resetMacBtn) resetMacBtn.style.display = 'none';
      }
    }

    if (resetMacBtn) {
      resetMacBtn.onclick = async () => {
        await resetUserHwidsDirect(u.id);
        openCustomerCockpit(u.id);
      };
    }

    // Account & Notes
    const mailEl = document.getElementById('cockpit-email');
    const passEl = document.getElementById('cockpit-pass');
    const notesEl = document.getElementById('cockpit-notes');
    if (mailEl) mailEl.textContent = u.email || 'Keine E-Mail hinterlegt';
    if (passEl) passEl.textContent = u.password || '123';
    if (notesEl) notesEl.textContent = u.notes || 'Keine Notizen';

    // Bottom Action buttons
    const btnEdit = document.getElementById('cockpit-btn-edit');
    const btnDelete = document.getElementById('cockpit-btn-delete');
    if (btnEdit) {
      btnEdit.onclick = () => {
        closeCustomerCockpit();
        openEditModal(u.id);
      };
    }
    if (btnDelete) {
      btnDelete.onclick = async () => {
        closeCustomerCockpit();
        await deleteUser(u.id);
      };
    }

    const modal = document.getElementById('customer-cockpit-modal');
    if (modal) modal.classList.add('open');
  }

  function closeCustomerCockpit() {
    const modal = document.getElementById('customer-cockpit-modal');
    if (modal) modal.classList.remove('open');
  }

  // =========================================================================
  // CUSTOMER MODAL (ADD / EDIT / RESET MAC)
  // =========================================================================
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

  function setTrial30Days() {
    const expInput = document.getElementById('edit-expires-at');
    if (!expInput) return;
    expInput.value = getDefaultTrialDate(30);
    calcDaysLeft();
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
    document.getElementById('edit-xtream-url').value = 'http://nova3xstrong.cfd';
    document.getElementById('edit-xtream-user').value = '22e7694ca4';
    document.getElementById('edit-xtream-pass').value = 'd32992aeea';
    document.getElementById('edit-status').value = '1';
    document.getElementById('edit-notes').value = '30-Tage Testversion';
    document.getElementById('edit-expires-at').value = getDefaultTrialDate(30);
    calcDaysLeft();
    document.getElementById('edit-modal').classList.add('open');
  }

  function openEditModal(id) {
    const u = allUsers.find(x => x.id === id);
    if (!u) {
      showToast('Kunde nicht gefunden - bitte aktualisieren', true);
      return;
    }
    pendingResetHwids = Boolean(u.mac_reset);
    document.getElementById('modal-title-text').textContent = '✏️ Kunde bearbeiten: ' + u.username;
    document.getElementById('edit-id').value = u.id;
    document.getElementById('edit-username').value = u.username || '';
    document.getElementById('edit-email').value = u.email || '';
    document.getElementById('edit-password').value = u.password || '123';
    document.getElementById('edit-max-devices').value = String(u.max_devices || 1);
    const hwids = Array.isArray(u.hwids) ? u.hwids : [];
    document.getElementById('edit-hwid').value = hwids.join('\n');
    document.getElementById('edit-xtream-url').value = u.xtream_url || 'http://nova3xstrong.cfd';
    document.getElementById('edit-xtream-user').value = u.xtream_user || '';
    document.getElementById('edit-xtream-pass').value = u.xtream_pass || '';
    document.getElementById('edit-status').value = u.active ? '1' : '0';
    document.getElementById('edit-notes').value = u.notes || '';
    document.getElementById('edit-expires-at').value = u.expires_at || getDefaultTrialDate(30);
    calcDaysLeft();
    document.getElementById('edit-modal').classList.add('open');
  }

  function closeModal() {
    const modal = document.getElementById('edit-modal');
    if (modal) modal.classList.remove('open');
  }

  function resetHwids() {
    const hwidEl = document.getElementById('edit-hwid');
    if (hwidEl) hwidEl.value = '';
    pendingResetHwids = true;
    showToast('🔄 MAC-Bindung wird beim Speichern zurückgesetzt!');
  }

  async function resetUserHwidsDirect(id) {
    const u = allUsers.find(x => x.id === id);
    if (!u) return;
    if (!confirm("Möchtest du die MAC-Bindung für '" + u.username + "' wirklich sofort zurücksetzen?")) return;

    try {
      const existingRecord = rawUsersMap[id] || {};
      const updatedRecord = Object.assign({}, existingRecord, {
        hwids: [],
        hwid: '',
        mac: '',
        mac_reset: true,
        last_reset_at: new Date().toISOString()
      });

      const res = await fetch(FIREBASE_URL + '/users/' + encodeURIComponent(id) + '.json', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedRecord)
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);

      rawUsersMap[id] = updatedRecord;
      await logActivity('Admin', "hat die MAC-Bindung für '" + u.username + "' zurückgesetzt.");
      showToast('✅ MAC-Bindung sofort gelöscht (0 Geräte gebunden)!');
      await loadUsers(false);
    } catch (e) {
      showToast('Fehler beim MAC-Reset: ' + e.message, true);
    }
  }

  async function saveUser() {
    const saveBtn = document.getElementById('btn-save-user');
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Speichere...'; }

    try {
      const existingId = document.getElementById('edit-id').value.trim();
      const customerName = document.getElementById('edit-username').value.trim();
      const email = document.getElementById('edit-email').value.trim();
      const password = document.getElementById('edit-password').value.trim();
      const maxDevices = Math.max(1, parseInt(document.getElementById('edit-max-devices').value, 10) || 1);
      const hwidText = document.getElementById('edit-hwid').value.trim();
      const hwids = hwidText ? hwidText.split('\n').map(s => s.trim()).filter(Boolean) : [];
      const xtreamUrl = document.getElementById('edit-xtream-url').value.trim();
      const xtreamUser = document.getElementById('edit-xtream-user').value.trim();
      const xtreamPass = document.getElementById('edit-xtream-pass').value.trim();
      const isActive = document.getElementById('edit-status').value === '1';
      const expiresAt = document.getElementById('edit-expires-at').value || getDefaultTrialDate(30);
      const isLifetime = expiresAt === 'lifetime' || expiresAt.startsWith('2099') || expiresAt.startsWith('2100');
      const notes = document.getElementById('edit-notes').value.trim();

      if (!customerName) {
        showToast('Bitte einen Benutzernamen eingeben!', true);
        return;
      }

      let firebaseKey = existingId;
      if (!firebaseKey) {
        firebaseKey = customerName.replace(/[\/\.\#\$\[\]]/g, '_');
        if (rawUsersMap[firebaseKey]) {
          firebaseKey = firebaseKey + '_' + Date.now().toString(36);
        }
      }

      const existingRecord = rawUsersMap[firebaseKey] || {};
      const record = Object.assign({}, existingRecord, {
        account_username: customerName,
        name: customerName,
        username: existingRecord.username || xtreamUser || customerName,
        email: email || existingRecord.email || '',
        account_password: password || '123',
        password: existingRecord.password || xtreamPass || password || '123',
        max_devices: maxDevices,
        hwids: pendingResetHwids ? [] : hwids,
        hwid: pendingResetHwids ? '' : (hwids[0] || ''),
        mac: pendingResetHwids ? '' : (hwids[0] || ''),
        mac_reset: pendingResetHwids ? true : false,
        xtream_url: xtreamUrl,
        xtream_user: xtreamUser,
        xtream_pass: xtreamPass,
        server_url: xtreamUrl,
        url: xtreamUrl,
        status: isActive ? 1 : 0,
        active: isActive,
        expires_at: expiresAt,
        is_lifetime: isLifetime,
        notes: notes,
        updated_at: new Date().toISOString()
      });

      if (!existingId) {
        record.created_at = new Date().toISOString().replace('T', ' ').slice(0, 19);
      }

      const res = await fetch(FIREBASE_URL + '/users/' + encodeURIComponent(firebaseKey) + '.json', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(record)
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);

      await logActivity('Admin', existingId ? "hat Kunde '" + customerName + "' aktualisiert." : "hat neuen Kunden '" + customerName + "' angelegt.");
      showToast(existingId ? '✅ Kunde erfolgreich aktualisiert!' : '✅ Neuer Kunde angelegt!');
      closeModal();
      await loadUsers(false);
    } catch (e) {
      showToast('Fehler beim Speichern: ' + e.message, true);
    } finally {
      if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = '💾 Speichern'; }
    }
  }

  async function deleteUser(id) {
    const u = allUsers.find(x => x.id === id);
    if (!u) return;
    if (!confirm("Kunde '" + u.username + "' wirklich unwiderruflich aus der Cloud löschen?")) return;

    try {
      const res = await fetch(FIREBASE_URL + '/users/' + encodeURIComponent(id) + '.json', { method: 'DELETE' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      await logActivity('Admin', "hat Kunde '" + u.username + "' gelöscht.");
      showToast("🗑️ Kunde '" + u.username + "' gelöscht.");
      await loadUsers(false);
    } catch (e) {
      showToast('Fehler beim Löschen: ' + e.message, true);
    }
  }

  // =========================================================================
  // LICENSE KEYS SYSTEM (/licenses.json)
  // =========================================================================
  async function loadLicenses(showToastNotice = false) {
    try {
      const res = await fetch(FIREBASE_URL + '/licenses.json?t=' + Date.now(), { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = (await res.json()) || {};

      allLicenses = Object.entries(data)
        .filter(([k, v]) => v && typeof v === 'object')
        .map(([k, v]) => {
          const isFree = v.status === 'free' || v.status === 'active' || (!v.status && !v.used_by);
          return {
            key: k,
            plan: v.plan || '1y1',
            status: isFree ? 'free' : 'used',
            note: v.note || v.notes || '',
            created_at: v.created_at || v.createdAt || '',
            used_by: v.used_by || v.usedBy || v.account || null,
            used_at: v.used_at || v.usedAt || null
          };
        });

      const statLicEl = document.getElementById('stat-licenses-count');
      const statLicSub = document.getElementById('stat-licenses-sub');
      const freeCount = allLicenses.filter(l => l.status === 'free').length;
      const usedCount = allLicenses.filter(l => l.status === 'used').length;

      if (statLicEl) statLicEl.textContent = String(allLicenses.length);
      if (statLicSub) statLicSub.textContent = freeCount + ' frei / ' + usedCount + ' eingelöst';

      filterLicenses();
      if (showToastNotice) {
        showToast('🔑 ' + allLicenses.length + ' Lizenzen geladen');
      }
    } catch (e) {
      console.warn('Lizenzen konnten nicht geladen werden:', e);
    }
  }

  function setLicStatusFilter(status) {
    licStatusFilter = status;
    document.querySelectorAll('.lic-filter-btn').forEach(b => {
      if (b.getAttribute('data-status') === status) {
        b.style.background = 'rgba(250,204,21,0.2)';
        b.style.color = '#facc15';
      } else {
        b.style.background = 'transparent';
        b.style.color = '#a1a1aa';
      }
    });
    filterLicenses();
  }

  function filterLicenses() {
    const searchEl = document.getElementById('lic-search-input');
    const planEl = document.getElementById('lic-plan-filter');
    const q = (searchEl ? searchEl.value : '').toLowerCase().trim();
    const selectedPlan = planEl ? planEl.value : 'all';

    filteredLicenses = allLicenses.filter(lic => {
      if (licStatusFilter === 'free' && lic.status !== 'free') return false;
      if (licStatusFilter === 'used' && lic.status !== 'used') return false;
      if (selectedPlan !== 'all' && lic.plan !== selectedPlan) return false;
      if (q) {
        const matchKey = lic.key.toLowerCase().includes(q);
        const matchNote = lic.note && lic.note.toLowerCase().includes(q);
        const matchUsed = lic.used_by && lic.used_by.toLowerCase().includes(q);
        return matchKey || matchNote || matchUsed;
      }
      return true;
    });

    filteredLicenses.sort((a, b) => {
      if (a.status !== b.status) return a.status === 'free' ? -1 : 1;
      return (b.created_at || '').localeCompare(a.created_at || '');
    });

    const freeCount = allLicenses.filter(l => (selectedPlan === 'all' || l.plan === selectedPlan) && l.status === 'free').length;
    const usedCount = allLicenses.filter(l => (selectedPlan === 'all' || l.plan === selectedPlan) && l.status === 'used').length;
    const totalCount = freeCount + usedCount;

    const elTotal = document.getElementById('lic-count-total');
    const elFree = document.getElementById('lic-count-free');
    const elUsed = document.getElementById('lic-count-used');
    if (elTotal) elTotal.textContent = String(totalCount);
    if (elFree) elFree.textContent = String(freeCount);
    if (elUsed) elUsed.textContent = String(usedCount);

    renderLicensesTable(filteredLicenses);
  }

  function renderLicensesTable(licenses) {
    const tbody = document.getElementById('licenses-tbody');
    if (!tbody) return;

    if (!licenses || licenses.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: #71717a; padding: 26px;">Keine Lizenzen für diesen Filter gefunden.</td></tr>';
      return;
    }

    tbody.innerHTML = '';
    const displayList = licenses.slice(0, 250);

    displayList.forEach(lic => {
      const tr = document.createElement('tr');
      const planLabel = PLAN_LABELS[lic.plan] || lic.plan;
      const planStyle = PLAN_BADGE_STYLES[lic.plan] || 'background: rgba(255,255,255,0.06); color: #fff;';
      const isFree = lic.status === 'free';

      tr.innerHTML = `
        <td style="padding: 10px 14px; font-family: 'JetBrains Mono', monospace; font-weight: 700; color: #facc15; white-space: nowrap;">
          <span style="user-select: all;">${escapeHtml(lic.key)}</span>
          <button type="button" class="btn btn-outline" onclick="copyText('${lic.key}')" title="In Zwischenablage kopieren" style="padding: 2px 6px; font-size: 10px; margin-left: 6px;">📋</button>
        </td>
        <td style="padding: 10px 14px; white-space: nowrap;">
          <span class="status-badge" style="${planStyle}; font-size: 11px;">${escapeHtml(planLabel)}</span>
        </td>
        <td style="padding: 10px 14px; white-space: nowrap;">
          <span class="status-badge ${isFree ? 'active' : 'inactive'}" style="font-size: 11px;">
            ${isFree ? '🟢 Frei' : '🔴 Eingelöst'}
          </span>
        </td>
        <td style="padding: 10px 14px; color: #d4d4d8; font-size: 11.5px; max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(lic.note)}">
          ${escapeHtml(lic.note || '-')}
        </td>
        <td style="padding: 10px 14px; color: #a1a1aa; font-size: 11.5px; white-space: nowrap;">
          ${lic.used_by ? `<b style="color:#fff;">${escapeHtml(lic.used_by)}</b> <span style="font-size:10px; opacity:0.7;">(${escapeHtml((lic.used_at || '').slice(0, 10))})</span>` : '<span style="color:#52525b;">-</span>'}
        </td>
        <td style="padding: 10px 14px; text-align: right; white-space: nowrap;">
          <button type="button" class="btn btn-danger" onclick="deleteLicenseKey('${lic.key}')" title="Lizenzschlüssel löschen" style="padding: 3px 8px; font-size: 10.5px;">🗑️</button>
        </td>
      `;

      tbody.appendChild(tr);
    });

    if (licenses.length > 250) {
      const extraTr = document.createElement('tr');
      extraTr.innerHTML = '<td colspan="6" style="text-align:center; color: #a1a1aa; padding: 12px; font-size: 11px;">... und ' + (licenses.length - 250) + ' weitere Keys (Filter oben nutzen).</td>';
      tbody.appendChild(extraTr);
    }
  }

  function setGenCount(count) {
    genKeyCount = count;
    document.querySelectorAll('.gen-count-btn').forEach(b => {
      const c = parseInt(b.getAttribute('data-count'), 10);
      if (c === count) {
        b.style.background = '#facc15';
        b.style.color = '#000';
        b.style.border = '1px solid #facc15';
        b.style.fontWeight = '800';
      } else {
        b.style.background = 'rgba(255,255,255,0.05)';
        b.style.color = '#e4e4e7';
        b.style.border = '1px solid rgba(255,255,255,0.14)';
        b.style.fontWeight = '700';
      }
    });

    const label = document.getElementById('btn-gen-label');
    if (label) {
      label.textContent = count === 1 ? '1 Key' : count + ' Keys';
    }
  }

  function generateRandomKey() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const seg = (len) => Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    return 'HYS-' + seg(4) + '-' + seg(4) + '-' + seg(4);
  }

  async function generateKeys() {
    const planSelect = document.getElementById('gen-plan');
    const customKeyInput = document.getElementById('gen-custom-key');
    const noteInput = document.getElementById('gen-note');
    const genBtn = document.getElementById('btn-generate-key');

    const selectedPlan = planSelect ? planSelect.value : '1y3';
    const customKey = customKeyInput ? customKeyInput.value.trim().toUpperCase() : '';
    const note = noteInput ? noteInput.value.trim() : '';

    if (genBtn) { genBtn.disabled = true; genBtn.textContent = '⏳ Generiere...'; }

    try {
      const plansToGen = selectedPlan === 'all_each'
        ? ['1y1', '1y3', 'lt1', 'lt3', 'extra']
        : [selectedPlan];

      const newKeysObj = {};
      const newKeyList = [];

      for (const p of plansToGen) {
        const count = selectedPlan === 'all_each' ? genKeyCount : genKeyCount;
        for (let i = 0; i < count; i++) {
          let k = (count === 1 && customKey) ? customKey : generateRandomKey();
          newKeysObj[k] = {
            plan: p,
            status: 'free',
            note: note || (selectedPlan === 'all_each' ? 'Bulk All' : 'Generiert'),
            created_at: new Date().toISOString()
          };
          newKeyList.push(k);
        }
      }

      const res = await fetch(FIREBASE_URL + '/licenses.json', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newKeysObj)
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);

      const clipText = newKeyList.join('\n');
      await navigator.clipboard.writeText(clipText);

      showToast('⚡ ' + newKeyList.length + ' Keys erstellt & in Zwischenablage kopiert!');
      if (customKeyInput) customKeyInput.value = '';
      await loadLicenses(false);
    } catch (e) {
      showToast('Fehler bei der Key-Generierung: ' + e.message, true);
    } finally {
      if (genBtn) {
        genBtn.disabled = false;
        genBtn.textContent = '⚡ ' + (genKeyCount === 1 ? '1 Key' : genKeyCount + ' Keys') + ' erstellen';
      }
    }
  }

  async function exportPackageKeys() {
    const planEl = document.getElementById('lic-plan-filter');
    const amountEl = document.getElementById('lic-export-amount');
    const selectedPlan = planEl ? planEl.value : 'all';
    const selectedAmount = amountEl ? amountEl.value : '50';

    const freeMatching = allLicenses.filter(l => {
      if (l.status !== 'free') return false;
      if (selectedPlan !== 'all' && l.plan !== selectedPlan) return false;
      return true;
    });

    if (freeMatching.length === 0) {
      showToast('Keine freien Keys für diesen Filter vorhanden!', true);
      return;
    }

    let takeCount = freeMatching.length;
    if (selectedAmount !== 'all') {
      const num = parseInt(selectedAmount, 10);
      if (num > 0) takeCount = Math.min(num, freeMatching.length);
    }

    const keysToCopy = freeMatching.slice(0, takeCount).map(l => l.key);
    const textToCopy = keysToCopy.join('\n');

    try {
      await navigator.clipboard.writeText(textToCopy);
      const planName = selectedPlan === 'all' ? 'Alle Pakete' : (PLAN_LABELS[selectedPlan] || selectedPlan);
      showToast('📋 ' + keysToCopy.length + ' freie Keys kopiert! (Paket: ' + planName + ')');
    } catch (e) {
      showToast('Konnte nicht kopieren: ' + e.message, true);
    }
  }

  async function deleteLicenseKey(key) {
    if (!confirm("Lizenzschlüssel '" + key + "' wirklich löschen?")) return;
    try {
      const res = await fetch(FIREBASE_URL + '/licenses/' + encodeURIComponent(key) + '.json', { method: 'DELETE' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      showToast("🗑️ Key '" + key + "' gelöscht.");
      await loadLicenses(false);
    } catch (e) {
      showToast('Fehler beim Löschen: ' + e.message, true);
    }
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      showToast('📋 In Zwischenablage kopiert: ' + text);
    } catch (e) {
      showToast('Kopieren fehlgeschlagen: ' + e.message, true);
    }
  }

  function openLicensesModal() {
    const modal = document.getElementById('licenses-modal');
    if (modal) {
      modal.classList.add('open');
      loadLicenses(false);
    }
  }

  function closeLicensesModal() {
    const modal = document.getElementById('licenses-modal');
    if (modal) modal.classList.remove('open');
  }

  // =========================================================================
  // SHOP URL MANAGEMENT
  // =========================================================================
  async function loadShopUrl() {
    try {
      const res = await fetch(FIREBASE_URL + '/shop_url.json?t=' + Date.now(), { cache: 'no-store' });
      if (res.ok) {
        const val = await res.json();
        const input = document.getElementById('shop-url-input');
        if (input && val && typeof val === 'string') {
          input.value = val;
        }
      }
    } catch (e) {
      console.warn('Shop-URL laden fehlgeschlagen:', e);
    }
  }

  function openShopModal() {
    const modal = document.getElementById('shop-settings-modal');
    if (modal) {
      modal.classList.add('open');
      loadShopUrl();
    }
  }

  function closeShopModal() {
    const modal = document.getElementById('shop-settings-modal');
    if (modal) modal.classList.remove('open');
  }

  async function saveShopUrl() {
    const input = document.getElementById('shop-url-input');
    const saveBtn = document.getElementById('btn-save-shop-url');
    const url = input ? input.value.trim() : '';

    if (!url) {
      showToast('Bitte eine gültige Shop-URL eingeben!', true);
      return;
    }

    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Speichere...'; }

    try {
      await Promise.all([
        fetch(FIREBASE_URL + '/shop_url.json', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(url)
        }),
        fetch(FIREBASE_URL + '/config/shop_url.json', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(url)
        })
      ]);

      await logActivity('Admin', "hat die Shop-URL auf '" + url + "' gesetzt.");
      showToast('✅ Shop-URL erfolgreich in Cloud gespeichert!');
      closeShopModal();
    } catch (e) {
      showToast('Fehler beim Speichern: ' + e.message, true);
    } finally {
      if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = '💾 Link speichern'; }
    }
  }

  // =========================================================================
  // APP UPDATER MANAGEMENT (/app_update.json)
  // =========================================================================
  async function loadAppUpdateConfig(populateInputs = false) {
    try {
      const res = await fetch(FIREBASE_URL + '/app_update.json?t=' + Date.now(), { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      if (data && typeof data === 'object') {
        currentAppUpdate = Object.assign(currentAppUpdate, data);

        const statVer = document.getElementById('stat-update-ver');
        const statSub = document.getElementById('stat-update-sub');
        if (statVer) statVer.textContent = 'v' + (currentAppUpdate.version || '1.9.0');
        if (statSub) {
          statSub.textContent = currentAppUpdate.active ? '🟢 Popup aktiv' : '⚪ Kein Update aktiv';
          statSub.style.color = currentAppUpdate.active ? '#4ade80' : 'var(--text-muted)';
        }

        const vInput = document.getElementById('upd-version');
        const uInput = document.getElementById('upd-url');
        const aInput = document.getElementById('upd-android-url');
        const nInput = document.getElementById('upd-notes');
        const cInput = document.getElementById('upd-active');

        if (vInput) vInput.value = currentAppUpdate.version || '1.9.0';
        if (uInput) uInput.value = currentAppUpdate.url || '';
        if (aInput) aInput.value = currentAppUpdate.androidUrl || '';
        if (nInput) nInput.value = currentAppUpdate.notes || '';
        if (cInput) cInput.checked = Boolean(currentAppUpdate.active);
      }
    } catch (e) {
      console.warn('App-Update Konfiguration konnte nicht geladen werden:', e);
    }
  }

  function openUpdateModal() {
    const modal = document.getElementById('update-modal');
    if (modal) {
      modal.classList.add('open');
      loadAppUpdateConfig();
    }
  }

  function closeUpdateModal() {
    const modal = document.getElementById('update-modal');
    if (modal) modal.classList.remove('open');
  }

  async function saveAppUpdateConfig() {
    const saveBtn = document.getElementById('btn-save-update');
    const version = (document.getElementById('upd-version').value || '').trim();
    const url = (document.getElementById('upd-url').value || '').trim();
    const androidUrl = (document.getElementById('upd-android-url').value || '').trim();
    const notes = (document.getElementById('upd-notes').value || '').trim();
    const active = Boolean(document.getElementById('upd-active').checked);

    if (!version || !url) {
      showToast('Bitte Version und Windows-Download-URL angeben!', true);
      return;
    }

    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Speichere...'; }

    try {
      const payload = {
        version,
        url,
        androidUrl,
        notes,
        active,
        updatedAt: new Date().toISOString().replace('T', ' ').slice(0, 19)
      };

      const res = await fetch(FIREBASE_URL + '/app_update.json', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);

      // Auch die Display-Version in app_settings synchronisieren, damit der Player sofort die neue Version anzeigt
      await fetch(FIREBASE_URL + '/app_settings/display_version.json', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(version)
      }).catch(err => console.warn('display_version sync error:', err));

      currentAppUpdate = payload;
      await logActivity('Admin', active ? 'hat Player Update v' + version + ' veröffentlicht (Auto-Popup aktiv).' : 'hat Player Update v' + version + ' gespeichert (Popup inaktiv).');
      showToast(active ? '🚀 Update v' + version + ' ist LIVE!' : '💾 Update gespeichert (Popup inaktiv).');
      closeUpdateModal();
      await loadAppUpdateConfig();
    } catch (e) {
      showToast('Fehler beim Speichern: ' + e.message, true);
    } finally {
      if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = '💾 Update veröffentlichen'; }
    }
  }

  // =========================================================================
  // LOGS & CHAT FEEDS (REALTIME SYNC WITH CORRECT FIELD NAMES)
  // =========================================================================
  async function logActivity(user, msg) {
    try {
      const now = new Date();
      const timeStr = now.toLocaleDateString('de-DE') + ', ' + now.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      await fetch(FIREBASE_URL + '/logs.json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          time: timeStr,
          user: user || 'Admin',
          message: msg,
          action: msg
        })
      });
    } catch (e) {}
  }

  async function pollFeeds() {
    try {
      const [logsRes, chatRes] = await Promise.all([
        fetch(FIREBASE_URL + '/logs.json?t=' + Date.now(), { cache: 'no-store' }).catch(() => null),
        fetch(FIREBASE_URL + '/chat.json?t=' + Date.now(), { cache: 'no-store' }).catch(() => null)
      ]);

      if (logsRes && logsRes.ok) {
        const logsData = await logsRes.json();
        const logsFeed = document.getElementById('logs-feed');
        if (logsFeed && logsData) {
          const items = Object.values(logsData).slice(-40).reverse();
          logsFeed.innerHTML = items.map(l => {
            const timeStr = l.time || '';
            const userStr = l.user || 'Admin';
            const msgStr = l.message || l.action || '';
            return '<div class="feed-item"><span style="color:#facc15; font-weight:700;">[' + escapeHtml(timeStr) + ']</span> <b>' + escapeHtml(userStr) + ':</b> ' + escapeHtml(msgStr) + '</div>';
          }).join('');
        }
      }

      if (chatRes && chatRes.ok) {
        const chatData = await chatRes.json();
        const chatFeed = document.getElementById('chat-feed');
        if (chatFeed && chatData) {
          const msgs = Object.values(chatData).slice(-40);
          chatFeed.innerHTML = msgs.map(c =>
            '<div class="feed-item"><span style="color:#a1a1aa; font-size:10.5px;">[' + escapeHtml(c.time || '') + ']</span> <b style="color:#facc15;">' + escapeHtml(c.user || 'Admin') + ':</b> ' + escapeHtml(c.message || '') + '</div>'
          ).join('');
          chatFeed.scrollTop = chatFeed.scrollHeight;
        }
      }
    } catch (e) {
      console.warn('Feed poll error:', e);
    }
  }

  async function sendChat() {
    const input = document.getElementById('chat-input');
    const msg = input ? input.value.trim() : '';
    if (!msg) return;

    try {
      const now = new Date();
      const timeStr = now.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
      await fetch(FIREBASE_URL + '/chat.json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          time: timeStr,
          user: 'Admin',
          message: msg
        })
      });
      if (input) input.value = '';
      await pollFeeds();
    } catch (e) {
      showToast('Konnte Chat nicht senden: ' + e.message, true);
    }
  }

  async function clearFeed(type) {
    if (!confirm('Möchtest du diesen Feed wirklich leeren?')) return;
    try {
      await fetch(FIREBASE_URL + '/' + type + '.json', { method: 'DELETE' });
      showToast('Feed geleert!');
      await pollFeeds();
    } catch (e) {
      showToast('Fehler beim Leeren: ' + e.message, true);
    }
  }

  // =========================================================================
  // LOGIN / LOGOUT
  // =========================================================================
  function unlockPanel() {
    const loginScreen = document.getElementById('login-screen');
    if (loginScreen) {
      loginScreen.style.display = 'none';
      loginScreen.style.pointerEvents = 'none';
      loginScreen.style.zIndex = '-1';
    }
    loadUsers(false);
    pollFeeds();
    clearInterval(pollTimer);
    pollTimer = setInterval(() => {
    if (!isAnyModalOpen()) {
      loadUsers(false, true);
      pollFeeds();
    }
  }, 25000);
  }

  function doLogin(e) {
    if (e && e.preventDefault) e.preventDefault();
    const passInput = document.getElementById('login-pass');
    const p = passInput ? passInput.value.trim() : '';
    if (p === ADMIN_PASS_DEFAULT || p === '1337' || p === 'admin') {
      localStorage.setItem('hyschool_admin_pass', p);
      unlockPanel();
      return false;
    } else {
      showToast('⚠️ Falsches Admin-Passwort!', true);
      return false;
    }
  }

  function doLogout() {
    localStorage.removeItem('hyschool_admin_pass');
    clearInterval(pollTimer);
    const loginScreen = document.getElementById('login-screen');
    if (loginScreen) {
      loginScreen.style.display = 'flex';
      loginScreen.style.pointerEvents = 'auto';
      loginScreen.style.zIndex = '3000';
    }
    const passInput = document.getElementById('login-pass');
    if (passInput) passInput.value = '';
  }

  // =========================================================================
  // EXPOSE GLOBALS
  // =========================================================================
  window.openCustomerCockpit = openCustomerCockpit;
  window.closeCustomerCockpit = closeCustomerCockpit;

  window.openAddModal = openAddModal;
  window.openEditModal = openEditModal;
  window.closeModal = closeModal;
  window.saveUser = saveUser;
  window.deleteUser = deleteUser;
  window.loadUsers = loadUsers;
  window.filterUsers = filterUsers;
  window.calcDaysLeft = calcDaysLeft;
  window.setTrial30Days = setTrial30Days;
  window.addMonths = addMonths;
  window.setLifetime = setLifetime;
  window.resetHwids = resetHwids;
  window.resetUserHwidsDirect = resetUserHwidsDirect;

  window.openLicensesModal = openLicensesModal;
  window.closeLicensesModal = closeLicensesModal;
  window.loadLicenses = loadLicenses;
  window.filterLicenses = filterLicenses;
  window.setLicStatusFilter = setLicStatusFilter;
  window.setGenCount = setGenCount;
  window.generateKeys = generateKeys;
  window.exportPackageKeys = exportPackageKeys;
  window.deleteLicenseKey = deleteLicenseKey;
  window.copyText = copyText;

  window.openShopModal = openShopModal;
  window.closeShopModal = closeShopModal;
  window.saveShopUrl = saveShopUrl;

  window.openUpdateModal = openUpdateModal;
  window.closeUpdateModal = closeUpdateModal;
  window.saveAppUpdateConfig = saveAppUpdateConfig;

  window.sendChat = sendChat;
  window.clearFeed = clearFeed;
  window.doLogin = doLogin;
  window.doLogout = doLogout;

  // Auto-login check on page load
  const savedPass = localStorage.getItem('hyschool_admin_pass');
  if (savedPass === ADMIN_PASS_DEFAULT || savedPass === '1337' || savedPass === 'admin') {
    unlockPanel();
  }
})();
