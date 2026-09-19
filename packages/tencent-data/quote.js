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
// ⚠️⚠️ **`f[46]` 之后，字段含义随市场变**（2026-09-19 实测，同一批请求对出来的）：
//
//     | 位置 | A股 sh512480 | 港股 hk00700 | 美股 usAAPL |
//     |------|--------------|--------------|-------------|
//     | [7]  | 外盘 8507165 | 0（无）      | 0（无）     |
//     | [8]  | 内盘 6488173 | 0（无）      | 0（无）     |
//     | [46] | 市净率 0.00  | **英文名** TENCENT    | **英文名** Apple Inc. |
//     | [47] | 涨停价 1.101 | 1.27         | 8.72        |
//     | [48] | 跌停价 0.901 | 52周高 677.70 | 52周高 344.26 |
//     | [49] | 量比 1.39    | 52周低 411.00 | 52周低 239.32 |
//     | [51] | 均价 1.033   | -25.88       | 45.62       |
//
//   `f[7]+f[8] = f[6]`（8507165+6488173 = 14995338 = 成交量）—— 内外盘这个口径对上了。
//
//   所以本适配器把**这些字段一律只在 A股（sh/sz）下填值**，港美股给 `null`。
//   给美股填一个「涨停价 344.26」正是本仓库最反对的那种静默错数 —— 看着像、实则是英文名；
//   给港股填「内盘 0」同样是假值（上游就没给，不是真的没人卖）。
//   （`f[43]振幅` / `f[44]流通市值` / `f[45]总市值` / `f[39]市盈率` 三市场都对得上，
//     已单独核对过，不受这条限制。）
//
// ⚠️ **美股代码形态**：这个端点认**裸代码**（`usAAPL`），认不出 `usAAPL.OQ`。
//   与 kline 端点正好相反 —— 见 _symbol.js 的文件头。这里用 `toQuoteForm` 统一剥后缀。
//
//   opencli tencent quote sh512480
//   opencli tencent quote "512480,159915,sh000001" -f json

import { cli, Strategy } from '@jackwener/opencli/registry';
import { CliError } from '@jackwener/opencli/errors';
import { resolveSymbol, splitSymbols, toQuoteForm, isAShare } from './_symbol.js';
// `num` 搬进了 _quote.js —— 私有函数测不到，而它注释里钉的正是踩过的坑。
import { num } from './_quote.js';

const BASE = 'https://qt.gtimg.cn/q=';

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
    'floatCapYi', 'totalCapYi',
    'outerVol', 'innerVol', 'volRatio', 'avgPrice',
    'pb', 'limitUp', 'limitDown',
    'time',
  ],
  func: async (args) => {
    const inputs = splitSymbols(args.symbols ?? args.symbol);
    if (inputs.length === 0) {
      throw new CliError('INVALID_ARGUMENT', 'at least one symbol is required');
    }
    let symbols;
    try {
      // toQuoteForm：本端点要美股**裸代码**，把用户在 kline 那边习惯写的 `.OQ` 后缀剥掉。
      symbols = inputs.map((s) => toQuoteForm(resolveSymbol(s, { market: args.market })));
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

      // f[7]/f[8] 与 f[46] 之后只在 A股下有意义（见文件头布局表）——
      // 港美股给 null，不给上游那个并没有含义的 0。
      const aShare = isAShare(sym);

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
        outerVol: aShare ? num(f[7]) : null,
        innerVol: aShare ? num(f[8]) : null,
        volRatio: aShare ? num(f[49]) : null,
        avgPrice: aShare ? num(f[51]) : null,
        pb: aShare ? num(f[46]) : null,
        limitUp: aShare ? num(f[47]) : null,
        limitDown: aShare ? num(f[48]) : null,
        time: f[30] || '',
      });
    }
    if (out.length === 0) {
      throw new CliError('NO_DATA', 'tencent returned no quote rows — 代码可能都不对');
    }
    return out;
  },
});
