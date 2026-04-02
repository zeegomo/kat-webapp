/**
 * spettromiao Mobile Webapp - Centralized Logging Module
 *
 * Collects logs from both frontend (console.*) and backend (/api/logs),
 * stores them in IndexedDB, and syncs to CouchDB when online.
 *
 * Logs accumulate locally even when offline and get uploaded on next sync.
 * Must be loaded BEFORE other scripts so it can intercept console calls.
 */

// ============================================================================
// Configuration
// ============================================================================

const LOG_CONFIG = {
    maxMemoryEntries: 500,      // Ring buffer size in memory
    flushIntervalMs: 10000,     // Flush to IndexedDB every 10s
    maxDbEntries: 5000,         // Max logs kept in IndexedDB (older ones pruned)
    backendPollIntervalMs: 60000, // Fetch backend logs every 60s
    backendMaxLines: 200,       // Max lines to fetch from backend per poll
};

// Log levels (numeric for filtering)
const LOG_LEVELS = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
};

// ============================================================================
// In-memory ring buffer
// ============================================================================

const logBuffer = [];
let flushTimer = null;
let backendPollTimer = null;
let lastBackendTimestamp = null; // Track last fetched backend log timestamp

// Save original console methods before overriding
const originalConsole = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    debug: console.debug.bind(console),
};

// ============================================================================
// Core logging
// ============================================================================

/**
 * Create a structured log entry.
 */
function createLogEntry(level, source, args) {
    const message = args.map(arg => {
        if (arg instanceof Error) return `${arg.message}\n${arg.stack || ''}`;
        if (typeof arg === 'object') {
            try { return JSON.stringify(arg); }
            catch { return String(arg); }
        }
        return String(arg);
    }).join(' ');

    return {
        id: Date.now() + '-' + Math.random().toString(36).substr(2, 6),
        timestamp: new Date().toISOString(),
        level,
        source, // 'frontend' or 'backend'
        message,
    };
}

/**
 * Add a log entry to the in-memory buffer.
 */
function bufferLog(entry) {
    logBuffer.push(entry);
    if (logBuffer.length > LOG_CONFIG.maxMemoryEntries) {
        logBuffer.shift();
    }
}

/**
 * Log at a specific level from frontend code.
 */
function frontendLog(level, ...args) {
    const entry = createLogEntry(level, 'frontend', args);
    bufferLog(entry);
    // Also output to real console for local debugging
    const consoleFn = originalConsole[level] || originalConsole.log;
    consoleFn(...args);
}

// ============================================================================
// Console interception
// ============================================================================

/**
 * Monkey-patch console methods to capture all frontend logs.
 */
function interceptConsole() {
    console.log = (...args) => frontendLog('info', ...args);
    console.info = (...args) => frontendLog('info', ...args);
    console.warn = (...args) => frontendLog('warn', ...args);
    console.error = (...args) => frontendLog('error', ...args);
    console.debug = (...args) => frontendLog('debug', ...args);
}

// ============================================================================
// IndexedDB persistence (uses the logs store from db.js)
// ============================================================================

/**
 * Flush in-memory buffer to IndexedDB.
 */
async function flushToDb() {
    if (logBuffer.length === 0) return;

    try {
        const database = await db.openDB();
        const entries = logBuffer.splice(0); // drain buffer

        const tx = database.transaction('logs', 'readwrite');
        const store = tx.objectStore('logs');

        for (const entry of entries) {
            store.add(entry);
        }

        await new Promise((resolve, reject) => {
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
        });

        // Prune old entries if over limit
        await pruneOldLogs();
    } catch (e) {
        // If DB not ready yet (e.g. during startup), re-add entries
        originalConsole.warn('[logger] flush failed, will retry:', e.message);
    }
}

/**
 * Keep only the most recent maxDbEntries logs.
 */
async function pruneOldLogs() {
    try {
        const database = await db.openDB();
        const tx = database.transaction('logs', 'readwrite');
        const store = tx.objectStore('logs');
        const countReq = store.count();

        await new Promise((resolve, reject) => {
            countReq.onsuccess = async () => {
                const total = countReq.result;
                if (total <= LOG_CONFIG.maxDbEntries) {
                    resolve();
                    return;
                }

                const toDelete = total - LOG_CONFIG.maxDbEntries;
                const index = store.index('timestamp');
                const cursor = index.openCursor(); // ascending = oldest first
                let deleted = 0;

                cursor.onsuccess = (event) => {
                    const c = event.target.result;
                    if (c && deleted < toDelete) {
                        c.delete();
                        deleted++;
                        c.continue();
                    }
                };
                resolve();
            };
            countReq.onerror = () => reject(countReq.error);
        });
    } catch (e) {
        originalConsole.warn('[logger] prune failed:', e.message);
    }
}

// ============================================================================
// Backend log fetching
// ============================================================================

/**
 * Fetch recent logs from the Pi backend and store them locally.
 */
async function fetchBackendLogs() {
    try {
        const apiBase = typeof PI_API_URL !== 'undefined' ? PI_API_URL : '';
        const url = new URL(`${apiBase}/api/logs`, window.location.origin);
        url.searchParams.set('limit', LOG_CONFIG.backendMaxLines);
        if (lastBackendTimestamp) {
            url.searchParams.set('since', lastBackendTimestamp);
        }

        const response = await fetch(url.toString(), {
            signal: AbortSignal.timeout(5000),
        });
        if (!response.ok) return;

        const data = await response.json();
        if (!data.entries || data.entries.length === 0) return;

        // Buffer backend entries
        for (const entry of data.entries) {
            bufferLog({
                id: entry.timestamp + '-be-' + Math.random().toString(36).substr(2, 4),
                timestamp: entry.timestamp,
                level: entry.level,
                source: 'backend',
                message: entry.message,
            });
        }

        // Track last timestamp for incremental fetching
        lastBackendTimestamp = data.entries[data.entries.length - 1].timestamp;
    } catch {
        // Backend unreachable - that's fine, we'll retry next interval
    }
}

// ============================================================================
// Log retrieval (for sync and UI)
// ============================================================================

/**
 * Get all stored logs from IndexedDB, optionally filtered.
 * @param {Object} opts - { since, level, source, limit }
 * @returns {Promise<Array>}
 */
async function getLogs(opts = {}) {
    // Flush first to ensure we have latest
    await flushToDb();

    try {
        const database = await db.openDB();
        const tx = database.transaction('logs', 'readonly');
        const store = tx.objectStore('logs');
        const index = store.index('timestamp');

        return new Promise((resolve, reject) => {
            const results = [];
            const cursorReq = index.openCursor(null, 'prev'); // newest first

            cursorReq.onsuccess = (event) => {
                const cursor = event.target.result;
                if (!cursor) {
                    resolve(results);
                    return;
                }

                const entry = cursor.value;

                // Apply filters
                if (opts.since && entry.timestamp < opts.since) {
                    resolve(results);
                    return;
                }
                if (opts.level && LOG_LEVELS[entry.level] < LOG_LEVELS[opts.level]) {
                    cursor.continue();
                    return;
                }
                if (opts.source && entry.source !== opts.source) {
                    cursor.continue();
                    return;
                }

                results.push(entry);

                if (opts.limit && results.length >= opts.limit) {
                    resolve(results);
                    return;
                }

                cursor.continue();
            };
            cursorReq.onerror = () => reject(cursorReq.error);
        });
    } catch (e) {
        originalConsole.error('[logger] getLogs failed:', e);
        return [];
    }
}

/**
 * Clear all stored logs.
 * @returns {Promise<void>}
 */
async function clearLogs() {
    try {
        const database = await db.openDB();
        const tx = database.transaction('logs', 'readwrite');
        tx.objectStore('logs').clear();
        await new Promise((resolve, reject) => {
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
        });
    } catch (e) {
        originalConsole.warn('[logger] clearLogs failed:', e.message);
    }
}

// ============================================================================
// Lifecycle
// ============================================================================

/**
 * Start the logger: intercept console, begin periodic flush and backend polling.
 */
function startLogger() {
    interceptConsole();

    // Periodic flush to IndexedDB
    flushTimer = setInterval(flushToDb, LOG_CONFIG.flushIntervalMs);

    // Periodic backend log fetching
    backendPollTimer = setInterval(fetchBackendLogs, LOG_CONFIG.backendPollIntervalMs);

    // Also fetch backend logs on startup (with a small delay for app init)
    setTimeout(fetchBackendLogs, 3000);

    // Flush on page unload
    window.addEventListener('beforeunload', () => {
        flushToDb();
    });

    originalConsole.info('[logger] Centralized logging started');
}

/**
 * Stop the logger and flush remaining entries.
 */
function stopLogger() {
    if (flushTimer) {
        clearInterval(flushTimer);
        flushTimer = null;
    }
    if (backendPollTimer) {
        clearInterval(backendPollTimer);
        backendPollTimer = null;
    }
    flushToDb();
}

// ============================================================================
// Public API
// ============================================================================

const logger = {
    // Direct logging methods (bypass console interception)
    debug: (...args) => frontendLog('debug', ...args),
    info: (...args) => frontendLog('info', ...args),
    warn: (...args) => frontendLog('warn', ...args),
    error: (...args) => frontendLog('error', ...args),

    // Retrieval
    getLogs,
    clearLogs,

    // Lifecycle
    start: startLogger,
    stop: stopLogger,
    flush: flushToDb,

    // Access to original console (for cases where you don't want logging)
    _console: originalConsole,

    // Config (exposed for sync module)
    _config: LOG_CONFIG,
};
