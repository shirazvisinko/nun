/* Frontend for AU Trade Mark Search. Talks to the app's own /api endpoints
 * (which proxy IP Australia), never to IP Australia directly, so the API
 * secret stays on the server. */

const form = document.getElementById('search-form');
const input = document.getElementById('search-input');
const searchBtn = document.getElementById('search-btn');
const categoryChips = document.getElementById('category-chips');
const statusChips = document.getElementById('status-chips');
const resultsEl = document.getElementById('results');
const resultsMeta = document.getElementById('results-meta');
const loadingEl = document.getElementById('loading');
const errorEl = document.getElementById('error');
const demoBanner = document.getElementById('demo-banner');

let categoryLabels = {};

init();

async function init() {
  try {
    const res = await fetch('/api/meta');
    const meta = await res.json();
    if (meta.mode === 'demo') demoBanner.classList.remove('hidden');

    for (const cat of meta.categories) {
      categoryLabels[cat.id] = cat.label;
      const label = document.createElement('label');
      label.className = 'chip';
      label.innerHTML =
        `<input type="checkbox" value="${cat.id}" checked />` +
        `<span>${escapeHtml(cat.label)}</span>`;
      categoryChips.appendChild(label);
    }
  } catch {
    showError('Could not load app configuration. Is the server running?');
  }
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  await runSearch();
});

async function runSearch() {
  const q = input.value.trim();
  if (!q) return;

  const categories = checkedValues(categoryChips);
  const statuses = checkedValues(statusChips);

  setLoading(true);
  clearError();
  resultsEl.innerHTML = '';
  resultsMeta.classList.add('hidden');

  try {
    const params = new URLSearchParams({
      q,
      categories: categories.join(','),
      statuses: statuses.join(','),
    });
    const res = await fetch(`/api/search?${params}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Search failed (${res.status})`);
    renderResults(data);
  } catch (err) {
    showError(err.message);
  } finally {
    setLoading(false);
  }
}

function renderResults(data) {
  resultsMeta.classList.remove('hidden');
  resultsMeta.textContent =
    data.count === 0
      ? `No matching trade marks for “${data.query}” in the selected focus areas` +
        ` (${data.scanned} scanned).`
      : `${data.count} matching trade mark${data.count === 1 ? '' : 's'}` +
        ` for “${data.query}” (${data.scanned} scanned, filtered to your focus areas).`;

  if (data.count === 0) {
    resultsEl.innerHTML =
      '<div class="empty">Nothing found. Try a broader term or enable more focus areas / statuses.</div>';
    return;
  }

  for (const mark of data.results) {
    resultsEl.appendChild(renderCard(mark));
  }
}

function renderCard(mark) {
  const card = document.createElement('article');
  card.className = 'card';

  const statusClass = ['registered', 'pending', 'removed'].includes(
    (mark.status || '').toLowerCase(),
  )
    ? mark.status.toLowerCase()
    : 'other';

  const categoryTags = (mark.categories || [])
    .map((c) => `<span class="tag">${escapeHtml(categoryLabels[c] || c)}</span>`)
    .join('');

  const classTags = [...new Set(mark.classes || [])]
    .sort((a, b) => a - b)
    .map((c) => `<span class="tag class-tag">Class ${c}</span>`)
    .join('');

  const gsItems = (mark.goodsServices || [])
    .slice(0, 4)
    .map(
      (gs) =>
        `<li><span class="cls">${
          Number.isFinite(gs.classNumber) ? `Cl. ${gs.classNumber}:` : ''
        }</span> ${escapeHtml(truncate(gs.description, 180))}</li>`,
    )
    .join('');

  const owners = (mark.owners || []).join(', ');
  const dates = [
    mark.lodgementDate && `Filed ${mark.lodgementDate}`,
    mark.registrationDate && `Registered ${mark.registrationDate}`,
  ]
    .filter(Boolean)
    .join(' · ');

  card.innerHTML = `
    <div class="card-top">
      <h2 class="mark-words">${escapeHtml(mark.words || '(no words recorded)')}</h2>
      <span class="mark-number">
        TM ${escapeHtml(mark.number)}
        <span class="status ${statusClass}">${escapeHtml(mark.status || 'Unknown')}</span>
      </span>
    </div>
    <div class="tags">${categoryTags}${classTags}</div>
    <ul class="gs-list">${gsItems}</ul>
    <div class="card-footer">
      <span>${escapeHtml(owners)}${owners && dates ? ' · ' : ''}${escapeHtml(dates)}</span>
      <a href="${encodeURI(mark.detailsUrl || '#')}" target="_blank" rel="noopener">
        View on IP Australia →
      </a>
    </div>`;
  return card;
}

function checkedValues(fieldset) {
  return [...fieldset.querySelectorAll('input:checked')].map((i) => i.value);
}

function setLoading(on) {
  loadingEl.classList.toggle('hidden', !on);
  searchBtn.disabled = on;
}

function showError(msg) {
  errorEl.textContent = msg;
  errorEl.classList.remove('hidden');
}

function clearError() {
  errorEl.classList.add('hidden');
}

function truncate(str, n) {
  const s = String(str || '');
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function escapeHtml(str) {
  return String(str ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
