// fmp income — 利润表。
//
// 端点与形状（2026-09-19 实测）：
//   https://financialmodelingprep.com/stable/income-statement?symbol=AAPL&period=annual&limit=5&apikey=…
//   → [{"date":"2024-09-28","revenue":…,"grossProfit":…,"netIncome":…, …}]
//
// ⚠️ **402 是 `symbol` 级的，不是功能级的**（实测同日）：
//    AAPL → 200（正常返回 3 期）；PLAB（小盘）→ **402 Premium**。
//    所以 402 的文案**必须点名是哪个符号**，不能笼统说"财报端点不可用" ——
//    否则会得出"要升级套餐才能用财报"这种过宽的结论，而其实大盘股本来就通。
//
//   opencli fmp income AAPL --period annual --limit 5 -f json

import { cli, Strategy } from '@jackwener/opencli/registry';
import { CliError } from '@jackwener/opencli/errors';
import { incomeRow } from './_fmp.js';
import { fmpGet, requireKey } from './_call.js';

cli({
  site: 'fmp',
  name: 'income',
  access: 'read',
  description: '利润表（默认年报；免费档按 symbol 分档，小盘常 402）',
  domain: 'financialmodelingprep.com',
  strategy: Strategy.PUBLIC,
  browser: false,
  example: 'opencli fmp income AAPL --period annual --limit 5 -f json',
  args: [
    { name: 'symbol', required: true, positional: true, help: '代码，如 AAPL' },
    { name: 'period', type: 'string', default: 'annual', help: 'annual / quarter' },
    { name: 'limit',  type: 'int',    default: 5,        help: '期数' },
    { name: 'apikey', type: 'string', help: 'FMP key；省略则取环境变量 FMP_API_KEY（或 FMP_CONFIG 指向的配置文件）' },
  ],
  columns: [
    'symbol', 'date', 'period', 'revenue', 'costOfRevenue', 'grossProfit',
    'operatingIncome', 'netIncome', 'eps', 'ebitda',
  ],
  func: async (args) => {
    const symbol = String(args.symbol ?? '').trim().toUpperCase();
    if (!symbol) throw new CliError('INVALID_ARGUMENT', '需要 --symbol');
    const period = String(args.period ?? 'annual').toLowerCase();
    if (period !== 'annual' && period !== 'quarter') {
      throw new CliError('INVALID_ARGUMENT', `period 只认 annual / quarter，收到 ${period}`);
    }

    const { key } = requireKey(args.apikey);
    // ⚠️ 402 会在这里被 classifyHttp 翻成 PLAN_RESTRICTED，文案自带 symbol ——
    //    让它冒出去，别在这里 catch 成一个笼统的"财报不可用"。
    const rows = await fmpGet('/income-statement', {
      symbol, period, limit: Math.max(1, Number(args.limit) || 5),
    }, key, symbol);
    if (rows.length === 0) {
      // ⚠️ **符号拼错不是走到这里**。实测（2026-09-19）本端点对「拼错的符号」
      //    和「套餐不含的真实小盘（PLAB）」**都回 402** —— 两者分不开，
      //    所以别在 NOT_FOUND 里猜"是不是拼错了"（那是 PLAN_RESTRICTED 那条路）。
      throw new CliError('NO_DATA', `${symbol} 没返回任何期数（符号本身通了，但上游没给数据）`);
    }
    return rows.map(incomeRow);
  },
});
