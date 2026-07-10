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
  const days = Math.min(Number(req.query.days) || 0, 3660);
  if (!query && !days) {
    return res
      .status(400)
      .json({ error: 'Enter a search term, or pick a time period to browse recent trade marks.' });
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

  const cutoff = days ? isoDaysAgo(days) : null;

  try {
    const marks = ipa.hasCredentials()
      ? await liveSearch(query, statuses, cutoff)
      : demoSearch(query);

    let results = marks
      .filter((mark) => matchesStatuses(mark, statuses))
      .filter((mark) => matchesCutoff(mark, cutoff))
      .map((mark) => ({ ...mark, categories: categoriseMark(mark) }))
      .filter((mark) => mark.categories.some((c) => activeCats.includes(c)));

    if (cutoff) {
      results = results.sort((a, b) =>
        relevantDate(b).localeCompare(relevantDate(a)),
      );
    }

    console.log(
      `Search "${query || '(recent only)'}"${cutoff ? ` since ${cutoff}` : ''}: ` +
        `${marks.length} scanned, ${results.length} after filters`,
    );

    res.json({
      mode: ipa.hasCredentials() ? 'live' : 'demo',
      query,
      since: cutoff,
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

async function liveSearch(query, statuses, changedSinceDate) {
  const numbers = await ipa.quickSearch({ query, statuses, changedSinceDate });
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

function demoSearch(query) {
  const q = query.toLowerCase();
  if (!q || q === '*') return [...SAMPLE_MARKS];
  return SAMPLE_MARKS.filter((mark) => {
    const text = [
      mark.words,
      mark.number,
      ...(mark.owners || []),
      ...(mark.goodsServices || []).map((gs) => gs.description),
    ]
      .join(' ')
      .toLowerCase();
    return text.includes(q);
  });
}

/** Status filter applied from the detail records (works even when the quick
 *  search API rejected our status filter). Uses a loose "contains" match so
 *  e.g. "Registered: Registered/protected" still counts as REGISTERED. */
function matchesStatuses(mark, statuses) {
  if (statuses.length === 0) return true;
  const s = String(mark.status || '').toUpperCase();
  return statuses.some((wanted) => s.includes(wanted));
}

/** Keep marks whose registration date (or, failing that, filing date) falls
 *  on/after the cutoff. Dates compare as ISO strings (YYYY-MM-DD). */
function matchesCutoff(mark, cutoff) {
  if (!cutoff) return true;
  const date = relevantDate(mark);
  return Boolean(date) && date.slice(0, 10) >= cutoff;
}

function relevantDate(mark) {
  return String(mark.registrationDate || mark.lodgementDate || '');
}

function isoDaysAgo(days) {
  const d = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
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
