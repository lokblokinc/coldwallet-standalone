# Minimal Cold Wallet Server Design (Standalone, No Login)

## Goal
Run the `coldwallet` plugin standalone with only the minimal server surface and SQLite storage required. No login, no passport, no session store. Keep the UI and client-side flows intact while exposing the smallest set of routes and assets to make it usable for offline/air‑gapped or kiosk use.

## Design Approach
**Zero changes to the cold wallet plugin.** The server adapts completely to the existing plugin code without modifying any files in `views/plug-ins/coldwallet/`. This ensures the plugin can be dropped in and run immediately.

## Core Constraints
- Express server with EJS view engine
- Only `sqlite3` + `sequelize` for persistence (Addresses table)
- No authentication, sessions, or user management
- Reuse all existing plugin files: `coldwallet.ejs`, `coldwallet.js`, `assets/js/tssparticipant.js`
- Minimal dependencies: no plugin manager, dashboards, roles, passport, or cookies

## Server Architecture

### Core Server (`server-min.js`)
Minimal Express application that serves the cold wallet UI and required APIs:

**Routes:**
- `GET /` → renders `plug-ins/coldwallet/coldwallet.ejs` with required locals
- `GET /api/addresses` → returns all addresses (no user filtering)
- `POST /api/addresses` → create or update an address
- `DELETE /api/addresses/:address` → delete address by address string
- `GET /health` → health check endpoint

**Static Assets:**
- `/public/*` → serve common CSS/JS from public directory
- `/plug-ins/coldwallet/assets/*` → serve plugin-specific assets (tssparticipant.js)

**EJS Configuration:**
- View engine: `ejs` (with optional `ejs-mate` for layout support)
- Views root: `views/`
- Layout: minimal layout that provides basic HTML structure without navigation

### Database Layer
- **File:** `data/database.sqlite`
- **Model:** Reuse `models/address.js` only
- **Initialization:** `sequelize.sync({ alter: true })` on startup (no migrations runner)
- **Concurrency:** SQLite pool settings from `config/database.js`
- **No Session Store:** Skip `connect-session-sequelize` entirely

## Plugin Files (Unchanged)
All files in `views/plug-ins/coldwallet/` remain untouched:
- `coldwallet.ejs` - main UI template
- `coldwallet.js` - client-side wallet management and localStorage handling
- `assets/js/tssparticipant.js` - WebSocket enrollment client for TSS operations
- `routes.js` - **NOT USED** in minimal server (we implement routes directly)
- Plugin operates exactly as it does in the full portal

## Services and Variables That Must Be "Faked"

### 1. Middleware Dependencies (NOT USED - Bypass Routes.js)
The plugin's `routes.js` file requires these middlewares:
```javascript
const { checkLoggedIn } = require('../../../middlewares/roles');
const { isSecureTerminal } = require('../../../middlewares/security');
```

**Solution:** Don't use the plugin's `routes.js`. The minimal server implements its own routes directly without authentication middleware.

### 2. Layout and Partials (MUST PROVIDE)
`coldwallet.ejs` uses `<%- layout('layout') %>` which expects:
- `layout.ejs` with `<%- body %>` placeholder
- `partials/header.ejs` - expects `serverMode` variable
- `partials/slideout.ejs` - expects `user`, `navigationPlugins`, `allowCoreAccess`
- `partials/footer.ejs` - static content

**Solution:** Create minimal versions of these files:
- `views/layout-minimal.ejs` - basic HTML wrapper without portal features
- Skip or stub header/slideout/footer partials, OR provide minimal versions
- Alternative: Modify layout.ejs expectation (see below)

### 3. EJS Template Locals (MUST PROVIDE)
The template expects these variables to be defined:

**Required (used in template):**
- `title` - page title
- `stylesheets` - array of CSS files
- `NODE_ENV` - environment string
- `isSecureTerminal` - boolean (set to `false`)
- `addresses` - array (can be empty `[]`)
- `baseUrl` - string (`'/'`)
- TSS variables: `TssApiUrl`, `TssClientId`, `TssClientSecret`, `TssTokenUrl`, `TssHelperUrl`

**For Layout/Partials (if using full layout):**
- `serverMode` - string for header (e.g., `'Standalone'`)
- `user` - object or `null` (partials check `user.roles`, `user.reqUserAgent`)
- `navigationPlugins` - array (can be empty `[]`)

### 4. Model Dependencies (PARTIAL USE)
Plugin routes expect:
```javascript
const { Address, User } = require('../../../models');
```

**Solution:** 
- Minimal server only needs `Address` model
- `User` model NOT required (no user authentication)
- Our direct routes don't filter by `req.user.id`

### 5. Request Object Properties (NOT NEEDED)
Plugin routes expect:
- `req.user` - authenticated user object
- `req.user.id` - user ID for filtering addresses
- `req.isAuthenticated()` - passport method

**Solution:** Minimal server doesn't provide these. Our own routes don't reference `req.user`.

### 6. Error Handling (SIMPLE ALTERNATIVE)
Plugin routes use:
```javascript
res.status(500).render('error', { error: 'Failed to load Cold Wallet page' });
```

**Solution:** Provide simple `error.ejs` template or use JSON error responses

## Environment Variables
Required TSS configuration (passed to template):
- `TSS_ORCHESTRATOR_API_URL` - TSS orchestrator endpoint
- `TSS_TOKEN_CLIENT_ID` - TSS client identifier
- `TSS_TOKEN_CLIENT_SECRET` - TSS client secret
- `TSS_TOKEN_URL` - TSS token endpoint
- `TSS_HELPER_API_URL` - TSS helper endpoint (optional)

Other configuration:
- `NODE_ENV` - environment (default: `development`)
- `PORT` - server port (default: `3001` to avoid clash with full portal)

## API Endpoint Details

### `GET /`
Renders `coldwallet.ejs` with required locals:
```javascript
{
  title: 'Cold Wallet',
  stylesheets: ['/css/loading-overlay.css'],
  user: null,  // no authentication
  NODE_ENV: process.env.NODE_ENV || 'development',
  isSecureTerminal: false,  // no terminal enforcement
  addresses: [],  // empty; UI uses localStorage
  baseUrl: '/',
  TssApiUrl: process.env.TSS_ORCHESTRATOR_API_URL,
  TssClientId: process.env.TSS_TOKEN_CLIENT_ID,
  TssClientSecret: process.env.TSS_TOKEN_CLIENT_SECRET,
  TssTokenUrl: process.env.TSS_TOKEN_URL,
  TssHelperUrl: process.env.TSS_HELPER_API_URL
}
```

### `GET /api/addresses`
Returns all addresses from database (no user filtering):
```json
{
  "success": true,
  "addresses": [
    {"id": 1, "address": "0x...", "asset": "ETH", "partyGUID": "..."}
  ]
}
```

### `POST /api/addresses`
Creates or updates an address:
- **Body:** `{ address, partyGUID, asset, userId }`
- **Behavior:** `findOrCreate` on `address`, update `asset`/`partyGUID` if changed
- **Response:** Address record (status 201 if created, 200 if updated)

### `DELETE /api/addresses/:address`
Deletes address by address string:
- **Response:** `{ success: true, message: '...', address: '...' }`

## Key Differences from Full Portal
**What's Removed:**
- Plugin manager and plugin auto-discovery
- Authentication system (passport, sessions, cookies)
- User management and role-based access control
- Audit logging
- Navigation sidebar and dashboard
- Migration runner (replaced with sync)
- All other plugins and routes

**What's Kept:**
- Address model and SQLite persistence
- EJS templating
- TSS connectivity (browser-direct via tssparticipant.js)
- All cold wallet functionality

## Implementation Plan

### Phase 1: Core Server Setup
1. Create `server-min.js` with Express and EJS configuration
2. Set up static file serving for `/public` and plugin assets
3. Configure environment variable loading via dotenv
4. Initialize Sequelize with SQLite and sync Address model

### Phase 2: Route Implementation
1. Implement `GET /` with required locals for coldwallet.ejs
2. Implement address CRUD endpoints (GET/POST/DELETE)
3. Add health check endpoint
4. Add basic error handling

### Phase 3: Layout and Assets
1. Create minimal `layout-minimal.ejs` for basic HTML structure
2. Create stub partials (header/slideout/footer) or modify coldwallet.ejs to use minimal layout
3. Ensure CSS files are accessible (loading-overlay.css)
4. Verify plugin asset paths work correctly
5. Test CDN dependencies (Bootstrap, html5-qrcode, QRious)

### Phase 4: Testing and Validation
1. Verify page renders with all UI elements
2. Test TSS connectivity through browser
3. Validate address API operations
4. Confirm localStorage wallet persistence
5. Test QR code generation and scanning## File Structure

### Required New Files
```
server-min.js              # Main server file
views/layout-minimal.ejs   # Minimal layout wrapper (no nav/auth)
views/partials-minimal/    # Optional: minimal header/footer stubs
views/error.ejs            # Simple error page (or reuse existing)
.env.example               # Example environment configuration
README-MINIMAL.md          # Setup and run instructions
```

### Reused Files (No Changes)
```
views/plug-ins/coldwallet/
  ├── coldwallet.ejs       # Main UI template
  ├── coldwallet.js        # Client-side logic
  └── assets/
      └── js/
          └── tssparticipant.js   # TSS WebSocket client

models/
  └── address.js           # Address model

config/
  └── database.js          # Sequelize configuration

public/
  └── css/
      └── loading-overlay.css    # CSS for loading states
```

## Dependencies

### Required NPM Packages
```json
{
  "express": "^4.18.2",
  "ejs": "^3.1.8",
  "ejs-mate": "^4.0.0",
  "dotenv": "^16.4.7",
  "sequelize": "^6.35.0",
  "sqlite3": "^5.1.7"
}
```

### Explicitly Excluded
- `passport`, `passport-local`
- `express-session`, `connect-session-sequelize`
- `connect-flash`
- `bcrypt`, `bcryptjs`
- Any user/role management packages

## Sequelize Configuration

### Database Initialization Strategy

**No Migrations Runner - Use Sync Instead**

The minimal server does NOT use the migration runner from the full portal. Instead, it uses Sequelize's `sync()` method for simplicity:

```javascript
const { Sequelize } = require('sequelize');
const path = require('path');

const dbPath = path.resolve('./data/database.sqlite');
const sequelize = new Sequelize(`sqlite:${dbPath}`, {
  dialect: 'sqlite',
  logging: console.log,
  pool: {
    max: 1,
    min: 0,
    acquire: 30000,
    idle: 5000
  }
});

// Auto-sync Address model only - runs on every startup
await sequelize.sync({ alter: true });
```

**What happens on startup:**
1. Sequelize connects to SQLite database (creates file if doesn't exist)
2. `sync({ alter: true })` ensures `Addresses` table matches the model definition
3. Adds missing columns, but doesn't drop existing data
4. No separate migration files or tracking needed

**Key Differences from Full Portal:**
- ❌ No migration runner (`lib/coreMigrationRunner.js`, `lib/migrationManager.js`)
- ❌ No `migrations/` directory needed
- ❌ No migration tracking table
- ✅ Simple `sync()` on every startup
- ✅ Only one model: `Address`
- ✅ Safe for existing data (alter mode)

**Why This Works:**
- Single model makes schema simple
- No complex migration dependencies
- `alter: true` is safe for development and production
- Automatic on every server start
- No manual migration commands needed

**Startup Sequence:**
```javascript
// server.js startup
async function startServer() {
  // 1. Initialize database
  const Address = require('./models/address');
  await sequelize.authenticate();
  console.log('✅ Database connected');
  
  // 2. Auto-sync schema (this is our "migration")
  await sequelize.sync({ alter: true });
  console.log('✅ Database schema synced');
  
  // 3. Start Express server
  app.listen(PORT, () => {
    console.log(`✅ Server running on http://localhost:${PORT}`);
  });
}
```

**Important Notes:**
- Database file created automatically in `data/database.sqlite`
- Schema updates happen automatically when model changes
- No migration files to maintain
- Works for small, single-model scenarios
- For production with multiple models, consider migration runner

### Validation Checklist
- Page renders: `GET /` shows Cold Wallet UI with QR and scanner controls
- Assets load: `tssparticipant.js` and any CDN assets are accessible
- TSS flow: browser connects to TSS endpoints via `tssparticipant.js` (envs present)
- Address API: `GET/POST/DELETE /api/addresses` operate without `req.user` (Approach 1 server-side enabled)
- LocalStorage: creating a wallet updates the dropdown and persists locally
- Health: `GET /health` returns expected JSON

## Layout Strategy Options

### Option A: Minimal Layout with Stub Partials (Recommended)
Create `views/layout-minimal.ejs` that provides basic HTML without portal navigation:
```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title><%= title || "Cold Wallet" %></title>
  <% if (stylesheets && stylesheets.length) { %>
    <% stylesheets.forEach(function(stylesheet) { %>
      <link rel="stylesheet" href="<%= stylesheet %>">
    <% }) %>
  <% } %>
</head>
<body>
  <%- body %>
</body>
</html>
```

Then modify `coldwallet.ejs` first line to: `<%- layout('layout-minimal') %>`

**Downside:** Requires one-line change to plugin file (violates zero-change rule).

### Option B: Full Layout with Empty Partials
Keep `coldwallet.ejs` unchanged, provide full `layout.ejs` and create empty stub partials:
- `views/partials/header.ejs` - empty or minimal header
- `views/partials/slideout.ejs` - empty navigation
- `views/partials/footer.ejs` - minimal footer

Provide required variables: `serverMode='Standalone'`, `user=null`, `navigationPlugins=[]`

**Advantage:** True zero changes to plugin files.
**Downside:** More template files to create.

### Layout Strategy: Minimal Layout ✅ **SELECTED**
Use `layout-minimal.ejs` (simple HTML wrapper) and modify plugin's layout reference.

**Decision:** Modify first line of coldwallet.ejs to use `layout-minimal` instead of `layout`.

## Plugin Directory Strategy: Symlink vs Copy

### Option A: Symlink to Plugin ✅ **RECOMMENDED**
```bash
ln -s ../../toughlok-portal/views/plug-ins/coldwallet ./views/plug-ins/coldwallet
```

**Advantages:**
- Always in sync with main portal plugin
- Plugin updates automatically available
- No duplication of assets (disk space)
- Bug fixes in portal immediately reflected
- Zero manual sync work

**Drawbacks:**
- Requires layout reference modification (one line change)
- Symlink must be preserved during deployment
- Both projects must be present on filesystem
- Cannot deploy standalone server truly independently (needs portal nearby)
- Breaking changes in portal could break standalone server
- May not work on some Windows systems without admin rights

**Best for:** Development, testing, when both portal and standalone are on same system

### Option B: Copy Plugin Directory
```bash
cp -r ../toughlok-portal/views/plug-ins/coldwallet ./views/plug-ins/
```

**Advantages:**
- Fully self-contained deployment
- No dependency on portal location
- Can zip and deploy anywhere (air-gapped kiosks)
- Portal changes don't affect standalone
- Works on all operating systems
- True independence

**Drawbacks:**
- Manual sync needed for plugin updates
- Disk space duplication
- Bug fixes require re-copy
- May diverge over time

**Best for:** Production, air-gapped deployments, distribution to external systems

### Selected Approach: Copy with Sync Detection ✅

Always copy the plugin directory. Include a sync-check script that warns when source and copy differ.

**Sync Check Script (`check-plugin-sync.sh`):**
```bash
#!/bin/bash
# Check if coldwallet plugin differs from source

SOURCE="../toughlok-portal/views/plug-ins/coldwallet"
TARGET="./views/plug-ins/coldwallet"

if [ ! -d "$SOURCE" ]; then
    echo "⚠️  Warning: Source plugin not found at $SOURCE"
    exit 1
fi

if [ ! -d "$TARGET" ]; then
    echo "⚠️  Warning: Target plugin not found at $TARGET"
    exit 1
fi

# Compare directories, excluding the first line of coldwallet.ejs (layout reference)
echo "🔍 Checking for plugin differences..."

# Temporarily create comparison files
cp "$SOURCE/coldwallet.ejs" /tmp/source-coldwallet.ejs
cp "$TARGET/coldwallet.ejs" /tmp/target-coldwallet.ejs

# Remove first line from both (layout reference differs intentionally)
tail -n +2 /tmp/source-coldwallet.ejs > /tmp/source-coldwallet-stripped.ejs
tail -n +2 /tmp/target-coldwallet.ejs > /tmp/target-coldwallet-stripped.ejs

# Compare other files
DIFF_FOUND=0

# Check coldwallet.ejs (excluding first line)
if ! diff -q /tmp/source-coldwallet-stripped.ejs /tmp/target-coldwallet-stripped.ejs > /dev/null 2>&1; then
    echo "⚠️  coldwallet.ejs differs from source"
    DIFF_FOUND=1
fi

# Check other files
for file in coldwallet.js plugin.json; do
    if [ -f "$SOURCE/$file" ] && [ -f "$TARGET/$file" ]; then
        if ! diff -q "$SOURCE/$file" "$TARGET/$file" > /dev/null 2>&1; then
            echo "⚠️  $file differs from source"
            DIFF_FOUND=1
        fi
    fi
done

# Check assets directory
if [ -d "$SOURCE/assets" ] && [ -d "$TARGET/assets" ]; then
    if ! diff -qr "$SOURCE/assets" "$TARGET/assets" > /dev/null 2>&1; then
        echo "⚠️  assets/ directory differs from source"
        DIFF_FOUND=1
    fi
fi

# Cleanup
rm -f /tmp/source-coldwallet*.ejs /tmp/target-coldwallet*.ejs

if [ $DIFF_FOUND -eq 1 ]; then
    echo ""
    echo "⚠️  Plugin is out of sync with source!"
    echo "💡 Run './update-plugin.sh' to sync from source"
    exit 1
else
    echo "✅ Plugin is in sync with source"
    exit 0
fi
```

**Update Script (`update-plugin.sh`):**
```bash
#!/bin/bash
# Update coldwallet plugin from source

SOURCE="../toughlok-portal/views/plug-ins/coldwallet"
TARGET="./views/plug-ins/coldwallet"

echo "🔄 Updating plugin from source..."

if [ ! -d "$SOURCE" ]; then
    echo "❌ Error: Source plugin not found at $SOURCE"
    exit 1
fi

# Backup current plugin
if [ -d "$TARGET" ]; then
    echo "📦 Backing up current plugin..."
    cp -r "$TARGET" "${TARGET}.backup.$(date +%Y%m%d_%H%M%S)"
fi

# Copy fresh plugin
echo "📥 Copying plugin from source..."
rm -rf "$TARGET"
cp -r "$SOURCE" "$TARGET"

# Apply layout modification
echo "✏️  Modifying layout reference..."
sed -i "1s/layout('layout')/layout('layout-minimal')/" "$TARGET/coldwallet.ejs"

echo "✅ Plugin updated successfully"
echo "💡 Old version backed up with timestamp"
```

**Integration with npm scripts:**
```json
{
  "scripts": {
    "prestart": "bash check-plugin-sync.sh || true",
    "start": "node server.js",
    "update-plugin": "bash update-plugin.sh",
    "check-sync": "bash check-plugin-sync.sh"
  }
}
```

**Decision:** 
- Use copy approach for full independence
- Run sync check before server starts (warns but doesn't block)
- Provide update script for easy syncing
- Manual sync control with clear visibility

## Project Scaffolding Strategy

### Option 1: Separate Folder (Self-Contained Server) ✅ **RECOMMENDED**

Create a new standalone directory with its own dependencies and minimal copies of required files:

```
toughlok-portal/                    # Original full portal (unchanged)
coldwallet-standalone/              # NEW: Minimal server
  ├── server.js                     # Main minimal server
  ├── package.json                  # Minimal dependencies only
  ├── .env.example
  ├── .gitignore
  ├── README.md
  ├── data/                         # SQLite database
  │   └── .gitkeep
  ├── models/
  │   └── address.js                # COPIED from ../toughlok-portal/models/
  ├── config/
  │   └── database.js               # SIMPLIFIED version
  ├── views/
  │   ├── layout.ejs                # NEW: minimal layout
  │   ├── error.ejs                 # NEW: simple error page
  │   ├── partials/
  │   │   ├── header.ejs            # NEW: stub
  │   │   ├── slideout.ejs          # NEW: stub
  │   │   └── footer.ejs            # NEW: stub
  │   └── plug-ins/
  │       └── coldwallet/           # SYMLINK or COPY from ../toughlok-portal/views/plug-ins/coldwallet/
  │           ├── coldwallet.ejs
  │           ├── coldwallet.js
  │           └── assets/
  └── public/
      └── css/
          └── loading-overlay.css   # COPIED if needed
```

**Advantages:**
- True standalone server - can be deployed independently
- Own package.json with minimal dependencies
- No risk of breaking main portal
- Easy to zip and distribute
- Clear separation of concerns

**Approach:**
1. Create `coldwallet-standalone/` as sibling to `toughlok-portal/`
2. Copy or symlink plugin files from main portal
3. Copy minimal required models/config with simplifications
4. Create new minimal templates

### Option 2: Subfolder Inside Portal

```
toughlok-portal/
  ├── server.js                     # Main portal server
  ├── minimal-servers/              # NEW folder
  │   └── coldwallet/
  │       ├── server-coldwallet.js
  │       ├── package.json          # References parent node_modules
  │       ├── .env.example
  │       └── README.md
  ├── views/                        # Shared
  ├── models/                       # Shared
  ├── config/                       # Shared
  └── public/                       # Shared
```

**Advantages:**
- Shares existing files (no duplication)
- Uses parent node_modules (less disk space)
- Easy to maintain alongside main portal

**Disadvantages:**
- Coupled to main portal structure
- Harder to deploy independently
- Shares dependencies (bloat)

### Option 3: Separate Repo (Complete Independence)

Create entirely new repository `coldwallet-minimal` with copied files.

**Advantages:**
- Complete independence
- Own version control
- Clean deployment
- Can diverge independently

**Disadvantages:**
- Most duplication
- Must sync plugin updates manually

## Recommended Approach: Option 1 (Separate Folder) + Layout Option C

### Important Note About File Creation Location:
The scaffolding steps below create the standalone server **outside** the current project tree as a sibling directory. Tools can create and edit files outside the workspace when given absolute paths. The recommended structure places `coldwallet-standalone/` at `/home/rcarlisle/source/tmp/coldwallet-standalone/`.

### Scaffolding Steps:

**Step 1: Create Directory Structure**
```bash
cd /home/rcarlisle/source/tmp
mkdir -p coldwallet-standalone/{data,models,config,views/partials,views/plug-ins,public/css}
cd coldwallet-standalone
```

**Step 2: Create Package.json**
```bash
npm init -y
npm install express ejs ejs-mate dotenv sequelize sqlite3
```

**Step 3: Copy Required Files**
```bash
# Copy Address model
cp ../toughlok-portal/models/address.js ./models/

# Copy plugin directory (self-contained)
cp -r ../toughlok-portal/views/plug-ins/coldwallet ./views/plug-ins/

# Modify layout reference in the copied plugin
sed -i "1s/layout('layout')/layout('layout-minimal')/" ./views/plug-ins/coldwallet/coldwallet.ejs

# Copy CSS if needed
cp ../toughlok-portal/public/css/loading-overlay.css ./public/css/ 2>/dev/null || echo "CSS not found, will create minimal"
```

**Step 4: Create New Files**
- `server.js` - minimal express server
- `config/database.js` - simplified sequelize config
- `views/layout-minimal.ejs` - minimal layout
- `views/error.ejs` - simple error page
- `.env.example` - environment template
- `README.md` - setup instructions
- `check-plugin-sync.sh` - script to detect plugin differences
- `update-plugin.sh` - script to sync plugin from source
- `.gitignore` - exclude backups and data files

**Step 5: Test and Validate**
```bash
node server.js
# Visit http://localhost:3001
```

### Why Copy with Sync Detection Works:

1. **Full Independence** - Truly standalone, no filesystem dependencies
2. **Sync Awareness** - Automated check warns when plugin updates available
3. **Easy Updates** - Single command to sync from source
4. **Minimal Dependencies** - Only 6 packages vs 30+ in main portal
5. **No Portal Changes** - Original portal completely untouched
6. **Clear Intent** - Anyone opening the folder understands it's standalone
7. **Distribution Ready** - Can zip and deploy immediately
8. **Version Control** - Git tracks actual files, not symlinks

### Sync Check Integration:

The `check-plugin-sync.sh` script runs automatically before server starts:
- **Green path:** Plugin in sync, server starts normally
- **Warning path:** Differences detected, warning shown, server still starts
- **Update path:** Run `npm run update-plugin` to sync from source

### Workflow:

```bash
# Daily development
npm start                    # Auto-checks for plugin differences

# When portal plugin is updated
npm run check-sync           # See what changed
npm run update-plugin        # Sync from source

# Before deployment
npm run check-sync           # Ensure in sync
tar -czf release.tar.gz .    # Package for distribution
```

## Running the Server

### Initial Setup
```bash
# Install dependencies
npm install

# Copy environment template
cp .env.example .env

# Edit .env with TSS credentials
# (TSS_ORCHESTRATOR_API_URL, TSS_TOKEN_CLIENT_ID, etc.)

# Create data directory
mkdir -p data
```

### Start Server
```bash
# Development mode
node server-min.js

# Or with nodemon for auto-reload
npx nodemon server-min.js
```

### Access
- Server: `http://localhost:3001/`
- Health: `http://localhost:3001/health`
- API: `http://localhost:3001/api/addresses`

## Operational Notes

### TSS Configuration
- If TSS environment variables are missing, the server still runs
- UI may display connection errors but local wallet features remain functional
- TSS connectivity happens browser-to-endpoint (no server proxy)

### Data Persistence
- SQLite database auto-created in `data/database.sqlite`
- Address API available for future integration needs
- Current UI primarily uses browser localStorage for wallet list
- Both persistence layers coexist without conflict

## Testing Checklist

### Page Load
- [ ] Server starts without errors
- [ ] GET / renders cold wallet UI
- [ ] All CSS and JS assets load
- [ ] No console errors on page load

### UI Components
- [ ] Wallet selection dropdown visible
- [ ] Asset selector (BTC/ETH/XRP) works
- [ ] QR code generation functional
- [ ] QR scanner modal opens
- [ ] Transaction input fields render

### TSS Integration
- [ ] Browser connects to TSS endpoints
- [ ] WebSocket connections establish
- [ ] Enrollment flow initiates
- [ ] No CORS errors in console

### API Endpoints
- [ ] GET /api/addresses returns data
- [ ] POST /api/addresses creates records
- [ ] DELETE /api/addresses removes records
- [ ] GET /health returns status

### Persistence
- [ ] Created wallets appear in dropdown
- [ ] Wallets persist after page reload (localStorage)
- [ ] Address table updates in SQLite

## Risks and Mitigations

### Layout Dependencies
**Risk:** `coldwallet.ejs` may expect full portal layout with navigation/auth  
**Mitigation:** Create minimal layout that provides base HTML structure without portal-specific includes

### CDN Dependencies
**Risk:** Air-gapped kiosk cannot reach Bootstrap, html5-qrcode, QRious CDNs  
**Mitigation:** Document offline mirror setup; consider vendoring critical assets in future iteration

### TSS Connectivity
**Risk:** Browser cannot reach TSS endpoints due to network/CORS  
**Mitigation:** Verify kiosk network allows direct TSS access; document reverse proxy if needed (future work)

### User Context
**Risk:** Template expects `req.user` or session data  
**Mitigation:** Pass `user: null` and `isSecureTerminal: false`; test rendering behavior

## Alternative Approach Considered

**Approach 2: Minimal Plugin Modifications**  
Instead of keeping the plugin unchanged, this approach would make surgical edits to `routes.js` and `coldwallet.ejs` to:
- Remove authentication middleware dependencies
- Strip user-bound queries from address APIs
- Eliminate layout assumptions
- Potentially move all persistence to localStorage

**Why Not Chosen:**  
Approach 1 (zero changes) ensures the plugin remains fully compatible with the main portal and eliminates any risk of regression or maintenance divergence. The server adaptation is straightforward and keeps the plugin as a true drop-in component.

## Electron Desktop Application Enhancement

### Overview
The standalone server (Approach 1) can be enhanced or adapted to create a fully self-contained desktop application using Electron. This allows distribution as a native executable (.exe, .app, .dmg) that bundles Node.js, the Express server, and a Chromium-based browser window—ideal for air-gapped environments, offline kiosks, or secure workstations.

### Recommended Architecture: Hybrid Single Project (Option A)

**One codebase that can run as either a kiosk server OR an Electron desktop app based on startup command.**

**Benefits:**
- Single codebase to maintain
- Shared models, views, and business logic
- Easy switching: `npm start` (web) vs `npm run electron` (desktop)
- Only adds ~8-10 dev dependencies
- No code duplication

**Rationale:**
- The server is already minimal with only 6 core dependencies
- Adding electron and electron-builder is low overhead (~8-10 additional dev dependencies)
- Shared codebase ensures consistency and reduces maintenance
- Package scripts make deployment target selection trivial
- User can choose deployment mode at runtime without code changes

### Electron Implementation Details

#### 1. Main Process (`electron-main.js`)
```javascript
const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

let serverProcess = null;
let mainWindow = null;

function startExpressServer() {
  return new Promise((resolve, reject) => {
    serverProcess = spawn('node', ['server.js'], {
      cwd: __dirname,
      env: { ...process.env, PORT: 3001 }
    });
    
    serverProcess.stdout.on('data', (data) => {
      console.log(`Server: ${data}`);
      if (data.includes('running on')) {
        resolve();
      }
    });
    
    serverProcess.stderr.on('data', (data) => {
      console.error(`Server Error: ${data}`);
    });
    
    setTimeout(() => reject(new Error('Server timeout')), 10000);
  });
}

async function createWindow() {
  await startExpressServer();
  
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, 'electron-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    },
    autoHideMenuBar: true,  // Clean kiosk-like UI
    icon: path.join(__dirname, 'assets/icon.png')
  });
  
  mainWindow.loadURL('http://localhost:3001');
  
  // Optional: Open DevTools in development
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (serverProcess) {
    serverProcess.kill();
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
```

#### 2. Preload Script (`electron-preload.js`)
```javascript
const { contextBridge } = require('electron');

// Expose safe APIs to renderer if needed
contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  versions: process.versions
});
```

#### 3. Package Configuration (`package.json` additions)
```json
{
  "main": "electron-main.js",
  "devDependencies": {
    "electron": "^28.0.0",
    "electron-builder": "^24.9.0"
  },
  "build": {
    "appId": "com.lokblok.coldwallet",
    "productName": "ToughLok Cold Wallet",
    "directories": {
      "output": "dist"
    },
    "files": [
      "**/*",
      "!data/*.sqlite*",
      "!node_modules/**/*",
      "!dist/**/*"
    ],
    "extraResources": [
      {
        "from": "data/",
        "to": "data/",
        "filter": ["**/*", "!*.sqlite", "!*.sqlite-wal", "!*.sqlite-shm"]
      }
    ],
    "win": {
      "target": ["nsis", "portable"],
      "icon": "assets/icon.ico"
    },
    "mac": {
      "target": ["dmg", "zip"],
      "category": "public.app-category.finance",
      "icon": "assets/icon.icns"
    },
    "linux": {
      "target": ["AppImage", "deb"],
      "category": "Office",
      "icon": "assets/icon.png"
    }
  }
}
```

#### 4. Database Path Adjustments
In `config/database.js`, detect Electron environment and adjust SQLite path:

```javascript
const { app } = require('electron').remote || { app: null };
const path = require('path');

const isElectron = !!app;
const dbPath = isElectron
  ? path.join(app.getPath('userData'), 'database.sqlite')
  : path.join(__dirname, '../data/database.sqlite');

const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: dbPath,
  // ... rest of config
});
```

This ensures database persists in user's application data folder (e.g., `%APPDATA%/ToughLok Cold Wallet` on Windows).

### Key Features of Electron Version

**Security:**
- Sandboxed renderer process
- Context isolation enabled
- No node integration in renderer
- CSP headers from Express server

**Offline Operation:**
- Entire Node.js runtime bundled
- No external dependencies after installation
- SQLite database in local app data
- TSS endpoints configurable via app settings or .env

**Distribution:**
- Single executable installer (100-150MB)
- Auto-update capability (optional with electron-updater)
- Code signing for macOS/Windows
- Portable .exe for USB stick deployment

**User Experience:**
- Native window chrome and OS integration
- Menubar with File/Edit/Help
- Keyboard shortcuts (Ctrl+Q to quit, etc.)
- System tray icon (optional)

### Migration Path from Kiosk to Electron

1. **Add Electron Dependencies:**
   ```bash
   npm install --save-dev electron electron-builder
   ```

2. **Create Electron Entry Points:**
   - `electron-main.js` (main process)
   - `electron-preload.js` (security bridge)

3. **Update package.json:**
   - Add `"main": "electron-main.js"`
   - Add build configuration
   - Add electron-specific scripts

4. **Adjust Database Config:**
   - Detect Electron environment
   - Use `app.getPath('userData')` for SQLite location

5. **Test in Development:**
   ```bash
   npm run electron:dev
   ```

6. **Build for Distribution:**
   ```bash
   npm run build:win    # or build:mac, build:linux
   ```

### Deployment Scenarios

| Scenario | Mode | Command | Distribution |
|----------|------|---------|--------------|
| Web kiosk on Linux server | Kiosk Server | `npm start` | Standard Node.js deployment |
| Offline workstation (Windows) | Electron | `build:win` | .exe installer |
| Air-gapped Mac (secure facility) | Electron | `build:mac` | .dmg or .app bundle |
| USB-bootable security station | Electron Portable | `build:win` (portable) | Standalone .exe |
| Docker container (web UI) | Kiosk Server | Docker image | Container registry |

### Future Enhancements

**Auto-Update:**
- Integrate `electron-updater` for silent updates
- Configure update server or use GitHub releases

**Hardware Security:**
- Detect and integrate with hardware security modules (HSM)
- YubiKey/FIDO2 device support via WebAuthn

**Offline CDN Assets:**
- Bundle Font Awesome, QRious, html5-qrcode in `assets/vendor/`
- Update templates to use local paths instead of CDNs

**Advanced Kiosk Mode:**
- Full-screen lockdown mode
- Disable browser navigation/refresh
- Timeout-based automatic logout

**Cross-Platform Signing:**
- Windows: Authenticode certificate
- macOS: Apple Developer ID
- Linux: GPG signature verification

## Next Steps

### Phase 1: Kiosk Server (Completed)
- ✅ Implement `server.js` with minimal endpoints
- ✅ Wire static assets and verify page loads
- ✅ Validate SQLite schema initialization and address API
- ✅ Provide run instructions and configuration

### Phase 2: Electron Enhancement (Proposed)
- [ ] Add Electron dependencies to existing project
- [ ] Create `electron-main.js` and `electron-preload.js`
- [ ] Update `package.json` with build configuration
- [ ] Adjust database path handling for Electron
- [ ] Test development mode (`npm run electron:dev`)
- [ ] Build and test native packages for all platforms
- [ ] Document distribution and installation procedures
- [ ] Optional: Add auto-update mechanism

## Node.js-Free Packaging (Standalone Executable)

### Overview
Package the entire application (Node.js runtime + server code + dependencies) into a single executable that requires no external dependencies. Users can run the application without installing Node.js, npm, or any other runtime.

### Packaging Solutions

#### Option 1: pkg (Vercel/Zeit)
**Most Popular and Battle-Tested**

```bash
npm install -g pkg

# Build for multiple platforms
pkg server.js --targets node18-linux-x64,node18-win-x64,node18-macos-x64 --output dist/coldwallet

# Results in:
# dist/coldwallet-linux
# dist/coldwallet-win.exe
# dist/coldwallet-macos
```

**package.json configuration:**
```json
{
  "bin": "server.js",
  "pkg": {
    "assets": [
      "views/**/*",
      "public/**/*",
      "models/**/*",
      "config/**/*",
      "node_modules/**/*"
    ],
    "targets": ["node18-linux-x64", "node18-win-x64", "node18-macos-x64"],
    "outputPath": "dist"
  }
}
```

**Pros:**
- Single executable (40-60MB)
- No Node.js installation required
- Cross-platform builds from single machine
- Supports native modules (like SQLite)

**Cons:**
- Executable size includes Node.js runtime
- Some dynamic requires may need workarounds
- Views/assets must be explicitly bundled

#### Option 2: nexe
**Alternative with Similar Features**

```bash
npm install -g nexe

nexe server.js --target windows-x64-18.0.0 --output coldwallet.exe
nexe server.js --target linux-x64-18.0.0 --output coldwallet-linux
nexe server.js --target darwin-x64-18.0.0 --output coldwallet-macos
```

#### Option 3: caxa (Modern, TypeScript-First)
**Newest Option with Better Asset Handling**

```bash
npm install -g caxa

caxa --input . --output "coldwallet-{{os}}-{{arch}}" -- "{{caxa}}/node_modules/.bin/node" "{{caxa}}/server.js"
```

### Recommended Approach: pkg + Installer

**Step 1: Create pkg build script**
```json
// package.json
{
  "scripts": {
    "build": "pkg . --output dist/coldwallet",
    "build:win": "pkg . --targets node18-win-x64 --output dist/coldwallet-win.exe",
    "build:linux": "pkg . --targets node18-linux-x64 --output dist/coldwallet-linux",
    "build:mac": "pkg . --targets node18-macos-x64 --output dist/coldwallet-macos"
  }
}
```

**Step 2: Wrap in installer (optional)**

For Windows (NSIS):
```nsis
; installer.nsi
OutFile "ColdWallet-Setup.exe"
InstallDir "$PROGRAMFILES\ColdWallet"

Section "Install"
  SetOutPath $INSTDIR
  File "dist\coldwallet-win.exe"
  File "data\.gitkeep"
  CreateDirectory "$INSTDIR\data"
  WriteUninstaller "$INSTDIR\uninstall.exe"
  CreateShortcut "$DESKTOP\Cold Wallet.lnk" "$INSTDIR\coldwallet-win.exe"
SectionEnd
```

For Linux (AppImage):
```bash
# Use appimagetool
wget https://github.com/AppImage/AppImageKit/releases/download/continuous/appimagetool-x86_64.AppImage
chmod +x appimagetool-x86_64.AppImage

# Create AppDir structure
mkdir -p ColdWallet.AppDir/usr/bin
cp dist/coldwallet-linux ColdWallet.AppDir/usr/bin/
# Add .desktop file and icon
./appimagetool-x86_64.AppImage ColdWallet.AppDir
```

### Handling Database Path in Packaged Executable

When using pkg, the executable is read-only. Adjust database path:

```javascript
// config/database.js
const path = require('path');
const fs = require('fs');

// Detect if running from pkg
const isPkg = typeof process.pkg !== 'undefined';

// Use writable location for database
const dbDir = isPkg
  ? path.join(process.cwd(), 'data')  // Current working directory
  : path.join(__dirname, '../data');

// Ensure data directory exists
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const dbPath = path.join(dbDir, 'database.sqlite');

const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: dbPath,
  logging: false
});
```

### Environment Variables in Packaged Executable

pkg doesn't automatically include .env files. Options:

**Option A: dotenv-expand with embedded config**
```javascript
// server.js
const dotenv = require('dotenv');
const path = require('path');

// Load from current working directory (not executable path)
dotenv.config({ path: path.join(process.cwd(), '.env') });
```

**Option B: Bundle .env into executable**
```json
// package.json pkg config
{
  "pkg": {
    "assets": [
      ".env.example"
    ]
  }
}
```

Then copy .env.example to .env in installation directory.

**Option C: Configuration file (recommended)**
```javascript
// config/runtime-config.js
const fs = require('fs');
const path = require('path');

const configPath = path.join(process.cwd(), 'config.json');

function loadConfig() {
  if (fs.existsSync(configPath)) {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  }
  
  // Return defaults
  return {
    port: 3001,
    tssApiUrl: null,
    tssClientId: null,
    tssClientSecret: null,
    tssTokenUrl: null
  };
}

module.exports = loadConfig();
```

Users edit `config.json` instead of `.env`.

### Deployment Comparison

| Method | Size | Node.js Required | Installation | Updates |
|--------|------|------------------|--------------|---------|
| Standard npm | ~50MB | Yes | `npm install` | `git pull && npm install` |
| pkg executable | ~60MB | No | Copy file | Replace executable |
| Electron (discussed below) | ~150MB | No | Installer | Auto-update possible |
| Docker container | ~200MB | Docker | `docker run` | `docker pull` |

### Testing Packaged Executable

```bash
# Build
npm run build:win

# Test
cd dist
mkdir data
echo '{"port": 3001}' > config.json
./coldwallet-win.exe

# Should output:
# ✅ Database connected
# ✅ Cold Wallet Standalone Server running on http://localhost:3001
```


## Local Service Management (TSS Service Wrapper)

### Overview
The kiosk server can manage local services (e.g., `./services/tss/tss.exe`) by:
1. Starting the service process on server startup
2. Monitoring service health via health check endpoints or process status
3. Displaying service status in the UI title bar
4. Providing clickable controls to start/stop/restart services

This is ideal for air-gapped deployments where TSS or other services run locally alongside the cold wallet application.

### Architecture

```
coldwallet-standalone/
├── server.js                    # Main Express server
├── lib/
│   └── serviceManager.js        # Service lifecycle management
├── services/
│   └── tss/
│       ├── tss.exe              # Local TSS service (Windows)
│       ├── tss                  # Local TSS service (Linux)
│       └── config.json          # TSS configuration
└── views/
    └── partials/
        └── service-status.ejs   # UI component for status bar
```

### Implementation

#### 1. Service Manager (`lib/serviceManager.js`)

```javascript
const { spawn } = require('child_process');
const axios = require('axios');
const path = require('path');

class ServiceManager {
  constructor(serviceName, config) {
    this.serviceName = serviceName;
    this.executablePath = config.executablePath;
    this.args = config.args || [];
    this.healthCheckUrl = config.healthCheckUrl;
    this.healthCheckInterval = config.healthCheckInterval || 30000; // 30s
    this.process = null;
    this.status = 'stopped'; // stopped | starting | running | error
    this.lastHealthCheck = null;
    this.errorMessage = null;
  }

  start() {
    if (this.process) {
      console.log(`${this.serviceName} already running (PID: ${this.process.pid})`);
      return;
    }

    console.log(`Starting ${this.serviceName}...`);
    this.status = 'starting';

    const platform = process.platform;
    const exePath = platform === 'win32'
      ? `${this.executablePath}.exe`
      : this.executablePath;

    try {
      this.process = spawn(exePath, this.args, {
        cwd: path.dirname(exePath),
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false
      });

      this.process.stdout.on('data', (data) => {
        console.log(`[${this.serviceName}] ${data.toString().trim()}`);
      });

      this.process.stderr.on('data', (data) => {
        console.error(`[${this.serviceName}] ERROR: ${data.toString().trim()}`);
      });

      this.process.on('exit', (code, signal) => {
        console.log(`${this.serviceName} exited (code: ${code}, signal: ${signal})`);
        this.process = null;
        this.status = code === 0 ? 'stopped' : 'error';
        this.errorMessage = code !== 0 ? `Exit code: ${code}` : null;
      });

      this.process.on('error', (err) => {
        console.error(`${this.serviceName} spawn error:`, err);
        this.status = 'error';
        this.errorMessage = err.message;
      });

      // Wait for service to be ready
      setTimeout(() => {
        this.checkHealth();
      }, 3000);

    } catch (err) {
      console.error(`Failed to start ${this.serviceName}:`, err);
      this.status = 'error';
      this.errorMessage = err.message;
    }
  }

  async checkHealth() {
    if (!this.healthCheckUrl) {
      // No health check URL, assume running if process exists
      this.status = this.process ? 'running' : 'stopped';
      this.lastHealthCheck = new Date();
      return this.status === 'running';
    }

    try {
      const response = await axios.get(this.healthCheckUrl, {
        timeout: 5000,
        validateStatus: (status) => status < 500
      });

      if (response.status === 200) {
        this.status = 'running';
        this.errorMessage = null;
      } else {
        this.status = 'error';
        this.errorMessage = `Health check failed: HTTP ${response.status}`;
      }
    } catch (err) {
      this.status = this.process ? 'starting' : 'stopped';
      this.errorMessage = `Health check error: ${err.message}`;
    }

    this.lastHealthCheck = new Date();
    return this.status === 'running';
  }

  stop() {
    if (!this.process) {
      console.log(`${this.serviceName} not running`);
      return;
    }

    console.log(`Stopping ${this.serviceName}...`);
    this.status = 'stopped';

    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', this.process.pid, '/f', '/t']);
    } else {
      this.process.kill('SIGTERM');
    }

    this.process = null;
  }

  restart() {
    console.log(`Restarting ${this.serviceName}...`);
    this.stop();
    setTimeout(() => this.start(), 1000);
  }

  startHealthMonitoring() {
    setInterval(() => {
      if (this.status !== 'stopped') {
        this.checkHealth();
      }
    }, this.healthCheckInterval);
  }

  getStatus() {
    return {
      name: this.serviceName,
      status: this.status,
      pid: this.process ? this.process.pid : null,
      lastHealthCheck: this.lastHealthCheck,
      errorMessage: this.errorMessage
    };
  }
}

module.exports = ServiceManager;
```

#### 2. Integrate into Server (`server.js`)

```javascript
const ServiceManager = require('./lib/serviceManager');
const path = require('path');

// Initialize TSS service manager
const tssService = new ServiceManager('TSS', {
  executablePath: path.join(__dirname, 'services/tss/tss'),
  args: ['--config', 'config.json'],
  healthCheckUrl: 'http://localhost:8080/health', // TSS health endpoint
  healthCheckInterval: 30000 // 30 seconds
});

// Start TSS service on server startup
tssService.start();
tssService.startHealthMonitoring();

// API endpoint: Get service status
app.get('/api/services/status', (req, res) => {
  res.json({
    services: [
      tssService.getStatus()
    ]
  });
});

// API endpoint: Control service
app.post('/api/services/:serviceName/:action', (req, res) => {
  const { serviceName, action } = req.params;

  if (serviceName === 'TSS' || serviceName === 'tss') {
    switch (action) {
      case 'start':
        tssService.start();
        break;
      case 'stop':
        tssService.stop();
        break;
      case 'restart':
        tssService.restart();
        break;
      default:
        return res.status(400).json({ error: 'Invalid action' });
    }
    
    setTimeout(() => {
      res.json(tssService.getStatus());
    }, 1000);
  } else {
    res.status(404).json({ error: 'Service not found' });
  }
});

// Cleanup on server shutdown
process.on('SIGINT', () => {
  console.log('Shutting down services...');
  tssService.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('Shutting down services...');
  tssService.stop();
  process.exit(0);
});
```

#### 3. UI Status Bar Component (`views/partials/service-status.ejs`)

```html
<div id="service-status-bar" class="service-status-bar">
  <div class="service-status-item" id="tss-status">
    <span class="status-indicator status-unknown"></span>
    <span class="status-label">TSS Service</span>
    <span class="status-text">Checking...</span>
    <div class="status-controls">
      <button class="btn-icon" onclick="controlService('TSS', 'restart')" title="Restart">
        <i class="fas fa-sync-alt"></i>
      </button>
      <button class="btn-icon" onclick="controlService('TSS', 'start')" title="Start" id="tss-start-btn" style="display:none;">
        <i class="fas fa-play"></i>
      </button>
      <button class="btn-icon" onclick="controlService('TSS', 'stop')" title="Stop" id="tss-stop-btn">
        <i class="fas fa-stop"></i>
      </button>
    </div>
  </div>
</div>

<style>
  .service-status-bar {
    background: #007bff;
    color: white;
    padding: 8px 30px;
    display: flex;
    justify-content: flex-end;
    gap: 20px;
    border-bottom: 1px solid #0056b3;
    font-size: 0.85rem;
  }

  .service-status-item {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .status-indicator {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    display: inline-block;
    animation: pulse 2s infinite;
  }

  .status-running { background: #28a745; }
  .status-starting { background: #ffc107; }
  .status-stopped { background: #6c757d; }
  .status-error { background: #dc3545; }
  .status-unknown { background: #6c757d; opacity: 0.5; }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }

  .status-label {
    font-weight: 600;
  }

  .status-text {
    opacity: 0.9;
  }

  .status-controls {
    display: flex;
    gap: 4px;
    margin-left: 8px;
  }

  .btn-icon {
    background: rgba(255, 255, 255, 0.15);
    border: none;
    color: white;
    width: 28px;
    height: 28px;
    border-radius: 4px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s;
  }

  .btn-icon:hover {
    background: rgba(255, 255, 255, 0.25);
    transform: scale(1.05);
  }

  .btn-icon i {
    font-size: 0.75rem;
  }
</style>

<script>
  // Poll service status
  async function updateServiceStatus() {
    try {
      const response = await fetch('/api/services/status');
      const data = await response.json();
      
      data.services.forEach(service => {
        if (service.name === 'TSS') {
          const indicator = document.querySelector('#tss-status .status-indicator');
          const statusText = document.querySelector('#tss-status .status-text');
          const startBtn = document.getElementById('tss-start-btn');
          const stopBtn = document.getElementById('tss-stop-btn');
          
          // Update indicator
          indicator.className = `status-indicator status-${service.status}`;
          
          // Update text
          if (service.status === 'running') {
            statusText.textContent = 'Running';
            startBtn.style.display = 'none';
            stopBtn.style.display = 'flex';
          } else if (service.status === 'starting') {
            statusText.textContent = 'Starting...';
            startBtn.style.display = 'none';
            stopBtn.style.display = 'flex';
          } else if (service.status === 'error') {
            statusText.textContent = service.errorMessage || 'Error';
            startBtn.style.display = 'flex';
            stopBtn.style.display = 'none';
          } else {
            statusText.textContent = 'Stopped';
            startBtn.style.display = 'flex';
            stopBtn.style.display = 'none';
          }
        }
      });
    } catch (err) {
      console.error('Failed to fetch service status:', err);
    }
  }

  async function controlService(serviceName, action) {
    try {
      const response = await fetch(`/api/services/${serviceName}/${action}`, {
        method: 'POST'
      });
      const data = await response.json();
      console.log(`${serviceName} ${action}:`, data);
      
      // Refresh status immediately
      setTimeout(updateServiceStatus, 1000);
    } catch (err) {
      console.error(`Failed to ${action} ${serviceName}:`, err);
      alert(`Failed to ${action} ${serviceName}: ${err.message}`);
    }
  }

  // Update status every 10 seconds
  updateServiceStatus();
  setInterval(updateServiceStatus, 10000);
</script>
```

#### 4. Add to Layout (`views/layout-minimal.ejs`)

```html
<body>
  <header class="minimal-header">
    <h1>🔐 Cold Wallet</h1>
  </header>
  
  <%- include('partials/service-status') %>
  
  <main class="minimal-content">
    <%- body %>
  </main>
```

### Configuration Example

**services/tss/config.json:**
```json
{
  "port": 8080,
  "host": "localhost",
  "database": "./data/tss.db",
  "logLevel": "info"
}
```

### Multi-Service Support

Extend to manage multiple services:

```javascript
// server.js
const services = {
  tss: new ServiceManager('TSS', { /* config */ }),
  orchestrator: new ServiceManager('Orchestrator', { /* config */ }),
  helper: new ServiceManager('Helper', { /* config */ })
};

// Start all
Object.values(services).forEach(svc => {
  svc.start();
  svc.startHealthMonitoring();
});

// API endpoint returns all statuses
app.get('/api/services/status', (req, res) => {
  res.json({
    services: Object.values(services).map(svc => svc.getStatus())
  });
});
```

### Benefits

1. **Self-Contained Deployment**: All services bundled together
2. **Zero Configuration**: Services start automatically
3. **User Visibility**: Clear status indicators in UI
4. **Troubleshooting**: Easy restart without terminal access
5. **Air-Gapped Ready**: No external service dependencies

### Future Enhancements

- **Auto-recovery**: Automatically restart crashed services
- **Log viewer**: Stream service logs to UI
- **Resource monitoring**: CPU/memory usage per service
- **Service dependencies**: Start services in correct order
- **Update mechanism**: Hot-reload service binaries

