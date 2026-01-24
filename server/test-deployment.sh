#!/bin/bash
# KAT CouchDB Deployment Test
# Usage: ./test-deployment.sh <domain> [token]

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

pass() { echo -e "${GREEN}PASS${NC} $1"; }
fail() { echo -e "${RED}FAIL${NC} $1"; FAILED=1; }
skip() { echo -e "${YELLOW}SKIP${NC} $1"; }

FAILED=0

# Check arguments
if [[ $# -lt 1 ]]; then
    echo "Usage: $0 <domain> [token]"
    echo ""
    echo "Examples:"
    echo "  $0 kat.example.com                    # Basic health check"
    echo "  $0 kat.example.com abc123...          # Full test with API token"
    exit 1
fi

DOMAIN="$1"
TOKEN="${2:-}"
BASE_URL="https://${DOMAIN}"

echo "Testing deployment at: ${BASE_URL}"
echo "========================================"
echo ""

# Test 1: Health check (no auth required)
echo -n "1. Health check (/_up): "
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "${BASE_URL}/_up" 2>/dev/null || echo "000")
if [[ "$HTTP_CODE" == "200" ]]; then
    pass "HTTP $HTTP_CODE"
else
    fail "HTTP $HTTP_CODE (expected 200)"
fi

# Test 2: API without token (should return 401)
echo -n "2. API without token (expect 401): "
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "${BASE_URL}/kat_sessions" 2>/dev/null || echo "000")
if [[ "$HTTP_CODE" == "401" ]]; then
    pass "HTTP $HTTP_CODE"
else
    fail "HTTP $HTTP_CODE (expected 401)"
fi

# Test 3: Blocked path (should return 403)
echo -n "3. Blocked path (expect 403): "
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "${BASE_URL}/_all_dbs" 2>/dev/null || echo "000")
if [[ "$HTTP_CODE" == "403" ]]; then
    pass "HTTP $HTTP_CODE"
else
    fail "HTTP $HTTP_CODE (expected 403)"
fi

# Test 4: API with valid token (if provided)
if [[ -n "$TOKEN" ]]; then
    echo -n "4. API with token (expect 200): "
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
        -H "Authorization: Bearer ${TOKEN}" \
        "${BASE_URL}/kat_sessions" 2>/dev/null || echo "000")
    if [[ "$HTTP_CODE" == "200" ]]; then
        pass "HTTP $HTTP_CODE"
    else
        fail "HTTP $HTTP_CODE (expected 200)"
    fi

    # Test 5: Create and delete test document
    echo -n "5. Write/delete test document: "
    DOC_ID="test_$(date +%s)"

    # Create document
    CREATE_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
        -X PUT \
        -H "Authorization: Bearer ${TOKEN}" \
        -H "Content-Type: application/json" \
        -d '{"test": true, "timestamp": "'"$(date -Iseconds)"'"}' \
        "${BASE_URL}/kat_sessions/${DOC_ID}" 2>/dev/null || echo "000")

    if [[ "$CREATE_CODE" == "201" || "$CREATE_CODE" == "200" ]]; then
        # Get revision for deletion
        REV=$(curl -s -H "Authorization: Bearer ${TOKEN}" \
            "${BASE_URL}/kat_sessions/${DOC_ID}" 2>/dev/null | \
            grep -o '"_rev":"[^"]*"' | cut -d'"' -f4)

        # Delete document
        DELETE_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
            -X DELETE \
            -H "Authorization: Bearer ${TOKEN}" \
            "${BASE_URL}/kat_sessions/${DOC_ID}?rev=${REV}" 2>/dev/null || echo "000")

        if [[ "$DELETE_CODE" == "200" ]]; then
            pass "created and deleted"
        else
            fail "created but delete failed (HTTP $DELETE_CODE)"
        fi
    else
        fail "create failed (HTTP $CREATE_CODE)"
    fi
else
    skip "4. API with token (no token provided)"
    skip "5. Write/delete test (no token provided)"
fi

echo ""
echo "========================================"
if [[ $FAILED -eq 0 ]]; then
    echo -e "${GREEN}All tests passed!${NC}"
    exit 0
else
    echo -e "${RED}Some tests failed${NC}"
    exit 1
fi
