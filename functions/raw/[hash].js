// Cloudflare Pages Function: GET /raw/[hash]
// Returns raw plain-text content (curl-friendly)

export async function onRequestGet(context) {
  const { params, env } = context;
  const hash = params.hash;

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
    return new Response('Error: ' + err.message + '\n', {
      status: 500,
      headers: { 'Content-Type': 'text/plain' }
    });
  }
}
