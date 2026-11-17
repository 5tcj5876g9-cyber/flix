const base = 'http://127.0.0.1:8095';
const calls = [
  ['health', '/healthz'],
  ['search parasite', '/api/search?q=parasite'],
  ['search كوري', '/api/search?q=' + encodeURIComponent('كوري')],
  ['search رعب', '/api/search?q=' + encodeURIComponent('رعب')],
  ['browse trending', '/api/browse?kind=trending'],
];

for (const [label, path] of calls) {
  try {
    const res = await fetch(base + path, { signal: AbortSignal.timeout(30000) });
    const data = await res.json();
    if (Array.isArray(data.items)) {
      const head = data.items.slice(0, 4).map((i) => `${i.title} (${i.year ?? '?'}) [${i.imdb_id ?? i.tmdb_id}]`).join(' | ');
      console.log(`${label.padEnd(18)} ${res.status} n=${data.items.length} src=${data.source ?? '-'} :: ${head}`);
    } else {
      console.log(`${label.padEnd(18)} ${res.status} ${JSON.stringify(data).slice(0, 160)}`);
    }
  } catch (error) {
    console.log(`${label.padEnd(18)} FAIL ${error.name}: ${error.message}`);
  }
}
