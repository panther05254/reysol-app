// api/news.js  — Vercel Serverless Function

const RSS_SOURCES = [
  { source: '柏レイソル公式', url: 'https://www.reysol.co.jp/feed/' },
  { source: 'ゲキサカ',       url: 'https://web.gekisaka.jp/feed/jleague/' },
  { source: 'Yahoo!スポーツ', url: 'https://sports.yahoo.co.jp/rss/news/soccer' },
  { source: 'Google News',    url: 'https://news.google.com/rss/search?q=%E6%9F%8F%E3%83%AC%E3%82%A4%E3%82%BD%E3%83%AB&hl=ja&gl=JP&ceid=JP:ja' },
];

// 対戦相手クラブの公式ドメイン
const OPPONENT_DOMAINS = [
  'jefunited.co.jp', 'antlers.co.jp', 'fctokyo.co.jp', 'verdy.co.jp',
  'frontale.co.jp', 'f-marinos.com', 'urawa-reds.co.jp', 'mito-hollyhock.net',
  'zelvia.co.jp', 'gamba-osaka.net', 'cerezo.co.jp', 'vissel-kobe.co.jp',
  'sanfrecce.co.jp', 'nagoya-grampus.jp', 'sagantosu.jp', 'shonan-bellmare.co.jp',
  'avispa.co.jp', 'kyoto-sanga.co.jp', 'albirex.com', 'jubilo-iwata.co.jp',
  'consadole.net', 'shimizu-spulse.co.jp', 'vvaren.co.jp',
  'sanga.co.jp', 'gamba.co.jp', 'vissel.co.jp',
];

// 対戦相手クラブ名（これが主語になっている記事を除外）
const OPPONENT_CLUB_NAMES = [
  'ジェフ千葉', 'ジェフユナイテッド',
  '鹿島アントラーズ', '鹿島',
  'FC東京',
  '東京ヴェルディ', '東京V',
  '川崎フロンターレ', '川崎F', '川崎',
  '横浜F・マリノス', '横浜FM', 'マリノス',
  '浦和レッズ', '浦和',
  '水戸ホーリーホック', '水戸',
  'FC町田ゼルビア', '町田',
  'ガンバ大阪', 'G大阪',
  'セレッソ大阪', 'C大阪',
  'ヴィッセル神戸', '神戸',
  'サンフレッチェ広島', '広島',
  '名古屋グランパス', '名古屋',
  'サガン鳥栖', '鳥栖',
  '湘南ベルマーレ', '湘南',
  'アビスパ福岡', '福岡',
  '京都サンガ', '京都',
  'アルビレックス新潟', '新潟',
  'ジュビロ磐田', '磐田',
  '北海道コンサドーレ札幌', '札幌',
  '清水エスパルス', '清水',
  'ロアッソ熊本', '熊本',
];

// 対戦相手目線のタイトルパターン（明示的な「〜戦」「vs柏」等）
const OPPONENT_TITLE_PATTERNS = [
  /vs\.?\s*柏/i,
  /vs\.?\s*レイソル/i,
  /柏レイソル戦/,
  /レイソル戦/,
  /対\s*柏レイソル/,
  /対\s*柏\s*(戦|$)/,
  /柏\s*戦/,
];

function isOpponentArticle(url, title) {
  // ドメインチェック
  if (OPPONENT_DOMAINS.some(d => url.includes(d))) return true;

  // 明示的な「vs柏」「〜戦」パターン
  if (OPPONENT_TITLE_PATTERNS.some(p => p.test(title))) return true;

  // タイトルが柏/レイソルを含まず、対戦相手名で始まる or 対戦相手名が主語
  const hasReysol = title.includes('柏') || title.includes('レイソル') || title.includes('Reysol') || title.includes('Kashiwa');
  if (!hasReysol) {
    // 柏に全く触れていない記事で対戦相手名が含まれるものは除外
    if (OPPONENT_CLUB_NAMES.some(name => title.includes(name))) return true;
  }

  return false;
}

let cache = null;
let cacheTime = 0;
const CACHE_TTL = 10 * 60 * 1000;

async function fetchRSS(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ReysolApp/1.0)' },
    signal: AbortSignal.timeout(8000),
  });
  return await res.text();
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
    if (isOpponentArticle(link, title)) continue;

    const isReysol = sourceName === '柏レイソル公式' || sourceName === 'Google News'
      || title.includes('柏') || title.includes('レイソル') || title.includes('Reysol')
      || title.includes('Kashiwa');
    if (!isReysol) continue;

    items.push({ title, url: link, source: sourceName, summary, pubDate: pubDate ? new Date(pubDate).getTime() : 0 });
  }
  return items;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=300');

  if (cache && Date.now() - cacheTime < CACHE_TTL) {
    return res.status(200).json({ items: cache, cached: true });
  }

  const allItems = [];
  await Promise.allSettled(RSS_SOURCES.map(async ({ source, url }) => {
    try {
      const xml = await fetchRSS(url);
      allItems.push(...parseRSS(xml, source));
    } catch (e) {
      console.warn(`[news] ${source} failed:`, e.message);
    }
  }));

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

  if (deduped.length > 0) { cache = deduped; cacheTime = Date.now(); }
  res.status(200).json({ items: deduped, cached: false });
}
