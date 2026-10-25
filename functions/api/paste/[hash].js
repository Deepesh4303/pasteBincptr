// Cloudflare Pages Function: GET /api/paste/[hash]
// Retrieves a paste from Cloudflare D1 SQLite database

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

export async function onRequestGet(context) {
  const { params, env } = context;
  const hash = params.hash;

  if (!env.DB) {
    return new Response(JSON.stringify({ error: 'Database binding (DB) not configured' }), {
      status: 500,
      headers: corsHeaders
    });
  }

  if (!hash) {
    return new Response(JSON.stringify({ error: 'Missing paste hash' }), {
      status: 400,
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

    // Check expiration
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

    // Handle burn-after-read
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
