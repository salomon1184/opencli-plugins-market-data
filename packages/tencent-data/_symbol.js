// tencent 适配器的共享符号解析。
//
// 腾讯行情端点的代码形态是「市场前缀 + 代码」，如 `sh512480` / `sz159915` /
// `hk00700` / `usAAPL`。这个文件是**唯一**的解析处 —— 三个命令都从这里取，
// 免得三份各写一遍、然后慢慢漂。
//
// ⚠️ **为什么 `000xxx` 必须显式给前缀**：
//   `000001` 既可以是上证指数（`sh000001`）也可以是平安银行（`sz000001`）。
//   按首位数字猜是**猜不准**的，而猜错的后果是**静默返回另一个标的的数据** ——
//   比报错糟得多。所以这里直接拒绝，逼调用方说清楚。
//
// 市场覆盖（2026-09 状态）：
//   · A股（sh/sz）—— 前缀可**推断**，已完整支持
//   · 港股（hk）/ 美股（us）—— 端点本身是市场无关的，**显式前缀直接放行**，
//     所以 `hk00700` / `usAAPL` 今天就能用；只是**不做推断**（港股代码 5 位、
//     美股是字母，与 A股 的 6 位数字不冲突，但推断规则要各自定义，留待补齐）。
//
// ⚠️ **美股：两个端点要的形态是相反的**（2026-09-19 实测）。这是本文件存在的
//    第二个理由 —— 转换只在这里做，否则三份命令会各写一遍、然后慢慢漂：
//
//      qt.gtimg.cn（quote）        usAAPL      ✅      usAAPL.OQ   ❌ v_pv_none_match
//      web.ifzq.gtimg.cn（kline）  usAAPL.OQ   ✅      usAAPL      ❌ 静默返回 2 行假数据
//
//    `usAAPL` 那条最阴 —— 它**不报错**，只是永远只回「上市首日 + 最新」两行，
//    且无视 `--count`。所以两个命令各自显式声明自己要哪种形态（`toQuoteForm` /
//    `hasUsSuffix`），而不是靠猜。
//
//    顺带：quote 应答的 `f[2]` 会回显带后缀的真代码（`AAPL.OQ`），所以 kline
//    要的后缀是**可以从 quote 查出来的** —— 见 kline.js 的自动补全。

/** 允许的市场前缀。`_` 前缀文件不会被当成命令，只作为模块被 import。 */
export const MARKETS = ['sh', 'sz', 'hk', 'us'];

/**
 * 把用户输入解析成腾讯端点要的形态。
 *
 *   resolveSymbol('512480')  → 'sh512480'   （5/6/9 开头 → 沪）
 *   resolveSymbol('159915')  → 'sz159915'   （1/2/3 开头 → 深）
 *   resolveSymbol('sh512480')→ 'sh512480'   （已带前缀原样放行）
 *   resolveSymbol('hk00700') → 'hk00700'
 *   resolveSymbol('000001')  → 抛错（歧义，必须显式）
 *
 * @param {string} input
 * @param {{market?: string}} [opts] market 给定时强制用该前缀（歧义代码走这条）
 */
export function resolveSymbol(input, opts = {}) {
  const raw = String(input || '').trim();
  if (!raw) throw new Error('empty symbol');

  const forced = String(opts.market || '').trim().toLowerCase();
  if (forced) {
    if (!MARKETS.includes(forced)) {
      throw new Error(`unknown market "${opts.market}" — expected one of ${MARKETS.join(' / ')}`);
    }
    // 已经把前缀写在代码里了就别再叠一层（`sh000001` + market=sh）
    return MARKETS.includes(raw.slice(0, 2).toLowerCase()) ? raw.toLowerCase() : forced + raw.toLowerCase();
  }

  const prefixed = raw.slice(0, 2).toLowerCase();
  if (MARKETS.includes(prefixed)) return prefixed + raw.slice(2);

  if (!/^\d{6}$/.test(raw)) {
    throw new Error(
      `Unrecognized symbol "${raw}". A股请给 6 位数字（如 512480），` +
      `或带市场前缀（sh/sz/hk/us，如 hk00700）；裸的港股/美股代码本适配器不推断。`,
    );
  }

  const head = raw[0];
  if ('569'.includes(head)) return 'sh' + raw;
  if ('123'.includes(head)) return 'sz' + raw;
  if (head === '0') {
    throw new Error(
      `"${raw}" 有歧义：sh${raw} 是指数、sz${raw} 是个股 —— ` +
      `请显式给市场（--market sh 或直接写 sh${raw}）。猜错会静默返回另一个标的的数据。`,
    );
  }
  throw new Error(`Unrecognized symbol "${raw}".`);
}

/** 逗号/中文逗号/空白分隔，去空。多代码命令用它。 */
export function splitSymbols(s) {
  return String(s || '')
    .split(/[,，\s]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

/** 是否 A股（sh/sz）—— 用于「只对 A股有效」的字段映射，见 quote.js 的字段布局表。 */
export function isAShare(symbol) {
  const p = String(symbol || '').slice(0, 2).toLowerCase();
  return p === 'sh' || p === 'sz';
}

/** 是否美股（us 前缀）。 */
export function isUs(symbol) {
  return String(symbol || '').slice(0, 2).toLowerCase() === 'us';
}

/**
 * 把已解析的代码转成 **quote 端点**要的形态：美股剥掉交易所后缀。
 *
 *   toQuoteForm('usAAPL.OQ') → 'usAAPL'    （qt.gtimg.cn 认这个）
 *   toQuoteForm('usAAPL')    → 'usAAPL'
 *   toQuoteForm('sh512480')  → 'sh512480'  （非美股原样返回）
 *
 * 注意是「剥掉」而不是「报错」—— 带后缀的写法在 kline 那边是对的，用户很容易
 * 把那个写法顺手用到 quote 上，静默失败会很难查（实测 `v_pv_none_match` 只会
 * 被解析成一条空标的然后跳过，最终报「代码可能都不对」，指向错误的方向）。
 */
export function toQuoteForm(symbol) {
  const s = String(symbol || '');
  return isUs(s) ? s.replace(/\..*$/, '') : s;
}

/** 美股是否已带交易所后缀 —— kline 用它判断要不要补（`usAAPL.OQ` → true）。 */
export function hasUsSuffix(symbol) {
  const s = String(symbol || '');
  return isUs(s) && s.includes('.');
}
