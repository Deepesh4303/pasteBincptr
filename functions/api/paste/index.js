// Cloudflare Pages Function: POST /api/paste
// Handles creating a new paste in Cloudflare D1 SQLite database

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

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  // Verify D1 binding is configured
  if (!env.DB) {
    return new Response(JSON.stringify({
      error: 'Database binding (DB) not configured in Cloudflare Pages. Please bind your D1 database.'
    }), {
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

    if (content.length > 5 * 1024 * 1024) { // 5MB limit
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

      // Check if custom slug already exists
      const existing = await env.DB.prepare('SELECT hash FROM pastes WHERE hash = ?').bind(safeSlug).first();
      if (existing) {
        return new Response(JSON.stringify({ error: 'Custom slug already taken' }), {
          status: 409,
          headers: corsHeaders
        });
      }
      finalHash = safeSlug;
    } else {
      // Generate random unique hash
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

    // Expiration calculation
    const now = new Date();
    let expiresAt = null;
    const isBurn = expiration === 'burn' ? 1 : 0;

    if (expiration === '1h') expiresAt = new Date(now.getTime() + 3600 * 1000).toISOString();
    else if (expiration === '1d') expiresAt = new Date(now.getTime() + 86400 * 1000).toISOString();
    else if (expiration === '7d') expiresAt = new Date(now.getTime() + 7 * 86400 * 1000).toISOString();

    // Insert into Cloudflare D1 SQLite
    await env.DB.prepare(`
      INSERT INTO pastes (hash, content, created_at, expires_at, burn_after_read, views)
      VALUES (?, ?, ?, ?, ?, 0)
    `).bind(finalHash, content, now.toISOString(), expiresAt, isBurn).run();

    // Determine domain (use incoming request host or canonical cptr.in)
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
    return new Response(JSON.stringify({ error: err.message || 'Invalid request' }), {
      status: 500,
      headers: corsHeaders
    });
  }
}
