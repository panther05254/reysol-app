// api/matches.js — Vercel Serverless Function
// mobaj.net から柏レイソルの試合スコアを取得

let cache = null;
let cacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5分

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');

  if (cache && Date.now() - cacheTime < CACHE_TTL) {
    return res.status(200).json({ events: cache, cached: true });
  }

  try {
    const r = await fetch('https://mobaj.net/2026/club/kashiwa', {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ReysolApp/1.0)' },
      signal: AbortSignal.timeout(10000),
    });
    const html = await r.text();

    // テーブル行をパース: 日時 | 大会 | 対戦 | 結果 | H/A | 会場
    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    const stripTags = s => s.replace(/<[^>]+>/g, '').replace(/&[a-z#0-9]+;/gi, ' ').trim();

    const events = [];
    let rowMatch;
    while ((rowMatch = rowRegex.exec(html)) !== null) {
      const row = rowMatch[1];
      const tds = [];
      let tdMatch;
      while ((tdMatch = tdRegex.exec(row)) !== null) {
        tds.push(stripTags(tdMatch[1]));
      }
      if (tds.length < 4) continue;

      // 日時列: "3/14(土) 14:00" or "3/14(土) -"
      const dateRaw = tds[0];
      const dateM = dateRaw.match(/(\d+)\/(\d+)[^0-9]*(\d+):(\d+)/);
      if (!dateM) continue;

      const month = dateM[1].padStart(2,'0');
      const day   = dateM[2].padStart(2,'0');
      const rawDate = `2026-${month}-${day}`;
      const time = `${dateM[3]}:${dateM[4]}`;

      // 結果列: "2 - 1" or "1 - 2" or "-"
      const scoreRaw = tds[3];
      const scoreM = scoreRaw.match(/(\d+)\s*-\s*(\d+)/);
      const homeScore = scoreM ? parseInt(scoreM[1]) : null;
      const awayScore = scoreM ? parseInt(scoreM[2]) : null;

      events.push({ rawDate, time, homeScore, awayScore });
    }

    console.log(`[matches] mobaj: ${events.length}件取得`);
    cache = events;
    cacheTime = Date.now();
    res.status(200).json({ events, cached: false });
  } catch (e) {
    console.error('[matches]', e.message);
    res.status(500).json({ error: e.message, events: [] });
  }
}
