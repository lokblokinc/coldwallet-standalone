# Cold Wallet Standalone Server - AI Agent Instructions

## Project Overview
Minimal standalone Express server that runs the Cold Wallet plugin in kiosk mode (no authentication). Designed for air-gapped/offline deployments with SQLite persistence. The plugin is synced from a source portal but runs independently here.

## Architecture

### Plugin-First Design
**Critical:** This server adapts to an existing plugin without modifying plugin files. The plugin lives in `views/plug-ins/coldwallet/` and is synced from `../toughlok-portal/views/plug-ins/coldwallet` via `update-plugin.sh`.

- Plugin files: `coldwallet.ejs`, `coldwallet.js`, `plugin.json`, `routes.js`, `assets/js/tssparticipant.js`
- Server adaptation: `server.js` provides the minimal surface to run the plugin standalone
- **Never modify plugin files directly** - they're synced from the source portal

### Data Flow
1. **Client-side storage:** Wallets stored in `localStorage` (key: `cold_wallets_v1`) via `coldwallet.js`
2. **Server-side persistence:** `Address` model in SQLite (`data/database.sqlite`) for address persistence
3. **TSS Communication:** Browser connects directly to TSS endpoints (no server proxy) using env vars passed to client

### Key Files
- `server.js`: Minimal Express app, renders plugin, provides 3 API endpoints
- `config/database.js`: Sequelize config with SQLite pool (max 1 connection)
- `models/address.js`: Single model with `address`, `partyGUID`, `asset`, `user_id` fields
- `views/plug-ins/coldwallet/coldwallet.js`: Client-side wallet logic with localStorage
- `views/plug-ins/coldwallet/coldwallet.ejs`: Main UI template

## Critical Patterns

### SQLite Concurrency Handling
SQLite locks on concurrent writes. `POST /api/addresses` implements exponential backoff retry logic:

```javascript
const maxRetries = 5;
let attempt = 0;
while (attempt < maxRetries) {
  try {
    // ... operation
  } catch (err) {
    if (err.name === 'SequelizeTimeoutError' || err.message?.includes('SQLITE_BUSY')) {
      const backoffDelay = Math.min(100 * Math.pow(2, attempt - 1), 2000);
      await new Promise(resolve => setTimeout(resolve, backoffDelay));
      continue;
    }
  }
}
```

**Always use this pattern when adding new write operations to avoid database lock errors.**

### Plugin Sync Detection
The `check-plugin-sync.sh` script runs on `npm start` (via `prestart`) to detect drift from source portal:

- Compares `coldwallet.js`, `plugin.json`, assets directory
- Skips first line of `coldwallet.ejs` (layout reference differs intentionally)
- Exits non-zero if differences found, warning appears in console

Use `npm run update-plugin` to pull latest plugin code from source portal.

### EJS Layout System
Uses `ejs-mate` for layouts. Plugin view extends `layout-minimal.ejs`:

```ejs
<% layout('/layout-minimal') -%>
<!-- plugin content -->
```

Main server renders with locals expected by plugin (see `server.js` line 33-48).

### Environment Variables
TSS credentials passed from server env to client via EJS locals:

```javascript
TssApiUrl: process.env.TSS_ORCHESTRATOR_API_URL || null,
TssClientId: process.env.TSS_TOKEN_CLIENT_ID || null,
TssClientSecret: process.env.TSS_TOKEN_CLIENT_SECRET || null,
```

Client accesses via `window.CW_ENV` object set in EJS template.

## Development Workflows

### Running Locally
```bash
npm install          # Install dependencies
npm start           # Start server (runs sync check first)
npm run dev         # Auto-reload with nodemon
```

Access at `http://localhost:3001` (configurable via `PORT` env var).

### Plugin Sync Workflow
```bash
npm run check-sync   # Check if plugin differs from source
npm run update-plugin # Copy latest plugin from ../toughlok-portal
```

**When to sync:** After changes in the source portal's coldwallet plugin.

### Database Management
- Schema syncs automatically on startup (`sequelize.sync({ alter: true })`)
- Database file: `data/database.sqlite`
- No migrations needed (uses `alter: true` mode)
- To reset: delete `data/database.sqlite` and restart

## API Contract

### GET /api/addresses
Returns all addresses (no user filtering in standalone mode).

### POST /api/addresses
Creates or updates address with retry logic. Uses `findOrCreate` pattern:

```javascript
const [row, created] = await Address.findOrCreate({
  where: { address },
  defaults: { address, partyGUID, asset, user_id }
});
```

Updates existing row if `asset` or `partyGUID` differs.

### DELETE /api/addresses/:address
Deletes by `address` string (not by ID). Returns 404 if not found.

## Deployment Considerations

### Production Mode
See `DEPLOYMENT.md` for systemd, Docker, PM2 configs. Key points:

- Use `NODE_ENV=production` to disable SQL logging
- Configure firewall to limit access (localhost or specific subnet)
- For air-gapped: pre-package `node_modules/` directory

### Security Model
**No authentication by design** - kiosk mode for controlled environments. If adding auth, you'd need to:

1. Add user management
2. Filter addresses by `user_id` in API endpoints
3. Add session middleware
4. Update plugin rendering to pass `req.user`

Currently `user_id` field exists in `Address` model but is nullable and unused.

## Common Tasks

### Adding a New API Endpoint
Follow existing patterns in `server.js`:

1. Define route handler with error handling
2. Use retry logic if writing to SQLite
3. Return consistent JSON structure: `{ success: true/false, data/error }`

### Modifying the Address Model
Edit `models/address.js`. Schema updates happen automatically on next startup (no migration needed).

### Debugging TSS Issues
Check browser console for TSS API calls. Server only passes env vars to client - no server-side TSS logic.

### Adding New Assets
Place in `views/plug-ins/coldwallet/assets/` - server serves them at `/plug-ins/coldwallet/assets/*`.

## Building Standalone Executables

### Packaging Strategy
Uses `pkg` to create Node.js-free executables. The exe bundles all application code and pure JS dependencies, but **native modules must be distributed alongside**.

### What's Bundled in the Exe
- All JavaScript code (server.js, routes, models, config)
- Node.js runtime (v18)
- Pure JS dependencies (express, ejs, ejs-mate, sequelize JS code)
- Views and public assets (embedded in virtual filesystem)

### What Must Be External
- **sqlite3 native binary** (`node_modules/sqlite3/build/Release/node_sqlite3.node`)
  - Windows: ~400KB PE32+ DLL
  - Linux: ~400KB ELF shared object
  - macOS: ~400KB Mach-O dynamic library
- **data/ folder** (writable location for database)
- **.env file** (configuration)

### Build Process

**Windows:**
```powershell
npm run build:win           # Creates dist/coldwallet-win.exe
create-deployment.bat       # Packages exe + native binary
```

**Linux:**
```bash
npm run build:linux         # Creates dist/coldwallet-linux
./create-deployment.sh      # Packages exe + native binary
```

**macOS:**
```bash
npm run build:mac           # Creates dist/coldwallet-mac
./create-deployment.sh      # Packages exe + native binary
```

### Deployment Package Structure
```
deployment/
├── coldwallet-win.exe              # ~60MB (Windows)
├── node_modules/
│   └── sqlite3/
│       └── build/
│           └── Release/
│               └── node_sqlite3.node   # ~400KB native binary
├── data/                           # Empty folder (created on first run)
└── .env                           # TSS configuration
```

**Total size:** ~60MB (portable, no Node.js installation required)

### Why This Approach Works
- **pkg embeds views/public:** No need to distribute EJS templates separately
- **pkg resolves native modules:** Looks for `node_modules/sqlite3/build/Release/node_sqlite3.node` relative to exe
- **database.js detects pkg:** Uses `process.cwd()/data` for writable database location
- **Single folder deployment:** Copy entire `deployment/` folder to target machine

### Cross-Platform Building
**Critical:** Native binaries are platform-specific. You must:
1. Build on the target platform (or use CI/CD with multiple runners)
2. Run `npm install` on each platform to get the correct sqlite3 binary
3. Use the deployment script to package the platform-matched binary

**Do not mix binaries:** A Linux sqlite3.node will not work with Windows exe.

### Troubleshooting Packaging Issues

**Problem:** "Error: Please install sqlite3 package manually"
- **Cause:** Native binary not found alongside exe
- **Fix:** Ensure `node_modules/sqlite3/build/Release/node_sqlite3.node` exists next to exe

**Problem:** Works from dist/ but not when copied elsewhere
- **Cause:** pkg's module resolution walks up directory tree
- **Fix:** Use `create-deployment.bat/sh` which packages binary in correct location

**Problem:** "is not a valid Win32 application" (Windows)
- **Cause:** Linux/macOS binary used instead of Windows binary
- **Fix:** Build on Windows or use Windows sqlite3 binary from npm

### pkg Configuration
See `package.json` > `pkg` section:
- **assets:** Views, public files, models, config embedded in exe
- **targets:** Node 18 for Windows x64, Linux x64, macOS x64
- **compress:** GZip compression reduces exe size by ~30%

**Do not add sqlite3 to assets** - native modules must be external for pkg to resolve them correctly.

### Updating Plugin in Packaged Build
1. Run `npm run update-plugin` to sync latest plugin from source
2. Rebuild exe: `npm run build:win` (or linux/mac)
3. Run deployment script to repackage

The plugin files are embedded in the exe during build, so any plugin updates require a rebuild.

