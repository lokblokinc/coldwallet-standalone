# Cold Wallet Standalone Server

Minimal standalone server for running the Cold Wallet plugin without the full ToughLok Portal infrastructure.

## Features

- 🔐 No authentication required (kiosk mode)
- 💾 SQLite database for address persistence
- 🔄 Browser-direct TSS connectivity
- 📦 Node.js-free executable deployment
- 🔍 Automatic plugin sync detection
- 🖥️ Cross-platform support (Windows, Linux, macOS)

## Quick Start

### Development Mode

```bash
# Install dependencies
npm install

# Copy environment configuration
cp .env.example .env

# Edit .env with your TSS credentials
nano .env

# Start the server
npm start
```

### Access

- **Cold Wallet UI:** http://localhost:3001/
- **Health Check:** http://localhost:3001/health
- **API Endpoints:** http://localhost:3001/api/addresses

## Standalone Executable Deployment

### Building Executables

The server can be packaged into a Node.js-free executable (~60MB) using `pkg`:

```bash
# Build for Windows
npm run build:win

# Build for Linux
npm run build:linux

# Build for macOS
npm run build:mac

# Build for all platforms
npm run build:all
```

Executables are created in `dist/` directory.

### Creating Deployment Package

After building, create a deployment package with the required native binary:

**Windows:**
```cmd
create-deployment.bat
```

**Linux/macOS:**
```bash
./create-deployment.sh
```

This creates a `deployment/` folder containing:
- Executable (~60MB)
- SQLite native binary (~400KB in `node_modules/sqlite3/build/Release/`)
- Empty `data/` folder for database
- `.env` configuration template

### Running Packaged Executable

Copy the entire `deployment/` folder to target machine and run:

**Windows:**
```cmd
cd deployment
coldwallet-win.exe
```

**Linux/macOS:**
```bash
cd deployment
./coldwallet-linux  # or ./coldwallet-mac
```

**Total deployment size:** ~60MB (no Node.js installation required)

## Development

```bash
# Start with auto-reload
npm run dev

# Check if plugin is in sync with source
npm run check-sync

# Update plugin from source portal
npm run update-plugin
```

## API Endpoints

### GET /api/addresses
Returns all wallet addresses from database.

**Response:**
```json
{
  "success": true,
  "addresses": [
    {
      "id": 1,
      "address": "0x...",
      "asset": "ETH",
      "partyGUID": "..."
    }
  ]
}
```

### POST /api/addresses
Create or update a wallet address.

**Request:**
```json
{
  "address": "0x...",
  "partyGUID": "...",
  "asset": "BTC"
}
```

**Response:**
```json
{
  "success": true,
  "address": { ... }
}
```

### DELETE /api/addresses/:address
Delete a wallet address by address string.

**Response:**
```json
{
  "success": true,
  "message": "Address deleted successfully"
}
```

## Database

- **Type:** SQLite
- **Location:** `./data/database.sqlite`
- **Schema:** Auto-synced on startup (no migrations needed)
- **Model:** Address only (id, address, asset, partyGUID, user_id, timestamps)
- **Concurrency:** Single connection pool with exponential backoff retry

## Plugin Sync

The server automatically checks if the cold wallet plugin differs from the source portal on startup.

**Warning displayed if out of sync:**
```
⚠️  Plugin is out of sync with source!
💡 Run 'npm run update-plugin' to sync from source
```

**Update workflow:**
1. Portal plugin is updated at `/toughlok-portal/views/plug-ins/coldwallet/`
2. Run `npm run check-sync` to see differences
3. Run `npm run update-plugin` to sync (creates backup automatically)
4. Rebuild executable if deploying: `npm run build:win` + `create-deployment.bat`

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | 3001 |
| `NODE_ENV` | Environment | development |
| `TSS_ORCHESTRATOR_API_URL` | TSS orchestrator endpoint | (required) |
| `TSS_TOKEN_CLIENT_ID` | TSS client ID | (required) |
| `TSS_TOKEN_CLIENT_SECRET` | TSS client secret | (required) |
| `TSS_TOKEN_URL` | TSS token endpoint | (required) |
| `TSS_HELPER_API_URL` | TSS helper endpoint | (optional) |

## Architecture

- **Server:** Express.js (minimal configuration, 6 dependencies)
- **View Engine:** EJS with ejs-mate
- **Database:** Sequelize + sqlite3 (native module)
- **Plugin:** Copied from main portal with zero modifications
- **Packaging:** pkg with GZip compression
- **Native Module:** Single sqlite3 binary shipped alongside exe

## Cross-Platform Notes

- **Build on target platform:** Native binaries are platform-specific
- Scripts work on Windows (.bat) and Unix (.sh) automatically
- Deployment script copies correct platform-specific sqlite3 binary

## Troubleshooting

### Plugin Not Loading
- Check `views/plug-ins/coldwallet/` exists
- Verify first line of `coldwallet.ejs` uses `layout('layout-minimal')`

### Database Locked
- Server uses retry logic with exponential backoff
- SQLite pool size limited to 1 connection
- Ensure only one server instance is running

### TSS Connection Errors
- Verify TSS environment variables in `.env`
- Check browser console for CORS errors
- Confirm network access to TSS endpoints

### Packaged Executable Errors

**"Error: Please install sqlite3 package manually"**
- Native binary not found alongside exe
- Ensure `node_modules/sqlite3/build/Release/node_sqlite3.node` exists
- Use `create-deployment.bat/sh` to package correctly

**"is not a valid Win32 application" (Windows)**
- Wrong platform binary (Linux/macOS binary with Windows exe)
- Rebuild on Windows or use Windows sqlite3 binary

## License

Copyright (c) 2025 Lokblok, Inc. All Rights Reserved.

This software is proprietary and confidential. Unauthorized copying, distribution, modification, or use of this software, via any medium, is strictly prohibited.

## Additional Documentation

- **Copilot Instructions:** `.github/copilot-instructions.md` - Comprehensive AI agent guidance
- **Design Document:** `doc/MINIMAL_COLDWALLET_SERVER.md` - Detailed architecture and design decisions
- **Deployment Guide:** `DEPLOYMENT.md` - Production deployment strategies
