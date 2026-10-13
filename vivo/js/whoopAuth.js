/**
 * Browser-side half of the Whoop OAuth connection. The relay Worker (see
 * /whoop-relay) holds the client secret and does the actual token exchange;
 * everything here — generating the authorize URL, verifying CSRF state,
 * storing tokens, refreshing them — runs in the browser and touches nothing
 * but localStorage, same as aiConfig.js's pattern for the Anthropic key.
 *
 * Whoop's access tokens are short-lived and its refresh tokens ROTATE (each
 * refresh invalidates the previous one and returns a new one), so the stored
 * refresh_token MUST be overwritten on every refresh or the connection is
 * silently lost the next time it's needed.
 */

// Public by OAuth2 design — a client_id is meant to appear in browser code
// and redirect URLs, unlike the client_secret (which never leaves the relay
// Worker). This is Vivo's own registered Whoop app.
const CLIENT_ID = 'c790f331-06ba-4cb0-b179-90540cdcdb0d';

// Set this to the deployed Worker's URL (see whoop-relay/README.md) before
// "Connect Whoop" will work — it's intentionally not guessed at here.
export const RELAY_BASE_URL = 'https://vivo-whoop-relay.YOUR-SUBDOMAIN.workers.dev';

const AUTHORIZE_URL = 'https://api.prod.whoop.com/oauth/oauth2/auth';
const REDIRECT_URI = 'https://thejacobbarney.com/vivo/oauth-callback.html';
const SCOPES = ['read:cycles', 'read:recovery', 'read:sleep', 'read:workout', 'read:profile', 'read:body_measurement', 'offline'];

const TOKEN_KEY = 'vivo:whoop-auth:v1';
const STATE_KEY = 'vivo:whoop-oauth-state';

// Refresh this many seconds before actual expiry, so a request never races a
// token that's valid when checked but expired by the time it reaches Whoop.
const REFRESH_SKEW_SECONDS = 60;

function randomState() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `state-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function isRelayConfigured() {
  return !RELAY_BASE_URL.includes('YOUR-SUBDOMAIN');
}

/** Redirects the browser to Whoop's consent screen. Call from a click handler. */
export function startConnect() {
  const state = randomState();
  sessionStorage.setItem(STATE_KEY, state);
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', CLIENT_ID);
  url.searchParams.set('redirect_uri', REDIRECT_URI);
  url.searchParams.set('scope', SCOPES.join(' '));
  url.searchParams.set('state', state);
  window.location.href = url.toString();
}

/**
 * Called from oauth-callback.html after Whoop redirects back with ?code&state.
 * Verifies the CSRF state, exchanges the code via the relay Worker, and
 * stores the resulting tokens. Throws on any failure — the callback page is
 * responsible for showing that to the user.
 */
export async function completeConnect(searchParams) {
  const returnedState = searchParams.get('state');
  const expectedState = sessionStorage.getItem(STATE_KEY);
  sessionStorage.removeItem(STATE_KEY);

  const whoopError = searchParams.get('error');
  if (whoopError) {
    throw new Error(`Whoop declined the connection: ${whoopError}`);
  }
  if (!returnedState || returnedState !== expectedState) {
    throw new Error('State mismatch — this login attempt may not have originated from this browser. Try connecting again.');
  }
  const code = searchParams.get('code');
  if (!code) {
    throw new Error('No authorization code returned by Whoop.');
  }
  if (!isRelayConfigured()) {
    throw new Error('RELAY_BASE_URL is not configured in whoopAuth.js yet — deploy the relay Worker first (see whoop-relay/README.md).');
  }

  const response = await fetch(`${RELAY_BASE_URL}/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, redirect_uri: REDIRECT_URI }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.whoop?.error_description || data?.error || `Token exchange failed (HTTP ${response.status}).`);
  }
  saveTokens(data);
}

function saveTokens(tokenResponse) {
  const record = {
    accessToken: tokenResponse.access_token,
    refreshToken: tokenResponse.refresh_token,
    expiresAt: Date.now() + (tokenResponse.expires_in ?? 3600) * 1000,
  };
  localStorage.setItem(TOKEN_KEY, JSON.stringify(record));
}

function loadTokens() {
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function isConnected() {
  return !!loadTokens()?.refreshToken;
}

export function disconnect() {
  localStorage.removeItem(TOKEN_KEY);
}

async function refreshTokens(refreshToken) {
  const response = await fetch(`${RELAY_BASE_URL}/refresh`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    // A failed refresh means the connection is no longer usable — clear it
    // rather than leave a stale, silently-broken "connected" state.
    disconnect();
    throw new Error(data?.whoop?.error_description || data?.error || `Refreshing the Whoop connection failed (HTTP ${response.status}).`);
  }
  saveTokens(data);
  return data.access_token;
}

/**
 * Returns a currently-valid access token, transparently refreshing first if
 * the stored one is expired or about to be. Throws if there's no connection
 * or the refresh itself fails (in which case the connection has been cleared
 * — callers should fall back to prompting "Connect Whoop" again).
 */
export async function getValidAccessToken() {
  const tokens = loadTokens();
  if (!tokens) {
    throw new Error('Whoop is not connected.');
  }
  const expiringSoon = Date.now() > tokens.expiresAt - REFRESH_SKEW_SECONDS * 1000;
  if (!expiringSoon) {
    return tokens.accessToken;
  }
  return refreshTokens(tokens.refreshToken);
}
