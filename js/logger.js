/**
 * spettromiao Mobile Webapp - Centralized Logging Module
 *
 * Captures frontend console.* calls into an in-memory ring buffer and
 * periodically fetches backend logs via /api/logs. Both are merged into
 * a single timeline accessible through logger.getLogs().
 *
 * Must be loaded BEFORE other scripts so it can intercept console calls.
 */

const LOG_BUFFER_SIZE = 1000;
const BACKEND_POLL_MS = 60000;

const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };

const _logBuffer = [];
let _backendPollTimer = null;
let _lastBackendTs = null;

// Save originals before patching
const _console = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    debug: console.debug.bind(console),
};

function _formatArgs(args) {
    return args.map(arg => {
        if (arg instanceof Error) return `${arg.message}\n${arg.stack || ''}`;
        if (typeof arg === 'object') {
            try { return JSON.stringify(arg); } catch { return String(arg); }
        }
        return String(arg);
    }).join(' ');
}

function _pushEntry(level, source, message) {
    _logBuffer.push({
        timestamp: new Date().toISOString(),
        level,
        source,
        message,
    });
    if (_logBuffer.length > LOG_BUFFER_SIZE) _logBuffer.shift();
}

function _frontendLog(level, ...args) {
    _pushEntry(level, 'frontend', _formatArgs(args));
    (_console[level] || _console.log)(...args);
}

// Monkey-patch console
console.log = (...args) => _frontendLog('info', ...args);
console.info = (...args) => _frontendLog('info', ...args);
console.warn = (...args) => _frontendLog('warn', ...args);
console.error = (...args) => _frontendLog('error', ...args);
console.debug = (...args) => _frontendLog('debug', ...args);

/**
 * Fetch recent backend logs and merge into the buffer.
 */
async function _fetchBackendLogs() {
    try {
        const apiBase = typeof PI_API_URL !== 'undefined' ? PI_API_URL : '';
        const url = new URL(`${apiBase}/api/logs`, window.location.origin);
        url.searchParams.set('limit', '200');
        if (_lastBackendTs) url.searchParams.set('since', _lastBackendTs);

        const res = await fetch(url.toString(), { signal: AbortSignal.timeout(5000) });
        if (!res.ok) return;

        const data = await res.json();
        if (!data.entries?.length) return;

        for (const e of data.entries) {
            _pushEntry(e.level, 'backend', e.message);
        }
        _lastBackendTs = data.entries[data.entries.length - 1].timestamp;
    } catch {
        // Backend unreachable, will retry next interval
    }
}

// ============================================================================
// Public API
// ============================================================================

const logger = {
    debug: (...args) => _frontendLog('debug', ...args),
    info: (...args) => _frontendLog('info', ...args),
    warn: (...args) => _frontendLog('warn', ...args),
    error: (...args) => _frontendLog('error', ...args),

    /**
     * Get buffered logs, optionally filtered.
     * @param {Object} opts - { level, source, limit }
     * @returns {Array} Log entries (newest last)
     */
    getLogs(opts = {}) {
        let entries = _logBuffer;
        if (opts.source) entries = entries.filter(e => e.source === opts.source);
        if (opts.level) entries = entries.filter(e => LOG_LEVELS[e.level] >= LOG_LEVELS[opts.level]);
        if (opts.limit) entries = entries.slice(-opts.limit);
        return entries;
    },

    /** Clear the in-memory buffer. */
    clear() { _logBuffer.length = 0; },

    /** Start periodic backend log polling. */
    start() {
        if (_backendPollTimer) return;
        _backendPollTimer = setInterval(_fetchBackendLogs, BACKEND_POLL_MS);
        setTimeout(_fetchBackendLogs, 3000); // initial fetch after app init
        _console.info('[logger] started');
    },

    /** Stop backend log polling. */
    stop() {
        if (_backendPollTimer) {
            clearInterval(_backendPollTimer);
            _backendPollTimer = null;
        }
    },

    /** Trigger an immediate backend log fetch. */
    fetchBackendLogs: _fetchBackendLogs,

    /** Access original console (unpatched). */
    _console,
};
