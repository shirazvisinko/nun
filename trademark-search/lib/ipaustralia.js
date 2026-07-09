/**
 * Thin client for IP Australia's Australian Trade Mark Search API.
 *
 * Auth: OAuth 2.0 client-credentials grant against the External Token API.
 * Docs / registration (free): https://portal.api.ipaustralia.gov.au/
 *
 * Endpoints used:
 *   POST {base}/public/external-token-api/v1/access_token
 *   POST {base}/public/australian-trade-mark-search-api/v1/search/quick
 *   GET  {base}/public/australian-trade-mark-search-api/v1/trade-mark/{number}
 */

const BASE_URLS = {
  production: 'https://production.api.ipaustralia.gov.au',
  test: 'https://test.api.ipaustralia.gov.au',
};

const env = (process.env.IPA_ENV || 'production').toLowerCase();
const BASE_URL = process.env.IPA_BASE_URL || BASE_URLS[env] || BASE_URLS.production;
const TOKEN_URL = `${BASE_URL}/public/external-token-api/v1/access_token`;
const SEARCH_API = `${BASE_URL}/public/australian-trade-mark-search-api/v1`;

const CLIENT_ID = process.env.IPA_CLIENT_ID || '';
const CLIENT_SECRET = process.env.IPA_CLIENT_SECRET || '';

function hasCredentials() {
  return Boolean(CLIENT_ID && CLIENT_SECRET);
}

// ---------------------------------------------------------------------------
// OAuth token handling (cached until shortly before expiry)
// ---------------------------------------------------------------------------

let cachedToken = null; // { accessToken, tokenType, expiresAt }

async function getAccessToken() {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return cachedToken;
  }

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
  });

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(
      `Token request failed (${res.status}): ${text.slice(0, 300)}`,
    );
  }

  const data = await res.json();
  const expiresIn = Number(data.expires_in || 3600);
  cachedToken = {
    accessToken: data.access_token,
    tokenType: data.token_type || 'Bearer',
    expiresAt: Date.now() + expiresIn * 1000,
  };
  return cachedToken;
}

async function authedFetch(url, options = {}) {
  const token = await getAccessToken();
  const res = await fetch(url, {
    ...options,
    headers: {
      Accept: 'application/json',
      Authorization: `${token.tokenType} ${token.accessToken}`,
      ...(options.headers || {}),
    },
  });
  return res;
}

// ---------------------------------------------------------------------------
// Quick search: returns a list of trade mark numbers
// ---------------------------------------------------------------------------

async function quickSearch({ query, statuses }) {
  const payload = { query };
  const filters = {};
  if (Array.isArray(statuses) && statuses.length > 0) {
    filters.status = statuses;
  }
  if (Object.keys(filters).length > 0) payload.filters = filters;

  const res = await authedFetch(`${SEARCH_API}/search/quick`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(
      `Quick search failed (${res.status}): ${text.slice(0, 300)}`,
    );
  }

  const data = await res.json();
  return extractNumbers(data);
}

/** Pull trade mark numbers out of the response defensively — the API returns
 *  a list of numbers, but wrap shapes vary between versions. */
function extractNumbers(data) {
  const candidates =
    (Array.isArray(data) && data) ||
    data.results ||
    data.tradeMarks ||
    data.numbers ||
    data.items ||
    [];
  return candidates
    .map((item) => {
      if (typeof item === 'string' || typeof item === 'number') return String(item);
      return String(
        item.number || item.tradeMarkNumber || item.applicationNumber || '',
      );
    })
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// Trade mark details (with a small in-memory cache)
// ---------------------------------------------------------------------------

const detailCache = new Map(); // number -> { at, mark }
const DETAIL_CACHE_TTL = 1000 * 60 * 60; // 1 hour
const DETAIL_CACHE_MAX = 2000;

async function getTradeMark(number) {
  const cached = detailCache.get(number);
  if (cached && Date.now() - cached.at < DETAIL_CACHE_TTL) return cached.mark;

  const res = await authedFetch(
    `${SEARCH_API}/trade-mark/${encodeURIComponent(number)}`,
  );
  if (!res.ok) {
    if (res.status === 404) return null;
    const text = await res.text().catch(() => '');
    throw new Error(
      `Trade mark ${number} lookup failed (${res.status}): ${text.slice(0, 300)}`,
    );
  }

  const raw = await res.json();
  const mark = normaliseMark(raw, number);

  if (detailCache.size >= DETAIL_CACHE_MAX) {
    // Drop the oldest entry to bound memory.
    const oldestKey = detailCache.keys().next().value;
    detailCache.delete(oldestKey);
  }
  detailCache.set(number, { at: Date.now(), mark });
  return mark;
}

/** Map the (deeply nested) API response to the flat shape the UI uses.
 *  Field names are probed defensively because the public schema has changed
 *  between minor versions. */
function normaliseMark(raw, number) {
  const tm = raw.tradeMark || raw.trademark || raw;

  const words =
    tm.words ||
    tm.wordText ||
    tm.name ||
    (Array.isArray(tm.representations)
      ? tm.representations.map((r) => r.words || r.text).filter(Boolean).join(' ')
      : '') ||
    '';

  const goodsServicesRaw =
    tm.goodsAndServices || tm.goodsServices || tm.classes || [];
  const goodsServices = (Array.isArray(goodsServicesRaw) ? goodsServicesRaw : [])
    .map((gs) => ({
      classNumber: Number(gs.classNumber ?? gs.class ?? gs.number ?? NaN),
      description: String(gs.description ?? gs.goodsServicesDescription ?? gs.text ?? ''),
    }))
    .filter((gs) => !Number.isNaN(gs.classNumber) || gs.description);

  const owners = []
    .concat(tm.owners || tm.applicants || tm.owner || [])
    .map((o) => (typeof o === 'string' ? o : o.name || o.fullName || ''))
    .filter(Boolean);

  return {
    number: String(tm.number || tm.tradeMarkNumber || number),
    words: String(words),
    status: String(tm.status || tm.tradeMarkStatus || ''),
    kind: String(tm.kind || tm.type || tm.tradeMarkType || ''),
    classes: goodsServices
      .map((gs) => gs.classNumber)
      .filter((n) => !Number.isNaN(n)),
    goodsServices,
    owners,
    lodgementDate: String(tm.lodgementDate || tm.applicationDate || tm.filingDate || ''),
    registrationDate: String(tm.registrationDate || ''),
    detailsUrl: `https://search.ipaustralia.gov.au/trademarks/search/view/${encodeURIComponent(
      String(tm.number || tm.tradeMarkNumber || number),
    )}`,
  };
}

module.exports = { hasCredentials, quickSearch, getTradeMark, BASE_URL };
