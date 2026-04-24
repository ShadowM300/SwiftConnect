// ===== SwiftConnect Auth =====

let currentUser = null;

async function initAuth() {
    if (!getToken()) {
        window.location.href = '/';
        return false;
    }
    try {
        const res = await apiFetch('/api/accounts/profile/');
        if (!res || !res.ok) { logout(); return false; }
        currentUser = await res.json();
        // Set avatar initial
        const avatar = document.getElementById('myAvatar');
        if (avatar) {
            avatar.textContent = getInitials(currentUser.first_name + ' ' + currentUser.last_name || currentUser.username);
        }
        return true;
    } catch (e) {
        logout();
        return false;
    }
}

function logout() {
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    window.location.href = '/';
}
