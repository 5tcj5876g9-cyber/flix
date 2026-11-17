import { SERVERS, buildUrl } from './sources.js';

/*
 * أداة سطر أوامر: حالة السيرفرات لعنوان واحد، أو قائمة السيرفرات فقط.
 *   node src/probe.js            → كل السيرفرات على Fight Club
 *   node src/probe.js 155 tv 1 1 → مسلسل بمواسم
 */

const [, , idArg, typeArg, seasonArg, episodeArg] = process.argv;
const tmdbId = Number(idArg ?? 550);
const type = typeArg === 'tv' ? 'tv' : 'movie';
const season = Number(seasonArg ?? 1);
const episode = Number(episodeArg ?? 1);

const rows = await Promise.all(
  SERVERS.map(async (server) => {
    const url = buildUrl(server, { type, tmdbId, season, episode });
    const started = Date.now();
    try {
      const res = await fetch(url, {
        redirect: 'follow',
        signal: AbortSignal.timeout(8000),
        headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) flix/1.0' },
      });
      await res.body?.cancel().catch(() => {});
      return { server: server.id, status: res.status, ms: Date.now() - started, url };
    } catch (error) {
      return { server: server.id, status: error.name, ms: Date.now() - started, url };
    }
  }),
);

for (const row of rows) {
  console.log(`${row.server.padEnd(12)} ${String(row.status).padEnd(12)} ${String(row.ms + 'ms').padEnd(8)} ${row.url}`);
}
