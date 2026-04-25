require('dotenv').config();
const express = require('express');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const crypto = require('crypto');

const app = express();
const port = process.env.PORT || 3000;

// ========== MULTI API KEY SETUP ==========
const API_KEYS = [
    process.env.GEMINI_API_KEY_1,
    process.env.GEMINI_API_KEY_2,
    process.env.GEMINI_API_KEY_3,  // Tambahin di .env kalau punya
    process.env.GEMINI_API_KEY_4   // Tambahin di .env kalau punya
].filter(Boolean);

if (API_KEYS.length === 0) {
    console.error('ERROR: Tidak ada API key yang valid');
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
        this.globalRequestCount = 0;
        this.circuitBreakerOpen = false;
        this.circuitBreakerResetTime = 0;
    }

    getBestInstance() {
        const now = Date.now();
        
        // Reset cooldown
        this.instances.forEach(inst => {
            if (inst.cooldownUntil && now > inst.cooldownUntil) {
                inst.failCount = 0;
                inst.cooldownUntil = 0;
                console.log(`${inst.name} cooldown selesai`);
            }
        });

        // Sort by: availability > success rate > response time > limit
        const available = this.instances
            .filter(inst => inst.cooldownUntil === 0 && inst.limitRemaining > 0)
            .sort((a, b) => {
                if (a.failCount !== b.failCount) return a.failCount - b.failCount;
                if (a.successRate !== b.successRate) return b.successRate - a.successRate;
                return (a.avgResponseTime || 0) - (b.avgResponseTime || 0);
            });

        if (available.length === 0) {
            // Emergency reset semua
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
        
        // Update avg response time
        if (instance.avgResponseTime === 0) {
            instance.avgResponseTime = responseTime;
        } else {
            instance.avgResponseTime = (instance.avgResponseTime * 0.7) + (responseTime * 0.3);
        }
        
        instance.successRate = Math.min(100, instance.successRate + 5);
    }

    markFailed(instance, errorType) {
        instance.failCount++;
        instance.lastFail = Date.now();
        instance.successRate = Math.max(0, instance.successRate - 15);
        
        const cooldownMinutes = Math.min(Math.pow(2, instance.failCount), 30);
        instance.cooldownUntil = Date.now() + (cooldownMinutes * 60 * 1000);
        
        console.log(`${instance.name} gagal (${errorType}). Cooldown: ${cooldownMinutes} menit`);
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
        const hash = crypto.createHash('md5').update(message + historyLength).digest('hex');
        return hash.substring(0, 16);
    }

    get(message, historyLength) {
        const key = this.getKey(message, historyLength);
        const item = this.cache.get(key);
        
        if (!item) {
            this.misses++;
            return null;
        }
        
        if (Date.now() - item.timestamp > this.ttl) {
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
            const firstKey = this.cache.keys().next().value;
            this.cache.delete(firstKey);
        }
        
        this.cache.set(key, {
            data,
            timestamp: Date.now()
        });
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

    clear() {
        this.cache.clear();
        this.hits = 0;
        this.misses = 0;
    }
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
        
        if (client.window !== windowStart) {
            client.count = 0;
            client.window = windowStart;
        }
        
        if (client.count >= this.maxRequests) {
            return false;
        }
        
        client.count++;
        return true;
    }

    getRemaining(clientId) {
        const client = this.windows.get(clientId);
        if (!client) return this.maxRequests;
        return Math.max(0, this.maxRequests - client.count);
    }
}

const rateLimiter = new RateLimiter(60000, 30); // 30 request per menit

// ========== SYSTEM PROMPT XYROO AI ==========
const SYSTEM_PROMPT = `Kamu adalah Xyroo AI, asisten pribadi yang dibuat oleh Ryuudev (juga dikenal sebagai itsreallyryuu).

TENTANG RYUUDEV:
- Nama: Ryuudev / itsreallyryuu
- Skill: Web developer, programmer, tech enthusiast
- Project: Xyroo AI adalah karya terbaiknya
- Filosofi: "Belajar itu tidak harus mahal, yang penting konsisten dan enjoy"

GAYA BICARA:
1. NGOBROL kayak teman, santai dan asik
2. JANGAN pakai angka romawi atau daftar panjang membosankan
3. JANGAN terlalu formal, pakai bahasa sehari-hari
4. JAWAB singkat tapi padat, maksimal 3-4 paragraf
5. Bisa bercanda dan santai, tapi tetap informatif
6. JANGAN ngasih respons kepotong
7. JANGAN pakai emoji, gunakan ekspresi teks atau tanda baca

FORMAT OUTPUT:
- Gunakan markdown untuk formatting (bold, italic, code block, list)
- Untuk code: gunakan triple backtick dengan bahasa
- Untuk list: gunakan bullet points atau numbered list
- Untuk table: gunakan markdown table kalau perlu

KALAU DITANYA SIAPA PEMBUATMU:
"Aku dibuat oleh Ryuudev (itsreallyryuu)! Dia seorang web developer yang passionate banget sama teknologi. Kalau kamu suka sama project-projectnya, bisa support dia di https://trakteer.id/ryuu_san2/gift biar dia makin semangat bikin project keren lainnya!"

KALAU DITANYA TENTANG RYUUDEV:
"Ryuudev itu web developer yang passionate banget sama teknologi. Dia suka bikin project-project yang bisa bantu orang, kayak Xyroo AI ini. Dia percaya belajar teknologi tidak harus mahal, yang penting konsisten. Kalau mau support perjalanannya, bisa cek https://trakteer.id/ryuu_san2/gift ya!"

KALAU USER BILANG TERIMA KASIH ATAU PUAS:
"Sama-sama! Seneng banget bisa bantu. Kalau kamu suka sama Xyroo AI ini, boleh dong support developer-nya Ryuudev di https://trakteer.id/ryuu_san2/gift? Biar dia makin semangat bikin project keren lainnya!"

PROMOSI TRAKTEER (sewajarnya, jangan spam):
- Kalau user nanya "gimana cara support" atau "donasi ke mana" -> kasih link Trakteer
- Kalau user bilang terima kasih atau puas -> sebut Trakteer sekali
- JANGAN promosiin Trakteer di setiap pesan, cuma di momen yang pas`;

// ========== SMART HISTORY MANAGER ==========
class HistoryManager {
    constructor(maxTokens = 8000) {
        this.maxTokens = maxTokens;
        this.estimatedTokens = 0;
    }

    estimateTokens(text) {
        // Rough estimate: ~4 chars per token
        return Math.ceil(text.length / 4);
    }

    optimizeHistory(history) {
        if (!history || history.length === 0) return [];
        
        let totalTokens = 0;
        const optimized = [];
        
        // Start from newest, keep until limit
        for (let i = history.length - 1; i >= 0; i--) {
            const msg = history[i];
            const text = msg.parts?.[0]?.text || '';
            const tokens = this.estimateTokens(text);
            
            if (totalTokens + tokens > this.maxTokens && optimized.length > 0) {
                break;
            }
            
            totalTokens += tokens;
            optimized.unshift(msg);
        }
        
        return optimized;
    }

    createSystemHistory() {
        return [
            {
                role: 'user',
                parts: [{ text: 'Siapa kamu?' }]
            },
            {
                role: 'model',
                parts: [{ text: 'Halo! Aku Xyroo AI, asisten pribadi buatan Ryuudev (itsreallyryuu). Aku di sini buat nemenin kamu ngobrol, belajar, atau apa aja deh. Mau tanya apa?' }]
            }
        ];
    }
}

const historyManager = new HistoryManager();

// ========== MIDDLEWARE ==========
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

// Request logging
app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        const duration = Date.now() - start;
        console.log(`${req.method} ${req.path} - ${res.statusCode} - ${duration}ms`);
    });
    next();
});

// ========== ENDPOINTS ==========

// Health check
app.get('/api/health', (req, res) => {
    const status = keyManager.getStatus();
    const totalRemaining = status.reduce((sum, s) => sum + (s.status === 'active' ? s.remaining : 0), 0);
    
    res.json({
        status: 'healthy',
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        keys: status,
        totalRemaining,
        cache: responseCache.getStats(),
        timestamp: new Date().toISOString()
    });
});

// Cache stats
app.get('/api/cache', (req, res) => {
    res.json(responseCache.getStats());
});

// Clear cache
app.delete('/api/cache', (req, res) => {
    responseCache.clear();
    res.json({ success: true, message: 'Cache cleared' });
});

// Streaming chat endpoint
app.post('/api/chat/stream', async (req, res) => {
    const clientId = req.ip || req.headers['x-forwarded-for'] || 'unknown';
    
    if (!rateLimiter.isAllowed(clientId)) {
        return res.status(429).json({
            success: false,
            error: 'Terlalu banyak request. Coba lagi dalam 1 menit.'
        });
    }

    const { message, history } = req.body;
    
    if (!message) {
        return res.status(400).json({ error: 'Pesan tidak boleh kosong' });
    }

    // Check cache
    const cached = responseCache.get(message, history?.length || 0);
    if (cached) {
        return res.json({
            success: true,
            reply: cached,
            cached: true,
            usedKey: 'cache',
            usedModel: 'cached'
        });
    }

    // Set up SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const modelsToTry = [
        'gemini-2.5-flash-lite',
        'gemini-2.0-flash',
        'gemini-2.0-flash-001',
        'gemini-2.5-flash'
    ];

    let fullResponse = '';
    let success = false;

    for (let attempt = 0; attempt < Math.min(API_KEYS.length * 2, 6); attempt++) {
        const instance = keyManager.getBestInstance();
        const startTime = Date.now();
        
        for (const modelName of modelsToTry) {
            try {
                console.log(`[STREAM] ${instance.name} | ${modelName} | "${message.substring(0, 40)}..."`);
                
                const model = instance.genAI.getGenerativeModel({
                    model: modelName,
                    systemInstruction: SYSTEM_PROMPT
                });

                const chatHistory = historyManager.createSystemHistory();
                const optimizedHistory = historyManager.optimizeHistory(history);
                
                if (optimizedHistory.length > 0) {
                    chatHistory.push(...optimizedHistory);
                }

                const chat = model.startChat({
                    history: chatHistory,
                    generationConfig: {
                        maxOutputTokens: 4096,
                        temperature: 0.9,
                        topP: 0.95,
                        topK: 40
                    }
                });

                const result = await chat.sendMessageStream(message);
                
                res.write(`data: ${JSON.stringify({ type: 'start', key: instance.name, model: modelName })}\n\n`);

                for await (const chunk of result.stream) {
                    const text = chunk.text();
                    if (text) {
                        fullResponse += text;
                        res.write(`data: ${JSON.stringify({ type: 'chunk', text })}\n\n`);
                    }
                }

                const responseTime = Date.now() - startTime;
                keyManager.markSuccess(instance, responseTime);
                
                // Cache successful response
                responseCache.set(message, history?.length || 0, fullResponse);
                
                res.write(`data: ${JSON.stringify({ 
                    type: 'done', 
                    fullResponse,
                    usedKey: instance.name,
                    usedModel: modelName,
                    responseTime
                })}\n\n`);
                
                success = true;
                res.end();
                return;

            } catch (err) {
                console.log(`[STREAM ERROR] ${instance.name} | ${modelName}: ${err.message}`);
                
                if (err.message.includes('quota') || 
                    err.message.includes('rate limit') ||
                    err.message.includes('429') ||
                    err.message.includes('exhausted')) {
                    keyManager.markFailed(instance, 'quota');
                    break;
                }
                
                if (err.message.includes('safety') || err.message.includes('blocked')) {
                    res.write(`data: ${JSON.stringify({ 
                        type: 'error', 
                        error: 'Pesan ini diblokir oleh filter keamanan. Coba ubah kata-katanya.'
                    })}\n\n`);
                    res.end();
                    return;
                }
            }
        }
    }

    if (!success) {
        res.write(`data: ${JSON.stringify({ 
            type: 'error', 
            error: 'Semua API key sedang limit atau cooldown. Coba lagi dalam beberapa menit ya!'
        })}\n\n`);
        res.end();
    }
});

// Regular chat endpoint (non-streaming)
app.post('/api/chat', async (req, res) => {
    const clientId = req.ip || req.headers['x-forwarded-for'] || 'unknown';
    
    if (!rateLimiter.isAllowed(clientId)) {
        return res.status(429).json({
            success: false,
            error: 'Terlalu banyak request. Coba lagi dalam 1 menit.'
        });
    }

    const { message, history } = req.body;
    
    if (!message) {
        return res.status(400).json({ error: 'Pesan tidak boleh kosong' });
    }

    // Check cache
    const cached = responseCache.get(message, history?.length || 0);
    if (cached) {
        return res.json({
            success: true,
            reply: cached,
            cached: true,
            usedKey: 'cache',
            usedModel: 'cached'
        });
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
                console.log(`[API] ${instance.name} | ${modelName} | "${message.substring(0, 40)}..."`);
                
                const model = instance.genAI.getGenerativeModel({
                    model: modelName,
                    systemInstruction: SYSTEM_PROMPT
                });

                const chatHistory = historyManager.createSystemHistory();
                const optimizedHistory = historyManager.optimizeHistory(history);
                
                if (optimizedHistory.length > 0) {
                    chatHistory.push(...optimizedHistory);
                }

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
                const response = await result.response;
                const text = response.text();

                const responseTime = Date.now() - startTime;
                keyManager.markSuccess(instance, responseTime);
                
                // Cache successful response
                responseCache.set(message, history?.length || 0, text);

                return res.json({
                    success: true,
                    reply: text,
                    usedKey: instance.name,
                    usedModel: modelName,
                    responseTime,
                    limitRemaining: instance.limitRemaining
                });

            } catch (err) {
                console.log(`[API ERROR] ${instance.name} | ${modelName}: ${err.message}`);
                
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
                        error: 'Pesan ini diblokir oleh filter keamanan. Coba ubah kata-katanya.'
                    });
                }
            }
        }
    }

    res.status(503).json({
        success: false,
        error: 'Semua API key sedang limit atau cooldown. Coba lagi dalam beberapa menit ya!',
        retryAfter: 60
    });
});

// Limit status
app.get('/api/limit', (req, res) => {
    res.json({
        totalRemaining: keyManager.getStatus().reduce((sum, s) => sum + s.remaining, 0),
        totalKeys: API_KEYS.length,
        keys: keyManager.getStatus(),
        cache: responseCache.getStats()
    });
});

// ========== START SERVER ==========
app.listen(port, () => {
    console.log(`
╔══════════════════════════════════════════════════╗
║           Xyroo AI Server v2.0                   ║
║           Powered by Ryuudev                     ║
╠══════════════════════════════════════════════════╣
║  URL: http://localhost:${port}                      ║
║  API Keys: ${API_KEYS.length} active                              ║
║  Features:                                         ║
║    ✓ Smart key rotation                           ║
║    ✓ Response caching                             ║
║    ✓ Rate limiting                                ║
║    ✓ Streaming support                            ║
║    ✓ Circuit breaker                              ║
╚══════════════════════════════════════════════════╝
    `);
});