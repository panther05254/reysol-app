// api/matches.js — Vercel Serverless Function
// TheSportsDB から柏レイソルの直近・次の試合スコアを取得

const TSDB = 'https://www.thesportsdb.com/api/v1/json/123';
const KASHIWA_TSDB = '134440';

const TEAM_JP = {
  'Kashiwa Reysol': '柏レイソル',
  'Kashima Antlers': '鹿島アントラーズ',
  'FC Tokyo': 'FC東京',
  'Tokyo Verdy': '東京ヴェルディ',
  'Kawasaki Frontale': '川崎フロンターレ',
  'Yokohama F.Marinos': '横浜F・マリノス',
  'Yokohama F. Marinos': '横浜F・マリノス',
  'Urawa Red Diamonds': '浦和レッズ',
  'Urawa Reds': '浦和レッズ',
  'JEF United Chiba': 'ジェフ千葉',
  'JEF United Ichihara Chiba': 'ジェフ千葉',
  'Mito HollyHock': '水戸ホーリーホック',
  'FC Machida Zelvia': 'FC町田ゼルビア',
  'Machida Zelvia': 'FC町田ゼルビア',
  'Gamba Osaka': 'ガンバ大阪',
  'Cerezo Osaka': 'セレッソ大阪',
  'Vissel Kobe': 'ヴィッセル神戸',
  'Sanfrecce Hiroshima': 'サンフレッチェ広島',
  'Nagoya Grampus': '名古屋グランパス',
  'Sagan Tosu': 'サガン鳥栖',
  'Shonan Bellmare': '湘南ベルマーレ',
  'Avispa Fukuoka': 'アビスパ福岡',
  'Kyoto Sanga': '京都サンガF.C.',
  'Albirex Niigata': 'アルビレックス新潟',
  'Jubilo Iwata': 'ジュビロ磐田',
  'Consadole Sapporo': '北海道コンサドーレ札幌',
};
function toJP(name) { return TEAM_JP[name] || name; }

let cache = null;
let cacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5分（試合中は短め）

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');

  if (cache && Date.now() - cacheTime < CACHE_TTL) {
    return res.status(200).json({ events: cache, cached: true });
  }

  try {
    const [r1, r2] = await Promise.all([
      fetch(`${TSDB}/eventslast.php?id=${KASHIWA_TSDB}`, { signal: AbortSignal.timeout(8000) }),
      fetch(`${TSDB}/eventsnext.php?id=${KASHIWA_TSDB}`, { signal: AbortSignal.timeout(8000) }),
    ]);
    const [d1, d2] = await Promise.all([r1.json(), r2.json()]);
    const raw = [...(d1.results || []), ...(d2.events || [])];

    const events = raw.map(e => {
      const scored = e.intHomeScore != null && e.intHomeScore !== '' && e.intAwayScore != null;
      return {
        date: e.dateEvent,
        time: e.strTime || null,
        home: toJP(e.strHomeTeam),
        away: toJP(e.strAwayTeam),
        homeScore: scored ? parseInt(e.intHomeScore) : null,
        awayScore: scored ? parseInt(e.intAwayScore) : null,
        status: e.strStatus || '',
        venue: e.strVenue || '',
      };
    });

    cache = events;
    cacheTime = Date.now();
    res.status(200).json({ events, cached: false });
  } catch (e) {
    console.error('[matches]', e.message);
    res.status(500).json({ error: e.message, events: [] });
  }
}
