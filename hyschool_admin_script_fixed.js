// Utilities
function showToast(message, isError = false) {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${isError ? 'error' : ''}`;
    toast.innerText = message;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

// Config
const FIREBASE_URL = "https://media-3a958-default-rtdb.europe-west1.firebasedatabase.app";
const KEYAUTH_NAME = "Azreal";
const KEYAUTH_OWNERID = "AryxQLu7vY";

// Local Storage for Remember Me
document.addEventListener('DOMContentLoaded', () => {
    const savedUser = localStorage.getItem('hs_user');
    const savedPass = localStorage.getItem('hs_pass');
    const savedHwid = localStorage.getItem('hs_hwid');
    if (savedUser && savedPass) {
        document.getElementById('login-user').value = savedUser;
        document.getElementById('login-pass').value = savedPass;
        document.getElementById('login-hwid').value = savedHwid || '';
        document.getElementById('login-remember').checked = true;
    }
    
    // Check if session exists in sessionStorage
    if(sessionStorage.getItem('hs_session_user')) {
        showDashboard(sessionStorage.getItem('hs_session_user'));
    }
});

// App State
let pollInterval;
let pendingAction = null; // for modal

// Login
document.getElementById('login-btn').addEventListener('click', async () => {
    const user = document.getElementById('login-user').value.trim();
    const pass = document.getElementById('login-pass').value.trim();
    let hwid = document.getElementById('login-hwid').value.trim();
    const remember = document.getElementById('login-remember').checked;
    const err = document.getElementById('login-error');
    
    if(!user || !pass) { err.innerText = "Bitte Felder ausfüllen!"; return; }
    
    err.innerText = "Verbinde...";
    
    try {
        // Init KeyAuth
        const initUrl = `https://keyauth.win/api/1.2/?type=init&ver=1.0&name=${KEYAUTH_NAME}&ownerid=${KEYAUTH_OWNERID}`;
        let res = await fetch(initUrl);
        let data = await res.json();
        
        if (!data.success) {
            err.innerText = "Server-Verbindung fehlgeschlagen!";
            return;
        }
        const sessionid = data.sessionid;
        
        // Login KeyAuth
        // Use a static HWID for the web panel so the admin can log in from any browser/device
        if (!hwid || hwid.length < 20) {
            hwid = "HYSCHOOL-WEB-ADMIN-PANEL-01";
            document.getElementById('login-hwid').value = hwid;
        }
        
        const loginUrl = `https://keyauth.win/api/1.2/?type=login&username=${encodeURIComponent(user)}&pass=${encodeURIComponent(pass)}&hwid=${encodeURIComponent(hwid)}&sessionid=${sessionid}&name=${KEYAUTH_NAME}&ownerid=${KEYAUTH_OWNERID}`;
        res = await fetch(loginUrl);
        data = await res.json();
        
        if (data.success) {
            if (remember) {
                localStorage.setItem('hs_user', user);
                localStorage.setItem('hs_pass', pass);
                localStorage.setItem('hs_hwid', hwid);
            } else {
                localStorage.removeItem('hs_user');
                localStorage.removeItem('hs_pass');
                localStorage.removeItem('hs_hwid');
            }
            err.innerText = "";
            sessionStorage.setItem('hs_session_user', user);
            showDashboard(user);
        } else {
            err.innerText = data.message || "Login fehlgeschlagen!";
        }
    } catch(e) { err.innerText = "Netzwerkfehler!"; }
});

function showDashboard(user) {
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('dashboard-screen').classList.remove('hidden');
    document.getElementById('current-user').innerText = user;
    window.currentUser = user;
    
    loadUsers();
    pollData();
    pollInterval = setInterval(pollData, 5000);
}

// Logout
document.getElementById('logout-btn').addEventListener('click', () => {
    sessionStorage.removeItem('hs_session_user');
    clearInterval(pollInterval);
    document.getElementById('dashboard-screen').classList.add('hidden');
    document.getElementById('login-screen').classList.remove('hidden');
});

// Users Management
async function loadUsers() {
    try {
        const res = await fetch(`${FIREBASE_URL}/users.json`);
        const users = await res.json() || {};
        const tbody = document.querySelector('#users-table tbody');
        tbody.innerHTML = '';
        
        const now = Date.now();

        Object.keys(users).forEach(mac => {
            const u = users[mac];
            const tr = document.createElement('tr');

            const cellMac  = document.createElement('td'); 
            cellMac.innerHTML = `<strong>${mac}</strong>`;

            const cellName = document.createElement('td'); 
            cellName.textContent = u.name || 'Neuer Nutzer';

            // Calculate Status / Expiry
            const cellStatus = document.createElement('td');
            let statusHtml = '';
            if (u.plan === 'lifetime') {
                statusHtml = '<span style="color:#22c55e; font-weight:700; background:rgba(34,197,94,0.1); padding:2px 6px; border-radius:4px;">LIFETIME</span>';
            } else if (u.expiry) {
                const expDate = new Date(u.expiry);
                const diffDays = Math.ceil((expDate.getTime() - now) / (1000 * 60 * 60 * 24));
                if (diffDays > 0) {
                    const planLabel = u.plan === 'trial' ? 'TEST' : (u.plan || 'AKTIV');
                    statusHtml = `<span style="color:#facc15; font-weight:700;">${planLabel}: ${diffDays} Tage</span><br><small style="color:#888;">${expDate.toLocaleDateString()}</small>`;
                } else {
                    statusHtml = '<span style="color:#ef4444; font-weight:700; background:rgba(239,68,68,0.1); padding:2px 6px; border-radius:4px;">ABGELAUFEN</span>';
                }
            } else {
                statusHtml = '<span style="color:#aaa;">Unbegrenzt</span>';
            }
            cellStatus.innerHTML = statusHtml;

            // Multi-Gerät Switch
            const cellMulti = document.createElement('td');
            const multiLabel = document.createElement('label');
            multiLabel.style.display = 'flex';
            multiLabel.style.alignItems = 'center';
            multiLabel.style.gap = '6px';
            multiLabel.style.cursor = 'pointer';

            const multiCheckbox = document.createElement('input');
            multiCheckbox.type = 'checkbox';
            multiCheckbox.checked = !!u.multi_device;
            multiCheckbox.addEventListener('change', async function() {
                try {
                    await fetch(`${FIREBASE_URL}/users/${mac}/multi_device.json`, {
                        method: 'PUT',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify(this.checked)
                    });
                    showToast(`${mac}: Multi-Gerät ${this.checked ? 'aktiviert' : 'deaktiviert'}`);
                    await logActivity(window.currentUser, `hat Multi-Gerät für ${mac} auf '${this.checked}' gesetzt.`);
                } catch(e) { showToast("Fehler beim Ändern", true); }
            });
            multiLabel.appendChild(multiCheckbox);
            multiLabel.appendChild(document.createTextNode(u.multi_device ? '5 Geräte' : '1 Gerät'));
            cellMulti.appendChild(multiLabel);

            const cellUrl  = document.createElement('td'); cellUrl.textContent  = u.url || '';
            const cellUser = document.createElement('td'); cellUser.textContent = u.username ? '••••' : '';
            const cellPass = document.createElement('td'); cellPass.textContent = u.password ? '••••' : '';

            // Actions & Quick-Activation buttons
            const cellAct = document.createElement('td');
            cellAct.className = 'action-buttons';
            cellAct.style.display = 'flex';
            cellAct.style.gap = '4px';
            cellAct.style.flexWrap = 'wrap';

            // Quick Activate dropdown or buttons
            const btn1Year = document.createElement('button');
            btn1Year.className = 'btn-secondary small';
            btn1Year.style.padding = '3px 6px';
            btn1Year.style.fontSize = '11px';
            btn1Year.textContent = '+1 Jahr';
            btn1Year.title = 'Auf 1 Jahr verlängern (5.99 €)';
            btn1Year.addEventListener('click', async () => activatePlan(mac, u.name || mac, 365, '1year'));

            const btnLife = document.createElement('button');
            btnLife.className = 'btn-primary small';
            btnLife.style.padding = '3px 6px';
            btnLife.style.fontSize = '11px';
            btnLife.textContent = 'Lifetime';
            btnLife.title = 'Auf Lifetime aktivieren (15.99 €)';
            btnLife.addEventListener('click', async () => activatePlan(mac, u.name || mac, null, 'lifetime'));

            const btnEdit = document.createElement('button');
            btnEdit.className = 'btn-edit';
            btnEdit.style.padding = '3px 6px';
            btnEdit.style.fontSize = '11px';
            btnEdit.textContent = 'Edit';
            btnEdit.addEventListener('click', function() {
                document.getElementById('mac-input').value  = mac;
                document.getElementById('name-input').value = u.name     || '';
                document.getElementById('url-input').value  = u.url      || '';
                document.getElementById('user-input').value = u.username || '';
                document.getElementById('pass-input').value = u.password || '';
            });

            const btnDel = document.createElement('button');
            btnDel.className = 'btn-del';
            btnDel.style.padding = '3px 6px';
            btnDel.style.fontSize = '11px';
            btnDel.textContent = 'Löschen';
            btnDel.addEventListener('click', function() { deleteUser(mac); });

            cellAct.appendChild(btn1Year);
            cellAct.appendChild(btnLife);
            cellAct.appendChild(btnEdit);
            cellAct.appendChild(btnDel);

            tr.appendChild(cellMac);
            tr.appendChild(cellName);
            tr.appendChild(cellStatus);
            tr.appendChild(cellMulti);
            tr.appendChild(cellUrl);
            tr.appendChild(cellUser);
            tr.appendChild(cellPass);
            tr.appendChild(cellAct);
            tbody.appendChild(tr);
        });
    } catch(e) { showToast("Fehler beim Laden der Kunden", true); }
}

async function activatePlan(mac, name, days, plan) {
    let expiry = null;
    if (days) {
        const d = new Date();
        d.setDate(d.getDate() + days);
        expiry = d.toISOString();
    }
    try {
        await fetch(`${FIREBASE_URL}/users/${mac}.json`, {
            method: 'PATCH',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                plan: plan,
                expiry: expiry,
                active: true,
                updated_at: Date.now()
            })
        });
        showToast(`${name}: Plan '${plan}' erfolgreich aktiviert!`);
        await logActivity(window.currentUser, `hat '${plan}' für ${name} (${mac}) aktiviert.`);
        loadUsers();
        pollData();
    } catch(e) {
        showToast("Fehler bei der Aktivierung", true);
    }
}

document.getElementById('refresh-btn').addEventListener('click', loadUsers);

document.getElementById('save-user-btn').addEventListener('click', async () => {
    const mac = document.getElementById('mac-input').value.trim().toUpperCase();
    const name = document.getElementById('name-input').value.trim();
    const url = document.getElementById('url-input').value.trim();
    const user = document.getElementById('user-input').value.trim();
    const pass = document.getElementById('pass-input').value.trim();
    
    if(!mac || !user || !pass) { showToast("Bitte Pflichtfelder ausfüllen!", true); return; }
    
    const payload = {name, url, username: user, password: pass, active: true};
    
    try {
        const res = await fetch(`${FIREBASE_URL}/users/${mac}.json`, {
            method: 'PUT',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(payload)
        });
        if(res.ok) {
            // Log activity
            await logActivity(window.currentUser, `hat den Kunden '${name}' (${mac}) hinzugefügt/bearbeitet.`);
            showToast("Kunde gespeichert!");
            ['mac', 'name', 'url', 'user', 'pass'].forEach(id => document.getElementById(id+'-input').value = '');
            loadUsers();
            pollData();
        } else { showToast("Fehler", true); }
    } catch(e) { showToast("Netzwerkfehler", true); }
});

// editUser now handled via data-* attributes on each button (see loadUsers).
window.editUser = function(mac, name, url, user, pass) {};

window.deleteUser = async function(mac) {
    if(confirm(`Möchtest du ${mac} wirklich löschen?`)) {
        try {
            const res = await fetch(`${FIREBASE_URL}/users/${mac}.json`, {method: 'DELETE'});
            if(res.ok) {
                await logActivity(window.currentUser, `hat den Kunden mit MAC '${mac}' gelöscht.`);
                showToast("Kunde gelöscht!");
                loadUsers();
                pollData();
            }
        } catch(e) { showToast("Fehler beim Löschen", true); }
    }
};

// Activity logger
async function logActivity(user, message) {
    try {
        const entry = {
            time: new Date().toLocaleString('de-DE', {year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'}),
            user: user,
            message: message
        };
        await fetch(`${FIREBASE_URL}/logs.json`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(entry)
        });
    } catch(e) {}
}

// Logs and Chat
async function pollData() {
    // Logs
    try {
        const res = await fetch(`${FIREBASE_URL}/logs.json?orderBy="$key"&limitToLast=30`);
        const logs = await res.json() || {};
        const list = document.getElementById('logs-list');
        let newHTML = '';
        Object.values(logs).forEach(v => {
            if(v && v.time && v.user && v.message) {
                newHTML += `<div class="list-item"><span class="list-time">[${v.time}]</span> <span class="list-user">${v.user}:</span> ${v.message}</div>`;
            }
        });
        if (list.innerHTML !== newHTML) {
            list.innerHTML = newHTML;
            list.scrollTop = list.scrollHeight;
        }
    } catch(e) {}
    
    // Chat
    try {
        const res = await fetch(`${FIREBASE_URL}/chat.json?orderBy="$key"&limitToLast=30`);
        const chats = await res.json() || {};
        const list = document.getElementById('chat-list');
        let newHTML = '';
        Object.values(chats).forEach(v => {
            if(v && v.time && v.user && v.message) {
                const isSelf = v.user === window.currentUser ? 'self' : '';
                newHTML += `<div class="list-item ${isSelf}"><span class="list-time">[${v.time}]</span> <span class="list-user">${v.user}:</span> ${v.message}</div>`;
            }
        });
        if (list.innerHTML !== newHTML) {
            list.innerHTML = newHTML;
            list.scrollTop = list.scrollHeight;
        }
    } catch(e) {}
}

document.getElementById('chat-send-btn').addEventListener('click', sendChat);
document.getElementById('chat-input').addEventListener('keypress', e => { if(e.key === 'Enter') sendChat(); });

async function sendChat() {
    const input = document.getElementById('chat-input');
    const msg = input.value.trim();
    if(!msg) return;
    input.value = '';
    
    const entry = {
        time: new Date().toLocaleTimeString('de-DE', {hour: '2-digit', minute: '2-digit'}),
        user: window.currentUser,
        message: msg
    };
    
    await fetch(`${FIREBASE_URL}/chat.json`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(entry)
    });
    pollData();
}

// PIN Modal Logic
const modal = document.getElementById('pin-modal');
document.getElementById('clear-logs-btn').addEventListener('click', () => { pendingAction = 'logs'; modal.classList.remove('hidden'); document.getElementById('pin-input').focus(); });
document.getElementById('clear-chat-btn').addEventListener('click', () => { pendingAction = 'chat'; modal.classList.remove('hidden'); document.getElementById('pin-input').focus(); });

document.getElementById('pin-cancel').addEventListener('click', () => { modal.classList.add('hidden'); document.getElementById('pin-input').value = ''; });
document.getElementById('pin-confirm').addEventListener('click', submitPin);
document.getElementById('pin-input').addEventListener('keypress', e => { if(e.key === 'Enter') submitPin(); });

async function submitPin() {
    const pin = document.getElementById('pin-input').value;
    if(pin !== '1337') {
        showToast("Falsche PIN", true);
        return;
    }
    
    const endpoint = pendingAction === 'logs' ? 'logs.json' : 'chat.json';
    try {
        const res = await fetch(`${FIREBASE_URL}/${endpoint}`, {method: 'DELETE'});
        if(res.ok) {
            showToast(`${pendingAction === 'logs' ? 'Logs' : 'Chat'} geleert!`);
            pollData();
        } else {
            showToast("Fehler beim Leeren", true);
        }
    } catch(e) { showToast("Netzwerkfehler", true); }
    modal.classList.add('hidden');
    document.getElementById('pin-input').value = '';
}


// ==========================================
// SHOP & ANGEBOTE MANAGER (LIVE SYNCHRONISIERT)
// ==========================================
const DEFAULT_OFFERS = [
    {
        id: "tier_1year",
        title: "1 Jahr kaufen",
        price: "5.99 €",
        duration: "365",
        devices: 1,
        badge: "STANDARD",
        link: "https://hyschool.net/buy/1year",
        active: true
    },
    {
        id: "tier_1year_multi",
        title: "1 Jahr kaufen + 4 Geräte",
        price: "10.99 €",
        duration: "365",
        devices: 5,
        badge: "FAMILIE & MULTI",
        link: "https://hyschool.net/buy/1year-multi",
        active: true
    },
    {
        id: "tier_lifetime",
        title: "Lifetime kaufen",
        price: "15.99 €",
        duration: "lifetime",
        devices: 1,
        badge: "BEST VALUE",
        link: "https://hyschool.net/buy/lifetime",
        active: true
    },
    {
        id: "tier_lifetime_multi",
        title: "Lifetime + 4 Geräte",
        price: "35.99 €",
        duration: "lifetime",
        devices: 5,
        badge: "ULTIMATE LIFETIME",
        link: "https://hyschool.net/buy/lifetime-multi",
        active: true
    }
];

let currentEditingOfferId = null;

async function loadShopOffers() {
    const container = document.getElementById('shop-offers-list');
    if (!container) return;
    try {
        const res = await fetch(`${FIREBASE_URL}/shop_offers.json`);
        let offers = await res.json();
        if (!offers || Object.keys(offers).length === 0) {
            // Seed defaults if not in firebase
            const seedObj = {};
            DEFAULT_OFFERS.forEach(o => { seedObj[o.id] = o; });
            await fetch(`${FIREBASE_URL}/shop_offers.json`, {
                method: 'PUT',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(seedObj)
            });
            offers = seedObj;
        }

        container.innerHTML = '';
        Object.keys(offers).forEach(id => {
            const o = offers[id];
            if (!o) return;
            const card = document.createElement('div');
            card.style.background = 'rgba(255,255,255,0.04)';
            card.style.border = '1px solid rgba(255,255,255,0.08)';
            card.style.borderRadius = '8px';
            card.style.padding = '10px 14px';
            card.style.display = 'flex';
            card.style.justifyContent = 'space-between';
            card.style.alignItems = 'center';

            card.innerHTML = `
                <div>
                    <div style="display:flex; align-items:center; gap:8px;">
                        <strong style="color:#fff; font-size:14px;">${o.title}</strong>
                        <span style="color:var(--accent,#facc15); font-weight:800; font-size:14px;">${o.price}</span>
                        ${o.badge ? `<span style="font-size:10px; background:rgba(250,204,21,0.15); color:var(--accent,#facc15); padding:2px 6px; border-radius:4px; font-weight:700;">${o.badge}</span>` : ''}
                    </div>
                    <div style="font-size:11px; color:#aaa; margin-top:4px;">
                        Geräte: ${o.devices || 1} | Laufzeit: ${o.duration === 'lifetime' ? 'Lifetime' : o.duration + ' Tage'} | 
                        <a href="${o.link || '#'}" target="_blank" style="color:#38bdf8; text-decoration:none;">Zahlungs-Link ↗</a>
                    </div>
                </div>
                <div style="display:flex; gap:6px;">
                    <button class="btn-secondary small btn-edit-offer" data-id="${id}">Edit</button>
                    <button class="btn-danger small btn-del-offer" data-id="${id}">Löschen</button>
                </div>
            `;
            container.appendChild(card);
        });

        // Bind Edit / Delete buttons
        container.querySelectorAll('.btn-edit-offer').forEach(btn => {
            btn.addEventListener('click', function() {
                openOfferModal(this.dataset.id, offers[this.dataset.id]);
            });
        });
        container.querySelectorAll('.btn-del-offer').forEach(btn => {
            btn.addEventListener('click', async function() {
                if (confirm('Angebot wirklich löschen?')) {
                    await fetch(`${FIREBASE_URL}/shop_offers/${this.dataset.id}.json`, { method: 'DELETE' });
                    showToast('Angebot gelöscht!');
                    loadShopOffers();
                }
            });
        });

    } catch(e) {
        console.error("Error loading offers:", e);
    }
}

function openOfferModal(id = null, offer = null) {
    currentEditingOfferId = id;
    const modal = document.getElementById('offer-modal');
    if (!modal) return;
    document.getElementById('offer-modal-title').textContent = id ? 'Angebot bearbeiten' : 'Neues Angebot hinzufügen';
    document.getElementById('offer-title-input').value = offer ? (offer.title || '') : '';
    document.getElementById('offer-price-input').value = offer ? (offer.price || '') : '';
    document.getElementById('offer-duration-input').value = offer ? (offer.duration || '365') : '365';
    document.getElementById('offer-devices-input').value = offer ? (offer.devices || 1) : 1;
    document.getElementById('offer-badge-input').value = offer ? (offer.badge || '') : '';
    document.getElementById('offer-link-input').value = offer ? (offer.link || '') : '';
    modal.classList.remove('hidden');
}

const offerModal = document.getElementById('offer-modal');
const addOfferBtn = document.getElementById('add-offer-btn');
const cancelOfferBtn = document.getElementById('offer-cancel-btn');
const saveOfferBtn = document.getElementById('offer-save-btn');

if (addOfferBtn) addOfferBtn.addEventListener('click', () => openOfferModal(null, null));
if (cancelOfferBtn) cancelOfferBtn.addEventListener('click', () => { if (offerModal) offerModal.classList.add('hidden'); });

if (saveOfferBtn) {
    saveOfferBtn.addEventListener('click', async () => {
        const title = document.getElementById('offer-title-input').value.trim();
        const price = document.getElementById('offer-price-input').value.trim();
        const duration = document.getElementById('offer-duration-input').value;
        const devices = parseInt(document.getElementById('offer-devices-input').value, 10) || 1;
        const badge = document.getElementById('offer-badge-input').value.trim();
        const link = document.getElementById('offer-link-input').value.trim();

        if (!title || !price) {
            showToast("Titel und Preis sind Pflichtfelder!", true);
            return;
        }

        const id = currentEditingOfferId || ('offer_' + Date.now());
        const payload = {
            id,
            title,
            price,
            duration,
            devices,
            badge,
            link,
            active: true,
            updated_at: Date.now()
        };

        try {
            await fetch(`${FIREBASE_URL}/shop_offers/${id}.json`, {
                method: 'PUT',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(payload)
            });
            showToast("Angebot gespeichert!");
            if (offerModal) offerModal.classList.add('hidden');
            loadShopOffers();
        } catch(e) {
            showToast("Fehler beim Speichern des Angebots", true);
        }
    });
}

// Hook into initial dashboard load
const origShowDashboard = window.showDashboard;
window.showDashboard = function(username) {
    if (typeof origShowDashboard === 'function') origShowDashboard(username);
    loadShopOffers();
};
if (document.getElementById('dashboard-screen') && !document.getElementById('dashboard-screen').classList.contains('hidden')) {
    loadShopOffers();
}
