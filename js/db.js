/**
 * spettromiao Mobile Webapp - IndexedDB Storage Layer
 *
 * Provides persistent storage for sessions, acquisitions, files, and settings.
 * All data is stored locally in the browser and synced to CouchDB on demand.
 */

const DB_NAME = 'spettromiao-mobile';
const DB_VERSION = 2;

// Store names
const STORES = {
    sessions: 'sessions',
    acquisitions: 'acquisitions',
    files: 'files',
    settings: 'settings',
    syncQueue: 'syncQueue',
    library: 'library',
};

let dbInstance = null;

// ============================================================================
// Database Initialization
// ============================================================================

/**
 * Open the IndexedDB database.
 * @returns {Promise<IDBDatabase>}
 */
async function openDB() {
    if (dbInstance) {
        return dbInstance;
    }

    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = () => {
            console.error('Failed to open IndexedDB:', request.error);
            reject(request.error);
        };

        request.onsuccess = () => {
            dbInstance = request.result;
            resolve(dbInstance);
        };

        request.onupgradeneeded = (event) => {
            const db = event.target.result;

            // Sessions store
            if (!db.objectStoreNames.contains(STORES.sessions)) {
                const sessions = db.createObjectStore(STORES.sessions, { keyPath: 'id' });
                sessions.createIndex('createdAt', 'createdAt');
                sessions.createIndex('syncedAt', 'syncedAt');
                sessions.createIndex('isCurrent', 'isCurrent');
            }

            // Acquisitions store
            if (!db.objectStoreNames.contains(STORES.acquisitions)) {
                const acquisitions = db.createObjectStore(STORES.acquisitions, { keyPath: 'id' });
                acquisitions.createIndex('sessionId', 'sessionId');
                acquisitions.createIndex('timestamp', 'timestamp');
            }

            // Files store (for binary blobs)
            if (!db.objectStoreNames.contains(STORES.files)) {
                const files = db.createObjectStore(STORES.files, { keyPath: 'id' });
                files.createIndex('acquisitionId', 'acquisitionId');
            }

            // Settings store (singleton)
            if (!db.objectStoreNames.contains(STORES.settings)) {
                db.createObjectStore(STORES.settings, { keyPath: 'id' });
            }

            // Sync queue store
            if (!db.objectStoreNames.contains(STORES.syncQueue)) {
                const syncQueue = db.createObjectStore(STORES.syncQueue, { keyPath: 'id' });
                syncQueue.createIndex('status', 'status');
                syncQueue.createIndex('sessionId', 'sessionId');
            }

            // Library store (for reference spectra)
            if (!db.objectStoreNames.contains(STORES.library)) {
                db.createObjectStore(STORES.library, { keyPath: 'id' });
            }
        };
    });
}

/**
 * Generate a UUID v4.
 * @returns {string}
 */
function generateId() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

/**
 * Clear all data from the database.
 * @returns {Promise<void>}
 */
async function clearAllData() {
    const db = await openDB();
    const tx = db.transaction(Object.values(STORES), 'readwrite');

    for (const storeName of Object.values(STORES)) {
        tx.objectStore(storeName).clear();
    }

    return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

// ============================================================================
// Sessions
// ============================================================================

/**
 * Create a new session.
 * @param {Object} metadata - Session metadata (event, substance, etc.)
 * @returns {Promise<Object>} The created session
 */
async function createSession(metadata = {}) {
    const db = await openDB();

    // Mark any existing current session as not current
    const existingCurrent = await getCurrentSession();
    if (existingCurrent) {
        existingCurrent.isCurrent = null;
        await updateSession(existingCurrent.id, { isCurrent: null });
    }

    const session = {
        id: generateId(),
        event: metadata.event || '',
        substance: metadata.substance || '',
        appearance: metadata.appearance || '',
        customAppearance: metadata.customAppearance || '',
        substanceDescription: metadata.substanceDescription || '',
        notes: metadata.notes || '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        syncedAt: null,
        isCurrent: 1,  // Use number instead of boolean (IndexedDB doesn't allow boolean keys)
        acquisitionIds: [],
        substancePhotoId: null,  // File ID for substance photo (pill/capsule/paper)
    };

    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORES.sessions, 'readwrite');
        const store = tx.objectStore(STORES.sessions);
        const request = store.add(session);

        request.onsuccess = () => resolve(session);
        request.onerror = () => reject(request.error);
    });
}

/**
 * Get a session by ID.
 * @param {string} id - Session ID
 * @returns {Promise<Object|null>}
 */
async function getSession(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORES.sessions, 'readonly');
        const store = tx.objectStore(STORES.sessions);
        const request = store.get(id);

        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
    });
}

/**
 * Get the current active session.
 * @returns {Promise<Object|null>}
 */
async function getCurrentSession() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORES.sessions, 'readonly');
        const store = tx.objectStore(STORES.sessions);
        const index = store.index('isCurrent');
        const request = index.get(1);  // Use number key (IndexedDB doesn't allow boolean keys)

        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
    });
}

/**
 * Update a session.
 * @param {string} id - Session ID
 * @param {Object} updates - Fields to update
 * @returns {Promise<Object>}
 */
async function updateSession(id, updates) {
    const db = await openDB();
    const session = await getSession(id);
    if (!session) {
        throw new Error(`Session not found: ${id}`);
    }

    const updatedSession = {
        ...session,
        ...updates,
        updatedAt: new Date().toISOString(),
    };

    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORES.sessions, 'readwrite');
        const store = tx.objectStore(STORES.sessions);
        const request = store.put(updatedSession);

        request.onsuccess = () => resolve(updatedSession);
        request.onerror = () => reject(request.error);
    });
}

/**
 * Delete a session and all its acquisitions/files.
 * @param {string} id - Session ID
 * @returns {Promise<void>}
 */
async function deleteSession(id) {
    const db = await openDB();
    const session = await getSession(id);
    if (!session) return;

    // Delete all acquisitions and their files
    for (const acqId of session.acquisitionIds) {
        await deleteAcquisition(acqId);
    }

    // Delete from sync queue if present
    const tx = db.transaction([STORES.sessions, STORES.syncQueue], 'readwrite');
    tx.objectStore(STORES.sessions).delete(id);

    // Delete sync queue entries for this session
    const syncStore = tx.objectStore(STORES.syncQueue);
    const syncIndex = syncStore.index('sessionId');
    const syncRequest = syncIndex.openCursor(IDBKeyRange.only(id));

    syncRequest.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
            cursor.delete();
            cursor.continue();
        }
    };

    return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

/**
 * List all sessions.
 * @returns {Promise<Array>}
 */
async function listSessions() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORES.sessions, 'readonly');
        const store = tx.objectStore(STORES.sessions);
        const request = store.getAll();

        request.onsuccess = () => {
            // Sort by createdAt descending
            const sessions = request.result.sort((a, b) =>
                new Date(b.createdAt) - new Date(a.createdAt)
            );
            resolve(sessions);
        };
        request.onerror = () => reject(request.error);
    });
}

// ============================================================================
// Acquisitions
// ============================================================================

/**
 * Add an acquisition to a session.
 * @param {string} sessionId - Session ID
 * @param {Object} data - Acquisition data (timestamp, spectrum, identification, etc.)
 * @param {Object} files - Files to store { photo: Blob, summaryPlot: Blob, ... }
 * @returns {Promise<Object>} The created acquisition
 */
async function addAcquisition(sessionId, data, files = {}) {
    const db = await openDB();

    const acquisition = {
        id: generateId(),
        sessionId: sessionId,
        timestamp: data.timestamp,
        spectrum: data.spectrum,  // JSON spectrum data
        identification: data.identification || [],
        laserWavelength: data.laserWavelength,
        detectionMode: data.detectionMode,
        csv: data.csv,  // CSV string
        createdAt: new Date().toISOString(),
        fileIds: {},
        // Per-acquisition metadata (captured at time of acquisition)
        substance: data.substance || '',
        appearance: data.appearance || '',
        customAppearance: data.customAppearance || '',
        substanceDescription: data.substanceDescription || '',
    };

    // Store files
    for (const [type, blob] of Object.entries(files)) {
        if (blob) {
            const fileId = await saveFile(acquisition.id, type, blob);
            acquisition.fileIds[type] = fileId;
        }
    }

    // Add acquisition to store
    await new Promise((resolve, reject) => {
        const tx = db.transaction(STORES.acquisitions, 'readwrite');
        const store = tx.objectStore(STORES.acquisitions);
        const request = store.add(acquisition);

        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });

    // Update session with acquisition ID
    const session = await getSession(sessionId);
    if (session) {
        session.acquisitionIds.push(acquisition.id);
        await updateSession(sessionId, { acquisitionIds: session.acquisitionIds });
    }

    return acquisition;
}

/**
 * Get an acquisition by ID.
 * @param {string} id - Acquisition ID
 * @returns {Promise<Object|null>}
 */
async function getAcquisition(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORES.acquisitions, 'readonly');
        const store = tx.objectStore(STORES.acquisitions);
        const request = store.get(id);

        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
    });
}

/**
 * Get all acquisitions for a session.
 * @param {string} sessionId - Session ID
 * @returns {Promise<Array>}
 */
async function getAcquisitionsBySession(sessionId) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORES.acquisitions, 'readonly');
        const store = tx.objectStore(STORES.acquisitions);
        const index = store.index('sessionId');
        const request = index.getAll(sessionId);

        request.onsuccess = () => {
            // Sort by timestamp
            const acquisitions = request.result.sort((a, b) =>
                a.timestamp.localeCompare(b.timestamp)
            );
            resolve(acquisitions);
        };
        request.onerror = () => reject(request.error);
    });
}

/**
 * Delete an acquisition and its files.
 * @param {string} id - Acquisition ID
 * @returns {Promise<void>}
 */
async function deleteAcquisition(id) {
    const db = await openDB();
    const acquisition = await getAcquisition(id);
    if (!acquisition) return;

    // Delete files
    for (const fileId of Object.values(acquisition.fileIds)) {
        await deleteFile(fileId);
    }

    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORES.acquisitions, 'readwrite');
        const store = tx.objectStore(STORES.acquisitions);
        const request = store.delete(id);

        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

// ============================================================================
// Files
// ============================================================================

/**
 * Save a file (blob) to the database.
 * @param {string} acquisitionId - Associated acquisition ID
 * @param {string} type - File type ('photo', 'summaryPlot', 'identificationPlot')
 * @param {Blob} blob - File data
 * @returns {Promise<string>} File ID
 */
async function saveFile(acquisitionId, type, blob) {
    const db = await openDB();

    const file = {
        id: generateId(),
        acquisitionId: acquisitionId,
        type: type,
        mimeType: blob.type || 'application/octet-stream',
        data: blob,
        size: blob.size,
    };

    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORES.files, 'readwrite');
        const store = tx.objectStore(STORES.files);
        const request = store.add(file);

        request.onsuccess = () => resolve(file.id);
        request.onerror = () => reject(request.error);
    });
}

/**
 * Get a file by ID.
 * @param {string} id - File ID
 * @returns {Promise<Object|null>}
 */
async function getFile(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORES.files, 'readonly');
        const store = tx.objectStore(STORES.files);
        const request = store.get(id);

        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
    });
}

/**
 * Get a blob URL for a file.
 * @param {string} id - File ID
 * @returns {Promise<string|null>} Blob URL or null if not found
 */
async function getFileUrl(id) {
    const file = await getFile(id);
    if (!file || !file.data) return null;
    return URL.createObjectURL(file.data);
}

/**
 * Delete a file.
 * @param {string} id - File ID
 * @returns {Promise<void>}
 */
async function deleteFile(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORES.files, 'readwrite');
        const store = tx.objectStore(STORES.files);
        const request = store.delete(id);

        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

/**
 * Get all files for an acquisition.
 * @param {string} acquisitionId - Acquisition ID
 * @returns {Promise<Array>}
 */
async function getFilesByAcquisition(acquisitionId) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORES.files, 'readonly');
        const store = tx.objectStore(STORES.files);
        const index = store.index('acquisitionId');
        const request = index.getAll(acquisitionId);

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

// ============================================================================
// Session Photos (for substance photos - pill/capsule/paper)
// ============================================================================

/**
 * Save a substance photo for a session.
 * @param {string} sessionId - Session ID
 * @param {Blob} blob - Photo blob
 * @returns {Promise<string>} File ID
 */
async function saveSessionPhoto(sessionId, blob) {
    const db = await openDB();

    // Delete existing photo if any
    const session = await getSession(sessionId);
    if (session?.substancePhotoId) {
        await deleteFile(session.substancePhotoId);
    }

    // Save new photo
    const file = {
        id: generateId(),
        sessionId: sessionId,  // Use sessionId instead of acquisitionId
        type: 'substancePhoto',
        mimeType: blob.type || 'image/jpeg',
        data: blob,
        size: blob.size,
    };

    const fileId = await new Promise((resolve, reject) => {
        const tx = db.transaction(STORES.files, 'readwrite');
        const store = tx.objectStore(STORES.files);
        const request = store.add(file);

        request.onsuccess = () => resolve(file.id);
        request.onerror = () => reject(request.error);
    });

    // Update session with photo ID
    await updateSession(sessionId, { substancePhotoId: fileId });

    return fileId;
}

/**
 * Get the substance photo for a session.
 * @param {string} sessionId - Session ID
 * @returns {Promise<Object|null>} File object or null
 */
async function getSessionPhoto(sessionId) {
    const session = await getSession(sessionId);
    if (!session?.substancePhotoId) return null;
    return getFile(session.substancePhotoId);
}

/**
 * Delete the substance photo for a session.
 * @param {string} sessionId - Session ID
 * @returns {Promise<void>}
 */
async function deleteSessionPhoto(sessionId) {
    const session = await getSession(sessionId);
    if (!session?.substancePhotoId) return;

    await deleteFile(session.substancePhotoId);
    await updateSession(sessionId, { substancePhotoId: null });
}

// ============================================================================
// Settings
// ============================================================================

const SETTINGS_ID = 'app';

/**
 * Get application settings.
 * @returns {Promise<Object>}
 */
async function getSettings() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORES.settings, 'readonly');
        const store = tx.objectStore(STORES.settings);
        const request = store.get(SETTINGS_ID);

        request.onsuccess = () => {
            const defaults = {
                id: SETTINGS_ID,
                theme: 'dark',
                syncServerUrl: '',
                syncToken: '',
                autoSync: false,
                language: 'en',
                cameraSettings: {
                    shutter: 5.0,
                    gain: 100,
                    laserAutoDetect: true,
                    laserWavelength: 785,
                },
            };
            resolve({ ...defaults, ...request.result });
        };
        request.onerror = () => reject(request.error);
    });
}

/**
 * Update application settings.
 * @param {Object} updates - Settings to update
 * @returns {Promise<Object>}
 */
async function updateSettings(updates) {
    const db = await openDB();
    const current = await getSettings();
    const updated = { ...current, ...updates, id: SETTINGS_ID };

    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORES.settings, 'readwrite');
        const store = tx.objectStore(STORES.settings);
        const request = store.put(updated);

        request.onsuccess = () => resolve(updated);
        request.onerror = () => reject(request.error);
    });
}

// ============================================================================
// Sync Queue
// ============================================================================

/**
 * Queue a session for sync.
 * @param {string} sessionId - Session ID to queue
 * @param {boolean} force - If true, queue even if already synced (for force re-sync)
 * @returns {Promise<Object>}
 */
async function queueForSync(sessionId, force = false) {
    const database = await openDB();

    // Check if already queued
    const existing = await getSyncQueueItem(sessionId);
    if (existing) {
        // If forcing, reset status to pending
        if (force && existing.status !== 'pending') {
            existing.status = 'pending';
            existing.retryCount = 0;
            existing.lastError = null;
            existing.queuedAt = new Date().toISOString();
            return new Promise((resolve, reject) => {
                const tx = database.transaction(STORES.syncQueue, 'readwrite');
                const store = tx.objectStore(STORES.syncQueue);
                const request = store.put(existing);

                request.onsuccess = () => resolve(existing);
                request.onerror = () => reject(request.error);
            });
        }
        return existing;
    }

    // If not forcing, skip already synced sessions
    if (!force) {
        const session = await getSession(sessionId);
        if (session?.syncedAt) {
            return null;
        }
    }

    const item = {
        id: generateId(),
        sessionId: sessionId,
        status: 'pending',
        retryCount: 0,
        lastError: null,
        queuedAt: new Date().toISOString(),
    };

    return new Promise((resolve, reject) => {
        const tx = database.transaction(STORES.syncQueue, 'readwrite');
        const store = tx.objectStore(STORES.syncQueue);
        const request = store.add(item);

        request.onsuccess = () => resolve(item);
        request.onerror = () => reject(request.error);
    });
}

/**
 * Get sync queue item by session ID.
 * @param {string} sessionId - Session ID
 * @returns {Promise<Object|null>}
 */
async function getSyncQueueItem(sessionId) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORES.syncQueue, 'readonly');
        const store = tx.objectStore(STORES.syncQueue);
        const index = store.index('sessionId');
        const request = index.get(sessionId);

        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
    });
}

/**
 * Get all pending sync items.
 * @returns {Promise<Array>}
 */
async function getPendingSync() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORES.syncQueue, 'readonly');
        const store = tx.objectStore(STORES.syncQueue);
        const index = store.index('status');
        const request = index.getAll('pending');

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

/**
 * Mark a session as synced and remove from queue.
 * @param {string} sessionId - Session ID
 * @returns {Promise<void>}
 */
async function markSynced(sessionId) {
    const db = await openDB();

    // Update session
    await updateSession(sessionId, { syncedAt: new Date().toISOString() });

    // Remove from sync queue
    const item = await getSyncQueueItem(sessionId);
    if (item) {
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORES.syncQueue, 'readwrite');
            const store = tx.objectStore(STORES.syncQueue);
            const request = store.delete(item.id);

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }
}

/**
 * Mark a sync attempt as failed.
 * @param {string} sessionId - Session ID
 * @param {string} error - Error message
 * @returns {Promise<void>}
 */
async function markSyncFailed(sessionId, error) {
    const db = await openDB();
    const item = await getSyncQueueItem(sessionId);
    if (!item) return;

    const updated = {
        ...item,
        status: 'failed',
        retryCount: item.retryCount + 1,
        lastError: error,
    };

    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORES.syncQueue, 'readwrite');
        const store = tx.objectStore(STORES.syncQueue);
        const request = store.put(updated);

        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

/**
 * Reset failed sync items to pending.
 * @returns {Promise<number>} Number of items reset
 */
async function resetFailedSync() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORES.syncQueue, 'readwrite');
        const store = tx.objectStore(STORES.syncQueue);
        const index = store.index('status');
        const request = index.openCursor(IDBKeyRange.only('failed'));
        let count = 0;

        request.onsuccess = (event) => {
            const cursor = event.target.result;
            if (cursor) {
                const item = cursor.value;
                item.status = 'pending';
                cursor.update(item);
                count++;
                cursor.continue();
            }
        };

        tx.oncomplete = () => resolve(count);
        tx.onerror = () => reject(tx.error);
    });
}

// ============================================================================
// Library (for browser-side identification)
// ============================================================================

const LIBRARY_ID = 'reference';

/**
 * Save the reference library.
 * @param {Object} library - Library data { version, wavelengthAxis, substances: [{name, data}] }
 * @returns {Promise<void>}
 */
async function saveLibrary(library) {
    const db = await openDB();
    const record = {
        id: LIBRARY_ID,
        version: library.version || null,
        wavelengthAxis: library.wavelengthAxis || null,
        substances: library.substances || [],
        savedAt: new Date().toISOString(),
    };

    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORES.library, 'readwrite');
        const store = tx.objectStore(STORES.library);
        const request = store.put(record);

        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

/**
 * Get the reference library.
 * @returns {Promise<Object|null>}
 */
async function getLibrary() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORES.library, 'readonly');
        const store = tx.objectStore(STORES.library);
        const request = store.get(LIBRARY_ID);

        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
    });
}

/**
 * Get the library version.
 * @returns {Promise<string|null>}
 */
async function getLibraryVersion() {
    const library = await getLibrary();
    return library ? library.version : null;
}

/**
 * Clear the cached library.
 * @returns {Promise<void>}
 */
async function clearLibrary() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORES.library, 'readwrite');
        const store = tx.objectStore(STORES.library);
        const request = store.delete(LIBRARY_ID);

        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Convert base64 string to Blob.
 * @param {string} base64 - Base64 encoded string
 * @param {string} mimeType - MIME type
 * @returns {Blob}
 */
function base64ToBlob(base64, mimeType) {
    const byteString = atob(base64);
    const ab = new ArrayBuffer(byteString.length);
    const ia = new Uint8Array(ab);
    for (let i = 0; i < byteString.length; i++) {
        ia[i] = byteString.charCodeAt(i);
    }
    return new Blob([ab], { type: mimeType });
}

/**
 * Convert Blob to base64 string.
 * @param {Blob} blob - Blob to convert
 * @returns {Promise<string>}
 */
function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            // Remove data URL prefix
            const base64 = reader.result.split(',')[1];
            resolve(base64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

// Export all functions for use in other modules
const db = {
    openDB,
    clearAllData,
    generateId,

    // Sessions
    createSession,
    getSession,
    getCurrentSession,
    updateSession,
    deleteSession,
    listSessions,

    // Acquisitions
    addAcquisition,
    getAcquisition,
    getAcquisitionsBySession,
    deleteAcquisition,

    // Files
    saveFile,
    getFile,
    getFileUrl,
    deleteFile,
    getFilesByAcquisition,

    // Session Photos
    saveSessionPhoto,
    getSessionPhoto,
    deleteSessionPhoto,

    // Settings
    getSettings,
    updateSettings,

    // Sync Queue
    queueForSync,
    getSyncQueueItem,
    getPendingSync,
    markSynced,
    markSyncFailed,
    resetFailedSync,

    // Library
    saveLibrary,
    getLibrary,
    getLibraryVersion,
    clearLibrary,

    // Utilities
    base64ToBlob,
    blobToBase64,
};
