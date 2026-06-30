// ========== SUPABASE INIT ==========
const SUPABASE_URL = 'https://rkfabzgsvzwffpisounp.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_gU4SL_XQSmWulTN_yHw_4g_HBL6KF3V';
const { createClient } = supabase;
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ========== ICONS ==========
const ICONS = {
    user: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
    bot: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,
    chat: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`,
    rename: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`,
    delete: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`,
    copy: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`,
    check: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>`
};

// ========== STATE ==========
let isLoading = false;
let currentUser = null;
let currentToken = null;
let currentChatId = null;
let chats = [];

// Guest usage (localStorage)
const GUEST_LIMIT = 3;
const GUEST_KEY = 'hackai_guest_usage';

function getGuestUsage() {
    try {
        const saved = localStorage.getItem(GUEST_KEY);
        if (!saved) return { count: 0, date: today() };
        const data = JSON.parse(saved);
        if (data.date !== today()) return { count: 0, date: today() };
        return data;
    } catch { return { count: 0, date: today() }; }
}

function incrementGuestUsage() {
    const usage = getGuestUsage();
    usage.count++;
    localStorage.setItem(GUEST_KEY, JSON.stringify(usage));
    return usage;
}

function today() {
    return new Date().toISOString().split('T')[0];
}

// Local chats for guest
const LOCAL_KEY = 'hackai_local_chats';

function loadLocalChats() {
    try {
        const saved = localStorage.getItem(LOCAL_KEY);
        return saved ? JSON.parse(saved) : [];
    } catch { return []; }
}

function saveLocalChats() {
    try {
        localStorage.setItem(LOCAL_KEY, JSON.stringify(chats));
    } catch {}
}

// ========== DOM REFS ==========
const chatContainer = document.getElementById('chatContainer');
const userInput = document.getElementById('userInput');
const sendBtn = document.getElementById('sendBtn');
const sidebar = document.getElementById('sidebar');
const chatHistoryEl = document.getElementById('chatHistory');
const limitText = document.getElementById('limitText');
const limitDot = document.getElementById('limitDot');
const userDisplayName = document.getElementById('userDisplayName');
const authBtn = document.getElementById('authBtn');

// ========== INIT ==========
document.addEventListener('DOMContentLoaded', async () => {
    userInput.focus();

    sb.auth.onAuthStateChange(async (event, session) => {
        if (session) {
            currentUser = session.user;
            currentToken = session.access_token;
            await onLogin();
        } else {
            currentUser = null;
            currentToken = null;
            onLogout();
        }
    });

    const { data: { session } } = await sb.auth.getSession();
    if (session) {
        currentUser = session.user;
        currentToken = session.access_token;
        await onLogin();
    } else {
        onLogout();
    }
});

// ========== AUTH STATE HANDLERS ==========
async function onLogin() {
    const { data: profile } = await sb
        .from('profiles')
        .select('username')
        .eq('id', currentUser.id)
        .single();

    const name = profile?.username || currentUser.email.split('@')[0];
    userDisplayName.textContent = name;

    authBtn.style.display = 'none';
    document.getElementById('userAvatarBtn').style.cursor = 'pointer';

    await loadConversations();
    updateLimitBadge();
}

function onLogout() {
    currentUser = null;
    currentToken = null;
    userDisplayName.textContent = 'anonymous';
    authBtn.style.display = 'block';
    authBtn.textContent = 'Login';

    chats = loadLocalChats();
    if (chats.length === 0) {
        chats = [createLocalChat()];
        saveLocalChats();
    }
    currentChatId = chats[chats.length - 1].id;
    renderChatHistory();
    showWelcome();
    updateLimitBadge();
}

function createLocalChat(title = 'New Chat') {
    return {
        id: 'local_' + Date.now(),
        title,
        messages: [],
        createdAt: new Date().toISOString()
    };
}

// ========== LIMIT BADGE ==========
async function updateLimitBadge() {
    if (!limitText || !limitDot) return;

    if (!currentUser) {
        const usage = getGuestUsage();
        const remaining = GUEST_LIMIT - usage.count;
        limitText.textContent = `guest: ${remaining}/${GUEST_LIMIT} req left`;
        limitDot.className = 'limit-dot' + (remaining <= 1 ? ' danger' : '');
        return;
    }

    try {
        const res = await fetchAPI('/api/usage');
        const data = await res.json();
        const remaining = data.remaining ?? 0;
        limitText.textContent = `${remaining}/100 req left today`;
        limitDot.className = 'limit-dot' +
            (remaining <= 10 ? ' danger' : remaining <= 30 ? ' warning' : '');
    } catch {
        limitText.textContent = 'usage unavailable';
    }
}

// ========== CONVERSATIONS (DB) ==========
async function loadConversations() {
    const res = await fetchAPI('/api/conversations');
    const data = await res.json();
    chats = (data.conversations || []).map(c => ({
        id: c.id,
        title: c.title,
        messages: [],
        createdAt: c.created_at,
        loaded: false
    }));

    if (chats.length === 0) {
        await createConversation();
    } else {
        currentChatId = chats[0].id;
        renderChatHistory();
        showWelcome();
    }
}

async function createConversation(title = 'New Chat') {
    const res = await fetchAPI('/api/conversations', {
        method: 'POST',
        body: JSON.stringify({ title })
    });
    const data = await res.json();
    const conv = {
        id: data.conversation.id,
        title: data.conversation.title,
        messages: [],
        loaded: true
    };
    chats.unshift(conv);
    currentChatId = conv.id;
    renderChatHistory();
    showWelcome();
    return conv;
}

async function loadMessagesForChat(chatId) {
    const chat = chats.find(c => c.id === chatId);
    if (!chat || chat.loaded) return;

    const res = await fetchAPI(`/api/conversations/${chatId}/messages`);
    const data = await res.json();
    chat.messages = (data.messages || []).map(m => ({
        role: m.role,
        content: m.content
    }));
    chat.loaded = true;
}

// ========== NEW CHAT ==========
async function newChat() {
    if (currentUser) {
        await createConversation();
    } else {
        const chat = createLocalChat();
        chats.unshift(chat);
        currentChatId = chat.id;
        saveLocalChats();
        renderChatHistory();
        showWelcome();
    }
    userInput.value = '';
    userInput.style.height = 'auto';
    sendBtn.disabled = true;
    if (window.innerWidth <= 768) toggleSidebar();
}

// ========== LOAD CHAT ==========
async function loadChat(id) {
    currentChatId = id;

    document.querySelectorAll('.history-item').forEach(el => {
        el.classList.toggle('active', el.dataset.chatId === String(id));
    });

    const chat = chats.find(c => c.id === id);
    if (!chat) return;

    if (currentUser && !chat.loaded) {
        await loadMessagesForChat(id);
    }

    chatContainer.innerHTML = '';

    if (!chat.messages || chat.messages.length === 0) {
        showWelcome();
        if (window.innerWidth <= 768) toggleSidebar();
        return;
    }

    chat.messages.forEach(msg => {
        if (msg.role === 'user') addUserMessage(msg.content, false);
        else addBotMessage(msg.content, false);
    });

    if (window.innerWidth <= 768) toggleSidebar();
}

// ========== RENAME CHAT ==========
async function startRename(id, event) {
    event.stopPropagation();
    const item = document.querySelector(`.history-item[data-chat-id="${id}"]`);
    if (!item) return;

    const textEl = item.querySelector('.history-text');
    const actionsEl = item.querySelector('.history-actions');
    const currentTitle = textEl.textContent;

    const input = document.createElement('input');
    input.className = 'history-rename-input';
    input.value = currentTitle;
    textEl.replaceWith(input);
    actionsEl.style.display = 'none';
    input.focus();
    input.select();

    const finish = async () => {
        const newTitle = input.value.trim() || currentTitle;
        input.replaceWith(textEl);
        textEl.textContent = newTitle;
        actionsEl.style.display = '';

        const chat = chats.find(c => c.id === id);
        if (!chat || chat.title === newTitle) return;
        chat.title = newTitle;

        if (currentUser) {
            await fetchAPI(`/api/conversations/${id}`, {
                method: 'PATCH',
                body: JSON.stringify({ title: newTitle })
            });
        } else {
            saveLocalChats();
        }
    };

    input.addEventListener('blur', finish);
    input.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
        if (e.key === 'Escape') { input.value = currentTitle; input.blur(); }
    });
}

// ========== DELETE CHAT ==========
async function deleteChat(id, event) {
    event.stopPropagation();
    if (!confirm('Delete this session?')) return;

    if (currentUser) {
        await fetchAPI(`/api/conversations/${id}`, { method: 'DELETE' });
    }

    chats = chats.filter(c => c.id !== id);

    if (!currentUser) saveLocalChats();

    if (chats.length === 0) {
        await newChat();
    } else {
        currentChatId = chats[0].id;
        await loadChat(currentChatId);
    }
    renderChatHistory();
}

// ========== CLEAR ALL ==========
async function clearAllChats() {
    if (!confirm('Delete all sessions? This cannot be undone.')) return;

    if (currentUser) {
        for (const chat of chats) {
            await fetchAPI(`/api/conversations/${chat.id}`, { method: 'DELETE' });
        }
    } else {
        localStorage.removeItem(LOCAL_KEY);
    }

    chats = [];
    await newChat();
}

// ========== RENDER HISTORY ==========
function renderChatHistory() {
    if (!chatHistoryEl) return;
    chatHistoryEl.innerHTML = chats.map(chat => `
        <div class="history-item ${chat.id === currentChatId ? 'active' : ''}"
             data-chat-id="${chat.id}"
             onclick="loadChat('${chat.id}')">
            <span class="history-icon">${ICONS.chat}</span>
            <span class="history-text">${escapeHtml(chat.title)}</span>
            <div class="history-actions">
                <button class="history-action-btn" onclick="startRename('${chat.id}', event)" title="Rename">
                    ${ICONS.rename}
                </button>
                <button class="history-action-btn delete-btn" onclick="deleteChat('${chat.id}', event)" title="Delete">
                    ${ICONS.delete}
                </button>
            </div>
        </div>
    `).join('');
}

// ========== WELCOME SCREEN ==========
function showWelcome() {
    const isGuest = !currentUser;
    chatContainer.innerHTML = `
        <div class="welcome-screen" id="welcomeScreen">
            <div class="welcome-content">
                <div class="welcome-logo-box"><img src="logo.png" alt="Hack AI"></div>
                <div class="welcome-title">Hack AI</div>
                <div class="welcome-tagline">Simple. Smart. Free.</div>
<div class="welcome-subtitle">Explore, question, and break the boundaries of knowledge with me!</div>
                ${isGuest ? `
                <div class="guest-notice" onclick="openAuthModal()">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="12" cy="12" r="10"/>
                        <line x1="12" y1="8" x2="12" y2="12"/>
                        <line x1="12" y1="16" x2="12.01" y2="16"/>
                    </svg>
                    [GUEST] 3 req/day — login for 100/day
                </div>` : ''}
                <div class="topic-section">
                    <h3>Quick Commands</h3>
                    <div class="suggestion-chips">
                        <button class="chip" onclick="sendQuickMessage('What is ethical hacking and how does it work?')">
                            <div class="chip-icon red"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg></div>
                            <div class="chip-text"><strong>Ethical Hacking</strong><small>How it works</small></div>
                        </button>
                        <button class="chip" onclick="sendQuickMessage('Explain how SQL injection works and how to prevent it')">
                            <div class="chip-icon orange"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg></div>
                            <div class="chip-text"><strong>SQL Injection</strong><small>Attack & prevention</small></div>
                        </button>
                        <button class="chip" onclick="sendQuickMessage('What is network security and common protocols?')">
                            <div class="chip-icon blue"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg></div>
                            <div class="chip-text"><strong>Network Security</strong><small>Protocols & defense</small></div>
                        </button>
                        <button class="chip" onclick="sendQuickMessage('Explain Linux terminal commands for beginners')">
                            <div class="chip-icon green"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg></div>
                            <div class="chip-text"><strong>Linux Terminal</strong><small>Essential commands</small></div>
                        </button>
                        <button class="chip" onclick="sendQuickMessage('What is OSINT and how is it used in cybersecurity?')">
                            <div class="chip-icon yellow"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg></div>
                            <div class="chip-text"><strong>OSINT</strong><small>Intelligence gathering</small></div>
                        </button>
                    </div>
                </div>
            </div>
        </div>`;
}
// ========== SEND MESSAGE ==========
async function sendMessage() {
    const message = userInput.value.trim();
    if (!message || isLoading) return;

    if (!currentUser) {
        const usage = getGuestUsage();
        if (usage.count >= GUEST_LIMIT) {
            showToast('Guest limit reached! Login for 100 req/day.');
            openAuthModal();
            return;
        }
        incrementGuestUsage();
        updateLimitBadge();
    }

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

        const body = { message, history };
        if (currentUser && currentChatId) body.conversationId = currentChatId;

        const res = await fetchAPI('/api/chat', {
            method: 'POST',
            body: JSON.stringify(body)
        });

        const data = await res.json();
        removeTypingIndicator(typingId);

        if (data.success) {
            addBotMessage(data.reply);
            if (data.usage) {
                const remaining = data.usage.remaining ?? 0;
                limitText.textContent = `${remaining}/100 req left today`;
                limitDot.className = 'limit-dot' +
                    (remaining <= 10 ? ' danger' : remaining <= 30 ? ' warning' : '');
            }
        } else if (data.limitReached) {
            addBotMessage("You've reached your daily limit of 100 requests. Come back tomorrow!");
            updateLimitBadge();
        } else {
            addBotMessage('Error: ' + (data.error || 'Unknown error'));
        }
    } catch (err) {
        removeTypingIndicator(typingId);
        addBotMessage('Connection error. Make sure the server is running.');
        console.error(err);
    } finally {
        setLoading(false);
    }
}

function sendQuickMessage(message) {
    userInput.value = message;
    autoResize(userInput);
    sendMessage();
}

// ========== MESSAGE RENDERING ==========
function addUserMessage(text, save = true) {
    const div = document.createElement('div');
    div.className = 'message user';
    div.innerHTML = `
        <div class="message-avatar user-avatar-icon">${ICONS.user}</div>
        <div class="message-content"><p>${escapeHtml(text)}</p></div>`;
    chatContainer.appendChild(div);
    scrollToBottom();

    if (save) {
        const chat = chats.find(c => c.id === currentChatId);
        if (chat) {
            if (!chat.messages) chat.messages = [];
            chat.messages.push({ role: 'user', content: text });
            if (chat.messages.length === 1) {
                chat.title = text.substring(0, 32) + (text.length > 32 ? '...' : '');
                renderChatHistory();
                if (currentUser) {
                    fetchAPI(`/api/conversations/${currentChatId}`, {
                        method: 'PATCH',
                        body: JSON.stringify({ title: chat.title })
                    });
                } else {
                    saveLocalChats();
                }
            }
        }
    }
}

function addBotMessage(text, save = true) {
    const msgId = 'msg-' + Date.now();
    const div = document.createElement('div');
    div.className = 'message bot';
    div.id = msgId;
    div.innerHTML = `
        <div class="message-avatar bot-avatar-icon">${ICONS.bot}</div>
        <div class="message-content">
            ${formatMessage(text)}
            <div class="message-actions">
                <button class="msg-copy-btn" onclick="copyMessage('${msgId}')">
                    ${ICONS.copy} Copy
                </button>
            </div>
        </div>`;
    chatContainer.appendChild(div);
    scrollToBottom();

    if (save) {
        const chat = chats.find(c => c.id === currentChatId);
        if (chat) {
            if (!chat.messages) chat.messages = [];
            chat.messages.push({ role: 'assistant', content: text });
            if (!currentUser) saveLocalChats();
        }
    }
}

function formatMessage(text) {
    let f = escapeHtml(text);
    f = f.replace(/```(\w+)?\n([\s\S]*?)```/g, (_, lang, code) =>
        `<div class="code-block-wrapper">
            <pre><code class="language-${lang || 'text'}">${code.trim()}</code></pre>
            <button class="copy-btn" onclick="copyCode(this)">${ICONS.copy} Copy</button>
        </div>`);
    f = f.replace(/`([^`]+)`/g, '<code>$1</code>');
    f = f.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    f = f.replace(/\*(.*?)\*/g, '<em>$1</em>');
    f = f.replace(/^### (.*$)/gm, '<h3>$1</h3>');
    f = f.replace(/^## (.*$)/gm, '<h2>$1</h2>');
    f = f.replace(/^# (.*$)/gm, '<h1>$1</h1>');
    f = f.replace(/^\s*[-*]\s+(.+)/gm, '<li>$1</li>');
    f = f.replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>');
    f = f.replace(/\n/g, '<br>');
    f = f.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
    return `<div>${f}</div>`;
}

function escapeHtml(text) {
    const d = document.createElement('div');
    d.textContent = text;
    return d.innerHTML;
}

// ========== TYPING INDICATOR ==========
function showTypingIndicator() {
    const id = 'typing-' + Date.now();
    const div = document.createElement('div');
    div.id = id;
    div.className = 'message bot';
    div.innerHTML = `
        <div class="message-avatar bot-avatar-icon">${ICONS.bot}</div>
        <div class="message-content">
            <div class="typing-indicator"><span></span><span></span><span></span></div>
        </div>`;
    chatContainer.appendChild(div);
    scrollToBottom();
    return id;
}

function removeTypingIndicator(id) {
    const el = document.getElementById(id);
    if (el) el.remove();
}

// ========== COPY ==========
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
    const clone = msgDiv.querySelector('.message-content').cloneNode(true);
    clone.querySelector('.message-actions')?.remove();
    navigator.clipboard.writeText((clone.innerText || clone.textContent).trim()).then(() => {
        const btn = msgDiv.querySelector('.msg-copy-btn');
        const orig = btn.innerHTML;
        btn.innerHTML = `${ICONS.check} Copied!`;
        btn.classList.add('copied');
        setTimeout(() => { btn.innerHTML = orig; btn.classList.remove('copied'); }, 2000);
    });
}

// ========== UI HELPERS ==========
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

function scrollToBottom() {
    const wrapper = document.getElementById('chatWrapper');
    if (wrapper) wrapper.scrollTo({ top: wrapper.scrollHeight, behavior: 'smooth' });
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

// ========== KEYBOARD FIX MOBILE ==========
function scrollInputIntoView() {
    setTimeout(() => {
        const inputArea = document.getElementById('inputArea');
        if (inputArea) inputArea.scrollIntoView({ behavior: 'smooth', block: 'end' });
        const wrapper = document.getElementById('chatWrapper');
        if (wrapper) wrapper.scrollTop = wrapper.scrollHeight;
    }, 300);
}

// ========== AUTH MODALS ==========
function openAuthModal() {
    document.getElementById('authModal').classList.add('active');
    document.getElementById('loginForm').style.display = 'block';
    document.getElementById('registerForm').style.display = 'none';
    document.getElementById('forgotForm').style.display = 'none';
    document.getElementById('resendForm').style.display = 'none';
}

function closeAuthModal() {
    document.getElementById('authModal').classList.remove('active');
}

function switchToRegister() {
    document.getElementById('loginForm').style.display = 'none';
    document.getElementById('registerForm').style.display = 'block';
}

function switchToLogin() {
    document.getElementById('registerForm').style.display = 'none';
    document.getElementById('forgotForm').style.display = 'none';
    document.getElementById('resendForm').style.display = 'none';
    document.getElementById('loginForm').style.display = 'block';
}

function switchToForgot() {
    document.getElementById('loginForm').style.display = 'none';
    document.getElementById('registerForm').style.display = 'none';
    document.getElementById('forgotForm').style.display = 'block';
}

async function handleLogin() {
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    const errEl = document.getElementById('loginError');
    const btn = document.getElementById('loginBtn');

    errEl.classList.remove('show');
    btn.disabled = true;
    btn.textContent = 'Signing in...';

    const { error } = await sb.auth.signInWithPassword({ email, password });

    if (error) {
        if (error.message.toLowerCase().includes('email not confirmed')) {
            window.pendingResendEmail = email;
            document.getElementById('loginForm').style.display = 'none';
            document.getElementById('resendForm').style.display = 'block';
            document.getElementById('resendSuccess').style.display = 'none';
            document.getElementById('resendBtn').textContent = 'Resend Email';
            document.getElementById('resendBtn').disabled = false;
            btn.disabled = false;
            btn.textContent = 'Access System';
            return;
        }
        errEl.textContent = error.message;
        errEl.classList.add('show');
        btn.disabled = false;
        btn.textContent = 'Access System';
        return;
    }

    closeAuthModal();
    showToast('Access granted.');
}

async function handleRegister() {
    const username = document.getElementById('registerUsername').value.trim();
    const email = document.getElementById('registerEmail').value.trim();
    const password = document.getElementById('registerPassword').value;
    const errEl = document.getElementById('registerError');
    const btn = document.getElementById('registerBtn');

    errEl.classList.remove('show');

    if (!username || username.length < 3) {
        errEl.textContent = 'username must be at least 3 characters';
        errEl.classList.add('show');
        return;
    }

    btn.disabled = true;
    btn.textContent = 'Creating account...';

    const { data, error } = await sb.auth.signUp({ email, password });

    if (error) {
        errEl.textContent = error.message;
        errEl.classList.add('show');
        btn.disabled = false;
        btn.textContent = 'Create Account';
        return;
    }

    if (data.user) {
        await sb.from('profiles').upsert({ id: data.user.id, username });
    }

    btn.disabled = false;
    btn.textContent = 'Create Account';

    document.getElementById('registerForm').style.display = 'none';
    document.getElementById('resendForm').style.display = 'block';
    window.pendingResendEmail = email;
    document.getElementById('resendSuccess').style.display = 'none';
    document.getElementById('resendBtn').textContent = 'Resend Email';
    document.getElementById('resendBtn').disabled = false;
    showToast('Account created! Please verify your email.');
}

async function handleResendVerification() {
    const btn = document.getElementById('resendBtn');
    const successEl = document.getElementById('resendSuccess');
    const email = window.pendingResendEmail;

    if (!email) return;

    btn.disabled = true;
    btn.textContent = 'Sending...';

    const { error } = await sb.auth.resend({ type: 'signup', email });

    if (error) {
        showToast(error.message);
        btn.disabled = false;
        btn.textContent = 'Resend Email';
        return;
    }

    successEl.style.display = 'block';
    btn.textContent = 'Sent!';
}

async function handleForgotPassword() {
    const email = document.getElementById('forgotEmail').value.trim();
    const errEl = document.getElementById('forgotError');
    const successEl = document.getElementById('forgotSuccess');
    const btn = document.getElementById('forgotBtn');

    errEl.classList.remove('show');
    successEl.style.display = 'none';

    if (!email) {
        errEl.textContent = 'email required';
        errEl.classList.add('show');
        return;
    }

    btn.disabled = true;
    btn.textContent = 'Sending...';

    const { error } = await sb.auth.resetPasswordForEmail(email, {
        redirectTo: 'https://nekoaichatbot.vercel.app/reset-password.html'
    });

    if (error) {
        errEl.textContent = error.message;
        errEl.classList.add('show');
        btn.disabled = false;
        btn.textContent = 'Send Reset Link';
        return;
    }

    successEl.style.display = 'block';
    btn.textContent = 'Sent!';
    btn.disabled = true;
}

async function handleLogout() {
    await sb.auth.signOut();
    closeProfileModal();
    showToast('Session terminated.');
}

// ========== PROFILE MODAL ==========
async function openProfileModal() {
    if (!currentUser) { openAuthModal(); return; }

    const { data: profile } = await sb
        .from('profiles')
        .select('username')
        .eq('id', currentUser.id)
        .single();

    document.getElementById('profileUsername').textContent =
        profile?.username || currentUser.email.split('@')[0];
    document.getElementById('profileEmail').textContent = currentUser.email;

    try {
        const res = await fetchAPI('/api/usage');
        const data = await res.json();
        document.getElementById('statMessages').textContent = data.count ?? '—';
        document.getElementById('statRemaining').textContent = data.remaining ?? '—';
    } catch {
        document.getElementById('statMessages').textContent = '—';
        document.getElementById('statRemaining').textContent = '—';
    }

    document.getElementById('profileModal').classList.add('active');
}

function closeProfileModal() {
    document.getElementById('profileModal').classList.remove('active');
}

// ========== FETCH HELPER ==========
function fetchAPI(path, options = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (currentToken) headers['Authorization'] = `Bearer ${currentToken}`;
    return fetch(path, { ...options, headers: { ...headers, ...(options.headers || {}) } });
}