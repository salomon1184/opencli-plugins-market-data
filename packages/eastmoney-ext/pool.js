// eastmoney pool — 涨停 / 跌停 / 炸板 / 强势 / 次新 五个股池（打板情绪数据）。
//
// 为什么需要它：内置 eastmoney 没有这一类。最接近的 `hot-rank` 是**热股榜**
//   （人气排序，且要 cookie），与「今天谁封板了、几点封的、封了多少钱」不是一回事。
//   所以这是**新增命令**，不是覆盖 —— 内置没有 `pool` 这个名字，不存在撞名。
//
// 端点与形状（2026-09-19 实测）：
//   https://push2ex.eastmoney.com/getTopicZTPool?ut=…&dpt=wz.ztzt&Pageindex=0
//     &pagesize=50&sort=fbt:asc&date=20260918
//   → {"rc":0,"data":{"tc":78,"qdate":20260918,"pool":[{…}]}}
//   五个池只差路径里的 ZT / DT / ZB / QS / CX。
//
// 字段解码、池定义、行映射都在 **_pool.js**（那样才能不联网地测）——
// 本文件只负责「发请求 + 把失败翻译成 CliError」。
//
// ⚠️ **`qdate` 不能用来校验日期**。实测传 `date=20260904`，`qdate` 仍然回
//   `20260918`（最新交易日）—— 但**数据是按 date 给的**（同一天 09-18 有 78 家涨停、
//   09-04 有 39 家，各重复两次调用结果一致）。所以 `qdate` 只是个「最新交易日」标注，
//   拿它跟请求日期比对会**误杀所有历史查询**。
//
// ⚠️ **push2ex 的 token 与 push2 系列不是同一个**（2026-09-19 实测）：
//   内置 eastmoney 全站用的 `bd1d9ddb04089700cf9c27f6f7426281` 在这个 host 上
//   直接 `rc:205, data:null` —— 看着像「没数据」，实则是 token 不对，很能骗人。
//
//   opencli eastmoney pool --type zt --date 2026-09-18 -f json
//   opencli eastmoney pool --type zb --date 2026-09-04 --limit 50   # 有意取前 50（会告警）
//   opencli eastmoney pool --type dt --date 2026-09-18   # 空池返回 []，不是错误
//
// ⚠️ **`--limit` 省略 = 尽量取全**（不是"默认 50"）。一次请求的 `pagesize` 开到 **500**
//   —— 那是**上限、不是承诺**：池子若超过 500 家（崩盘日的跌停池是有过的），
//   不会少给，而是**报错**（`TRUNCATED`）。上游 `data.tc` 才是真实家数，
//   `pagesize` 只是分页大小 —— 两者不等时，拿返回条数当家数会**静默少数**
//   （09-18 实际 78 家，旧的默认 50 会安安静静报成 50）。所以：
//     · 省略 `--limit` → 开 500 取全；若仍被截断（tc > 返回条数）→ **报错**，不静默少给。
//     · 显式给了 `--limit` → 视为有意截断，**只告警不改结果**（stderr）。
//   报错用 `TRUNCATED` 而非 `NO_DATA`：后者是「当天没有」，语义正好相反。

import { cli, Strategy } from '@jackwener/opencli/registry';
import { CliError } from '@jackwener/opencli/errors';
import { POOLS, mapPoolRow, toCompactDate, num, truncationCheck } from './_pool.js';

const BASE = 'https://push2ex.eastmoney.com/getTopic';
const UT = '7eea3edcaed734bea9cbfc24409ed989';   // ⚠️ 见文件头：这个 host 专用的 token

// 省略 `--limit` 时开的页大小。实测 pagesize=500 上游正常返回；真有一天超过它，
// 下面那条截断检查会**报错**而不是少给 —— 见 func 末尾。
const DEFAULT_ALL = 500;

cli({
  site: 'eastmoney',
  name: 'pool',
  access: 'read',
  description: '涨停/跌停/炸板/强势/次新 五个股池（含封板时间、封板资金、连板与炸板次数）',
  domain: 'push2ex.eastmoney.com',
  strategy: Strategy.PUBLIC,
  browser: false,
  example: 'opencli eastmoney pool --type zt --date 2026-09-18 -f json',
  args: [
    { name: 'type',  type: 'string', default: 'zt', help: '池：zt 涨停 / dt 跌停 / zb 炸板 / qs 强势 / cx 次新' },
    // 必传：不传上游直接 rc:102，**不会**回退到当天（实测），所以这里也不给它默认值。
    { name: 'date',  type: 'string', required: true, help: '交易日 YYYY-MM-DD（必传 —— 不传上游报 rc:102，不会默认当天）' },
    // ⚠️ **刻意不给默认值**：省略 = 取全部，显式给 = 有意截断。
    //    给了默认值就分不清这两者 —— 而它们的处置相反（一个该报错，一个只该提醒）。
    { name: 'limit', type: 'int',    help: '返回数量（省略 = 取全部；显式给 = 有意截断并告警）' },
  ],
  columns: [
    'rank', 'code', 'name', 'price', 'changePercent',
    'amount', 'turnoverRate', 'floatCap', 'totalCap', 'industry',
    'limitUpPrice', 'firstLimitTime', 'lastLimitTime', 'limitUpFund',
    'breakCount', 'consecutive', 'boardDays', 'boardCount', 'openCount',
    'pe', 'volumeRatio',
  ],
  func: async (args) => {
    const typeKey = String(args.type ?? 'zt').toLowerCase();
    const pool = POOLS[typeKey];
    if (!pool) {
      throw new CliError(
        'INVALID_ARGUMENT',
        `未知的池 "${typeKey}" —— 可选：${Object.keys(POOLS).join(' / ')}`,
      );
    }

    // toCompactDate 认不出会给 null（它不抛 —— 抛什么错误类型是这一层的事）。
    const date = toCompactDate(args.date);
    if (!date) {
      throw new CliError(
        'INVALID_ARGUMENT',
        `无法识别的日期 "${args.date}" —— 请给 YYYY-MM-DD（如 2026-09-18）或 YYYYMMDD。`,
      );
    }

    // ⚠️ 默认**不截断**。上游 `data.tc` 是真实家数，`pagesize` 只是分页大小 ——
    //    两者不等时，拿「返回条数」当家数就会**静默少数**：09-18 实际 78 家涨停，
    //    旧的默认 50 会安安静静报成 50。
    const explicitLimit = args.limit !== undefined && args.limit !== null && args.limit !== '';
    const limit = explicitLimit ? Math.max(1, Number(args.limit) || 1) : DEFAULT_ALL;

    const url = new URL(BASE + pool.path + 'Pool');
    url.searchParams.set('ut', UT);
    url.searchParams.set('dpt', 'wz.ztzt');
    url.searchParams.set('Pageindex', '0');
    url.searchParams.set('pagesize', String(limit));
    url.searchParams.set('sort', pool.sort);
    url.searchParams.set('date', date);

    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://quote.eastmoney.com/' },
    });
    if (!resp.ok) throw new CliError('HTTP_ERROR', `eastmoney pool failed: HTTP ${resp.status}`);

    let payload;
    try {
      payload = await resp.json();
    } catch {
      throw new CliError('NO_DATA', 'eastmoney pool returned a non-JSON body');
    }
    if (Number(payload?.rc) !== 0) {
      // rc:205 通常是 token 不对（见文件头）；rc:102 是没给 date（我们设成必传了）。
      throw new CliError('NO_DATA', `eastmoney pool 返回 rc=${payload?.rc}（${pool.label}池，date=${date}）`);
    }
    const data = payload?.data;
    if (!data || !Array.isArray(data.pool)) {
      throw new CliError('NO_DATA', `eastmoney pool 无数据（${pool.label}池，date=${date}）—— 日期可能不是交易日`);
    }

    // ⚠️ **空池不是错误**：`tc:0, pool:[]` 是合法结果（那天就是没有跌停股）。
    //    这里返回空数组，让调用方能区分「当天没有」和「请求失败」——
    //    与 README「真空数据与请求失败分开处置」是同一个立场。
    const rows = data.pool.map(mapPoolRow);

    // ⚠️ 截断必须**有声**（判定逻辑与其理由见 _pool.js 的 truncationCheck）。
    const truncated = truncationCheck(num(data.tc), rows.length, { explicitLimit, limit });
    if (truncated) {
      const where = `${pool.label}池 date=${date}：${truncated.detail}`;
      // ⚠️ 这里**不用 `NO_DATA`**。两者都会被调用方按 `code` 分支，而语义正好相反：
      //    `NO_DATA` = 「当天没有」，`TRUNCATED` = 「有，但没给全」。
      //    报成 NO_DATA 会让调用方如实记下「9-18 没有涨停」—— 而实际是 78 家被扣住了。
      if (truncated.level === 'error') throw new CliError('TRUNCATED', where);
      console.error(`[pool] ⚠️ ${where}`);
    }
    return rows;
  },
});
