const tests = [
  ['vidsrc.to', 'https://vidsrc.to/embed/movie/550'],
  ['vidsrc.xyz', 'https://vidsrc.xyz/embed/movie?tmdb=550'],
  ['vidsrc.me', 'https://vidsrc.me/embed/movie?tmdb=550'],
  ['vidsrc.pro', 'https://vidsrc.pro/embed/movie/550'],
  ['embed.su', 'https://embed.su/embed/movie/550'],
  ['vidlink.pro', 'https://vidlink.pro/movie/550'],
  ['vidfast.pro', 'https://vidfast.pro/movie/550'],
  ['2embed.cc', 'https://www.2embed.cc/embed/550'],
  ['moviesapi.club', 'https://moviesapi.club/movie/550'],
  ['autoembed.cc', 'https://player.autoembed.cc/embed/movie/550'],
  ['multiembed.mov', 'https://multiembed.mov/?video_id=550&tmdb=1'],
  ['vidsrc.cc', 'https://vidsrc.cc/v2/embed/movie/550'],
  ['vidsrc.in', 'https://vidsrc.in/embed/movie/550'],
  ['vidsrc.dev', 'https://vidsrc.dev/embed/movie/550'],
  ['smashystream', 'https://player.smashy.stream/movie/550'],
  ['apibay', 'https://apibay.org/q.php?q=fight+club&cat=0'],
  ['yts', 'https://yts.mx/api/v2/list_movies.json?query_term=tt0137523&limit=3'],
  ['tmdb-no-key', 'https://api.themoviedb.org/3/movie/550'],
];

const TIMEOUT = 8000;

async function probe([name, url]) {
  const started = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: ctrl.signal,
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        accept: 'text/html,application/json;q=0.9,*/*;q=0.8',
      },
    });
    const type = res.headers.get('content-type') ?? '';
    let note = '';
    if (type.includes('json')) {
      const text = await res.text();
      note = JSON.stringify(text.slice(0, 90));
    } else {
      await res.body?.cancel().catch(() => {});
    }
    return `${name.padEnd(15)} ${String(res.status).padEnd(4)} ${(Date.now() - started + 'ms').padEnd(7)} ${type.split(';')[0].padEnd(24)} ${note}`;
  } catch (error) {
    return `${name.padEnd(15)} FAIL ${(Date.now() - started + 'ms').padEnd(7)} ${error.name}: ${error.message}`;
  } finally {
    clearTimeout(timer);
  }
}

const results = await Promise.all(tests.map(probe));
console.log(results.join('\n'));
