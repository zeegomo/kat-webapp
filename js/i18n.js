/**
 * spettromiao Mobile Webapp - i18n Module
 *
 * Lightweight internationalization system for vanilla JavaScript
 * - Loads translation JSON files on demand
 * - Updates DOM using data-i18n attributes
 * - Supports string interpolation for dynamic values
 * - Persists language preference in IndexedDB
 */

const i18n = {
    // Current language code ('en' or 'it')
    currentLang: 'en',

    // Loaded translations for current language
    translations: {},

    // Supported languages
    supportedLangs: ['en', 'it'],

    /**
     * Initialize i18n system
     * - Load language preference from IndexedDB
     * - Fetch and load translation file
     * - Apply translations to DOM
     */
    async init() {
        try {
            // Load language preference from IndexedDB settings
            const settings = await db.getSettings();
            if (settings && settings.language && this.supportedLangs.includes(settings.language)) {
                this.currentLang = settings.language;
            } else {
                // Default to English
                this.currentLang = 'en';
            }

            // Load translation file
            await this.loadTranslations(this.currentLang);

            // Apply translations to DOM
            this.updateDOM();

            console.log(`i18n initialized: ${this.currentLang}`);
        } catch (error) {
            console.error('i18n initialization failed:', error);
            // Fall back to English
            this.currentLang = 'en';
            try {
                await this.loadTranslations('en');
                this.updateDOM();
            } catch (fallbackError) {
                console.error('Failed to load fallback translations:', fallbackError);
            }
        }
    },

    /**
     * Load translation file for specified language
     * @param {string} lang - Language code ('en' or 'it')
     */
    async loadTranslations(lang) {
        if (!this.supportedLangs.includes(lang)) {
            throw new Error(`Unsupported language: ${lang}`);
        }

        try {
            const response = await fetch(`./locales/${lang}.json`);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            this.translations = await response.json();
        } catch (error) {
            console.error(`Failed to load translations for ${lang}:`, error);
            throw error;
        }
    },

    /**
     * Switch to a different language
     * @param {string} lang - Language code ('en' or 'it')
     */
    async setLanguage(lang) {
        if (!this.supportedLangs.includes(lang)) {
            console.warn(`Unsupported language: ${lang}`);
            return;
        }

        if (lang === this.currentLang) {
            return; // Already using this language
        }

        try {
            // Load new translation file
            await this.loadTranslations(lang);

            // Update current language
            this.currentLang = lang;

            // Save preference to IndexedDB
            await db.updateSettings({ language: lang });

            // Apply translations to DOM
            this.updateDOM();

            console.log(`Language switched to: ${lang}`);
        } catch (error) {
            console.error(`Failed to switch language to ${lang}:`, error);
        }
    },

    /**
     * Translate a key with optional parameter interpolation
     * @param {string} key - Translation key (e.g., 'step1.title')
     * @param {Object} params - Optional parameters for interpolation (e.g., {time: 3.2})
     * @returns {string} - Translated text
     */
    t(key, params = {}) {
        // Navigate through nested object using dot notation
        const keys = key.split('.');
        let text = this.translations;

        for (const k of keys) {
            if (text && typeof text === 'object' && k in text) {
                text = text[k];
            } else {
                // Translation not found
                console.warn(`Missing translation: ${key} [${this.currentLang}]`);
                return key; // Return key as fallback
            }
        }

        // If text is not a string, return key
        if (typeof text !== 'string') {
            console.warn(`Translation is not a string: ${key} [${this.currentLang}]`);
            return key;
        }

        // Interpolate parameters: replace {variable} with actual values
        if (params && typeof params === 'object') {
            Object.keys(params).forEach(param => {
                const placeholder = `{${param}}`;
                text = text.replace(new RegExp(placeholder, 'g'), params[param]);
            });
        }

        return text;
    },

    /**
     * Apply translations to all DOM elements with data-i18n attributes
     */
    updateDOM() {
        // Update <html lang="..."> attribute
        document.documentElement.setAttribute('lang', this.currentLang);

        // Update text content for elements with data-i18n
        document.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.getAttribute('data-i18n');
            if (key) {
                el.textContent = this.t(key);
            }
        });

        // Update placeholders for inputs with data-i18n-placeholder
        document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
            const key = el.getAttribute('data-i18n-placeholder');
            if (key) {
                el.placeholder = this.t(key);
            }
        });

        // Update aria-labels for elements with data-i18n-aria
        document.querySelectorAll('[data-i18n-aria]').forEach(el => {
            const key = el.getAttribute('data-i18n-aria');
            if (key) {
                el.setAttribute('aria-label', this.t(key));
            }
        });

        // Update titles for elements with data-i18n-title
        document.querySelectorAll('[data-i18n-title]').forEach(el => {
            const key = el.getAttribute('data-i18n-title');
            if (key) {
                el.setAttribute('title', this.t(key));
            }
        });
    },

    /**
     * Get current language code
     * @returns {string} - Current language code ('en' or 'it')
     */
    getCurrentLanguage() {
        return this.currentLang;
    },

    /**
     * Get list of supported languages
     * @returns {Array<string>} - Array of supported language codes
     */
    getSupportedLanguages() {
        return [...this.supportedLangs];
    }
};
