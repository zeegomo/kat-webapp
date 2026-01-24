#!/bin/bash
# Generate a new API token for KAT mobile app access
#
# Usage: kat-generate-token
#
# This script generates a random 64-character hex token and adds it to
# the tokens.conf file. The token can then be configured in the mobile app.

set -euo pipefail

# Find tokens file
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Check if running from installed location or source
if [[ -f "${SCRIPT_DIR}/tokens.conf" ]]; then
    TOKENS_FILE="${SCRIPT_DIR}/tokens.conf"
elif [[ -f "/opt/kat-server/tokens.conf" ]]; then
    TOKENS_FILE="/opt/kat-server/tokens.conf"
else
    echo "Error: tokens.conf not found" >&2
    echo "Expected locations:" >&2
    echo "  ${SCRIPT_DIR}/tokens.conf" >&2
    echo "  /opt/kat-server/tokens.conf" >&2
    exit 1
fi

TOKENS_DIR="$(dirname "${TOKENS_FILE}")"
TOKENS_MAP_FILE="${TOKENS_FILE}.map"

# Generate random token (64 hex characters = 256 bits)
TOKEN=$(openssl rand -hex 32)

# Add to tokens file
echo "${TOKEN}" >> "${TOKENS_FILE}"

# Regenerate nginx map file from all tokens
echo "# Auto-generated nginx map entries for token validation" > "${TOKENS_MAP_FILE}"
while IFS= read -r line || [[ -n "$line" ]]; do
    # Skip empty lines and comments
    [[ -z "$line" || "$line" =~ ^# ]] && continue
    echo "\"Bearer ${line}\" 1;" >> "${TOKENS_MAP_FILE}"
done < "${TOKENS_FILE}"
chmod 640 "${TOKENS_MAP_FILE}"
chown root:www-data "${TOKENS_MAP_FILE}" 2>/dev/null || true

# Reload nginx to pick up new token
if command -v nginx &> /dev/null && nginx -t 2>/dev/null; then
    systemctl reload nginx 2>/dev/null || true
fi

echo "New API token generated:"
echo
echo "  ${TOKEN}"
echo
echo "Configure in mobile app settings:"
echo "  Token: ${TOKEN}"
echo
echo "Tokens file: ${TOKENS_FILE}"
echo "Total tokens: $(grep -cv '^#\|^$' "${TOKENS_FILE}" 2>/dev/null || echo 0)"
