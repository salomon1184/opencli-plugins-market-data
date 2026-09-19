// datacenter.eastmoney.com 的纯函数层 —— 不联网，可离线测（同本仓其它 `_*.js`）。
//
// 为什么有这个适配器：`RPT_HKF10_FN_MAININDICATOR`（港股 F10 主要财务指标）此前在
// 工作区里是手写的分页脚本，而那个脚本有一个**静默截断**：它在「本页没数据」时
// `break` 当作"翻到底了" —— 可上游在**快速连打时会返回空**（原文："rapid repeated
// calls to push2/datacenter endpoints return empty"）。于是被限流的那次看起来
// 和"数据取完了"一模一样。
//
// 本适配器的核心就是**不猜**：上游在 `result.count` 里给了总条数，那就拿实际取回的
// 条数去对 —— 不等就是没取全，**报错**，绝不返回一个短表让调用方自己发现。
// （同一个教训在 `pool` 上是 `tc`，见该命令文件头。）

/**
 * 「没有值」→ null，**绝不变成 0**。
 *
 * ⚠️ 必须显式拦 `null` / `undefined` / 空串：`Number(null)` 是 0、`Number('')` 也是 0，
 *    两者都**有限**，只靠 `Number.isFinite` 会把"上游没给"读成"上游说是 0"。
 *    本仓已经在这上面栽过两次（`_pool.js` 的 `num`、`quote.js` 的 `num`），
 *    这里是第三次 —— 所以抽成有名字的函数配上测试，而不是继续裸写 `Number()`。
 */
export const numOrNull = (v) => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string' && v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * 拆 datacenter 的应答信封。
 *
 * 实测形状（2026-09-19）：
 *   {"version":…, "success":true, "code":0, "message":"ok",
 *    "result": {"pages":749, "count":2246, "data":[{…}]}}
 *
 * @returns {{ok:true, rows:Array, count:number|null, pages:number|null}
 *          | {ok:false, why:string}}
 */
export function parseDatacenter(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return { ok: false, why: `期望对象信封，实际是 ${Array.isArray(obj) ? 'array' : typeof obj}` };
  }
  // ⚠️ `success` 可能是 false 而 HTTP 仍是 200 —— 只 HTTP 状态判成败会漏掉这一层。
  if (obj.success === false) {
    return { ok: false, why: `上游 success=false：${obj.message ?? obj.code ?? '（无 message）'}` };
  }
  const r = obj.result;
  if (!r || typeof r !== 'object') {
    return { ok: false, why: `没有 result 段（message=${obj.message ?? '—'}）` };
  }
  const rows = Array.isArray(r.data) ? r.data : [];
  return {
    ok: true,
    rows,
    // count/pages 可能缺失 —— 缺失给 null，**不拿 0 冒充**（0 会被读成"上游说没有"）。
    // ⚠️ 走 numOrNull 而不是裸 `Number.isFinite(Number(x))`：后者对**显式的 null**
    //    会给出 0（`Number(null)` 是 0 且有限），于是 count=0 会让分页循环第一页就
    //    `break`（`rows.length >= 0` 恒真），再报出"上游说共 0 条"这种上游没说过的话。
    count: numOrNull(r.count),
    pages: numOrNull(r.pages),
  };
}

/**
 * 完整性核对：**这是本适配器存在的理由**。
 *
 * 上游给了 `count` 却不拿它核对，就等于自愿回到那个静默截断。
 *
 *   · 取回的少于 count → `error`（漏了，而且看不出漏在哪）
 *   · 取回的多于 count → 也 `error`（对不上就是理解错了分页，一样不能信）
 *   · count 拿不到       → `null`（不判定，但也**不假装核对过**）
 *
 * @returns {null | {level:'error', detail:string}}
 */
export function completenessCheck(fetched, count) {
  if (count === null || count === undefined || !Number.isFinite(count)) return null;
  if (fetched === count) return null;
  // ⚠️ 两个方向分开措辞。取少了是"漏"，取多了是"分页/口径理解有误" ——
  //    都不该发生，但用一个"只取回 N 条"去描述超额，读起来是反的。
  const detail = fetched < count
    ? `上游说共 ${count} 条，只取回 ${fetched} 条`
    : `上游说共 ${count} 条，却取回 ${fetched} 条（多出来了 —— 分页或口径理解有误）`;
  return { level: 'error', detail };
}
