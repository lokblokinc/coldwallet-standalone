# Cold Wallet Standalone — Timeout Review

## Scope and files reviewed
- server.js
- config/database.js
- models/address.js
- utils/networkDetection.js
- views/layout-minimal.ejs
- views/error.ejs
- views/network-blocked.ejs
- views/plug-ins/coldwallet/coldwallet.ejs
- views/plug-ins/coldwallet/coldwallet.js
- views/plug-ins/coldwallet/routes.js
- views/plug-ins/coldwallet/plugin.json
- views/plug-ins/coldwallet/assets/js/tssparticipant.js
- views/plug-ins/coldwallet/assets/js/aes.js
- views/plug-ins/coldwallet/assets/js/qrcode.js
- public/css/loading-overlay.css

## Timeout and interval inventory (with emphasis on WebSockets)

### WebSocket-related
- **tssparticipant.js**
  - **Reconnect backoff:** `ObjectSocket._scheduleReconnect()` uses `setTimeout` with exponential backoff + jitter (base 500ms, capped at 30s).
  - **Request timeout:** `ObjectSocket.request()` defaults to 15s per request unless overridden.
  - **Heartbeat:** `ObjectSocket._startHeartbeat()` uses `setInterval` with configurable interval (`heartbeat.intervalMs`). In `EnrollmentClient`, heartbeat is explicitly disabled (`intervalMs: 0`).
  - **EnrollmentClient timeouts:** `_sendAndWait()` uses timeouts per call:
    - `requestManagerInfo`: 60s
    - `enroll`: 200s
    - `sign`: 120s
    - `sendStatus`: 10s
    - `checkPIN`: 10s
    - `waitFor`: 120s (default)
  - **Status polling:** `startStatusPolling()` uses `setInterval` with default 5s.

### Non-WebSocket timeouts / intervals
- **server.js**
  - **SQLite lock retry backoff:** exponential backoff via `setTimeout` in `POST /api/addresses` (100ms → 2000ms max).
- **utils/networkDetection.js**
  - **Command timeouts:** `execSync` calls use timeouts (1s–2s) for route/interface checks.
- **views/layout-minimal.ejs**
  - **Health polling:** `setInterval` every 5s to call `/health` and reload if network is detected.
- **views/plug-ins/coldwallet/coldwallet.ejs**
  - **Flow pacing:** `sleep()` helper uses `setTimeout` for UI/flow steps (2–3s waits during enrollment and save-share loops).
  - **Focus timing:** `setTimeout(..., 0)` to focus the PIN input after modal opens.
- **views/plug-ins/coldwallet/coldwallet.js**
  - **Modal close delay:** `setTimeout(..., 250)` after removing modal CSS class.
- **views/plug-ins/coldwallet/assets/js/qrcode.js** (minified third-party)
  - **Scan loop timing:** uses `setTimeout` for repeated scanning attempts and frame scheduling.

## Code review notes (timeouts + reliability)
1. **WebSocket reconnection and request timeouts are present but not centrally configurable.** In `tssparticipant.js`, timeouts are hard-coded per method. Consider making them configurable via env or UI config if field tuning is needed.
2. **Heartbeat disabled for EnrollmentClient.** If the TSS service expects keep-alive pings, the current `intervalMs: 0` could allow idle connection drops. Confirm server-side expectations.
3. **Polling intervals are fixed.** Health polling (5s) and enrollment status polling (5s) are constant; consider backoff on failures to reduce load in degraded environments.
4. **UI sleep delays are static.** The delays in `coldwallet.ejs` are fixed (2–3s). If device operations are slower, the UX may feel out of sync; if faster, UX is unnecessarily delayed.

## Recommendations
- Expose WebSocket timeout/backoff settings via environment or configuration in the standalone server.
- Add lightweight telemetry/logging around WebSocket timeouts to distinguish server latency vs. client-side connection issues.
- Consider aligning the scanner and enrollment timing intervals with device capabilities or allow per-device overrides.

## Notes on third-party assets
- `aes.js` and `qrcode.js` appear to be third-party libraries; timeouts in `qrcode.js` are part of internal scanning loops.
