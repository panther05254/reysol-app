// api/standings.js — Vercel Serverless Function
// J1百年構想リーグ EASTグループ順位表を取得

// フォールバック用静的データ（第5節終了時点）
const STATIC = [
  { pos:1,  team:'鹿島アントラーズ',   played:5, won:4, draw:0, lost:1, gf:9,  ga:3,  pts:13 },
  { pos:2,  team:'浦和レッズ',         played:5, won:3, draw:0, lost:2, gf:9,  ga:4,  pts:10 },
  { pos:3,  team:'FC東京',             played:5, won:4, draw:2, lost:1, gf:7,  ga:5,  pts:10 },
  { pos:4,  team:'FC町田ゼルビア',     played:4, won:3, draw:1, lost:1, gf:9,  ga:7,  pts:9  },
  { pos:5,  team:'東京ヴェルディ',     played:5, won:3, draw:1, lost:2, gf:9,  ga:9,  pts:8  },
  { pos:6,  team:'川崎フロンターレ',   played:4, won:3, draw:2, lost:1, gf:8,  ga:7,  pts:7  },
  { pos:7,  team:'ジェフ千葉',         played:5, won:1, draw:0, lost:4, gf:4,  ga:6,  pts:5  },
  { pos:8,  team:'水戸ホーリーホック', played:5, won:1, draw:1, lost:4, gf:6,  ga:10, pts:4  },
  { pos:9,  team:'柏レイソル',         played:5, won:1, draw:0, lost:4, gf:7,  ga:11, pts:3  },
  { pos:10, team:'横浜F・マリノス',    played:5, won:1, draw:0, lost:4, gf:5,  ga:11, pts:3  },
];

let cache = null;
let cacheTime = 0;
const CACHE_TTL = 15 * 60 * 1000; // 15分

async function scrapeStandings() {
  // サーバーサイドからはCORSなしで直接取得できる
  const targets = [
    'https://mobaj.net/2026/standings/j1',
    'https://www.jleague.jp/standings/j1/',
    'https://soccer.yahoo.co.jp/jleague/category/j1ss/standings',
  ];

  for (const url of targets) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'ja,en;q=0.9',
        },
        signal: AbortSignal.timeout(10000),
      });
      const html = await res.text();

      // tbodyの行を解析
      const tbodyMatch = html.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i);
      if (!tbodyMatch) continue;

      const rows = tbodyMatch[1].match(/<tr[\s\S]*?<\/tr>/gi) || [];
      const parsed = [];

      for (const row of rows) {
        const cells = (row.match(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi) || [])
          .map(c => c.replace(/<[^>]+>/g, '').replace(/&[a-z#0-9]+;/gi, '').replace(/\s+/g, ' ').trim());

        if (cells.length < 8) continue;
        const pos  = parseInt(cells[0]);
        const team = cells[1];
        if (!pos || pos < 1 || pos > 12 || !team || team.length < 2) continue;

        // カラム構成: 順位, チーム名, 勝点, 試合, 勝, 分, 負, 得点, 失点, ...
        // サイトによってカラム順が異なるためpts優先で判定
        const nums = cells.slice(2).map(c => parseInt(c)).filter(n => !isNaN(n));
        if (nums.length < 6) continue;

        parsed.push({
          pos,
          team,
          pts:    nums[0],
          played: nums[1],
          won:    nums[2],
          draw:   nums[3],
          lost:   nums[4],
          gf:     nums[5],
          ga:     nums[6] ?? 0,
        });
      }

      if (parsed.length >= 5) {
        console.log(`[standings] scraped ${parsed.length} rows from ${url}`);
        return parsed;
      }
    } catch (e) {
      console.warn(`[standings] ${url} failed:`, e.message);
    }
  }

  // すべて失敗 → null を返してフォールバックへ
  return null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=300');

  if (cache && Date.now() - cacheTime < CACHE_TTL) {
    return res.status(200).json({ standings: cache, source: 'cache' });
  }

  const scraped = await scrapeStandings();
  if (scraped) {
    cache = scraped;
    cacheTime = Date.now();
    return res.status(200).json({ standings: scraped, source: 'live' });
  }

  // フォールバック
  return res.status(200).json({ standings: STATIC, source: 'static' });
}
