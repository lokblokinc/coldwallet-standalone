# Network Connectivity Detection Proposal

## Overview
Add network connectivity detection to ensure Cold Wallet only runs on truly air-gapped/offline machines. If any network connectivity is detected, display an error page instead of the wallet UI.

## Security Rationale
- **Air-gap enforcement**: Prevents accidental operation on internet-connected machines
- **Attack surface reduction**: Eliminates risk of network-based attacks during wallet operations
- **Compliance**: Enforces offline-only operational policy for maximum security
- **User protection**: Prevents operators from unknowingly using wallet on networked systems

## Technical Approach

### Detection Strategy
Implement multiple detection methods with fail-secure logic (any positive detection = block access):

#### 1. Network Interface Detection
Check for active non-loopback network interfaces:

```javascript
const os = require('os');

function hasActiveNetworkInterfaces() {
  const interfaces = os.networkInterfaces();
  
  for (const [name, addrs] of Object.entries(interfaces)) {
    // Skip loopback (lo, lo0)
    if (name.match(/^lo\d*$/i)) continue;
    
    // Check for any non-internal addresses
    for (const addr of addrs) {
      if (!addr.internal && addr.family === 'IPv4') {
        return { detected: true, interface: name, address: addr.address };
      }
    }
  }
  
  return { detected: false };
}
```

**Pros:** Fast, no external dependencies, cross-platform
**Cons:** Detects interfaces even if cable unplugged or WiFi disabled

#### 2. Default Gateway Detection
Check if system has a configured default gateway (indicates potential routing):

```bash
# Linux/macOS
ip route show default || route -n get default

# Windows
route print 0.0.0.0
```

```javascript
const { execSync } = require('child_process');

function hasDefaultGateway() {
  try {
    const platform = process.platform;
    
    if (platform === 'linux' || platform === 'darwin') {
      const output = execSync('ip route show default 2>/dev/null || route -n get default 2>/dev/null', 
        { encoding: 'utf8', timeout: 2000 });
      return output.trim().length > 0;
    } else if (platform === 'win32') {
      const output = execSync('route print 0.0.0.0', { encoding: 'utf8', timeout: 2000 });
      return output.includes('0.0.0.0');
    }
  } catch {
    return false; // Command failed, assume no gateway
  }
  
  return false;
}
```

**Pros:** Better indicator of actual routing capability
**Cons:** Requires shell execution, platform-specific commands

#### 3. Active Connection Detection
Check for established TCP/UDP connections:

```bash
# Linux
ss -tuln | grep ESTABLISHED

# macOS
netstat -an | grep ESTABLISHED

# Windows
netstat -ano | findstr ESTABLISHED
```

**Pros:** Detects actual active network usage
**Cons:** May miss WiFi/Ethernet that's up but idle

#### 4. DNS Resolution Test (Optional, Conservative)
Attempt to resolve a canary domain (only if other checks pass):

```javascript
const dns = require('dns').promises;

async function canResolveDNS() {
  try {
    await dns.resolve4('localhost'); // Safe internal test
    // Could test external domain if desired: 'example.com'
    return true;
  } catch {
    return false;
  }
}
```

**Pros:** Tests actual connectivity, not just configuration
**Cons:** Slower, requires DNS to be configured, might ping external servers

### Recommended Multi-Layered Approach

Combine interface + gateway detection for balance of speed and accuracy:

```javascript
// utils/networkDetection.js
const os = require('os');
const { execSync } = require('child_process');

class NetworkDetector {
  constructor() {
    this.lastCheck = null;
    this.lastResult = null;
    this.cacheDuration = 10000; // 10 seconds
  }

  detect() {
    // Use cached result if recent
    const now = Date.now();
    if (this.lastCheck && (now - this.lastCheck) < this.cacheDuration) {
      return this.lastResult;
    }

    const result = {
      hasNetwork: false,
      interfaces: [],
      gateway: false,
      timestamp: new Date().toISOString()
    };

    // Check 1: Active network interfaces
    const interfaces = this.checkInterfaces();
    if (interfaces.length > 0) {
      result.hasNetwork = true;
      result.interfaces = interfaces;
    }

    // Check 2: Default gateway
    if (this.checkGateway()) {
      result.hasNetwork = true;
      result.gateway = true;
    }

    // Cache result
    this.lastCheck = now;
    this.lastResult = result;

    return result;
  }

  checkInterfaces() {
    const active = [];
    const interfaces = os.networkInterfaces();
    
    for (const [name, addrs] of Object.entries(interfaces)) {
      if (name.match(/^lo\d*$/i)) continue; // Skip loopback
      
      for (const addr of addrs) {
        if (!addr.internal && addr.family === 'IPv4' && addr.address !== '127.0.0.1') {
          active.push({ name, address: addr.address });
        }
      }
    }
    
    return active;
  }

  checkGateway() {
    try {
      const platform = process.platform;
      let cmd;
      
      if (platform === 'linux') {
        cmd = 'ip route show default 2>/dev/null';
      } else if (platform === 'darwin') {
        cmd = 'route -n get default 2>/dev/null';
      } else if (platform === 'win32') {
        cmd = 'route print 0.0.0.0';
      } else {
        return false;
      }
      
      const output = execSync(cmd, { encoding: 'utf8', timeout: 2000 });
      return output.trim().length > 0;
    } catch {
      return false;
    }
  }
}

module.exports = new NetworkDetector();
```

## Implementation Plan

### Phase 1: Core Detection (server.js)
1. Add `utils/networkDetection.js` module
2. Implement detection middleware
3. Create blocked access page

```javascript
// server.js additions
const networkDetector = require('./utils/networkDetection');

// Network detection middleware (before main routes)
app.use((req, res, next) => {
  const detection = networkDetector.detect();
  
  if (detection.hasNetwork) {
    // Network detected - block access
    return res.status(403).render('network-blocked', {
      title: 'Cold Wallet Unavailable',
      stylesheets: ['/css/loading-overlay.css'],
      detection: {
        interfaces: detection.interfaces,
        gateway: detection.gateway,
        timestamp: detection.timestamp
      }
    });
  }
  
  next();
});
```

### Phase 2: Blocked Access Page
Create `views/network-blocked.ejs`:

```ejs
<% layout('/layout-minimal') -%>

<div class="container mt-5">
  <div class="alert alert-danger" role="alert">
    <h1 class="alert-heading">
      <i class="fas fa-network-wired"></i> Cold Wallet Unavailable
    </h1>
    <hr>
    <p class="lead">
      <strong>Network connectivity detected.</strong> Cold Wallet requires complete 
      network isolation (air-gap) for security.
    </p>
    
    <div class="mt-4">
      <h5>Detected Network Activity:</h5>
      <ul>
        <% if (detection.interfaces && detection.interfaces.length > 0) { %>
          <li>Active network interfaces:
            <ul>
              <% detection.interfaces.forEach(iface => { %>
                <li><code><%= iface.name %></code>: <%= iface.address %></li>
              <% }); %>
            </ul>
          </li>
        <% } %>
        <% if (detection.gateway) { %>
          <li>Default gateway configured</li>
        <% } %>
      </ul>
    </div>
    
    <div class="mt-4 p-3 bg-light">
      <h6>To proceed with Cold Wallet:</h6>
      <ol>
        <li>Disconnect all network cables</li>
        <li>Disable WiFi/Bluetooth</li>
        <li>Verify network adapters are disabled in system settings</li>
        <li>Restart this application</li>
      </ol>
    </div>
    
    <div class="mt-3">
      <small class="text-muted">
        Detection timestamp: <%= detection.timestamp %><br>
        Server will re-check network status on next request.
      </small>
    </div>
  </div>
</div>
```

### Phase 3: Configuration Options
Add environment variables for detection tuning:

```bash
# .env additions
NETWORK_DETECTION_ENABLED=true
NETWORK_DETECTION_CACHE_MS=10000
NETWORK_DETECTION_STRICT_MODE=false  # If true, also check DNS/ping
NETWORK_DETECTION_WHITELIST_INTERFACES=  # Comma-separated allowed interfaces
```

### Phase 4: Health Endpoint Enhancement
Update `/health` to include network status:

```javascript
app.get('/health', (req, res) => {
  const detection = networkDetector.detect();
  
  res.json({
    status: detection.hasNetwork ? 'blocked' : 'healthy',
    networkDetection: {
      enabled: process.env.NETWORK_DETECTION_ENABLED !== 'false',
      hasNetwork: detection.hasNetwork,
      interfaces: detection.interfaces,
      gateway: detection.gateway
    },
    timestamp: new Date().toISOString(),
    config: {
      tssApiUrl: process.env.TSS_ORCHESTRATOR_API_URL || 'not_configured',
      nodeEnv: process.env.NODE_ENV || 'development'
    }
  });
});
```

## Bypass Mechanisms (Development Only)

### Environment Variable Bypass
```bash
# Disable detection for testing
NETWORK_DETECTION_ENABLED=false npm start
```

### Query Parameter Bypass (Dev Mode Only)
```javascript
// Only in development
if (process.env.NODE_ENV === 'development' && req.query.bypass === 'network') {
  console.warn('⚠️  Network detection bypassed via query parameter (dev mode)');
  return next();
}
```

## Testing Strategy

### Unit Tests
```javascript
// tests/networkDetection.test.js
const detector = require('../utils/networkDetection');

describe('NetworkDetector', () => {
  it('should detect loopback interfaces', () => {
    const result = detector.detect();
    expect(result).toHaveProperty('hasNetwork');
  });
  
  it('should ignore loopback interfaces', () => {
    // Mock os.networkInterfaces to return only loopback
    const interfaces = detector.checkInterfaces();
    expect(interfaces.length).toBe(0);
  });
});
```

### Manual Testing Scenarios
1. **Fully offline machine**: No interfaces, no gateway → Allow access
2. **Ethernet connected**: Active eth0, gateway present → Block access
3. **WiFi disabled**: Interface exists but no IP → Depends on strictness
4. **VPN only**: tun0 interface active → Block access (configurable)
5. **Loopback only**: 127.0.0.1 on lo → Allow access

## Performance Considerations

- **Detection overhead**: ~5-20ms per request (with 10s caching)
- **Cache strategy**: Cache results for 10 seconds to avoid repeated checks
- **Async option**: Could make detection async, but blocks are intentional
- **Startup check**: Run detection at startup and log result

## Alternative Approaches Considered

### 1. Startup-Only Check
**Pro:** Zero runtime overhead
**Con:** Can't detect if network is enabled after startup

### 2. Periodic Background Check
**Pro:** Doesn't block requests
**Con:** Race condition window between check and wallet operation

### 3. Hardware Detection (USB WiFi/Ethernet)
**Pro:** Most accurate
**Con:** Requires platform-specific drivers, complex

### 4. Firewall Rules (iptables/Windows Firewall)
**Pro:** OS-level enforcement
**Con:** Requires admin rights, not cross-platform, user could disable

## Recommended Configuration

For production air-gapped deployment:

```bash
# .env
NETWORK_DETECTION_ENABLED=true
NETWORK_DETECTION_CACHE_MS=10000
NETWORK_DETECTION_STRICT_MODE=true
```

For development with network testing:

```bash
# .env.development
NETWORK_DETECTION_ENABLED=false
NODE_ENV=development
```

## Security Impact

### Benefits
- ✅ Enforces air-gap policy at application level
- ✅ Prevents accidental wallet operations on networked machines
- ✅ Provides clear feedback to operators about network status
- ✅ Adds defense-in-depth layer beyond physical security

### Limitations
- ⚠️ Cannot detect disconnected interfaces with cached IPs
- ⚠️ Bypassable by modifying server code (physical security still required)
- ⚠️ False positives possible on machines with disabled but present interfaces
- ⚠️ Does not prevent malicious hardware implants (e.g., cellular modems)

## Migration Path

### Version 1.0 → 1.1 (Non-Breaking)
1. Deploy with `NETWORK_DETECTION_ENABLED=false` by default
2. Add detection code and blocked page
3. Test with operators
4. Enable via environment variable
5. Make enabled by default in v1.2

### Rollback Plan
Set `NETWORK_DETECTION_ENABLED=false` in environment to restore previous behavior.

## Documentation Updates Required

1. **README.md**: Add network detection feature description
2. **DEPLOYMENT.md**: Update air-gap deployment section
3. **.env.example**: Add new environment variables
4. **copilot-instructions.md**: Document detection patterns and bypass logic

## Open Questions

1. **Strictness level**: Should we block on interface presence alone, or require gateway check?
2. **Whitelisting**: Should we allow certain interfaces (e.g., internal VLANs)?
3. **Logging**: Should network detection attempts be logged to file for audit?
4. **User override**: Should there be a temporary override mechanism (with warning)?
5. **Startup vs. runtime**: Check only at startup, or on every request?

## Estimated Effort

- **Core implementation**: 4-6 hours
- **Testing**: 2-3 hours
- **Documentation**: 1-2 hours
- **Total**: ~8-11 hours

## Recommended Decision

**Proceed with Phase 1-2 implementation** using combined interface + gateway detection with 10-second caching. This provides strong security without false positives, minimal performance impact, and clear user feedback.

Deploy initially with `NETWORK_DETECTION_ENABLED=false` for testing, then enable by default in subsequent release after validation.
