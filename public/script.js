const chatContainer = document.getElementById('chatContainer');
const userInput = document.getElementById('userInput');
const sendBtn = document.getElementById('sendBtn');
const sidebar = document.getElementById('sidebar');
const chatHistory = document.getElementById('chatHistory');
const limitFill = document.getElementById('limitFill');
const limitText = document.getElementById('limitText');

// ========== ICONS SVG ==========
const ICONS = {
    user: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>`,
    bot: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>`,
    chat: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>`,
    delete: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`,
    copy: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`,
    check: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>`
};

// ========== LOCAL STORAGE ==========
const STORAGE_KEY = 'ryuu_ai_chats';

function loadChatsFromStorage() {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
            const parsed = JSON.parse(saved);
            if (parsed && parsed.length > 0) {
                chats = parsed;
                currentChatId = chats[chats.length - 1].id;
            }
        }
    } catch (e) {
        console.error('Gagal load dari localStorage:', e);
    }
}

function saveChatsToStorage() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(chats));
    } catch (e) {
        console.error('Gagal save ke localStorage:', e);
    }
}

// ========== STATE ==========
let isLoading = false;
let currentChatId = Date.now();
let chats = [{ 
    id: currentChatId, 
    messages: [], 
    title: 'Percakapan Baru',
    createdAt: new Date().toISOString()
}];

loadChatsFromStorage();


// ========== EVENT LISTENERS ==========
document.addEventListener('DOMContentLoaded', () => {
    userInput.focus();
    updateChatHistory();
    
    if (chats.length > 1 || chats[0].messages.length > 0) {
        loadChat(currentChatId);
    }
});

function autoResize(textarea) {
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px';
    sendBtn.disabled = !textarea.value.trim();
}

function handleKeydown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (!sendBtn.disabled) sendMessage();
    }
}

function toggleSidebar() {
    sidebar.classList.toggle('open');
    let overlay = document.querySelector('.sidebar-overlay');
    if (sidebar.classList.contains('open')) {
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.className = 'sidebar-overlay';
            overlay.onclick = toggleSidebar;
            document.body.appendChild(overlay);
        }
        overlay.classList.add('active');
    } else if (overlay) {
        overlay.classList.remove('active');
    }
}

// ========== CHAT FUNCTIONS ==========

function newChat() {
    currentChatId = Date.now();
    chats.push({ 
        id: currentChatId, 
        messages: [], 
        title: 'Percakapan Baru',
        createdAt: new Date().toISOString()
    });
    
    chatContainer.innerHTML = `
        <div class="welcome-screen" id="welcomeScreen">
            <div class="welcome-content">
                <h1>Xyroo AI</h1>
                <p class="welcome-subtitle">Hai! Aku Xyroo AI. Siap membantu kamu memahami, membuat, dan menyelesaikan berbagai hal.</p>
                <div class="topic-section">
                    <h3>Topik Populer</h3>
                    <div class="suggestion-chips">
                        <button class="chip" onclick="sendQuickMessage('Jelaskan tentang fotosintesis dengan cara yang mudah dipahami')">
                            <div class="chip-icon green">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"></path>
                                </svg>
                            </div>
                            <div><strong>Fotosintesis</strong><small>Belajar biologi dasar</small></div>
                        </button>
                        <button class="chip" onclick="sendQuickMessage('Bantu saya memahami konsep variabel dalam pemrograman')">
                            <div class="chip-icon blue">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
                                    <line x1="8" y1="21" x2="16" y2="21"></line>
                                    <line x1="12" y1="17" x2="12" y2="21"></line>
                                </svg>
                            </div>
                            <div><strong>Belajar Coding</strong><small>Dasar pemrograman</small></div>
                        </button>
                        <button class="chip" onclick="sendQuickMessage('Ceritakan sejarah Indonesia secara singkat')">
                            <div class="chip-icon orange">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path>
                                    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>
                                </svg>
                            </div>
                            <div><strong>Sejarah</strong><small>Sejarah Indonesia</small></div>
                        </button>
                        <button class="chip" onclick="sendQuickMessage('Berikan tips belajar yang efektif')">
                            <div class="chip-icon purple">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <circle cx="12" cy="12" r="10"></circle>
                                    <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"></polygon>
                                </svg>
                            </div>
                            <div><strong>Tips Belajar</strong><small>Teknik belajar efektif</small></div>
                        </button>
                        <button class="chip" onclick="sendQuickMessage('Jelaskan rumus Pythagoras dan contoh soalnya')">
                            <div class="chip-icon red">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <line x1="18" y1="20" x2="18" y2="10"></line>
                                    <line x1="12" y1="20" x2="12" y2="4"></line>
                                    <line x1="6" y1="20" x2="6" y2="14"></line>
                                </svg>
                            </div>
                            <div><strong>Matematika</strong><small>Rumus & contoh soal</small></div>
                        </button>
                        <button class="chip" onclick="sendQuickMessage('Ceritakan lelucon lucu dong!')">
                            <div class="chip-icon yellow">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <circle cx="12" cy="12" r="10"></circle>
                                    <path d="M8 14s1.5 2 4 2 4-2 4-2"></path>
                                    <line x1="9" y1="9" x2="9.01" y2="9"></line>
                                    <line x1="15" y1="9" x2="15.01" y2="9"></line>
                                </svg>
                            </div>
                            <div><strong>Hiburan</strong><small>Cerita lucu</small></div>
                        </button>
                    </div>
                </div>
                </div>
            </div>
        </div>
    `;
    
    userInput.value = '';
    userInput.style.height = 'auto';
    sendBtn.disabled = true;
    updateChatHistory();
    saveChatsToStorage();
    
    if (window.innerWidth <= 768) toggleSidebar();
}

function loadChat(id) {
    const chat = chats.find(c => c.id === id);
    if (!chat) return;
    currentChatId = id;
    
    document.querySelectorAll('.history-item').forEach(item => {
        item.classList.toggle('active', item.dataset.chatId == id);
    });
    
    chatContainer.innerHTML = '';
    if (chat.messages.length === 0) {
        newChat();
        return;
    }
    
    chat.messages.forEach(msg => {
        if (msg.role === 'user') {
            addUserMessage(msg.content, false);
        } else {
            addBotMessage(msg.content, false);
        }
    });
    
    if (window.innerWidth <= 768) toggleSidebar();
}

function deleteChat(id, event) {
    event.stopPropagation();
    if (!confirm('Hapus chat ini?')) return;
    
    chats = chats.filter(c => c.id !== id);
    saveChatsToStorage();
    
    if (chats.length === 0) {
        newChat();
    } else {
        currentChatId = chats[chats.length - 1].id;
        loadChat(currentChatId);
    }
    updateChatHistory();
}

function clearAllChats() {
    if (!confirm('Hapus semua chat? Ini tidak bisa dibatalkan!')) return;
    
    chats = [];
    localStorage.removeItem(STORAGE_KEY);
    newChat();
}

function updateChatHistory() {
    if (!chatHistory) return;
    chatHistory.innerHTML = chats.map(chat => `
        <div class="history-item ${chat.id === currentChatId ? 'active' : ''}" 
             data-chat-id="${chat.id}"
             onclick="loadChat(${chat.id})">
            <span class="history-icon">${ICONS.chat}</span>
            <span class="history-text">${escapeHtml(chat.title)}</span>
            <button class="history-delete" onclick="deleteChat(${chat.id}, event)" title="Hapus">${ICONS.delete}</button>
        </div>
    `).join('');
}

function sendQuickMessage(message) {
    userInput.value = message;
    autoResize(userInput);
    sendMessage();
}

// ========== MAIN SEND FUNCTION ==========
async function sendMessage() {
    const message = userInput.value.trim();
    if (!message || isLoading) return;

    const welcome = document.getElementById('welcomeScreen');
    if (welcome) welcome.remove();

    addUserMessage(message);
    
    userInput.value = '';
    userInput.style.height = 'auto';
    sendBtn.disabled = true;

    const typingId = showTypingIndicator();
    setLoading(true);

    try {
        const chat = chats.find(c => c.id === currentChatId);
        const history = (chat?.messages || []).map(m => ({
            role: m.role === 'user' ? 'user' : 'model',
            parts: [{ text: m.content }]
        }));

        const response = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message, history })
        });

        const data = await response.json();
        removeTypingIndicator(typingId);

        if (data.success) {
            addBotMessage(data.reply);
            showToast(`Respons dari ${data.usedKey || 'AI'}`);
        } else {
            addBotMessage('Maaf, terjadi kesalahan: ' + (data.error || 'Unknown error'));
        }

    } catch (error) {
        removeTypingIndicator(typingId);
        addBotMessage('Error: Tidak dapat terhubung ke server. Pastikan server Node.js berjalan.');
        console.error('Error:', error);
    } finally {
        setLoading(false);
    }
}

// ========== AUTO-LINK FUNCTION ==========
function autoLink(text) {
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    return text.replace(urlRegex, (url) => {
        return `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`;
    });
}

// ========== MESSAGE RENDERING ==========
function addUserMessage(text, save = true) {
    const msgDiv = document.createElement('div');
    msgDiv.className = 'message user';
    msgDiv.innerHTML = `
        <div class="message-avatar user-avatar-icon">${ICONS.user}</div>
        <div class="message-content">
            <p>${escapeHtml(text)}</p>
        </div>
    `;
    chatContainer.appendChild(msgDiv);
    scrollToBottom();

    if (save) {
        const chat = chats.find(c => c.id === currentChatId);
        if (chat) {
            chat.messages.push({ role: 'user', content: text });
            if (chat.messages.length === 1) {
                chat.title = text.substring(0, 30) + (text.length > 30 ? '...' : '');
                updateChatHistory();
            }
            saveChatsToStorage();
        }
    }
}

function addBotMessage(text, save = true) {
    const msgId = 'msg-' + Date.now();
    const msgDiv = document.createElement('div');
    msgDiv.className = 'message bot';
    msgDiv.id = msgId;
    msgDiv.innerHTML = `
        <div class="message-avatar bot-avatar-icon">${ICONS.bot}</div>
        <div class="message-content">
            ${formatMessage(text)}
            <div class="message-actions">
                <button class="msg-copy-btn" onclick="copyMessage('${msgId}')" title="Copy pesan">
                    ${ICONS.copy} Copy
                </button>
            </div>
        </div>
    `;
    chatContainer.appendChild(msgDiv);
    scrollToBottom();

    if (save) {
        const chat = chats.find(c => c.id === currentChatId);
        if (chat) {
            chat.messages.push({ role: 'assistant', content: text });
            saveChatsToStorage();
        }
    }
}

function formatMessage(text) {
    let formatted = escapeHtml(text);
    
    // Code blocks
    formatted = formatted.replace(/```(\w+)?\n([\s\S]*?)```/g, (match, lang, code) => {
        return `<div class="code-block-wrapper">
            <pre><code class="language-${lang || 'text'}">${code.trim()}</code></pre>
            <button class="copy-btn" onclick="copyCode(this)">${ICONS.copy} Copy</button>
        </div>`;
    });
    
    // Inline code
    formatted = formatted.replace(/`([^`]+)`/g, '<code>$1</code>');
    
    // Bold
    formatted = formatted.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    
    // Italic
    formatted = formatted.replace(/\*(.*?)\*/g, '<em>$1</em>');
    
    // Headers
    formatted = formatted.replace(/^### (.*$)/gm, '<h3>$1</h3>');
    formatted = formatted.replace(/^## (.*$)/gm, '<h2>$1</h2>');
    formatted = formatted.replace(/^# (.*$)/gm, '<h1>$1</h1>');
    
    // Line breaks
    formatted = formatted.replace(/\n/g, '<br>');
    
    // Auto-link URLs
    formatted = autoLink(formatted);
    
    return `<p>${formatted}</p>`;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function showTypingIndicator() {
    const id = 'typing-' + Date.now();
    const div = document.createElement('div');
    div.id = id;
    div.className = 'message bot';
    div.innerHTML = `
        <div class="message-avatar bot-avatar-icon">${ICONS.bot}</div>
        <div class="message-content">
            <div class="typing-indicator">
                <span></span><span></span><span></span>
            </div>
        </div>
    `;
    chatContainer.appendChild(div);
    scrollToBottom();
    return id;
}

function removeTypingIndicator(id) {
    const el = document.getElementById(id);
    if (el) el.remove();
}

function copyCode(btn) {
    const code = btn.previousElementSibling.querySelector('code').textContent;
    navigator.clipboard.writeText(code).then(() => {
        btn.innerHTML = `${ICONS.check} Copied!`;
        setTimeout(() => btn.innerHTML = `${ICONS.copy} Copy`, 2000);
    });
}

function copyMessage(msgId) {
    const msgDiv = document.getElementById(msgId);
    if (!msgDiv) return;
    
    const contentDiv = msgDiv.querySelector('.message-content');
    let text = '';
    
    const clone = contentDiv.cloneNode(true);
    const actions = clone.querySelector('.message-actions');
    if (actions) actions.remove();
    
    text = clone.innerText || clone.textContent;
    
    navigator.clipboard.writeText(text.trim()).then(() => {
        const btn = msgDiv.querySelector('.msg-copy-btn');
        const originalHTML = btn.innerHTML;
        btn.innerHTML = `${ICONS.check} Copied!`;
        btn.classList.add('copied');
        
        setTimeout(() => {
            btn.innerHTML = originalHTML;
            btn.classList.remove('copied');
        }, 2000);
    });
}

function scrollToBottom() {
    const wrapper = document.getElementById('chatWrapper');
    if (wrapper) {
        wrapper.scrollTo({ top: wrapper.scrollHeight, behavior: 'smooth' });
    }
}

function setLoading(loading) {
    isLoading = loading;
    sendBtn.disabled = loading || !userInput.value.trim();
}

function showToast(message) {
    let toast = document.querySelector('.toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.className = 'toast';
        document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 3000);
}

// Init
updateChatHistory();