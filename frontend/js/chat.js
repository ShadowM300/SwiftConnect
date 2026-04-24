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

    const filteredConversations = conversations.filter(conv => {
        const isArchived = conv.settings?.is_archived;
        const isLocked = conv.settings?.is_locked;
        
        if (currentSidebarView === 'archived') return isArchived;
        if (currentSidebarView === 'locked') return isLocked;
        return !isArchived && !isLocked;
    });

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
        } else if ((msg.message_type === 'file' || msg.message_type === 'audio') && msg.file_url) {
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
        bubble.ondblclick = () => setReply(msg);
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
