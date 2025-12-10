/**
 * KAT Mobile Webapp - Wizard-Style Frontend
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
// Otherwise, use the full Pi URL (for development/GitHub Pages)
const PI_API_URL = (() => {
    const host = window.location.hostname;
    // If running from Pi, use relative path (same origin, no mixed content)
    if (host === '192.168.4.1' || host === 'localhost' || host === '127.0.0.1') {
        return '';  // Relative URL - same origin
    }
    // Otherwise use full URL (development/testing)
    return 'http://192.168.4.1:1312';
})();

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
    capturing: false,
    currentAcquisition: null,
    darkMode: true,
    galleryExpanded: false,

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
    piConnected: false,
    piCheckInterval: null,
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
};

// ============================================================================
// API Client (for Pi communication only)
// ============================================================================

const api = {
    async fetchWithTimeout(url, options = {}, timeout = 5000) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        try {
            const response = await fetch(url, {
                ...options,
                signal: controller.signal,
            });
            return response;
        } finally {
            clearTimeout(timeoutId);
        }
    },

    async get(endpoint) {
        const response = await this.fetchWithTimeout(`${PI_API_URL}/api${endpoint}`);
        return response.json();
    },

    async post(endpoint, data = {}) {
        const response = await this.fetchWithTimeout(`${PI_API_URL}/api${endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        });
        return response.json();
    },

    async getSettings() { return this.get('/settings'); },
    async updateSettings(settings) { return this.post('/settings', settings); },
    async getCalibrationStatus() { return this.get('/calibration'); },
    async startPreview() { return this.post('/preview/start'); },
    async stopPreview() { return this.post('/preview/stop'); },
    async getPreviewStatus() { return this.get('/preview/status'); },
};

// ============================================================================
// Pi Connectivity
// ============================================================================

async function checkPiConnectivity() {
    try {
        await api.getSettings();
        if (!state.piConnected) {
            state.piConnected = true;
            updatePiConnectionUI();
            // Slow down polling when connected
            restartPiCheckInterval(10000);
        }
    } catch (error) {
        if (state.piConnected !== false) {
            state.piConnected = false;
            updatePiConnectionUI();
            // Speed up polling when disconnected
            restartPiCheckInterval(2000);
        }
    }
}

function restartPiCheckInterval(intervalMs) {
    if (state.piCheckInterval) {
        clearInterval(state.piCheckInterval);
    }
    state.piCheckInterval = setInterval(checkPiConnectivity, intervalMs);
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

    // Stop preview if leaving step 2
    if (state.currentStep === 2 && stepNumber !== 2 && state.previewActive) {
        stopPreview();
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
    try {
        await api.startPreview();
        state.previewActive = true;

        elements.previewImage.src = `${PI_API_URL}/api/preview/stream`;
        elements.previewImage.classList.remove('hidden');
        elements.previewPlaceholder.classList.add('hidden');
        elements.startPreviewBtn.classList.add('hidden');
        elements.stopPreviewBtn.classList.remove('hidden');

        pollPreviewStatus();
    } catch (error) {
        console.error('Failed to start preview:', error);
        elements.previewStatus.textContent = 'Error starting preview';
    }
}

async function stopPreview() {
    try {
        await api.stopPreview();
        state.previewActive = false;

        elements.previewImage.src = '';
        elements.previewImage.classList.add('hidden');
        elements.previewPlaceholder.classList.remove('hidden');
        elements.startPreviewBtn.classList.remove('hidden');
        elements.stopPreviewBtn.classList.add('hidden');
        elements.previewStatus.textContent = '';
    } catch (error) {
        console.error('Failed to stop preview:', error);
    }
}

async function pollPreviewStatus() {
    if (!state.previewActive) return;

    try {
        const status = await api.getPreviewStatus();
        if (status.streaming) {
            elements.previewStatus.textContent = `${status.fps} FPS`;
        } else {
            elements.previewStatus.textContent = 'Stopped';
            state.previewActive = false;
        }
    } catch (error) {
        console.error('Status poll error:', error);
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

    try {
        const eventSource = new EventSource(`${PI_API_URL}/api/capture`);

        eventSource.addEventListener('progress', (event) => {
            const data = JSON.parse(event.data);
            elements.progressFill.style.width = `${data.progress}%`;
            elements.progressText.textContent = data.message;
        });

        eventSource.addEventListener('result', async (event) => {
            const result = JSON.parse(event.data);
            eventSource.close();
            await captureComplete(result);
        });

        eventSource.addEventListener('error', (event) => {
            let errorMsg = 'Capture failed';
            try {
                const data = JSON.parse(event.data);
                errorMsg = data.message || errorMsg;
            } catch (e) {}
            eventSource.close();
            captureError(errorMsg);
        });

        eventSource.onerror = () => {
            if (eventSource.readyState === EventSource.CLOSED) return;
            eventSource.close();
            captureError('Connection lost');
        };
    } catch (error) {
        captureError(error.message);
    }
}

async function captureComplete(result) {
    state.capturing = false;
    elements.captureBtn.disabled = false;
    elements.progressContainer.classList.add('hidden');

    if (result.success) {
        try {
            // Convert base64 to blobs
            const files = {};

            if (result.photo) {
                files.photo = db.base64ToBlob(result.photo, 'image/jpeg');
            }
            if (result.summary_plot) {
                files.summaryPlot = db.base64ToBlob(result.summary_plot, 'image/png');
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
            updateGalleryUI();
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
// Actions
// ============================================================================

async function exportTest() {
    if (state.acquisitions.length === 0) {
        alert('No acquisitions to export');
        return;
    }

    try {
        const zip = new JSZip();

        // Add metadata
        zip.file('metadata.json', JSON.stringify({
            event: state.session?.event || '',
            substance: state.session?.substance || '',
            appearance: state.session?.appearance || '',
            substanceDescription: state.session?.substanceDescription || '',
            notes: state.session?.notes || '',
            exportedAt: new Date().toISOString(),
            acquisitionCount: state.acquisitions.length,
            hasSubstancePhoto: !!state.session?.substancePhotoId,
        }, null, 2));

        // Add substance photo if present
        if (state.session?.substancePhotoId) {
            const photoFile = await db.getFile(state.session.substancePhotoId);
            if (photoFile?.data) {
                zip.file('substance_photo.jpg', photoFile.data);
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
                    zip.file(`${prefix}.jpg`, file.data);
                }
            }

            // Spectrum JSON
            if (acq.spectrum) {
                zip.file(`${prefix}_spectrum.json`, JSON.stringify(acq.spectrum, null, 2));
            }

            // CSV
            if (acq.csv) {
                zip.file(`${prefix}.csv`, acq.csv);
            }

            // Summary plot
            if (acq.fileIds?.summaryPlot) {
                const file = await db.getFile(acq.fileIds.summaryPlot);
                if (file?.data) {
                    zip.file(`${prefix}_summary.png`, file.data);
                }
            }

            // Identification plot
            if (acq.fileIds?.identificationPlot) {
                const file = await db.getFile(acq.fileIds.identificationPlot);
                if (file?.data) {
                    zip.file(`${prefix}_identification.png`, file.data);
                }
            }
        }

        // Generate and download
        const blob = await zip.generateAsync({ type: 'blob' });
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

    // Cleanup on page unload
    window.addEventListener('beforeunload', cleanupBlobUrls);
}

// ============================================================================
// Initialization
// ============================================================================

async function init() {
    // Register service worker for PWA support
    if ('serviceWorker' in navigator) {
        try {
            await navigator.serviceWorker.register('sw.js');
            console.log('Service Worker registered');
        } catch (error) {
            console.warn('Service Worker registration failed:', error);
        }
    }

    // Initialize IndexedDB
    await db.openDB();

    // Setup event listeners early - before any network calls that might block
    // Note: handlers access state.session but only fire on user interaction,
    // which happens after loadSession() completes below
    setupEventListeners();

    // Check Pi connectivity immediately (starts with 2s polling until connected)
    checkPiConnectivity();
    state.piCheckInterval = setInterval(checkPiConnectivity, 2000);

    // Load settings and apply theme
    await loadSettings();
    setTheme(state.settings?.theme !== 'light');

    // Load session
    await loadSession();

    // Load sync status
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
}

document.addEventListener('DOMContentLoaded', init);
