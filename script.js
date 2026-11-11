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
        
        Object.keys(users).forEach(mac => {
            const u = users[mac];
            const tr = document.createElement('tr');

            const cellMac  = document.createElement('td'); cellMac.textContent  = mac;
            const cellName = document.createElement('td'); cellName.textContent = u.name     || '';
            const cellUrl  = document.createElement('td'); cellUrl.textContent  = u.url      || '';
            const cellUser = document.createElement('td'); cellUser.textContent = u.username ? '••••••' : '';
            const cellPass = document.createElement('td'); cellPass.textContent = u.password ? '••••••' : '';

            const cellAct = document.createElement('td');
            cellAct.className = 'action-buttons';

            const btnEdit = document.createElement('button');
            btnEdit.className = 'btn-edit';
            btnEdit.textContent = 'Bearbeiten';
            btnEdit.dataset.mac      = mac;
            btnEdit.dataset.name     = u.name     || '';
            btnEdit.dataset.url      = u.url      || '';
            btnEdit.dataset.username = u.username || '';
            btnEdit.dataset.password = u.password || '';
            btnEdit.addEventListener('click', function() {
                document.getElementById('mac-input').value  = this.dataset.mac;
                document.getElementById('name-input').value = this.dataset.name;
                document.getElementById('url-input').value  = this.dataset.url;
                document.getElementById('user-input').value = this.dataset.username;
                document.getElementById('pass-input').value = this.dataset.password;
            });

            const btnDel = document.createElement('button');
            btnDel.className = 'btn-del';
            btnDel.textContent = 'Löschen';
            btnDel.dataset.mac = mac;
            btnDel.addEventListener('click', function() { deleteUser(this.dataset.mac); });

            cellAct.appendChild(btnEdit);
            cellAct.appendChild(btnDel);

            tr.appendChild(cellMac);
            tr.appendChild(cellName);
            tr.appendChild(cellUrl);
            tr.appendChild(cellUser);
            tr.appendChild(cellPass);
            tr.appendChild(cellAct);
            tbody.appendChild(tr);
        });
    } catch(e) { showToast("Fehler beim Laden der Kunden", true); }
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
