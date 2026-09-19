// tencent quote 的纯函数层 —— 不联网，所以能离线测（同本仓 `_pool.js` / `_datacenter.js` 的惯例）。
//
// 为什么 `num` 要从 `quote.js` 搬出来：它原本是那个命令文件里的**私有函数**，
// 于是**测不到** —— 而它恰恰是全仓四个同名 `num` 里**唯一没有测试**的那个，
// 注释里钉着的又是真踩过的坑（见下）。纯逻辑私有 = 只有注释活着，注解不会报警。

/**
 * 数字转换。**「没有值」一律 null，绝不变成 0。**
 *
 * ⚠️ 必须显式拦空串，不能只靠 `Number.isFinite` —— `Number('')` 是 **0**，而 0 是有限的，
 *    于是会被静默当成真值。这个端点用 `~` 分隔、**没有值的字段就是空的**，所以踩得到：
 *    实测 `sh512480`（ETF）的 `f[39]`（市盈率）是**空串**，旧写法会输出 `"pe": 0`
 *    —— 一个 ETF 的「市盈率 0」看着像真数，其实是上游没给。
 *
 * ⚠️ `Number(null)` 同样是 0 且有限 —— 所以 `null` / `undefined` 也要显式拦，
 *    不能只靠空串那一支。（本仓在 `_datacenter.js` 上正是栽在这一格。）
 */
export const num = (v) => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string' && v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
