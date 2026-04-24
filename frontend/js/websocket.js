// ===== SwiftConnect WebSocket Manager =====

let chatSocket = null;
let presenceSocket = null;
let callSocket = null;
let onlineUsers = new Set();

function getWsBase() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}`;
}

// ===== PRESENCE WEBSOCKET =====
function connectPresence() {
    const token = getToken();
    if (!token) return;
    presenceSocket = new WebSocket(`${getWsBase()}/ws/presence/?token=${token}`);

    presenceSocket.onopen = () => console.log('[Presence] Connected');

    presenceSocket.onmessage = (e) => {
        const data = JSON.parse(e.data);
        if (data.type === 'online_users') {
            onlineUsers = new Set(data.users);
            updateOnlineIndicators();
        } else if (data.type === 'presence_update') {
            if (data.is_online) {
                onlineUsers.add(data.user_id);
            } else {
                onlineUsers.delete(data.user_id);
            }
            updateOnlineIndicators();
            updateChatHeaderStatus();
        }
    };

    presenceSocket.onclose = () => {
        console.log('[Presence] Disconnected, reconnecting...');
        setTimeout(connectPresence, 3000);
    };
}

function updateOnlineIndicators() {
    document.querySelectorAll('.conv-item').forEach(item => {
        const userId = item.dataset.otherUserId;
        const dot = item.querySelector('.online-dot');
        if (dot) {
            dot.style.display = userId && onlineUsers.has(parseInt(userId)) ? 'block' : 'none';
        }
    });
}

// ===== CHAT WEBSOCKET =====
function connectChat(conversationId) {
    if (chatSocket) chatSocket.close();
    const token = getToken();
    chatSocket = new WebSocket(`${getWsBase()}/ws/chat/${conversationId}/?token=${token}`);

    chatSocket.onopen = () => console.log('[Chat] Connected to', conversationId);

    chatSocket.onmessage = (e) => {
        const data = JSON.parse(e.data);
        if (data.type === 'message') {
            handleIncomingMessage(data.message);
        } else if (data.type === 'typing') {
            handleTypingIndicator(data);
        } else if (data.type === 'status_update') {
            handleStatusUpdate(data);
        }
    };

    chatSocket.onclose = () => console.log('[Chat] Disconnected');
}

function sendWsMessage(content, replyTo = null) {
    if (chatSocket && chatSocket.readyState === WebSocket.OPEN) {
        chatSocket.send(JSON.stringify({
            type: 'message',
            content: content,
            reply_to: replyTo,
        }));
    }
}

let typingTimeout = null;
function sendTyping() {
    if (chatSocket && chatSocket.readyState === WebSocket.OPEN) {
        chatSocket.send(JSON.stringify({ type: 'typing', is_typing: true }));
        clearTimeout(typingTimeout);
        typingTimeout = setTimeout(() => {
            if (chatSocket && chatSocket.readyState === WebSocket.OPEN) {
                chatSocket.send(JSON.stringify({ type: 'typing', is_typing: false }));
            }
        }, 2000);
    }
}

function sendSeenStatus(messageId) {
    if (chatSocket && chatSocket.readyState === WebSocket.OPEN) {
        chatSocket.send(JSON.stringify({ type: 'seen', message_id: messageId }));
    }
}

// ===== CALL WEBSOCKET =====
function connectCallSocket() {
    const token = getToken();
    if (!token) return;
    callSocket = new WebSocket(`${getWsBase()}/ws/calls/?token=${token}`);

    callSocket.onopen = () => console.log('[Call] Connected');

    callSocket.onmessage = (e) => {
        const data = JSON.parse(e.data);
        handleCallSignal(data);
    };

    callSocket.onclose = () => {
        console.log('[Call] Disconnected, reconnecting...');
        setTimeout(connectCallSocket, 3000);
    };
}
