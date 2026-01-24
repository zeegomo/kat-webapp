#!/bin/bash
# KAT CouchDB Backup Script
# Backs up all databases and Docker volumes
#
# Install: Copy to /usr/local/bin/kat-backup
# Schedule: Add to cron for daily backups

set -euo pipefail

# Configuration
BACKUP_DIR="/var/backups/couchdb"
RETENTION_DAYS=30
DATE=$(date +%Y%m%d_%H%M%S)
LOG_PREFIX="[$(date '+%Y-%m-%d %H:%M:%S')]"

# Load credentials
ENV_FILE="/path/to/server/.env"
if [[ ! -f "$ENV_FILE" ]]; then
    echo "$LOG_PREFIX ERROR: Environment file not found: $ENV_FILE"
    exit 1
fi
source "$ENV_FILE"

if [[ -z "${COUCH_PASSWORD:-}" ]]; then
    echo "$LOG_PREFIX ERROR: COUCH_PASSWORD not set in environment"
    exit 1
fi

# Create backup directory
mkdir -p "${BACKUP_DIR}"
chmod 700 "${BACKUP_DIR}"

echo "$LOG_PREFIX Starting CouchDB backup..."

# Check if CouchDB is running
if ! curl -s -f http://localhost:5984/ > /dev/null 2>&1; then
    echo "$LOG_PREFIX ERROR: CouchDB is not responding"
    exit 1
fi

# Get list of databases (excluding system databases)
DATABASES=$(curl -s "http://admin:${COUCH_PASSWORD}@localhost:5984/_all_dbs" | jq -r '.[]' | grep -v "^_" || true)

if [[ -z "$DATABASES" ]]; then
    echo "$LOG_PREFIX WARNING: No user databases found to backup"
else
    # Backup each database
    for db in $DATABASES; do
        echo "$LOG_PREFIX Backing up database: ${db}"
        BACKUP_FILE="${BACKUP_DIR}/${db}_${DATE}.json.gz"

        # Export all documents including attachments metadata
        curl -s "http://admin:${COUCH_PASSWORD}@localhost:5984/${db}/_all_docs?include_docs=true&attachments=true" \
            | gzip > "${BACKUP_FILE}"

        # Verify backup
        if gzip -t "${BACKUP_FILE}" 2>/dev/null; then
            SIZE=$(du -h "${BACKUP_FILE}" | cut -f1)
            echo "$LOG_PREFIX   Created: ${BACKUP_FILE} (${SIZE})"
        else
            echo "$LOG_PREFIX ERROR: Backup verification failed for ${db}"
            rm -f "${BACKUP_FILE}"
        fi
    done
fi

# Backup Docker volume (raw data)
echo "$LOG_PREFIX Backing up Docker volume..."
VOLUME_BACKUP="${BACKUP_DIR}/volume_${DATE}.tar.gz"

if docker volume inspect kat-couchdb-data > /dev/null 2>&1; then
    docker run --rm \
        -v kat-couchdb-data:/data:ro \
        -v "${BACKUP_DIR}":/backup \
        alpine tar czf "/backup/volume_${DATE}.tar.gz" -C /data .

    if [[ -f "${VOLUME_BACKUP}" ]]; then
        SIZE=$(du -h "${VOLUME_BACKUP}" | cut -f1)
        echo "$LOG_PREFIX   Created: ${VOLUME_BACKUP} (${SIZE})"
    fi
else
    echo "$LOG_PREFIX WARNING: Docker volume 'kat-couchdb-data' not found"
fi

# Remove old backups
echo "$LOG_PREFIX Cleaning up backups older than ${RETENTION_DAYS} days..."
DELETED=$(find "${BACKUP_DIR}" -name "*.gz" -mtime +${RETENTION_DAYS} -delete -print | wc -l)
echo "$LOG_PREFIX   Removed ${DELETED} old backup files"

# Summary
TOTAL_SIZE=$(du -sh "${BACKUP_DIR}" | cut -f1)
BACKUP_COUNT=$(find "${BACKUP_DIR}" -name "*.gz" | wc -l)
echo "$LOG_PREFIX Backup complete!"
echo "$LOG_PREFIX   Location: ${BACKUP_DIR}"
echo "$LOG_PREFIX   Total backups: ${BACKUP_COUNT}"
echo "$LOG_PREFIX   Total size: ${TOTAL_SIZE}"
