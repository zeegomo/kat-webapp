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
};

// ============================================================================
// DOM Elements
// ============================================================================

const elements = {
    // Header
    settingsBtn: document.getElementById('settingsBtn'),
    piWarningBanner: document.getElementById('piWarningBanner'),

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
    pendingCount: document.getElementById('pendingCount'),
    syncStatusEl: document.getElementById('syncStatus'),

    // Version
    currentVersion: document.getElementById('currentVersion'),
    versionStatus: document.getElementById('versionStatus'),
    checkUpdateBtn: document.getElementById('checkUpdateBtn'),
    updateNowBtn: document.getElementById('updateNowBtn'),
};

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

    async get(endpoint) {
        const response = await this.fetchWithTimeout(`${PI_API_URL}/api${endpoint}`);
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
    async getPreviewStatus() { return this.get('/preview/status'); },
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
 * @param {number} connectionTimeout - Timeout in ms for initial connection (default: 10000)
 * @returns {Promise<void>}
 */
async function fetchSSE(url, handlers, controller, connectionTimeout = 10000) {
    const fetchOptions = {
        signal: controller.signal,
    };
    if (NEEDS_LNA) {
        fetchOptions.targetAddressSpace = 'local';
    }

    // Add timeout for initial connection to prevent hanging when offline
    const timeoutId = setTimeout(() => {
        controller.abort();
    }, connectionTimeout);

    try {
        const response = await fetch(url, fetchOptions);
        clearTimeout(timeoutId); // Connection established, clear timeout

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
    } finally {
        clearTimeout(timeoutId); // Always clear timeout
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
        alert('Failed to save photo: ' + error.message);
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
                        reject(new Error('Failed to compress image'));
                    }
                },
                'image/jpeg',
                quality
            );
        };

        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error('Failed to load image'));
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
            elements.previewStatus.textContent = `Error: ${response.message}`;
            return;
        }

        state.previewActive = true;

        // Add error handler for stream loading failures
        elements.previewImage.onerror = (e) => {
            console.error('Preview stream error:', e);
            elements.previewStatus.textContent = 'Stream failed to load';
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
        elements.previewStatus.textContent = `Error: ${error.message}`;
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
    if (exp_us < 300) return { text: 'Perfect', class: 'exp-perfect' };
    if (exp_us < 3000) return { text: 'Good', class: 'exp-good' };
    if (exp_us < 6000) return { text: 'Mediocre', class: 'exp-mediocre' };
    if (exp_us < 10000) return { text: 'Scarce', class: 'exp-scarce' };
    return { text: 'Bad', class: 'exp-bad' };
}

async function pollPreviewStatus() {
    if (!state.previewActive) return;

    try {
        const status = await api.getPreviewStatus();
        console.log('Preview status:', status);
        if (status.streaming) {
            const expInfo = getExposureInfo(status.exposure_us);
            elements.previewStatus.innerHTML = `${status.fps} FPS<br><span class="${expInfo.class}">${status.exposure_us}μs (${expInfo.text})</span>`;
        } else {
            console.warn('Stream stopped unexpectedly');
            elements.previewStatus.textContent = 'Stream stopped';
            resetPreviewUI();
            return;  // Stop polling
        }
    } catch (error) {
        console.error('Status poll error:', error);
        elements.previewStatus.textContent = 'Connection error';
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
    elements.calibrationStatus.textContent = `Camera: ${camera_calibration ? 'OK' : 'Missing'} | Wavelength: ${wavelength_calibration ? 'OK' : 'Missing'}`;
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
    elements.shutterDisplay.textContent = `${(cameraSettings.shutter || 5.0).toFixed(1)}s`;
    elements.gainSlider.value = cameraSettings.gain || 100;
    elements.gainDisplay.textContent = `gain ${Math.round(cameraSettings.gain || 100)}`;
    elements.laserAutoDetect.checked = cameraSettings.laserAutoDetect !== false;
    elements.laserWavelength.value = cameraSettings.laserWavelength || 785;
    updateLaserWavelengthVisibility();
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
    elements.progressText.textContent = 'Starting...';

    const controller = new AbortController();
    let captureTimeout = null;
    let exposureTimer = null;
    let completed = false;
    const shutterTime = state.settings?.cameraSettings?.shutter || 5.0;

    const cleanup = () => {
        if (captureTimeout) clearTimeout(captureTimeout);
        if (exposureTimer) clearInterval(exposureTimer);
        if (!completed) controller.abort();
    };

    // Start exposure progress animation
    const exposureStartTime = Date.now();
    const exposureDurationMs = shutterTime * 1000;
    const startProgress = 10;
    const endProgress = 35;

    elements.progressFill.style.width = `${startProgress}%`;
    exposureTimer = setInterval(() => {
        const elapsed = Date.now() - exposureStartTime;
        const fraction = Math.min(elapsed / exposureDurationMs, 1);
        const currentProgress = startProgress + (endProgress - startProgress) * fraction;
        elements.progressFill.style.width = `${currentProgress}%`;

        const remaining = Math.max(0, shutterTime - (elapsed / 1000));
        elements.progressText.textContent = `Exposing... ${remaining.toFixed(1)}s`;
    }, 100);

    // Timeout after 30 seconds if no result
    captureTimeout = setTimeout(() => {
        cleanup();
        captureError('Capture timed out - camera may be stuck');
    }, 30000);

    try {
        // Use fetchSSE for Local Network Access compatibility
        await fetchSSE(`${PI_API_URL}/api/capture`, {
            onProgress: (data) => {
                // Clear exposure timer when backend takes over
                if (exposureTimer) {
                    clearInterval(exposureTimer);
                    exposureTimer = null;
                }
                elements.progressFill.style.width = `${data.progress}%`;
                elements.progressText.textContent = data.message;
            },
            onResult: async (result) => {
                try {
                    completed = true;
                    cleanup();
                    await captureComplete(result);
                } catch (error) {
                    console.error('Error in result handler:', error);
                    captureError('Failed to process capture result: ' + error.message);
                }
            },
            onError: (data) => {
                cleanup();
                const errorMsg = data.message || 'Capture failed';
                captureError(errorMsg);
            },
            onMessage: (data) => {
                // Fallback handler for SSE messages without explicit event type
                console.warn('Received unnamed SSE message:', data);
                if (data.success !== undefined) {
                    completed = true;
                    cleanup();
                    captureComplete(data).catch(err => {
                        console.error('Error processing unnamed result:', err);
                        captureError('Failed to process capture result');
                    });
                }
            },
        }, controller);
    } catch (error) {
        if (error.name === 'AbortError') {
            // Intentional abort (timeout or cleanup), already handled
            return;
        }
        cleanup();
        captureError(error.message || 'Connection lost');
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
            const acquisition = await db.addAcquisition(
                state.currentSessionId,
                {
                    timestamp: result.timestamp,
                    spectrum: result.spectrum,
                    identification: identification,
                    laserWavelength: result.laser_wavelength,
                    detectionMode: result.detection_mode,
                    csv: result.csv,
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
            alert('Capture succeeded but failed to save: ' + error.message);
        }
    } else {
        alert('Capture failed: ' + (result.error || 'Unknown error'));
    }
}

function captureError(message) {
    state.capturing = false;
    elements.captureBtn.disabled = false;
    elements.progressContainer.classList.add('hidden');
    alert('Capture error: ' + message);
}

function getConfidenceText(score) {
    if (score >= 0.90) return 'High confidence';
    if (score >= 0.70) return 'Moderate confidence';
    return 'Low confidence';
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
        const modeText = acquisition.detectionMode === 'auto' ? 'detected' : 'manual';
        elements.resultTime.textContent += ` | ${acquisition.laserWavelength.toFixed(1)}nm (${modeText})`;
    }

    if (identification && identification.length > 0) {
        const top = identification[0];
        elements.resultSubstance.textContent = top.substance;
        const confidenceText = getConfidenceText(top.score);
        const confidenceClass = getConfidenceClass(top.score);
        elements.resultScore.textContent = `${top.score.toFixed(3)} | ${confidenceText}`;
        elements.resultScore.className = `result-score ${confidenceClass}`;
    } else {
        elements.resultSubstance.textContent = 'Unknown';
        elements.resultScore.textContent = 'score: N/A';
        elements.resultScore.className = 'result-score';
    }

    // Set up plot buttons
    elements.viewPlotBtn.onclick = () => showPlot(acquisition, 'summaryPlot');
    elements.viewPlotBtn.disabled = !acquisition.fileIds?.summaryPlot;

    if (elements.viewMatchesBtn) {
        elements.viewMatchesBtn.onclick = () => showPlot(acquisition, 'identificationPlot');
        elements.viewMatchesBtn.disabled = !acquisition.fileIds?.identificationPlot;
        elements.viewMatchesBtn.classList.toggle('hidden', !acquisition.fileIds?.identificationPlot);
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
    elements.galleryCount.textContent = `(${acquisitions.length})`;

    if (acquisitions.length === 0) {
        elements.galleryContainer.innerHTML = '<div class="gallery-empty">No acquisitions yet</div>';
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
        alert('No acquisitions to export');
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
        alert('Export failed: ' + error.message);
    }
}

async function newTest() {
    if (!confirm('Start a new test? Current data will remain stored.')) return;

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
        alert('Failed to create new session');
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
            elements.syncTokenStatus.textContent = `Token configured: ${preview}...`;
            elements.syncTokenStatus.className = 'sync-token-status configured';
        } else {
            elements.syncTokenStatus.textContent = 'No token configured';
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
        elements.pendingCount.textContent = `${pending} pending`;
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
        showSyncFeedback('Settings saved', 'success');

        // Start/stop background sync
        if (state.settings.autoSync && state.settings.syncServerUrl && state.settings.syncToken) {
            sync.startBackgroundSync();
        } else {
            sync.stopBackgroundSync();
        }

    } catch (error) {
        console.error('Failed to save sync settings:', error);
        showSyncFeedback('Failed to save', 'error');
    }
}

async function testSyncConnection() {
    showSyncFeedback('Testing...', 'syncing');
    elements.testSyncBtn.disabled = true;

    try {
        const result = await sync.testConnection();
        if (result.success) {
            showSyncFeedback('Connection successful!', 'success');
        } else {
            showSyncFeedback(result.error || 'Connection failed', 'error');
        }
    } catch (error) {
        showSyncFeedback('Connection failed', 'error');
    } finally {
        elements.testSyncBtn.disabled = false;
    }
}

async function syncNow() {
    if (state.syncStatus.syncing) return;

    state.syncStatus.syncing = true;
    updateSyncIndicator();
    showSyncFeedback('Syncing...', 'syncing');
    elements.syncNowBtn.disabled = true;

    try {
        // Queue current session first
        await sync.queueCurrentSession(false);

        // Then sync all pending
        const result = await sync.syncAll();
        if (result.errors?.length > 0) {
            showSyncFeedback(`Synced: ${result.synced}, Failed: ${result.failed}`, 'error');
        } else {
            showSyncFeedback(`Synced: ${result.synced}`, 'success');
        }
        await loadSyncStatus();
    } catch (error) {
        showSyncFeedback(error.message || 'Sync failed', 'error');
    } finally {
        state.syncStatus.syncing = false;
        updateSyncIndicator();
        elements.syncNowBtn.disabled = false;
    }
}

function showSyncFeedback(message, type) {
    if (!elements.syncStatusEl) return;

    elements.syncStatusEl.textContent = message;
    elements.syncStatusEl.className = `sync-status ${type}`;

    // Reset after 3 seconds
    if (type !== 'syncing') {
        setTimeout(() => {
            elements.syncStatusEl.textContent = `${state.syncStatus.pending} pending`;
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
    githubBase: 'https://zeegomo.github.io/kat-webapp',
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
    showVersionStatus('Checking for updates...', 'checking');
    elements.checkUpdateBtn.disabled = true;
    elements.updateNowBtn.classList.add('hidden');

    try {
        const [currentVersion, remoteVersion] = await Promise.all([
            getCurrentVersion(),
            fetchRemoteVersion()
        ]);

        elements.currentVersion.textContent = currentVersion || 'unknown';

        if (!remoteVersion) {
            showVersionStatus('Could not check for updates', 'error');
            return;
        }

        remoteVersionCache = remoteVersion;

        if (!currentVersion) {
            showVersionStatus(`Update available: ${remoteVersion}`, 'update-available');
            elements.updateNowBtn.classList.remove('hidden');
        } else if (currentVersion === remoteVersion) {
            showVersionStatus('Up to date', 'up-to-date');
        } else {
            showVersionStatus(`Update available: ${remoteVersion}`, 'update-available');
            elements.updateNowBtn.classList.remove('hidden');
        }
    } catch (error) {
        console.error('Error checking for updates:', error);
        showVersionStatus('Could not check for updates', 'error');
    } finally {
        elements.checkUpdateBtn.disabled = false;
    }
}

async function triggerUpdate() {
    showVersionStatus('Downloading update...', 'checking');
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

        showVersionStatus('Applying update...', 'checking');

        // Render the new version immediately
        renderAppFromFiles(files);
    } catch (error) {
        console.error('Error triggering update:', error);
        showVersionStatus('Update failed: ' + error.message, 'error');
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
        elements.shutterDisplay.textContent = `${value.toFixed(1)}s`;
    });
    elements.shutterSlider.addEventListener('change', saveSettings);

    elements.gainSlider.addEventListener('input', () => {
        const value = Math.round(parseFloat(elements.gainSlider.value));
        elements.gainDisplay.textContent = `gain ${value}`;
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

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeSettings();
            elements.plotModal.classList.add('hidden');
        }
    });

    // Sync controls
    elements.syncIndicator.addEventListener('click', handleSyncIndicatorClick);
    elements.syncServerUrl.addEventListener('change', saveSyncSettings);
    elements.syncToken.addEventListener('change', saveSyncSettings);
    elements.autoSyncToggle.addEventListener('change', saveSyncSettings);
    elements.testSyncBtn.addEventListener('click', testSyncConnection);
    elements.syncNowBtn.addEventListener('click', syncNow);

    // Version controls
    elements.checkUpdateBtn.addEventListener('click', checkForUpdates);
    elements.updateNowBtn.addEventListener('click', triggerUpdate);

    // Cleanup on page unload
    window.addEventListener('beforeunload', cleanupBlobUrls);
}

// ============================================================================
// Startup Modal
// ============================================================================

let startupModalDelayTimer = null;
let startupModalVisible = false;
let startupModalListenersBound = false;
let startupStatusTitle = 'Starting…';
let startupStatusMessage = 'Loading…';

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
        alert(combined || 'Startup error');
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
        'Reset local data on this device?\n\nThis deletes saved tests and settings, but does not affect the spectrometer.'
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
            title: 'Startup error',
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
            title: 'Startup error',
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

    try {
        // Show a modal only if startup is slow (avoids flicker on fast loads).
        setStartupStatus('Opening local storage…', 'Starting…');
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

        setStartupStatus('Loading settings…');
        await loadSettings();
        setTheme(state.settings?.theme !== 'light');

        setStartupStatus('Loading saved tests…');
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
        showStartupModal({
            title: 'Startup failed',
            message: error?.message || String(error),
            showReset: true,
        });
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
