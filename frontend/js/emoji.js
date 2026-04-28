// ===== SwiftConnect Emoji Picker =====

const EMOJI_CATEGORIES = {
    '😊 Smileys': [
        '😀','😃','😄','😁','😆','😅','🤣','😂','🙂','🙃','😉','😊','😇','🥰','😍','🤩',
        '😘','😗','☺️','😚','😙','🥲','😋','😛','😜','🤪','😝','🤑','🤗','🤭','🤫','🤔',
        '🤐','🤨','😐','😑','😶','😏','😒','🙄','😬','🤥','😌','😔','😪','🤤','😴','😷',
        '🤒','🤕','🤢','🤮','🤧','🥵','🥶','🥴','😵','🤯','🤠','🥳','🥸','😎','🤓','🧐',
        '😕','😟','🙁','☹️','😮','😯','😲','😳','🥺','😦','😧','😨','😰','😥','😢','😭',
        '😱','😖','😣','😞','😓','😩','😫','🥱','😤','😡','😠','🤬','😈','👿','💀','☠️',
    ],
    '👋 Gestures': [
        '👋','🤚','🖐️','✋','🖖','👌','🤌','🤏','✌️','🤞','🤟','🤘','🤙','👈','👉','👆',
        '🖕','👇','☝️','👍','👎','✊','👊','🤛','🤜','👏','🙌','👐','🤲','🤝','🙏','✍️',
        '💅','🤳','💪','🦾','🦿','🦵','🦶','👂','🦻','👃','🫀','🫁','🧠','🦷','🦴','👁️',
        '👀','👅','👄','🫦',
    ],
    '❤️ Hearts & Love': [
        '❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖',
        '💘','💝','💟','☮️','✝️','☪️','🕉️','☸️','🪯','✡️','🔯','🕎','☯️','☦️','🛐',
        '⛎','♈','♉','♊','♋','♌','♍','♎','♏','♐','♑','♒','♓','🆔','⚛️',
    ],
    '🎉 Activities': [
        '⚽','🏀','🏈','⚾','🥎','🎾','🏐','🏉','🥏','🎱','🪀','🏓','🏸','🏒','🥍','🏑',
        '🏏','🪃','🥅','⛳','🪁','🎿','🛷','🥌','🎯','🪃','🎱','🔮','🪄','🧿','🎭','🎨',
        '🖼️','🎪','🎟️','🎢','🎡','🎠','🎪','🎭','🎬','🎥','📽️','🎞️','📹','📸','📷',
        '🎙️','🎚️','🎛️','📡','🔭','🔬','🧪','🧫','🧬','🔋','💡','🔦','🕯️','🪔',
    ],
    '🍕 Food': [
        '🍕','🍔','🍟','🌭','🌮','🌯','🥙','🧆','🥚','🍳','🥘','🍲','🫕','🥣','🥗','🍿',
        '🧂','🥫','🍱','🍘','🍙','🍚','🍛','🍜','🍝','🍠','🍢','🍣','🍤','🍥','🥮','🍡',
        '🥟','🦪','🍦','🍧','🍨','🍩','🍪','🎂','🍰','🧁','🥧','🍫','🍬','🍭','🍮','🍯',
        '🍷','🥂','🍸','🍹','🧉','🍺','🍻','🥃','🫗','🍼','🥛','☕','🫖','🍵','🧃','🥤',
    ],
    '🐶 Animals': [
        '🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐻‍❄️','🐨','🐯','🦁','🐮','🐷','🐸','🐵',
        '🙈','🙉','🙊','🐔','🐧','🐦','🐤','🦆','🦅','🦉','🦇','🐺','🐗','🐴','🦄','🐝',
        '🪱','🐛','🦋','🐌','🐞','🐜','🪲','🦟','🦗','🪳','🕷️','🦂','🐢','🐍','🦎','🦖',
        '🦕','🐙','🦑','🦐','🦞','🦀','🐡','🐠','🐟','🐬','🐳','🐋','🦈','🐊','🐅','🐆',
    ],
    '🌍 Travel': [
        '🚗','🚕','🚙','🚌','🚎','🏎️','🚓','🚑','🚒','🚐','🛻','🚚','🚛','🚜','🏍️','🛵',
        '🚲','🛴','🛹','🛼','🚏','🛣️','🛤️','⛽','🛞','🚨','🚥','🚦','🛑','🚧','⚓','🛟',
        '⛵','🛶','🚤','🛥️','🛳️','⛴️','🚢','✈️','🛩️','🛫','🛬','🪂','💺','🚁','🚟','🚠',
        '🚡','🛰️','🚀','🛸','🎑','🌐','🗺️','🗿','🗽','🗼','🏰','🏯','🏟️','🎠','🎡','🎢',
    ],
    '💼 Objects': [
        '⌚','📱','📲','💻','⌨️','🖥️','🖨️','🖱️','🖲️','🕹️','💾','💿','📀','🧮','📷','📸',
        '📹','🎥','📽️','🎞️','📞','☎️','📟','📠','📺','📻','🧭','⏱️','⏲️','⏰','🕰️','⌛',
        '⏳','📡','🔋','🪫','🔌','💡','🔦','🕯️','🪔','🧯','🛢️','💰','💴','💵','💶','💷',
        '💸','💳','🪙','💹','📈','📉','📊','📋','🗒️','🗓️','📆','📅','🗑️','📁','📂','🗂️',
    ],
    '🔥 Symbols': [
        '✅','❎','🔴','🟠','🟡','🟢','🔵','🟣','⚫','⚪','🟤','🔶','🔷','🔸','🔹','🔺',
        '🔻','💠','🔘','🔲','🔳','⬛','⬜','◼️','◻️','◾','◽','▪️','▫️','🔈','🔉','🔊',
        '📢','📣','🔔','🔕','🎵','🎶','⚠️','🚸','⛔','🚫','🔞','💯','🔱','⚜️','🔰','♻️',
        '✔️','🔝','🆕','🆙','🆒','🆓','🆖','🅰️','🅱️','🆎','🅾️','🆗','🅿️','🆘','❌','‼️',
    ],
};

let emojiPickerOpen = false;
let contextMenuTarget = null;

function initEmojiPicker() {
    renderEmojiCategories();
    renderEmojiGrid(Object.values(EMOJI_CATEGORIES).flat());

    // Close emoji picker when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.emoji-picker-wrapper') && !e.target.closest('#emojiPanel')) {
            closeEmojiPicker();
        }
        // Close context menu
        if (!e.target.closest('.msg-context-menu')) {
            document.getElementById('msgContextMenu').style.display = 'none';
            contextMenuTarget = null;
        }
    });
}

function renderEmojiCategories() {
    const container = document.getElementById('emojiCategories');
    if (!container) return;
    container.innerHTML = '';
    Object.keys(EMOJI_CATEGORIES).forEach((cat, idx) => {
        const btn = document.createElement('button');
        btn.className = 'emoji-cat-btn';
        btn.title = cat;
        btn.textContent = cat.split(' ')[0]; // Just the emoji part
        btn.onclick = () => {
            renderEmojiGrid(EMOJI_CATEGORIES[cat]);
            document.querySelectorAll('.emoji-cat-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        };
        if (idx === 0) btn.classList.add('active');
        container.appendChild(btn);
    });
}

function renderEmojiGrid(emojis) {
    const grid = document.getElementById('emojiGrid');
    if (!grid) return;
    grid.innerHTML = '';
    emojis.forEach(emoji => {
        const btn = document.createElement('button');
        btn.className = 'emoji-btn';
        btn.textContent = emoji;
        btn.onclick = () => insertEmoji(emoji);
        grid.appendChild(btn);
    });
}

function filterEmojis(query) {
    if (!query) {
        renderEmojiGrid(Object.values(EMOJI_CATEGORIES).flat());
        return;
    }
    // Simple filter: match against all emojis (text-based emoji search isn't great, but functional)
    const allEmojis = Object.values(EMOJI_CATEGORIES).flat();
    renderEmojiGrid(allEmojis.filter(e => e.includes(query)));
}

function insertEmoji(emoji) {
    const input = document.getElementById('messageInput');
    if (!input) return;
    const start = input.selectionStart;
    const end = input.selectionEnd;
    const text = input.value;
    input.value = text.slice(0, start) + emoji + text.slice(end);
    input.selectionStart = input.selectionEnd = start + emoji.length;
    input.focus();
    autoResize(input);
}

function toggleEmojiPicker() {
    const panel = document.getElementById('emojiPanel');
    if (!panel) return;
    emojiPickerOpen = !emojiPickerOpen;
    panel.style.display = emojiPickerOpen ? 'flex' : 'none';
    if (emojiPickerOpen) {
        document.getElementById('emojiSearch').focus();
    }
}

function closeEmojiPicker() {
    const panel = document.getElementById('emojiPanel');
    if (panel) panel.style.display = 'none';
    emojiPickerOpen = false;
}

// ===== MESSAGE CONTEXT MENU (Right-click for Reply/Copy) =====
function showMessageContextMenu(e, msg) {
    e.preventDefault();
    e.stopPropagation();
    contextMenuTarget = msg;

    const menu = document.getElementById('msgContextMenu');
    menu.style.display = 'block';
    
    // Position near cursor, but keep within viewport
    let x = e.clientX;
    let y = e.clientY;
    
    const menuWidth = 160;
    const menuHeight = 90;
    if (x + menuWidth > window.innerWidth) x = window.innerWidth - menuWidth - 8;
    if (y + menuHeight > window.innerHeight) y = window.innerHeight - menuHeight - 8;
    
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
}

function replyFromContextMenu() {
    if (contextMenuTarget) {
        setReply(contextMenuTarget);
        document.getElementById('msgContextMenu').style.display = 'none';
        contextMenuTarget = null;
    }
}

function copyFromContextMenu() {
    if (contextMenuTarget && contextMenuTarget.content) {
        navigator.clipboard.writeText(contextMenuTarget.content).catch(() => {});
        document.getElementById('msgContextMenu').style.display = 'none';
        contextMenuTarget = null;
    }
}

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', initEmojiPicker);
