/**
 * AU Trade Mark Search — a small web app over IP Australia's free
 * Australian Trade Mark Search API, restricted to tech, accounting,
 * small business and AI related trade marks.
 *
 * Runs in two modes:
 *  - LIVE: when IPA_CLIENT_ID / IPA_CLIENT_SECRET are set, searches the
 *    real API (free credentials from https://portal.api.ipaustralia.gov.au/).
 *  - DEMO: without credentials, searches a bundled sample dataset so the
 *    UI can be tried immediately.
 */

const fs = require('fs');
const path = require('path');

loadDotEnv(path.join(__dirname, '.env'));

const express = require('express');
const { CATEGORIES, ALL_CATEGORY_IDS, categoriseMark } = require('./lib/categories');
const ipa = require('./lib/ipaustralia');

const PORT = Number(process.env.PORT || 3000);
const MAX_DETAIL_LOOKUPS = Number(process.env.MAX_DETAIL_LOOKUPS || 60);
const DETAIL_CONCURRENCY = 6;

const SAMPLE_MARKS = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'data', 'sample-trademarks.json'), 'utf8'),
);

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/meta', (_req, res) => {
  res.json({
    mode: ipa.hasCredentials() ? 'live' : 'demo',
    categories: Object.values(CATEGORIES).map(({ id, label, niceClasses }) => ({
      id,
      label,
      niceClasses,
    })),
    statuses: ['REGISTERED', 'PENDING', 'REMOVED'],
  });
});

app.get('/api/search', async (req, res) => {
  const query = String(req.query.q || '').trim();
  if (!query) {
    return res.status(400).json({ error: 'Missing search term (q).' });
  }

  const requestedCats = String(req.query.categories || '')
    .split(',')
    .map((c) => c.trim())
    .filter((c) => ALL_CATEGORY_IDS.includes(c));
  const activeCats = requestedCats.length > 0 ? requestedCats : ALL_CATEGORY_IDS;

  const statuses = String(req.query.statuses || '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);

  try {
    const marks = ipa.hasCredentials()
      ? await liveSearch(query, statuses)
      : demoSearch(query, statuses);

    const results = marks
      .map((mark) => ({ ...mark, categories: categoriseMark(mark) }))
      .filter((mark) => mark.categories.some((c) => activeCats.includes(c)));

    res.json({
      mode: ipa.hasCredentials() ? 'live' : 'demo',
      query,
      activeCategories: activeCats,
      scanned: marks.length,
      count: results.length,
      results,
    });
  } catch (err) {
    console.error('Search failed:', err);
    res.status(502).json({
      error: 'Search failed. ' + (err.message || 'Unknown error'),
    });
  }
});

async function liveSearch(query, statuses) {
  const numbers = await ipa.quickSearch({ query, statuses });
  const toFetch = numbers.slice(0, MAX_DETAIL_LOOKUPS);

  const marks = [];
  for (let i = 0; i < toFetch.length; i += DETAIL_CONCURRENCY) {
    const batch = toFetch.slice(i, i + DETAIL_CONCURRENCY);
    const settled = await Promise.allSettled(batch.map((n) => ipa.getTradeMark(n)));
    for (const r of settled) {
      if (r.status === 'fulfilled' && r.value) marks.push(r.value);
    }
  }
  return marks;
}

function demoSearch(query, statuses) {
  const q = query.toLowerCase();
  return SAMPLE_MARKS.filter((mark) => {
    const text = [
      mark.words,
      mark.number,
      ...(mark.owners || []),
      ...(mark.goodsServices || []).map((gs) => gs.description),
    ]
      .join(' ')
      .toLowerCase();
    const textHit = q === '*' || text.includes(q);
    const statusHit =
      statuses.length === 0 || statuses.includes(mark.status.toUpperCase());
    return textHit && statusHit;
  });
}

/** Minimal .env loader so the app has no config dependencies. */
function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}

app.listen(PORT, () => {
  const mode = ipa.hasCredentials() ? 'LIVE (IP Australia API)' : 'DEMO (sample data)';
  console.log(`AU Trade Mark Search running on http://localhost:${PORT} — mode: ${mode}`);
  if (!ipa.hasCredentials()) {
    console.log(
      'Set IPA_CLIENT_ID and IPA_CLIENT_SECRET (see .env.example) to search real data.',
    );
  }
});
