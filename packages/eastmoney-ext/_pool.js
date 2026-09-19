// pool 命令的纯逻辑：池定义、字段解码、行映射。
//
// 为什么单独一个文件（两个理由）：
//   1. 和 _symbol.js 同一个约定 —— `_` 前缀 = 只被 import、不当命令注册。
//   2. **可测**。这里的每一个函数都是「输入 → 输出」的纯映射，没有网络、没有
//      `@jackwener/opencli/*` 的 import（那两个在插件仓库里裸跑是解析不了的，
//      所以错误类型 CliError 留在 pool.js 那一层，这里坏输入一律返回 null）。
//
// ⚠️ 本文件里的每个常量/分支都是**实测**得来的，不是查文档猜的。改之前先看
//    pool.js 文件头那份实测记录。

/** 池名 → 端点路径段 + 该池自己的默认排序键。 */
export const POOLS = {
  zt: { path: 'ZT', sort: 'fbt:asc',  label: '涨停' },
  dt: { path: 'DT', sort: 'fund:asc', label: '跌停' },
  zb: { path: 'ZB', sort: 'fbt:asc',  label: '炸板' },
  qs: { path: 'QS', sort: 'zdp:desc', label: '强势' },
  cx: { path: 'CX', sort: 'zdp:desc', label: '次新' },
};

/**
 * 上游对「没有涨跌幅限制」的标的（`C` 开头的次新股、上市首日等）**不留空**，
 * 而是用这个值当**哨兵**填 `ztp`（实测 CX 池的 C沈鼓 / C信诺维 都是
 * `ztp=1000000000`，配套 `ztf=0`）。必须在 ÷1000 **之前**拦掉 ——
 * 否则会得到「涨停价 1000000 元」这种看着完全像真数的假值。
 */
export const PRICE_SENTINEL = 1000000000;

/**
 * 数字转换。**「没有值」一律 null，绝不变成 0。**
 *
 * ⚠️ 这里必须显式拦 `null` / `undefined` / 空串，不能只靠 `Number.isFinite` ——
 *    `Number(null)` 是 0、`Number('')` 也是 0，两者都**有限**，会被静默当成真值 0。
 *    上游确实会**显式给 null**（实测龙虎榜应答里就有 `"D1_CLOSE_ADJCHRATE":null`），
 *    所以「假 0」不是假想问题。真的 0 上游会给 `0`，那才会留成 0。
 */
export const num = (v) => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string' && v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** 价格字段：上游是 ×1000 的整数编码，还原成元。空值/哨兵都给 null。 */
export const price = (v) => {
  const n = num(v);
  if (n === null || n === PRICE_SENTINEL) return null;
  return n / 1000;
};

/** `92500` → `09:25:00`。上游给的是 HHMMSS 整数，补零是这个函数的全部意义。 */
export function hhmmss(v) {
  const n = num(v);
  if (n === null) return null;
  const s = String(Math.trunc(n)).padStart(6, '0');
  return `${s.slice(0, 2)}:${s.slice(2, 4)}:${s.slice(4, 6)}`;
}

/**
 * `2026-09-18` / `20260918` → `20260918`。**认不出返回 null**（不猜、不抛 ——
 * 抛什么错误类型是命令层的事，见 pool.js）。
 */
export function toCompactDate(input) {
  const raw = String(input || '').trim();
  if (/^\d{8}$/.test(raw)) return raw;
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[1]}${m[2]}${m[3]}` : null;
}

/**
 * 一条池记录 → 输出行。
 *
 * ⚠️ **五个池的字段并不一致**，所以这里出的是**并集**，该池没有的填 null：
 *   · ZT 涨停：lbc 连板 / fbt 首封 / lbt 末封 / fund 封板资金 / zbc 炸板次数 / zttj{days,ct}
 *   · DT 跌停：**没有 zttj**（`days` 是平的）、没有 fbt/zbc/lbc；另有 oc / pe
 *   · ZB 炸板：ztp / zf / fbt / zbc / zttj
 *   · QS 强势：ztp / ztf / lb 量比 / nh / cc / zttj
 *   · CX 次新：ztp / ztf / ods / od / ipod / nh / zttj
 * 把 `lbc` 当所有池都有，就会在跌停池上静默给一列 null。
 *
 * 单位：`amount` / `floatCap` / `totalCap` / `limitUpFund` 是**元**，原样透传
 * （同 quote.js 对 `amount` 的处理：不替调用方归一，字段名也不带单位后缀）；
 * 只有价格字段做 ×1000 的**去编码**还原，见 `price`。
 */
export function mapPoolRow(it, index) {
  return {
    rank: index + 1,
    code: it.c,
    name: it.n,
    price: price(it.p),
    changePercent: num(it.zdp),
    amount: num(it.amount),         // 元
    turnoverRate: num(it.hs),       // %
    floatCap: num(it.ltsz),         // 元
    totalCap: num(it.tshare),       // 元
    industry: it.hybk ?? null,
    limitUpPrice: price(it.ztp),    // 仅 zb/qs/cx 有
    firstLimitTime: hhmmss(it.fbt), // 仅 zt/zb 有
    lastLimitTime: hhmmss(it.lbt),  // 仅 zt/dt 有
    limitUpFund: num(it.fund),      // 仅 zt/dt 有，元
    breakCount: num(it.zbc),        // 仅 zt/zb 有
    consecutive: num(it.lbc),       // 连板数，仅 zt 有
    // zttj 是嵌套的 {days,ct}（zt/zb/qs/cx）；dt 给的是平的 `days`，没有 ct。
    boardDays: num(it.zttj?.days ?? it.days),
    boardCount: num(it.zttj?.ct),
    openCount: num(it.oc),          // 仅 dt 有
    pe: num(it.pe),                 // 仅 dt 有
    volumeRatio: num(it.lb),        // 量比，仅 qs 有
  };
}
