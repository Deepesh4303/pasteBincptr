// ==============================================================================
// Cloudflare Worker + Static Assets (Universal Edge Entrypoint)
// Handles API routes (/api/*, /raw/*) and serves static frontend assets
// ==============================================================================

const CANONICAL_DOMAIN = 'cptr.in';
const CANONICAL_PATH = '/pastebin/';
const ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

function generateRandomHash(length = 6) {
  let result = '';
  const randomBytes = new Uint8Array(length);
  crypto.getRandomValues(randomBytes);
  for (let i = 0; i < length; i++) {
    result += ALPHABET[randomBytes[i] % ALPHABET.length];
  }
  return result;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json; charset=utf-8'
};

export default {
  async fetch(request, env, ctx) {
    // 1. CORS Preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const url = new URL(request.url);
    const pathname = url.pathname.replace(/\/+$/, '');

    // 2. Health check
    if (pathname === '/api/health') {
      return new Response(JSON.stringify({
        status: 'ok',
        engine: 'cloudflare-d1',
        time: new Date().toISOString()
      }), {
        status: 200,
        headers: corsHeaders
      });
    }

    // 3. Create Paste: POST /api/paste
    if (request.method === 'POST' && pathname === '/api/paste') {
      return handleCreatePaste(request, env);
    }

    // 4. Fetch Paste: GET /api/paste/:hash
    if (request.method === 'GET' && pathname.startsWith('/api/paste/')) {
      const hash = pathname.substring('/api/paste/'.length);
      return handleGetPaste(hash, env);
    }

    // 5. Raw plain text: GET /raw/:hash or /pastebin/raw/:hash
    if (request.method === 'GET' && (pathname.startsWith('/raw/') || pathname.startsWith('/pastebin/raw/'))) {
      const hash = pathname.split('/').pop();
      return handleGetRaw(hash, env);
    }

    // 6. SPA Route: /pastebin/:hash -> Serve index.html
    if (pathname.startsWith('/pastebin/')) {
      const parts = pathname.split('/').filter(Boolean);
      // If visiting /pastebin/[hash], serve index.html while preserving URL
      if (parts.length >= 2 && !parts[1].includes('.')) {
        if (env.ASSETS) {
          return env.ASSETS.fetch(new URL('/', url.origin));
        }
      }
    }

    // 7. Serve Static Assets (HTML, CSS, JS) via Cloudflare Assets
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response('Not Found', { status: 404 });
  }
};

async function handleCreatePaste(request, env) {
  if (!env.DB) {
    return new Response(JSON.stringify({ error: 'Database binding (DB) not configured.' }), {
      status: 500,
      headers: corsHeaders
    });
  }

  try {
    const data = await request.json();
    const content = (data.content || '').trim();

    if (!content) {
      return new Response(JSON.stringify({ error: 'Content cannot be empty' }), {
        status: 400,
        headers: corsHeaders
      });
    }

    if (content.length > 5 * 1024 * 1024) {
      return new Response(JSON.stringify({ error: 'Paste exceeds size limit (5MB)' }), {
        status: 413,
        headers: corsHeaders
      });
    }

    const customSlug = (data.slug || '').trim();
    const expiration = data.expiration || 'never';
    let finalHash = '';

    if (customSlug) {
      const safeSlug = customSlug.replace(/[^a-zA-Z0-9-_]/g, '');
      if (safeSlug.length < 2 || safeSlug.length > 32) {
        return new Response(JSON.stringify({ error: 'Custom slug must be 2-32 alphanumeric characters' }), {
          status: 400,
          headers: corsHeaders
        });
      }

      const existing = await env.DB.prepare('SELECT hash FROM pastes WHERE hash = ?').bind(safeSlug).first();
      if (existing) {
        return new Response(JSON.stringify({ error: 'Custom slug already taken' }), {
          status: 409,
          headers: corsHeaders
        });
      }
      finalHash = safeSlug;
    } else {
      for (let attempt = 0; attempt < 5; attempt++) {
        const candidate = generateRandomHash(6);
        const exists = await env.DB.prepare('SELECT hash FROM pastes WHERE hash = ?').bind(candidate).first();
        if (!exists) {
          finalHash = candidate;
          break;
        }
      }
      if (!finalHash) {
        finalHash = generateRandomHash(8);
      }
    }

    const now = new Date();
    let expiresAt = null;
    const isBurn = expiration === 'burn' ? 1 : 0;

    if (expiration === '1h') expiresAt = new Date(now.getTime() + 3600 * 1000).toISOString();
    else if (expiration === '1d') expiresAt = new Date(now.getTime() + 86400 * 1000).toISOString();
    else if (expiration === '7d') expiresAt = new Date(now.getTime() + 7 * 86400 * 1000).toISOString();

    await env.DB.prepare(`
      INSERT INTO pastes (hash, content, created_at, expires_at, burn_after_read, views)
      VALUES (?, ?, ?, ?, ?, 0)
    `).bind(finalHash, content, now.toISOString(), expiresAt, isBurn).run();

    const host = request.headers.get('host') || CANONICAL_DOMAIN;
    const targetUrl = `https://${host}${CANONICAL_PATH}${finalHash}`;
    const rawUrl = `https://${host}/raw/${finalHash}`;

    return new Response(JSON.stringify({
      status: 'ok',
      hash: finalHash,
      url: targetUrl,
      raw_url: rawUrl,
      burn_after_read: Boolean(isBurn),
      expires_at: expiresAt
    }), {
      status: 201,
      headers: corsHeaders
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: corsHeaders
    });
  }
}

async function handleGetPaste(hash, env) {
  if (!env.DB) {
    return new Response(JSON.stringify({ error: 'Database binding (DB) not configured' }), {
      status: 500,
      headers: corsHeaders
    });
  }

  try {
    const row = await env.DB.prepare('SELECT * FROM pastes WHERE hash = ?').bind(hash).first();
    if (!row) {
      return new Response(JSON.stringify({ error: 'Paste not found' }), {
        status: 404,
        headers: corsHeaders
      });
    }

    const now = new Date();
    if (row.expires_at && now > new Date(row.expires_at)) {
      await env.DB.prepare('DELETE FROM pastes WHERE hash = ?').bind(hash).run();
      return new Response(JSON.stringify({ error: 'Paste has expired' }), {
        status: 404,
        headers: corsHeaders
      });
    }

    const content = row.content;
    const views = (row.views || 0) + 1;

    if (row.burn_after_read) {
      await env.DB.prepare('DELETE FROM pastes WHERE hash = ?').bind(hash).run();
    } else {
      await env.DB.prepare('UPDATE pastes SET views = ? WHERE hash = ?').bind(views, hash).run();
    }

    return new Response(JSON.stringify({
      status: 'ok',
      hash: hash,
      content: content,
      created_at: row.created_at,
      views: views,
      burned: Boolean(row.burn_after_read)
    }), {
      status: 200,
      headers: corsHeaders
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: corsHeaders
    });
  }
}

async function handleGetRaw(hash, env) {
  if (!env.DB) {
    return new Response('Database not configured\n', { status: 500, headers: { 'Content-Type': 'text/plain' } });
  }

  try {
    const row = await env.DB.prepare('SELECT * FROM pastes WHERE hash = ?').bind(hash).first();
    if (!row) {
      return new Response('404 Not Found: Paste does not exist or has expired.\n', {
        status: 404,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
      });
    }

    const now = new Date();
    if (row.expires_at && now > new Date(row.expires_at)) {
      await env.DB.prepare('DELETE FROM pastes WHERE hash = ?').bind(hash).run();
      return new Response('404 Not Found: Paste has expired.\n', {
        status: 404,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
      });
    }

    const content = row.content;
    const views = (row.views || 0) + 1;

    if (row.burn_after_read) {
      await env.DB.prepare('DELETE FROM pastes WHERE hash = ?').bind(hash).run();
    } else {
      await env.DB.prepare('UPDATE pastes SET views = ? WHERE hash = ?').bind(views, hash).run();
    }

    return new Response(content, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Access-Control-Allow-Origin': '*'
      }
    });

  } catch (err) {
    return new Response('Error: ' + err.message + '\n', { status: 500, headers: { 'Content-Type': 'text/plain' } });
  }
}
