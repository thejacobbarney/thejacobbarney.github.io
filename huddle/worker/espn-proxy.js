// Huddle's ESPN proxy — a Cloudflare Worker.
//
// Why this exists: ESPN's Fantasy API doesn't send CORS headers for
// third-party origins, so a browser fetch straight from thejacobbarney.com
// gets blocked before it reaches ESPN. This Worker runs server-side (no
// browser, no CORS enforcement on its outbound request), forwards the
// request to ESPN with whatever cookies the caller passed in, and returns
// the JSON with CORS headers that DO allow your site.
//
// This Worker holds no secrets and stores nothing — every request carries
// its own league ID / year / cookies as query params, passed straight
// through to ESPN and forgotten. Deploy steps are in ../ARCHITECTURE.md.

const ALLOWED_ORIGINS = new Set([
  'https://thejacobbarney.com',
  'https://thejacobbarney.github.io',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
]);

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.has(origin) ? origin : '';
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
  };
}

export default {
  async fetch(request) {
    const origin = request.headers.get('Origin') || '';
    const headers = corsHeaders(origin);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers });
    }
    if (request.method !== 'GET') {
      return new Response('Method not allowed', { status: 405, headers });
    }
    if (!headers['Access-Control-Allow-Origin']) {
      return new Response('Origin not allowed', { status: 403, headers });
    }

    const url = new URL(request.url);
    const leagueId = url.searchParams.get('leagueId');
    const year = url.searchParams.get('year');
    if (!leagueId || !year || !/^\d+$/.test(leagueId) || !/^\d{4}$/.test(year)) {
      return new Response('Missing or invalid leagueId/year', { status: 400, headers });
    }

    const espnUrl = new URL(
      `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${year}/segments/0/leagues/${leagueId}`
    );
    const scoringPeriodId = url.searchParams.get('scoringPeriodId');
    if (scoringPeriodId) espnUrl.searchParams.set('scoringPeriodId', scoringPeriodId);

    const swid = url.searchParams.get('swid');
    const espnS2 = url.searchParams.get('espn_s2');
    const espnHeaders = { Accept: 'application/json' };
    if (swid && espnS2) {
      espnHeaders.Cookie = `SWID=${swid}; espn_s2=${espnS2}`;
    }

    // Free-agent/waiver-wire lookups use a different ESPN view that requires
    // a special header instead of the usual view=... query params — the
    // "player pool" endpoint, not the roster endpoint.
    if (url.searchParams.get('players') === 'freeagents') {
      espnUrl.searchParams.append('view', 'kona_player_info');
      espnHeaders['X-Fantasy-Filter'] = JSON.stringify({
        players: {
          filterStatus: { value: ['FREEAGENT', 'WAIVERS'] },
          filterSlotIds: { value: [0, 2, 4, 6, 16, 17, 23] },
          limit: 200,
          sortPercOwned: { sortPriority: 1, sortAsc: false },
        },
      });
    } else {
      for (const view of url.searchParams.getAll('view')) {
        espnUrl.searchParams.append('view', view);
      }
    }

    let espnRes;
    try {
      espnRes = await fetch(espnUrl.toString(), { headers: espnHeaders });
    } catch (err) {
      return new Response(`Couldn't reach ESPN: ${err.message}`, { status: 502, headers });
    }

    const body = await espnRes.text();
    return new Response(body, {
      status: espnRes.status,
      headers: { ...headers, 'Content-Type': 'application/json' },
    });
  },
};
