require('dotenv').config();
const express = require('express');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const port = process.env.PORT || 3000;

// ========== SUPABASE ==========
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ========== MULTI API KEY SETUP ==========
const API_KEYS = [
    process.env.GEMINI_API_KEY_1,
    process.env.GEMINI_API_KEY_2,
    process.env.GEMINI_API_KEY_3,
    process.env.GEMINI_API_KEY_4,
    process.env.GEMINI_API_KEY_5
].filter(Boolean);

if (API_KEYS.length === 0) {
    console.error('ERROR: No valid API keys found');
    process.exit(1);
}

// ========== SMART KEY MANAGER ==========
class SmartKeyManager {
    constructor(keys) {
        this.instances = keys.map((key, index) => ({
            key,
            genAI: new GoogleGenerativeAI(key),
            name: `Key-${index + 1}`,
            failCount: 0,
            lastFail: null,
            totalUsed: 0,
            limitRemaining: 1500,
            cooldownUntil: 0,
            successRate: 100,
            avgResponseTime: 0,
            lastUsed: 0
        }));
        this.currentIndex = 0;
    }

    getBestInstance() {
        const now = Date.now();
        this.instances.forEach(inst => {
            if (inst.cooldownUntil && now > inst.cooldownUntil) {
                inst.failCount = 0;
                inst.cooldownUntil = 0;
                console.log(`${inst.name} cooldown finished`);
            }
        });

        const available = this.instances
            .filter(inst => inst.cooldownUntil === 0 && inst.limitRemaining > 0)
            .sort((a, b) => {
                if (a.failCount !== b.failCount) return a.failCount - b.failCount;
                if (a.successRate !== b.successRate) return b.successRate - a.successRate;
                return (a.avgResponseTime || 0) - (b.avgResponseTime || 0);
            });

        if (available.length === 0) {
            this.instances.forEach(inst => {
                inst.failCount = 0;
                inst.cooldownUntil = 0;
                inst.limitRemaining = Math.max(inst.limitRemaining, 100);
            });
            return this.instances[0];
        }
        return available[0];
    }

    markSuccess(instance, responseTime) {
        instance.failCount = Math.max(0, instance.failCount - 1);
        instance.totalUsed++;
        instance.limitRemaining--;
        instance.lastUsed = Date.now();
        instance.avgResponseTime = instance.avgResponseTime === 0
            ? responseTime
            : (instance.avgResponseTime * 0.7) + (responseTime * 0.3);
        instance.successRate = Math.min(100, instance.successRate + 5);
    }

    markFailed(instance, errorType) {
        instance.failCount++;
        instance.lastFail = Date.now();
        instance.successRate = Math.max(0, instance.successRate - 15);
        const cooldownMinutes = Math.min(Math.pow(2, instance.failCount), 30);
        instance.cooldownUntil = Date.now() + (cooldownMinutes * 60 * 1000);
        console.log(`${instance.name} failed (${errorType}). Cooldown: ${cooldownMinutes}m`);
    }

    getStatus() {
        return this.instances.map(inst => ({
            name: inst.name,
            status: inst.cooldownUntil > Date.now() ? 'cooldown' : (inst.limitRemaining > 0 ? 'active' : 'limit'),
            remaining: inst.limitRemaining,
            used: inst.totalUsed,
            successRate: inst.successRate + '%',
            avgResponseTime: Math.round(inst.avgResponseTime) + 'ms',
            failCount: inst.failCount
        }));
    }
}

const keyManager = new SmartKeyManager(API_KEYS);

// ========== RESPONSE CACHE ==========
class ResponseCache {
    constructor(maxSize = 100, ttlMinutes = 60) {
        this.cache = new Map();
        this.maxSize = maxSize;
        this.ttl = ttlMinutes * 60 * 1000;
        this.hits = 0;
        this.misses = 0;
    }

    getKey(message, historyLength) {
        return crypto.createHash('md5').update(message + historyLength).digest('hex').substring(0, 16);
    }

    get(message, historyLength) {
        const key = this.getKey(message, historyLength);
        const item = this.cache.get(key);
        if (!item || Date.now() - item.timestamp > this.ttl) {
            this.cache.delete(key);
            this.misses++;
            return null;
        }
        this.hits++;
        return item.data;
    }

    set(message, historyLength, data) {
        const key = this.getKey(message, historyLength);
        if (this.cache.size >= this.maxSize) {
            this.cache.delete(this.cache.keys().next().value);
        }
        this.cache.set(key, { data, timestamp: Date.now() });
    }

    getStats() {
        const total = this.hits + this.misses;
        return {
            size: this.cache.size,
            hits: this.hits,
            misses: this.misses,
            hitRate: total > 0 ? Math.round((this.hits / total) * 100) + '%' : '0%'
        };
    }

    clear() { this.cache.clear(); this.hits = 0; this.misses = 0; }
}

const responseCache = new ResponseCache();

// ========== RATE LIMITER ==========
class RateLimiter {
    constructor(windowMs = 60000, maxRequests = 30) {
        this.windows = new Map();
        this.windowMs = windowMs;
        this.maxRequests = maxRequests;
    }

    isAllowed(clientId) {
        const now = Date.now();
        const windowStart = Math.floor(now / this.windowMs) * this.windowMs;
        if (!this.windows.has(clientId)) {
            this.windows.set(clientId, { count: 0, window: windowStart });
        }
        const client = this.windows.get(clientId);
        if (client.window !== windowStart) { client.count = 0; client.window = windowStart; }
        if (client.count >= this.maxRequests) return false;
        client.count++;
        return true;
    }
}

const rateLimiter = new RateLimiter(60000, 30);

// ========== SYSTEM PROMPT ==========
const SYSTEM_PROMPT = `You are Neko AI, a smart and friendly AI assistant created by Adann Dev (also known as itsreallyryuu on GitHub).

ABOUT THE CREATOR:
- Name: Adann Dev / itsreallyryuu (GitHub)
- Role: Web developer and tech enthusiast
- Project: Neko AI is one of his proudest creations
- Philosophy: "Learning doesn't have to be expensive, just be consistent and enjoy the process"

PERSONALITY & TONE:
1. Talk like a friendly companion — casual, warm, and fun
2. Avoid overly formal language; keep it natural and approachable
3. Be concise but informative — max 3-4 paragraphs unless detail is needed
4. Light humor is welcome, but stay helpful
5. Never cut off responses mid-sentence
6. No emoji — use punctuation and text expression instead

OUTPUT FORMAT:
- Use markdown for formatting (bold, italic, code blocks, lists)
- For code: use triple backtick with language name
- For lists: use bullet points or numbered lists
- For tables: use markdown tables when appropriate

IF ASKED WHO MADE YOU:
"I was made by Adann Dev (itsreallyryuu on GitHub)! He's a passionate web developer who loves building things that actually help people. If you enjoy using Neko AI, you can support him at https://trakteer.id/ryuu_san2/gift — it means a lot!"

IF ASKED ABOUT ADANN DEV:
"Adann Dev is a web developer who genuinely loves technology and building useful projects. He believes learning tech shouldn't be expensive — just consistent and enjoyable. You can find his work on GitHub at itsreallyryuu, and support him at https://trakteer.id/ryuu_san2/gift!"

IF USER SAYS THANK YOU OR IS SATISFIED:
"Glad I could help! If you're enjoying Neko AI, consider supporting Adann Dev at https://trakteer.id/ryuu_san2/gift — he'd really appreciate it!"

TRAKTEER PROMOTION (natural, never spammy):
- Only mention when user asks how to support or says thanks
- Never promote in every message`;

// ========== HISTORY MANAGER ==========
class HistoryManager {
    constructor(maxTokens = 8000) { this.maxTokens = maxTokens; }

    estimateTokens(text) { return Math.ceil(text.length / 4); }

    optimizeHistory(history) {
        if (!history || history.length === 0) return [];
        let totalTokens = 0;
        const optimized = [];
        for (let i = history.length - 1; i >= 0; i--) {
            const text = history[i].parts?.[0]?.text || '';
            const tokens = this.estimateTokens(text);
            if (totalTokens + tokens > this.maxTokens && optimized.length > 0) break;
            totalTokens += tokens;
            optimized.unshift(history[i]);
        }
        return optimized;
    }

    createSystemHistory() {
        return [
            { role: 'user', parts: [{ text: 'Who are you?' }] },
            { role: 'model', parts: [{ text: "Hey! I'm Neko AI, a smart assistant made by Adann Dev (itsreallyryuu on GitHub). I'm here to help you with anything — coding, learning, or just chatting. What's on your mind?" }] }
        ];
    }
}

const historyManager = new HistoryManager();

// ========== MIDDLEWARE ==========
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        console.log(`${req.method} ${req.path} - ${res.statusCode} - ${Date.now() - start}ms`);
    });
    next();
});

// ========== AUTH MIDDLEWARE ==========
async function verifyToken(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        req.user = null;
        return next();
    }
    const token = authHeader.split(' ')[1];
    try {
        const { data: { user }, error } = await supabase.auth.getUser(token);
        req.user = error ? null : user;
    } catch {
        req.user = null;
    }
    next();
}

// ========== USAGE LIMIT HELPERS ==========
const GUEST_LIMIT = 3;
const USER_LIMIT = 100;

async function checkAndIncrementUsage(userId) {
    const today = new Date().toISOString().split('T')[0];

    const { data, error } = await supabase
        .from('usage_limits')
        .select('*')
        .eq('user_id', userId)
        .eq('date', today)
        .single();

    if (error && error.code === 'PGRST116') {
        // No row yet, create it
        await supabase.from('usage_limits').insert({
            user_id: userId,
            date: today,
            message_count: 1
        });
        return { allowed: true, count: 1, remaining: USER_LIMIT - 1 };
    }

    if (data.message_count >= USER_LIMIT) {
        return { allowed: false, count: data.message_count, remaining: 0 };
    }

    await supabase
        .from('usage_limits')
        .update({ message_count: data.message_count + 1 })
        .eq('user_id', userId)
        .eq('date', today);

    return {
        allowed: true,
        count: data.message_count + 1,
        remaining: USER_LIMIT - (data.message_count + 1)
    };
}

async function getUserUsage(userId) {
    const today = new Date().toISOString().split('T')[0];
    const { data } = await supabase
        .from('usage_limits')
        .select('message_count')
        .eq('user_id', userId)
        .eq('date', today)
        .single();
    const count = data?.message_count || 0;
    return { count, remaining: USER_LIMIT - count };
}

// ========== ENDPOINTS ==========

// Health check
app.get('/api/health', (req, res) => {
    res.json({
        status: 'healthy',
        uptime: process.uptime(),
        keys: keyManager.getStatus(),
        cache: responseCache.getStats(),
        timestamp: new Date().toISOString()
    });
});

// ========== USAGE ENDPOINT ==========
app.get('/api/usage', verifyToken, async (req, res) => {
    if (!req.user) {
        return res.json({ isGuest: true, limit: GUEST_LIMIT });
    }
    const usage = await getUserUsage(req.user.id);
    res.json({
        isGuest: false,
        limit: USER_LIMIT,
        count: usage.count,
        remaining: usage.remaining
    });
});

// ========== HISTORY ENDPOINTS ==========

// Get all conversations
app.get('/api/conversations', verifyToken, async (req, res) => {
    if (!req.user) return res.json({ conversations: [] });

    const { data, error } = await supabase
        .from('conversations')
        .select('id, title, created_at, updated_at')
        .eq('user_id', req.user.id)
        .order('updated_at', { ascending: false });

    if (error) return res.status(500).json({ error: error.message });
    res.json({ conversations: data || [] });
});

// Create conversation
app.post('/api/conversations', verifyToken, async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const { title } = req.body;
    const { data, error } = await supabase
        .from('conversations')
        .insert({ user_id: req.user.id, title: title || 'New Chat' })
        .select()
        .single();

    if (error) return res.status(500).json({ error: error.message });
    res.json({ conversation: data });
});

// Rename conversation
app.patch('/api/conversations/:id', verifyToken, async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const { title } = req.body;
    const { error } = await supabase
        .from('conversations')
        .update({ title, updated_at: new Date().toISOString() })
        .eq('id', req.params.id)
        .eq('user_id', req.user.id);

    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
});

// Delete conversation
app.delete('/api/conversations/:id', verifyToken, async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const { error } = await supabase
        .from('conversations')
        .delete()
        .eq('id', req.params.id)
        .eq('user_id', req.user.id);

    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
});

// Get messages in a conversation
app.get('/api/conversations/:id/messages', verifyToken, async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const { data, error } = await supabase
        .from('messages')
        .select('id, role, content, created_at')
        .eq('conversation_id', req.params.id)
        .order('created_at', { ascending: true });

    if (error) return res.status(500).json({ error: error.message });
    res.json({ messages: data || [] });
});

// Save message
app.post('/api/conversations/:id/messages', verifyToken, async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const { role, content } = req.body;
    const { error } = await supabase
        .from('messages')
        .insert({ conversation_id: req.params.id, role, content });

    // Update conversation updated_at
    await supabase
        .from('conversations')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', req.params.id)
        .eq('user_id', req.user.id);

    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
});

// ========== CHAT ENDPOINT ==========
app.post('/api/chat', verifyToken, async (req, res) => {
    const clientId = req.ip || req.headers['x-forwarded-for'] || 'unknown';

    if (!rateLimiter.isAllowed(clientId)) {
        return res.status(429).json({
            success: false,
            error: 'Too many requests. Please wait a moment.'
        });
    }

    const { message, history, conversationId } = req.body;
    if (!message) return res.status(400).json({ error: 'Message cannot be empty' });

    // Check usage limit
    if (req.user) {
        const usage = await checkAndIncrementUsage(req.user.id);
        if (!usage.allowed) {
            return res.status(429).json({
                success: false,
                error: "You've reached your 100 messages/day limit. Come back tomorrow!",
                limitReached: true
            });
        }
    }
    // Guest limit is handled client-side via localStorage

    // Check cache
    const cached = responseCache.get(message, history?.length || 0);
    if (cached) {
        return res.json({ success: true, reply: cached, cached: true });
    }

    const modelsToTry = [
        'gemini-2.5-flash-lite',
        'gemini-2.0-flash',
        'gemini-2.0-flash-001',
        'gemini-2.5-flash'
    ];

    for (let attempt = 0; attempt < Math.min(API_KEYS.length * 2, 6); attempt++) {
        const instance = keyManager.getBestInstance();
        const startTime = Date.now();

        for (const modelName of modelsToTry) {
            try {
                console.log(`[CHAT] ${instance.name} | ${modelName} | "${message.substring(0, 40)}..."`);

                const model = instance.genAI.getGenerativeModel({
                    model: modelName,
                    systemInstruction: SYSTEM_PROMPT
                });

                const chatHistory = historyManager.createSystemHistory();
                const optimizedHistory = historyManager.optimizeHistory(history);
                if (optimizedHistory.length > 0) chatHistory.push(...optimizedHistory);

                const chat = model.startChat({
                    history: chatHistory,
                    generationConfig: {
                        maxOutputTokens: 4096,
                        temperature: 0.9,
                        topP: 0.95,
                        topK: 40
                    }
                });

                const result = await chat.sendMessage(message);
                const text = result.response.text();
                const responseTime = Date.now() - startTime;

                keyManager.markSuccess(instance, responseTime);
                responseCache.set(message, history?.length || 0, text);

                // Save messages to DB if logged in and conversationId provided
                if (req.user && conversationId) {
                    await supabase.from('messages').insert([
                        { conversation_id: conversationId, role: 'user', content: message },
                        { conversation_id: conversationId, role: 'assistant', content: text }
                    ]);
                    await supabase
                        .from('conversations')
                        .update({ updated_at: new Date().toISOString() })
                        .eq('id', conversationId)
                        .eq('user_id', req.user.id);
                }

                // Get updated usage
                let usageInfo = null;
                if (req.user) {
                    usageInfo = await getUserUsage(req.user.id);
                }

                return res.json({
                    success: true,
                    reply: text,
                    usedKey: instance.name,
                    usedModel: modelName,
                    responseTime,
                    usage: usageInfo
                });

            } catch (err) {
                console.log(`[ERROR] ${instance.name} | ${modelName}: ${err.message}`);

                if (err.message.includes('quota') ||
                    err.message.includes('rate limit') ||
                    err.message.includes('429') ||
                    err.message.includes('exhausted')) {
                    keyManager.markFailed(instance, 'quota');
                    break;
                }

                if (err.message.includes('safety') || err.message.includes('blocked')) {
                    return res.status(400).json({
                        success: false,
                        error: 'This message was blocked by the safety filter. Try rephrasing it.'
                    });
                }
            }
        }
    }

    res.status(503).json({
        success: false,
        error: 'All API keys are currently on cooldown. Please try again in a few minutes.'
    });
});

// ========== START SERVER ==========
app.listen(port, () => {
    console.log(`Neko AI server running on port ${port}`);
    console.log(`API Keys loaded: ${API_KEYS.length}`);
});