/**
 * spettromiao Mobile Webapp - Browser-based Spectrum Identification
 *
 * Correlation-based identification using cosine similarity and Pearson correlation.
 * Library is cached in IndexedDB for offline operation.
 */

const TARGET_WAVELENGTH_MIN = 500;
const TARGET_WAVELENGTH_MAX = 1800;
const TARGET_WAVELENGTH_STEP = 1;
const TARGET_WAVELENGTH_LENGTH = TARGET_WAVELENGTH_MAX - TARGET_WAVELENGTH_MIN + 1; // 1301

// Validation thresholds
const VALIDATION_THRESHOLDS = {
    // For underexposed detection: minimum standard deviation expected in active region
    MIN_STD_DEV: 0.02,
    // Start index for active region check (800nm = index 300)
    ACTIVE_REGION_START: 300,
    // For overexposed detection: maximum allowed percentage of saturated values
    MAX_SATURATED_PERCENT: 15,
    // Value threshold to consider a point as saturated (near maximum)
    SATURATION_THRESHOLD: 0.98,
    // Minimum consecutive saturated points to consider as clipping
    MIN_CLIPPING_LENGTH: 10,
};

/**
 * Compute cosine similarity between two vectors.
 * Formula: cos(θ) = (a·b) / (||a|| * ||b||)
 * @param {Float32Array|number[]} a - First vector
 * @param {Float32Array|number[]} b - Second vector
 * @returns {number} Cosine similarity in range [-1, 1]
 */
function cosineSimilarity(a, b) {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
        dotProduct += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }

    normA = Math.sqrt(normA);
    normB = Math.sqrt(normB);

    if (normA === 0 || normB === 0) {
        return 0;
    }

    return dotProduct / (normA * normB);
}

/**
 * Compute Pearson correlation coefficient between two vectors.
 * Formula: r = cov(a,b) / (σ_a * σ_b)
 * @param {Float32Array|number[]} a - First vector
 * @param {Float32Array|number[]} b - Second vector
 * @returns {number} Pearson correlation in range [-1, 1]
 */
function pearsonCorrelation(a, b) {
    const n = a.length;

    // Calculate means
    let sumA = 0;
    let sumB = 0;
    for (let i = 0; i < n; i++) {
        sumA += a[i];
        sumB += b[i];
    }
    const meanA = sumA / n;
    const meanB = sumB / n;

    // Calculate covariance and standard deviations
    let covariance = 0;
    let varA = 0;
    let varB = 0;
    for (let i = 0; i < n; i++) {
        const devA = a[i] - meanA;
        const devB = b[i] - meanB;
        covariance += devA * devB;
        varA += devA * devA;
        varB += devB * devB;
    }

    const stdA = Math.sqrt(varA / n);
    const stdB = Math.sqrt(varB / n);

    if (stdA === 0 || stdB === 0) {
        return 0;
    }

    return covariance / (n * stdA * stdB);
}

/**
 * Validation result object.
 * @typedef {Object} ValidationResult
 * @property {boolean} valid - Whether the spectrum is valid
 * @property {string[]} issues - Array of issue codes ('underexposed', 'overexposed', 'clipping')
 * @property {Object} metrics - Detailed metrics for debugging
 */

/**
 * Calculate standard deviation of an array.
 * @param {number[]} values - Array of values
 * @returns {number} Standard deviation
 */
function standardDeviation(values) {
    const n = values.length;
    if (n === 0) return 0;

    let sum = 0;
    for (let i = 0; i < n; i++) {
        sum += values[i];
    }
    const mean = sum / n;

    let variance = 0;
    for (let i = 0; i < n; i++) {
        const diff = values[i] - mean;
        variance += diff * diff;
    }

    return Math.sqrt(variance / n);
}

/**
 * Detect if spectrum is underexposed (all black / flat signal).
 * Checks the standard deviation in the active region where Raman features should appear.
 * @param {number[]} spectrum - Preprocessed spectrum data (1301 points)
 * @returns {{isUnderexposed: boolean, stdDev: number}}
 */
function detectUnderexposed(spectrum) {
    // Check the region from 800nm onwards (index 300) where Raman features should be
    const activeRegion = spectrum.slice(VALIDATION_THRESHOLDS.ACTIVE_REGION_START);
    const stdDev = standardDeviation(activeRegion);

    return {
        isUnderexposed: stdDev < VALIDATION_THRESHOLDS.MIN_STD_DEV,
        stdDev: stdDev,
    };
}

/**
 * Detect if spectrum is overexposed (saturated / clipped).
 * Checks for high percentage of values near maximum and consecutive saturated values.
 * @param {number[]} spectrum - Preprocessed spectrum data (1301 points)
 * @returns {{isOverexposed: boolean, saturatedPercent: number, maxClippingLength: number}}
 */
function detectOverexposed(spectrum) {
    const n = spectrum.length;
    let saturatedCount = 0;
    let currentClipLength = 0;
    let maxClipLength = 0;

    for (let i = 0; i < n; i++) {
        if (spectrum[i] >= VALIDATION_THRESHOLDS.SATURATION_THRESHOLD) {
            saturatedCount++;
            currentClipLength++;
            if (currentClipLength > maxClipLength) {
                maxClipLength = currentClipLength;
            }
        } else {
            currentClipLength = 0;
        }
    }

    const saturatedPercent = (saturatedCount / n) * 100;

    // Overexposed if too many saturated values OR significant clipping pattern
    const isOverexposed = saturatedPercent > VALIDATION_THRESHOLDS.MAX_SATURATED_PERCENT ||
                         maxClipLength >= VALIDATION_THRESHOLDS.MIN_CLIPPING_LENGTH;

    return {
        isOverexposed,
        saturatedPercent,
        maxClippingLength: maxClipLength,
    };
}

/**
 * Validate a spectrum for common capture issues.
 * @param {number[]} spectrum - Preprocessed spectrum data (1301 points)
 * @returns {ValidationResult} Validation result with issues and metrics
 */
function validateSpectrum(spectrum) {
    if (!spectrum || spectrum.length !== TARGET_WAVELENGTH_LENGTH) {
        return {
            valid: false,
            issues: ['invalid_data'],
            metrics: { error: 'Invalid spectrum length' },
        };
    }

    const issues = [];
    const metrics = {};

    // Check for underexposure
    const underexposedResult = detectUnderexposed(spectrum);
    metrics.stdDev = underexposedResult.stdDev;
    if (underexposedResult.isUnderexposed) {
        issues.push('underexposed');
    }

    // Check for overexposure
    const overexposedResult = detectOverexposed(spectrum);
    metrics.saturatedPercent = overexposedResult.saturatedPercent;
    metrics.maxClippingLength = overexposedResult.maxClippingLength;
    if (overexposedResult.isOverexposed) {
        issues.push('overexposed');
    }

    return {
        valid: issues.length === 0,
        issues,
        metrics,
    };
}

/**
 * Browser-based spectrum identifier using correlation matching.
 */
class SpectrumIdentifier {
    constructor() {
        this.library = null;
        this.version = null;
        this.ready = false;
    }

    /**
     * Check if identifier is ready (library loaded).
     * @returns {boolean}
     */
    isReady() {
        return this.ready && this.library !== null;
    }

    /**
     * Get the number of substances in the library.
     * @returns {number}
     */
    getSubstanceCount() {
        return this.library ? this.library.substances.length : 0;
    }

    /**
     * Get the library version.
     * @returns {string|null}
     */
    getVersion() {
        return this.version;
    }

    /**
     * Load library from IndexedDB.
     * @returns {Promise<boolean>} True if library was loaded
     */
    async loadFromCache() {
        try {
            const cached = await db.getLibrary();
            if (cached && cached.substances && cached.substances.length > 0) {
                this.library = cached;
                this.version = cached.version || null;
                this.ready = true;
                console.log(`Identifier: Loaded ${this.getSubstanceCount()} substances from cache (v${this.version})`);
                return true;
            }
        } catch (e) {
            console.error('Identifier: Failed to load from cache:', e);
        }
        return false;
    }

    /**
     * Fetch library from static file and cache it.
     * @param {function} onProgress - Progress callback (0-100)
     * @returns {Promise<boolean>} True if library was fetched
     */
    async fetchAndCache(onProgress = null) {
        try {
            if (onProgress) onProgress(10);

            // Load from static file bundled with webapp
            const response = await fetch('data/library.json');
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            if (onProgress) onProgress(50);

            const library = await response.json();

            if (!library.substances || library.substances.length === 0) {
                console.warn('Identifier: Library is empty (placeholder). Generate with build_browser_library.py');
                // Still cache the empty library to prevent repeated fetch attempts
                this.library = library;
                this.version = library.version || null;
                this.ready = false;  // Not ready for identification, but loaded
                return true;
            }

            if (onProgress) onProgress(80);

            // Save to IndexedDB for offline use
            await db.saveLibrary(library);

            this.library = library;
            this.version = library.version || null;
            this.ready = true;

            if (onProgress) onProgress(100);

            console.log(`Identifier: Loaded ${this.getSubstanceCount()} substances (v${this.version})`);
            return true;
        } catch (e) {
            console.error('Identifier: Failed to fetch library:', e);
            return false;
        }
    }

    /**
     * Load library (from cache or static file).
     * @param {function} onProgress - Progress callback
     * @returns {Promise<{synced: boolean, fromCache: boolean, substanceCount: number}>}
     */
    async sync(onProgress = null) {
        // Try to load from IndexedDB cache first
        const fromCache = await this.loadFromCache();

        if (fromCache) {
            return { synced: true, fromCache: true, substanceCount: this.getSubstanceCount() };
        }

        // No cache, fetch from static file
        const fetched = await this.fetchAndCache(onProgress);
        return { synced: fetched, fromCache: false, substanceCount: this.getSubstanceCount() };
    }

    /**
     * Identify query spectrum against library.
     * @param {number[]} queryData - Preprocessed spectrum data (1301 points)
     * @param {number} topK - Number of top matches to return
     * @param {number} cosineWeight - Weight for cosine similarity (default 0.5)
     * @returns {Array<{substance: string, score: number, cosineScore: number, pearsonScore: number}>}
     */
    identify(queryData, topK = 5, cosineWeight = 0.5) {
        if (!this.isReady()) {
            console.error('Identifier: Library not loaded');
            return [];
        }

        if (!queryData || queryData.length !== TARGET_WAVELENGTH_LENGTH) {
            console.error(`Identifier: Invalid query length ${queryData?.length}, expected ${TARGET_WAVELENGTH_LENGTH}`);
            return [];
        }

        const pearsonWeight = 1 - cosineWeight;
        const results = [];

        for (const substance of this.library.substances) {
            const cosine = cosineSimilarity(queryData, substance.data);
            const pearson = pearsonCorrelation(queryData, substance.data);
            const combined = cosineWeight * cosine + pearsonWeight * pearson;

            results.push({
                substance: substance.name,
                score: combined,
                cosineScore: cosine,
                pearsonScore: pearson,
            });
        }

        // Sort by combined score descending
        results.sort((a, b) => b.score - a.score);

        return results.slice(0, topK);
    }

    /**
     * Clear cached library.
     * @returns {Promise<void>}
     */
    async clearCache() {
        await db.clearLibrary();
        this.library = null;
        this.version = null;
        this.ready = false;
        console.log('Identifier: Cache cleared');
    }

    /**
     * Validate a spectrum for capture quality issues.
     * @param {number[]} spectrum - Preprocessed spectrum data (1301 points)
     * @returns {ValidationResult} Validation result with issues and metrics
     */
    validate(spectrum) {
        return validateSpectrum(spectrum);
    }
}

// Global identifier instance
const identifier = new SpectrumIdentifier();

// Export validation function for direct use
if (typeof window !== 'undefined') {
    window.validateSpectrum = validateSpectrum;
}
