/**
 * cptr.in / pastebin - Minimalistic Vanilla JS
 * 
 * Supports:
 * - Sender: Text box -> Generates paste -> Produces cptr.in/pastebin/[hash]
 * - Receiver: Hash/URL input -> Loads & displays paste in receiver text box
 * - Dual Engine:
 *   1. Backend API Mode (VPS / SQLite REST API)
 *   2. Client-Side Compressed Mode (for 100% standalone GitHub Pages before VPS)
 * - Auto-detection from URL path (/pastebin/[hash]), query (?p=[hash]), or hash (#[hash])
 */

(function () {
  'use strict';

  // --- Configuration & State ---
  const CANONICAL_DOMAIN = 'cptr.in';
  const CANONICAL_PATH = '/pastebin/';

  const state = {
    theme: localStorage.getItem('cptr_theme') || 'dark',
    apiUrl: localStorage.getItem('cptr_api_url') || '', // empty means auto-detect relative /api
    backendOnline: false,
    currentHash: null
  };

  // --- DOM Elements ---
  const dom = {
    // Theme & Settings
    themeToggle: document.getElementById('btn-theme-toggle'),
    settingsToggle: document.getElementById('btn-settings-toggle'),
    settingsPanel: document.getElementById('settings-panel'),
    apiUrlInput: document.getElementById('api-url-input'),
    btnSaveSettings: document.getElementById('btn-save-settings'),
    btnResetSettings: document.getElementById('btn-reset-settings'),
    modeBadge: document.getElementById('mode-badge'),
    
    // Tabs
    tabSend: document.getElementById('tab-send'),
    tabReceive: document.getElementById('tab-receive'),
    panelSend: document.getElementById('panel-send'),
    panelReceive: document.getElementById('panel-receive'),

    // Sender
    senderText: document.getElementById('sender-text'),
    charCount: document.getElementById('char-count'),
    lineCount: document.getElementById('line-count'),
    pasteExpiration: document.getElementById('paste-expiration'),
    customSlug: document.getElementById('custom-slug'),
    btnClearSender: document.getElementById('btn-clear-sender'),
    btnSend: document.getElementById('btn-send'),
    senderResult: document.getElementById('sender-result'),
    resultSlugBadge: document.getElementById('result-slug-badge'),
    resultLinkInput: document.getElementById('result-link-input'),
    btnCopyLink: document.getElementById('btn-copy-link'),
    btnOpenLink: document.getElementById('btn-open-link'),
    btnLoadInReceiver: document.getElementById('btn-load-in-receiver'),
    resultTargetPreview: document.getElementById('result-target-preview'),

    // Receiver
    receiverHashInput: document.getElementById('receiver-hash-input'),
    btnReceive: document.getElementById('btn-receive'),
    receiverMeta: document.getElementById('receiver-meta'),
    metaHash: document.getElementById('meta-hash'),
    metaDate: document.getElementById('meta-date'),
    metaViews: document.getElementById('meta-views'),
    receiverText: document.getElementById('receiver-text'),
    receiverStats: document.getElementById('receiver-stats'),
    btnCopyReceived: document.getElementById('btn-copy-received'),
    btnDownloadTxt: document.getElementById('btn-download-txt'),
    btnForkPaste: document.getElementById('btn-fork-paste'),

    // Global Toast
    toast: document.getElementById('toast')
  };

  // --- Initialize App ---
  async function init() {
    applyTheme(state.theme);
    bindEvents();
    dom.apiUrlInput.value = state.apiUrl;
    
    // Check backend health
    await checkBackendStatus();

    // Check if URL has a paste hash or parameter
    handleIncomingRoute();
  }

  // --- Theme Handling ---
  function applyTheme(theme) {
    state.theme = theme;
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('cptr_theme', theme);
    dom.themeToggle.textContent = theme === 'dark' ? '☀️' : '🌙';
  }

  // --- Toast Notifications ---
  let toastTimer = null;
  function showToast(message, duration = 2500) {
    clearTimeout(toastTimer);
    dom.toast.textContent = message;
    dom.toast.classList.remove('hidden');
    toastTimer = setTimeout(() => {
      dom.toast.classList.add('hidden');
    }, duration);
  }

  // --- API Endpoint Resolution ---
  function getApiBase() {
    if (state.apiUrl && state.apiUrl.trim() !== '') {
      return state.apiUrl.trim().replace(/\/+$/, '');
    }
    // Default to relative API on same host
    return window.location.origin;
  }

  async function checkBackendStatus() {
    try {
      const apiBase = getApiBase();
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);
      
      const res = await fetch(`${apiBase}/api/health`, {
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        state.backendOnline = true;
        dom.modeBadge.textContent = 'API Online';
        dom.modeBadge.className = 'badge online';
        dom.modeBadge.title = `Connected to backend at ${apiBase}`;
        return true;
      }
    } catch (e) {
      // Backend not running (e.g. running purely static on GitHub Pages)
    }

    state.backendOnline = false;
    dom.modeBadge.textContent = 'Static / Offline';
    dom.modeBadge.className = 'badge';
    dom.modeBadge.title = 'Running in client-side static mode (GitHub Pages ready)';
    return false;
  }

  // --- Tab Navigation ---
  function switchTab(target) {
    if (target === 'send') {
      dom.tabSend.classList.add('active');
      dom.tabSend.setAttribute('aria-selected', 'true');
      dom.tabReceive.classList.remove('active');
      dom.tabReceive.setAttribute('aria-selected', 'false');

      dom.panelSend.classList.add('active');
      dom.panelReceive.classList.remove('active');
      dom.senderText.focus();
    } else {
      dom.tabReceive.classList.add('active');
      dom.tabReceive.setAttribute('aria-selected', 'true');
      dom.tabSend.classList.remove('active');
      dom.tabSend.setAttribute('aria-selected', 'false');

      dom.panelReceive.classList.add('active');
      dom.panelSend.classList.remove('active');
      dom.receiverHashInput.focus();
    }
  }

  // --- Text Stats Counter ---
  function updateSenderStats() {
    const text = dom.senderText.value;
    const chars = text.length;
    const lines = text === '' ? 0 : text.split('\n').length;
    dom.charCount.textContent = `${chars.toLocaleString()} chars`;
    dom.lineCount.textContent = `${lines.toLocaleString()} lines`;
  }

  // --- Clean Hash Input ---
  function extractHash(raw) {
    if (!raw) return '';
    let cleaned = raw.trim();
    // Remove full URLs if pasted
    cleaned = cleaned.replace(/^https?:\/\/[^\/]+\/pastebin\//i, '');
    cleaned = cleaned.replace(/^https?:\/\/[^\/]+\//i, '');
    // Remove query params
    cleaned = cleaned.replace(/^\?p=/, '');
    cleaned = cleaned.replace(/^#/, '');
    // Clean trailing slashes
    cleaned = cleaned.replace(/\/+$/, '');
    return cleaned;
  }

  // --- Target Link Formatter ---
  function formatTargetUrl(hash) {
    // If running on cptr.in, use the exact target domain
    if (window.location.hostname === CANONICAL_DOMAIN) {
      return `https://${CANONICAL_DOMAIN}${CANONICAL_PATH}${hash}`;
    }
    // If running on GitHub Pages or localhost, construct both canonical and current origin link
    const currentBase = window.location.origin + window.location.pathname.replace(/\/([^\/]*)$/, '/');
    if (window.location.hostname.endsWith('github.io')) {
      // GitHub pages friendly link
      return `${currentBase}#${hash}`;
    }
    // Default canonical target link format requested by user: cptr.in/pastebin/[hash]
    return `https://${CANONICAL_DOMAIN}${CANONICAL_PATH}${hash}`;
  }

  // --- Client-Side Compression Fallback (For 100% standalone GitHub Pages) ---
  function encodeClientHash(text) {
    try {
      // Base64 URL-safe encoding
      const utf8 = encodeURIComponent(text).replace(/%([0-9A-F]{2})/g, (match, p1) => {
        return String.fromCharCode('0x' + p1);
      });
      return 'c~' + btoa(utf8).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    } catch (e) {
      return 'c~' + encodeURIComponent(text);
    }
  }

  function decodeClientHash(hash) {
    try {
      const b64 = hash.slice(2).replace(/-/g, '+').replace(/_/g, '/');
      const bin = atob(b64);
      const str = Array.prototype.map.call(bin, ch => {
        return '%' + ('00' + ch.charCodeAt(0).toString(16)).slice(-2);
      }).join('');
      return decodeURIComponent(str);
    } catch (e) {
      return decodeURIComponent(hash.slice(2));
    }
  }

  // --- STEP 1: SENDER LOGIC ---
  async function handleSend() {
    const content = dom.senderText.value;
    if (!content.trim()) {
      showToast('⚠️ Please enter some text first!');
      dom.senderText.focus();
      return;
    }

    const customSlugVal = dom.customSlug.value.trim();
    const expirationVal = dom.pasteExpiration.value;

    dom.btnSend.disabled = true;
    dom.btnSend.innerHTML = '<span class="btn-text">Sending...</span> ⏳';

    let hash = '';
    let shareUrl = '';

    // If backend is online or API url is explicitly set, call backend API
    if (state.backendOnline || state.apiUrl) {
      try {
        const apiBase = getApiBase();
        const payload = {
          content: content,
          slug: customSlugVal || undefined,
          expiration: expirationVal
        };

        const res = await fetch(`${apiBase}/api/paste`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || `Server responded with ${res.status}`);
        }

        const data = await res.json();
        hash = data.hash;
        shareUrl = data.url || formatTargetUrl(hash);
      } catch (err) {
        console.warn('Backend API error, falling back to static client hash:', err);
        showToast('⚠️ Backend unavailable, generated static share link.');
        hash = customSlugVal || encodeClientHash(content);
        shareUrl = formatTargetUrl(hash);
      }
    } else {
      // Offline / GitHub Pages static mode
      hash = customSlugVal || encodeClientHash(content);
      shareUrl = formatTargetUrl(hash);
    }

    state.currentHash = hash;

    // Display Result Box
    dom.resultSlugBadge.textContent = `#${hash}`;
    dom.resultLinkInput.value = shareUrl;
    dom.btnOpenLink.href = shareUrl;
    dom.resultTargetPreview.textContent = `cptr.in/pastebin/${hash}`;
    dom.senderResult.classList.remove('hidden');

    // Auto-copy to clipboard
    try {
      await navigator.clipboard.writeText(shareUrl);
      showToast('🎉 Link copied to clipboard!');
    } catch (e) {
      showToast('✅ Paste created! Copy the link below.');
    }

    dom.btnSend.disabled = false;
    dom.btnSend.innerHTML = '<span class="btn-text">Send Paste</span> 🚀';
  }

  // --- STEP 1: RECEIVER LOGIC ---
  async function handleReceive(targetHash) {
    const rawInput = targetHash || dom.receiverHashInput.value;
    const hash = extractHash(rawInput);

    if (!hash) {
      showToast('⚠️ Please enter a valid hash or URL!');
      dom.receiverHashInput.focus();
      return;
    }

    dom.btnReceive.disabled = true;
    dom.btnReceive.innerHTML = '<span class="btn-text">Fetching...</span> ⏳';
    dom.receiverText.value = 'Loading paste...';
    dom.receiverStats.textContent = 'Loading...';

    try {
      let content = '';
      let meta = { hash: hash, created: 'N/A', views: 'N/A' };

      // Check if it's a client-side encoded hash (starts with 'c~')
      if (hash.startsWith('c~')) {
        content = decodeClientHash(hash);
        meta.created = 'Client-side Static';
        meta.views = 'Local';
      } else {
        // Fetch from Backend API
        const apiBase = getApiBase();
        const res = await fetch(`${apiBase}/api/paste/${encodeURIComponent(hash)}`);
        
        if (!res.ok) {
          if (res.status === 404) {
            throw new Error('Paste not found or has expired.');
          }
          throw new Error(`Failed to fetch paste (HTTP ${res.status})`);
        }

        const data = await res.json();
        content = data.content;
        meta.created = data.created_at ? new Date(data.created_at).toLocaleString() : 'Recent';
        meta.views = data.views !== undefined ? data.views : 1;
      }

      // Display in Receiver Text Box
      dom.receiverText.value = content;
      dom.receiverHashInput.value = hash;

      // Update meta
      dom.metaHash.textContent = meta.hash;
      dom.metaDate.textContent = meta.created;
      dom.metaViews.textContent = meta.views;
      dom.receiverMeta.classList.remove('hidden');

      // Update stats and enable action buttons
      const charCount = content.length;
      const lineCount = content === '' ? 0 : content.split('\n').length;
      dom.receiverStats.textContent = `${charCount.toLocaleString()} chars • ${lineCount.toLocaleString()} lines`;
      dom.btnCopyReceived.disabled = false;
      dom.btnDownloadTxt.disabled = false;
      dom.btnForkPaste.disabled = false;

      showToast('📥 Paste loaded successfully!');
    } catch (err) {
      dom.receiverText.value = `❌ Error: ${err.message}`;
      dom.receiverMeta.classList.add('hidden');
      dom.receiverStats.textContent = 'Failed to load';
      dom.btnCopyReceived.disabled = true;
      dom.btnDownloadTxt.disabled = true;
      dom.btnForkPaste.disabled = true;
      showToast(`⚠️ ${err.message}`, 3500);
    } finally {
      dom.btnReceive.disabled = false;
      dom.btnReceive.innerHTML = '<span class="btn-text">Receive</span> 📥';
    }
  }

  // --- Auto-Route / Deep-Link Parser ---
  function handleIncomingRoute() {
    let hash = '';

    // Check query params: ?p=... or ?hash=... (GitHub Pages 404 trick)
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.has('p')) {
      hash = extractHash(urlParams.get('p'));
    } else if (urlParams.has('hash')) {
      hash = extractHash(urlParams.get('hash'));
    } else if (urlParams.has('id')) {
      hash = extractHash(urlParams.get('id'));
    }

    // Check URL fragment: #hash
    if (!hash && window.location.hash) {
      hash = extractHash(window.location.hash);
    }

    // Check pathname: e.g. /pastebin/7kX9a or /7kX9a
    if (!hash) {
      const pathParts = window.location.pathname.split('/').filter(Boolean);
      // If path is like ['pastebin', '7kX9a'] -> 7kX9a
      if (pathParts.length >= 2 && pathParts[0] === 'pastebin' && pathParts[1] !== 'index.html') {
        hash = pathParts[1];
      } else if (pathParts.length === 1 && pathParts[0] !== 'pastebin' && pathParts[0] !== 'index.html') {
        hash = pathParts[0];
      }
    }

    if (hash) {
      switchTab('receive');
      dom.receiverHashInput.value = hash;
      handleReceive(hash);
    }
  }

  // --- Event Bindings ---
  function bindEvents() {
    // Theme toggle
    dom.themeToggle.addEventListener('click', () => {
      applyTheme(state.theme === 'dark' ? 'light' : 'dark');
    });

    // Settings toggle
    dom.settingsToggle.addEventListener('click', () => {
      dom.settingsPanel.classList.toggle('hidden');
    });

    dom.btnSaveSettings.addEventListener('click', () => {
      state.apiUrl = dom.apiUrlInput.value.trim();
      localStorage.setItem('cptr_api_url', state.apiUrl);
      dom.settingsPanel.classList.add('hidden');
      showToast('⚙️ Settings saved!');
      checkBackendStatus();
    });

    dom.btnResetSettings.addEventListener('click', () => {
      dom.apiUrlInput.value = '';
      state.apiUrl = '';
      localStorage.removeItem('cptr_api_url');
      dom.settingsPanel.classList.add('hidden');
      showToast('⚙️ Reset to auto-detect!');
      checkBackendStatus();
    });

    // Tab buttons
    dom.tabSend.addEventListener('click', () => switchTab('send'));
    dom.tabReceive.addEventListener('click', () => switchTab('receive'));

    // Text stats live update
    dom.senderText.addEventListener('input', updateSenderStats);

    // Tab key in textarea support (indent 2 spaces instead of leaving textarea)
    dom.senderText.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        const start = dom.senderText.selectionStart;
        const end = dom.senderText.selectionEnd;
        dom.senderText.value = dom.senderText.value.substring(0, start) + '  ' + dom.senderText.value.substring(end);
        dom.senderText.selectionStart = dom.senderText.selectionEnd = start + 2;
        updateSenderStats();
      }
      // Ctrl+Enter or Cmd+Enter to send
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        handleSend();
      }
    });

    // Clear sender
    dom.btnClearSender.addEventListener('click', () => {
      if (dom.senderText.value.trim() && !confirm('Clear current text?')) return;
      dom.senderText.value = '';
      updateSenderStats();
      dom.senderResult.classList.add('hidden');
      dom.senderText.focus();
    });

    // Sender button
    dom.btnSend.addEventListener('click', handleSend);

    // Copy link button
    dom.btnCopyLink.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(dom.resultLinkInput.value);
        showToast('📋 Link copied to clipboard!');
      } catch (err) {
        dom.resultLinkInput.select();
        document.execCommand('copy');
        showToast('📋 Copied!');
      }
    });

    // Load in receiver link
    dom.btnLoadInReceiver.addEventListener('click', () => {
      if (state.currentHash) {
        switchTab('receive');
        dom.receiverHashInput.value = state.currentHash;
        handleReceive(state.currentHash);
      }
    });

    // Receiver button & input enter key
    dom.btnReceive.addEventListener('click', () => handleReceive());
    dom.receiverHashInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleReceive();
      }
    });

    // Copy received text
    dom.btnCopyReceived.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(dom.receiverText.value);
        showToast('📋 Text copied to clipboard!');
      } catch (e) {
        dom.receiverText.select();
        document.execCommand('copy');
        showToast('📋 Text copied!');
      }
    });

    // Download text as .txt
    dom.btnDownloadTxt.addEventListener('click', () => {
      const text = dom.receiverText.value;
      const hash = dom.metaHash.textContent || 'paste';
      const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `cptr-paste-${hash}.txt`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast('💾 Download started!');
    });

    // Fork / Edit button (loads received text into sender)
    dom.btnForkPaste.addEventListener('click', () => {
      dom.senderText.value = dom.receiverText.value;
      updateSenderStats();
      switchTab('send');
      showToast('✏️ Loaded into editor for editing / forking');
    });
  }

  // Run init on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
