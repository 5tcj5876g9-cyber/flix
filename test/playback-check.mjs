const urls = [
  ['vidsrc-tmdb', 'https://vidsrc.to/embed/movie/550'],
  ['vidsrc-imdb', 'https://vidsrc.to/embed/movie/tt0137523'],
  ['2embed-imdb', 'https://www.2embed.cc/embed/tt0137523'],
  ['vidlink', 'https://vidlink.pro/movie/550'],
  ['vidfast', 'https://vidfast.pro/movie/550'],
  ['vidsrc-me', 'https://vidsrc.me/embed/movie?tmdb=550'],
  ['vidsrc-me-imdb', 'https://vidsrc.me/embed/movie?imdb=tt0137523'],
  ['multiembed', 'https://multiembed.mov/?video_id=550&tmdb=1'],
];

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

for (const [name, url] of urls) {
  try {
    const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'text/html' }, signal: AbortSignal.timeout(9000) });
    const html = await res.text();
    const signals = [];
    if (/<iframe/i.test(html)) signals.push('iframe');
    if (/m3u8/i.test(html)) signals.push('m3u8');
    if (/player|jwplayer|videojs|hls/i.test(html)) signals.push('player');
    if (/cloudflare|challenge-platform|Just a moment|cf-browser/i.test(html)) signals.push('CF-CHALLENGE');
    if (/not found|404|unavailable/i.test(html)) signals.push('NOTFOUND?');
    console.log(
      `${name.padEnd(16)} ${String(res.status).padEnd(4)} ${String(html.length).padEnd(7)} ${signals.join(',') || 'plain'}  ${html.slice(0, 90).replace(/\s+/g, ' ')}`,
    );
  } catch (error) {
    console.log(`${name.padEnd(16)} FAIL ${error.name}`);
  }
}
