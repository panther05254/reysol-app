// api/news.js  — Vercel Serverless Function
// 柏レイソル関連のRSSを取得してJSONで返す

const RSS_SOURCES = [
  { source: '柏レイソル公式', url: 'https://www.reysol.co.jp/feed/' },
  { source: 'ゲキサカ',       url: 'https://web.gekisaka.jp/feed/jleague/' },
  { source: 'Yahoo!スポーツ', url: 'https://sports.yahoo.co.jp/rss/news/soccer' },
  { source: 'Google News',    url: 'https://news.google.com/rss/search?q=%E6%9F%8F%E3%83%AC%E3%82%A4%E3%82%BD%E3%83%AB&hl=ja&gl=JP&ceid=JP:ja' },
];

// 対戦相手クラブの公式ドメイン（これらのURLの記事は除外）
const OPPONENT_DOMAINS = [
  'jefunited.co.jp', 'antlers.co.jp', 'fctokyo.co.jp', 'verdy.co.jp',
  'frontale.co.jp', 'f-marinos.com', 'urawa-reds.co.jp', 'mito-hollyhock.net',
  'zelvia.co.jp', 'gamba-osaka.net', 'cerezo.co.jp', 'vissel-kobe.co.jp',
  'sanfrecce.co.jp', 'nagoya-grampus.jp', 'sagantosu.jp', 'shonan-bellmare.co.jp',
  'avispa.co.jp', 'kyoto-sanga.co.jp', 'albirex.com', 'jubilo-iwata.co.jp',
  'consadole.net', 'shimizu-spulse.co.jp', 'vvaren.co.jp',
];

// 対戦相手目線のタイトルパターン
const OPPONENT_TITLE_PATTERNS = [
  /vs\.?\s*柏/i, /vs\.?\s*レイソル/i,
  /柏レイソル戦/, /レイソル戦/,
  /対\s*柏レイソル/, /対\s*柏$/,
];

function isOpponentArticle(url, title) {
  if (OPPONENT_DOMAINS.some(d => url.includes(d))) return true;
  if (OPPONENT_TITLE_PATTERNS.some(p => p.test(title))) return true;
  return false;
}

// キャッシュ（Vercelのサーバーレス関数はインスタンスが再利用されることがある）
let cache = null;
let cacheTime = 0;
const CACHE_TTL = 10 * 60 * 1000; // 10分

async function fetchRSS(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ReysolApp/1.0)' },
    signal: AbortSignal.timeout(8000),
  });
  const text = await res.text();
  return text;
}

function parseRSS(xml, sourceName) {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const item = match[1];
    const title   = (item.match(/<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/)   || [])[1]?.trim() || '';
    const link    = (item.match(/<link[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/link>/)     || [])[1]?.trim() || '';
    const pubDate = (item.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/)                          || [])[1]?.trim() || '';
    const summary = (item.match(/<description[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/) || [])[1]
      ?.replace(/<[^>]+>/g, '').replace(/&[a-z#0-9]+;/gi, ' ').trim().slice(0, 120) || '';

    if (!title || !link) continue;

    // 対戦相手クラブ公式サイトの記事は除外
    if (isOpponentArticle(link, title)) continue;

    // 柏レイソル関連フィルタ（公式・Google News以外）
    const isReysol = sourceName === '柏レイソル公式' || sourceName === 'Google News'
      || title.includes('柏') || title.includes('レイソル') || title.includes('Reysol')
      || title.includes('Kashiwa');
    if (!isReysol) continue;

    items.push({
      title,
      url: link,
      source: sourceName,
      summary,
      pubDate: pubDate ? new Date(pubDate).getTime() : 0,
    });
  }
  return items;
}

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=300');

  // インメモリキャッシュ
  if (cache && Date.now() - cacheTime < CACHE_TTL) {
    return res.status(200).json({ items: cache, cached: true });
  }

  const allItems = [];
  await Promise.allSettled(RSS_SOURCES.map(async ({ source, url }) => {
    try {
      const xml = await fetchRSS(url);
      const items = parseRSS(xml, source);
      allItems.push(...items);
    } catch (e) {
      console.warn(`[news] ${source} failed:`, e.message);
    }
  }));

  // 重複除去・日付降順・50件
  const seen = new Set();
  const deduped = allItems
    .sort((a, b) => b.pubDate - a.pubDate)
    .filter(item => {
      const key = item.title.slice(0, 30);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 50);

  if (deduped.length > 0) {
    cache = deduped;
    cacheTime = Date.now();
  }

  res.status(200).json({ items: deduped, cached: false });
}
