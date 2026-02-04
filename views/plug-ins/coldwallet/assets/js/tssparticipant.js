/*
 * object-socket.enrollment.bundle.js
 * One-file UMD bundle that exposes:
 *   - ObjectSocket: a tiny wrapper over WebSocket (objects + events, reconnect, request/response)
 *   - EnrollmentClient: protocol-specific helper for the enrollment flow you described
 *
 * Works in browsers (EJS templates) and Node (inject ws via opts.wsImpl).
 * No external deps.
 */
const CHECKPIN_TIMEOUT = 300000;                // wrc increased
const SENDSTATUS_TIMEOUT = 10000;               // wrc no change
const STATUS_POLLING_INTERVAL = 5000;           // wrc no change
const DEFAULT_ENROLL_WAITFOR_TIMEOUT = 300000;  // wrc increased  
const SIGNATURE_TIMEOUT = 300000;               // wrc increased

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    var api = factory();
    root.ObjectSocket = api.ObjectSocket;
    root.EnrollmentClient = api.EnrollmentClient;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------- ObjectSocket (plain JS) ----------------
  /** @typedef {{ type:string, id?:string, replyTo?:string, payload?:any, error?:{code?:string, message:string, details?:any} }} MessageEnvelope */

  function defaultBackoff(attempt) {
    var base = 500 * Math.pow(2, attempt);
    var jitter = Math.floor(Math.random() * 250);
    return Math.min(30000, base) + jitter;
  }

  function jsonEncode(obj) { return JSON.stringify(obj); }
  function jsonDecode(raw) {
    if (typeof raw === 'string') return JSON.parse(raw);
    if (raw instanceof ArrayBuffer) return JSON.parse(new TextDecoder().decode(new Uint8Array(raw)));
    if (ArrayBuffer.isView(raw)) return JSON.parse(new TextDecoder().decode(raw));
    return JSON.parse(String(raw));
  }

  /**
   * @param {string} url
   * @param {{
   *   wsImpl?: (url:string, protocols?:string|string[])=>WebSocket,
   *   protocols?: string|string[],
   *   token?: string|(()=>string|Promise<string>),
   *   tokenParam?: string,
   *   autoReconnect?: boolean,
   *   maxReconnects?: number,
   *   backoff?: (attempt:number)=>number,
   *   heartbeat?: { intervalMs?: number, pingType?: string, pongType?: string },
   *   encode?: (env:MessageEnvelope)=> (string|ArrayBuffer|Uint8Array),
   *   decode?: (raw:any)=> MessageEnvelope,
   *   tolerantDecode?: boolean
   * }} [options]
   */
  function ObjectSocket(url, options) {
    options = options || {};
    this._url = url;
    let result;
    this._opts = {
      wsImpl: options.wsImpl,
      protocols: options.protocols,
      token: options.token,
      tokenParam: options.tokenParam || 'token',
      autoReconnect: options.autoReconnect !== false,
      maxReconnects: typeof options.maxReconnects === 'number' ? options.maxReconnects : Infinity,
      backoff: options.backoff || defaultBackoff,
      heartbeat: options.heartbeat || { intervalMs: 25000, pingType: 'PING', pongType: 'PONG' },
      encode: options.encode || jsonEncode,
      decode: options.decode || jsonDecode,
      tolerantDecode: options.tolerantDecode !== false
    };

    this._ws = null;
    this._connected = false;
    this._reconnectAttempts = 0;
    this._heartbeatTimer = null;
    this._pending = new Map(); // id -> {resolve, reject, timeout}
    this._handlers = new Map(); // type -> Set(handler)
    this._listeners = new Map(); // event -> Set(listener)
    this._idCounter = 0;
  }

  ObjectSocket.prototype.connect = function () {
    var self = this;
    return self._buildUrlWithToken().then(function (url) {
      return new Promise(function (resolve, reject) {
        try {
          var ws = self._opts.wsImpl ? self._opts.wsImpl(url, self._opts.protocols) : new WebSocket(url, self._opts.protocols);
          self._ws = ws;
          ws.onopen = function () {
            self._connected = true;
            self._reconnectAttempts = 0;
            self._emit('connected');
            self._startHeartbeat();
            resolve();
          };
          ws.onmessage = function (ev) { self._handleMessage(ev); };
          ws.onerror = function (ev) { self._emit('error', ev); };
          ws.onclose = function (ev) {
            var wasConnected = self._connected;
            self._connected = false;
            self._clearHeartbeat();
            self._emit('disconnected', ev);
            if (wasConnected) self._failAllPending(new Error('socket closed'));
            if (self._opts.autoReconnect) self._scheduleReconnect();
          };
        } catch (err) { reject(err); }
      });
    });
  };

  ObjectSocket.prototype.close = function (code, reason) {
    this._opts.autoReconnect = false;
    if (this._ws) this._ws.close(code, reason);
    this._clearHeartbeat();
  };

  ObjectSocket.prototype.send = function (type, payload) {
    if (!this._ws || this._ws.readyState !== this._ws.OPEN) throw new Error('socket not open');
    var env = { type: type, payload: payload };
    this._ws.send(this._opts.encode(env));
  };

  ObjectSocket.prototype.request = function (type, payload, timeoutMs) {
    if (!this._ws || this._ws.readyState !== this._ws.OPEN) throw new Error('socket not open');
    var id = this._nextId();
    var env = { type: type, id: id, payload: payload };
    var raw = this._opts.encode(env);
    var self = this;
    var to = typeof timeoutMs === 'number' ? timeoutMs : 15000;
    return new Promise(function (resolve, reject) {
      var t = setTimeout(function () {
        self._pending.delete(id);
        reject(new Error('request timeout for ' + type + ' (' + id + ')'));
      }, to);
      self._pending.set(id, { resolve: resolve, reject: reject, timeout: t });
      self._ws.send(raw);
    });
  };

  ObjectSocket.prototype.onType = function (type, handler) {
    if (!this._handlers.has(type)) this._handlers.set(type, new Set());
    this._handlers.get(type).add(handler);
    var self = this;
    return function () { self.offType(type, handler); };
  };

  ObjectSocket.prototype.offType = function (type, handler) {
    var set = this._handlers.get(type);
    if (set) set.delete(handler);
  };

  ObjectSocket.prototype.on = function (event, listener) {
    if (!this._listeners.has(event)) this._listeners.set(event, new Set());
    this._listeners.get(event).add(listener);
    var self = this;
    return function () { self.off(event, listener); };
  };

  ObjectSocket.prototype.off = function (event, listener) {
    var set = this._listeners.get(event);
    if (set) set.delete(listener);
  };

  Object.defineProperty(ObjectSocket.prototype, 'isConnected', {
    get: function () { return this._connected; }
  });

  ObjectSocket.prototype._emit = function (event) {
    var args = Array.prototype.slice.call(arguments, 1);
    var set = this._listeners.get(event);
    if (!set) return;
    set.forEach(function (l) { try { l.apply(null, args); } catch (e) { try { console.error(e); } catch(_){} } });
  };

  ObjectSocket.prototype._buildUrlWithToken = function () {
    var self = this;
    return Promise.resolve(typeof self._opts.token === 'function' ? self._opts.token() : self._opts.token)
      .then(function (t) {
        if (!t) return self._url;
        var u = new URL(self._url, typeof window !== 'undefined' ? window.location.href : 'http://localhost');
        u.searchParams.set(self._opts.tokenParam, t);
        return u.toString();
      });
  };

  ObjectSocket.prototype._scheduleReconnect = function () {
    if (this._reconnectAttempts >= this._opts.maxReconnects) return;
    var attempt = this._reconnectAttempts++;
    var delay = this._opts.backoff(attempt);
    this._emit('reconnecting', { attempt: attempt, inMs: delay });
    var self = this;
    setTimeout(function () { self.connect().catch(function (){}); }, delay);
  };

  ObjectSocket.prototype._startHeartbeat = function () {
    var hb = this._opts.heartbeat || {};
    var intervalMs = hb.intervalMs;
    if (!intervalMs) return;
    var self = this;
    this._heartbeatTimer = setInterval(function () {
      if (!self._ws || self._ws.readyState !== self._ws.OPEN) return;
      try { self._ws.send(self._opts.encode({ type: hb.pingType || 'PING' })); } catch(_) {}
    }, intervalMs);
  };

  ObjectSocket.prototype._clearHeartbeat = function () {
    if (this._heartbeatTimer) clearInterval(this._heartbeatTimer);
    this._heartbeatTimer = null;
  };

  ObjectSocket.prototype._nextId = function () {
    this._idCounter += 1;
    return Date.now().toString(36) + '-' + this._idCounter.toString(36);
  };

  ObjectSocket.prototype._failAllPending = function (err) {
    var self = this;
    this._pending.forEach(function (p, id) {
      clearTimeout(p.timeout);
      p.reject(err);
      self._pending.delete(id);
    });
  };

  ObjectSocket.prototype._handleMessage = function (ev) {
    var env;
    try {
      env = this._opts.decode(ev.data);
    } catch (e) {
      if (this._opts.tolerantDecode) { this._emit('error', e); return; }
      throw e;
    }
    if (!env || typeof env.type !== 'string') return;

    if (env.replyTo) {
      var pending = this._pending.get(env.replyTo);
      if (pending) {
        clearTimeout(pending.timeout);
        this._pending.delete(env.replyTo);
        if (env.error) {
          var err = new Error(env.error.message);
          err.code = env.error.code;
          err.details = env.error.details;
          pending.reject(err);
        } else {
          pending.resolve(env.payload);
        }
      }
      return;
    }

    var set = this._handlers.get(env.type);
    if (set && set.size) {
      var self = this;
      set.forEach(function (handler) {
        var ctx = {
          envelope: env,
          reply: function (payload) { self._sendReply(env, payload); },
          replyError: function (message, code, details) { self._sendReply(env, undefined, { message: message, code: code, details: details }); }
        };
        try {
          
          Promise.resolve(handler(env.payload, ctx)).catch(function (e) { ctx.replyError(e && e.message ? e.message : 'handler error'); });
        } catch (e) {
          ctx.replyError('handler threw');
        }
      });
    }
  };

  ObjectSocket.prototype._sendReply = function (to, payload, error) {
    if (!to.id) return;
    if (!this._ws || this._ws.readyState !== this._ws.OPEN) return;
    var env = { type: to.type + ':REPLY', replyTo: to.id, payload: payload, error: error };
    this._ws.send(this._opts.encode(env));
  };

  // ---------------- EnrollmentClient (built on ObjectSocket) ----------------
  function EnrollmentClient(wsUrl, opts) {
    opts = opts || {};
    
    const response = '';

    var encode = function (env) {
      if (env && typeof env.type === 'string') {
        if (env.type === 'Info_ManagerForEnroll' || env.type === 'Enrollment' || env.type === 'Info_Enrollment') {
          var body = Object.assign({ Method: env.type }, env.payload || {});
          return JSON.stringify(body);
        }
      }
      return JSON.stringify(env && (env.payload || env));
    };

    // tssparticipant.js
var decode = function (raw) {
  // LOG SEMPRE: crudo + normalizzato
  let rawStr;
  if (typeof raw === 'string') rawStr = raw;
  else rawStr = new TextDecoder().decode(raw);
  console.log('[WS RAW]', rawStr);

  // 1) parse tollerante
  let msg = null;
  try {
    msg = JSON.parse(rawStr);
  } catch {
    // non è JSON -> prova a trattarlo come { Message: rawStr }
    msg = { Message: String(rawStr) };
  }

  if (msg && typeof msg === 'string') {
    const s = msg.trim();
    if ((s.startsWith('{') && s.endsWith('}')) || (s.startsWith('[') && s.endsWith(']'))) {
      try { msg = JSON.parse(s); } catch { msg = { Message: s }; }
    } else {
      msg = { Message: s };
    }
  }

  if (msg && typeof msg === 'object') {
    if (msg.ParticipantsEnrolled == 0) {
      return { type: 'MANAGER_INFO', payload: msg };
    }
  }

  if (msg.ParticipantsEnrolled > 0) {
    return { type: 'ENROLLMENT_STATUS', payload: msg };
  }

  const m = (typeof msg?.Message === 'string') ? msg.Message.trim() : '';
  const mUpper = m.toUpperCase();
  const hex = m.startsWith('0x') ? m.slice(2) : m;
  const is64Hex = /^[0-9a-fA-F]{64}$/.test(hex);
  const hasTxField = !!(msg?.TxHash || msg?.txHash || msg?.txid || msg?.TxId || msg?.TransactionId);

  console.log('[WS MSG]', msg);

  if (mUpper === 'SUCCESS.ENROLL') {
    return { type: 'ENROLLMENT_RESULT', payload: msg };
  }

  if (mUpper === 'SUCCESS.SIGNATURE_ADDED') {
    return { type: 'SIGN_RESULT', payload: msg };
  }
  if (mUpper === 'SUCCESS.SIGNATURE_ENDED') {
    return { type: 'SIGN_RESULT', payload: msg };
  }
  if (is64Hex || hasTxField) {
    return { type: 'SIGN_RESULT', payload: msg };
  }

  if (typeof msg?.SerialNumber === 'string' && msg.SerialNumber.length > 0) {
    return { type: 'SUCCESS.PIN_SERIAL', payload: msg };
  }
  if (
    typeof m === 'string' &&
    m.length > 0 &&
    mUpper !== 'ERROR.WRONG_PIN' &&
    !mUpper.startsWith('SUCCESS.SIGNATURE_') &&
    mUpper !== 'SUCCESS.ENROLL' &&
    !is64Hex
  ) {
    return { type: 'SUCCESS.PIN_SERIAL', payload: { SerialNumber: m, Message: m } };
  }

  if (mUpper === 'ERROR.WRONG_PIN') {
    return { type: 'ERROR.WRONG_PIN', payload: msg };
  }

  return { type: 'UNKNOWN', payload: msg };
};


    this.sock = new ObjectSocket(wsUrl, {
      wsImpl: opts.wsImpl,
      protocols: opts.protocols,
      autoReconnect: opts.autoReconnect !== false,
      heartbeat: { intervalMs: 0 }, // no custom pings; server didn't specify a ping format
      encode: encode,
      decode: decode,
      response: response,
      tolerantDecode: true,
      token: undefined // auth baked into message payloads
    });

    this._statusTimer = null;
  }

  EnrollmentClient.prototype.connect = function () { return this.sock.connect(); };
  EnrollmentClient.prototype.close = function (code, reason) { return this.sock.close(code, reason); };
  EnrollmentClient.prototype.on = function (event, fn) { return this.sock.on(event, fn); };

  EnrollmentClient.prototype.onManagerInfo = function (fn) { return this.sock.onType('MANAGER_INFO', function (p) { fn(p); }); };
  EnrollmentClient.prototype.onEnrollmentStatus = function (fn) { return this.sock.onType('ENROLLMENT_STATUS', function (p) { fn(p); }); };
  EnrollmentClient.prototype.onEnrollmentResult = function (fn) { return this.sock.onType('ENROLLMENT_RESULT', function (p) { fn(p); }); };
  EnrollmentClient.prototype.onSignResult = function (fn) { return this.sock.onType('SIGN_RESULT', function (p) { fn(p); }); };
  EnrollmentClient.prototype.onUnknown = function (fn) { return this.sock.onType('UNKNOWN', function (p) { fn(p); }); };

  EnrollmentClient.prototype.requestManagerInfo = async function (params) {
    return this._sendAndWait('Info_Enrollment', params, 'MANAGER_INFO', 60000);
  };

  EnrollmentClient.prototype.enroll = function (params) {
    const promise = this._sendAndWait('Enrollment', params, 'ENROLLMENT_RESULT', 200000);
    this.response = promise;
    return promise;
  };

      EnrollmentClient.prototype.sign = function (params) {
      const promise = this._sendAndWait(
        'Sign',
        params,
        // eventi che sbloccano l'attesa del sign:
        ['SIGN_RESULT', 'SUCCESS.SIGNATURE_ADDED', 'SUCCESS.SIGNATURE_ENDED'],
        SIGNATURE_TIMEOUT
      );
      this.response = promise;
      return promise;
    };

  EnrollmentClient.prototype.sendStatus = function (params) { 
    const promise =this._sendAndWait('Info_Enrollment', params, 'ENROLLMENT_STATUS', SENDSTATUS_TIMEOUT);
    this.response = promise;
    return promise; 
  };

  EnrollmentClient.prototype.checkPIN = function (params) {
      const promise = this._sendAndWait('CheckPIN', params, ['SUCCESS.PIN_SERIAL', 'ERROR.WRONG_PIN'], CHECKPIN_TIMEOUT);
      this.response = promise;
      return promise;
  };

  EnrollmentClient.prototype.startStatusPolling = function (params, everyMs) {
    if (everyMs == null) everyMs = STATUS_POLLING_INTERVAL;
    this.stopStatusPolling();
    var self = this;
    this._statusTimer = setInterval(function () {
      if (self.sock.isConnected) self.sendStatus(params);
    }, everyMs);
    return function () { self.stopStatusPolling(); };
  };

  EnrollmentClient.prototype.stopStatusPolling = function () {
    if (this._statusTimer) clearInterval(this._statusTimer);
    this._statusTimer = null;
  };

  EnrollmentClient.prototype.waitFor = function (predicate, cfg) {
    cfg = cfg || {}; var timeoutMs = cfg.timeoutMs == null ? DEFAULT_ENROLL_WAITFOR_TIMEOUT : cfg.timeoutMs;
    var self = this;
    return new Promise(function (resolve, reject) {
      var to = setTimeout(function () { off(); reject(new Error('waitFor timeout')); }, timeoutMs);
      var offStatus = self.onEnrollmentStatus(function (s) { try { if (predicate(s)) { off(); resolve(s); } } catch (_) {} });
      var offResult = self.onEnrollmentResult(function (r) { off(); resolve(r); });
      function off() { clearTimeout(to); offStatus(); offResult(); }
    });
  };

  EnrollmentClient.prototype._sendAndWait = function (type, payload, expectType, timeoutMs) {
    if (timeoutMs == null) timeoutMs = 15000;
    this.sock.send(type, payload);
    var self = this;

    var expectList = Array.isArray(expectType) ? expectType : [expectType];
    var isMulti = expectList.length > 1;

    return new Promise(function (resolve, reject) {
    var offs = [];
    function cleanup() { clearTimeout(to); offs.forEach(function (off) { try { off(); } catch(_) {} }); }
      var to = setTimeout(function () {
        cleanup();
        reject(new Error('timeout waiting for ' + expectList.join(' or ')));
      }, timeoutMs);

      offs = expectList.map(function (t) {
        return self.sock.onType(t, function (p) {
          cleanup();
          resolve(isMulti ? { type: t, payload: p } : p);
        });
      });
    });   
  };

  // --------------- Public API ---------------
  return { ObjectSocket: ObjectSocket, EnrollmentClient: EnrollmentClient };
});

/*
USAGE (EJS/browser):
  <script src="/js/object-socket.enrollment.bundle.js"></script>
  <script>
    const api = new EnrollmentClient('wss://your-host/ws');
    api.on('connected', () => console.log('ws connected'));
    api.onEnrollmentStatus(s => console.log('status', s));
    (async () => {
      await api.connect();
      const info = await api.requestManagerInfo({ Name: 'participant-guid', PartyGUID: 'party-guid', Token: 'manager-token' });
      api.startStatusPolling({ ID: 'participant-guid', PartyGUID: 'party-guid' });
      const result = await api.enroll({ Name: 'participant-guid', PartyGUID: 'party-guid', PIN: '<enc-pin>', Token: 'manager-token' });
      console.log('result', result);
    })();
  </script>
*/

