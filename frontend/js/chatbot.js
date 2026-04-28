// ===== SwiftConnect AI Chatbot =====
// Meta AI-style chatbot integrated into the messaging interface

let botChatOpen = false;
let botMessages = [];
let botIsTyping = false;

// ===== INITIALIZE BOT =====
function initBot() {
    // Inject the bot entry into the conversation list
    injectBotEntry();
}

// ===== INJECT BOT INTO SIDEBAR =====
function injectBotEntry() {
    const list = document.getElementById('conversationList');
    if (!list) return;

    // Remove existing bot entry if present
    const existing = document.getElementById('botConvItem');
    if (existing) existing.remove();

    const botItem = document.createElement('div');
    botItem.className = 'conv-item bot-conv-item';
    botItem.id = 'botConvItem';
    botItem.onclick = () => openBotChat();
    botItem.innerHTML = `
        <div class="conv-avatar bot-avatar">
            <div class="bot-avatar-inner">
                <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M12 2a4 4 0 0 1 4 4v1h1a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3v-6a3 3 0 0 1 3-3h1V6a4 4 0 0 1 4-4z"/>
                    <circle cx="9" cy="13" r="1.2" fill="currentColor"/>
                    <circle cx="15" cy="13" r="1.2" fill="currentColor"/>
                    <path d="M9 17c1 1 5 1 6 0"/>
                    <line x1="12" y1="2" x2="12" y2="0"/>
                    <circle cx="12" cy="0" r="0" fill="currentColor">
                        <animate attributeName="r" values="0;1.5;0" dur="2s" repeatCount="indefinite"/>
                    </circle>
                </svg>
            </div>
        </div>
        <div class="conv-info">
            <div class="conv-info-top">
                <span class="conv-name bot-name">SwiftConnect AI</span>
                <span class="conv-time" style="color: var(--wa-green);">✦ AI</span>
            </div>
            <div class="conv-preview" style="color: var(--wa-text-secondary);">
                <span>Ask me anything — I'm here to help! ✨</span>
            </div>
        </div>
    `;

    // Insert at the very top of the conversation list
    if (list.firstChild) {
        list.insertBefore(botItem, list.firstChild);
    } else {
        list.appendChild(botItem);
    }
}

// ===== OPEN BOT CHAT =====
async function openBotChat() {
    botChatOpen = true;
    activeConversationId = null;
    activeConversation = null;

    // Close any existing chat websocket
    if (chatSocket) chatSocket.close();

    document.getElementById('emptyChat').style.display = 'none';
    document.getElementById('activeChatView').style.display = 'flex';

    // Mobile responsive
    document.getElementById('sidebar').classList.add('hidden');
    document.getElementById('chatPanel').classList.add('active');

    // Set bot header
    document.getElementById('chatName').textContent = 'SwiftConnect AI';
    document.getElementById('chatAvatar').innerHTML = `
        <div class="bot-avatar-inner" style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 2a4 4 0 0 1 4 4v1h1a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3v-6a3 3 0 0 1 3-3h1V6a4 4 0 0 1 4-4z"/>
                <circle cx="9" cy="13" r="1.2" fill="currentColor"/>
                <circle cx="15" cy="13" r="1.2" fill="currentColor"/>
                <path d="M9 17c1 1 5 1 6 0"/>
            </svg>
        </div>
    `;
    document.getElementById('chatAvatar').style.background = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';

    // Set status
    const statusEl = document.getElementById('chatStatus');
    statusEl.textContent = 'AI Assistant • Always online';
    statusEl.className = 'status online';

    // Hide call buttons, show clear button for bot
    const headerActions = document.querySelector('.chat-header-actions');
    headerActions.innerHTML = `
        <button class="icon-btn" onclick="confirmClearBot()" title="Clear Chat" id="botClearBtn">🗑️</button>
        <button class="icon-btn" onclick="closeBotChat()" title="Close" id="botCloseBtn" style="display:none;">✕</button>
    `;

    // Hide blocked area, show input
    document.getElementById('messageInputArea').style.display = 'flex';
    document.getElementById('blockedMessageArea').style.display = 'none';

    // Load bot history
    await loadBotHistory();

    // Highlight bot entry in sidebar
    document.querySelectorAll('.conv-item').forEach(item => item.classList.remove('active'));
    const botItem = document.getElementById('botConvItem');
    if (botItem) botItem.classList.add('active');
}

// ===== CLOSE BOT CHAT =====
function closeBotChat() {
    botChatOpen = false;
    document.getElementById('emptyChat').style.display = 'flex';
    document.getElementById('activeChatView').style.display = 'none';
    
    // Restore original header actions
    restoreChatHeaderActions();
    
    // Remove active from bot
    const botItem = document.getElementById('botConvItem');
    if (botItem) botItem.classList.remove('active');
}

function restoreChatHeaderActions() {
    const headerActions = document.querySelector('.chat-header-actions');
    headerActions.innerHTML = `
        <button class="icon-btn" onclick="startCall('voice')" title="Voice Call">📞</button>
        <button class="icon-btn" onclick="startCall('video')" title="Video Call">📹</button>
        <button class="icon-btn" onclick="toggleChatSettingsMenu()" title="Settings">⋮</button>
        <div class="dropdown-menu" id="chatSettingsMenu" style="display:none; position:absolute; right:0; top:40px; background:var(--wa-bg-panel); border-radius:8px; box-shadow:0 2px 10px rgba(0,0,0,0.3); z-index:100; min-width:150px; overflow:hidden;">
            <div class="dropdown-item" onclick="toggleSetting('is_muted')" id="menuMute">Mute</div>
            <div class="dropdown-item" onclick="toggleSetting('is_archived')" id="menuArchive">Archive</div>
            <div class="dropdown-item" onclick="toggleSetting('is_locked')" id="menuLock">Lock Chat</div>
            <div class="dropdown-item" onclick="toggleSetting('is_blocked')" id="menuBlock" style="color:#ff4a4a;">Block</div>
        </div>
    `;
}

// ===== LOAD BOT HISTORY =====
async function loadBotHistory() {
    try {
        const res = await apiFetch('/api/bot/history/');
        if (!res || !res.ok) return;
        const data = await res.json();
        botMessages = data.messages || [];
        renderBotMessages();
        scrollToBottom();
    } catch (e) {
        console.error('Load bot history error:', e);
    }
}

// ===== RENDER BOT MESSAGES =====
function renderBotMessages() {
    const area = document.getElementById('messagesArea');
    area.innerHTML = '';

    if (botMessages.length === 0) {
        area.innerHTML = `
            <div class="bot-welcome">
                <div class="bot-welcome-icon">
                    <svg viewBox="0 0 24 24" width="64" height="64" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" style="color: var(--wa-green);">
                        <path d="M12 2a4 4 0 0 1 4 4v1h1a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3v-6a3 3 0 0 1 3-3h1V6a4 4 0 0 1 4-4z"/>
                        <circle cx="9" cy="13" r="1.2" fill="currentColor"/>
                        <circle cx="15" cy="13" r="1.2" fill="currentColor"/>
                        <path d="M9 17c1 1 5 1 6 0"/>
                    </svg>
                </div>
                <h2 class="bot-welcome-title">SwiftConnect AI</h2>
                <p class="bot-welcome-text">Your personal AI assistant, right here in your chats.</p>
                <div class="bot-suggestions">
                    <button class="bot-suggestion-chip" onclick="sendBotSuggestion('Explain quantum computing in simple terms')">
                        💡 Explain quantum computing
                    </button>
                    <button class="bot-suggestion-chip" onclick="sendBotSuggestion('Write a Python function to sort a list')">
                        💻 Write a Python function
                    </button>
                    <button class="bot-suggestion-chip" onclick="sendBotSuggestion('Give me 5 tips for productivity')">
                        🚀 Productivity tips
                    </button>
                    <button class="bot-suggestion-chip" onclick="sendBotSuggestion('Tell me an interesting fact about space')">
                        🌌 Space fact
                    </button>
                </div>
            </div>
        `;
        return;
    }

    let lastDate = '';
    botMessages.forEach(msg => {
        const msgDate = formatDateDivider(msg.timestamp);
        if (msgDate !== lastDate) {
            lastDate = msgDate;
            area.innerHTML += `<div class="message-date-divider"><span>${msgDate}</span></div>`;
        }

        const isUser = msg.role === 'user';
        const bubbleClass = isUser ? 'sent' : 'received bot-message';

        let content = '';

        if (isUser) {
            content += `<div class="message-text">${escapeHtml(msg.content)}</div>`;
        } else {
            // Render bot response with markdown support
            content += `<div class="bot-message-header">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="var(--wa-green)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M12 2a4 4 0 0 1 4 4v1h1a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3v-6a3 3 0 0 1 3-3h1V6a4 4 0 0 1 4-4z"/>
                </svg>
                <span style="font-size:12px;font-weight:600;color:var(--wa-green);margin-left:4px;">SwiftConnect AI</span>
            </div>`;
            content += `<div class="message-text bot-text-content">${renderBotMarkdown(msg.content)}</div>`;
        }

        content += `<div class="message-meta">
            <span class="message-time">${formatTime(msg.timestamp)}</span>
            ${isUser ? '<span class="message-ticks seen">✓✓</span>' : ''}
        </div>`;

        const bubble = document.createElement('div');
        bubble.className = `message-bubble ${bubbleClass}`;
        bubble.innerHTML = content;
        area.appendChild(bubble);
    });
}

// ===== MARKDOWN RENDERER (simplified) =====
function renderBotMarkdown(text) {
    if (!text) return '';

    // Escape HTML first
    let html = escapeHtml(text);

    // Code blocks (```)
    html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (match, lang, code) => {
        return `<div class="bot-code-block">
            <div class="bot-code-header">
                <span>${lang || 'code'}</span>
                <button class="bot-copy-btn" onclick="copyBotCode(this)">📋 Copy</button>
            </div>
            <pre><code>${code.trim()}</code></pre>
        </div>`;
    });

    // Inline code
    html = html.replace(/`([^`]+)`/g, '<code class="bot-inline-code">$1</code>');

    // Bold
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

    // Italic
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');

    // Bullet lists
    html = html.replace(/^[•\-\*] (.+)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul class="bot-list">$&</ul>');

    // Numbered lists
    html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');

    // Line breaks
    html = html.replace(/\n/g, '<br>');

    return html;
}

// ===== COPY CODE =====
function copyBotCode(btn) {
    const codeBlock = btn.closest('.bot-code-block').querySelector('code');
    const text = codeBlock.textContent;
    navigator.clipboard.writeText(text).then(() => {
        btn.textContent = '✅ Copied!';
        setTimeout(() => { btn.textContent = '📋 Copy'; }, 2000);
    });
}

// ===== SEND BOT MESSAGE =====
async function sendBotMessage(content) {
    if (!content || botIsTyping) return;

    // Add user message to UI immediately
    const userMsg = {
        role: 'user',
        content: content,
        timestamp: new Date().toISOString(),
    };
    botMessages.push(userMsg);
    renderBotMessages();
    scrollToBottom();

    // Show typing indicator
    showBotTyping();

    try {
        const res = await apiFetch('/api/bot/chat/', {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({ message: content }),
        });

        hideBotTyping();

        if (res && res.ok) {
            const data = await res.json();
            const botMsg = {
                role: 'assistant',
                content: data.reply,
                timestamp: data.timestamp || new Date().toISOString(),
            };
            botMessages.push(botMsg);
            renderBotMessages();
            scrollToBottom();
        } else {
            const errorData = await res.json().catch(() => ({}));
            const errorMsg = {
                role: 'assistant',
                content: errorData.error || 'Sorry, I encountered an error. Please try again. 🔄',
                timestamp: new Date().toISOString(),
            };
            botMessages.push(errorMsg);
            renderBotMessages();
            scrollToBottom();
        }
    } catch (e) {
        hideBotTyping();
        console.error('Bot send error:', e);
        const errorMsg = {
            role: 'assistant',
            content: 'Connection error. Please check your network and try again. 🔄',
            timestamp: new Date().toISOString(),
        };
        botMessages.push(errorMsg);
        renderBotMessages();
        scrollToBottom();
    }
}

// ===== BOT TYPING INDICATOR =====
function showBotTyping() {
    botIsTyping = true;
    const area = document.getElementById('messagesArea');
    const typingDiv = document.createElement('div');
    typingDiv.className = 'message-bubble received bot-message bot-typing-bubble';
    typingDiv.id = 'botTypingBubble';
    typingDiv.innerHTML = `
        <div class="bot-message-header">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="var(--wa-green)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 2a4 4 0 0 1 4 4v1h1a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3v-6a3 3 0 0 1 3-3h1V6a4 4 0 0 1 4-4z"/>
            </svg>
            <span style="font-size:12px;font-weight:600;color:var(--wa-green);margin-left:4px;">SwiftConnect AI</span>
        </div>
        <div class="bot-typing-dots">
            <span class="bot-dot"></span>
            <span class="bot-dot"></span>
            <span class="bot-dot"></span>
        </div>
    `;
    area.appendChild(typingDiv);
    scrollToBottom();
}

function hideBotTyping() {
    botIsTyping = false;
    const bubble = document.getElementById('botTypingBubble');
    if (bubble) bubble.remove();
}

// ===== SUGGESTION CHIPS =====
function sendBotSuggestion(text) {
    document.getElementById('messageInput').value = text;
    sendBotMessage(text);
    document.getElementById('messageInput').value = '';
}

// ===== CLEAR BOT CHAT =====
function confirmClearBot() {
    if (!confirm('Clear all chat with SwiftConnect AI?')) return;
    clearBotChat();
}

async function clearBotChat() {
    try {
        await apiFetch('/api/bot/clear/', {
            method: 'DELETE',
            headers: authHeaders(),
        });
        botMessages = [];
        renderBotMessages();
    } catch (e) {
        console.error('Clear bot chat error:', e);
    }
}

// ===== OVERRIDE SEND MESSAGE FOR BOT MODE =====
// We need to intercept the send button when bot chat is open
const originalSendMessage = typeof sendMessage === 'function' ? sendMessage : null;

function patchedSendMessage() {
    if (botChatOpen) {
        const input = document.getElementById('messageInput');
        const content = input.value.trim();
        if (!content) return;
        sendBotMessage(content);
        input.value = '';
        autoResize(input);
        return;
    }
    // Call the original sendMessage for normal chats
    if (originalSendMessage) {
        originalSendMessage();
    }
}

// Patch the global sendMessage function after page load
document.addEventListener('DOMContentLoaded', () => {
    // Wait for chat.js to load first
    setTimeout(() => {
        if (typeof sendMessage !== 'undefined') {
            window._originalSendMessage = sendMessage;
            window.sendMessage = function() {
                if (botChatOpen) {
                    const input = document.getElementById('messageInput');
                    const content = input.value.trim();
                    if (!content) return;
                    sendBotMessage(content);
                    input.value = '';
                    autoResize(input);
                    return;
                }
                window._originalSendMessage();
            };
        }
        initBot();
    }, 500);
});

// Re-inject bot entry when conversations reload
const _origRenderConversations = typeof renderConversations === 'function' ? renderConversations : null;
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        if (typeof renderConversations !== 'undefined') {
            const _origRC = renderConversations;
            window.renderConversations = function() {
                _origRC();
                injectBotEntry();
                // Restore active state if bot is open
                if (botChatOpen) {
                    document.querySelectorAll('.conv-item').forEach(item => item.classList.remove('active'));
                    const botItem = document.getElementById('botConvItem');
                    if (botItem) botItem.classList.add('active');
                }
            };
        }
    }, 500);
});

// Also handle the openConversation to close bot view
const _origOpenConversation = typeof openConversation === 'function' ? openConversation : null;
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        if (typeof openConversation !== 'undefined') {
            const _origOC = openConversation;
            window.openConversation = async function(convId) {
                botChatOpen = false;
                // Restore header actions
                restoreChatHeaderActions();
                // Restore avatar style
                document.getElementById('chatAvatar').style.background = '';
                await _origOC(convId);
            };
        }
    }, 500);
});
