/* الرئيسية: بحث فوري + زر المزيد. كل شي عبر /api، بدون أي مكتبة. */

const results = document.getElementById('results');
const input = document.getElementById('q');
const moreBtn = document.getElementById('more');

let page = results?.querySelector('.grid') ? 2 : 1;
let kind = results?.dataset.kind || 'trending';
let query = results?.dataset.query || '';
let loading = false;
let exhausted = false;
let controller = null;
let timer = null;

const IMG = 'https://image.tmdb.org/t/p/w342';
const DEBOUNCE_MS = 300;
const SKELETON_CARDS = 6;

if (input && query && !input.value) input.value = query;

function span(className, text) {
  const el = document.createElement('span');
  el.className = className;
  el.textContent = text;
  return el;
}

function card(item) {
  const a = document.createElement('a');
  a.className = 'card';
  a.href = `/watch/${item.type === 'tv' ? 'tv' : 'movie'}/${encodeURIComponent(item.tmdb_id || item.imdb_id || '')}`;

  const art = document.createElement('div');
  art.className = 'art';
  if (item.poster) {
    const img = document.createElement('img');
    img.loading = 'lazy';
    img.decoding = 'async';
    img.src = item.poster.startsWith('http') ? item.poster : `${IMG}${item.poster}`;
    img.alt = item.title ?? '';
    img.width = 342;
    img.height = 513;
    art.append(img);
  } else {
    const ph = document.createElement('div');
    ph.className = 'ph';
    ph.setAttribute('aria-hidden', 'true');
    ph.textContent = String(item.title ?? '?').slice(0, 1);
    art.append(ph);
  }
  if (item.netflix) {
    const badge = document.createElement('span');
    badge.className = 'badge nf';
    badge.textContent = 'NETFLIX';
    art.append(badge);
  }

  const meta = document.createElement('div');
  meta.className = 'meta';
  const h3 = document.createElement('h3');
  h3.textContent = item.title ?? '';
  h3.title = item.title ?? '';
  const p = document.createElement('p');
  if (item.year) p.append(span('year', String(item.year)));
  if (item.rating) p.append(span('rate', `★ ${Number(item.rating).toFixed(1)}`));
  p.append(span('kind', item.type === 'tv' ? 'مسلسل' : 'فيلم'));

  meta.append(h3, p);
  a.append(art, meta);
  return a;
}

function createGrid() {
  const div = document.createElement('div');
  div.className = 'grid';
  return div;
}

function emptyState(text) {
  const empty = document.createElement('p');
  empty.className = 'empty';
  empty.textContent = text;
  return empty;
}

function skeletonGrid() {
  const grid = createGrid();
  grid.className = 'grid is-skeleton';
  grid.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < SKELETON_CARDS; i += 1) {
    const sk = document.createElement('div');
    sk.className = 'card sk-card';
    const art = document.createElement('div');
    art.className = 'art sk-art';
    const meta = document.createElement('div');
    meta.className = 'meta sk-meta';
    sk.append(art, meta);
    grid.append(sk);
  }
  return grid;
}

function showSkeleton() {
  if (!results) return;
  results.replaceChildren(skeletonGrid());
  results.setAttribute('aria-busy', 'true');
}

function render(items, { append = false } = {}) {
  if (!results) return;

  if (!append) results.replaceChildren();

  if (!items.length) {
    if (!append) {
      const msg = query
        ? `ما فيه نتائج عن «${query}». جرّب الاسم الإنجليزي أو عبارة أقصر.`
        : 'ما فيه نتائج. جرّب تصنيف ثاني.';
      results.append(emptyState(msg));
    }
    return;
  }

  let grid = append ? results.querySelector('.grid') : null;
  if (!grid) {
    grid = createGrid();
    results.append(grid);
  }

  const fragment = document.createDocumentFragment();
  for (const item of items) fragment.append(card(item));
  grid.append(fragment);
}

async function fetchPage({ append = false } = {}) {
  if (!results) {
    // صفحة المشاهدة ما عندها شبكة نتائج — البحث يروح للرئيسية.
    if (query) location.href = `/?q=${encodeURIComponent(query)}`;
    return;
  }
  if (loading && append) return;
  if (exhausted && append) return;

  controller?.abort();
  controller = new AbortController();
  const { signal } = controller;

  loading = true;
  moreBtn?.setAttribute('disabled', '');
  if (!append) showSkeleton();

  try {
    const url = query
      ? `/api/search?q=${encodeURIComponent(query)}&page=${page}`
      : `/api/browse?kind=${encodeURIComponent(kind)}&page=${page}`;
    const res = await fetch(url, { signal, headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (signal.aborted) return;
    const items = Array.isArray(data.items) ? data.items : [];
    render(items, { append });
    if (items.length === 0) exhausted = true;
    page += 1;
  } catch (err) {
    if (err?.name === 'AbortError' || signal.aborted) return;
    if (!append) results.replaceChildren(emptyState('تعذّر التحميل. أعد المحاولة.'));
  } finally {
    loading = false;
    moreBtn?.removeAttribute('disabled');
    if (exhausted) moreBtn?.setAttribute('disabled', '');
    if (!signal.aborted) results?.removeAttribute('aria-busy');
  }
}

function runSearch() {
  const value = input.value.trim();
  if (value === query) return;
  query = value;
  page = 1;
  exhausted = false;
  if (!value) kind = 'trending';
  fetchPage();
  history.replaceState(null, '', value ? `/?q=${encodeURIComponent(value)}` : '/');
}

input?.addEventListener('input', () => {
  clearTimeout(timer);
  timer = setTimeout(runSearch, DEBOUNCE_MS);
});

input?.closest('form')?.addEventListener('submit', (event) => {
  event.preventDefault();
  clearTimeout(timer);
  runSearch();
});

moreBtn?.addEventListener('click', () => fetchPage({ append: true }));
