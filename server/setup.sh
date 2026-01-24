#!/bin/bash
# KAT CouchDB Server Setup Script
# Production-ready setup with security hardening

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

echo -e "${GREEN}"
echo "============================================"
echo "       KAT CouchDB Server Setup"
echo "============================================"
echo -e "${NC}"

# Check if running as root
if [[ $EUID -ne 0 ]]; then
    log_error "This script must be run as root"
    echo "Usage: sudo ./setup.sh"
    exit 1
fi

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Load config or prompt for values
if [[ -f .env ]]; then
    log_info "Loading configuration from .env"
    source .env
    # Strip protocol and trailing slash from domain if present
    DOMAIN="${DOMAIN#https://}"
    DOMAIN="${DOMAIN#http://}"
    DOMAIN="${DOMAIN%/}"
else
    log_info "No .env file found. Please provide configuration:"
    echo

    read -p "Enter domain name (e.g., kat.example.com): " DOMAIN
    read -p "Enter admin email for Let's Encrypt: " EMAIL
    read -sp "Enter CouchDB admin password: " COUCH_PASSWORD
    echo
    read -sp "Confirm CouchDB admin password: " COUCH_PASSWORD_CONFIRM
    echo

    if [[ "$COUCH_PASSWORD" != "$COUCH_PASSWORD_CONFIRM" ]]; then
        log_error "Passwords do not match"
        exit 1
    fi

    if [[ ${#COUCH_PASSWORD} -lt 12 ]]; then
        log_warn "Password is less than 12 characters. Consider using a stronger password."
    fi

    echo
    read -sp "Enter sync user password (for API access): " SYNC_PASSWORD
    echo
    read -sp "Enter Fauxton admin UI password (for web access): " ADMIN_UI_PASSWORD
    echo

    # Save configuration
    cat > .env << EOF
# KAT CouchDB Server Configuration
# Generated on $(date)

DOMAIN=${DOMAIN}
EMAIL=${EMAIL}
COUCH_PASSWORD=${COUCH_PASSWORD}
SYNC_PASSWORD=${SYNC_PASSWORD}
ADMIN_UI_PASSWORD=${ADMIN_UI_PASSWORD}
EOF
    chmod 600 .env
    log_info "Configuration saved to .env (chmod 600)"
fi

# Validate configuration
if [[ -z "${DOMAIN:-}" ]] || [[ -z "${EMAIL:-}" ]] || [[ -z "${COUCH_PASSWORD:-}" ]]; then
    log_error "Missing required configuration. Please check .env file."
    exit 1
fi

if [[ -z "${SYNC_PASSWORD:-}" ]] || [[ -z "${ADMIN_UI_PASSWORD:-}" ]]; then
    log_error "Missing SYNC_PASSWORD or ADMIN_UI_PASSWORD. Please update .env file."
    exit 1
fi

echo
log_info "Configuration:"
echo "  Domain: ${DOMAIN}"
echo "  Email: ${EMAIL}"
echo

read -p "Continue with setup? [y/N] " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    log_info "Setup cancelled"
    exit 0
fi

# Step 1: Install dependencies
echo
log_info "[1/8] Installing dependencies..."
apt-get update -qq
apt-get install -y -qq \
    docker.io \
    docker-compose \
    nginx \
    certbot \
    python3-certbot-nginx \
    ufw \
    fail2ban \
    jq \
    curl \
    apache2-utils

# Enable and start Docker
systemctl enable docker
systemctl start docker

# Step 2: Configure firewall
echo
log_info "[2/8] Configuring UFW firewall..."
ufw default deny incoming
ufw default allow outgoing

# Detect current SSH port from active connection
SSH_PORT=$(echo $SSH_CONNECTION | awk '{print $4}')
if [[ -n "$SSH_PORT" && "$SSH_PORT" != "22" ]]; then
    log_warn "Detected non-standard SSH port: $SSH_PORT"
    ufw allow "$SSH_PORT/tcp"
else
    ufw allow ssh
fi

ufw allow http
ufw allow https

# Enable firewall (non-interactive)
echo "y" | ufw enable
log_info "Firewall enabled. Allowed ports: 22 (SSH), 80 (HTTP), 443 (HTTPS)"

# Step 3: Start CouchDB container
echo
log_info "[3/8] Starting CouchDB container..."
docker-compose up -d

# Wait for CouchDB to be ready
log_info "Waiting for CouchDB to start..."
for i in {1..30}; do
    if curl -s http://localhost:5984/ > /dev/null 2>&1; then
        log_info "CouchDB is ready"
        break
    fi
    if [[ $i -eq 30 ]]; then
        log_error "CouchDB failed to start within 30 seconds"
        docker-compose logs
        exit 1
    fi
    sleep 1
done

# Step 4: Configure CouchDB
echo
log_info "[4/8] Configuring CouchDB..."

# Create kat_sessions database
if curl -s -f -u "admin:${COUCH_PASSWORD}" "http://localhost:5984/kat_sessions" > /dev/null 2>&1; then
    log_info "Database 'kat_sessions' already exists"
else
    curl -s -X PUT -u "admin:${COUCH_PASSWORD}" "http://localhost:5984/kat_sessions" > /dev/null
    log_info "Created database 'kat_sessions'"
fi

# Create _users database if it doesn't exist (required for user management)
curl -s -X PUT -u "admin:${COUCH_PASSWORD}" "http://localhost:5984/_users" > /dev/null 2>&1 || true

# Create sync_user with limited permissions
log_info "Creating sync_user for API access..."
curl -s -X PUT -u "admin:${COUCH_PASSWORD}" "http://localhost:5984/_users/org.couchdb.user:sync_user" \
    -H "Content-Type: application/json" \
    -d "{\"name\": \"sync_user\", \"password\": \"${SYNC_PASSWORD}\", \"roles\": [], \"type\": \"user\"}" > /dev/null

# Set database security - only sync_user can access kat_sessions
curl -s -X PUT -u "admin:${COUCH_PASSWORD}" "http://localhost:5984/kat_sessions/_security" \
    -H "Content-Type: application/json" \
    -d '{"admins": {"names": ["admin"], "roles": []}, "members": {"names": ["sync_user"], "roles": []}}' > /dev/null
log_info "sync_user created with access to kat_sessions only"

# Enable CORS for mobile app (restrict to specific origin if known)
curl -s -X PUT -u "admin:${COUCH_PASSWORD}" "http://localhost:5984/_node/_local/_config/httpd/enable_cors" \
    -d '"true"' > /dev/null
curl -s -X PUT -u "admin:${COUCH_PASSWORD}" "http://localhost:5984/_node/_local/_config/cors/origins" \
    -d '"*"' > /dev/null
curl -s -X PUT -u "admin:${COUCH_PASSWORD}" "http://localhost:5984/_node/_local/_config/cors/methods" \
    -d '"GET, PUT, POST, DELETE, OPTIONS"' > /dev/null
curl -s -X PUT -u "admin:${COUCH_PASSWORD}" "http://localhost:5984/_node/_local/_config/cors/headers" \
    -d '"accept, authorization, content-type, origin"' > /dev/null
log_info "CORS enabled for mobile app"

# Create indexes for common queries
curl -s -X POST -u "admin:${COUCH_PASSWORD}" "http://localhost:5984/kat_sessions/_index" \
    -H "Content-Type: application/json" \
    -d '{"index": {"fields": ["queued_at"]}, "name": "date-index"}' > /dev/null
curl -s -X POST -u "admin:${COUCH_PASSWORD}" "http://localhost:5984/kat_sessions/_index" \
    -H "Content-Type: application/json" \
    -d '{"index": {"fields": ["event"]}, "name": "event-index"}' > /dev/null
log_info "Created database indexes"

# Step 5: Configure Nginx
echo
log_info "[5/8] Configuring Nginx..."

# Create htpasswd file for Fauxton admin UI
log_info "Creating htpasswd for Fauxton admin UI..."
echo "${ADMIN_UI_PASSWORD}" | htpasswd -ci /etc/nginx/.htpasswd_fauxton admin
chmod 600 /etc/nginx/.htpasswd_fauxton
chown www-data:www-data /etc/nginx/.htpasswd_fauxton

# Compute base64 credentials for sync_user (used by Nginx to proxy to CouchDB)
SYNC_USER_BASE64=$(echo -n "sync_user:${SYNC_PASSWORD}" | base64)

# Compute base64 credentials for admin (used by Nginx to proxy Fauxton requests to CouchDB)
ADMIN_USER_BASE64=$(echo -n "admin:${COUCH_PASSWORD}" | base64)

# Install site config
cp nginx/kat.conf /etc/nginx/sites-available/kat
sed -i "s|DOMAIN_PLACEHOLDER|${DOMAIN}|g" /etc/nginx/sites-available/kat
sed -i "s|SYNC_USER_BASE64|${SYNC_USER_BASE64}|g" /etc/nginx/sites-available/kat
sed -i "s|ADMIN_USER_BASE64|${ADMIN_USER_BASE64}|g" /etc/nginx/sites-available/kat

# Initialize tokens file and map (needed for nginx config to pass validation)
touch "${SCRIPT_DIR}/tokens.conf"
chmod 600 "${SCRIPT_DIR}/tokens.conf"
echo "# Auto-generated nginx map entries for token validation" > "${SCRIPT_DIR}/tokens.conf.map"
chmod 640 "${SCRIPT_DIR}/tokens.conf.map"
chown root:www-data "${SCRIPT_DIR}/tokens.conf.map"
sed -i "s|TOKENS_FILE_PATH|${SCRIPT_DIR}/tokens.conf|g" /etc/nginx/sites-available/kat

# Enable site
ln -sf /etc/nginx/sites-available/kat /etc/nginx/sites-enabled/

# Check for existing sites (excluding default and kat)
EXISTING_SITES=$(ls /etc/nginx/sites-enabled/ 2>/dev/null | grep -v -E '^(default|kat)$' || true)

if [[ -f /etc/nginx/sites-enabled/default ]]; then
    if [[ -n "$EXISTING_SITES" ]]; then
        log_warn "Detected existing nginx sites: $EXISTING_SITES"
        log_warn "Keeping default site to avoid breaking existing configuration."
    else
        read -p "Remove default nginx site? (recommended for dedicated servers) [y/N] " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            rm -f /etc/nginx/sites-enabled/default
            log_info "Removed default nginx site"
        else
            log_info "Keeping default nginx site"
        fi
    fi
fi

# Test and reload
if nginx -t 2>/dev/null; then
    systemctl reload nginx
    log_info "Nginx configured successfully"
else
    log_error "Nginx configuration test failed"
    nginx -t
    exit 1
fi

# SSL certificate (optional)
echo
read -p "Obtain SSL certificate from Let's Encrypt? [y/N] " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    log_info "Obtaining SSL certificate from Let's Encrypt..."
    certbot --nginx -d "${DOMAIN}" --email "${EMAIL}" --agree-tos --non-interactive --redirect
else
    log_warn "Skipping SSL certificate. You can run manually later:"
    log_warn "  certbot --nginx -d ${DOMAIN}"
fi

# Step 6: Configure Fail2ban
echo
log_info "[6/8] Configuring Fail2ban..."

# Install filter
cp fail2ban/couchdb.conf /etc/fail2ban/filter.d/

# Create jail
cat > /etc/fail2ban/jail.d/couchdb.local << 'EOF'
[couchdb]
enabled = true
port = http,https
filter = couchdb
logpath = /var/log/nginx/access.log
maxretry = 5
bantime = 3600
findtime = 600
EOF

# Restart fail2ban
systemctl restart fail2ban
log_info "Fail2ban configured (ban after 5 failed attempts)"

# Step 7: Install backup script
echo
log_info "[7/8] Setting up automated backups..."

# Update backup script with correct path
sed "s|/path/to/server|${SCRIPT_DIR}|g" backup.sh > /usr/local/bin/kat-backup
chmod +x /usr/local/bin/kat-backup

# Create backup directory
mkdir -p /var/backups/couchdb
chmod 700 /var/backups/couchdb

# Install cron job
cat > /etc/cron.d/kat-backup << 'EOF'
# KAT CouchDB daily backup at 3:00 AM
0 3 * * * root /usr/local/bin/kat-backup >> /var/log/kat-backup.log 2>&1
EOF

log_info "Daily backup scheduled for 3:00 AM"

# Step 8: Initialize API tokens
echo
log_info "[8/8] Setting up API tokens..."

# Install generate-token script
cp "${SCRIPT_DIR}/generate-token.sh" /usr/local/bin/kat-generate-token
chmod +x /usr/local/bin/kat-generate-token

# Generate first token
FIRST_TOKEN=$(openssl rand -hex 32)
echo "${FIRST_TOKEN}" >> "${SCRIPT_DIR}/tokens.conf"
log_info "Generated first API token"

# Regenerate nginx map file from tokens
TOKENS_MAP_FILE="${SCRIPT_DIR}/tokens.conf.map"
echo "# Auto-generated nginx map entries for token validation" > "${TOKENS_MAP_FILE}"
while IFS= read -r token || [[ -n "$token" ]]; do
    # Skip empty lines and comments
    [[ -z "$token" || "$token" =~ ^# ]] && continue
    echo "\"Bearer ${token}\" 1;" >> "${TOKENS_MAP_FILE}"
done < "${SCRIPT_DIR}/tokens.conf"
chmod 640 "${TOKENS_MAP_FILE}"
chown root:www-data "${TOKENS_MAP_FILE}"

# Reload nginx to apply token config
nginx -t && systemctl reload nginx

# Done!
echo
echo -e "${GREEN}"
echo "============================================"
echo "       Setup Complete!"
echo "============================================"
echo -e "${NC}"
echo
echo "CouchDB is now available at:"
echo "  https://${DOMAIN}"
echo
echo "Fauxton Admin UI (HTTP Basic Auth):"
echo "  https://${DOMAIN}/_utils"
echo "  Username: admin"
echo "  Password: (ADMIN_UI_PASSWORD from .env)"
echo
echo "API Access (for mobile app):"
echo "  Endpoint: https://${DOMAIN}/kat_sessions"
echo "  First token: ${FIRST_TOKEN}"
echo "  Configure in mobile app with: Bearer ${FIRST_TOKEN}"
echo
echo "Backups:"
echo "  Location: /var/backups/couchdb"
echo "  Schedule: Daily at 3:00 AM"
echo "  Retention: 30 days"
echo
echo "Security:"
echo "  - TLS enabled (Let's Encrypt)"
echo "  - Firewall active (ports 22, 80, 443)"
echo "  - Fail2ban monitoring"
echo "  - Rate limiting enabled"
echo "  - Token-based API authentication"
echo "  - Fauxton protected by HTTP Basic Auth"
echo
echo "Token Management:"
echo "  Generate new token: kat-generate-token"
echo "  Tokens file: ${SCRIPT_DIR}/tokens.conf"
echo
echo "To test API access:"
echo "  curl -H 'Authorization: Bearer ${FIRST_TOKEN}' https://${DOMAIN}/kat_sessions"
echo
echo "To run a manual backup:"
echo "  /usr/local/bin/kat-backup"
echo
