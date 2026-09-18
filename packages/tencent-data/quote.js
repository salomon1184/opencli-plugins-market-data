// tencent quote — 实时行情（多标的，逗号分隔，一次请求）。
//
// 端点与形状（2026-09-19 实测）：
//   https://qt.gtimg.cn/q=sh512480,sz159915
//   → v_sh512480="1~半导体ETF国联安~512480~1.041~1.001~1.017~…";
//
// ⚠️ **返回的是 GBK 文本，不是 UTF-8**。直接 `resp.text()` 会把中文名称解成乱码
//   （实测：`半导体ETF国联安` 变 `�뵼��ETF����`）。必须先 `arrayBuffer()` 再用
//   `TextDecoder('gbk')`。
//
// ⚠️ **返回的不是 JSON**，是 `v_<sym>="…";` 每条一行、`~` 分隔的文本。
//   所以这里要自己切分 —— 别指望 `resp.json()`。
//
// 字段位置（**实测核对过**，用 512480 的已知开/收/高/低/昨收对出来的）：
//   [1] 名称   [2] 代码   [3] 现价   [4] 昨收   [5] 今开   [6] 成交量(手)
//   [30] 时间戳(YYYYMMDDHHMMSS)  [31] 涨跌额  [32] 涨跌%  [33] 最高  [34] 最低
//   [36] 成交量(股，与 [6] 同值)  [37] 成交额（⚠️ **单位随市场变**）  [38] 换手率%
//   [39] 市盈率  [43] 振幅%  [44] 流通市值(亿)  [45] 总市值(亿)
//
// ⚠️ **[37] 成交额的单位不是固定的**（2026-09-19 实测）：
//     A股 `sh512480` → 154977（**万元**）；港股 `hk00700` → 12180786280（**元**，≈121.8 亿）。
//     所以本适配器**不替调用方归一**（归一就得猜），字段名也只叫 `amount`、
//     **不叫 `amountWan`** —— 曾用名会让人在港股上少算四个数量级。
//   共 88 个字段。**只映射核对过的那几个** —— 没核对的宁可不出，免得给个看着像的错数。
//
//   opencli tencent quote sh512480
//   opencli tencent quote "512480,159915,sh000001" -f json

import { cli, Strategy } from '@jackwener/opencli/registry';
import { CliError } from '@jackwener/opencli/errors';
import { resolveSymbol, splitSymbols } from './_symbol.js';

const BASE = 'https://qt.gtimg.cn/q=';

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

cli({
  site: 'tencent',
  name: 'quote',
  access: 'read',
  description: '实时行情（A股/港股/美股；多标的逗号分隔，一次请求）',
  domain: 'qt.gtimg.cn',
  strategy: Strategy.PUBLIC,
  browser: false,
  example: 'opencli tencent quote "sh512480,sz159915" -f json',
  args: [
    { name: 'symbols', required: true, positional: true, help: '代码，逗号分隔，如 "512480,159915"（A股 6 位可省前缀）' },
    { name: 'market',  type: 'string', default: '', help: '强制市场前缀 sh/sz/hk/us —— 仅 000xxx 这类歧义代码需要' },
  ],
  columns: [
    'symbol', 'name', 'price', 'prevClose', 'open',
    'change', 'changePercent', 'high', 'low',
    'volume', 'amount', 'turnoverRate', 'amplitude', 'pe',
    'floatCapYi', 'totalCapYi', 'time',
  ],
  func: async (args) => {
    const inputs = splitSymbols(args.symbols ?? args.symbol);
    if (inputs.length === 0) {
      throw new CliError('INVALID_ARGUMENT', 'at least one symbol is required');
    }
    let symbols;
    try {
      symbols = inputs.map((s) => resolveSymbol(s, { market: args.market }));
    } catch (e) {
      throw new CliError('INVALID_ARGUMENT', e.message);
    }

    const resp = await fetch(BASE + symbols.join(','), { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!resp.ok) throw new CliError('HTTP_ERROR', `tencent quote failed: HTTP ${resp.status}`);

    // GBK —— 见文件头警告
    const text = new TextDecoder('gbk').decode(await resp.arrayBuffer());

    const out = [];
    for (const raw of text.split(';')) {
      // ⚠️ **必须 trim**：答复是 `v_aaa="…";\nv_bbb="…";\n`，第二段起以换行开头。
      //    不加 `m` 标志的正则里 `^` 锚的是整个字符串，不 trim 就只匹配得到第一条
      //    （实测：传 3 个代码只回来 1 行）。
      const line = raw.trim();
      const m = line.match(/^v_([a-z]{2}\w+)="(.*)"$/);
      if (!m) continue;
      const sym = m[1];
      const f = m[2].split('~');
      if (f.length < 35 || !f[1]) continue;      // 空标的（代码不存在）会被跳过

      out.push({
        symbol: sym,
        name: f[1],
        price: num(f[3]),
        prevClose: num(f[4]),
        open: num(f[5]),
        change: num(f[31]),
        changePercent: num(f[32]),
        high: num(f[33]),
        low: num(f[34]),
        volume: num(f[6]),
        amount: num(f[37]),   // ⚠️ 单位随市场变，见文件头
        turnoverRate: num(f[38]),
        pe: num(f[39]),
        amplitude: num(f[43]),
        floatCapYi: num(f[44]),
        totalCapYi: num(f[45]),
        time: f[30] || '',
      });
    }
    if (out.length === 0) {
      throw new CliError('NO_DATA', 'tencent returned no quote rows — 代码可能都不对');
    }
    return out;
  },
});
