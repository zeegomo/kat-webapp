/**
 * spettromiao Mobile Webapp - Wizard-Style Frontend
 *
 * Uses IndexedDB for persistent storage.
 * All session data and files stored locally in browser.
 * Syncs directly to CouchDB server.
 */

// ============================================================================
// Configuration
// ============================================================================

// Pi API URL - Auto-detect based on how the app is served
// If served from the Pi (192.168.4.1), use relative URLs (same origin)
// Otherwise, use the full Pi URL (for GitHub Pages with Local Network Access)
const PI_API_URL = (() => {
    const host = window.location.hostname;
    // If running from Pi or localhost, use relative path (same origin)
    if (host === '192.168.4.1' || host === 'localhost' || host === '127.0.0.1') {
        return '';  // Relative URL - same origin
    }
    // Otherwise use full URL (GitHub Pages - requires Local Network Access)
    return 'https://192.168.4.1';
})();

// Whether we need Local Network Access (when served from external origin)
const NEEDS_LNA = PI_API_URL !== '';

// ============================================================================
// State (UI state only - data is in IndexedDB)
// ============================================================================

const state = {
    // Wizard state
    currentStep: 1,
    stepValidation: {
        step1: false,
        step2: false,
    },

    // Current session ID (data in IndexedDB)
    currentSessionId: null,

    // Cached session data (from IndexedDB)
    session: null,
    acquisitions: [],

    // Settings (loaded from IndexedDB)
    settings: null,

    // UI state
    previewActive: false,
    startingPreview: false,
    capturing: false,
    currentAcquisition: null,
    darkMode: true,
    galleryExpanded: false,
    appReady: false,
    initInProgress: false,

    // Sync state
    syncStatus: {
        pending: 0,
        configured: false,
        syncing: false,
    },

    // Library state (for browser-side identification)
    libraryStatus: {
        ready: false,
        syncing: false,
        substanceCount: 0,
        version: null,
    },

    // Blob URL cache (for cleanup)
    blobUrls: [],

    // Pi connectivity state
    piConnected: null,
    piCheckInterval: null,
    piCheckInFlight: false,
    piCheckIntervalMs: 2000,

    // History view state
    historyViewingSession: null,
    historyAcquisitions: [],
    historyCurrentAcquisition: null,
};

// ============================================================================
// DOM Elements
// ============================================================================

const elements = {
    // Header
    settingsBtn: document.getElementById('settingsBtn'),
    piWarningBanner: document.getElementById('piWarningBanner'),
    libraryWarningBanner: document.getElementById('libraryWarningBanner'),

    // Wizard Steps
    stepItems: document.querySelectorAll('.step'),
    wizardSteps: document.querySelectorAll('.wizard-step'),

    // Step 1: Test Info
    step1: document.getElementById('step1'),
    eventNameInput: document.getElementById('eventNameInput'),
    substanceInput: document.getElementById('substanceInput'),
    substanceList: document.getElementById('substanceList'),
    appearanceSelect: document.getElementById('appearanceSelect'),
    customAppearanceGroup: document.getElementById('customAppearanceGroup'),
    customAppearanceInput: document.getElementById('customAppearanceInput'),
    substanceDescGroup: document.getElementById('substanceDescGroup'),
    substanceDescInput: document.getElementById('substanceDescInput'),
    substancePhotoGroup: document.getElementById('substancePhotoGroup'),
    substancePhotoInput: document.getElementById('substancePhotoInput'),
    takePhotoBtn: document.getElementById('takePhotoBtn'),
    removePhotoBtn: document.getElementById('removePhotoBtn'),
    substancePhotoPreview: document.getElementById('substancePhotoPreview'),
    substancePhotoImg: document.getElementById('substancePhotoImg'),
    notesInput: document.getElementById('notesInput'),
    step1NextBtn: document.getElementById('step1NextBtn'),

    // Step 2: Calibration
    step2: document.getElementById('step2'),
    previewImage: document.getElementById('previewImage'),
    previewPlaceholder: document.getElementById('previewPlaceholder'),
    startPreviewBtn: document.getElementById('startPreviewBtn'),
    stopPreviewBtn: document.getElementById('stopPreviewBtn'),
    previewStatus: document.getElementById('previewStatus'),
    calibrationStatus: document.getElementById('calibrationStatus'),
    step2BackBtn: document.getElementById('step2BackBtn'),
    step2ConfirmBtn: document.getElementById('step2ConfirmBtn'),

    // Step 3: Capture
    step3: document.getElementById('step3'),
    captureBtn: document.getElementById('captureBtn'),
    shutterDisplay: document.getElementById('shutterDisplay'),
    shutterSetting: document.getElementById('shutterSetting'),
    shutterPopup: document.getElementById('shutterPopup'),
    shutterSlider: document.getElementById('shutterSlider'),
    gainDisplay: document.getElementById('gainDisplay'),
    gainSetting: document.getElementById('gainSetting'),
    gainPopup: document.getElementById('gainPopup'),
    gainSlider: document.getElementById('gainSlider'),
    progressContainer: document.getElementById('progressContainer'),
    progressFill: document.getElementById('progressFill'),
    progressText: document.getElementById('progressText'),
    resultsSection: document.getElementById('resultsSection'),
    resultThumb: document.getElementById('resultThumb'),
    resultSubstance: document.getElementById('resultSubstance'),
    resultScore: document.getElementById('resultScore'),
    resultTime: document.getElementById('resultTime'),
    viewPlotBtn: document.getElementById('viewPlotBtn'),
    viewMatchesBtn: document.getElementById('viewMatchesBtn'),
    downloadCsvBtn: document.getElementById('downloadCsvBtn'),
    galleryToggle: document.getElementById('galleryToggle'),
    galleryContent: document.getElementById('galleryContent'),
    galleryContainer: document.getElementById('galleryContainer'),
    galleryCount: document.getElementById('galleryCount'),
    step3BackBtn: document.getElementById('step3BackBtn'),
    newTestBtn: document.getElementById('newTestBtn'),
    exportBtn: document.getElementById('exportBtn'),

    // Settings Panel
    settingsPanel: document.getElementById('settingsPanel'),
    closeSettingsBtn: document.getElementById('closeSettingsBtn'),
    overlay: document.getElementById('overlay'),
    darkModeToggle: document.getElementById('darkModeToggle'),
    laserAutoDetect: document.getElementById('laserAutoDetect'),
    laserWavelength: document.getElementById('laserWavelength'),
    laserWavelengthLabel: document.getElementById('laserWavelengthLabel'),
    themeColor: document.getElementById('themeColor'),

    // Plot Modal
    plotModal: document.getElementById('plotModal'),
    plotImage: document.getElementById('plotImage'),
    closePlotModal: document.getElementById('closePlotModal'),

    // Matches Modal
    matchesModal: document.getElementById('matchesModal'),
    matchesList: document.getElementById('matchesList'),
    closeMatchesModal: document.getElementById('closeMatchesModal'),

    // Filter Bay Modal
    filterBayReminder: document.getElementById('filterBayReminder'),
    filterBayModal: document.getElementById('filterBayModal'),
    filterBayModalOk: document.getElementById('filterBayModalOk'),

    // Startup Modal
    startupModal: document.getElementById('startupModal'),
    startupModalTitle: document.getElementById('startupModalTitle'),
    startupModalMessage: document.getElementById('startupModalMessage'),
    startupReloadBtn: document.getElementById('startupReloadBtn'),
    startupResetBtn: document.getElementById('startupResetBtn'),

    // Sync
    syncIndicator: document.getElementById('syncIndicator'),
    syncBadge: document.getElementById('syncBadge'),
    syncServerUrl: document.getElementById('syncServerUrl'),
    syncToken: document.getElementById('syncToken'),
    syncTokenStatus: document.getElementById('syncTokenStatus'),
    autoSyncToggle: document.getElementById('autoSyncToggle'),
    testSyncBtn: document.getElementById('testSyncBtn'),
    syncNowBtn: document.getElementById('syncNowBtn'),
    resyncAllBtn: document.getElementById('resyncAllBtn'),
    pendingCount: document.getElementById('pendingCount'),
    syncStatusEl: document.getElementById('syncStatus'),

    // Version
    currentVersion: document.getElementById('currentVersion'),
    versionStatus: document.getElementById('versionStatus'),
    checkUpdateBtn: document.getElementById('checkUpdateBtn'),
    updateNowBtn: document.getElementById('updateNowBtn'),

    // Help
    helpBtn: document.getElementById('helpBtn'),
    helpModal: document.getElementById('helpModal'),
    closeHelpModal: document.getElementById('closeHelpModal'),
    helpTabs: document.querySelectorAll('.help-tab'),
    helpSections: document.querySelectorAll('.help-section'),
    helpTabContent: document.getElementById('helpTabContent'),
    piWarningHelpLink: document.getElementById('piWarningHelpLink'),

    // History
    historyBtn: document.getElementById('historyBtn'),
    historyModal: document.getElementById('historyModal'),
    closeHistoryModal: document.getElementById('closeHistoryModal'),
    historyListView: document.getElementById('historyListView'),
    historyList: document.getElementById('historyList'),
    historyDetailView: document.getElementById('historyDetailView'),
    historyBackBtn: document.getElementById('historyBackBtn'),
    historyDetailTitle: document.getElementById('historyDetailTitle'),
    historyDetailDate: document.getElementById('historyDetailDate'),
    historyDetailEvent: document.getElementById('historyDetailEvent'),
    historyDetailSubstance: document.getElementById('historyDetailSubstance'),
    historyDetailAppearance: document.getElementById('historyDetailAppearance'),
    historyDetailNotes: document.getElementById('historyDetailNotes'),
    historyNotesRow: document.getElementById('historyNotesRow'),
    historyAcquisitionCount: document.getElementById('historyAcquisitionCount'),
    historyGalleryContainer: document.getElementById('historyGalleryContainer'),
    historyResultSection: document.getElementById('historyResultSection'),
    historyResultThumb: document.getElementById('historyResultThumb'),
    historyResultSubstance: document.getElementById('historyResultSubstance'),
    historyResultScore: document.getElementById('historyResultScore'),
    historyResultTime: document.getElementById('historyResultTime'),
    historyViewPlotBtn: document.getElementById('historyViewPlotBtn'),
    historyViewMatchesBtn: document.getElementById('historyViewMatchesBtn'),
    historyDownloadCsvBtn: document.getElementById('historyDownloadCsvBtn'),

    // Language
    langRadioEn: document.getElementById('langRadioEn'),
    langRadioIt: document.getElementById('langRadioIt'),
};

// ============================================================================
// Enhanced Error Alerts with Troubleshooting Tips
// ============================================================================

const TROUBLESHOOTING_TIPS = {
    photoSave: {
        tipKey: 'errors.photoSave.tip',
        section: 'save'
    },
    captureTimeout: {
        tipKey: 'errors.captureTimeout.tip',
        section: 'capture'
    },
    captureSaveFailed: {
        tipKey: 'errors.captureSaveFailed.tip',
        section: 'save'
    },
    captureFailed: {
        tipKey: 'errors.captureFailed.tip',
        section: 'capture'
    },
    captureError: {
        tipKey: 'errors.captureError.tip',
        section: 'capture'
    },
    exportFailed: {
        tipKey: 'errors.exportFailed.tip',
        section: 'save'
    },
    sessionFailed: {
        tipKey: 'errors.sessionFailed.tip',
        section: 'save'
    }
};

function showEnhancedAlert(baseMessage, tipKey) {
    const troubleInfo = TROUBLESHOOTING_TIPS[tipKey];
    if (troubleInfo) {
        const tip = i18n.t(troubleInfo.tipKey);
        const fullMessage = `${baseMessage}\n\nTip: ${tip}\n\n[See Help > Troubleshooting for details]`;
        alert(fullMessage);
    } else {
        alert(baseMessage);
    }
}

// ============================================================================
// API Client (for Pi communication only)
// ============================================================================

const api = {
    async fetchWithTimeout(url, options = {}, timeout = 5000) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);
        const method = options.method || 'GET';

        console.log(`API ${method} ${url}`);

        try {
            // Build fetch options with Local Network Access if needed
            const fetchOptions = {
                ...options,
                signal: controller.signal,
            };
            // Add targetAddressSpace for Local Network Access when served from external origin
            // This enables Chrome 142+ LNA and bypasses mixed content restrictions
            if (NEEDS_LNA) {
                fetchOptions.targetAddressSpace = 'local';
            }

            const response = await fetch(url, fetchOptions);
            console.log(`API ${method} ${url} -> ${response.status}`);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            return response;
        } catch (error) {
            if (error.name === 'AbortError') {
                console.error(`API ${method} ${url} -> TIMEOUT`);
                throw new Error('Request timed out');
            }
            console.error(`API ${method} ${url} -> ERROR:`, error.message);
            throw error;
        } finally {
            clearTimeout(timeoutId);
        }
    },

    async get(endpoint, timeout = 5000) {
        const response = await this.fetchWithTimeout(`${PI_API_URL}/api${endpoint}`, {}, timeout);
        return response.json();
    },

    async post(endpoint, data = {}, timeout = 5000) {
        const response = await this.fetchWithTimeout(`${PI_API_URL}/api${endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        }, timeout);
        return response.json();
    },

    async getSettings() { return this.get('/settings'); },
    async updateSettings(settings) { return this.post('/settings', settings); },
    async getCalibrationStatus() { return this.get('/calibration'); },
    // Use 20s timeout for preview start (camera initialization takes time)
    async startPreview() { return this.post('/preview/start', {}, 20000); },
    async stopPreview() { return this.post('/preview/stop'); },
    async getPreviewStatus() { return this.get('/preview/status', 15000); },
};

// ============================================================================
// SSE Streaming Helper (for Local Network Access compatibility)
// ============================================================================

/**
 * Fetch SSE stream with Local Network Access support.
 * EventSource doesn't support fetch options, so we use fetch + ReadableStream.
 *
 * @param {string} url - The SSE endpoint URL
 * @param {Object} handlers - Event handlers { onProgress, onResult, onError, onClose }
 * @param {AbortController} controller - AbortController for cancellation
 * @returns {Promise<void>}
 */
async function fetchSSE(url, handlers, controller) {
    const fetchOptions = {
        signal: controller.signal,
    };
    if (NEEDS_LNA) {
        fetchOptions.targetAddressSpace = 'local';
    }

    const response = await fetch(url, fetchOptions);
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });

            // Parse SSE events from buffer
            const lines = buffer.split('\n');
            buffer = lines.pop() || ''; // Keep incomplete line in buffer

            let currentEvent = { type: 'message', data: '' };

            for (const line of lines) {
                if (line.startsWith('event:')) {
                    currentEvent.type = line.slice(6).trim();
                } else if (line.startsWith('data:')) {
                    currentEvent.data += line.slice(5).trim();
                } else if (line === '') {
                    // Empty line = end of event
                    if (currentEvent.data) {
                        const eventType = currentEvent.type;
                        const eventData = currentEvent.data;

                        if (eventType === 'progress' && handlers.onProgress) {
                            handlers.onProgress(JSON.parse(eventData));
                        } else if (eventType === 'result' && handlers.onResult) {
                            handlers.onResult(JSON.parse(eventData));
                        } else if (eventType === 'error' && handlers.onError) {
                            handlers.onError(JSON.parse(eventData));
                        } else if (eventType === 'message' && handlers.onMessage) {
                            handlers.onMessage(JSON.parse(eventData));
                        }
                    }
                    currentEvent = { type: 'message', data: '' };
                }
            }
        }
    } finally {
        reader.releaseLock();
        if (handlers.onClose) handlers.onClose();
    }
}

// ============================================================================
// Pi Connectivity
// ============================================================================

let piConnectivityListenersBound = false;

function setPiConnected(isConnected) {
    if (state.piConnected === isConnected) return;
    state.piConnected = isConnected;
    updatePiConnectionUI();
}

async function checkPiConnectivity() {
    try {
        await api.getSettings();
        setPiConnected(true);
        state.piCheckIntervalMs = 10000;
    } catch (error) {
        setPiConnected(false);
        state.piCheckIntervalMs = 2000;
    }
}

function schedulePiConnectivityCheck(delayMs = state.piCheckIntervalMs) {
    if (state.piCheckInterval) {
        clearTimeout(state.piCheckInterval);
    }
    state.piCheckInterval = setTimeout(runPiConnectivityCheck, delayMs);
}

async function runPiConnectivityCheck() {
    if (state.piCheckInFlight) return;

    // Avoid background polling (battery + iOS background throttling)
    if (document.visibilityState === 'hidden') {
        schedulePiConnectivityCheck(30000);
        return;
    }

    state.piCheckInFlight = true;
    try {
        await checkPiConnectivity();
    } finally {
        state.piCheckInFlight = false;
        schedulePiConnectivityCheck();
    }
}

function startPiConnectivityMonitoring() {
    if (!piConnectivityListenersBound) {
        piConnectivityListenersBound = true;

        window.addEventListener('online', () => schedulePiConnectivityCheck(0));
        window.addEventListener('offline', () => schedulePiConnectivityCheck(0));
        window.addEventListener('pageshow', () => schedulePiConnectivityCheck(0));
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') {
                schedulePiConnectivityCheck(0);
            }
        });
    }

    // Kick off immediately
    state.piCheckInFlight = false;
    schedulePiConnectivityCheck(0);
}

function stopPiConnectivityMonitoring() {
    if (state.piCheckInterval) {
        clearTimeout(state.piCheckInterval);
        state.piCheckInterval = null;
    }
    state.piCheckInFlight = false;
}

function updatePiConnectionUI() {
    if (state.piConnected) {
        elements.piWarningBanner.classList.add('hidden');
    } else {
        elements.piWarningBanner.classList.remove('hidden');
    }
}

// ============================================================================
// Theme
// ============================================================================

function setTheme(isDark) {
    state.darkMode = isDark;
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
    elements.themeColor.setAttribute('content', isDark ? '#0a0a0a' : '#fafafa');
    elements.darkModeToggle.checked = isDark;

    // Save to IndexedDB
    db.updateSettings({ theme: isDark ? 'dark' : 'light' });
}

// ============================================================================
// Wizard Navigation
// ============================================================================

function goToStep(stepNumber) {
    if (stepNumber < 1 || stepNumber > 3) return;

    // If going forward, validate current step
    if (stepNumber > state.currentStep) {
        if (!canProceedFromStep(state.currentStep)) {
            return;
        }
    }

    // Stop preview and hide reminder if leaving step 2
    if (state.currentStep === 2 && stepNumber !== 2) {
        if (state.previewActive) {
            stopPreview();
        }
        elements.filterBayReminder.classList.add('hidden');
    }

    // Update state
    state.currentStep = stepNumber;

    // Update UI
    updateStepIndicator();
    showCurrentStep();

    // Persist step
    localStorage.setItem('wizardStep', stepNumber);
}

function canProceedFromStep(step) {
    switch (step) {
        case 1:
            // Require Pi connection to proceed to Step 2
            if (!state.piConnected) {
                return false;
            }
            return validateStep1();
        case 2:
            return state.stepValidation.step2;
        default:
            return true;
    }
}

function validateStep1() {
    const event = state.session?.event?.trim();
    const substance = state.session?.substance?.trim();
    const appearance = getAppearanceValue();

    // Check if substance description is required (for pill/capsule/blotter)
    const needsSubstanceDesc = ['pill', 'capsule', 'paper'].includes(state.session?.appearance);
    const substanceDesc = state.session?.substanceDescription?.trim();

    let isValid = Boolean(event && substance && appearance);

    // Also require substance description if needed
    if (needsSubstanceDesc && !substanceDesc) {
        isValid = false;
    }

    state.stepValidation.step1 = isValid;

    // Update Next button state
    elements.step1NextBtn.disabled = !isValid;

    return isValid;
}

function getAppearanceValue() {
    const selectValue = state.session?.appearance;
    if (selectValue === 'other') {
        return state.session?.customAppearance?.trim() || '';
    }
    return selectValue;
}

function updateStepIndicator() {
    elements.stepItems.forEach((item, index) => {
        const stepNum = index + 1;
        item.classList.remove('active', 'completed');

        if (stepNum === state.currentStep) {
            item.classList.add('active');
        } else if (stepNum < state.currentStep) {
            item.classList.add('completed');
        }
    });
}

function showCurrentStep() {
    elements.wizardSteps.forEach(step => {
        const stepNum = parseInt(step.dataset.step, 10);
        step.classList.toggle('hidden', stepNum !== state.currentStep);
    });

    // Step-specific initialization
    if (state.currentStep === 2) {
        loadCalibrationStatus();
        // Show filter bay reminder
        elements.filterBayReminder.classList.remove('hidden');
        // Auto-start preview on entering step 2
        if (!state.previewActive) {
            startPreview();
        }
    }

    if (state.currentStep === 3) {
        updateGalleryUI();
        updateExportButton();
    }
}

// ============================================================================
// Step 1: Test Info
// ============================================================================

async function updateStep1Form() {
    elements.eventNameInput.value = state.session?.event || '';
    elements.substanceInput.value = state.session?.substance || '';
    elements.appearanceSelect.value = state.session?.appearance || '';
    elements.customAppearanceInput.value = state.session?.customAppearance || '';
    elements.substanceDescInput.value = state.session?.substanceDescription || '';
    elements.notesInput.value = state.session?.notes || '';

    updateCustomAppearanceVisibility();
    updateSubstanceDescVisibility();
    updateSubstancePhotoVisibility();

    // Load existing substance photo if any
    if (state.session?.substancePhotoId) {
        try {
            const photoFile = await db.getFile(state.session.substancePhotoId);
            if (photoFile?.data) {
                showSubstancePhotoPreview(photoFile.data);
            }
        } catch (error) {
            console.error('Failed to load substance photo:', error);
        }
    } else {
        hideSubstancePhotoPreview();
    }

    validateStep1();
}

function updateCustomAppearanceVisibility() {
    const isOther = state.session?.appearance === 'other';
    elements.customAppearanceGroup.classList.toggle('hidden', !isOther);
}

function updateSubstanceDescVisibility() {
    const appearance = state.session?.appearance;
    const needsDescription = ['pill', 'capsule', 'paper'].includes(appearance);

    if (!elements.substanceDescGroup) {
        console.error('substanceDescGroup element not found');
        return;
    }

    elements.substanceDescGroup.classList.toggle('hidden', !needsDescription);

    // Clear description if not needed
    if (!needsDescription && state.session) {
        state.session.substanceDescription = '';
        if (elements.substanceDescInput) {
            elements.substanceDescInput.value = '';
        }
    }
}

function updateSubstancePhotoVisibility() {
    const appearance = state.session?.appearance || '';
    const needsPhoto = ['pill', 'capsule', 'paper'].includes(appearance);

    if (!elements.substancePhotoGroup) {
        return;
    }

    elements.substancePhotoGroup.classList.toggle('hidden', !needsPhoto);

    // Clear photo if appearance changes to non-photo type
    if (!needsPhoto && state.session?.substancePhotoId) {
        handleRemoveSubstancePhoto();
    }
}

async function handleSubstancePhotoSelect(event) {
    const file = event.target.files[0];
    if (!file) return;

    try {
        // Compress image before saving
        const blob = await compressImage(file, { maxWidth: 1200, quality: 0.8 });

        // Save to IndexedDB
        const fileId = await db.saveSessionPhoto(state.currentSessionId, blob);
        state.session.substancePhotoId = fileId;

        // Show preview
        showSubstancePhotoPreview(blob);
    } catch (error) {
        console.error('Failed to save substance photo:', error);
        showEnhancedAlert(i18n.t('errors.photoSave.message', { error: error.message }), 'photoSave');
    }

    // Reset input so same file can be selected again
    event.target.value = '';
}

async function handleRemoveSubstancePhoto() {
    if (!state.currentSessionId) return;

    try {
        await db.deleteSessionPhoto(state.currentSessionId);
        state.session.substancePhotoId = null;
        hideSubstancePhotoPreview();
    } catch (error) {
        console.error('Failed to remove substance photo:', error);
    }
}

function showSubstancePhotoPreview(blob) {
    const url = URL.createObjectURL(blob);
    state.blobUrls.push(url);
    elements.substancePhotoImg.src = url;
    elements.substancePhotoPreview.classList.remove('hidden');
    elements.removePhotoBtn.classList.remove('hidden');
}

function hideSubstancePhotoPreview() {
    elements.substancePhotoImg.src = '';
    elements.substancePhotoPreview.classList.add('hidden');
    elements.removePhotoBtn.classList.add('hidden');
}

/**
 * Compress an image file to reduce storage size.
 * @param {File|Blob} file - Image file
 * @param {Object} options - { maxWidth: number, quality: number }
 * @returns {Promise<Blob>} Compressed image blob
 */
async function compressImage(file, { maxWidth = 1200, quality = 0.8 } = {}) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(file);

        img.onload = () => {
            URL.revokeObjectURL(url);

            // Calculate new dimensions
            let width = img.width;
            let height = img.height;

            if (width > maxWidth) {
                height = Math.round((height * maxWidth) / width);
                width = maxWidth;
            }

            // Create canvas and draw resized image
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;

            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);

            // Convert to blob
            canvas.toBlob(
                (blob) => {
                    if (blob) {
                        resolve(blob);
                    } else {
                        reject(new Error(i18n.t('errors.imageCompress')));
                    }
                },
                'image/jpeg',
                quality
            );
        };

        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error(i18n.t('errors.imageLoad')));
        };

        img.src = url;
    });
}

function populateSubstanceList() {
    // Populate datalist with substance names from library
    if (!identifier.isReady()) return;

    const datalist = elements.substanceList;
    datalist.innerHTML = '';

    const substances = identifier.library?.substances || [];
    for (const s of substances) {
        const option = document.createElement('option');
        option.value = s.name;
        datalist.appendChild(option);
    }

    console.log(`Populated substance list with ${substances.length} options`);
}

function handleStep1InputChange() {
    if (!state.session) return;

    state.session.event = elements.eventNameInput.value;
    state.session.substance = elements.substanceInput.value;
    state.session.notes = elements.notesInput.value;
    validateStep1();
}

function handleAppearanceChange() {
    if (!state.session) return;

    state.session.appearance = elements.appearanceSelect.value;
    if (state.session.appearance !== 'other') {
        state.session.customAppearance = '';
    }
    updateCustomAppearanceVisibility();
    updateSubstanceDescVisibility();
    updateSubstancePhotoVisibility();
    validateStep1();
}

function handleCustomAppearanceChange() {
    if (!state.session) return;

    state.session.customAppearance = elements.customAppearanceInput.value;
    validateStep1();
}

function handleSubstanceDescChange() {
    if (!state.session) return;

    state.session.substanceDescription = elements.substanceDescInput.value;
    validateStep1();
}

async function handleStep1Next() {
    // Check Pi connection first
    if (!state.piConnected) {
        elements.piWarningBanner.classList.remove('hidden');
        // Shake the banner to draw attention
        elements.piWarningBanner.classList.add('shake');
        setTimeout(() => elements.piWarningBanner.classList.remove('shake'), 300);
        return;
    }

    if (validateStep1()) {
        await saveSession();
        goToStep(2);
    }
}

// ============================================================================
// Step 2: Calibration
// ============================================================================

async function startPreview() {
    // Prevent concurrent start requests
    if (state.startingPreview || state.previewActive) {
        console.log('Preview start already in progress or active, skipping');
        return;
    }
    state.startingPreview = true;

    console.log('Starting preview...');
    try {
        const response = await api.startPreview();
        console.log('Start preview response:', response);

        if (response.status === 'error') {
            console.error('Backend error:', response.message);
            elements.previewStatus.textContent = i18n.t('preview.error', { message: response.message });
            return;
        }

        state.previewActive = true;

        // Add error handler for stream loading failures
        elements.previewImage.onerror = (e) => {
            console.error('Preview stream error:', e);
            elements.previewStatus.textContent = i18n.t('preview.streamFailed');
            resetPreviewUI();
        };

        // Note: The startPreview() API call above has already triggered the LNA permission
        // prompt (via targetAddressSpace: 'local' in fetchWithTimeout). Once granted, the
        // permission applies to all requests to this origin, so img.src will work.
        elements.previewImage.src = `${PI_API_URL}/api/preview/stream`;
        elements.previewImage.classList.remove('hidden');
        elements.previewPlaceholder.classList.add('hidden');
        elements.startPreviewBtn.classList.add('hidden');
        elements.stopPreviewBtn.classList.remove('hidden');

        pollPreviewStatus();
    } catch (error) {
        console.error('Failed to start preview:', error);
        elements.previewStatus.textContent = i18n.t('preview.error', { message: error.message });
        resetPreviewUI();
    } finally {
        state.startingPreview = false;
    }
}

async function stopPreview() {
    try {
        await api.stopPreview();
        resetPreviewUI();
    } catch (error) {
        console.error('Failed to stop preview:', error);
    }
}

function resetPreviewUI() {
    state.previewActive = false;
    elements.previewImage.onerror = null;  // Clear handler to stop error loop
    elements.previewImage.src = '';
    elements.previewImage.classList.add('hidden');
    elements.previewPlaceholder.classList.remove('hidden');
    elements.startPreviewBtn.classList.remove('hidden');
    elements.stopPreviewBtn.classList.add('hidden');
    elements.previewStatus.textContent = '';
}

function getExposureInfo(exp_us) {
    if (exp_us < 3000) return { text: i18n.t('step3.exposure.perfect'), class: 'exp-perfect' };
    if (exp_us < 6000) return { text: i18n.t('step3.exposure.good'), class: 'exp-good' };
    if (exp_us < 10000) return { text: i18n.t('step3.exposure.ok'), class: 'exp-ok' };
    if (exp_us < 20000) return { text: i18n.t('step3.exposure.meh'), class: 'exp-meh' };
    return { text: i18n.t('step3.exposure.bad'), class: 'exp-bad' };
}

async function pollPreviewStatus() {
    if (!state.previewActive) return;

    try {
        const status = await api.getPreviewStatus();
        console.log('Preview status:', status);
        if (status.streaming) {
            const expInfo = getExposureInfo(status.exposure_us);
            elements.previewStatus.innerHTML = i18n.t('preview.status', {
                fps: status.fps,
                class: expInfo.class,
                exposure: status.exposure_us,
                quality: expInfo.text
            });
        } else {
            console.warn('Stream stopped unexpectedly');
            elements.previewStatus.textContent = i18n.t('preview.streamStopped');
            resetPreviewUI();
            return;  // Stop polling
        }
    } catch (error) {
        console.error('Status poll error:', error);
        elements.previewStatus.textContent = i18n.t('preview.connectionError');
        resetPreviewUI();
        return;  // Stop polling
    }

    if (state.previewActive) {
        setTimeout(pollPreviewStatus, 1000);
    }
}

function updateCalibrationUI(status) {
    const { camera_calibration, wavelength_calibration } = status;
    const allOk = camera_calibration && wavelength_calibration;

    elements.calibrationStatus.className = 'calibration-status ' + (allOk ? 'ok' : 'missing');
    elements.calibrationStatus.textContent = `${i18n.t('step2.status.camera')}: ${camera_calibration ? i18n.t('step2.status.ok') : i18n.t('step2.status.missing')} | ${i18n.t('step2.status.wavelength')}: ${wavelength_calibration ? i18n.t('step2.status.ok') : i18n.t('step2.status.missing')}`;
}

async function loadCalibrationStatus() {
    try {
        const status = await api.getCalibrationStatus();
        updateCalibrationUI(status);
    } catch (error) {
        console.error('Failed to load calibration status:', error);
    }
}

function handleStep2Back() {
    goToStep(1);
}

function handleStep2Confirm() {
    elements.filterBayModal.classList.remove('hidden');
}

function handleFilterBayModalOk() {
    elements.filterBayModal.classList.add('hidden');
    state.stepValidation.step2 = true;
    goToStep(3);
}

// ============================================================================
// Step 3: Capture
// ============================================================================

function updateSettingsUI() {
    const cameraSettings = state.settings?.cameraSettings || {};
    elements.shutterSlider.value = cameraSettings.shutter || 5.0;
    elements.shutterDisplay.textContent = i18n.t('step3.shutter.display', { value: (cameraSettings.shutter || 5.0).toFixed(1) });
    elements.gainSlider.value = cameraSettings.gain || 100;
    elements.gainDisplay.textContent = i18n.t('step3.gain.display', { value: Math.round(cameraSettings.gain || 100) });
    elements.laserAutoDetect.checked = cameraSettings.laserAutoDetect !== false;
    elements.laserWavelength.value = cameraSettings.laserWavelength || 785;
    updateLaserWavelengthVisibility();
    // Update language radio buttons
    if (elements.langRadioEn && elements.langRadioIt) {
        const currentLang = i18n.currentLang;
        elements.langRadioEn.checked = (currentLang === 'en');
        elements.langRadioIt.checked = (currentLang === 'it');
    }
}

function updateLaserWavelengthVisibility() {
    const autoDetect = elements.laserAutoDetect.checked;
    elements.laserWavelengthLabel.classList.toggle('hidden', autoDetect);
}

async function saveSettings() {
    const cameraSettings = {
        shutter: parseFloat(elements.shutterSlider.value),
        gain: parseFloat(elements.gainSlider.value),
        laserAutoDetect: elements.laserAutoDetect.checked,
        laserWavelength: parseFloat(elements.laserWavelength.value),
    };

    // Update local state
    if (state.settings) {
        state.settings.cameraSettings = cameraSettings;
    }

    // Save to IndexedDB
    await db.updateSettings({ cameraSettings });

    // Update Pi camera settings
    try {
        await api.updateSettings({
            shutter: cameraSettings.shutter,
            gain: cameraSettings.gain,
            laser_auto_detect: cameraSettings.laserAutoDetect,
            laser_wavelength: cameraSettings.laserWavelength,
        });
    } catch (error) {
        console.error('Failed to update Pi settings:', error);
    }

    updateLaserWavelengthVisibility();
}

async function capture() {
    if (state.capturing) return;

    state.capturing = true;
    elements.captureBtn.disabled = true;
    elements.progressContainer.classList.remove('hidden');
    elements.progressFill.style.width = '0%';
    elements.progressText.textContent = i18n.t('step3.progress.starting');

    const shutterTime = state.settings?.cameraSettings?.shutter || 5.0;
    const timeoutMs = (shutterTime + 60) * 1000;  // exposure + 25s Pi overhead + 35s safety margin

    // Start capture progress animation (Pi has ~25s fixed processing overhead)
    const exposureStartTime = Date.now();
    const estimatedCaptureTime = shutterTime + 25;
    const exposureDurationMs = estimatedCaptureTime * 1000;
    const startProgress = 10;
    const endProgress = 90;

    elements.progressFill.style.width = `${startProgress}%`;
    const exposureTimer = setInterval(() => {
        const elapsed = Date.now() - exposureStartTime;
        const fraction = Math.min(elapsed / exposureDurationMs, 1);
        const currentProgress = startProgress + (endProgress - startProgress) * fraction;
        elements.progressFill.style.width = `${currentProgress}%`;

        const remaining = Math.max(0, estimatedCaptureTime - (elapsed / 1000));
        elements.progressText.textContent = i18n.t('step3.progress.capturing', { time: remaining.toFixed(1) });
    }, 100);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(`${PI_API_URL}/api/capture`, {
            method: 'POST',
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        clearInterval(exposureTimer);

        if (!response.ok) {
            throw new Error(`HTTP error: ${response.status}`);
        }

        const result = await response.json();
        await captureComplete(result);
    } catch (error) {
        clearTimeout(timeoutId);
        clearInterval(exposureTimer);

        if (error.name === 'AbortError') {
            captureError(i18n.t('capture.timeout'), 'captureTimeout');
        } else {
            captureError(error.message);
        }
    }
}

async function captureComplete(result) {
    state.capturing = false;
    elements.captureBtn.disabled = false;
    elements.progressContainer.classList.add('hidden');

    if (result.success) {
        try {
            // Log what data was received from Pi
            console.log('Capture result received:', {
                success: result.success,
                hasPhoto: !!result.photo,
                hasSummaryPlot: !!result.summary_plot,
                hasCsv: !!result.csv,
                hasSpectrum: !!result.spectrum,
                hasPreprocessedSpectrum: !!result.preprocessed_spectrum,
            });

            // Convert base64 to blobs
            const files = {};

            if (result.photo) {
                files.photo = db.base64ToBlob(result.photo, 'image/jpeg');
            }
            if (result.summary_plot) {
                files.summaryPlot = db.base64ToBlob(result.summary_plot, 'image/png');
            }

            // Warn if critical data is missing
            if (!result.summary_plot) {
                console.warn('No summary_plot received from Pi - View Summary will be disabled');
            }
            if (!result.csv) {
                console.warn('No csv data received from Pi - Download CSV will be disabled');
            }

            // Perform browser-side identification
            let identification = null;
            if (result.preprocessed_spectrum && identifier.isReady()) {
                const matches = identifier.identify(result.preprocessed_spectrum, 5);
                identification = matches.map((m, i) => ({
                    rank: i + 1,
                    substance: m.substance,
                    score: Math.round(m.score * 1000) / 1000,
                }));
                console.log('Browser identification:', identification);
            } else if (!identifier.isReady()) {
                console.warn('Identification library not ready');
            } else {
                console.warn('No preprocessed spectrum data received');
            }

            // Store acquisition in IndexedDB
            // Include current session metadata so each acquisition captures state at time of recording
            const acquisition = await db.addAcquisition(
                state.currentSessionId,
                {
                    timestamp: result.timestamp,
                    spectrum: result.spectrum,
                    identification: identification,
                    laserWavelength: result.laser_wavelength,
                    detectionMode: result.detection_mode,
                    csv: result.csv,
                    // Capture session metadata at time of acquisition
                    substance: state.session?.substance || '',
                    appearance: state.session?.appearance || '',
                    customAppearance: state.session?.customAppearance || '',
                    substanceDescription: state.session?.substanceDescription || '',
                },
                files
            );

            // Update local state
            state.acquisitions.push(acquisition);
            state.currentAcquisition = acquisition;

            // Update session in IndexedDB
            const session = await db.getSession(state.currentSessionId);
            if (session) {
                state.session = session;
            }

            // Update UI
            await updateGalleryUI();
            updateExportButton();
            await updateResultUI(acquisition, identification);

        } catch (error) {
            console.error('Failed to store acquisition:', error);
            showEnhancedAlert(i18n.t('capture.saveFailed', { error: error.message }), 'captureSaveFailed');
        }
    } else {
        showEnhancedAlert(i18n.t('capture.failed', { error: result.error || 'Unknown error' }), 'captureFailed');
    }
}

function captureError(message, tipKey = 'captureError') {
    state.capturing = false;
    elements.captureBtn.disabled = false;
    elements.progressContainer.classList.add('hidden');
    showEnhancedAlert(i18n.t('capture.error', { message }), tipKey);
}

function getConfidenceText(score) {
    if (score >= 0.90) return i18n.t('step3.results.confidence.high');
    if (score >= 0.70) return i18n.t('step3.results.confidence.moderate');
    return i18n.t('step3.results.confidence.low');
}

function getConfidenceClass(score) {
    if (score >= 0.90) return 'confidence-high';
    if (score >= 0.70) return 'confidence-moderate';
    return 'confidence-low';
}

async function updateResultUI(acquisition, identification) {
    if (!acquisition) {
        elements.resultsSection.classList.add('hidden');
        return;
    }

    elements.resultsSection.classList.remove('hidden');

    // Load photo from IndexedDB
    if (acquisition.fileIds?.photo) {
        const photoUrl = await db.getFileUrl(acquisition.fileIds.photo);
        if (photoUrl) {
            state.blobUrls.push(photoUrl);
            elements.resultThumb.src = photoUrl;
        }
    }

    elements.resultTime.textContent = formatTime(acquisition.timestamp);

    if (acquisition.laserWavelength) {
        const modeKey = acquisition.detectionMode === 'auto' ? 'step3.results.wavelength.detected' : 'step3.results.wavelength.manual';
        elements.resultTime.textContent += ` | ${i18n.t(modeKey, { value: acquisition.laserWavelength.toFixed(1) })}`;
    }

    if (identification && identification.length > 0) {
        const top = identification[0];
        const threshold = 0.15;

        // Count substances within threshold of top score (max 3 total)
        const closeMatchCount = identification
            .slice(1, 3)
            .filter(m => (top.score - m.score) <= threshold)
            .length;

        // Display top match with count of similar matches
        if (closeMatchCount > 0) {
            elements.resultSubstance.textContent = i18n.t('step3.results.withSimilar', { substance: top.substance, count: closeMatchCount });
        } else {
            elements.resultSubstance.textContent = top.substance;
        }

        const confidenceText = getConfidenceText(top.score);
        const confidenceClass = getConfidenceClass(top.score);
        elements.resultScore.textContent = `${top.score.toFixed(3)} | ${confidenceText}`;
        elements.resultScore.className = `result-score ${confidenceClass}`;
    } else {
        elements.resultSubstance.textContent = i18n.t('step3.results.unknown');
        elements.resultScore.textContent = i18n.t('step3.results.scoreNA');
        elements.resultScore.className = 'result-score';
    }

    // Set up plot buttons
    elements.viewPlotBtn.onclick = () => showPlot(acquisition, 'summaryPlot');
    elements.viewPlotBtn.disabled = !acquisition.fileIds?.summaryPlot;

    if (elements.viewMatchesBtn) {
        const hasMultipleMatches = identification?.length > 1;
        elements.viewMatchesBtn.onclick = () => showMatches(identification);
        elements.viewMatchesBtn.disabled = !hasMultipleMatches;
        elements.viewMatchesBtn.classList.toggle('hidden', !hasMultipleMatches);
    }

    elements.downloadCsvBtn.onclick = () => downloadCsv(acquisition);
    elements.downloadCsvBtn.disabled = !acquisition.csv;
}

async function showPlot(acquisition, plotType) {
    const fileId = acquisition.fileIds?.[plotType];
    if (!fileId) return;

    const url = await db.getFileUrl(fileId);
    if (url) {
        state.blobUrls.push(url);
        elements.plotImage.src = url;
        elements.plotModal.classList.remove('hidden');
    }
}

function showMatches(identification) {
    if (!identification || identification.length === 0) return;

    const html = identification.map(match => {
        const confidenceText = getConfidenceText(match.score);
        const confidenceClass = getConfidenceClass(match.score);
        return `
            <div class="match-item">
                <span class="match-rank">#${match.rank}</span>
                <span class="match-substance">${match.substance}</span>
                <span class="match-score ${confidenceClass}">${match.score.toFixed(3)} - ${confidenceText}</span>
            </div>
        `;
    }).join('');

    elements.matchesList.innerHTML = html;
    elements.matchesModal.classList.remove('hidden');
}

function downloadCsv(acquisition) {
    if (!acquisition?.csv) return;

    const blob = new Blob([acquisition.csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `spectrum_${acquisition.timestamp}.csv`;
    a.click();
    URL.revokeObjectURL(url);
}

function formatTime(timestamp) {
    if (!timestamp || timestamp.length < 15) return timestamp;
    return `${timestamp.slice(9, 11)}:${timestamp.slice(11, 13)}:${timestamp.slice(13, 15)}`;
}

// ============================================================================
// Gallery
// ============================================================================

function toggleGallery() {
    state.galleryExpanded = !state.galleryExpanded;
    elements.galleryContent.classList.toggle('hidden', !state.galleryExpanded);
    elements.galleryToggle.classList.toggle('expanded', state.galleryExpanded);
    elements.galleryToggle.querySelector('.toggle-icon').textContent = state.galleryExpanded ? '▼' : '▶';
}

async function updateGalleryUI() {
    const acquisitions = state.acquisitions || [];
    elements.galleryCount.textContent = i18n.t('step3.gallery.count', { count: acquisitions.length });

    if (acquisitions.length === 0) {
        elements.galleryContainer.innerHTML = `<div class="gallery-empty">${i18n.t('step3.gallery.noAcquisitions')}</div>`;
        return;
    }

    // Clear old blob URLs
    cleanupBlobUrls();

    // Build gallery HTML
    const galleryItems = await Promise.all(acquisitions.map(async (acq, idx) => {
        let thumbUrl = '';
        if (acq.fileIds?.photo) {
            thumbUrl = await db.getFileUrl(acq.fileIds.photo);
            if (thumbUrl) state.blobUrls.push(thumbUrl);
        }

        return `
            <div class="gallery-item" data-index="${idx}">
                <img src="${thumbUrl}" alt="Acquisition ${idx + 1}">
                <span>${formatTime(acq.timestamp)}</span>
            </div>
        `;
    }));

    elements.galleryContainer.innerHTML = galleryItems.join('');

    elements.galleryContainer.querySelectorAll('.gallery-item').forEach(item => {
        item.addEventListener('click', () => {
            const idx = parseInt(item.dataset.index, 10);
            showAcquisition(idx);
        });
    });
}

async function showAcquisition(idx) {
    const acquisition = state.acquisitions[idx];
    if (!acquisition) return;

    state.currentAcquisition = acquisition;
    await updateResultUI(acquisition, acquisition.identification);
}

function updateExportButton() {
    elements.exportBtn.disabled = state.acquisitions.length === 0;
}

// ============================================================================
// Help Modal
// ============================================================================

function openHelpModal(section = null) {
    elements.helpModal.classList.remove('hidden');

    if (section) {
        // Map section to tab index
        const sectionToTab = {
            'workflow': 0,
            'troubleshooting': 1,
            'connection': 1,
            'capture': 1,
            'save': 1,
            'sync': 1
        };

        const tabIndex = sectionToTab[section] ?? 0;
        switchHelpTab(tabIndex);

        // Scroll to specific subsection if on troubleshooting tab
        if (tabIndex === 1 && section !== 'troubleshooting') {
            setTimeout(() => {
                const anchor = document.getElementById(`help-${section}`);
                if (anchor) {
                    anchor.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
            }, 100);
        }
    }
}

function closeHelpModal() {
    elements.helpModal.classList.add('hidden');
}

function switchHelpTab(tabIndex) {
    // Update tab buttons
    elements.helpTabs.forEach((tab, i) => {
        tab.classList.toggle('active', i === tabIndex);
    });

    // Update sections
    elements.helpSections.forEach((section, i) => {
        section.classList.toggle('active', i === tabIndex);
        section.classList.toggle('hidden', i !== tabIndex);
    });

    // Scroll to top of content
    if (elements.helpTabContent) {
        elements.helpTabContent.scrollTop = 0;
    }
}

// ============================================================================
// History Browser
// ============================================================================

async function openHistoryModal() {
    elements.historyModal.classList.remove('hidden');
    showHistoryListView();
    await loadHistoryList();
}

function closeHistoryModal() {
    elements.historyModal.classList.add('hidden');
    state.historyViewingSession = null;
    state.historyAcquisitions = [];
    state.historyCurrentAcquisition = null;
}

function showHistoryListView() {
    elements.historyListView.classList.remove('hidden');
    elements.historyDetailView.classList.add('hidden');
}

function showHistoryDetailView() {
    elements.historyListView.classList.add('hidden');
    elements.historyDetailView.classList.remove('hidden');
}

async function loadHistoryList() {
    const sessions = await db.listSessions();

    if (sessions.length === 0) {
        elements.historyList.innerHTML = `<div class="history-list-empty">${i18n.t('history.noSessions')}</div>`;
        return;
    }

    const listItems = await Promise.all(sessions.map(async (session) => {
        const acquisitions = await db.getAcquisitionsBySession(session.id);
        const acquisitionCount = acquisitions.length;

        // Get top match from first acquisition with identification
        let topMatch = null;
        let topScore = null;
        for (const acq of acquisitions) {
            if (acq.identification && acq.identification.length > 0) {
                topMatch = acq.identification[0].substance;
                topScore = acq.identification[0].score;
                break;
            }
        }

        const dateStr = formatHistoryDate(session.createdAt);
        const isCurrent = session.isCurrent === 1;
        const confidenceClass = topScore ? getConfidenceClass(topScore) : '';

        return `
            <div class="history-item ${isCurrent ? 'history-item-current' : ''}" data-session-id="${session.id}">
                <div class="history-item-header">
                    <span class="history-item-event">${escapeHtml(session.event || i18n.t('history.unnamed'))}</span>
                    <span class="history-item-date">${dateStr}</span>
                </div>
                <div class="history-item-details">
                    <span class="history-item-substance">${escapeHtml(session.substance || i18n.t('history.placeholder'))}</span>
                    <span>${acquisitionCount} ${acquisitionCount !== 1 ? i18n.t('history.countPlural') : i18n.t('history.countSingular')}</span>
                    ${topMatch ? `<span class="history-item-match ${confidenceClass}">${escapeHtml(topMatch)} (${topScore.toFixed(2)})</span>` : ''}
                    ${isCurrent ? '<span class="history-item-current-badge">(current)</span>' : ''}
                </div>
            </div>
        `;
    }));

    elements.historyList.innerHTML = listItems.join('');

    // Add click handlers
    elements.historyList.querySelectorAll('.history-item').forEach(item => {
        item.addEventListener('click', () => {
            const sessionId = item.dataset.sessionId;
            viewHistorySession(sessionId);
        });
    });
}

async function viewHistorySession(sessionId) {
    const session = await db.getSession(sessionId);
    if (!session) {
        console.error('Session not found:', sessionId);
        return;
    }

    state.historyViewingSession = session;
    state.historyAcquisitions = await db.getAcquisitionsBySession(sessionId);
    state.historyCurrentAcquisition = null;

    // Populate session info
    elements.historyDetailTitle.textContent = session.event || i18n.t('history.unnamedTest');
    elements.historyDetailDate.textContent = formatHistoryDate(session.createdAt);
    elements.historyDetailEvent.textContent = session.event || i18n.t('history.placeholder');
    elements.historyDetailSubstance.textContent = session.substance || i18n.t('history.placeholder');

    // Format appearance
    let appearanceText = session.appearance || i18n.t('history.placeholder');
    if (session.appearance === 'other' && session.customAppearance) {
        appearanceText = session.customAppearance;
    }
    elements.historyDetailAppearance.textContent = appearanceText;

    // Notes
    if (session.notes) {
        elements.historyNotesRow.classList.remove('hidden');
        elements.historyDetailNotes.textContent = session.notes;
    } else {
        elements.historyNotesRow.classList.add('hidden');
    }

    // Acquisition count
    elements.historyAcquisitionCount.textContent = state.historyAcquisitions.length;

    // Build gallery
    await updateHistoryGalleryUI();

    // Hide result section initially
    elements.historyResultSection.classList.add('hidden');

    showHistoryDetailView();
}

async function updateHistoryGalleryUI() {
    const acquisitions = state.historyAcquisitions;

    if (acquisitions.length === 0) {
        elements.historyGalleryContainer.innerHTML = `<div class="gallery-empty">${i18n.t('history.noAcquisitions')}</div>`;
        return;
    }

    const galleryItems = await Promise.all(acquisitions.map(async (acq, idx) => {
        let thumbUrl = '';
        if (acq.fileIds?.photo) {
            thumbUrl = await db.getFileUrl(acq.fileIds.photo);
            if (thumbUrl) state.blobUrls.push(thumbUrl);
        }

        return `
            <div class="gallery-item" data-history-acq-index="${idx}">
                <img src="${thumbUrl}" alt="Acquisition ${idx + 1}">
                <span>${formatTime(acq.timestamp)}</span>
            </div>
        `;
    }));

    elements.historyGalleryContainer.innerHTML = galleryItems.join('');

    // Add click handlers
    elements.historyGalleryContainer.querySelectorAll('.gallery-item').forEach(item => {
        item.addEventListener('click', () => {
            const idx = parseInt(item.dataset.historyAcqIndex, 10);
            showHistoryAcquisition(idx);
        });
    });
}

async function showHistoryAcquisition(idx) {
    const acquisition = state.historyAcquisitions[idx];
    if (!acquisition) return;

    state.historyCurrentAcquisition = acquisition;
    elements.historyResultSection.classList.remove('hidden');

    // Load photo
    if (acquisition.fileIds?.photo) {
        const photoUrl = await db.getFileUrl(acquisition.fileIds.photo);
        if (photoUrl) {
            state.blobUrls.push(photoUrl);
            elements.historyResultThumb.src = photoUrl;
        }
    } else {
        elements.historyResultThumb.src = '';
    }

    elements.historyResultTime.textContent = formatTime(acquisition.timestamp);

    if (acquisition.laserWavelength) {
        const modeKey = acquisition.detectionMode === 'auto' ? 'step3.results.wavelength.detected' : 'step3.results.wavelength.manual';
        elements.historyResultTime.textContent += ` | ${i18n.t(modeKey, { value: acquisition.laserWavelength.toFixed(1) })}`;
    }

    const identification = acquisition.identification;

    if (identification && identification.length > 0) {
        const top = identification[0];
        const threshold = 0.15;

        const closeMatchCount = identification
            .slice(1, 3)
            .filter(m => (top.score - m.score) <= threshold)
            .length;

        if (closeMatchCount > 0) {
            elements.historyResultSubstance.textContent = i18n.t('step3.results.withSimilar', { substance: top.substance, count: closeMatchCount });
        } else {
            elements.historyResultSubstance.textContent = top.substance;
        }

        const confidenceText = getConfidenceText(top.score);
        const confidenceClass = getConfidenceClass(top.score);
        elements.historyResultScore.textContent = `${top.score.toFixed(3)} | ${confidenceText}`;
        elements.historyResultScore.className = `result-score ${confidenceClass}`;
    } else {
        elements.historyResultSubstance.textContent = i18n.t('step3.results.unknown');
        elements.historyResultScore.textContent = i18n.t('step3.results.scoreNA');
        elements.historyResultScore.className = 'result-score';
    }

    // Set up action buttons
    elements.historyViewPlotBtn.onclick = () => showPlot(acquisition, 'summaryPlot');
    elements.historyViewPlotBtn.disabled = !acquisition.fileIds?.summaryPlot;

    const hasMultipleMatches = identification?.length > 1;
    elements.historyViewMatchesBtn.onclick = () => showMatches(identification);
    elements.historyViewMatchesBtn.disabled = !hasMultipleMatches;
    elements.historyViewMatchesBtn.classList.toggle('hidden', !hasMultipleMatches);

    elements.historyDownloadCsvBtn.onclick = () => downloadCsv(acquisition);
    elements.historyDownloadCsvBtn.disabled = !acquisition.csv;
}

function formatHistoryDate(isoString) {
    if (!isoString) return i18n.t('history.placeholder');
    const date = new Date(isoString);
    return date.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ============================================================================
// ZIP Export (no external deps)
// ============================================================================

let zipCrc32Table = null;

function getZipCrc32Table() {
    if (zipCrc32Table) return zipCrc32Table;

    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
        let crc = i;
        for (let bit = 0; bit < 8; bit++) {
            crc = (crc & 1) ? (0xEDB88320 ^ (crc >>> 1)) : (crc >>> 1);
        }
        table[i] = crc >>> 0;
    }

    zipCrc32Table = table;
    return table;
}

function crc32(data) {
    const table = getZipCrc32Table();
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < data.length; i++) {
        crc = table[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

function dateToDosDateTime(date) {
    const year = Math.min(2107, Math.max(1980, date.getFullYear()));
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const hours = date.getHours();
    const minutes = date.getMinutes();
    const seconds = Math.floor(date.getSeconds() / 2);

    const dosTime = (hours << 11) | (minutes << 5) | seconds;
    const dosDate = ((year - 1980) << 9) | (month << 5) | day;

    return { dosTime, dosDate };
}

function buildZipBlob(entries) {
    const encoder = new TextEncoder();
    const { dosTime, dosDate } = dateToDosDateTime(new Date());

    let offset = 0;
    const localParts = [];
    const centralParts = [];
    let centralSize = 0;

    for (const entry of entries) {
        const nameBytes = encoder.encode(entry.name);
        const dataBytes = entry.data;
        const checksum = crc32(dataBytes);

        // Local file header
        const localHeader = new Uint8Array(30 + nameBytes.length);
        const localView = new DataView(localHeader.buffer);
        localView.setUint32(0, 0x04034b50, true); // Local file header signature
        localView.setUint16(4, 20, true); // Version needed to extract
        localView.setUint16(6, 0, true); // General purpose bit flag
        localView.setUint16(8, 0, true); // Compression method (0 = store)
        localView.setUint16(10, dosTime, true);
        localView.setUint16(12, dosDate, true);
        localView.setUint32(14, checksum, true);
        localView.setUint32(18, dataBytes.length, true); // Compressed size
        localView.setUint32(22, dataBytes.length, true); // Uncompressed size
        localView.setUint16(26, nameBytes.length, true);
        localView.setUint16(28, 0, true); // Extra field length
        localHeader.set(nameBytes, 30);

        localParts.push(localHeader, dataBytes);

        // Central directory file header
        const centralHeader = new Uint8Array(46 + nameBytes.length);
        const centralView = new DataView(centralHeader.buffer);
        centralView.setUint32(0, 0x02014b50, true); // Central file header signature
        centralView.setUint16(4, 20, true); // Version made by
        centralView.setUint16(6, 20, true); // Version needed to extract
        centralView.setUint16(8, 0, true); // General purpose bit flag
        centralView.setUint16(10, 0, true); // Compression method
        centralView.setUint16(12, dosTime, true);
        centralView.setUint16(14, dosDate, true);
        centralView.setUint32(16, checksum, true);
        centralView.setUint32(20, dataBytes.length, true); // Compressed size
        centralView.setUint32(24, dataBytes.length, true); // Uncompressed size
        centralView.setUint16(28, nameBytes.length, true);
        centralView.setUint16(30, 0, true); // Extra field length
        centralView.setUint16(32, 0, true); // File comment length
        centralView.setUint16(34, 0, true); // Disk number start
        centralView.setUint16(36, 0, true); // Internal file attributes
        centralView.setUint32(38, 0, true); // External file attributes
        centralView.setUint32(42, offset, true); // Relative offset of local header
        centralHeader.set(nameBytes, 46);

        centralParts.push(centralHeader);
        centralSize += centralHeader.length;

        offset += localHeader.length + dataBytes.length;
    }

    // End of central directory record
    const end = new Uint8Array(22);
    const endView = new DataView(end.buffer);
    endView.setUint32(0, 0x06054b50, true); // End of central dir signature
    endView.setUint16(4, 0, true); // Number of this disk
    endView.setUint16(6, 0, true); // Disk where central directory starts
    endView.setUint16(8, entries.length, true); // Number of central directory records on this disk
    endView.setUint16(10, entries.length, true); // Total number of central directory records
    endView.setUint32(12, centralSize, true); // Size of central directory
    endView.setUint32(16, offset, true); // Offset of start of central directory
    endView.setUint16(20, 0, true); // Comment length

    return new Blob([...localParts, ...centralParts, end], { type: 'application/zip' });
}

// ============================================================================
// Actions
// ============================================================================

async function exportTest() {
    if (state.acquisitions.length === 0) {
        alert(i18n.t('errors.noAcquisitionsToExport'));
        return;
    }

    try {
        const entries = [];
        const encoder = new TextEncoder();

        // Add metadata
        entries.push({
            name: 'metadata.json',
            data: encoder.encode(JSON.stringify({
                event: state.session?.event || '',
                substance: state.session?.substance || '',
                appearance: state.session?.appearance || '',
                substanceDescription: state.session?.substanceDescription || '',
                notes: state.session?.notes || '',
                exportedAt: new Date().toISOString(),
                acquisitionCount: state.acquisitions.length,
                hasSubstancePhoto: !!state.session?.substancePhotoId,
            }, null, 2)),
        });

        // Add substance photo if present
        if (state.session?.substancePhotoId) {
            const photoFile = await db.getFile(state.session.substancePhotoId);
            if (photoFile?.data) {
                entries.push({
                    name: 'substance_photo.jpg',
                    data: new Uint8Array(await photoFile.data.arrayBuffer()),
                });
            }
        }

        // Add files for each acquisition
        for (let i = 0; i < state.acquisitions.length; i++) {
            const acq = state.acquisitions[i];
            const prefix = `acquisition_${String(i + 1).padStart(3, '0')}`;

            // Per-acquisition metadata (captured at time of acquisition)
            // Falls back to session values for backwards compatibility with older acquisitions
            entries.push({
                name: `${prefix}_metadata.json`,
                data: encoder.encode(JSON.stringify({
                    timestamp: acq.timestamp,
                    laserWavelength: acq.laserWavelength,
                    detectionMode: acq.detectionMode,
                    identification: acq.identification,
                    substance: acq.substance ?? state.session?.substance ?? '',
                    appearance: acq.appearance ?? state.session?.appearance ?? '',
                    customAppearance: acq.customAppearance ?? state.session?.customAppearance ?? '',
                    substanceDescription: acq.substanceDescription ?? state.session?.substanceDescription ?? '',
                }, null, 2)),
            });

            // Photo
            if (acq.fileIds?.photo) {
                const file = await db.getFile(acq.fileIds.photo);
                if (file?.data) {
                    entries.push({
                        name: `${prefix}.jpg`,
                        data: new Uint8Array(await file.data.arrayBuffer()),
                    });
                }
            }

            // Spectrum JSON
            if (acq.spectrum) {
                entries.push({
                    name: `${prefix}_spectrum.json`,
                    data: encoder.encode(JSON.stringify(acq.spectrum, null, 2)),
                });
            }

            // CSV
            if (acq.csv) {
                entries.push({
                    name: `${prefix}.csv`,
                    data: encoder.encode(acq.csv),
                });
            }

            // Summary plot
            if (acq.fileIds?.summaryPlot) {
                const file = await db.getFile(acq.fileIds.summaryPlot);
                if (file?.data) {
                    entries.push({
                        name: `${prefix}_summary.png`,
                        data: new Uint8Array(await file.data.arrayBuffer()),
                    });
                }
            }

            // Identification plot
            if (acq.fileIds?.identificationPlot) {
                const file = await db.getFile(acq.fileIds.identificationPlot);
                if (file?.data) {
                    entries.push({
                        name: `${prefix}_identification.png`,
                        data: new Uint8Array(await file.data.arrayBuffer()),
                    });
                }
            }
        }

        // Generate and download
        const blob = buildZipBlob(entries);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${state.session?.event || 'test'}_${new Date().toISOString().slice(0, 10)}.zip`;
        a.click();
        URL.revokeObjectURL(url);

    } catch (error) {
        console.error('Export failed:', error);
        showEnhancedAlert(i18n.t('errors.exportFailed.message', { error: error.message }), 'exportFailed');
    }
}

async function newTest() {
    if (!confirm(i18n.t('confirmations.newTest'))) return;

    try {
        // Create new session
        const newSession = await db.createSession({});
        state.currentSessionId = newSession.id;
        state.session = newSession;
        state.acquisitions = [];
        state.currentAcquisition = null;
        state.stepValidation = { step1: false, step2: false };

        // Clean up blob URLs
        cleanupBlobUrls();

        updateStep1Form();
        updateGalleryUI();
        await updateResultUI(null, null);
        goToStep(1);

    } catch (error) {
        console.error('Failed to create new session:', error);
        showEnhancedAlert(i18n.t('errors.sessionFailed.message'), 'sessionFailed');
    }
}

// ============================================================================
// Session Persistence (to IndexedDB)
// ============================================================================

async function saveSession() {
    if (!state.currentSessionId || !state.session) return;

    try {
        await db.updateSession(state.currentSessionId, {
            event: state.session.event,
            substance: state.session.substance,
            appearance: state.session.appearance,
            customAppearance: state.session.customAppearance,
            substanceDescription: state.session.substanceDescription,
            notes: state.session.notes,
        });
    } catch (error) {
        console.error('Failed to save session:', error);
    }
}

async function loadSession() {
    try {
        let session = await db.getCurrentSession();

        if (!session) {
            // Create new session if none exists
            session = await db.createSession({});
        }

        state.currentSessionId = session.id;
        state.session = session;

        // Load acquisitions
        state.acquisitions = await db.getAcquisitionsBySession(session.id);

    } catch (error) {
        console.error('Failed to load session:', error);
    }
}

async function loadSettings() {
    try {
        state.settings = await db.getSettings();
        updateSettingsUI();
        updateSyncSettingsUI();

        // Sync camera settings to Pi (non-blocking, don't await)
        const cameraSettings = state.settings.cameraSettings || {};
        api.updateSettings({
            shutter: cameraSettings.shutter || 5.0,
            gain: cameraSettings.gain || 100,
            laser_auto_detect: cameraSettings.laserAutoDetect !== false,
            laser_wavelength: cameraSettings.laserWavelength || 785,
        }).catch(error => {
            console.warn('Could not sync settings to Pi:', error.message);
        });

    } catch (error) {
        console.error('Failed to load settings:', error);
    }
}

// ============================================================================
// Settings Panel
// ============================================================================

function openSettings() {
    elements.settingsPanel.classList.add('open');
    elements.overlay.classList.remove('hidden');
    elements.overlay.classList.add('visible');
    loadVersionInfo();
}

function closeSettings() {
    elements.settingsPanel.classList.remove('open');
    elements.overlay.classList.remove('visible');
    setTimeout(() => elements.overlay.classList.add('hidden'), 300);
}

// ============================================================================
// Sync
// ============================================================================

async function loadSyncSettings() {
    try {
        state.settings = await db.getSettings();
        updateSyncSettingsUI();
    } catch (error) {
        console.error('Failed to load sync settings:', error);
    }
}

async function loadSyncStatus() {
    try {
        const status = await sync.getSyncStatus();
        state.syncStatus = status;
        updateSyncIndicator();
    } catch (error) {
        console.error('Failed to load sync status:', error);
    }
}

function updateSyncSettingsUI() {
    elements.syncServerUrl.value = state.settings?.syncServerUrl || '';
    elements.syncToken.value = '';  // Never show full token
    elements.autoSyncToggle.checked = state.settings?.autoSync || false;

    // Show token status
    if (elements.syncTokenStatus) {
        if (state.settings?.syncToken) {
            const preview = state.settings.syncToken.substring(0, 8);
            elements.syncTokenStatus.textContent = i18n.t('settings.sync.tokenStatus.configured', { preview });
            elements.syncTokenStatus.className = 'sync-token-status configured';
        } else {
            elements.syncTokenStatus.textContent = i18n.t('settings.sync.tokenStatus.notConfigured');
            elements.syncTokenStatus.className = 'sync-token-status not-configured';
        }
    }
}

function updateSyncIndicator() {
    const { pending, configured, syncing } = state.syncStatus;

    // Update badge
    if (pending > 0) {
        elements.syncBadge.textContent = pending;
        elements.syncBadge.classList.remove('hidden');
        elements.syncIndicator.classList.add('has-pending');
    } else {
        elements.syncBadge.classList.add('hidden');
        elements.syncIndicator.classList.remove('has-pending');
    }

    // Update syncing animation
    elements.syncIndicator.classList.toggle('syncing', syncing);

    // Update pending count display
    if (elements.pendingCount) {
        elements.pendingCount.textContent = i18n.t('settings.sync.pending', { count: pending });
    }
}

async function saveSyncSettings() {
    const updates = {
        syncServerUrl: elements.syncServerUrl.value,
        autoSync: elements.autoSyncToggle.checked,
    };

    // Only include token if it was entered
    const token = elements.syncToken.value;
    if (token) {
        updates.syncToken = token;
    }

    try {
        await db.updateSettings(updates);
        state.settings = await db.getSettings();
        updateSyncSettingsUI();
        showSyncFeedback(i18n.t('settings.sync.saved'), 'success');

        // Start/stop background sync
        if (state.settings.autoSync && state.settings.syncServerUrl && state.settings.syncToken) {
            sync.startBackgroundSync();
        } else {
            sync.stopBackgroundSync();
        }

    } catch (error) {
        console.error('Failed to save sync settings:', error);
        showSyncFeedback(i18n.t('settings.sync.saveFailed'), 'error');
    }
}

async function testSyncConnection() {
    showSyncFeedback(i18n.t('settings.sync.testing'), 'syncing');
    elements.testSyncBtn.disabled = true;

    try {
        const result = await sync.testConnection();
        if (result.success) {
            showSyncFeedback(i18n.t('settings.sync.connectionSuccess'), 'success');
        } else {
            showSyncFeedback(result.error || i18n.t('settings.sync.connectionFailed'), 'error');
        }
    } catch (error) {
        showSyncFeedback(i18n.t('settings.sync.connectionFailed'), 'error');
    } finally {
        elements.testSyncBtn.disabled = false;
    }
}

async function syncNow() {
    if (state.syncStatus.syncing) return;

    state.syncStatus.syncing = true;
    updateSyncIndicator();
    showSyncFeedback(i18n.t('settings.syncing.inProgress'), 'syncing');
    elements.syncNowBtn.disabled = true;

    try {
        // Queue all unsynced sessions (including past sessions)
        await sync.queueAllUnsyncedSessions();

        // Then sync all pending
        const result = await sync.syncAll();
        if (result.errors?.length > 0) {
            showSyncFeedback(i18n.t('settings.syncing.completeWithErrors', { synced: result.synced, failed: result.failed }), 'error');
            // Log errors to console for debugging
            console.warn('Sync errors:', result.errors);
            // Show first error as additional detail
            if (result.errors[0]) {
                setTimeout(() => {
                    showSyncFeedback(result.errors[0], 'error');
                }, 2000);
            }
        } else {
            showSyncFeedback(i18n.t('settings.syncing.complete', { synced: result.synced }), 'success');
        }
        await loadSyncStatus();
    } catch (error) {
        showSyncFeedback(error.message || i18n.t('settings.syncing.failed'), 'error');
    } finally {
        state.syncStatus.syncing = false;
        updateSyncIndicator();
        elements.syncNowBtn.disabled = false;
    }
}

async function resyncAll() {
    if (state.syncStatus.syncing) return;

    // Confirm with user since this re-uploads all data
    if (!confirm(i18n.t('confirmations.resyncAll'))) {
        return;
    }

    state.syncStatus.syncing = true;
    updateSyncIndicator();
    showSyncFeedback(i18n.t('settings.syncing.resyncInProgress'), 'syncing');
    elements.syncNowBtn.disabled = true;
    elements.resyncAllBtn.disabled = true;

    try {
        const result = await sync.forceResyncAll();
        if (result.errors?.length > 0) {
            showSyncFeedback(i18n.t('settings.syncing.completeWithErrors', { synced: result.synced, failed: result.failed }), 'error');
            console.warn('Re-sync errors:', result.errors);
            if (result.errors[0]) {
                setTimeout(() => {
                    showSyncFeedback(result.errors[0], 'error');
                }, 2000);
            }
        } else {
            showSyncFeedback(i18n.t('settings.syncing.resyncComplete', { synced: result.synced }), 'success');
        }
        await loadSyncStatus();
    } catch (error) {
        showSyncFeedback(error.message || i18n.t('settings.syncing.failed'), 'error');
    } finally {
        state.syncStatus.syncing = false;
        updateSyncIndicator();
        elements.syncNowBtn.disabled = false;
        elements.resyncAllBtn.disabled = false;
    }
}

function showSyncFeedback(message, type) {
    if (!elements.syncStatusEl) return;

    elements.syncStatusEl.textContent = message;
    elements.syncStatusEl.className = `sync-status ${type}`;

    // Reset after 3 seconds
    if (type !== 'syncing') {
        setTimeout(() => {
            elements.syncStatusEl.textContent = i18n.t('settings.sync.pending', { count: state.syncStatus.pending });
            elements.syncStatusEl.className = 'sync-status';
        }, 3000);
    }
}

function handleSyncIndicatorClick() {
    openSettings();
}

// Poll sync status periodically
let syncStatusInterval = null;

function startSyncStatusPolling() {
    if (syncStatusInterval) return;
    syncStatusInterval = setInterval(loadSyncStatus, 60000);  // Every minute
}

function stopSyncStatusPolling() {
    if (syncStatusInterval) {
        clearInterval(syncStatusInterval);
        syncStatusInterval = null;
    }
}

// ============================================================================
// Version Management
// ============================================================================

const VERSION_CONFIG = {
    githubBase: 'https://zeegomo.github.io/spettromiao-webapp',
    loaderCacheDb: 'spettromiao-loader-cache',
    loaderCacheStore: 'app-files',
    cacheVersionKey: 'cache-version',
};

// Files to fetch from GitHub for updates (must match pi-loader)
const UPDATE_APP_FILES = [
    'index.html',
    'css/style.css',
    'js/db.js',
    'js/identifier.js',
    'js/sync.js',
    'js/app.js',
    'manifest.json',
    'sw.js',
    'data/library.json'
];

// Store remote version when available
let remoteVersionCache = null;

function openLoaderCacheDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(VERSION_CONFIG.loaderCacheDb, 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(VERSION_CONFIG.loaderCacheStore)) {
                db.createObjectStore(VERSION_CONFIG.loaderCacheStore, { keyPath: 'path' });
            }
        };
    });
}

async function getCurrentVersion() {
    try {
        const db = await openLoaderCacheDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(VERSION_CONFIG.loaderCacheStore, 'readonly');
            const store = tx.objectStore(VERSION_CONFIG.loaderCacheStore);
            const request = store.get(VERSION_CONFIG.cacheVersionKey);
            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result?.content || null);
        });
    } catch (error) {
        console.error('Failed to get current version:', error);
        return null;
    }
}

async function fetchRemoteVersion() {
    try {
        const response = await fetch(`${VERSION_CONFIG.githubBase}/version.txt?t=${Date.now()}`, {
            signal: AbortSignal.timeout(10000)
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const version = await response.text();
        return version.trim();
    } catch (error) {
        console.error('Failed to fetch remote version:', error);
        return null;
    }
}

async function loadVersionInfo() {
    const currentVersion = await getCurrentVersion();
    elements.currentVersion.textContent = currentVersion || 'unknown';
}

function showVersionStatus(message, type) {
    if (!elements.versionStatus) return;
    elements.versionStatus.textContent = message;
    elements.versionStatus.className = `version-status ${type}`;
}

async function checkForUpdates() {
    showVersionStatus(i18n.t('settings.version.checking'), 'checking');
    elements.checkUpdateBtn.disabled = true;
    elements.updateNowBtn.classList.add('hidden');

    try {
        const [currentVersion, remoteVersion] = await Promise.all([
            getCurrentVersion(),
            fetchRemoteVersion()
        ]);

        elements.currentVersion.textContent = currentVersion || i18n.t('settings.version.unknown');

        if (!remoteVersion) {
            showVersionStatus(i18n.t('settings.version.couldNotCheck'), 'error');
            return;
        }

        remoteVersionCache = remoteVersion;

        if (!currentVersion) {
            showVersionStatus(i18n.t('settings.version.available', { version: remoteVersion }), 'update-available');
            elements.updateNowBtn.classList.remove('hidden');
        } else if (currentVersion === remoteVersion) {
            showVersionStatus(i18n.t('settings.version.upToDate'), 'up-to-date');
        } else {
            showVersionStatus(i18n.t('settings.version.available', { version: remoteVersion }), 'update-available');
            elements.updateNowBtn.classList.remove('hidden');
        }
    } catch (error) {
        console.error('Error checking for updates:', error);
        showVersionStatus(i18n.t('settings.version.couldNotCheck'), 'error');
    } finally {
        elements.checkUpdateBtn.disabled = false;
    }
}

async function triggerUpdate() {
    showVersionStatus(i18n.t('settings.version.downloading'), 'checking');
    elements.updateNowBtn.disabled = true;
    elements.checkUpdateBtn.disabled = true;

    try {
        const db = await openLoaderCacheDB();
        const files = {};

        // Fetch all files from GitHub
        const fetchPromises = UPDATE_APP_FILES.map(async (path) => {
            const response = await fetch(
                `${VERSION_CONFIG.githubBase}/${path}?t=${Date.now()}`,
                { signal: AbortSignal.timeout(30000) }
            );
            if (!response.ok) throw new Error(`Failed to fetch ${path}: HTTP ${response.status}`);
            const content = await response.text();
            files[path] = content;

            // Cache the file
            const tx = db.transaction(VERSION_CONFIG.loaderCacheStore, 'readwrite');
            const store = tx.objectStore(VERSION_CONFIG.loaderCacheStore);
            await new Promise((resolve, reject) => {
                const request = store.put({ path, content, timestamp: Date.now() });
                request.onerror = () => reject(request.error);
                request.onsuccess = () => resolve();
            });
        });

        await Promise.all(fetchPromises);

        // Save the new version
        if (remoteVersionCache) {
            const tx = db.transaction(VERSION_CONFIG.loaderCacheStore, 'readwrite');
            const store = tx.objectStore(VERSION_CONFIG.loaderCacheStore);
            await new Promise((resolve, reject) => {
                const request = store.put({
                    path: VERSION_CONFIG.cacheVersionKey,
                    content: remoteVersionCache,
                    timestamp: Date.now()
                });
                request.onerror = () => reject(request.error);
                request.onsuccess = () => resolve();
            });
        }

        showVersionStatus(i18n.t('settings.version.applying'), 'checking');

        // Render the new version immediately
        renderAppFromFiles(files);
    } catch (error) {
        console.error('Error triggering update:', error);
        showVersionStatus(i18n.t('settings.version.failed', { error: error.message }), 'error');
        elements.updateNowBtn.disabled = false;
        elements.checkUpdateBtn.disabled = false;
    }
}

function renderAppFromFiles(files) {
    // Parse the HTML
    const parser = new DOMParser();
    const doc = parser.parseFromString(files['index.html'], 'text/html');

    // Inline the CSS
    const styleLinks = doc.querySelectorAll('link[rel="stylesheet"]');
    styleLinks.forEach(link => {
        const href = link.getAttribute('href');
        const cssPath = href.startsWith('./') ? href.slice(2) : href;
        if (files[cssPath]) {
            const style = doc.createElement('style');
            style.textContent = files[cssPath];
            link.replaceWith(style);
        }
    });

    // Inline the JavaScript
    const scripts = doc.querySelectorAll('script[src]');
    scripts.forEach(script => {
        const src = script.getAttribute('src');
        const jsPath = src.startsWith('./') ? src.slice(2) : src;
        if (files[jsPath]) {
            const newScript = doc.createElement('script');
            newScript.textContent = files[jsPath];
            script.replaceWith(newScript);
        }
    });

    // Update manifest link to inline data URL
    if (files['manifest.json']) {
        const manifestLink = doc.querySelector('link[rel="manifest"]');
        if (manifestLink) {
            const dataUrl = 'data:application/json,' + encodeURIComponent(files['manifest.json']);
            manifestLink.setAttribute('href', dataUrl);
        }
    }

    // Write the complete document
    document.open();
    document.write(doc.documentElement.outerHTML);
    document.close();
}

// ============================================================================
// Library Sync (for browser-side identification)
// ============================================================================

async function syncLibrary() {
    if (state.libraryStatus.syncing) return;

    state.libraryStatus.syncing = true;
    console.log('Syncing identification library...');

    try {
        const result = await identifier.sync((progress) => {
            console.log(`Library sync: ${progress}%`);
        });

        state.libraryStatus.ready = result.synced;
        state.libraryStatus.substanceCount = result.substanceCount;
        state.libraryStatus.version = identifier.getVersion();

        if (result.synced) {
            console.log(`Library ready: ${result.substanceCount} substances (v${state.libraryStatus.version}), from cache: ${result.fromCache}`);
            // Populate substance autocomplete list
            populateSubstanceList();
        } else {
            console.warn('Library sync failed');
        }
    } catch (error) {
        console.error('Library sync error:', error);
        state.libraryStatus.ready = false;
    } finally {
        state.libraryStatus.syncing = false;
        // Show/hide library warning banner
        if (!state.libraryStatus.ready && state.libraryStatus.substanceCount === 0) {
            elements.libraryWarningBanner?.classList.remove('hidden');
        } else {
            elements.libraryWarningBanner?.classList.add('hidden');
        }
    }
}

// ============================================================================
// Cleanup
// ============================================================================

function cleanupBlobUrls() {
    for (const url of state.blobUrls) {
        URL.revokeObjectURL(url);
    }
    state.blobUrls = [];
}

// ============================================================================
// Event Listeners
// ============================================================================

function setupEventListeners() {
    // Theme toggle
    elements.darkModeToggle.addEventListener('change', (e) => setTheme(e.target.checked));

    // Settings panel
    elements.settingsBtn.addEventListener('click', openSettings);
    elements.closeSettingsBtn.addEventListener('click', closeSettings);
    elements.overlay.addEventListener('click', closeSettings);

    // Step 1 inputs
    elements.eventNameInput.addEventListener('input', handleStep1InputChange);
    elements.substanceInput.addEventListener('input', handleStep1InputChange);
    elements.notesInput.addEventListener('input', handleStep1InputChange);
    elements.appearanceSelect.addEventListener('change', handleAppearanceChange);
    elements.customAppearanceInput.addEventListener('input', handleCustomAppearanceChange);
    elements.substanceDescInput.addEventListener('input', handleSubstanceDescChange);
    elements.takePhotoBtn.addEventListener('click', () => elements.substancePhotoInput.click());
    elements.substancePhotoInput.addEventListener('change', handleSubstancePhotoSelect);
    elements.removePhotoBtn.addEventListener('click', handleRemoveSubstancePhoto);
    elements.step1NextBtn.addEventListener('click', handleStep1Next);

    // Step 2 controls
    elements.startPreviewBtn.addEventListener('click', startPreview);
    elements.stopPreviewBtn.addEventListener('click', stopPreview);
    elements.step2BackBtn.addEventListener('click', handleStep2Back);
    elements.step2ConfirmBtn.addEventListener('click', handleStep2Confirm);
    elements.filterBayModalOk.addEventListener('click', handleFilterBayModalOk);

    // Step 3 controls
    elements.captureBtn.addEventListener('click', capture);
    elements.galleryToggle.addEventListener('click', toggleGallery);
    elements.step3BackBtn.addEventListener('click', () => goToStep(2));
    elements.newTestBtn.addEventListener('click', newTest);
    elements.exportBtn.addEventListener('click', exportTest);

    // Inline shutter/gain popups
    elements.shutterDisplay.addEventListener('click', (e) => {
        e.stopPropagation();
        elements.gainPopup.classList.add('hidden');
        elements.shutterPopup.classList.toggle('hidden');
    });

    elements.gainDisplay.addEventListener('click', (e) => {
        e.stopPropagation();
        elements.shutterPopup.classList.add('hidden');
        elements.gainPopup.classList.toggle('hidden');
    });

    document.addEventListener('click', (e) => {
        if (!elements.shutterSetting.contains(e.target)) {
            elements.shutterPopup.classList.add('hidden');
        }
        if (!elements.gainSetting.contains(e.target)) {
            elements.gainPopup.classList.add('hidden');
        }
    });

    elements.shutterPopup.addEventListener('click', (e) => e.stopPropagation());
    elements.gainPopup.addEventListener('click', (e) => e.stopPropagation());

    elements.shutterSlider.addEventListener('input', () => {
        const value = parseFloat(elements.shutterSlider.value);
        elements.shutterDisplay.textContent = i18n.t('step3.shutter.display', { value: value.toFixed(1) });
    });
    elements.shutterSlider.addEventListener('change', saveSettings);

    elements.gainSlider.addEventListener('input', () => {
        const value = Math.round(parseFloat(elements.gainSlider.value));
        elements.gainDisplay.textContent = i18n.t('step3.gain.display', { value });
    });
    elements.gainSlider.addEventListener('change', saveSettings);

    elements.laserAutoDetect.addEventListener('change', saveSettings);
    elements.laserWavelength.addEventListener('change', saveSettings);

    // Plot modal
    elements.closePlotModal.addEventListener('click', () => {
        elements.plotModal.classList.add('hidden');
    });
    elements.plotModal.addEventListener('click', (e) => {
        if (e.target === elements.plotModal) {
            elements.plotModal.classList.add('hidden');
        }
    });

    // Matches modal
    elements.closeMatchesModal.addEventListener('click', () => {
        elements.matchesModal.classList.add('hidden');
    });
    elements.matchesModal.addEventListener('click', (e) => {
        if (e.target === elements.matchesModal) {
            elements.matchesModal.classList.add('hidden');
        }
    });

    // History modal
    elements.historyBtn.addEventListener('click', openHistoryModal);
    elements.closeHistoryModal.addEventListener('click', closeHistoryModal);
    elements.historyBackBtn.addEventListener('click', showHistoryListView);
    elements.historyModal.addEventListener('click', (e) => {
        if (e.target === elements.historyModal) {
            closeHistoryModal();
        }
    });

    // Help modal
    elements.helpBtn.addEventListener('click', () => openHelpModal());
    elements.closeHelpModal.addEventListener('click', closeHelpModal);
    elements.helpModal.addEventListener('click', (e) => {
        if (e.target === elements.helpModal) {
            closeHelpModal();
        }
    });
    elements.helpTabs.forEach((tab, index) => {
        tab.addEventListener('click', () => switchHelpTab(index));
    });
    if (elements.piWarningHelpLink) {
        elements.piWarningHelpLink.addEventListener('click', (e) => {
            e.preventDefault();
            openHelpModal('connection');
        });
    }

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeSettings();
            closeHistoryModal();
            closeHelpModal();
            elements.plotModal.classList.add('hidden');
            elements.matchesModal.classList.add('hidden');
        }
    });

    // Sync controls
    elements.syncIndicator.addEventListener('click', handleSyncIndicatorClick);
    elements.syncServerUrl.addEventListener('change', saveSyncSettings);
    elements.syncToken.addEventListener('change', saveSyncSettings);
    elements.autoSyncToggle.addEventListener('change', saveSyncSettings);
    elements.testSyncBtn.addEventListener('click', testSyncConnection);
    elements.syncNowBtn.addEventListener('click', syncNow);
    elements.resyncAllBtn.addEventListener('click', resyncAll);

    // Version controls
    elements.checkUpdateBtn.addEventListener('click', checkForUpdates);
    elements.updateNowBtn.addEventListener('click', triggerUpdate);

    // Language radio button handlers
    if (elements.langRadioEn && elements.langRadioIt) {
        [elements.langRadioEn, elements.langRadioIt].forEach(radio => {
            radio.addEventListener('change', async (e) => {
                if (e.target.checked) {
                    await i18n.setLanguage(e.target.value);
                }
            });
        });
    }

    // Cleanup on page unload
    window.addEventListener('beforeunload', cleanupBlobUrls);
}

// ============================================================================
// Startup Modal
// ============================================================================

let startupModalDelayTimer = null;
let startupModalVisible = false;
let startupModalListenersBound = false;
let startupStatusTitle = null;
let startupStatusMessage = null;

function setStartupStatus(message, title = startupStatusTitle) {
    startupStatusTitle = title;
    startupStatusMessage = message;

    if (!startupModalVisible) return;
    if (!elements.startupModalTitle || !elements.startupModalMessage) return;

    elements.startupModalTitle.textContent = startupStatusTitle;
    elements.startupModalMessage.textContent = startupStatusMessage;
}

function showStartupModal({
    title = startupStatusTitle,
    message = startupStatusMessage,
    showReset = false,
} = {}) {
    if (startupModalDelayTimer) {
        clearTimeout(startupModalDelayTimer);
        startupModalDelayTimer = null;
    }

    // Fallback: if modal isn't available (e.g., mismatched cached HTML), use alert.
    if (!elements.startupModal || !elements.startupModalTitle || !elements.startupModalMessage) {
        const combined = [title, message].filter(Boolean).join('\n\n');
        alert(combined || i18n.t('modals.startup.error'));
        return;
    }

    startupModalVisible = true;
    elements.startupModalTitle.textContent = title;
    elements.startupModalMessage.textContent = message;
    elements.startupModal.classList.remove('hidden');

    if (elements.startupResetBtn) {
        elements.startupResetBtn.classList.toggle('hidden', !showReset);
    }
}

function hideStartupModal() {
    if (startupModalDelayTimer) {
        clearTimeout(startupModalDelayTimer);
        startupModalDelayTimer = null;
    }

    startupModalVisible = false;
    if (elements.startupModal) {
        elements.startupModal.classList.add('hidden');
    }
}

function scheduleStartupModal(delayMs = 800) {
    if (startupModalVisible) return;
    if (startupModalDelayTimer) return;
    if (!elements.startupModal || !elements.startupModalTitle || !elements.startupModalMessage) return;

    startupModalDelayTimer = setTimeout(() => {
        startupModalDelayTimer = null;
        showStartupModal();
    }, delayMs);
}

function deleteIndexedDbDatabase(name) {
    return new Promise((resolve, reject) => {
        const request = indexedDB.deleteDatabase(name);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
        request.onblocked = () => resolve();
    });
}

async function resetLocalData() {
    const confirmed = confirm(
        i18n.t('confirmations.resetData')
    );
    if (!confirmed) return;

    try {
        // Best-effort clear (avoid hanging if IndexedDB is broken)
        if (db?.clearAllData) {
            await Promise.race([
                db.clearAllData(),
                new Promise((_, reject) => setTimeout(() => reject(new Error('clearAllData timeout')), 1500)),
            ]);
        }
    } catch (error) {
        console.warn('Failed to clear local data:', error);
    }

    try {
        const dbName = (typeof DB_NAME === 'string' && DB_NAME) ? DB_NAME : 'spettromiao-mobile';
        await deleteIndexedDbDatabase(dbName);
    } catch (error) {
        console.warn('Failed to delete local database:', error);
    }

    window.location.reload();
}

function setupStartupModalEventListeners() {
    if (startupModalListenersBound) return;
    startupModalListenersBound = true;

    if (elements.startupReloadBtn) {
        elements.startupReloadBtn.addEventListener('click', () => window.location.reload());
    }

    if (elements.startupResetBtn) {
        elements.startupResetBtn.addEventListener('click', () => resetLocalData());
    }
}

function registerServiceWorkerInBackground() {
    if (!('serviceWorker' in navigator)) return;

    // The Pi loader already handles caching; avoid SW registration on the Pi.
    if (window.location.hostname === '192.168.4.1') return;

    try {
        navigator.serviceWorker.register('sw.js')
            .then(() => console.log('Service Worker registered'))
            .catch((error) => console.warn('Service Worker registration failed:', error));
    } catch (error) {
        console.warn('Service Worker registration failed:', error);
    }
}

let globalErrorHandlersInstalled = false;
let startupFatalErrorShown = false;

function installGlobalErrorHandlers() {
    if (globalErrorHandlersInstalled) return;
    globalErrorHandlersInstalled = true;

    window.addEventListener('error', (event) => {
        if (state.appReady) return;
        if (startupFatalErrorShown) return;
        startupFatalErrorShown = true;

        console.error('Global error during startup:', event.error || event.message);

        const message = event?.error?.message || event?.message || 'Unknown error';
        showStartupModal({
            title: i18n.t('modals.startup.error'),
            message,
            showReset: true,
        });
    });

    window.addEventListener('unhandledrejection', (event) => {
        if (state.appReady) return;
        if (startupFatalErrorShown) return;
        startupFatalErrorShown = true;

        console.error('Unhandled promise rejection during startup:', event.reason);

        const message = event?.reason?.message || String(event.reason) || 'Unknown error';
        showStartupModal({
            title: i18n.t('modals.startup.error'),
            message,
            showReset: true,
        });
    });
}

// ============================================================================
// Initialization
// ============================================================================

async function init() {
    if (state.initInProgress || state.appReady) return;
    state.initInProgress = true;

    setupStartupModalEventListeners();
    registerServiceWorkerInBackground();

    // Initialize i18n first (before any i18n.t() calls)
    await i18n.init();

    try {
        // Show a modal only if startup is slow (avoids flicker on fast loads).
        setStartupStatus(i18n.t('modals.startup.openingStorage'), i18n.t('modals.startup.title'));
        scheduleStartupModal();

        // Default to "disconnected" UI until proven connected.
        updatePiConnectionUI();

        // Initialize IndexedDB (required for core functionality)
        await db.openDB();

        // Setup event listeners early - before any network calls that might block
        // Note: handlers access state.session but only fire on user interaction,
        // which happens after loadSession() completes below
        setupEventListeners();

        // Start Pi connectivity monitoring (non-overlapping polling)
        startPiConnectivityMonitoring();

        setStartupStatus(i18n.t('modals.startup.loadingSettings'));
        await loadSettings();
        setTheme(state.settings?.theme !== 'light');

        setStartupStatus(i18n.t('modals.startup.loadingSessions'));
        await loadSession();

        await loadSyncStatus();

        // Sync identification library (runs in background)
        syncLibrary();

        // Start polling sync status
        startSyncStatusPolling();

        // Start background sync if enabled
        if (state.settings?.autoSync && state.settings?.syncServerUrl && state.settings?.syncToken) {
            sync.startBackgroundSync();
        }

        // Populate Step 1 form
        updateStep1Form();

        // Determine starting step
        const savedStep = localStorage.getItem('wizardStep');

        if (state.acquisitions.length > 0) {
            // If there are acquisitions, go to step 3
            state.currentStep = 3;
            state.stepValidation.step1 = true;
            state.stepValidation.step2 = true;
        } else if (savedStep && parseInt(savedStep, 10) > 1 && validateStep1()) {
            // Resume from saved step if Step 1 is still valid
            state.currentStep = parseInt(savedStep, 10);
            if (state.currentStep === 3) {
                state.stepValidation.step2 = true;
            }
        }

        updateStepIndicator();
        showCurrentStep();

        state.appReady = true;
        hideStartupModal();
    } catch (error) {
        console.error('App initialization failed:', error);

        // Check if this is a storage/IndexedDB access denied error
        const errorMessage = error?.message || String(error);
        const isStorageAccessDenied = /denied|blocked|access|UnknownError/i.test(errorMessage) &&
            /database|storage|indexeddb/i.test(errorMessage);

        if (isStorageAccessDenied) {
            showStartupModal({
                title: i18n.t('modals.startup.storageAccessDenied'),
                message: i18n.t('modals.startup.storageAccessDeniedMessage'),
                showReset: false, // Reset won't help if storage is blocked
            });
        } else {
            showStartupModal({
                title: i18n.t('modals.startup.failed'),
                message: errorMessage,
                showReset: true,
            });
        }
    } finally {
        state.initInProgress = false;
    }
}

installGlobalErrorHandlers();

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
