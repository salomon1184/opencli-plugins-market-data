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
    { name: 'apikey', type: 'string', help: 'FMP key；省略则取 FMP_API_KEY 或 OpenAlice 配置' },
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
    }, key);
    if (rows.length === 0) {
      throw new CliError('NOT_FOUND', `${symbol} 没返回任何日线 —— 符号可能拼错（上游对不存在的符号回 200+空数组）`);
    }

    const mapped = rows.map(eodRow);
    const last = Number(args.last);
    // ⚠️ 上游是**倒序**（最新在前）—— 实测确认。所以取前 N 条才是"最近的 N 条"。
    return Number.isFinite(last) && last > 0 ? mapped.slice(0, last) : mapped;
  },
});
