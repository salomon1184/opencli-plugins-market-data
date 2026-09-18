// tencent minute — 当日分时（1 分钟粒度）。
//
// 端点与形状（2026-09-19 实测）：
//   https://web.ifzq.gtimg.cn/appstock/app/minute/query?code=sh512480
//   → {"data":{"sh512480":{"data":{"data":["0930 1.017 97858 9952159.00", …],"date":"20260918"}, …}}}
//
//   每行是 `"HHMM 价格 成交量 成交额"`（空格分隔），**不是 JSON 数组**，要自己切。
//   实测一个交易日 267 行（含 09:30–11:30 / 13:00–15:00）。
//
// ⚠️ **只给「当日」** —— 这个端点没有日期参数。要历史分时得另找路。
//   （分钟 K 线的那个端点 `…/appstock/app/kline/mkline` 明文 HTTP 走不通：
//    四种周期全试过，一律 `SSL: UNEXPECTED_EOF_WHILE_READING`。）
//
//   opencli tencent minute sh512480
//   opencli tencent minute 512480 -f json

import { cli, Strategy } from '@jackwener/opencli/registry';
import { CliError } from '@jackwener/opencli/errors';
import { resolveSymbol } from './_symbol.js';

const BASE = 'https://web.ifzq.gtimg.cn/appstock/app/minute/query?code=';

cli({
  site: 'tencent',
  name: 'minute',
  access: 'read',
  description: '当日分时（1 分钟粒度，A股/港股/美股）',
  domain: 'web.ifzq.gtimg.cn',
  strategy: Strategy.PUBLIC,
  browser: false,
  example: 'opencli tencent minute sh512480 -f json',
  args: [
    { name: 'symbol', required: true, positional: true, help: '代码，如 sh512480 / 512480（A股 6 位可省前缀）' },
    { name: 'market', type: 'string', default: '', help: '强制市场前缀 sh/sz/hk/us —— 仅 000xxx 这类歧义代码需要' },
  ],
  columns: ['date', 'time', 'price', 'vol', 'amount'],
  func: async (args) => {
    let symbol;
    try {
      symbol = resolveSymbol(args.symbol, { market: args.market });
    } catch (e) {
      throw new CliError('INVALID_ARGUMENT', e.message);
    }

    const resp = await fetch(BASE + symbol, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!resp.ok) throw new CliError('HTTP_ERROR', `tencent minute failed: HTTP ${resp.status}`);

    let payload;
    try {
      payload = await resp.json();
    } catch {
      throw new CliError('NO_DATA', 'tencent minute returned a non-JSON body');
    }
    const node = payload?.data?.[symbol]?.data;
    const rows = node?.data;
    if (!Array.isArray(rows) || rows.length === 0) {
      throw new CliError('NO_DATA', `tencent returned no minute rows for ${symbol}（非交易日或该标的无分时）`);
    }
    const date = node.date || '';

    const out = [];
    for (const line of rows) {
      const p = String(line).trim().split(/\s+/);
      if (p.length < 2) continue;
      out.push({
        date,
        time: p[0],
        price: Number(p[1]),
        vol: p.length > 2 ? Number(p[2]) : null,
        amount: p.length > 3 ? Number(p[3]) : null,
      });
    }
    if (out.length === 0) {
      throw new CliError('NO_DATA', `tencent minute rows for ${symbol} 全部解析失败 —— 形状可能变了`);
    }
    return out;
  },
});
