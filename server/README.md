# KAT CouchDB Server Setup

Production-ready CouchDB server for syncing KAT spectrometer session data.

## Features

- **CouchDB 3** in Docker with persistent storage
- **Nginx** reverse proxy with TLS (Let's Encrypt)
- **UFW** firewall (only ports 22, 80, 443)
- **Fail2ban** protection against brute force attacks
- **Automated backups** with 30-day retention
- **Rate limiting** to prevent abuse

## Prerequisites

- Ubuntu 20.04+ or Debian 11+ server
- Domain name pointing to server IP (A record)
- Root or sudo access
- Ports 80 and 443 available

## Quick Start

```bash
# 1. Copy files to server
scp -r server/ user@yourserver:/opt/kat-server/

# 2. SSH to server
ssh user@yourserver
cd /opt/kat-server

# 3. Configure
cp .env.example .env
nano .env

# 4. Run setup
sudo ./setup.sh
```

## Configuration

Edit `.env` before running setup:

```bash
# Your domain (must have DNS configured)
DOMAIN=kat.example.com

# Email for Let's Encrypt notifications
EMAIL=admin@example.com

# CouchDB admin password (for server management only)
COUCH_PASSWORD=your_secure_password_here

# Sync user password (used internally by Nginx)
SYNC_PASSWORD=another_secure_password

# Fauxton admin UI password (HTTP Basic Auth for web access)
ADMIN_UI_PASSWORD=ui_access_password
```

## What Gets Installed

| Component | Purpose |
|-----------|---------|
| Docker | Container runtime |
| CouchDB 3 | Document database |
| Nginx | Reverse proxy + TLS |
| Certbot | Let's Encrypt certificates |
| UFW | Firewall |
| Fail2ban | Intrusion prevention |

## Endpoints

After setup, your server provides:

| URL | Auth Method | Description |
|-----|-------------|-------------|
| `https://your-domain.com/_utils` | HTTP Basic Auth | Fauxton admin UI |
| `https://your-domain.com/kat_sessions` | Bearer Token | Sessions database API |
| `https://your-domain.com/_up` | None | Health check |

All other paths are blocked for security.

## Security

### Authentication

The server uses a layered authentication system:

| Endpoint | Auth Method | Credentials |
|----------|-------------|-------------|
| Fauxton (`/_utils`) | HTTP Basic Auth | `admin` / `ADMIN_UI_PASSWORD` |
| API (`/kat_sessions`) | Bearer Token | Token from `tokens.conf` |
| Admin endpoints | HTTP Basic Auth | `admin` / `ADMIN_UI_PASSWORD` |

**CouchDB credentials** (`admin` / `COUCH_PASSWORD`) are never exposed externally. Nginx proxies all requests using the limited `sync_user` account.

### Token Management

API tokens are stored in `/opt/kat-server/tokens.conf`. Each mobile app user needs a unique token.

```bash
# Generate a new token
kat-generate-token

# View existing tokens
cat /opt/kat-server/tokens.conf

# Revoke a token (remove line from file, then reload nginx)
nano /opt/kat-server/tokens.conf
systemctl reload nginx
```

### Firewall Rules
- **Port 22**: SSH
- **Port 80**: HTTP (redirects to HTTPS)
- **Port 443**: HTTPS

### Fail2ban
- Monitors Nginx access logs for 401 responses
- Bans IP after 5 failed attempts
- Ban duration: 1 hour

### Rate Limiting
- 10 requests/second per IP
- Burst allowance: 20 requests

## Backups

Automated daily backups run at 3:00 AM.

```bash
# Manual backup
sudo /usr/local/bin/kat-backup

# View backup logs
tail -f /var/log/kat-backup.log

# List backups
ls -la /var/backups/couchdb/
```

### Backup Contents
- JSON export of all documents (with attachments)
- Docker volume tarball (raw data files)

### Retention
- Backups older than 30 days are automatically deleted

### Restore from Backup

```bash
# Restore JSON backup
gunzip -c /var/backups/couchdb/kat_sessions_YYYYMMDD.json.gz | \
  curl -X POST "http://admin:PASSWORD@localhost:5984/kat_sessions/_bulk_docs" \
    -H "Content-Type: application/json" \
    -d @-

# Or restore Docker volume
docker-compose down
docker run --rm -v kat-couchdb-data:/data -v /var/backups/couchdb:/backup \
  alpine tar xzf /backup/volume_YYYYMMDD.tar.gz -C /data
docker-compose up -d
```

## Maintenance

### View Logs

```bash
# CouchDB logs
docker logs kat-couchdb -f

# Nginx logs
tail -f /var/log/nginx/access.log
tail -f /var/log/nginx/error.log

# Fail2ban status
sudo fail2ban-client status couchdb
```

### Restart Services

```bash
# Restart CouchDB
cd /opt/kat-server && docker-compose restart

# Restart Nginx
sudo systemctl restart nginx

# Restart Fail2ban
sudo systemctl restart fail2ban
```

### Update CouchDB

```bash
cd /opt/kat-server
docker-compose pull
docker-compose up -d
```

### Renew SSL Certificate

Certbot auto-renews certificates. To manually renew:

```bash
sudo certbot renew
```

## Querying Data

### Using curl with Bearer Token

```bash
# List all sessions
curl -H "Authorization: Bearer YOUR_TOKEN" \
  https://your-domain.com/kat_sessions/_all_docs

# Find by event name
curl -H "Authorization: Bearer YOUR_TOKEN" \
  -X POST https://your-domain.com/kat_sessions/_find \
  -H "Content-Type: application/json" \
  -d '{"selector": {"event": {"$regex": "field test"}}}'

# Find by date range
curl -H "Authorization: Bearer YOUR_TOKEN" \
  -X POST https://your-domain.com/kat_sessions/_find \
  -H "Content-Type: application/json" \
  -d '{"selector": {"queued_at": {"$gte": "2024-01-01"}}}'
```

### Using Fauxton UI

1. Navigate to `https://your-domain.com/_utils`
2. Login with HTTP Basic Auth (admin / ADMIN_UI_PASSWORD)
3. Click on `kat_sessions` database
4. Use "Mango Query" for advanced searches

## Troubleshooting

### CouchDB won't start

```bash
# Check Docker status
docker ps -a
docker logs kat-couchdb

# Check if port is in use
sudo lsof -i :5984
```

### Can't connect from mobile app

1. Verify DNS is resolving: `dig your-domain.com`
2. Check firewall: `sudo ufw status`
3. Test locally: `curl http://localhost:5984/`
4. Check Nginx: `sudo nginx -t`

### SSL certificate issues

```bash
# Check certificate status
sudo certbot certificates

# Force renewal
sudo certbot renew --force-renewal

# Check Nginx SSL config
sudo nginx -t
```

### Banned by Fail2ban

```bash
# Check banned IPs
sudo fail2ban-client status couchdb

# Unban an IP
sudo fail2ban-client set couchdb unbanip 1.2.3.4
```

### High disk usage

```bash
# Check CouchDB data size
docker exec kat-couchdb du -sh /opt/couchdb/data

# Compact database
curl -X POST "http://admin:PASSWORD@localhost:5984/kat_sessions/_compact" \
  -H "Content-Type: application/json"

# Clean old backups
find /var/backups/couchdb -name "*.gz" -mtime +7 -delete
```

## File Structure

```
/opt/kat-server/
├── .env                 # Configuration (chmod 600)
├── docker-compose.yml   # Container definition
├── setup.sh             # Installation script
├── backup.sh            # Backup script template
├── generate-token.sh    # Token generation script
├── tokens.conf          # API tokens (chmod 600)
├── tokens.conf.map      # Nginx token map (auto-generated)
├── nginx/
│   └── kat.conf         # Nginx site config
└── fail2ban/
    └── couchdb.conf     # Fail2ban filter

/etc/nginx/sites-available/kat    # Installed Nginx config
/etc/nginx/.htpasswd_fauxton      # Fauxton admin password
/etc/fail2ban/filter.d/couchdb.conf
/etc/fail2ban/jail.d/couchdb.local
/etc/cron.d/kat-backup
/usr/local/bin/kat-backup         # Installed backup script
/usr/local/bin/kat-generate-token # Installed token generator
/var/backups/couchdb/             # Backup storage
/var/log/kat-backup.log           # Backup logs
```

## Mobile App Configuration

In the KAT mobile app settings:

| Setting | Value |
|---------|-------|
| Server URL | `https://your-domain.com` |
| API Token | (token from `kat-generate-token`) |
| Auto-sync | Enable for automatic uploads |

### Getting a Token

1. SSH to your server
2. Run `kat-generate-token`
3. Copy the generated token
4. Paste into mobile app settings

## Support

For issues with:
- **This setup**: Check the troubleshooting section above
- **KAT mobile app**: See main project documentation
- **CouchDB**: https://docs.couchdb.org/
