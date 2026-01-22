# Security Audit Report - spettromiao-webapp

**Date:** 2026-01-22
**Auditor:** Claude (AI Security Analysis)
**Scope:** Full codebase security review

---

## Executive Summary

This security audit identified **22 potential vulnerabilities** across the spettromiao-webapp codebase:

| Severity | Count |
|----------|-------|
| Critical | 4 |
| High | 6 |
| Medium | 7 |
| Low | 5 |

The most significant concerns involve **plain-text credential storage** and **potential XSS vulnerabilities** through inconsistent HTML escaping.

---

## Critical Severity Issues

### 1. Plain-text API Token Storage in localStorage

**Location:** `remote-viewer.html:550-578`

**Description:** API tokens and server URLs are stored in plain text in localStorage, which is accessible to any JavaScript running on the same origin and persists across browser sessions.

```javascript
// Lines 550-553, 577-578
localStorage.setItem('remoteViewer_serverUrl', serverUrl);
localStorage.setItem('remoteViewer_token', token);
```

**Risk:** If XSS occurs anywhere on the origin, attackers can steal CouchDB credentials. localStorage also persists on shared devices.

**Recommendation:**
- Store tokens only in memory (session lifetime)
- If persistence is required, use encrypted storage or short-lived tokens
- Consider using httpOnly cookies for sensitive credentials

---

### 2. Unsafe innerHTML Usage Without Consistent Escaping

**Location:** `js/app.js:1056, 1438, 1475, 1498, 1606, 1645`

**Description:** Multiple innerHTML assignments use interpolated data without consistent HTML escaping.

```javascript
// Line 1056 - data from server status
elements.previewStatus.innerHTML = i18n.t('preview.status', {
    fps: status.fps,
    class: expInfo.class,
    exposure: status.exposure_us,
    quality: expInfo.text
});

// Line 1438 - building HTML from database records
elements.matchesList.innerHTML = html;
```

**Risk:** User-controlled or server-provided data could contain malicious HTML/JavaScript leading to XSS.

**Recommendation:**
- Use `textContent` instead of `innerHTML` where possible
- Apply the existing `escapeHtml()` function consistently to all interpolated values
- Consider using a templating library with auto-escaping

---

### 3. Unvalidated JSON Parsing from Server Events

**Location:** `js/app.js:490-498`

**Description:** Server-Sent Events (SSE) data is parsed with `JSON.parse()` without schema validation or type checking.

```javascript
if (eventType === 'progress' && handlers.onProgress) {
    handlers.onProgress(JSON.parse(eventData));  // No validation
}
```

**Risk:** A compromised Pi server or MITM attack could inject malicious JSON payloads that manipulate application behavior.

**Recommendation:**
- Implement schema validation for all server responses
- Type-check parsed data before use
- Consider using a validation library like Zod or Ajv

---

### 4. Sync Token Exposed in Memory and DOM

**Location:** `js/app.js:2177-2225`

**Description:** Sync tokens are handled through form inputs and stored without protection, potentially visible in DOM inspection.

**Risk:** Tokens can be extracted via DevTools or memory inspection.

**Recommendation:**
- Clear sensitive fields immediately after use
- Avoid storing tokens in global state
- Use input type="password" for token fields

---

## High Severity Issues

### 5. No Integrity Verification for Downloaded Files

**Location:** `pi-loader/index.html:187-189`

**Description:** Application files are fetched from GitHub Pages without any integrity verification (no SRI hashes, no signatures).

```javascript
await Promise.all(APP_FILES.map(async (path) => {
    downloadedFiles[path] = await fetchWithTimeout(`${GITHUB_BASE}/${path}?t=${Date.now()}`);
}));
```

**Risk:** If GitHub Pages is compromised or DNS is poisoned, malicious code could be injected.

**Recommendation:**
- Implement Subresource Integrity (SRI) hashes
- Verify file checksums before execution
- Consider code signing

---

### 6. Unsafe document.write() Usage

**Location:** `pi-loader/index.html:271`

**Description:** The deprecated `document.write()` method is used to inject the entire application.

```javascript
document.open();
document.write(doc.documentElement.outerHTML);
document.close();
```

**Risk:** `document.write()` can be exploited for code injection and causes parsing issues.

**Recommendation:**
- Replace with safer DOM manipulation methods
- Use `document.replaceChild()` or `innerHTML` on body

---

### 7. No HTTPS Enforcement for CouchDB Sync

**Location:** `js/sync.js:106, 117, 132, 288`

**Description:** CouchDB URLs are user-configured without HTTPS validation. Bearer tokens are sent over potentially insecure connections.

```javascript
let response = await fetch(`${settings.syncServerUrl}/kat_sessions`, {
    headers: {
        'Authorization': `Bearer ${settings.syncToken}`,
    },
});
```

**Risk:** MITM attacks can intercept credentials and session data.

**Recommendation:**
- Enforce HTTPS URLs (reject http://)
- Implement certificate pinning if feasible
- Warn users when connecting to non-HTTPS endpoints

---

### 8. Insufficient Input Validation on Settings

**Location:** `js/app.js:1138-1160, 2121-2127`

**Description:** Numeric inputs (shutter, gain, laser wavelength) are parsed without server-side bounds validation.

```javascript
const cameraSettings = {
    shutter: parseFloat(elements.shutterSlider.value),  // No validation
    gain: parseFloat(elements.gainSlider.value),
    laserWavelength: parseFloat(elements.laserWavelength.value),
};
```

**Risk:** Malicious values (via DevTools modification) could crash the Pi API or cause unexpected behavior.

**Recommendation:**
- Validate numeric ranges in JavaScript before sending
- Implement server-side validation on the Pi API

---

### 9. Inconsistent HTML Escaping

**Location:** `js/app.js` (multiple locations)

**Description:** The codebase has an `escapeHtml()` function (line 1811) but it's not used consistently. History items properly escape (lines 1632-1638), but other areas don't.

**Risk:** Inconsistent escaping creates attack surface for stored XSS.

**Recommendation:**
- Audit all innerHTML usages
- Create a centralized HTML building utility that auto-escapes
- Consider using textContent by default

---

### 10. No CORS/Origin Validation

**Location:** `js/app.js:14-27`

**Description:** Pi API URLs are derived from hostname without origin validation.

```javascript
const PI_API_URL = (() => {
    const host = window.location.hostname;
    if (host === '192.168.4.1' || host === 'localhost' || host === '127.0.0.1') {
        return '';
    }
    return 'https://192.168.4.1';
})();
```

**Risk:** The application may inadvertently allow cross-origin requests or connect to wrong endpoints.

**Recommendation:**
- Implement explicit origin allowlists
- Validate CORS headers on responses

---

## Medium Severity Issues

### 11. No Content Security Policy (CSP)

**Location:** `index.html`

**Description:** No CSP meta tag or header to prevent inline script execution.

**Recommendation:** Add CSP header restricting script sources.

---

### 12. Verbose Error Logging

**Location:** `js/app.js` (67 console.log statements)

**Description:** Detailed error messages and API details logged to console.

**Recommendation:** Reduce verbosity in production; sanitize error messages.

---

### 13. Error Details Exposed to Users

**Location:** `js/sync.js:181-188`

**Description:** Server error messages are displayed directly to users.

**Recommendation:** Show generic errors; log details server-side.

---

### 14. Unbounded Capture Timeout

**Location:** `js/app.js:1178`

**Description:** Timeout calculated from user-provided shutter time without maximum limit.

**Recommendation:** Implement maximum timeout cap.

---

### 15. Unencrypted IndexedDB Storage

**Location:** `js/db.js:31-46`

**Description:** Session data stored in plain text in IndexedDB.

**Recommendation:** Encrypt sensitive data before storage.

---

### 16. Service Worker Caches Without Validation

**Location:** `sw.js:71-95`

**Description:** Service worker caches responses without integrity checks.

**Recommendation:** Validate responses before caching.

---

### 17. No HTTPS Enforcement

**Location:** Multiple files

**Description:** Application can be loaded over HTTP.

**Recommendation:** Redirect HTTP to HTTPS; set HSTS header.

---

## Low Severity Issues

### 18. localStorage UI State Persistence

**Location:** `js/app.js:637`

**Description:** Wizard step stored in localStorage (minor information leak).

---

### 19. No Rate Limiting

**Location:** `js/app.js`

**Description:** No rate limiting on API calls or polling.

---

### 20. Auto-connect Feature

**Location:** `remote-viewer.html:856-858`

**Description:** Automatic connection if credentials are saved.

---

### 21. Weak Random ID Generation

**Location:** `js/db.js:97-103`

**Description:** Uses `Math.random()` instead of `crypto.getRandomValues()`.

```javascript
function generateId() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = Math.random() * 16 | 0;  // Not cryptographically secure
        // ...
    });
}
```

**Recommendation:** Use `crypto.randomUUID()` or `crypto.getRandomValues()`.

---

### 22. No Session Timeout/Logout

**Location:** Multiple files

**Description:** No explicit logout mechanism; tokens persist indefinitely.

---

## Recommendations by Priority

### Immediate Actions (Critical)

1. **Remove localStorage credential storage** in remote-viewer.html - use session storage or memory only
2. **Apply consistent HTML escaping** to all innerHTML operations
3. **Add JSON schema validation** for server responses

### Short-term (High)

4. Add HTTPS enforcement for sync URLs
5. Implement SRI hashes for pi-loader file downloads
6. Add input validation for all user-configurable values
7. Replace document.write() with safer alternatives

### Medium-term (Medium)

8. Add Content-Security-Policy header
9. Reduce console logging verbosity
10. Implement session timeouts
11. Encrypt IndexedDB data

### Long-term (Low)

12. Use cryptographically secure random number generation
13. Add explicit logout functionality
14. Implement rate limiting

---

## Notes

- This is a client-side web application for a DIY spectrometer
- The threat model primarily involves local network attacks and shared device access
- Some findings (like IndexedDB encryption) may be lower priority given the non-sensitive nature of spectrum data
- The pi-loader integrity issue is particularly important as it's the bootstrap mechanism
