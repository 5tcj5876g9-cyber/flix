import { config } from './config.js';
import { frameHosts } from './sources.js';

const esc = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

const IMG = config.tmdbImageBase;

export function posterUrl(path, size = 'w342') {
  if (!path) return null;
  if (/^https:\/\//.test(path)) return path;
  return `${IMG}/${size}${path}`;
}

export function itemKey(item) {
  return item.tmdb_id ? String(item.tmdb_id) : String(item.imdb_id ?? '');
}

function posterBlock(item, size = 'w342') {
  const url = posterUrl(item.poster, size);
  if (!url) {
    return `<div class="ph" aria-hidden="true">${esc((item.title ?? '?').slice(0, 1))}</div>`;
  }
  return `<img loading="lazy" decoding="async" src="${esc(url)}" alt="${esc(item.title)}" width="342" height="513">`;
}

export function layout({ title, body, page = '' }) {
  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0a0a0c">
<meta name="robots" content="noindex, nofollow">
<title>${esc(title)}</title>
<link rel="stylesheet" href="/style.css">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🎬</text></svg>">
</head>
<body data-page="${esc(page)}">
<header class="top">
  <a class="brand" href="/">سينما<span>·</span>نا</a>
  <form class="search" role="search" action="/" method="get">
    <input id="q" name="q" type="search" placeholder="ابحث عن فيلم أو مسلسل…" autocomplete="off" spellcheck="false" enterkeyhint="search" aria-label="بحث">
    <button type="submit" aria-label="ابحث">بحث</button>
  </form>
  <nav class="chips" aria-label="تصفح">
    <a href="/?kind=trending">رائج</a>
    <a href="/?kind=netflix" class="nf">نتفلكس</a>
    <a href="/?kind=korean">كوري</a>
    <a href="/?kind=asian">آسيوي</a>
    <a href="/?kind=top_rated">الأفضل</a>
    <a href="/?kind=tv_popular">مسلسلات</a>
  </nav>
</header>
<main id="main">${body}</main>
<footer class="foot">
  <span>سينمانا — كتالوج بحث. البث من سيرفرات خارجية.</span>
</footer>
<script src="/app.js" type="module"></script>
</body>
</html>`;
}

export function cardHtml(item) {
  const year = item.year ? `<span class="year">${item.year}</span>` : '';
  const rating = item.rating ? `<span class="rate">★ ${Number(item.rating).toFixed(1)}</span>` : '';
  const type = item.type === 'tv' ? 'مسلسل' : 'فيلم';
  const nf = item.netflix ? `<span class="badge nf">NETFLIX</span>` : '';
  return `<a class="card" href="/watch/${esc(item.type)}/${esc(itemKey(item))}" data-type="${esc(item.type)}" data-id="${esc(itemKey(item))}">
  <div class="art">${posterBlock(item)}${nf}</div>
  <div class="meta">
    <h3 title="${esc(item.title)}">${esc(item.title)}</h3>
    <p>${year} ${rating} <span class="kind">${type}</span></p>
  </div>
</a>`;
}

export function gridHtml(items, { empty = 'ما فيه نتائج.' } = {}) {
  if (!items || items.length === 0) return `<p class="empty">${esc(empty)}</p>`;
  return `<div class="grid">${items.map(cardHtml).join('')}</div>`;
}

export function homeHtml({ items, kind, query, page }) {
  const heading = query
    ? `نتائج: ${esc(query)}`
    : { netflix: 'على نتفلكس', korean: 'أفلام ومسلسلات كورية', asian: 'آسيوي', top_rated: 'الأعلى تقييماً', tv_popular: 'مسلسلات', trending: 'الرائج الآن' }[kind] ?? 'الأحدث';

  return layout({
    title: `${query ? query + ' — ' : ''}سينمانا`,
    page: 'home',
    body: `
<section class="hero">
  <h1>${heading}</h1>
  <p class="sub">${query ? 'اضغط على أي عنوان للمشاهدة أو التحميل.' : 'كل الأفلام والمسلسلات — كوري، آسيوي، نتفلكس، والعالم كله.'}</p>
</section>
<section id="results" data-kind="${esc(kind ?? '')}" data-query="${esc(query ?? '')}" data-page="${Number(page) || 1}">
  ${gridHtml(items)}
</section>
<div class="more"><button id="more" type="button">المزيد</button></div>
`,
  });
}

export function watchHtml({ item, servers, downloads, subtitleNote }) {
  const title = `${item.title}${item.year ? ` (${item.year})` : ''}`;
  const back = item.type === 'tv' ? 'مسلسل' : 'فيلم';
  const overview = item.overview ? `<p class="overview">${esc(item.overview)}</p>` : '';
  const meta = [item.year, item.rating ? `★ ${Number(item.rating).toFixed(1)}` : null, item.runtime ? `${item.runtime} د` : null, item.countries, back]
    .filter(Boolean)
    .join(' · ');

  const serverButtons = servers
    .map(
      (server, index) =>
        `<button class="srv${server.ok ? '' : ' dim'}${index === 0 && server.ok ? ' active' : ''}" type="button"
          data-url="${esc(server.url)}" data-label="${esc(server.label)}" data-ok="${server.ok ? '1' : '0'}">
          ${esc(server.label)}${server.ok ? '' : ' <span class="warn">؟</span>'}
        </button>`,
    )
    .join('');

  const first = servers.find((s) => s.ok) ?? servers[0];

  const dl = downloads.length
    ? downloads
        .map(
          (d) => `<li>
        <span class="dl-name">${esc(d.name)}</span>
        <span class="dl-meta">${(d.size / 1024 ** 3).toFixed(2)} GB · 🌱 ${d.seeders}</span>
        <a class="dl-go" href="${esc(d.magnet)}" rel="noreferrer nofollow">تحميل</a>
      </li>`,
        )
        .join('')
    : '<li class="dl-empty">ما لقيت روابط تحميل لهذا العنوان.</li>';

  return layout({
    title: `${title} — سينمانا`,
    page: 'watch',
    body: `
<article class="watch" data-type="${esc(item.type)}" data-id="${esc(itemKey(item))}" data-season="1" data-episode="1"
  data-first-url="${esc(first?.url ?? '')}" data-first-label="${esc(first?.label ?? '')}" data-first-ok="${first?.ok ? '1' : '0'}">
  <div class="player">
    <div class="stage" id="stage">
      ${posterBlock(item, 'w780')}
      <button class="play" id="play" type="button" aria-label="تشغيل">▶</button>
      <span class="hint" id="hint">اختر سيرفر ثم اضغط تشغيل</span>
    </div>
    <div class="servers" id="servers" role="group" aria-label="سيرفرات البث">${serverButtons}</div>
    <p class="src-note">إذا سيرفر ما اشتغل، جرّب اللي بعده. السيرفرات خارجية وما نستضيف أي ملف.</p>
  </div>

  <div class="info">
    <h1>${esc(title)}</h1>
    <p class="meta">${esc(meta)}</p>
    ${overview}
    <p class="sub-note">${esc(subtitleNote)}</p>

    <h2>تحميل</h2>
    <ul class="dl" id="downloads">${dl}</ul>

    <h2>مصادر البث</h2>
    <ul class="links" id="links">
      ${servers.map((s) => `<li><a href="${esc(s.url)}" target="_blank" rel="noreferrer nofollow">${esc(s.label)} <span class="ext">↗</span></a></li>`).join('')}
    </ul>
  </div>
</article>
<script src="/watch.js" type="module"></script>
`,
  });
}

export function errorHtml(code, message) {
  return layout({
    title: `${code} — سينمانا`,
    page: 'error',
    body: `<section class="hero"><h1>${code}</h1><p class="sub">${esc(message)}</p><p><a href="/">رجوع للرئيسية</a></p></section>`,
  });
}

export { frameHosts };
