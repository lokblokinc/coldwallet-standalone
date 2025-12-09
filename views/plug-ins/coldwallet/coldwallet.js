(function(){
  // ===== Local store for created wallets =====
  const LOCAL_KEY = 'cold_wallets_v1';
  const store = {
    all(){ try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]'); } catch { return []; } },
    add(x){ const a = store.all(); a.unshift(x); localStorage.setItem(LOCAL_KEY, JSON.stringify(a)); }
  };

  // ===== Shortcuts =====
  const $ = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));
  const on = (el, ev, fn) => el && el.addEventListener(ev, fn);

  // ===== State =====
  let asset = 'BTC';
  let enrolled = 0;
  let _pinResolve = null;
  let lastPayload = '';

  // ===== External clients =====
  const { WS_CARD_1, WS_CARD_2, WS_CARD_3, WS_MANAGER } = (window.CW_ENV || {});
  const wsOptions = { autoReconnect: true };
  const api1 = new window.EnrollmentClient(WS_CARD_1, wsOptions);
  const api2 = new window.EnrollmentClient(WS_CARD_2, wsOptions);
  const api3 = new window.EnrollmentClient(WS_CARD_3, wsOptions);
  const manager = new window.EnrollmentClient(WS_MANAGER, wsOptions);
  const CARDS = [ {label:'Toughkey 1', api: api1}, {label:'Toughkey 2', api: api2}, {label:'Toughkey 3', api: api3} ];

  // ===== UI helpers =====
  function setStep(n, state){
    const el = $('#cw-step-'+n);
    if(!el) return;
    el.classList.remove('active','completed');
    if(state) el.classList.add(state);
  }
  function setStatus(msg, type){
    const box = $('#cw-status'); const txt = $('#cw-status-text');
    txt.textContent = msg;
    box.classList.remove('error','success','warning','alert-danger','alert-success');
    if(type==='success') box.classList.add('success');
  }
  function updateBadges(){
    $('#cw-enrolled').textContent = String(enrolled);
    $('#cw-shares').textContent = String(enrolled);
  }
  function bindDropdown(){
    const dd = $('#qr-address');
    dd.innerHTML = '';
    const wallets = store.all();
    if(wallets.length === 0){
      dd.innerHTML = '<option value="">No local wallets yet</option>';
      return;
    }
    wallets.forEach(w=>{
      const opt = document.createElement('option');
      opt.value = w.address;
      opt.textContent = `${w.address.slice(0,10)}...${w.address.slice(-10)} — ${w.asset}`;
      opt.dataset.asset = w.asset;
      dd.appendChild(opt);
    });
  }

  // PIN modal
  function showPinModal(){
    const ov = $('#pinModalOverlay'); const m = $('#pinModal');
    ov.style.display='flex';
    requestAnimationFrame(()=>m.classList.add('show'));
    const inp = $('#toughkeyPin'); inp.value=''; inp.focus();
  }
  function hidePinModal(){
    const ov = $('#pinModalOverlay'); const m = $('#pinModal');
    m.classList.remove('show'); setTimeout(()=>{ ov.style.display='none'; }, 250);
  }
  function askPin(){ return new Promise(res=>{ _pinResolve = res; showPinModal(); }); }

  // ===== Core flow =====
  async function connectAll(){
    setStep(1,'active'); setStatus('Connecting to devices...');
    await Promise.all([api1.connect(), api2.connect(), api3.connect(), manager.connect()]);
    setStep(1,'completed');
  }
  async function enrollOne(idx){
    setStep(2+idx,'active'); setStatus(`Insert/Tap ${CARDS[idx].label} and enter PIN`);
    const pin = await askPin();
    await CARDS[idx].api.checkPIN({ PIN: btoa(pin), Method:'CheckPIN' });
    // TODO: replace with real enrollment flow and success events
    enrolled++; updateBadges(); setStep(2+idx,'completed'); setStatus(`${CARDS[idx].label} enrolled`);
  }
  function finish(address){
    setStep(5,'completed'); setStep(6,'completed');
    setStatus('Wallet created', 'success');
    $('#cw-result').style.display = 'block';
    $('#cw-new-address').textContent = address;
    store.add({ address, asset, createdAt: Date.now() });
    bindDropdown();
  }

  // ===== QR helpers =====
  function currentSelection(){
    const dd = $('#qr-address'); const opt = dd && dd.options ? dd.options[dd.selectedIndex] : null;
    return opt ? { address: opt.value, asset: (opt.dataset.asset || 'BTC') } : null;
  }
  function buildPayload(){
    const sel = currentSelection();
    if(!sel || !sel.address) throw new Error('Select an address first');
    const action = $('#qr-action').value;
    const fmt = $('#qr-format').value;
    const body = { action, address: sel.address, asset: sel.asset, ts: Date.now() };
    if(fmt === 'json') return JSON.stringify(body);
    return `toughwallet://${action.toLowerCase()}?asset=${encodeURIComponent(sel.asset)}&address=${encodeURIComponent(sel.address)}`;
  }
  function renderQR(text){
    const canvas = $('#qr-canvas'); const fallback = $('#qr-fallback');
    try {
      fallback.innerHTML=''; fallback.style.display='none'; canvas.style.display='block';
      new QRious({ element: canvas, value: text, size: 220, backgroundAlpha: 1 });
    } catch(e){
      canvas.style.display='none'; fallback.style.display='block';
      // Optional: fallback to another QR lib if available
      fallback.textContent = text;
    }
  }

  // ===== Public actions (bound via data-click) =====
  const actions = {
    selectAsset(e){
      asset = e.currentTarget.dataset.assetCode;
      $$('.cw2-asset-option').forEach(x=>x.classList.remove('selected'));
      e.currentTarget.classList.add('selected');
      setStatus(`${asset} selected. Click Start`);
    },
    async start(){
      try {
        $('#cw-result').style.display='none';
        enrolled = 0; updateBadges();
        [1,2,3,4,5,6].forEach(n=>setStep(n,null));
        await connectAll();
        await enrollOne(0); await enrollOne(1); await enrollOne(2);
        setStep(5,'active'); setStatus('Generating key shares...');
        // Stub address (replace with actual from manager once enrollment completes)
        const stub = asset==='BTC'
          ? 'bc1q' + Math.random().toString(36).slice(2,10) + '...' + Math.random().toString(36).slice(2,8)
          : '0x' + (crypto.getRandomValues(new Uint8Array(20))).reduce((s,b)=>s+('0'+b.toString(16)).slice(-2),'').slice(0,12) + '…';
        finish(stub);
      } catch(e){ console.error(e); setStatus('Error: ' + (e.message || e), 'error'); }
    },
    reset(){
      [1,2,3,4,5,6].forEach(n=>setStep(n,null));
      enrolled = 0; updateBadges();
      setStatus('Select BTC or ETH, then click Start');
      $('#cw-result').style.display='none';
    },
    'pin-submit'(){
      const val = $('#toughkeyPin').value.trim();
      hidePinModal();
      if(_pinResolve){ const r = _pinResolve; _pinResolve = null; r(val); }
    },
    'qr-generate'(){
      try { lastPayload = buildPayload(); renderQR(lastPayload); $('#qr-payload').textContent = lastPayload; }
      catch(e){ alert(e.message || e); }
    },
    'qr-copy'(){
      if(!lastPayload){
        try { lastPayload = buildPayload(); } catch(e){ return alert('Nothing to copy'); }
      }
      navigator.clipboard.writeText(lastPayload);
    }
  };

  // ===== Wiring =====
  function bindClicks(){
    $$('[data-click]').forEach(el=>{
      const name = el.getAttribute('data-click');
      const fn = actions[name];
      if(fn) on(el, 'click', fn);
    });
    // Special: asset cards
    $$('[data-click="selectAsset"]').forEach(el=>on(el, 'click', actions.selectAsset));
  }

  document.addEventListener('DOMContentLoaded', ()=>{
    bindClicks();
    updateBadges();
    bindDropdown();
  });
})();