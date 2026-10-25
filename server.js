/**
 * cptr.in / pastebin - Node.js Backend Server (Zero external dependencies)
 * Alternative backend for Node.js environments.
 * 
 * Run with: node server.js
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 8000;
const HOST = process.env.HOST || '0.0.0.0';
const DATA_FILE = path.join(__dirname, 'pastes.json');
const STATIC_DIR = __dirname;
const CANONICAL_DOMAIN = process.env.CANONICAL_DOMAIN || 'cptr.in';
const CANONICAL_PATH = '/pastebin/';

// In-memory cache + persistent JSON file store
let pastes = {};
if (fs.existsSync(DATA_FILE)) {
  try {
    pastes = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  } catch (e) {
    pastes = {};
  }
}

function savePastes() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(pastes, null, 2), 'utf-8');
}

function generateRandomHash(len = 6) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let res = '';
  const bytes = crypto.randomBytes(len);
  for (let i = 0; i < len; i++) {
    res += chars[bytes[i] % chars.length];
  }
  return res;
}

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname.replace(/\/+$/, '');

  // 1. Health check
  if (req.method === 'GET' && pathname === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', time: new Date().toISOString() }));
    return;
  }

  // 2. Fetch Paste: GET /api/paste/:hash
  if (req.method === 'GET' && pathname.startsWith('/api/paste/')) {
    const hash = pathname.substring('/api/paste/'.length);
    const item = pastes[hash];

    if (!item) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Paste not found' }));
      return;
    }

    if (item.expires_at && new Date() > new Date(item.expires_at)) {
      delete pastes[hash];
      savePastes();
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Paste has expired' }));
      return;
    }

    item.views = (item.views || 0) + 1;
    const content = item.content;
    const views = item.views;
    const created_at = item.created_at;

    if (item.burn_after_read) {
      delete pastes[hash];
    }
    savePastes();

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      hash: hash,
      content: content,
      created_at: created_at,
      views: views
    }));
    return;
  }

  // 3. Raw text: GET /raw/:hash
  if (req.method === 'GET' && (pathname.startsWith('/raw/') || pathname.startsWith('/pastebin/raw/'))) {
    const hash = pathname.split('/').pop();
    const item = pastes[hash];
    if (!item) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found\n');
      return;
    }
    item.views = (item.views || 0) + 1;
    const content = item.content;
    if (item.burn_after_read) {
      delete pastes[hash];
    }
    savePastes();
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(content);
    return;
  }

  // 4. Create Paste: POST /api/paste
  if (req.method === 'POST' && pathname === '/api/paste') {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 10 * 1024 * 1024) req.destroy();
    });

    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const content = (data.content || '').trim();
        if (!content) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Content cannot be empty' }));
          return;
        }

        const customSlug = (data.slug || '').trim();
        let finalHash = '';

        if (customSlug) {
          const safeSlug = customSlug.replace(/[^a-zA-Z0-9-_]/g, '');
          if (pastes[safeSlug]) {
            res.writeHead(409, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Custom slug already taken' }));
            return;
          }
          finalHash = safeSlug;
        } else {
          do {
            finalHash = generateRandomHash(6);
          } while (pastes[finalHash]);
        }

        const now = new Date();
        let expiresAt = null;
        if (data.expiration === '1h') expiresAt = new Date(now.getTime() + 3600000).toISOString();
        if (data.expiration === '1d') expiresAt = new Date(now.getTime() + 86400000).toISOString();
        if (data.expiration === '7d') expiresAt = new Date(now.getTime() + 7 * 86400000).toISOString();

        pastes[finalHash] = {
          content: content,
          created_at: now.toISOString(),
          expires_at: expiresAt,
          burn_after_read: data.expiration === 'burn',
          views: 0
        };
        savePastes();

        const targetUrl = `https://${CANONICAL_DOMAIN}${CANONICAL_PATH}${finalHash}`;
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'ok',
          hash: finalHash,
          url: targetUrl,
          raw_url: `https://${CANONICAL_DOMAIN}/raw/${finalHash}`
        }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON request' }));
      }
    });
    return;
  }

  // 5. Static Files & SPA Fallback
  let filePath = path.join(STATIC_DIR, pathname === '' || pathname === '/pastebin' ? 'index.html' : pathname);

  // If path is /pastebin/<hash>, fallback to index.html
  if (pathname.startsWith('/pastebin/')) {
    const sub = pathname.substring('/pastebin/'.length);
    if (!sub.includes('.')) {
      filePath = path.join(STATIC_DIR, 'index.html');
    }
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      filePath = path.join(STATIC_DIR, 'index.html');
    }
    const ext = path.extname(filePath);
    const contentType = mimeTypes[ext] || 'application/octet-stream';

    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(500);
        res.end('500 Internal Server Error');
        return;
      }
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(data);
    });
  });
});

server.listen(PORT, HOST, () => {
  console.log(`🚀 cptr.in/pastebin Node.js server running on http://${HOST}:${PORT}`);
});
