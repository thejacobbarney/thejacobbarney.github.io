/**
 * Pulse — Whoop OAuth relay (Cloudflare Worker)
 *
 * The ONE thing Pulse's otherwise fully client-side architecture cannot do in
 * the browser: Whoop's OAuth2 token endpoint requires `client_secret_post`
 * authentication (client_id + client_secret together), and a secret embedded
 * in client-side JS on a public static site is not a secret. This Worker is
 * the smallest possible server-side footprint to hold that one value.
 *
 * It is intentionally stateless — no database, no KV, no user accounts. Three
 * jobs, each a thin, logging-light passthrough to Whoop's own API:
 *
 *   POST /token    { code, redirect_uri }   -> Whoop's authorization-code exchange
 *   POST /refresh  { refresh_token }        -> Whoop's refresh-token exchange
 *   ANY  /proxy/*                            -> forwarded to WHOOP_API_BASE + remainder,
 *                                               with the caller's Authorization header
 *                                               passed through unchanged
 *
 * The browser (pulse/js/whoopAuth.js, pulse/js/parsers/whoopApi.js) is the only
 * place access/refresh tokens are stored (localStorage) — this Worker never
 * sees them again after handing them back, and never writes anything to disk
 * or a database. See pulse/ARCHITECTURE.md for the full data-flow writeup.
 *
 * Required secrets (set via `wrangler secret put <name>` or the dashboard —
 * never commit these):
 *   WHOOP_CLIENT_ID
 *   WHOOP_CLIENT_SECRET
 *
 * Required config (wrangler.toml [vars], not secret — these are not sensitive):
 *   ALLOWED_ORIGIN    e.g. "https://thejacobbarney.com"
 *   WHOOP_API_BASE    e.g. "https://api.prod.whoop.com/developer/v2"
 */

const WHOOP_TOKEN_URL = 'https://api.prod.whoop.com/oauth/oauth2/token';

function corsHeaders(env) {
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };
}

function json(data, status, env) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', ...corsHeaders(env) },
  });
}

async function exchangeToken(env, params) {
  const body = new URLSearchParams({
    client_id: env.WHOOP_CLIENT_ID,
    client_secret: env.WHOOP_CLIENT_SECRET,
    ...params,
  });
  const response = await fetch(WHOOP_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = await response.json().catch(() => null);
  return { ok: response.ok, status: response.status, data };
}

async function handleToken(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid_request', message: 'Body must be JSON.' }, 400, env);
  }
  const { code, redirect_uri: redirectUri } = body || {};
  if (!code || !redirectUri) {
    return json({ error: 'invalid_request', message: 'code and redirect_uri are required.' }, 400, env);
  }

  const result = await exchangeToken(env, {
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
  });
  if (!result.ok) {
    return json({ error: 'token_exchange_failed', whoop: result.data }, 502, env);
  }
  return json(result.data, 200, env);
}

async function handleRefresh(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid_request', message: 'Body must be JSON.' }, 400, env);
  }
  const { refresh_token: refreshToken } = body || {};
  if (!refreshToken) {
    return json({ error: 'invalid_request', message: 'refresh_token is required.' }, 400, env);
  }

  const result = await exchangeToken(env, {
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    // Whoop requires `offline` to keep receiving a refresh_token on each rotation.
    scope: 'offline',
  });
  if (!result.ok) {
    return json({ error: 'token_refresh_failed', whoop: result.data }, 502, env);
  }
  return json(result.data, 200, env);
}

/**
 * Forwards GET requests under /proxy/<rest> to `${WHOOP_API_BASE}/<rest>` with
 * the caller's own Authorization header. This Worker never generates or
 * stores that header — it only relays whatever the browser already holds, so
 * it carries no more trust than the browser already has. Proxying (rather
 * than letting the browser call Whoop directly) sidesteps relying on Whoop's
 * API enabling CORS for arbitrary origins, which isn't documented either way.
 */
async function handleProxy(request, env, pathname) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader) {
    return json({ error: 'missing_authorization' }, 401, env);
  }
  const rest = pathname.replace(/^\/proxy/, '');
  const target = `${env.WHOOP_API_BASE}${rest}${new URL(request.url).search}`;

  const upstream = await fetch(target, {
    method: 'GET',
    headers: { authorization: authHeader, accept: 'application/json' },
  });
  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    headers: { 'content-type': upstream.headers.get('content-type') || 'application/json', ...corsHeaders(env) },
  });
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(env) });
    }

    const { pathname } = new URL(request.url);

    if (request.method === 'POST' && pathname === '/token') {
      return handleToken(request, env);
    }
    if (request.method === 'POST' && pathname === '/refresh') {
      return handleRefresh(request, env);
    }
    if (request.method === 'GET' && pathname.startsWith('/proxy/')) {
      return handleProxy(request, env, pathname);
    }

    return json({ error: 'not_found' }, 404, env);
  },
};
