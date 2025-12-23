const os = require('os');
const { execSync } = require('child_process');

/**
 * NetworkDetector - Detects active network connectivity
 * Used to enforce air-gap policy for Cold Wallet
 */
class NetworkDetector {
  constructor() {
    this.lastCheck = null;
    this.lastResult = null;
    this.cacheDuration = parseInt(process.env.NETWORK_DETECTION_CACHE_MS) || 10000; // 10 seconds default
    this.enabled = process.env.NETWORK_DETECTION_ENABLED !== 'false'; // Enabled by default
    this.strictMode = process.env.NETWORK_DETECTION_STRICT_MODE === 'true';
    this.whitelistInterfaces = process.env.NETWORK_DETECTION_WHITELIST_INTERFACES
      ? process.env.NETWORK_DETECTION_WHITELIST_INTERFACES.split(',').map(s => s.trim())
      : [];
  }

  /**
   * Main detection method - checks if network connectivity exists
   * @returns {Object} Detection result with hasNetwork flag and details
   */
  detect() {
    // If detection is disabled, always return no network
    if (!this.enabled) {
      return {
        hasNetwork: false,
        enabled: false,
        timestamp: new Date().toISOString()
      };
    }

    // Use cached result if recent
    const now = Date.now();
    if (this.lastCheck && (now - this.lastCheck) < this.cacheDuration) {
      return this.lastResult;
    }

    const result = {
      hasNetwork: false,
      enabled: true,
      interfaces: [],
      gateway: false,
      details: {},
      timestamp: new Date().toISOString()
    };

    // Check 1: Active network interfaces
    const interfaces = this.checkInterfaces();
    if (interfaces.length > 0) {
      result.hasNetwork = true;
      result.interfaces = interfaces;
    }

    // Check 2: Default gateway
    const gwInfo = this.checkGateway();
    if (gwInfo.active) {
      result.hasNetwork = true;
      result.gateway = true;
    }
    result.details.gateway = gwInfo;

    // Cache result
    this.lastCheck = now;
    this.lastResult = result;

    // Log detection if network found
    if (result.hasNetwork) {
      console.warn('⚠️  Network connectivity detected:', {
        interfaces: result.interfaces,
        gateway: result.gateway
      });
    }

    return result;
  }

  /**
   * Check for active non-loopback network interfaces
   * @returns {Array} List of active interfaces with addresses
   */
  checkInterfaces() {
    const active = [];
    const interfaces = os.networkInterfaces();
    const winConnected = process.platform === 'win32' ? this._windowsGetConnectedInterfaces() : null;
    
    for (const [name, addrs] of Object.entries(interfaces)) {
      // Skip loopback interfaces
      if (name.match(/^lo\d*$/i)) continue;
      
      // Skip whitelisted interfaces
      if (this.whitelistInterfaces.includes(name)) continue;
      
      // On Linux, require interface link to be UP/LOWER_UP
      if (process.platform === 'linux' && !this._linuxIsIfUp(name)) {
        continue;
      }

      // On Windows, require interface Connect state = Connected and Type = Dedicated
      if (process.platform === 'win32' && winConnected && !winConnected.has(name)) {
        continue;
      }

      for (const addr of addrs) {
        // Check for non-internal IPv4 addresses
        if (!addr.internal && addr.family === 'IPv4' && addr.address !== '127.0.0.1') {
          active.push({ name, address: addr.address, mac: addr.mac });
        }
      }
    }
    
    return active;
  }

  /**
   * Check if system has an active default gateway (reachable external route)
   * @returns {Object} { active: boolean, iface?: string, gateway?: string, reason?: string }
   */
  checkGateway() {
    try {
      const platform = process.platform;
      if (platform === 'linux') {
        // Parse default route and validate its interface link state
        const output = execSync('ip -4 route show default 2>/dev/null', {
          encoding: 'utf8',
          timeout: 2000,
          stdio: ['pipe', 'pipe', 'ignore']
        }).trim();

        if (!output) {
          return { active: false, reason: 'no_default_route' };
        }

        const devMatch = output.match(/\bdev\s+(\S+)/);
        const viaMatch = output.match(/\bvia\s+(\S+)/);
        const iface = devMatch ? devMatch[1] : null;
        const gateway = viaMatch ? viaMatch[1] : null;

        if (!iface) {
          return { active: false, reason: 'no_iface_in_default' };
        }

        // Respect whitelist
        if (this.whitelistInterfaces.includes(iface)) {
          return { active: false, iface, gateway, reason: 'iface_whitelisted' };
        }

        // In strict mode, any default route implies network
        if (this.strictMode) {
          return { active: true, iface, gateway, reason: 'strict_mode' };
        }

        // Require interface link state UP and LOWER_UP
        const isUp = this._linuxIsIfUp(iface);
        if (!isUp) {
          return { active: false, iface, gateway, reason: 'iface_down' };
        }

        // Optional: kernel route lookup to external IP (no packets sent)
        try {
          const routeGet = execSync('ip -4 route get 1.1.1.1 2>/dev/null', {
            encoding: 'utf8',
            timeout: 1500,
            stdio: ['pipe', 'pipe', 'ignore']
          }).trim();
          const routeDev = routeGet.match(/\bdev\s+(\S+)/);
          const dev = routeDev ? routeDev[1] : null;
          if (dev && dev === iface) {
            return { active: true, iface, gateway, reason: 'default_route_active' };
          }
          // If kernel would not use default dev, treat as inactive
          return { active: false, iface, gateway, reason: 'route_not_via_default_dev' };
        } catch (_) {
          // If route lookup fails, be conservative and treat as inactive
          return { active: false, iface, gateway, reason: 'route_lookup_failed' };
        }
      }

      // Non-Linux platforms: fallback to presence-based check
      let cmd;
      if (platform === 'darwin') {
        cmd = 'route -n get default 2>/dev/null';
      } else if (platform === 'win32') {
        // First, ensure at least one interface is connected
        const connected = this._windowsGetConnectedInterfaces();
        if (!connected || connected.size === 0) {
          return { active: false, reason: 'no_connected_interfaces' };
        }
        cmd = 'route print 0.0.0.0';
      } else {
        return { active: false, reason: 'unsupported_platform' };
      }

      const output = execSync(cmd, {
        encoding: 'utf8',
        timeout: 2000,
        stdio: ['pipe', 'pipe', 'ignore']
      }).trim();
      return { active: !!output, reason: output ? 'default_route_present' : 'no_default_route' };
    } catch (err) {
      // Command failed, assume no gateway
      return { active: false, reason: 'command_failed' };
    }
  }

  /**
   * Linux: determine if interface is operationally up and has lower layer up
   * @param {string} iface
   * @returns {boolean}
   */
  _linuxIsIfUp(iface) {
    if (process.platform !== 'linux') return true;
    try {
      // Quick path: ip link show provides both state and LOWER_UP
      const out = execSync(`ip -o link show ${iface} 2>/dev/null`, {
        encoding: 'utf8',
        timeout: 1000,
        stdio: ['pipe', 'pipe', 'ignore']
      }).trim();
      if (!out) return false;
      const stateUp = /state\s+UP\b/i.test(out);
      const lowerUp = /LOWER_UP\b/i.test(out);
      return stateUp && lowerUp;
    } catch (_) {
      // Fallback to sysfs operstate
      try {
        const fs = require('fs');
        const oper = fs.readFileSync(`/sys/class/net/${iface}/operstate`, 'utf8').trim();
        return oper === 'up';
      } catch (_) {
        return false;
      }
    }
  }

  /**
   * Windows: get set of interface names that are Connected and Dedicated
   * @returns {Set<string>}
   */
  _windowsGetConnectedInterfaces() {
    if (process.platform !== 'win32') return null;
    try {
      const out = execSync('netsh interface show interface', {
        encoding: 'utf8',
        timeout: 1500,
        stdio: ['pipe', 'pipe', 'ignore']
      });
      const lines = out.split(/\r?\n/).map(l => l.trim()).filter(l => l);
      const set = new Set();
      for (const line of lines) {
        // Skip header and separator
        if (line.startsWith('Admin State') || line.startsWith('---')) continue;
        const m = line.match(/^(Enabled|Disabled)\s+(Connected|Disconnected)\s+(Dedicated|Loopback|Tunnel)\s+(.+)$/i);
        if (!m) continue;
        const state = m[2].toLowerCase();
        const type = m[3].toLowerCase();
        const name = m[4];
        if (state === 'connected' && type === 'dedicated') {
          // Respect whitelist
          if (!this.whitelistInterfaces.includes(name)) {
            set.add(name);
          }
        }
      }
      return set;
    } catch (_) {
      return new Set();
    }
  }

  /**
   * Clear the detection cache to force immediate re-check
   */
  clearCache() {
    this.lastCheck = null;
    this.lastResult = null;
  }

  /**
   * Get current configuration
   * @returns {Object} Configuration details
   */
  getConfig() {
    return {
      enabled: this.enabled,
      cacheDuration: this.cacheDuration,
      strictMode: this.strictMode,
      whitelistInterfaces: this.whitelistInterfaces
    };
  }
}

module.exports = new NetworkDetector();
