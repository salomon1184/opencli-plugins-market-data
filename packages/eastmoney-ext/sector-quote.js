// eastmoney sector-quote — 单个/多个**板块**（或指数）的实时快照，按代码直取。
//
// 为什么需要它（内置 `quote` 覆盖不了的缺口）：
//   内置 `quote` 走 _secid.js 的 resolveSecid，只认个股/指数形态。板块代码
//   `BK1158` 既不是 6 位数字、也不匹配 `^[A-Z.\-]{1,8}$`（含数字），显式 secid
//   `90.BK1158` 又因为 `90` 不在 KNOWN_MARKET_PREFIXES 白名单里被拒 —— 实测两者
//   都报 `INVALID_ARGUMENT: Unrecognized symbol`。所以看板想直接盯「微盘股」这类
//   **没进概念榜前 100** 的板块时，`quote` 这条路是走不通的，得按 secid 单拉。
//
// 为什么不做成覆盖 `quote`：
//   `quote` 是看板第 0 步「交易日判定」在用的命令，也是 `_secid.js` 的唯一使用方。
//   覆盖它就得把 `quote.js` + `_secid.js` 两份都拷进用户目录自己维护，A/港/美
//   整个符号解析面都成了我们的责任 —— 一旦跟上游漂移，整个日更的入口就断了。
//   收益（省一个命令名）远小于风险，所以这里新增一个独立命令，边界更清楚。
//
//   opencli eastmoney sector-quote BK1158
//   opencli eastmoney sector-quote "BK1158,BK0459" -f json

import { cli, Strategy } from '@jackwener/opencli/registry';
import { CliError } from '@jackwener/opencli/errors';

// 东财板块的市场前缀固定是 90；其余市场（沪1/深0/港116…）留给显式 secid 形态。
const BOARD_PREFIX = '90';

/**
 * 把用户输入解析成东财 secid（市场.代码）。只认两类，其余一律报错 ——
 * 猜错了会静默返回别的标的的数据，比报错糟得多。
 *   "BK1158"    → "90.BK1158"   （板块代码）
 *   "90.BK1158" → "90.BK1158"   （已经是 secid，放行 —— 指数等也走这条）
 */
function resolveBoardSecid(input) {
  const raw = String(input || '').trim();
  if (!raw) throw new CliError('INVALID_ARGUMENT', 'empty sector code');
  if (/^BK\d{4}$/i.test(raw)) return `${BOARD_PREFIX}.${raw.toUpperCase()}`;
  if (/^\d{1,3}\.[A-Za-z0-9]+$/.test(raw)) return raw;
  throw new CliError(
    'INVALID_ARGUMENT',
    `Unrecognized sector code "${raw}". 本命令只收板块代码 (BK####) 或完整 secid (如 90.BK1158)；个股行情请用 opencli eastmoney quote`,
  );
}

function splitCodes(s) {
  return String(s || '')
    .split(/[,，\s]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

cli({
  site: 'eastmoney',
  name: 'sector-quote',
  access: 'read',
  description: '板块实时快照（按 BK 代码直取，含今日/5日/10日主力净额与板块内涨跌家数）',
  domain: 'push2.eastmoney.com',
  strategy: Strategy.PUBLIC,
  browser: false,
  example: 'opencli eastmoney sector-quote BK1158 -f json',
  args: [
    { name: 'codes', required: true, positional: true, help: '板块代码，如 BK1158（可用逗号/空格分隔多个）' },
  ],
  columns: [
    'code', 'name', 'price', 'changePercent',
    'mainNet', 'mainNet5d', 'mainNet10d',
    'upCount', 'downCount',
  ],
  func: async (args) => {
    const raw = args.codes ?? args.symbols;
    const inputs = splitCodes(raw);
    if (inputs.length === 0) throw new CliError('INVALID_ARGUMENT', 'at least one sector code is required');
    const secids = inputs.map(resolveBoardSecid).join(',');

    const url = new URL('https://push2.eastmoney.com/api/qt/ulist.np/get');
    url.searchParams.set('secids', secids);
    url.searchParams.set('fltt', '2');
    url.searchParams.set('invt', '2');
    url.searchParams.set('fields', 'f12,f14,f2,f3,f62,f164,f174,f104,f105');
    url.searchParams.set('ut', 'b2884a393a59ad64002292a3e90d46a5');

    const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!resp.ok) throw new CliError('HTTP_ERROR', `sector-quote failed: HTTP ${resp.status}`);
    const data = await resp.json();
    const diff = Array.isArray(data?.data?.diff) ? data.data.diff : [];
    if (diff.length === 0) throw new CliError('NO_DATA', 'eastmoney returned no sector quote data');

    return diff.map((it) => ({
      code: it.f12,
      name: it.f14,
      price: it.f2,
      changePercent: it.f3,
      mainNet: it.f62,
      mainNet5d: it.f164,
      mainNet10d: it.f174,
      upCount: it.f104,
      downCount: it.f105,
    }));
  },
});
