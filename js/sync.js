/**
 * spettromiao Mobile Webapp - Browser-to-CouchDB Sync Module
 *
 * Handles synchronization of session data from browser IndexedDB
 * directly to a remote CouchDB server using Bearer token authentication.
 */

// Sync state
let isSyncing = false;
let backgroundSyncEnabled = false;
let syncInterval = null;

// ============================================================================
// Main Sync Functions
// ============================================================================

/**
 * Sync a single session to CouchDB.
 * @param {string} sessionId - Session ID to sync
 * @returns {Promise<Object>} Sync result
 */
async function syncSession(sessionId) {
    const settings = await db.getSettings();

    if (!settings.syncServerUrl) {
        throw new Error('Sync server URL not configured');
    }
    if (!settings.syncToken) {
        throw new Error('Sync token not configured');
    }

    const session = await db.getSession(sessionId);
    if (!session) {
        throw new Error(`Session not found: ${sessionId}`);
    }

    const acquisitions = await db.getAcquisitionsBySession(sessionId);

    // Build CouchDB document
    const doc = {
        type: 'session',
        event: session.event,
        substance: session.substance,
        appearance: session.appearance,
        customAppearance: session.customAppearance,
        substanceDescription: session.substanceDescription,
        notes: session.notes,
        createdAt: session.createdAt,
        syncedAt: new Date().toISOString(),
        acquisitions: [],
        _attachments: {},
    };

    // Add substance photo if present
    if (session.substancePhotoId) {
        const file = await db.getFile(session.substancePhotoId);
        if (file?.data) {
            const base64 = await db.blobToBase64(file.data);
            doc._attachments['substance_photo.jpg'] = {
                content_type: file.mimeType || 'image/jpeg',
                data: base64,
            };
        }
    }

    // Add acquisitions and their files
    for (const acq of acquisitions) {
        // Add acquisition metadata
        doc.acquisitions.push({
            timestamp: acq.timestamp,
            spectrum: acq.spectrum,
            identification: acq.identification,
            laserWavelength: acq.laserWavelength,
            detectionMode: acq.detectionMode,
        });

        // Add files as base64 attachments
        for (const [type, fileId] of Object.entries(acq.fileIds)) {
            if (fileId) {
                const file = await db.getFile(fileId);
                if (file && file.data) {
                    const base64 = await db.blobToBase64(file.data);
                    const ext = getExtension(file.mimeType);
                    const filename = `${acq.timestamp}_${type}.${ext}`;

                    doc._attachments[filename] = {
                        content_type: file.mimeType,
                        data: base64,
                    };
                }
            }
        }

        // Add CSV as text attachment if present
        if (acq.csv) {
            const csvFilename = `${acq.timestamp}_spectrum.csv`;
            doc._attachments[csvFilename] = {
                content_type: 'text/csv',
                data: btoa(acq.csv),
            };
        }
    }

    // POST to CouchDB
    const response = await fetch(`${settings.syncServerUrl}/kat_sessions`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${settings.syncToken}`,
        },
        body: JSON.stringify(doc),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Sync failed (${response.status}): ${errorText}`);
    }

    const result = await response.json();

    // Mark as synced in local DB
    await db.markSynced(sessionId);

    return {
        success: true,
        docId: result.id,
        docRev: result.rev,
    };
}

/**
 * Sync all pending sessions.
 * @returns {Promise<Object>} Results summary
 */
async function syncAll() {
    if (isSyncing) {
        return { synced: 0, failed: 0, errors: ['Sync already in progress'] };
    }

    isSyncing = true;
    const results = { synced: 0, failed: 0, errors: [] };

    try {
        const pending = await db.getPendingSync();

        for (const item of pending) {
            try {
                await syncSession(item.sessionId);
                results.synced++;
            } catch (e) {
                await db.markSyncFailed(item.sessionId, e.message);
                results.failed++;
                results.errors.push(`${item.sessionId}: ${e.message}`);
                console.error(`Sync failed for ${item.sessionId}:`, e);
            }
        }
    } finally {
        isSyncing = false;
    }

    return results;
}

/**
 * Queue the current session for sync and optionally sync immediately.
 * @param {boolean} syncNow - Whether to sync immediately
 * @returns {Promise<Object>}
 */
async function queueCurrentSession(syncNow = false) {
    const session = await db.getCurrentSession();
    if (!session) {
        throw new Error('No current session');
    }

    const acquisitions = await db.getAcquisitionsBySession(session.id);
    if (acquisitions.length === 0) {
        throw new Error('No acquisitions to sync');
    }

    await db.queueForSync(session.id);

    if (syncNow) {
        return syncAll();
    }

    return { queued: true, sessionId: session.id };
}

/**
 * Queue all unsynced sessions for sync.
 * This ensures past sessions that were never queued get synced.
 * @returns {Promise<number>} Number of sessions queued
 */
async function queueAllUnsyncedSessions() {
    const sessions = await db.listSessions();
    let queuedCount = 0;

    for (const session of sessions) {
        // Skip already synced sessions
        if (session.syncedAt) continue;

        // Check if session has acquisitions
        const acquisitions = await db.getAcquisitionsBySession(session.id);
        if (acquisitions.length > 0) {
            await db.queueForSync(session.id);
            queuedCount++;
        }
    }

    return queuedCount;
}

// ============================================================================
// Connection Testing
// ============================================================================

/**
 * Test connection to the CouchDB server.
 * @returns {Promise<Object>} Test result
 */
async function testConnection() {
    const settings = await db.getSettings();

    if (!settings.syncServerUrl) {
        return { success: false, error: 'Server URL not configured' };
    }
    if (!settings.syncToken) {
        return { success: false, error: 'Token not configured' };
    }

    try {
        const response = await fetch(`${settings.syncServerUrl}/kat_sessions`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${settings.syncToken}`,
            },
        });

        if (response.ok) {
            const data = await response.json();
            return {
                success: true,
                message: 'Connection successful',
                docCount: data.total_rows || 0,
            };
        } else {
            return {
                success: false,
                error: `Server returned ${response.status}: ${response.statusText}`,
            };
        }
    } catch (e) {
        return {
            success: false,
            error: `Connection failed: ${e.message}`,
        };
    }
}

// ============================================================================
// Background Sync
// ============================================================================

/**
 * Start background sync.
 * Syncs when online and periodically checks for pending items.
 * @param {number} intervalMs - Check interval in milliseconds (default: 5 minutes)
 */
function startBackgroundSync(intervalMs = 300000) {
    if (backgroundSyncEnabled) {
        return;
    }

    backgroundSyncEnabled = true;

    // Sync when coming online
    window.addEventListener('online', onOnline);

    // Periodic check
    syncInterval = setInterval(async () => {
        if (navigator.onLine) {
            const settings = await db.getSettings();
            if (settings.autoSync && settings.syncServerUrl && settings.syncToken) {
                const pending = await db.getPendingSync();
                if (pending.length > 0) {
                    console.log(`Background sync: ${pending.length} pending items`);
                    await syncAll();
                }
            }
        }
    }, intervalMs);

    console.log('Background sync started');
}

/**
 * Stop background sync.
 */
function stopBackgroundSync() {
    backgroundSyncEnabled = false;
    window.removeEventListener('online', onOnline);

    if (syncInterval) {
        clearInterval(syncInterval);
        syncInterval = null;
    }

    console.log('Background sync stopped');
}

/**
 * Handle online event.
 */
async function onOnline() {
    console.log('Network online - checking for pending sync');
    const settings = await db.getSettings();

    if (settings.autoSync && settings.syncServerUrl && settings.syncToken) {
        const pending = await db.getPendingSync();
        if (pending.length > 0) {
            console.log(`Auto-syncing ${pending.length} pending items`);
            await syncAll();
        }
    }
}

/**
 * Check if background sync is running.
 * @returns {boolean}
 */
function isBackgroundSyncRunning() {
    return backgroundSyncEnabled;
}

/**
 * Check if currently syncing.
 * @returns {boolean}
 */
function isSyncInProgress() {
    return isSyncing;
}

// ============================================================================
// Sync Status
// ============================================================================

/**
 * Get sync status summary.
 * @returns {Promise<Object>}
 */
async function getSyncStatus() {
    const settings = await db.getSettings();
    const pending = await db.getPendingSync();

    // Also count unsynced sessions not yet queued
    let unsyncedCount = 0;
    const sessions = await db.listSessions();
    for (const session of sessions) {
        if (!session.syncedAt) {
            const acquisitions = await db.getAcquisitionsBySession(session.id);
            if (acquisitions.length > 0) {
                // Check if not already in queue
                const inQueue = pending.some(p => p.sessionId === session.id);
                if (!inQueue) {
                    unsyncedCount++;
                }
            }
        }
    }

    return {
        configured: Boolean(settings.syncServerUrl && settings.syncToken),
        autoSync: settings.autoSync,
        pending: pending.length + unsyncedCount,
        syncing: isSyncing,
        backgroundRunning: backgroundSyncEnabled,
        online: navigator.onLine,
    };
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get file extension from MIME type.
 * @param {string} mimeType - MIME type
 * @returns {string}
 */
function getExtension(mimeType) {
    const map = {
        'image/jpeg': 'jpg',
        'image/png': 'png',
        'text/csv': 'csv',
        'application/json': 'json',
        'application/octet-stream': 'bin',
    };
    return map[mimeType] || 'bin';
}

// Export sync functions
const sync = {
    syncSession,
    syncAll,
    queueCurrentSession,
    queueAllUnsyncedSessions,
    testConnection,
    startBackgroundSync,
    stopBackgroundSync,
    isBackgroundSyncRunning,
    isSyncInProgress,
    getSyncStatus,
};
