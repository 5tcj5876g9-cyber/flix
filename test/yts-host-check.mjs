const hosts = ['yts.lt', 'yts.am', 'movies-api.accel.lol'];
for (const host of hosts) {
  for (const path of ['/api/v2/list_movies.json?limit=2&sort_by=date_added']) {
    const url = `https://${host}${path}`;
    try {
      const res = await fetch(url, {
        redirect: 'manual',
        headers: { accept: 'application/json', 'user-agent': 'Mozilla/5.0 flix/1.0' },
        signal: AbortSignal.timeout(9000),
      });
      const loc = res.headers.get('location');
      const ct = res.headers.get('content-type');
      let body = '';
      if (res.status === 200) body = (await res.text()).slice(0, 120);
      else await res.body?.cancel().catch(() => {});
      console.log(`${host.padEnd(22)} ${res.status} loc=${loc ?? '-'} ct=${ct ?? '-'} ${body.replace(/\s+/g, ' ')}`);
    } catch (error) {
      console.log(`${host.padEnd(22)} FAIL ${error.name}`);
    }
  }
}
