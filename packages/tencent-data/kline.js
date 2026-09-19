// tencent kline — 日/周/月 K 线（A股 / 港股 / 美股通用端点，复权可选）。
//
// 为什么需要它：东财那套 `opencli eastmoney kline` 走 `push2his.eastmoney.com`，
// 而它是**唯一**的历史 K 线命令 —— 2026-09-19 实测该 host 整条不可用（`fetch failed`，
// 原样 curl 也 `Empty reply`），且**没有替代源**：alice/yfinance 对 A股零覆盖、
// sinafinance 只有实时行情、traderhub etf 只有持仓。腾讯这条是明文 HTTP、当场可用。
//
// 端点与形状（2026-09-19 实测）：
//   https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=sh512480,day,,,800,qfq
//   → {"code":0,"data":{"sh512480":{"qfqday":[["2026-08-24","1.041","1.010","1.043","0.989","15043466.000"], …]}}}
//   字段序 **[日期, 开, 收, 高, 低, 量]**（注意是 开-收-高-低，不是常见的 开-高-低-收）。
//
//   正确性交叉验证：`sh000001` 的 2026-09-16 行 [3861.75, 3891.60, 3894.66, 3842.72]
//   与看板 09-16 正文的「收 3891.60 · 日内高 3894.66 / 低 3842.72」三个数全中。
//
// ⚠️ 三个坑：
//   1. **指数不返回复权键** —— 即使传 `qfq`，指数也只在 `day` 下给数据。所以取键要
//      先试 `qfqday` 再回退 `day`，否则指数会「查得到但没数据」。
//   2. **这是网页爬虫接口**，批量拉取易被封 IP —— 限速是**调用方**的责任
//      （见 README「限速与重试的分工」），适配器自己不 sleep、不重试。
//   3. **美股要带交易所后缀**（`usAAPL.OQ`）—— 裸 `usAAPL` **不报错**，但永远只回
//      「上市首日 + 最新」两行，且**无视 `--count`**。这是最阴的一类失败：形状合法、
//      内容是假的。本命令因此对裸代码做**一次 quote 查询**来自动补后缀（见
//      `discoverUsSuffix`）—— 那个端点正好相反，认裸代码，且应答 `f[2]` 回显带后缀
//      的真代码。**只在这条路径上多花一次请求。**
//
//   opencli tencent kline sh512480
//   opencli tencent kline 512480 --period week --count 200 -f json
//   opencli tencent kline sh000001 --period day --adjust none
//   opencli tencent kline hk00700 --start 2024-01-02 --end 2024-01-10   # 日期区间

import { cli, Strategy } from '@jackwener/opencli/registry';
import { CliError } from '@jackwener/opencli/errors';
import { resolveSymbol, isUs, hasUsSuffix } from './_symbol.js';

const BASE = 'https://web.ifzq.gtimg.cn/appstock/app/fqkline/get';
const QUOTE_BASE = 'https://qt.gtimg.cn/q=';

/**
 * 裸美股代码 → 带交易所后缀的形态（`usAAPL` → `usAAPL.OQ`）。
 *
 * 为什么能查出来：quote 端点认裸代码，且它应答的 `f[2]` 是**带后缀的真代码**
 * （实测 `usAAPL` → `f[2] = "AAPL.OQ"`）。所以后缀不必让调用方记，也不必内置一张
 * 交易所表 —— 问一次上游就有。
 *
 * ⚠️ 查不到就**报错**，不要退回裸代码去请求 K 线 —— 那会拿到 2 行假数据，
 *    比报错糟得多（见文件头坑 3）。
 */
async function discoverUsSuffix(symbol) {
  const resp = await fetch(QUOTE_BASE + symbol, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!resp.ok) throw new CliError('HTTP_ERROR', `tencent quote failed: HTTP ${resp.status}`);

  // quote 是 GBK，见 quote.js 文件头
  const text = new TextDecoder('gbk').decode(await resp.arrayBuffer());
  for (const raw of text.split(';')) {
    const m = raw.trim().match(/^v_([a-z]{2}\w+)="(.*)"$/);
    if (!m || m[1] !== symbol) continue;
    const real = (m[2].split('~')[2] || '').trim();   // f[2] = 带后缀的真代码
    if (real.includes('.')) return 'us' + real;
  }
  throw new CliError(
    'NO_DATA',
    `查不到 "${symbol}" 的交易所后缀 —— 代码可能不对，或该标的不在腾讯覆盖内。` +
    `也可以自己写全（如 usAAPL.OQ —— .OQ NASDAQ / .N NYSE）。`,
  );
}

/** 周期与复权各自的白名单 —— 认不出就报错，不让拼出一个静默返回空值的 URL。 */
const PERIODS = ['day', 'week', 'month'];
const ADJUSTS = ['qfq', 'hfq', 'none'];

cli({
  site: 'tencent',
  name: 'kline',
  access: 'read',
  description: '日/周/月 K 线（A股/港股/美股；前复权/后复权/不复权可选）',
  domain: 'web.ifzq.gtimg.cn',
  strategy: Strategy.PUBLIC,
  browser: false,
  example: 'opencli tencent kline sh512480 --period day --count 250 -f json',
  args: [
    { name: 'symbol', required: true, positional: true, help: '代码，如 sh512480 / 512480（A股 6 位可省前缀；000xxx 有歧义必须显式给）；美股 usAAPL 或 usAAPL.OQ 均可（裸代码会自动查后缀）' },
    { name: 'period', type: 'string', default: 'day',   help: `周期：${PERIODS.join(' / ')}` },
    { name: 'adjust', type: 'string', default: 'qfq',   help: `复权：${ADJUSTS.join(' / ')}（none = 不复权）` },
    { name: 'count',  type: 'int',    default: 250,     help: '返回根数（实测 800 可用；给了 --start/--end 时它们优先）' },
    { name: 'start',  type: 'string', default: '',      help: '起始日 YYYY-MM-DD（**必须与 --end 同时给**，只给一个会被上游忽略）' },
    { name: 'end',    type: 'string', default: '',      help: '结束日 YYYY-MM-DD' },
    { name: 'market', type: 'string', default: '',      help: '强制市场前缀 sh/sz/hk/us —— 仅 000xxx 这类歧义代码需要' },
  ],
  columns: ['date', 'open', 'close', 'high', 'low', 'vol'],
  func: async (args) => {
    const period = String(args.period || 'day').toLowerCase();
    const adjust = String(args.adjust || 'qfq').toLowerCase();
    if (!PERIODS.includes(period)) {
      throw new CliError('INVALID_ARGUMENT', `unknown period "${args.period}" — expected ${PERIODS.join(' / ')}`);
    }
    if (!ADJUSTS.includes(adjust)) {
      throw new CliError('INVALID_ARGUMENT', `unknown adjust "${args.adjust}" — expected ${ADJUSTS.join(' / ')}`);
    }
    let symbol;
    try {
      symbol = resolveSymbol(args.symbol, { market: args.market });
    } catch (e) {
      throw new CliError('INVALID_ARGUMENT', e.message);
    }

    // 裸美股代码在本端点会静默返回 2 行退化数据（文件头坑 3）—— 补上后缀再请求。
    // 已带后缀的（usAAPL.OQ）原样放行，不额外发请求。
    let discoveredFrom = '';
    if (isUs(symbol) && !hasUsSuffix(symbol)) {
      const resolved = await discoverUsSuffix(symbol);
      if (resolved !== symbol) discoveredFrom = symbol;
      symbol = resolved;
    }

    const count = Math.max(1, Number(args.count) || 250);
    const fq = adjust === 'none' ? '' : adjust;
    // 上游形态是 `param=<sym>,<period>,<start>,<end>,<count>,<fq>`。
    // ⚠️ **start/end 必须成对给** —— 实测只给 start 会被忽略、回退到 count 模式。
    const start = String(args.start || '').trim();
    const end = String(args.end || '').trim();
    const url = `${BASE}?param=${symbol},${period},${start},${end},${count},${fq}`;

    const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!resp.ok) throw new CliError('HTTP_ERROR', `tencent kline failed: HTTP ${resp.status}`);

    let payload;
    try {
      payload = await resp.json();
    } catch {
      throw new CliError('NO_DATA', 'tencent kline returned a non-JSON body');
    }
    const node = payload?.data?.[symbol];
    if (!node) {
      throw new CliError('NO_DATA', `tencent returned no data for ${symbol} — 代码可能不对，或该标的无 K 线`);
    }

    // 指数不返回复权键（见文件头坑 1）——按 复权+周期 → 周期 → day 依次回退
    const rows = node[`${fq}${period}`] || node[period] || node.day || node.qfqday;
    if (!Array.isArray(rows) || rows.length === 0) {
      // 补过后缀时说明来源 —— 否则用户会看到一个自己没写过的代码（如 usZZZZ.N），
      // 上游对 4 字母未知代码会伪造一条 `.N` 占位记录，看着像我们拼错了。
      const origin = discoveredFrom ? `（由 ${discoveredFrom} 自动补后缀得到）` : '';
      throw new CliError('NO_DATA', `tencent returned no kline rows for ${symbol} ${period}${origin}`);
    }

    return rows.map((r) => ({
      date: r[0],
      open: Number(r[1]),
      close: Number(r[2]),
      high: Number(r[3]),
      low: Number(r[4]),
      vol: Number(r[5]),
    }));
  },
});
