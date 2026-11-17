/* صفحة المشاهدة: مشغّل + سيرفرات + مواسم/حلقات + حالة تحميل. بدون مكتبات. */

const watch = document.querySelector('.watch');
const stage = document.getElementById('stage');
const playBtn = document.getElementById('play');
const hint = document.getElementById('hint');
const serverBox = document.getElementById('servers');
const linksBox = document.getElementById('links');

if (watch && stage) {
  const MAX_SEASON = 20;
  const MAX_EPISODE = 30;
  const LOAD_WARN_MS = 9000;
  const PLAYED_WARN_MS = 7000;

  const clampInt = (value, min, max, fallback) => {
    const n = Number.parseInt(value, 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(Math.max(n, min), max);
  };

  // النطاقات المسموحة تُبنى من السيرفرات المعروضة وتُحدَّث مع كل جلبة.
  const allowed = new Set();
  const addAllowed = (url) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'https:') allowed.add(parsed.host);
    } catch {
      /* تجاهل الروابط غير الصالحة */
    }
  };

  let current = null;
  let statusTimer = null;
  let statusToken = 0;
  let season = clampInt(watch.dataset.season, 1, MAX_SEASON, 1);
  let episode = clampInt(watch.dataset.episode, 1, MAX_EPISODE, 1);
  const isTv = watch.dataset.type === 'tv';

  const statusEl = document.createElement('p');
  statusEl.className = 'srv-status';
  statusEl.id = 'srvStatus';
  statusEl.setAttribute('aria-live', 'polite');

  const openBtn = document.createElement('button');
  openBtn.type = 'button';
  openBtn.className = 'open-window';
  openBtn.id = 'openWindow';
  openBtn.textContent = 'افتح في نافذة';

  const actions = document.createElement('div');
  actions.className = 'player-actions';
  actions.append(statusEl, openBtn);

  let episodeBar = null;
  if (isTv) {
    episodeBar = document.createElement('div');
    episodeBar.className = 'episode-bar';
    episodeBar.append(
      buildSelect('الموسم', 'season', 1, MAX_SEASON, season),
      buildSelect('الحلقة', 'episode', 1, MAX_EPISODE, episode),
    );
    stage.after(episodeBar, actions);
  } else {
    stage.after(actions);
  }

  function buildSelect(labelText, name, min, max, value) {
    const wrap = document.createElement('label');
    wrap.className = 'ep-field';

    const span = document.createElement('span');
    span.textContent = labelText;

    const select = document.createElement('select');
    select.name = name;
    select.id = `ep-${name}`;
    for (let i = min; i <= max; i += 1) {
      const option = document.createElement('option');
      option.value = String(i);
      option.textContent = String(i);
      if (i === value) option.selected = true;
      select.append(option);
    }

    wrap.append(span, select);
    return wrap;
  }

  function setStatus(text, mode) {
    statusEl.textContent = text;
    if (mode) statusEl.dataset.mode = mode;
    else delete statusEl.dataset.mode;
  }

  function preferredButton() {
    return (
      serverBox?.querySelector('.srv.active[data-ok="1"]') ??
      serverBox?.querySelector('.srv[data-ok="1"]') ??
      serverBox?.querySelector('.srv') ??
      null
    );
  }

  function load(url, label) {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return false;
    }
    if (parsed.protocol !== 'https:' || !allowed.has(parsed.host)) return false;

    current = parsed.toString();
    const token = ++statusToken;
    clearTimeout(statusTimer);
    setStatus('يتحمّل…', 'loading');

    const frame = document.createElement('iframe');
    frame.src = current;
    frame.title = label ?? 'مشغل';
    frame.allow = 'autoplay; fullscreen; encrypted-media; picture-in-picture; clipboard-write';
    frame.allowFullscreen = true;
    frame.referrerPolicy = 'no-referrer';
    // بدون sandbox: مشغّلات البث ترفض التشغيل داخل إطار مقفول، والعزل مضمون
    // لأن المصدر نطاق خارجي مختلف يُحمَّل داخل iframe مستقل.

    frame.addEventListener('load', () => {
      if (token !== statusToken) return;
      clearTimeout(statusTimer);
      statusTimer = setTimeout(() => {
        if (token !== statusToken) return;
        setStatus('إذا ما اشتغل جرّب سيرفر ثاني', 'warn');
      }, PLAYED_WARN_MS);
    });
    statusTimer = setTimeout(() => {
      if (token !== statusToken) return;
      setStatus('إذا ما اشتغل جرّب سيرفر ثاني', 'warn');
    }, LOAD_WARN_MS);

    stage.replaceChildren(frame);
    hint?.remove();
    playBtn?.remove();
    openBtn.disabled = false;
    return true;
  }

  function activate(button) {
    if (!button) return;
    for (const el of serverBox?.querySelectorAll('.srv') ?? []) el.classList.remove('active');
    button.classList.add('active');
    load(button.dataset.url, button.dataset.label);
  }

  function renderServers(servers) {
    if (!serverBox) return;
    serverBox.replaceChildren();
    linksBox?.replaceChildren();

    if (!servers.length) {
      const empty = document.createElement('p');
      empty.className = 'servers-empty';
      empty.textContent = 'ما فيه سيرفرات متاحة لهذا العنوان حالياً.';
      serverBox.append(empty);
      if (playBtn) playBtn.disabled = true;
      openBtn.disabled = true;
      return;
    }

    const fragment = document.createDocumentFragment();
    servers.forEach((server, index) => {
      const url = String(server?.url ?? '');
      const label = String(server?.label ?? 'سيرفر');
      addAllowed(url);

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `srv${server.ok ? '' : ' dim'}${index === 0 && server.ok ? ' active' : ''}`;
      btn.dataset.url = url;
      btn.dataset.label = label;
      btn.dataset.ok = server.ok ? '1' : '0';
      btn.textContent = label;
      if (!server.ok) {
        const warn = document.createElement('span');
        warn.className = 'warn';
        warn.textContent = ' ؟';
        btn.append(warn);
      }
      fragment.append(btn);

      const li = document.createElement('li');
      const link = document.createElement('a');
      link.href = url;
      link.target = '_blank';
      link.rel = 'noreferrer nofollow';
      link.textContent = `${label} ↗`;
      li.append(link);
      linksBox?.append(li);
    });

    serverBox.append(fragment);
    if (playBtn) playBtn.disabled = false;
  }

  async function fetchServers({ autoplay = true } = {}) {
    const id = watch.dataset.id;
    if (!id) return;

    serverBox?.setAttribute('aria-busy', 'true');
    setStatus('يتحمّل…', 'loading');
    try {
      const url = `/api/servers/tv/${encodeURIComponent(id)}?season=${season}&episode=${episode}`;
      const res = await fetch(url, { headers: { accept: 'application/json' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const servers = Array.isArray(data.servers) ? data.servers : [];
      renderServers(servers);
      if (autoplay) activate(preferredButton());
    } catch {
      if (serverBox) {
        serverBox.replaceChildren();
        const empty = document.createElement('p');
        empty.className = 'servers-empty';
        empty.textContent = 'تعذّر تحميل سيرفرات هذه الحلقة. أعد المحاولة.';
        serverBox.append(empty);
      }
      setStatus('تعذّر تحميل السيرفرات', 'warn');
    } finally {
      serverBox?.removeAttribute('aria-busy');
    }
  }

  episodeBar?.addEventListener('change', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement)) return;
    if (target.name === 'season') season = clampInt(target.value, 1, MAX_SEASON, season);
    else if (target.name === 'episode') episode = clampInt(target.value, 1, MAX_EPISODE, episode);
    watch.dataset.season = String(season);
    watch.dataset.episode = String(episode);
    fetchServers({ autoplay: true });
  });

  openBtn.addEventListener('click', () => {
    if (!current) {
      const button = preferredButton();
      if (!button || !load(button.dataset.url, button.dataset.label)) return;
    }
    let parsed;
    try {
      parsed = new URL(current);
    } catch {
      return;
    }
    if (parsed.protocol !== 'https:') return;
    window.open(parsed.toString(), '_blank', 'noopener,noreferrer');
  });

  // النطاقات الأولية من الأزرار الموجودة في الصفحة.
  for (const btn of serverBox?.querySelectorAll('[data-url]') ?? []) addAllowed(btn.dataset.url);

  if (serverBox && !serverBox.querySelector('.srv')) {
    const empty = document.createElement('p');
    empty.className = 'servers-empty';
    empty.textContent = 'ما فيه سيرفرات متاحة لهذا العنوان حالياً.';
    serverBox.replaceChildren(empty);
    if (hint) hint.textContent = 'ما فيه سيرفرات متاحة لهذا العنوان.';
    if (playBtn) playBtn.disabled = true;
    openBtn.disabled = true;
  }

  serverBox?.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target.closest('.srv') : null;
    if (target) activate(target);
  });

  playBtn?.addEventListener('click', () => activate(preferredButton()));

  // السيرفر الأول الجاهز يشتغل تلقائياً — بدون صوت حتى يضغط المستخدم إذا المتصفح يمنع.
  const firstUrl = watch.dataset.firstUrl;
  if (firstUrl) {
    const firstButton = [...(serverBox?.querySelectorAll('.srv') ?? [])].find(
      (btn) => btn.dataset.url === firstUrl,
    );
    if (firstButton && watch.dataset.firstOk === '1') activate(firstButton);
  }
}
