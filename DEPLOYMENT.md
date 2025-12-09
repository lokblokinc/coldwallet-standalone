# Cold Wallet Kiosk Deployment Guide

## Quick Start

```bash
# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your TSS endpoints

# Start the kiosk server
npm start
```

Access at: **http://localhost:3001**

## Deployment Modes

### 1. Development/Testing
```bash
npm start
```

### 2. Production (Linux systemd)
Create `/etc/systemd/system/coldwallet-kiosk.service`:

```ini
[Unit]
Description=Cold Wallet Kiosk Server
After=network.target

[Service]
Type=simple
User=kiosk
WorkingDirectory=/opt/coldwallet-standalone
Environment=NODE_ENV=production
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl enable coldwallet-kiosk
sudo systemctl start coldwallet-kiosk
sudo systemctl status coldwallet-kiosk
```

### 3. Docker Container
```dockerfile
FROM node:18-alpine

WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .

EXPOSE 3001
CMD ["node", "server.js"]
```

Build and run:
```bash
docker build -t coldwallet-kiosk .
docker run -d -p 3001:3001 --name coldwallet coldwallet-kiosk
```

### 4. PM2 Process Manager
```bash
npm install -g pm2
pm2 start server.js --name coldwallet-kiosk
pm2 save
pm2 startup
```

## Security Considerations

### Air-gapped Deployment
For maximum security, deploy on an isolated network:
1. Install dependencies on internet-connected machine
2. Package entire `node_modules/` directory
3. Transfer to air-gapped kiosk
4. Configure TSS endpoints to internal mirrors

### Firewall Rules
```bash
# Allow only localhost connections
sudo ufw allow from 127.0.0.1 to any port 3001

# Or allow specific subnet (e.g., kiosk network)
sudo ufw allow from 192.168.100.0/24 to any port 3001
```

### HTTPS Proxy (Production)
Use nginx as reverse proxy with SSL:

```nginx
server {
    listen 443 ssl;
    server_name coldwallet.example.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://localhost:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

## Monitoring

### Health Check
```bash
curl http://localhost:3001/health
```

Expected response:
```json
{
  "status": "healthy",
  "timestamp": "2025-12-09T...",
  "config": {
    "tssApiUrl": "https://...",
    "nodeEnv": "production"
  }
}
```

### Logs
Server logs to stdout. Capture with systemd journal or PM2:
```bash
# Systemd
sudo journalctl -u coldwallet-kiosk -f

# PM2
pm2 logs coldwallet-kiosk
```

## Backup and Recovery

### Database Backup
```bash
# Backup SQLite database
cp data/database.sqlite data/database.backup.$(date +%Y%m%d).sqlite

# Automated daily backup (cron)
0 2 * * * cp /opt/coldwallet-standalone/data/database.sqlite /backup/coldwallet-$(date +\%Y\%m\%d).sqlite
```

### Restore
```bash
cp data/database.backup.20251209.sqlite data/database.sqlite
# Restart server
```

## Troubleshooting

### Port Already in Use
```bash
# Find process using port 3001
lsof -i :3001
# or
netstat -tulpn | grep 3001

# Kill existing process
pkill -f "node server.js"
```

### Database Locked
SQLite is single-writer. Ensure only one server instance is running:
```bash
ps aux | grep "node server.js"
```

### TSS Connection Errors
Check browser console (F12) for CORS or network errors. Verify:
1. TSS endpoints are accessible from kiosk network
2. `.env` variables are correctly configured
3. No firewall blocking outbound HTTPS

## Maintenance

### Update Plugin from Source
When the cold wallet plugin is updated in the main portal:
```bash
# Check for differences
npm run check-sync

# Update if out of sync
npm run update-plugin

# Restart server
pm2 restart coldwallet-kiosk
# or
sudo systemctl restart coldwallet-kiosk
```

### Update Dependencies
```bash
npm update
npm audit fix
```

## Hardware Recommendations

### Minimum Requirements
- CPU: 2 cores, 2 GHz
- RAM: 2 GB
- Storage: 10 GB
- Network: Ethernet (preferred for stability)

### Recommended Kiosk Hardware
- Intel NUC or similar compact PC
- 8 GB RAM
- SSD for faster database operations
- Wired network connection
- Optional: Hardware security module (HSM) integration

## Next Steps

After successful kiosk deployment:
1. Test wallet creation and recovery flows
2. Validate TSS enrollment with QR code scanning
3. Document user procedures for kiosk operation
4. Consider Electron desktop app for offline/portable deployment

See `doc/MINIMAL_COLDWALLET_SERVER.md` for Electron enhancement details.
