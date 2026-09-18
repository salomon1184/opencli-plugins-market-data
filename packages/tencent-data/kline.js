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
// ⚠️ 两个坑：
//   1. **指数不返回复权键** —— 即使传 `qfq`，指数也只在 `day` 下给数据。所以取键要
//      先试 `qfqday` 再回退 `day`，否则指数会「查得到但没数据」。
//   2. **这是网页爬虫接口**，批量拉取易被封 IP —— 限速是**调用方**的责任
//      （见 README「限速与重试的分工」），适配器自己不 sleep、不重试。
//
//   opencli tencent kline sh512480
//   opencli tencent kline 512480 --period week --count 200 -f json
//   opencli tencent kline sh000001 --period day --adjust none

import { cli, Strategy } from '@jackwener/opencli/registry';
import { CliError } from '@jackwener/opencli/errors';
import { resolveSymbol } from './_symbol.js';

const BASE = 'https://web.ifzq.gtimg.cn/appstock/app/fqkline/get';

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
    { name: 'symbol', required: true, positional: true, help: '代码，如 sh512480 / 512480（A股 6 位可省前缀；000xxx 有歧义必须显式给）' },
    { name: 'period', type: 'string', default: 'day',   help: `周期：${PERIODS.join(' / ')}` },
    { name: 'adjust', type: 'string', default: 'qfq',   help: `复权：${ADJUSTS.join(' / ')}（none = 不复权）` },
    { name: 'count',  type: 'int',    default: 250,     help: '返回根数（实测 800 可用）' },
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

    const count = Math.max(1, Number(args.count) || 250);
    const fq = adjust === 'none' ? '' : adjust;
    const url = `${BASE}?param=${symbol},${period},,,${count},${fq}`;

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
      throw new CliError('NO_DATA', `tencent returned no kline rows for ${symbol} ${period}`);
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
