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
