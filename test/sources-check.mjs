const tests = [
  ['yts.mx', 'https://yts.mx/api/v2/list_movies.json?limit=2&sort_by=year'],
  ['yts.lt', 'https://yts.lt/api/v2/list_movies.json?limit=2'],
  ['yts.am', 'https://yts.am/api/v2/list_movies.json?limit=2'],
  ['github-api', 'https://api.github.com/search/repositories?q=movie+api+tmdb&per_page=2'],
  ['github-raw', 'https://raw.githubusercontent.com/udacity/nd032-c2-functional-programming-with-javascript-starter/main/README.md'],
  ['itunes', 'https://itunes.apple.com/search?term=parasite&media=movie&limit=3'],
  ['tvmaze', 'https://api.tvmaze.com/search/shows?q=squid'],
  ['omdb-no-key', 'https://www.omdbapi.com/?t=fight+club'],
  ['wikipedia', 'https://ar.wikipedia.org/api/rest_v1/page/summary/%D9%81%D8%A7%D9%8A%D8%AA_%D9%83%D9%84%D8%A8'],
  ['tmdb-cdn', 'https://image.tmdb.org/t/p/w342/pB8BM7pdSp6B6Ih7QZ4DrQ3PmJK.jpg'],
  ['koyeb', 'https://www.koyeb.com/'],
  ['oracle-free', 'https://www.oracle.com/cloud/free/'],
  ['cloudflare', 'https://www.cloudflare.com/'],
];

for (const [name, url] of tests) {
  const started = Date.now();
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(9000),
      headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) flix/1.0', accept: '*/*' },
    });
    const type = (res.headers.get('content-type') ?? '').split(';')[0];
    let note = '';
    if (type.includes('json')) {
      const text = await res.text();
      note = text.slice(0, 110).replace(/\s+/g, ' ');
    } else {
      await res.body?.cancel().catch(() => {});
    }
    console.log(`${name.padEnd(14)} ${String(res.status).padEnd(4)} ${(Date.now() - started + 'ms').padEnd(7)} ${type.padEnd(18)} ${note}`);
  } catch (error) {
    console.log(`${name.padEnd(14)} FAIL ${(Date.now() - started + 'ms').padEnd(7)} ${error.name}: ${error.message}`);
  }
}
