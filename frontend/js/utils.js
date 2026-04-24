// ===== SwiftConnect Utilities =====

const API_BASE = window.location.origin;

function getToken() {
    return localStorage.getItem('access_token');
}

function authHeaders() {
    const headers = {
        'Authorization': `Bearer ${getToken()}`,
        'Content-Type': 'application/json',
    };
    const pin = sessionStorage.getItem('chatPin');
    if (pin) headers['X-Chat-Pin'] = pin;
    return headers;
}

function authHeadersNoContent() {
    const headers = { 'Authorization': `Bearer ${getToken()}` };
    const pin = sessionStorage.getItem('chatPin');
    if (pin) headers['X-Chat-Pin'] = pin;
    return headers;
}

async function apiFetch(url, options = {}) {
    if (!options.headers) options.headers = authHeaders();
    const res = await fetch(`${API_BASE}${url}`, options);
    if (res.status === 401) {
        const refreshed = await refreshToken();
        if (refreshed) {
            options.headers = authHeaders();
            return fetch(`${API_BASE}${url}`, options);
        } else {
            logout();
            return null;
        }
    }
    return res;
}

async function refreshToken() {
    try {
        const res = await fetch(`${API_BASE}/api/accounts/token/refresh/`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refresh: localStorage.getItem('refresh_token') })
        });
        if (res.ok) {
            const data = await res.json();
            localStorage.setItem('access_token', data.access);
            return true;
        }
    } catch (e) {}
    return false;
}

function formatTime(isoString) {
    const d = new Date(isoString);
    const now = new Date();
    const hours = d.getHours().toString().padStart(2, '0');
    const mins = d.getMinutes().toString().padStart(2, '0');
    const time = `${hours}:${mins}`;

    if (d.toDateString() === now.toDateString()) return time;

    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';

    return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
}

function formatDateDivider(isoString) {
    const d = new Date(isoString);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) return 'Today';
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
}

function getInitials(name) {
    if (!name) return 'U';
    return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

function getTickIcon(status) {
    if (status === 'seen') return '<span class="message-ticks seen">✓✓</span>';
    if (status === 'delivered') return '<span class="message-ticks delivered">✓✓</span>';
    return '<span class="message-ticks">✓</span>';
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function getFileIcon(type) {
    const icons = { image: '🖼️', video: '🎬', audio: '🎵', file: '📄' };
    return icons[type] || '📄';
}
