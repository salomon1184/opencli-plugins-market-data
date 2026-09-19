// fmp profile — 公司档案（现价/市值/52周区间/板块…）。
//
// 端点与形状（2026-09-19 实测）：
//   https://financialmodelingprep.com/stable/profile?symbol=AAPL&apikey=…
//   → [{"symbol":"AAPL","companyName":"Apple Inc.","price":…,"marketCap":…,
//       "range":"…-…","sector":"…","changePercentage":…, …}]
//
// ⚠️ **一次只能一个符号**。`?symbol=AAPL,MSFT` 返回 **200 + 空数组**（实测），
//   不是报错 —— 静默返空。所以本命令对每个符号**各发一次请求**，并把
//   「哪个符号没拿回唯一一条」**指名报出来**，绝不让它静默变成"这只没数据"。
//
// ⚠️ **本命令不替你限速**。免费档连续请求会 429，节奏由调用方管：
//   符号多时用 `--delay` 拉开，或干脆外部循环逐只调（那样单只失败不拖累其余）。
//   实测参考：原脚本用「每只间隔 7s、429 退避 12s」。见 README「限速」。
//
//   opencli fmp profile AAPL
//   opencli fmp profile "AAPL,MSFT" --delay 7 -f json

import { cli, Strategy } from '@jackwener/opencli/registry';
import { CliError } from '@jackwener/opencli/errors';
import { profileRow } from './_fmp.js';
import { fmpGet, requireKey } from './_call.js';

const splitSymbols = (s) =>
  String(s ?? '')
    .split(/[\s,]+/)
    .map((x) => x.trim().toUpperCase())
    .filter(Boolean);

const sleep = (sec) => new Promise((r) => setTimeout(r, sec * 1000));

cli({
  site: 'fmp',
  name: 'profile',
  access: 'read',
  description: '美股公司档案（现价/市值/52周区间/板块；一次一个符号，多个则逐个请求）',
  domain: 'financialmodelingprep.com',
  strategy: Strategy.PUBLIC,
  browser: false,
  example: 'opencli fmp profile "AAPL,MSFT" --delay 7 -f json',
  args: [
    { name: 'symbols', required: true, positional: true, help: '代码，逗号或空格分隔（如 "AAPL,MSFT"）' },
    { name: 'delay', type: 'int', default: 0, help: '符号之间的间隔秒数（免费档建议 5~7；本命令自己不限速）' },
    { name: 'apikey', type: 'string', help: 'FMP key；省略则取 FMP_API_KEY 或 OpenAlice 配置' },
  ],
  columns: [
    'symbol', 'name', 'price', 'marketCap', 'change', 'changePercentage',
    'range', 'sector', 'industry', 'exchange', 'currency', 'beta', 'averageVolume',
  ],
  func: async (args) => {
    const symbols = splitSymbols(args.symbols);
    if (symbols.length === 0) throw new CliError('INVALID_ARGUMENT', '至少要给一个代码');

    const { key } = requireKey(args.apikey);
    const delay = Math.max(0, Number(args.delay) || 0);

    const out = [];
    const missing = [];   // ⚠️ 收集而不是撞见就抛 —— 多符号时一次报全，才好处置
    for (let i = 0; i < symbols.length; i += 1) {
      if (i > 0 && delay > 0) await sleep(delay);
      const rows = await fmpGet('/profile', { symbol: symbols[i] }, key);
      if (rows.length !== 1) {
        // 0 条 = 该符号不存在 / 本套餐不覆盖（两者上游同形，区分不了，如实说）
        missing.push({ symbol: symbols[i], got: rows.length });
        continue;
      }
      out.push(profileRow(rows[0]));
    }

    if (missing.length) {
      const detail = missing.map((m) => `${m.symbol}(${m.got} 条)`).join('、');
      // ⚠️ 这里**绝不**"返回能拿到的那些就算了" —— 对一个选股筛选器来说，
      //    静默少一只 = 那只看起来"不满足条件"，而它其实只是没取到。
      throw new CliError(
        'NOT_FOUND',
        `这些符号没拿回唯一一条档案：${detail} —— ` +
          `FMP 对「符号不存在」和「不支持批量」都回 200+空数组，分不出是哪种。` +
          `要"跳过坏的、保留好的"，请改成逐只调用。`,
      );
    }
    return out;
  },
});
