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

            let library;

            // Try loading from static file first
            try {
                const response = await fetch('data/library.json');
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }
                if (onProgress) onProgress(50);
                library = await response.json();
            } catch (fetchError) {
                // Fetch failed (e.g. running via pi-loader where relative path doesn't resolve)
                // Fall back to the pi-loader's IndexedDB cache
                console.warn('Identifier: fetch failed, trying loader cache:', fetchError.message);
                if (onProgress) onProgress(30);
                library = await this._loadFromLoaderCache();
                if (onProgress) onProgress(50);
            }

            if (!library.substances || library.substances.length === 0) {
                console.warn('Identifier: Library is empty (placeholder). Generate with build_browser_library.py');
                this.library = library;
                this.version = library.version || null;
                this.ready = false;
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
     * Load library.json from the pi-loader's IndexedDB cache.
     * This is a separate database from the app's own IndexedDB (managed by db.js).
     * The pi-loader caches all fetched files (including library.json) in
     * 'spettromiao-loader-cache', so we can read from it on first load when
     * the relative fetch('data/library.json') fails inside the rendered app.
     * @returns {Promise<Object>} Parsed library object
     */
    async _loadFromLoaderCache() {
        const cacheDb = await new Promise((resolve, reject) => {
            const request = indexedDB.open('spettromiao-loader-cache', 1);
            request.onerror = () => reject(new Error('Failed to open loader cache DB'));
            request.onsuccess = () => resolve(request.result);
        });

        if (!cacheDb.objectStoreNames.contains('app-files')) {
            cacheDb.close();
            throw new Error('Loader cache store not found');
        }

        const result = await new Promise((resolve, reject) => {
            const tx = cacheDb.transaction('app-files', 'readonly');
            const req = tx.objectStore('app-files').get('data/library.json');
            req.onerror = () => reject(req.error || new Error('Failed to read loader cache'));
            req.onsuccess = () => resolve(req.result);
        });

        cacheDb.close();

        if (!result || !result.content) {
            throw new Error('library.json not found in loader cache');
        }

        return JSON.parse(result.content);
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
}

// Global identifier instance
const identifier = new SpectrumIdentifier();
