// Cloudflare Pages Function: GET /pastebin/[hash]
// SPA routing: Serves index.html so the browser client (app.js) loads the paste seamlessly

export async function onRequestGet(context) {
  const { request, env } = context;
  // Serve the main index.html asset while preserving the URL path
  const url = new URL(request.url);
  return env.ASSETS.fetch(new URL('/', url.origin));
}
