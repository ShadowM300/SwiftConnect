// ===== SwiftConnect Chat Logic =====

let conversations = [];
let activeConversation = null;
let activeConversationId = null;
let messages = [];
let replyToMessage = null;
let selectedFile = null;
let selectedGroupMembers = [];
let typingTimer = null;
let currentSidebarView = 'all'; // 'all', 'archived', 'locked'

// ===== INIT =====
async function initApp() {
    const ok = await initAuth();
    if (!ok) return;
    connectPresence();
    connectCallSocket();
    await loadConversations();
    setInterval(loadConversations, 10000);
}

// ===== CONVERSATIONS =====
async function loadConversations() {
    try {
        const res = await apiFetch('/api/chat/conversations/');
        if (!res || !res.ok) return;
        const data = await res.json();
        conversations = data.results || data;
        renderConversations();
    } catch (e) { console.error('Load conversations error:', e); }
}

function renderConversations() {
    const list = document.getElementById('conversationList');
    list.innerHTML = '';
    
    // Update active tab buttons
    document.getElementById('archivedBtn').style.background = currentSidebarView === 'archived' ? 'var(--wa-bg-hover)' : '';
    document.getElementById('lockedBtn').style.background = currentSidebarView === 'locked' ? 'var(--wa-bg-hover)' : '';

    // Update Study Mode UI
    const studyStatusEl = document.getElementById('studyModeStatus');
    const isStudyActive = currentUser && (currentUser.study_mode_active === true || String(currentUser.study_mode_active).toLowerCase() === 'true');
    if (studyStatusEl) {
        studyStatusEl.style.display = isStudyActive ? 'inline-block' : 'none';
    }
    document.getElementById('studyModeBtn').style.background = isStudyActive ? 'var(--wa-bg-hover)' : '';

    let filteredConversations = conversations.filter(conv => {
        const isArchived = conv.settings?.is_archived;
        const isLocked = conv.settings?.is_locked;
        
        if (currentSidebarView === 'archived') return isArchived;
        if (currentSidebarView === 'locked') return isLocked;
        return !isArchived && !isLocked;
    });

    // Apply Study Mode Filter
    if (isStudyActive) {
        filteredConversations = filteredConversations.filter(conv => {
            return conv.settings && (conv.settings.is_study_allowed === true || conv.settings.is_study_allowed === 'true');
        });
    }

    if (filteredConversations.length === 0) {
        list.innerHTML = `<div style="text-align:center; padding: 20px; color: var(--wa-text-secondary)">No conversations found in this section.</div>`;
        return;
    }

    filteredConversations.forEach(conv => {
        const other = conv.is_group ? null : conv.participants.find(p => p.id !== currentUser.id);
        const name = conv.display_name || (other ? other.username : 'Chat');
        const initials = getInitials(name);
        const lastMsg = conv.last_message;
        const isOnline = other ? onlineUsers.has(other.id) : false;
        const isActive = activeConversationId === conv.id;

        let preview = '';
        if (lastMsg) {
            const isMine = currentUser && lastMsg.sender_id === currentUser.id;
            const prefix = conv.is_group && !isMine ? `${lastMsg.sender}: ` : (isMine ? 'You: ' : '');
            if (lastMsg.message_type !== 'text') {
                preview = prefix + getFileIcon(lastMsg.message_type) + ' ' + (lastMsg.message_type.charAt(0).toUpperCase() + lastMsg.message_type.slice(1));
            } else {
                preview = prefix + (lastMsg.content || '').slice(0, 40);
            }
        }

        const avatarContent = conv.display_avatar
            ? `<img src="${conv.display_avatar}" alt="">`
            : initials;

        const item = document.createElement('div');
        item.className = `conv-item${isActive ? ' active' : ''}`;
        item.dataset.convId = conv.id;
        item.dataset.otherUserId = other ? other.id : '';
        item.onclick = () => openConversation(conv.id);
        item.innerHTML = `
            <div class="conv-avatar">
                ${avatarContent}
                <div class="online-dot" style="display:${isOnline ? 'block' : 'none'}"></div>
            </div>
            <div class="conv-info">
                <div class="conv-info-top">
                    <span class="conv-name">${escapeHtml(name)}</span>
                    <span class="conv-time${conv.unread_count > 0 ? ' unread' : ''}">
                        ${conv.settings?.is_muted ? '🔕 ' : ''}${lastMsg ? formatTime(lastMsg.timestamp) : ''}
                    </span>
                </div>
                <div class="conv-preview">
                    <span>${escapeHtml(preview)}</span>
                    ${conv.unread_count > 0 ? `<span class="unread-badge">${conv.unread_count}</span>` : ''}
                </div>
            </div>
        `;
        list.appendChild(item);
    });
}

// ===== OPEN CONVERSATION =====
async function openConversation(convId) {
    activeConversationId = convId;
    activeConversation = conversations.find(c => c.id === convId);

    document.getElementById('emptyChat').style.display = 'none';
    document.getElementById('activeChatView').style.display = 'flex';

    // Mobile responsive
    document.getElementById('sidebar').classList.add('hidden');
    document.getElementById('chatPanel').classList.add('active');

    // Set header
    const name = activeConversation.display_name || 'Chat';
    document.getElementById('chatName').textContent = name;
    document.getElementById('chatAvatar').textContent = getInitials(name);

    if (activeConversation.display_avatar) {
        document.getElementById('chatAvatar').innerHTML = `<img src="${activeConversation.display_avatar}" alt="">`;
    }

    updateChatHeaderStatus();

    // Connect WebSocket
    connectChat(convId);

    // Load messages
    await loadMessages(convId);

    // Check block status
    if (activeConversation.settings?.is_blocked) {
        document.getElementById('messageInputArea').style.display = 'none';
        document.getElementById('blockedMessageArea').style.display = 'block';
    } else {
        document.getElementById('messageInputArea').style.display = 'flex';
        document.getElementById('blockedMessageArea').style.display = 'none';
    }
    
    // Update Settings Menu Toggles
    const settings = activeConversation.settings || {};
    document.getElementById('menuMute').textContent = settings.is_muted ? 'Unmute' : 'Mute';
    document.getElementById('menuArchive').textContent = settings.is_archived ? 'Unarchive' : 'Archive';
    document.getElementById('menuLock').textContent = settings.is_locked ? 'Unlock Chat' : 'Lock Chat';
    document.getElementById('menuBlock').textContent = settings.is_blocked ? 'Unblock' : 'Block';

    // Mark active in sidebar
    renderConversations();
}

function toggleChatSettingsMenu() {
    const menu = document.getElementById('chatSettingsMenu');
    menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
}

async function toggleSetting(key) {
    if (!activeConversationId) return;
    const settings = activeConversation.settings || {};
    const newValue = !settings[key];
    
    try {
        const res = await apiFetch(`/api/chat/conversations/${activeConversationId}/settings/`, {
            method: 'PUT',
            headers: authHeaders(),
            body: JSON.stringify({ [key]: newValue })
        });
        if (res.ok) {
            document.getElementById('chatSettingsMenu').style.display = 'none';
            await loadConversations();
            openConversation(activeConversationId);
        }
    } catch (e) { console.error('Failed to update setting', e); }
}

function updateChatHeaderStatus() {
    if (!activeConversation) return;
    const statusEl = document.getElementById('chatStatus');
    if (activeConversation.is_group) {
        const names = activeConversation.participants.map(p => p.first_name || p.username).join(', ');
        statusEl.textContent = names;
        statusEl.className = 'status';
    } else {
        const other = activeConversation.participants.find(p => p.id !== currentUser.id);
        if (other && onlineUsers.has(other.id)) {
            statusEl.textContent = 'online';
            statusEl.className = 'status online';
        } else {
            statusEl.textContent = 'offline';
            statusEl.className = 'status';
        }
    }
}

// ===== MESSAGES =====
async function loadMessages(convId) {
    try {
        const res = await apiFetch(`/api/chat/messages/${convId}/?page_size=200`);
        if (!res || !res.ok) return;
        const data = await res.json();
        messages = data.results || data;
        renderMessages();
        scrollToBottom();
        // Mark last messages as seen
        if (messages.length > 0) {
            const lastMsg = messages[messages.length - 1];
            if (lastMsg.sender !== currentUser.id) {
                sendSeenStatus(lastMsg.id);
            }
        }
    } catch (e) { console.error('Load messages error:', e); }
}

function renderMessages() {
    const area = document.getElementById('messagesArea');
    area.innerHTML = '';
    let lastDate = '';

    messages.forEach(msg => {
        const msgDate = formatDateDivider(msg.timestamp);
        if (msgDate !== lastDate) {
            lastDate = msgDate;
            area.innerHTML += `<div class="message-date-divider"><span>${msgDate}</span></div>`;
        }

        const isMine = msg.sender === currentUser.id;
        const bubbleClass = isMine ? 'sent' : 'received';

        let content = '';

        // Reply preview
        if (msg.reply_to_message) {
            content += `<div class="reply-preview">
                <div class="reply-name">${escapeHtml(msg.reply_to_message.sender_name)}</div>
                <div class="reply-text">${escapeHtml((msg.reply_to_message.content || '').slice(0, 50))}</div>
            </div>`;
        }

        // Sender name in groups
        if (!isMine && activeConversation && activeConversation.is_group) {
            content += `<div class="message-sender">${escapeHtml(msg.sender_name)}</div>`;
        }

        // Message content by type
        if (msg.is_deleted) {
            content += `<div class="message-text" style="font-style:italic;opacity:0.6;">🚫 This message was deleted</div>`;
        } else if (msg.message_type === 'image' && msg.file_url) {
            content += `<div class="message-image"><img src="${msg.file_url}" alt="image" onclick="window.open('${msg.file_url}','_blank')"></div>`;
            if (msg.content) content += `<div class="message-text">${escapeHtml(msg.content)}</div>`;
        } else if (msg.message_type === 'video' && msg.file_url) {
            content += `<div class="message-video"><video src="${msg.file_url}" controls></video></div>`;
            if (msg.content) content += `<div class="message-text">${escapeHtml(msg.content)}</div>`;
        } else if (msg.message_type === 'audio' && msg.file_url) {
            content += renderVoicePlayer(msg.file_url, msg.id);
            if (msg.content) content += `<div class="message-text">${escapeHtml(msg.content)}</div>`;
        } else if (msg.message_type === 'file' && msg.file_url) {
            content += `<div class="message-file" onclick="window.open('${msg.file_url}','_blank')">
                <span class="file-icon">${getFileIcon(msg.message_type)}</span>
                <div class="file-info">
                    <div class="file-name">${escapeHtml(msg.file_name || 'File')}</div>
                    <div class="file-size">${formatFileSize(msg.file_size || 0)}</div>
                </div>
            </div>`;
        } else {
            content += `<div class="message-text">${escapeHtml(msg.content)}</div>`;
        }

        // Time + ticks
        const ticks = isMine ? getTickIcon(msg.overall_status || 'sent') : '';
        content += `<div class="message-meta">
            <span class="message-time">${formatTime(msg.timestamp)}</span>
            ${ticks}
        </div>`;

        const bubble = document.createElement('div');
        bubble.className = `message-bubble ${bubbleClass}`;
        bubble.dataset.msgId = msg.id;
        bubble.innerHTML = content;
        // Double-click to reply (desktop)
        bubble.ondblclick = () => setReply(msg);
        // Right-click context menu
        bubble.addEventListener('contextmenu', (e) => showMessageContextMenu(e, msg));
        // Touch swipe-right to reply (mobile)
        let touchStartX = 0;
        bubble.addEventListener('touchstart', (e) => { touchStartX = e.touches[0].clientX; }, { passive: true });
        bubble.addEventListener('touchend', (e) => {
            const dx = e.changedTouches[0].clientX - touchStartX;
            if (dx > 60) setReply(msg); // swipe right ~60px
        });
        area.appendChild(bubble);
    });
}

function scrollToBottom() {
    const area = document.getElementById('messagesArea');
    setTimeout(() => { area.scrollTop = area.scrollHeight; }, 50);
}

// ===== SEND MESSAGE =====
function sendMessage() {
    const input = document.getElementById('messageInput');
    const content = input.value.trim();

    if (selectedFile) {
        uploadFile(content);
        return;
    }

    if (!content || !activeConversationId) return;

    sendWsMessage(content, replyToMessage ? replyToMessage.id : null);
    input.value = '';
    autoResize(input);
    cancelReply();
}

function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
}

function autoResize(el) {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}

// ===== INCOMING MESSAGE =====
function handleIncomingMessage(msg) {
    messages.push(msg);
    renderMessages();
    scrollToBottom();

    // Send seen if from other user
    if (msg.sender !== currentUser.id) {
        sendSeenStatus(msg.id);
    }

    // Refresh conversation list
    loadConversations();
}

// ===== TYPING INDICATOR =====
function handleTypingIndicator(data) {
    const indicator = document.getElementById('typingIndicator');
    const text = document.getElementById('typingText');
    if (data.is_typing) {
        text.textContent = `${data.username} is typing...`;
        indicator.style.display = 'flex';
        clearTimeout(typingTimer);
        typingTimer = setTimeout(() => {
            indicator.style.display = 'none';
        }, 3000);
    } else {
        indicator.style.display = 'none';
    }
}

// ===== MESSAGE STATUS =====
function handleStatusUpdate(data) {
    const msg = messages.find(m => m.id === data.message_id);
    if (msg) {
        msg.overall_status = data.status;
        // Update tick in DOM
        const bubble = document.querySelector(`.message-bubble[data-msg-id="${data.message_id}"]`);
        if (bubble) {
            const tickEl = bubble.querySelector('.message-ticks');
            if (tickEl) {
                if (data.status === 'seen') {
                    tickEl.className = 'message-ticks seen';
                    tickEl.textContent = '✓✓';
                } else if (data.status === 'delivered') {
                    tickEl.className = 'message-ticks delivered';
                    tickEl.textContent = '✓✓';
                }
            }
        }
    }
}

// ===== REPLY =====
function setReply(msg) {
    replyToMessage = msg;
    document.getElementById('replyBar').style.display = 'block';
    document.getElementById('replyName').textContent = msg.sender_name;
    document.getElementById('replyText').textContent = (msg.content || msg.message_type).slice(0, 60);
    document.getElementById('messageInput').focus();
}

function cancelReply() {
    replyToMessage = null;
    document.getElementById('replyBar').style.display = 'none';
}

// ===== FILE HANDLING =====
function handleFileSelect(e) {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 104857600) {
        alert('File too large! Max 100MB.');
        return;
    }
    selectedFile = file;
    document.getElementById('filePreview').style.display = 'flex';
    document.getElementById('previewFileName').textContent = `${file.name} (${formatFileSize(file.size)})`;
}

function cancelFile() {
    selectedFile = null;
    document.getElementById('filePreview').style.display = 'none';
    document.getElementById('fileInput').value = '';
}

async function uploadFile(caption) {
    if (!selectedFile || !activeConversationId) return;
    const formData = new FormData();
    formData.append('file', selectedFile);
    formData.append('caption', caption || '');

    try {
        const res = await fetch(`${API_BASE}/api/chat/messages/${activeConversationId}/upload/`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${getToken()}` },
            body: formData,
        });
        if (res.ok) {
            const msg = await res.json();
            messages.push(msg);
            renderMessages();
            scrollToBottom();
            cancelFile();
            document.getElementById('messageInput').value = '';
            loadConversations();
        }
    } catch (e) { console.error('Upload error:', e); }
}

// ===== SEARCH =====
let searchTimeout = null;
function handleSearch(query) {
    clearTimeout(searchTimeout);
    const resultsDiv = document.getElementById('searchResults');
    if (!query || query.length < 2) {
        resultsDiv.style.display = 'none';
        return;
    }
    searchTimeout = setTimeout(async () => {
        try {
            const res = await apiFetch(`/api/accounts/search/?q=${encodeURIComponent(query)}`);
            if (!res || !res.ok) return;
            const data = await res.json();
            resultsDiv.innerHTML = '';
            if (data.results.length === 0) {
                resultsDiv.innerHTML = '<div style="padding:16px;color:var(--wa-text-secondary);text-align:center;">No users found</div>';
            }
            data.results.forEach(user => {
                const item = document.createElement('div');
                item.className = 'search-result-item';
                item.innerHTML = `
                    <div class="conv-avatar" style="width:40px;height:40px;font-size:14px;margin-right:12px;">
                        ${user.avatar ? `<img src="${user.avatar}">` : getInitials(user.first_name + ' ' + user.last_name || user.username)}
                    </div>
                    <div>
                        <div style="font-size:15px;font-weight:500;">${escapeHtml(user.first_name || '')} ${escapeHtml(user.last_name || '')}</div>
                        <div style="font-size:13px;color:var(--wa-text-secondary);">@${escapeHtml(user.username)}${user.phone_number ? ' • ' + user.phone_number : ''}</div>
                    </div>
                `;
                item.onclick = () => startConversation(user.id);
                resultsDiv.appendChild(item);
            });
            resultsDiv.style.display = 'block';
        } catch (e) { console.error(e); }
    }, 300);
}

async function startConversation(userId) {
    document.getElementById('searchResults').style.display = 'none';
    document.getElementById('searchInput').value = '';
    try {
        const res = await apiFetch('/api/chat/conversations/create/', {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({ user_id: userId }),
        });
        if (!res || !res.ok) return;
        const conv = await res.json();
        await loadConversations();
        openConversation(conv.id);
    } catch (e) { console.error(e); }
}

// ===== GROUP =====
function openGroupModal() {
    selectedGroupMembers = [];
    document.getElementById('groupModal').classList.add('active');
    document.getElementById('groupNameInput').value = '';
    document.getElementById('groupSearchInput').value = '';
    document.getElementById('groupSearchResults').innerHTML = '';
    document.getElementById('selectedMembers').innerHTML = '';
}

function closeGroupModal() {
    document.getElementById('groupModal').classList.remove('active');
}

async function searchGroupMembers(query) {
    if (!query || query.length < 2) {
        document.getElementById('groupSearchResults').innerHTML = '';
        return;
    }
    try {
        const res = await apiFetch(`/api/accounts/search/?q=${encodeURIComponent(query)}`);
        if (!res || !res.ok) return;
        const data = await res.json();
        const container = document.getElementById('groupSearchResults');
        container.innerHTML = '';
        data.results.forEach(user => {
            if (selectedGroupMembers.find(m => m.id === user.id)) return;
            const item = document.createElement('div');
            item.className = 'member-item';
            item.style.cursor = 'pointer';
            item.innerHTML = `
                <div class="member-avatar">${getInitials(user.first_name + ' ' + user.last_name)}</div>
                <div class="member-name">${escapeHtml(user.first_name || user.username)} ${escapeHtml(user.last_name || '')}</div>
            `;
            item.onclick = () => addGroupMember(user);
            container.appendChild(item);
        });
    } catch (e) { console.error(e); }
}

function addGroupMember(user) {
    if (selectedGroupMembers.find(m => m.id === user.id)) return;
    selectedGroupMembers.push(user);
    renderSelectedMembers();
    document.getElementById('groupSearchInput').value = '';
    document.getElementById('groupSearchResults').innerHTML = '';
}

function removeGroupMember(userId) {
    selectedGroupMembers = selectedGroupMembers.filter(m => m.id !== userId);
    renderSelectedMembers();
}

function renderSelectedMembers() {
    const container = document.getElementById('selectedMembers');
    container.innerHTML = '';
    selectedGroupMembers.forEach(m => {
        container.innerHTML += `<div class="selected-chip">
            ${escapeHtml(m.first_name || m.username)}
            <button onclick="removeGroupMember(${m.id})">✕</button>
        </div>`;
    });
}

async function createGroup() {
    const name = document.getElementById('groupNameInput').value.trim();
    if (!name) { alert('Enter a group name'); return; }
    if (selectedGroupMembers.length === 0) { alert('Add at least one member'); return; }

    try {
        const res = await apiFetch('/api/chat/groups/create/', {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({
                group_name: name,
                participant_ids: selectedGroupMembers.map(m => m.id),
            }),
        });
        if (!res || !res.ok) return;
        const conv = await res.json();
        closeGroupModal();
        await loadConversations();
        openConversation(conv.id);
    } catch (e) { console.error(e); }
}

// ===== SIDEBAR SECTIONS =====
function toggleArchivedView() {
    currentSidebarView = currentSidebarView === 'archived' ? 'all' : 'archived';
    renderConversations();
}

function promptLockPin() {
    if (currentSidebarView === 'locked') {
        currentSidebarView = 'all';
        renderConversations();
        return;
    }
    document.getElementById('pinModal').classList.add('active');
    document.getElementById('unlockPinInput').value = '';
    document.getElementById('unlockPinInput').focus();
}

function closePinModal() {
    document.getElementById('pinModal').classList.remove('active');
}

async function submitUnlockPin() {
    const pin = document.getElementById('unlockPinInput').value;
    if (!pin) return;
    sessionStorage.setItem('chatPin', pin);
    closePinModal();
    currentSidebarView = 'locked';
    await loadConversations();
    renderConversations();
}

// ===== PROFILE =====
let profileAvatarFile = null;

async function toggleProfileModal() {
    document.getElementById('profilePanel').classList.add('active');
    try {
        const res = await apiFetch('/api/accounts/profile/');
        if (res.ok) {
            const profile = await res.json();
            document.getElementById('profileUsername').value = profile.username || '';
            document.getElementById('profileAbout').value = profile.about || '';
            document.getElementById('profilePhone').value = profile.phone_number || 'Not set';
            document.getElementById('profilePin').value = profile.chat_lock_pin || '';
            
            const avatarDisplay = document.getElementById('profileAvatarDisplay');
            if (profile.avatar) {
                avatarDisplay.innerHTML = `<img src="${profile.avatar}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">`;
            } else {
                avatarDisplay.textContent = getInitials(profile.username);
            }
        }
    } catch (e) { console.error(e); }

    // Load the user's current note into the note editor
    await loadMyNote();
}

function closeProfileModal() {
    document.getElementById('profilePanel').classList.remove('active');
    profileAvatarFile = null;
}

async function updateProfileAvatar(e) {
    if (e.target.files && e.target.files[0]) {
        profileAvatarFile = e.target.files[0];
        const reader = new FileReader();
        reader.onload = (ev) => {
            document.getElementById('profileAvatarDisplay').innerHTML = `<img src="${ev.target.result}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">`;
        };
        reader.readAsDataURL(profileAvatarFile);

        // Auto-save avatar
        const formData = new FormData();
        formData.append('avatar', profileAvatarFile);
        try {
            await fetch(`${API_BASE}/api/accounts/profile/`, {
                method: 'PUT',
                headers: authHeadersNoContent(),
                body: formData
            });
            // Update sidebar mini avatar
            if (currentUser) {
                document.getElementById('myAvatar').innerHTML = document.getElementById('profileAvatarDisplay').innerHTML;
            }
        } catch (e) { console.error(e); }
    }
}

async function removeProfileAvatar() {
    if (!confirm('Remove profile photo?')) return;
    try {
        const formData = new FormData();
        formData.append('remove_avatar', 'true');
        const res = await fetch(`${API_BASE}/api/accounts/profile/`, {
            method: 'PUT',
            headers: authHeadersNoContent(),
            body: formData
        });
        if (res.ok) {
            profileAvatarFile = null;
            document.getElementById('profileAvatarDisplay').innerHTML = getInitials(document.getElementById('profileUsername').value);
            document.getElementById('myAvatar').innerHTML = getInitials(document.getElementById('profileUsername').value);
        }
    } catch (e) { console.error(e); }
}

async function saveProfileField(field) {
    let value = '';
    if (field === 'username') value = document.getElementById('profileUsername').value;
    else if (field === 'about') value = document.getElementById('profileAbout').value;
    else if (field === 'chat_lock_pin') value = document.getElementById('profilePin').value;

    const formData = new FormData();
    formData.append(field, value);

    try {
        const res = await fetch(`${API_BASE}/api/accounts/profile/`, {
            method: 'PUT',
            headers: authHeadersNoContent(),
            body: formData
        });
        if (res.ok) {
            // Updated successfully, silently ignore
        } else {
            console.error('Failed to update field');
        }
    } catch (e) { console.error(e); }
}

// ===== MOBILE BACK =====
function goBack() {
    document.getElementById('sidebar').classList.remove('hidden');
    document.getElementById('chatPanel').classList.remove('active');
}

// ===== INIT ON LOAD =====
document.addEventListener('DOMContentLoaded', initApp);

// Close search when clicking outside
document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-container')) {
        document.getElementById('searchResults').style.display = 'none';
    }
});

// ===== CONTACT INFO PANEL =====
async function openChatInfo() {
    if (!currentConversation) return;
    
    document.getElementById('contactInfoPanel').classList.add('active');
    
    if (!currentConversation.is_group) {
        const otherUser = currentConversation.participants.find(p => p.id !== currentUser.id);
        if (otherUser) {
            try {
                const res = await apiFetch(`/api/chat/contact/${otherUser.id}/`);
                if (res.ok) {
                    const data = await res.json();
                    document.getElementById('contactInfoName').textContent = data.username;
                    document.getElementById('contactInfoPhone').textContent = data.phone_number || 'Phone not set';
                    document.getElementById('contactInfoAbout').textContent = data.about || 'Hey there! I am using SwiftConnect';
                    
                    if (data.avatar) {
                        document.getElementById('contactInfoAvatar').innerHTML = `<img src="${data.avatar}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">`;
                    } else {
                        document.getElementById('contactInfoAvatar').textContent = getInitials(data.username);
                    }
                }
            } catch (e) { console.error(e); }
        }
    } else {
        document.getElementById('contactInfoName').textContent = currentConversation.group_name;
        document.getElementById('contactInfoPhone').textContent = `${currentConversation.participants.length} participants`;
        document.getElementById('contactInfoAbout').textContent = 'Group Conversation';
        if (currentConversation.group_icon) {
            document.getElementById('contactInfoAvatar').innerHTML = `<img src="${currentConversation.group_icon}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">`;
        } else {
            document.getElementById('contactInfoAvatar').textContent = getInitials(currentConversation.group_name);
        }
    }
}

function closeContactInfo() {
    document.getElementById('contactInfoPanel').classList.remove('active');
}

// ===== NOTIFICATIONS =====
let unreadNotifs = 0;

async function fetchNotifications() {
    try {
        const res = await apiFetch('/api/chat/notifications/');
        if (res.ok) {
            const notifs = await res.json();
            const list = document.getElementById('notifList');
            list.innerHTML = '';
            
            unreadNotifs = notifs.filter(n => !n.is_read).length;
            const badge = document.getElementById('notifBadge');
            if (unreadNotifs > 0) {
                badge.textContent = unreadNotifs > 9 ? '9+' : unreadNotifs;
                badge.style.display = 'flex';
            } else {
                badge.style.display = 'none';
            }
            
            if (notifs.length === 0) {
                list.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--wa-text-secondary);">No notifications</div>';
                return;
            }
            
            notifs.forEach(n => {
                const item = document.createElement('div');
                item.className = `notif-item ${n.is_read ? '' : 'unread'}`;
                
                let text = '';
                if (n.notification_type === 'status_like') {
                    text = `<b>${n.sender_name}</b> liked your status: "${n.status_preview}"`;
                }
                
                item.innerHTML = `
                    <div style="font-size:20px;">🤍</div>
                    <div style="font-size:14px; flex:1;">${text}</div>
                    <div style="font-size:11px; color:var(--wa-text-secondary);">${formatTime(n.timestamp)}</div>
                `;
                list.appendChild(item);
            });
        }
    } catch (e) { console.error(e); }
}

function toggleNotifications() {
    const dropdown = document.getElementById('notifDropdown');
    if (dropdown.style.display === 'none') {
        dropdown.style.display = 'block';
        fetchNotifications();
        document.getElementById('notifBadge').style.display = 'none';
        unreadNotifs = 0;
    } else {
        dropdown.style.display = 'none';
    }
}

// ===== STATUS VIEW =====
let activeStatuses = [];
let currentStatusObj = null;

async function toggleStatusView() {
    document.getElementById('statusViewContainer').style.display = 'flex';
    document.getElementById('statusMyAvatar').innerHTML = document.getElementById('myAvatar').innerHTML;
    
    try {
        const res = await apiFetch('/api/chat/status/');
        if (res.ok) {
            activeStatuses = await res.json();
            renderStatusList();
        }
    } catch (e) { console.error(e); }
}

function closeStatusView() {
    document.getElementById('statusViewContainer').style.display = 'none';
    document.getElementById('statusPlayer').style.display = 'none';
    document.getElementById('statusEmpty').style.display = 'block';
    currentStatusObj = null;
}

function renderStatusList() {
    const list = document.getElementById('statusList');
    list.innerHTML = '';
    
    if (activeStatuses.length === 0) {
        list.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--wa-text-secondary);">No recent updates</div>';
        return;
    }
    
    const users = {};
    activeStatuses.forEach(s => {
        if (!users[s.username]) {
            users[s.username] = {
                username: s.username,
                avatar: s.avatar,
                statuses: [],
                latestTime: s.timestamp
            };
        }
        users[s.username].statuses.push(s);
    });
    
    Object.values(users).forEach(u => {
        const item = document.createElement('div');
        item.className = 'status-item';
        item.onclick = () => playStatus(u.statuses[0]);
        
        let avatarHtml = `<div class="user-avatar" style="width:100%;height:100%;font-size:24px;">${getInitials(u.username)}</div>`;
        if (u.avatar) {
            avatarHtml = `<img src="${u.avatar}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">`;
        }
        
        item.innerHTML = `
            <div class="status-ring">${avatarHtml}</div>
            <div>
                <div style="font-size:16px; font-weight:500;">${u.username === currentUser.username ? 'My status' : u.username}</div>
                <div style="font-size:13px; color:var(--wa-text-secondary); margin-top:2px;">${formatTime(u.latestTime)}</div>
            </div>
        `;
        list.appendChild(item);
    });
}

function playStatus(statusObj) {
    currentStatusObj = statusObj;
    document.getElementById('statusEmpty').style.display = 'none';
    
    const player = document.getElementById('statusPlayer');
    player.style.display = 'block';
    
    document.getElementById('statusPlayerName').textContent = statusObj.username;
    document.getElementById('statusPlayerTime').textContent = formatTime(statusObj.timestamp);
    
    if (statusObj.avatar) {
        document.getElementById('statusPlayerAvatar').innerHTML = `<img src="${statusObj.avatar}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">`;
    } else {
        document.getElementById('statusPlayerAvatar').textContent = getInitials(statusObj.username);
    }
    
    const contentArea = document.getElementById('statusPlayerContent');
    if (statusObj.status_type === 'text') {
        contentArea.innerHTML = `<div style="font-size:36px; padding: 40px; text-align:center;">${statusObj.content}</div>`;
    } else if (statusObj.status_type === 'image') {
        contentArea.innerHTML = `<img src="${statusObj.file}" style="max-width:100%; max-height:100%; object-fit:contain;">`;
    } else if (statusObj.status_type === 'video') {
        contentArea.innerHTML = `<video src="${statusObj.file}" controls autoplay style="max-width:100%; max-height:100%; object-fit:contain;"></video>`;
    }
    
    const likeBtn = document.getElementById('statusLikeBtn');
    if (statusObj.user === currentUser.id) {
        likeBtn.style.display = 'none';
    } else {
        likeBtn.style.display = 'flex';
        const hasLiked = statusObj.likes.some(l => l.username === currentUser.username);
        if (hasLiked) {
            likeBtn.classList.add('liked');
        } else {
            likeBtn.classList.remove('liked');
        }
    }
}

async function toggleStatusLike() {
    if (!currentStatusObj) return;
    
    try {
        const res = await apiFetch(`/api/chat/status/${currentStatusObj.id}/like/`, { method: 'POST' });
        if (res.ok) {
            const data = await res.json();
            const likeBtn = document.getElementById('statusLikeBtn');
            if (data.message === 'Liked') {
                likeBtn.classList.add('liked');
                currentStatusObj.likes.push({username: currentUser.username});
            } else {
                likeBtn.classList.remove('liked');
                currentStatusObj.likes = currentStatusObj.likes.filter(l => l.username !== currentUser.username);
            }
        }
    } catch (e) { console.error(e); }
}

async function uploadStatusFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    
    const formData = new FormData();
    formData.append('file', file);
    
    try {
        const BASE_API_URL = API_BASE.replace(/\/$/, "");
        const res = await fetch(`${BASE_API_URL}/api/chat/status/create/`, {
            method: 'POST',
            headers: authHeadersNoContent(),
            body: formData
        });
        if (res.ok) {
            toggleStatusView();
        }
    } catch (e) { console.error(e); }
}

setInterval(() => {
    if (currentUser) {
        fetchNotifications();
    }
}, 30000);

// ===== CHAT INFO SIDEBAR =====
function openChatInfo() {
    if (!activeConversation) return;
    
    // Close any open sub-panels first
    document.getElementById('starredMessagesPanel').style.display = 'none';
    document.getElementById('mediaPanel').style.display = 'none';
    document.getElementById('notificationSettingsPanel').style.display = 'none';
    document.getElementById('photoViewer').style.display = 'none';
    
    document.getElementById('chatInfoSidebar').classList.add('active');
    
    // Set Header Info
    const name = activeConversation.display_name || 'Chat';
    document.getElementById('chatInfoName').textContent = name;
    
    // Set avatar with click-to-view overlay
    const avatarEl = document.getElementById('chatInfoAvatar');
    const overlayEl = document.getElementById('chatInfoAvatarOverlay');
    
    if (activeConversation.display_avatar) {
        avatarEl.innerHTML = `<img src="${activeConversation.display_avatar}" alt="">`;
        overlayEl.style.display = 'flex';
        
        // Make avatar clickable to view photo
        avatarEl.style.cursor = 'pointer';
        avatarEl.onclick = () => {
            openPhotoViewer(activeConversation.display_avatar, name);
        };
    } else {
        avatarEl.textContent = getInitials(name);
        overlayEl.style.display = 'none';
        avatarEl.onclick = null;
        avatarEl.style.cursor = 'default';
    }
    
    // Set notification/privacy sub-text from settings
    const settings = activeConversation.settings || {};
    document.getElementById('notifSettingsSub').textContent = settings.is_muted ? 'Muted' : 'On';
    document.getElementById('advancedPrivacySub').textContent = settings.advanced_privacy ? 'On' : 'Off';
    document.getElementById('studyAllowedSub').textContent = settings.is_study_allowed ? 'On' : 'Off';
    
    // Set favourite state
    const favIcon = document.getElementById('favouriteIcon');
    const favText = document.getElementById('favouriteText');
    if (settings.is_favourite) {
        favIcon.textContent = '❤️';
        favText.textContent = 'Remove from favourites';
    } else {
        favIcon.textContent = '♡';
        favText.textContent = 'Add to favourites';
    }
    
    if (activeConversation.is_group) {
        document.getElementById('chatInfoHeaderText').textContent = 'Group info';
        document.getElementById('chatInfoStatusText').innerHTML = `Group · ${activeConversation.participants.length} members`;
        document.getElementById('chatInfoStatusDot').style.display = 'none';
        document.getElementById('chatInfoPhoneNumber').style.display = 'none';
        document.getElementById('groupActionBtns').style.display = 'flex';
        
        const creator = activeConversation.participants.find(p => p.id === activeConversation.created_by);
        document.getElementById('chatInfoCreatedBy').textContent = `Group created by ${creator ? (creator.first_name || creator.username) : 'Unknown'}, on ${new Date(activeConversation.created_at).toLocaleDateString()}`;
        document.getElementById('groupCreatedByArea').style.display = 'block';
        document.getElementById('contactAboutArea').style.display = 'none';
        document.getElementById('contactNoteArea').style.display = 'none';
        
        document.getElementById('groupParticipantsSection').style.display = 'block';
        document.getElementById('chatInfoListHeader').textContent = `${activeConversation.participants.length} members`;
        
        document.getElementById('viewMemberChangesBtn').style.display = 'flex';
        document.getElementById('exitGroupBtn').style.display = 'flex';
        document.getElementById('reportText').textContent = 'Report group';
        
        // Render Participants
        const container = document.getElementById('chatInfoParticipants');
        container.innerHTML = '';
        
        const isAdmin = activeConversation.created_by === currentUser.id;
        const hiddenIds = activeConversation.hidden_participants || [];
        
        // Put "You" first
        const me = activeConversation.participants.find(p => p.id === currentUser.id);
        const others = activeConversation.participants.filter(p => p.id !== currentUser.id);
        const sortedParticipants = me ? [me, ...others] : others;
        
        sortedParticipants.forEach(p => {
            const item = document.createElement('div');
            item.className = 'member-list-item';
            
            const isUserAdmin = activeConversation.created_by === p.id;
            const isHidden = hiddenIds.includes(p.id);
            const isMe = p.id === currentUser.id;
            
            let badges = '';
            if (isUserAdmin) {
                badges += `<span style="background: var(--wa-panel-header); border: 1px solid var(--wa-green); color: var(--wa-green); font-size: 11px; padding: 2px 6px; border-radius: 4px; margin-left: 8px;">Group admin</span>`;
            }
            if (isHidden) {
                badges += `<span style="background: #ff4a4a; color: white; font-size: 11px; padding: 2px 6px; border-radius: 4px; margin-left: 8px;">Hidden</span>`;
            }
            
            let subText = isMe ? `<span style="color:var(--wa-green);">Add member tag</span><br>${escapeHtml(p.about || 'Available')}` : escapeHtml(p.about || 'Available');
            
            const avatarHtml = p.avatar ? `<img src="${p.avatar}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">` : getInitials(p.first_name || p.username);
            
            item.innerHTML = `
                <div class="user-avatar" style="width: 40px; height: 40px; font-size: 16px; margin-right: 15px; flex-shrink:0;">
                    ${avatarHtml}
                </div>
                <div style="flex: 1; overflow:hidden;">
                    <div style="font-weight: 500; font-size:16px;">${isMe ? 'You' : escapeHtml(p.first_name || p.username)}</div>
                    <div style="font-size: 13px; color: var(--wa-text-secondary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; margin-top:2px;">${subText}</div>
                </div>
                <div style="text-align:right;">
                    ${badges}
                </div>
            `;
            
            // Allow admin to click others to toggle hide
            if (isAdmin && !isMe) {
                item.onclick = () => {
                    if (confirm(`Do you want to ${isHidden ? 'unhide' : 'hide'} this user from group activity?`)) {
                        toggleHideMember(p.id, isHidden);
                    }
                };
            }
            
            container.appendChild(item);
        });
        
    } else {
        document.getElementById('chatInfoHeaderText').textContent = 'Contact info';
        
        const other = activeConversation.participants.find(p => p.id !== currentUser.id) || {};
        const isOnline = onlineUsers.has(other.id);
        
        // Show online/offline with status dot
        const statusDot = document.getElementById('chatInfoStatusDot');
        statusDot.style.display = 'inline-block';
        statusDot.className = `info-status-dot ${isOnline ? 'online' : 'offline'}`;
        document.getElementById('chatInfoStatusText').textContent = isOnline ? 'Online' : 'Offline';
        
        // Show phone number
        const phoneEl = document.getElementById('chatInfoPhoneNumber');
        if (other.phone_number) {
            phoneEl.textContent = other.phone_number;
            phoneEl.style.display = 'block';
        } else {
            phoneEl.style.display = 'none';
        }
        
        document.getElementById('groupActionBtns').style.display = 'none';
        document.getElementById('groupCreatedByArea').style.display = 'none';
        
        document.getElementById('contactAboutArea').style.display = 'block';
        document.getElementById('contactInfoAboutText').textContent = other.about || 'Available';
        
        document.getElementById('groupParticipantsSection').style.display = 'none';
        
        document.getElementById('viewMemberChangesBtn').style.display = 'none';
        document.getElementById('exitGroupBtn').style.display = 'none';
        document.getElementById('reportText').textContent = 'Report contact';

        // Load contact's active note
        loadContactNote(other);
        
        // Fetch full contact profile for more info (including avatar)
        fetchContactProfile(other.id);
    }
}

async function fetchContactProfile(userId) {
    if (!userId) return;
    try {
        const res = await apiFetch(`/api/chat/contact/${userId}/`);
        if (res && res.ok) {
            const data = await res.json();
            
            // Update avatar with full-res profile photo
            const avatarEl = document.getElementById('chatInfoAvatar');
            const overlayEl = document.getElementById('chatInfoAvatarOverlay');
            
            if (data.avatar) {
                avatarEl.innerHTML = `<img src="${data.avatar}" alt="">`;
                overlayEl.style.display = 'flex';
                avatarEl.style.cursor = 'pointer';
                avatarEl.onclick = () => {
                    openPhotoViewer(data.avatar, data.username);
                };
            }
            
            // Update phone
            if (data.phone_number) {
                const phoneEl = document.getElementById('chatInfoPhoneNumber');
                phoneEl.textContent = data.phone_number;
                phoneEl.style.display = 'block';
            }
            
            // Update about
            if (data.about) {
                document.getElementById('contactInfoAboutText').textContent = data.about;
            }
            
            // Update name with full info
            const fullName = `${data.first_name || ''} ${data.last_name || ''}`.trim() || data.username;
            document.getElementById('chatInfoName').textContent = fullName;
            
            // Update online status
            const statusDot = document.getElementById('chatInfoStatusDot');
            statusDot.className = `info-status-dot ${data.is_online ? 'online' : 'offline'}`;
            document.getElementById('chatInfoStatusText').textContent = data.is_online ? 'Online' : 'Offline';
        }
    } catch (e) { console.error('Fetch contact profile error:', e); }
}

function closeChatInfo() {
    document.getElementById('chatInfoSidebar').classList.remove('active');
    // Also close sub-panels
    document.getElementById('starredMessagesPanel').style.display = 'none';
    document.getElementById('mediaPanel').style.display = 'none';
    document.getElementById('notificationSettingsPanel').style.display = 'none';
    document.getElementById('photoViewer').style.display = 'none';
}

async function loadContactNote(otherUser) {
    const noteArea = document.getElementById('contactNoteArea');
    noteArea.style.display = 'none';
    
    if (!otherUser || !otherUser.id) return;
    
    try {
        const res = await apiFetch(`/api/accounts/user/${otherUser.id}/`);
        if (!res || !res.ok) return;
        const data = await res.json();
        
        const note = data.active_note;
        if (note && note.content) {
            document.getElementById('contactNoteEmoji').textContent = note.emoji || '📝';
            document.getElementById('contactNoteText').textContent = note.content;
            
            // Compute time left label
            const secs = note.time_left_seconds;
            const hrs = Math.floor(secs / 3600);
            const mins = Math.floor((secs % 3600) / 60);
            let label = '';
            if (hrs > 0) label = `Expires in ${hrs}h ${mins}m`;
            else if (mins > 0) label = `Expires in ${mins}m`;
            else label = 'Expires soon';
            document.getElementById('contactNoteExpiry').textContent = label;
            
            noteArea.style.display = 'block';
        }
    } catch (e) { console.error('Failed to load contact note', e); }
}

async function toggleHideMember(userId, currentlyHidden) {
    if (!activeConversation) return;
    
    const action = currentlyHidden ? 'unhide_member' : 'hide_member';
    
    try {
        const res = await apiFetch(`/api/chat/groups/${activeConversation.id}/`, {
            method: 'PUT',
            headers: authHeaders(),
            body: JSON.stringify({ action: action, user_id: userId })
        });
        
        if (res.ok) {
            // Update local state temporarily, then refresh conversations
            if (currentlyHidden) {
                activeConversation.hidden_participants = activeConversation.hidden_participants.filter(id => id !== userId);
            } else {
                activeConversation.hidden_participants.push(userId);
            }
            openChatInfo(); // re-render
            loadConversations(); // update background state
        } else {
            const err = await res.json();
            alert(err.error || 'Failed to update member status');
        }
    } catch (e) {
        console.error('Error toggling hide member:', e);
    }
}

// ===== NOTE MANAGEMENT =====
let selectedNoteEmoji = '📝';
let myNoteExpiryInterval = null;

async function loadMyNote() {
    try {
        const res = await apiFetch('/api/accounts/note/');
        if (!res || !res.ok) return;
        const data = await res.json();
        
        if (data.note) {
            const note = data.note;
            selectedNoteEmoji = note.emoji || '📝';
            document.getElementById('noteEmojiBtn').textContent = selectedNoteEmoji;
            document.getElementById('myNoteInput').value = note.content;
            updateNoteCharCount(note.content.length);
            document.getElementById('noteClearBtn').style.display = 'inline-flex';
            
            // Start countdown
            startNoteExpiryCountdown(note.time_left_seconds);
        } else {
            // No active note
            selectedNoteEmoji = '📝';
            document.getElementById('noteEmojiBtn').textContent = '📝';
            document.getElementById('myNoteInput').value = '';
            updateNoteCharCount(0);
            document.getElementById('noteClearBtn').style.display = 'none';
            document.getElementById('myNoteExpiry').textContent = '';
        }
    } catch(e) { console.error('Failed to load note', e); }
}

function startNoteExpiryCountdown(seconds) {
    if (myNoteExpiryInterval) clearInterval(myNoteExpiryInterval);
    
    let remaining = seconds;
    function updateLabel() {
        if (remaining <= 0) {
            clearInterval(myNoteExpiryInterval);
            document.getElementById('myNoteExpiry').textContent = 'Expired';
            document.getElementById('noteClearBtn').style.display = 'none';
            document.getElementById('myNoteInput').value = '';
            updateNoteCharCount(0);
            return;
        }
        const hrs = Math.floor(remaining / 3600);
        const mins = Math.floor((remaining % 3600) / 60);
        const secs = remaining % 60;
        if (hrs > 0) {
            document.getElementById('myNoteExpiry').textContent = `Expires in ${hrs}h ${mins}m`;
        } else if (mins > 0) {
            document.getElementById('myNoteExpiry').textContent = `Expires in ${mins}m ${secs}s`;
        } else {
            document.getElementById('myNoteExpiry').textContent = `Expires in ${secs}s`;
        }
        remaining--;
    }
    updateLabel();
    myNoteExpiryInterval = setInterval(updateLabel, 1000);
}

function updateNoteCharCount(len) {
    const el = document.getElementById('myNoteCharCount');
    el.textContent = `${len} / 280`;
    el.style.color = len > 250 ? '#f15c6d' : 'var(--wa-text-secondary)';
}

document.addEventListener('DOMContentLoaded', () => {
    const textarea = document.getElementById('myNoteInput');
    if (textarea) {
        textarea.addEventListener('input', () => updateNoteCharCount(textarea.value.length));
    }
});

async function saveMyNote() {
    const content = document.getElementById('myNoteInput').value.trim();
    if (!content) {
        document.getElementById('myNoteInput').focus();
        return;
    }
    
    try {
        const res = await apiFetch('/api/accounts/note/', {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({ content, emoji: selectedNoteEmoji })
        });
        if (!res || !res.ok) {
            const err = await res.json();
            alert(err.error || 'Failed to save note');
            return;
        }
        const data = await res.json();
        const note = data.note;
        document.getElementById('noteClearBtn').style.display = 'inline-flex';
        startNoteExpiryCountdown(note.time_left_seconds);
        
        // Visual feedback
        const btn = document.querySelector('.note-save-btn');
        const orig = btn.textContent;
        btn.textContent = '✓ Posted!';
        btn.style.background = '#009975';
        setTimeout(() => { btn.textContent = orig; btn.style.background = ''; }, 2000);
    } catch(e) { console.error('Save note error', e); }
}

async function clearMyNote() {
    if (!confirm('Delete your note?')) return;
    try {
        await apiFetch('/api/accounts/note/', { method: 'DELETE' });
        if (myNoteExpiryInterval) clearInterval(myNoteExpiryInterval);
        document.getElementById('myNoteInput').value = '';
        document.getElementById('myNoteExpiry').textContent = '';
        document.getElementById('noteClearBtn').style.display = 'none';
        selectedNoteEmoji = '📝';
        document.getElementById('noteEmojiBtn').textContent = '📝';
        updateNoteCharCount(0);
    } catch(e) { console.error('Clear note error', e); }
}

function toggleNoteEmojiPicker() {
    const picker = document.getElementById('noteEmojiPicker');
    picker.style.display = picker.style.display === 'none' ? 'flex' : 'none';
}

function pickNoteEmoji(emoji) {
    selectedNoteEmoji = emoji;
    document.getElementById('noteEmojiBtn').textContent = emoji;
    document.getElementById('noteEmojiPicker').style.display = 'none';
}

// Close note emoji picker when clicking outside
document.addEventListener('click', (e) => {
    if (!e.target.closest('#noteEmojiBtn') && !e.target.closest('#noteEmojiPicker')) {
        const picker = document.getElementById('noteEmojiPicker');
        if (picker) picker.style.display = 'none';
    }
});

// ===== STARRED MESSAGES =====
async function starFromContextMenu() {
    if (!contextMenuTarget || !contextMenuTarget.id) return;
    document.getElementById('msgContextMenu').style.display = 'none';
    
    try {
        const res = await apiFetch(`/api/chat/messages/${contextMenuTarget.id}/star/`, {
            method: 'POST',
            headers: authHeaders(),
        });
        if (res && res.ok) {
            const data = await res.json();
            // Show brief notification
            showToast(data.starred ? '⭐ Message starred' : '☆ Message unstarred');
        }
    } catch (e) { console.error('Star message error:', e); }
    contextMenuTarget = null;
}

async function openStarredMessages() {
    if (!activeConversationId) return;
    
    document.getElementById('starredMessagesPanel').style.display = 'flex';
    const list = document.getElementById('starredMessagesList');
    list.innerHTML = '<div style="text-align:center;padding:30px;color:var(--wa-text-secondary);">Loading...</div>';
    
    try {
        const res = await apiFetch(`/api/chat/messages/${activeConversationId}/starred/`);
        if (res && res.ok) {
            const starred = await res.json();
            
            if (starred.length === 0) {
                list.innerHTML = `
                    <div class="subpanel-empty">
                        <span style="font-size: 48px; opacity: 0.5;">⭐</span>
                        <p>No starred messages</p>
                        <p style="font-size:13px;">Tap and hold on any message to star it.</p>
                    </div>`;
                return;
            }
            
            list.innerHTML = '';
            starred.forEach(msg => {
                const item = document.createElement('div');
                item.className = 'starred-msg-item';
                
                const isFile = msg.message_type !== 'text';
                const content = isFile 
                    ? `${getFileIcon(msg.message_type)} ${msg.file_name || msg.message_type}`
                    : escapeHtml(msg.content || '');
                
                item.innerHTML = `
                    <div class="starred-msg-sender">${escapeHtml(msg.sender)}</div>
                    <div class="starred-msg-content">${content}</div>
                    <div class="starred-msg-time">
                        <span>${formatTime(msg.timestamp)}</span>
                        <button class="unstar-btn" title="Unstar" onclick="event.stopPropagation(); unstarMessage(${msg.id}, this)">⭐</button>
                    </div>
                `;
                list.appendChild(item);
            });
        }
    } catch (e) { console.error('Load starred error:', e); }
}

async function unstarMessage(messageId, btnEl) {
    try {
        const res = await apiFetch(`/api/chat/messages/${messageId}/star/`, {
            method: 'POST',
            headers: authHeaders(),
        });
        if (res && res.ok) {
            // Remove the item with animation
            const item = btnEl.closest('.starred-msg-item');
            item.style.opacity = '0';
            item.style.transform = 'translateX(50px)';
            item.style.transition = 'all 0.3s ease';
            setTimeout(() => {
                item.remove();
                // Check if list is now empty
                const remaining = document.querySelectorAll('.starred-msg-item');
                if (remaining.length === 0) {
                    document.getElementById('starredMessagesList').innerHTML = `
                        <div class="subpanel-empty">
                            <span style="font-size: 48px; opacity: 0.5;">⭐</span>
                            <p>No starred messages</p>
                        </div>`;
                }
            }, 300);
        }
    } catch (e) { console.error('Unstar error:', e); }
}

function closeStarredMessages() {
    document.getElementById('starredMessagesPanel').style.display = 'none';
}

// ===== MEDIA PANEL =====
async function openMediaPanel(type) {
    if (!activeConversationId) return;
    
    document.getElementById('mediaPanel').style.display = 'flex';
    
    // Set active tab
    if (type) {
        document.querySelectorAll('.media-tab').forEach(tab => {
            tab.classList.toggle('active', tab.textContent.toLowerCase().includes(type === 'all' ? 'all' : type));
        });
    }
    
    await loadMedia(type || 'all');
}

async function loadMedia(type) {
    const list = document.getElementById('mediaList');
    list.innerHTML = '<div style="text-align:center;padding:30px;color:var(--wa-text-secondary);">Loading...</div>';
    
    try {
        const url = type === 'all' 
            ? `/api/chat/conversations/${activeConversationId}/media/`
            : `/api/chat/conversations/${activeConversationId}/media/?type=${type}`;
        
        const res = await apiFetch(url);
        if (res && res.ok) {
            const media = await res.json();
            
            if (media.length === 0) {
                list.innerHTML = `
                    <div class="subpanel-empty">
                        <span style="font-size: 48px; opacity: 0.5;">🖼️</span>
                        <p>No media found</p>
                    </div>`;
                return;
            }
            
            // Separate images/videos from files/audio
            const visual = media.filter(m => m.message_type === 'image' || m.message_type === 'video');
            const files = media.filter(m => m.message_type === 'file' || m.message_type === 'audio');
            
            list.innerHTML = '';
            
            if (visual.length > 0 && (type === 'all' || type === 'image' || type === 'video')) {
                const grid = document.createElement('div');
                grid.className = 'media-grid';
                
                visual.forEach(m => {
                    const item = document.createElement('div');
                    item.className = 'media-grid-item';
                    
                    if (m.message_type === 'image') {
                        item.innerHTML = `<img src="${m.file_url}" alt="" loading="lazy">`;
                    } else {
                        item.innerHTML = `
                            <div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:var(--wa-input-bg);font-size:32px;">🎬</div>
                            <span class="media-type-badge">▶</span>
                        `;
                    }
                    
                    item.onclick = () => {
                        if (m.message_type === 'image') {
                            openPhotoViewer(m.file_url, m.sender);
                        } else {
                            window.open(m.file_url, '_blank');
                        }
                    };
                    
                    grid.appendChild(item);
                });
                
                list.appendChild(grid);
            }
            
            if (files.length > 0 && (type === 'all' || type === 'file' || type === 'audio')) {
                files.forEach(m => {
                    const item = document.createElement('div');
                    item.className = 'media-file-item';
                    item.onclick = () => window.open(m.file_url, '_blank');
                    
                    item.innerHTML = `
                        <div class="media-file-icon">${getFileIcon(m.message_type)}</div>
                        <div class="media-file-info">
                            <div class="media-file-name">${escapeHtml(m.file_name || 'File')}</div>
                            <div class="media-file-meta">${formatFileSize(m.file_size)} · ${formatTime(m.timestamp)}</div>
                        </div>
                    `;
                    
                    list.appendChild(item);
                });
            }
        }
    } catch (e) { console.error('Load media error:', e); }
}

function switchMediaTab(type, btn) {
    document.querySelectorAll('.media-tab').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    loadMedia(type);
}

function closeMediaPanel() {
    document.getElementById('mediaPanel').style.display = 'none';
}

// ===== NOTIFICATION SETTINGS PANEL =====
function openNotificationSettings() {
    document.getElementById('notificationSettingsPanel').style.display = 'flex';
    
    const isMuted = activeConversation?.settings?.is_muted || false;
    document.getElementById('muteToggle').checked = isMuted;
    document.getElementById('muteStatusText').textContent = isMuted ? 'On' : 'Off';
}

async function toggleMuteFromSettings() {
    const newVal = document.getElementById('muteToggle').checked;
    
    try {
        const res = await apiFetch(`/api/chat/conversations/${activeConversationId}/settings/`, {
            method: 'PUT',
            headers: authHeaders(),
            body: JSON.stringify({ is_muted: newVal })
        });
        if (res && res.ok) {
            document.getElementById('muteStatusText').textContent = newVal ? 'On' : 'Off';
            document.getElementById('notifSettingsSub').textContent = newVal ? 'Muted' : 'On';
            
            // Update local state
            if (activeConversation.settings) {
                activeConversation.settings.is_muted = newVal;
            }
            
            showToast(newVal ? '🔕 Notifications muted' : '🔔 Notifications unmuted');
            loadConversations();
        }
    } catch (e) { console.error('Toggle mute error:', e); }
}

function closeNotificationSettings() {
    document.getElementById('notificationSettingsPanel').style.display = 'none';
}

// ===== ADVANCED PRIVACY TOGGLE =====
async function toggleAdvancedPrivacy() {
    if (!activeConversationId) return;
    
    const current = activeConversation?.settings?.advanced_privacy || false;
    const newVal = !current;
    
    try {
        const res = await apiFetch(`/api/chat/conversations/${activeConversationId}/settings/`, {
            method: 'PUT',
            headers: authHeaders(),
            body: JSON.stringify({ advanced_privacy: newVal })
        });
        if (res && res.ok) {
            document.getElementById('advancedPrivacySub').textContent = newVal ? 'On' : 'Off';
            if (activeConversation.settings) {
                activeConversation.settings.advanced_privacy = newVal;
            }
            showToast(newVal ? '🛡️ Advanced privacy enabled' : '🛡️ Advanced privacy disabled');
        }
    } catch (e) { console.error('Toggle privacy error:', e); }
}

// ===== FAVOURITES =====
async function toggleFavourite() {
    if (!activeConversationId) return;
    
    const current = activeConversation?.settings?.is_favourite || false;
    const newVal = !current;
    
    try {
        const res = await apiFetch(`/api/chat/conversations/${activeConversationId}/settings/`, {
            method: 'PUT',
            headers: authHeaders(),
            body: JSON.stringify({ is_favourite: newVal })
        });
        if (res && res.ok) {
            const icon = document.getElementById('favouriteIcon');
            const text = document.getElementById('favouriteText');
            
            if (newVal) {
                icon.textContent = '❤️';
                text.textContent = 'Remove from favourites';
                icon.classList.add('favourite-pulse');
                setTimeout(() => icon.classList.remove('favourite-pulse'), 500);
            } else {
                icon.textContent = '♡';
                text.textContent = 'Add to favourites';
            }
            
            if (activeConversation.settings) {
                activeConversation.settings.is_favourite = newVal;
            }
            
            showToast(newVal ? '❤️ Added to favourites' : '♡ Removed from favourites');
        }
    } catch (e) { console.error('Toggle favourite error:', e); }
}

// ===== ADD TO LIST =====
function showAddToList() {
    showToast('📁 Lists feature coming soon!');
}

// ===== CLEAR CHAT =====
async function clearChat() {
    if (!activeConversationId) return;
    
    const confirmMsg = activeConversation?.is_group 
        ? 'Clear all messages in this group? This action cannot be undone.'
        : 'Clear all messages in this chat? This action cannot be undone.';
    
    if (!confirm(confirmMsg)) return;
    
    try {
        const res = await apiFetch(`/api/chat/conversations/${activeConversationId}/clear/`, {
            method: 'POST',
            headers: authHeaders(),
        });
        if (res && res.ok) {
            // Clear the messages area
            document.getElementById('messagesArea').innerHTML = '';
            showToast('🗑️ Chat cleared');
            closeChatInfo();
        }
    } catch (e) { console.error('Clear chat error:', e); }
}

// ===== EXIT GROUP =====
async function exitGroup() {
    if (!activeConversation || !activeConversation.is_group) return;
    
    if (!confirm('Are you sure you want to exit this group?')) return;
    
    try {
        const res = await apiFetch(`/api/chat/groups/${activeConversationId}/manage/`, {
            method: 'PUT',
            headers: authHeaders(),
            body: JSON.stringify({ action: 'remove_member', user_id: currentUser.id })
        });
        if (res && res.ok) {
            showToast('👋 You left the group');
            closeChatInfo();
            document.getElementById('emptyChat').style.display = 'flex';
            document.getElementById('activeChatView').style.display = 'none';
            activeConversation = null;
            activeConversationId = null;
            await loadConversations();
        }
    } catch (e) { console.error('Exit group error:', e); }
}

// ===== REPORT CONTACT =====
async function reportContact() {
    if (!activeConversationId) return;
    
    const targetName = activeConversation?.is_group 
        ? activeConversation.group_name 
        : activeConversation.display_name;
    
    if (!confirm(`Report ${targetName}? This will be reviewed by the SwiftConnect team.`)) return;
    
    try {
        const res = await apiFetch(`/api/chat/conversations/${activeConversationId}/settings/`, {
            method: 'PUT',
            headers: authHeaders(),
            body: JSON.stringify({ is_reported: true })
        });
        if (res && res.ok) {
            showToast('👎 Report submitted. Thank you.');
        }
    } catch (e) { console.error('Report error:', e); }
}

// ===== PROFILE PHOTO VIEWER =====
function openPhotoViewer(imgSrc, title) {
    const viewer = document.getElementById('photoViewer');
    document.getElementById('photoViewerImg').src = imgSrc;
    document.getElementById('photoViewerTitle').textContent = title || 'Profile photo';
    viewer.style.display = 'flex';
}

function closePhotoViewer() {
    document.getElementById('photoViewer').style.display = 'none';
}

async function handleContactPhotoView(event) {
    const file = event.target.files[0];
    if (!file) return;

    if (activeConversation && activeConversation.is_group) {
        if (activeConversation.created_by !== currentUser.id) {
            showToast('Only group admins can change the group photo.');
            return;
        }

        const formData = new FormData();
        formData.append('action', 'update_icon');
        formData.append('group_icon', file);

        try {
            const res = await apiFetch(`/api/chat/groups/${activeConversationId}/manage/`, {
                method: 'PUT',
                body: formData
            });

            if (res && res.ok) {
                const data = await res.json();
                document.getElementById('chatInfoAvatar').innerHTML = `<img src="${data.group_icon_url}" alt="">`;
                activeConversation.display_avatar = data.group_icon_url;
                
                // Update conversation list item
                const convEl = document.querySelector(`.conv-item[data-id="${activeConversationId}"] .conv-avatar`);
                if (convEl) convEl.innerHTML = `<img src="${data.group_icon_url}">`;
                
                showToast('📷 Group photo updated');
            } else {
                showToast('Failed to update group photo');
            }
        } catch (e) {
            console.error('Group photo update error:', e);
            showToast('Error updating photo');
        }
    } else {
        // Individual contact: just preview the photo
        const reader = new FileReader();
        reader.onload = (e) => {
            openPhotoViewer(e.target.result, document.getElementById('chatInfoName').textContent);
        };
        reader.readAsDataURL(file);
    }
    
    // Reset input
    event.target.value = '';
}

// ===== TOAST NOTIFICATION =====
function showToast(message) {
    // Remove existing toast
    const existing = document.querySelector('.swift-toast');
    if (existing) existing.remove();
    
    const toast = document.createElement('div');
    toast.className = 'swift-toast';
    toast.textContent = message;
    toast.style.cssText = `
        position: fixed;
        bottom: 40px;
        left: 50%;
        transform: translateX(-50%) translateY(20px);
        background: var(--wa-panel-header);
        color: var(--wa-text);
        padding: 12px 24px;
        border-radius: 12px;
        font-size: 14px;
        font-weight: 500;
        box-shadow: 0 4px 20px rgba(0,0,0,0.4);
        border: 1px solid var(--wa-border);
        z-index: 5000;
        animation: toastIn 0.3s ease forwards;
        pointer-events: none;
    `;
    document.body.appendChild(toast);
    
    setTimeout(() => {
        toast.style.animation = 'toastOut 0.3s ease forwards';
        setTimeout(() => toast.remove(), 300);
    }, 2500);
}

// Add toast animations
if (!document.getElementById('toastAnimStyles')) {
    const style = document.createElement('style');
    style.id = 'toastAnimStyles';
    style.textContent = `
        @keyframes toastIn {
            from { opacity: 0; transform: translateX(-50%) translateY(20px); }
            to { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
        @keyframes toastOut {
            from { opacity: 1; transform: translateX(-50%) translateY(0); }
            to { opacity: 0; transform: translateX(-50%) translateY(20px); }
        }
    `;
    document.head.appendChild(style);
}

// ===== STUDY MODE =====
async function toggleStudyMode() {
    if (!currentUser) return;
    
    const currentVal = currentUser.study_mode_active === true || String(currentUser.study_mode_active).toLowerCase() === 'true';
    const newVal = !currentVal;
    
    if (newVal) {
        const confirmMsg = "Are you sure you want to activate Study Mode?\n\nThis will lock and hide all your chats to help you focus. Only chats you've explicitly allowed (and SwiftConnect AI) will remain visible.";
        if (!confirm(confirmMsg)) {
            return;
        }
    }
    
    try {
        const res = await apiFetch(`/api/accounts/profile/`, {
            method: 'PUT',
            headers: authHeaders(),
            body: JSON.stringify({ study_mode_active: newVal })
        });
        if (res && res.ok) {
            currentUser.study_mode_active = newVal;
            showToast(newVal ? '📚 Study Mode Enabled' : '📚 Study Mode Disabled');
            renderConversations();
        }
    } catch (e) {
        console.error('Study mode error:', e);
    }
}

async function toggleStudyAllowed() {
    if (!activeConversationId) return;
    
    const current = activeConversation?.settings?.is_study_allowed || false;
    const newVal = !current;
    
    try {
        const res = await apiFetch(`/api/chat/conversations/${activeConversationId}/settings/`, {
            method: 'PUT',
            headers: authHeaders(),
            body: JSON.stringify({ is_study_allowed: newVal })
        });
        if (res && res.ok) {
            document.getElementById('studyAllowedSub').textContent = newVal ? 'On' : 'Off';
            if (!activeConversation.settings) {
                activeConversation.settings = {};
            }
            activeConversation.settings.is_study_allowed = newVal;
            showToast(newVal ? '📚 Chat allowed in Study Mode' : 'Chat hidden in Study Mode');
            renderConversations(); // update list in background
        }
    } catch (e) { console.error('Toggle study allowed error:', e); }
}
