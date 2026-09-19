// fmp eod — 日线（historical-price-eod）。
//
// 端点与形状（2026-09-19 实测）：
//   https://financialmodelingprep.com/stable/historical-price-eod/full?symbol=AAPL&serietype=line&apikey=…
//   → [{"symbol":"AAPL","date":"…","open":…,"high":…,"low":…,"close":…,
//       "volume":…,"change":…,"changePercent":…,"vwap":…}, …]
//
// 实测 AAPL 返回 **1255 条**（全历史），所以：
//   · 想只要末段用 `--last N`（**在本地截**，不是让上游少给 —— 上游没有这个参数，
//     假装有就会静默拿到全量再自己切，不如把语义写清楚）。
//   · `--from/--to` 才是**上游的**区间过滤（YYYY-MM-DD）。
//
// ⚠️ 与 profile/income 一样，402 是 symbol 级的；`serietype` 默认 `line`
//   （与原脚本一致 —— 改成 `chart` 会给另一套字段）。
//
//   opencli fmp eod AAPL --last 250 -f json
//   opencli fmp eod AAPL --from 2026-01-01 --to 2026-09-18 -f json

import { cli, Strategy } from '@jackwener/opencli/registry';
import { CliError } from '@jackwener/opencli/errors';
import { eodRow } from './_fmp.js';
import { fmpGet, requireKey } from './_call.js';

cli({
  site: 'fmp',
  name: 'eod',
  access: 'read',
  description: '日线历史（historical-price-eod；默认全历史，可用 --last/--from/--to 收窄）',
  domain: 'financialmodelingprep.com',
  strategy: Strategy.PUBLIC,
  browser: false,
  example: 'opencli fmp eod AAPL --last 250 -f json',
  args: [
    { name: 'symbol', required: true, positional: true, help: '代码，如 AAPL' },
    { name: 'from', type: 'string', help: '起始日 YYYY-MM-DD（上游过滤）' },
    { name: 'to',   type: 'string', help: '结束日 YYYY-MM-DD（上游过滤）' },
    { name: 'last', type: 'int', help: '只要最近 N 条（**本地截取**，不是上游参数）' },
    { name: 'apikey', type: 'string', help: 'FMP key；省略则取环境变量 FMP_API_KEY（或 FMP_CONFIG 指向的配置文件）' },
  ],
  columns: ['symbol', 'date', 'open', 'high', 'low', 'close', 'volume', 'change', 'changePercent', 'vwap'],
  func: async (args) => {
    const symbol = String(args.symbol ?? '').trim().toUpperCase();
    if (!symbol) throw new CliError('INVALID_ARGUMENT', '需要 --symbol');

    const { key } = requireKey(args.apikey);
    const rows = await fmpGet('/historical-price-eod/full', {
      symbol,
      serietype: 'line',
      from: args.from ?? null,
      to: args.to ?? null,
    }, key, symbol);
    if (rows.length === 0) {
      // ⚠️ 注意：**符号拼错不是走到这里**。实测（2026-09-19）本端点对「拼错的符号」
      //    和「套餐不含的真实小盘」**都回 402** —— 所以在 402 与拼错之间**分不开**，
      //    别在 NOT_FOUND 的文案里猜"是不是拼错了"（那是 PLAN_RESTRICTED 那条路）。
      //    能走到这里的是：符号没问题、但 `--from/--to` 把区间滤空了。
      throw new CliError('NO_DATA', `${symbol} 在该区间内没有日线 —— 检查 --from/--to 是否把范围滤空了`);
    }

    const mapped = rows.map(eodRow);
    const last = Number(args.last);
    // ⚠️ 上游是**倒序**（最新在前）—— 实测确认。所以取前 N 条才是"最近的 N 条"。
    return Number.isFinite(last) && last > 0 ? mapped.slice(0, last) : mapped;
  },
});
