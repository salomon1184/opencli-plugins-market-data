// eastmoney hk-f10 — 港股 F10 主要财务指标（全市场，按报告期）。
//
// 端点与形状（2026-09-19 实测）：
//   https://datacenter.eastmoney.com/securities/api/data/v1/get
//     ?reportName=RPT_HKF10_FN_MAININDICATOR
//     &columns=SECURITY_CODE,SECURITY_NAME_ABBR,REPORT_DATE,PE_TTM,…
//     &filter=(REPORT_DATE='2025-12-31')&pageNumber=1&pageSize=3
//     &source=HSF10&client=PC
//   → {"version":…, "success":true, "code":0, "message":"ok",
//      "result": {"pages":749, "count":2246, "data":[{…}]}}
//
// ⚠️ **这是一个 `datacenter` host，与 `push2` / `push2ex` 各自独立计量**
//   （同本仓 README「各 host 独立计量」）。push2 被封不代表它不可用，反之亦然。
//
// ⚠️⚠️ **本命令的要点是"不猜到底了没有"**。上游在**快速连打时会返回空**
//   （原文："rapid repeated calls to push2/datacenter endpoints return empty"），
//   而一次空答复与"翻到最后一页"**形状完全一样**。手写分页脚本在这里会
//   **静默截断**（工作区原有的那份就是 `if not rows: break`）。
//   本命令拿上游给的 `result.count` 对账：少一条就**报错**，绝不返回短表。
//   因此 `--page-delay` 不加也能保证**不会悄悄少给**，只会**大声失败**。
//
//   opencli eastmoney hk-f10 --date 2025-12-31 -f json
//   opencli eastmoney hk-f10 --date 2026-06-30 --page-delay 3 -f json

import { cli, Strategy } from '@jackwener/opencli/registry';
import { CliError } from '@jackwener/opencli/errors';
import { parseDatacenter, completenessCheck } from './_datacenter.js';

const BASE = 'https://datacenter.eastmoney.com/securities/api/data/v1/get';
const REPORT_NAME = 'RPT_HKF10_FN_MAININDICATOR';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/124 Safari/537.36',
  Referer: 'https://emweb.securities.eastmoney.com/',
};

// 默认只取**窄列**（全列很重）。这是原脚本用的那一套，口径与它一致。
const DEFAULT_COLUMNS = [
  'SECURITY_CODE', 'SECURITY_NAME_ABBR', 'REPORT_DATE', 'REPORT_TYPE',
  'PE_TTM', 'PB_TTM', 'TOTAL_MARKET_CAP',
  'ROE_YEARLY', 'ROE_AVG', 'ROE_AVG_SQ',
  'OPERATE_INCOME_YOY', 'OPERATE_INCOME',
  'BASIC_EPS', 'EPS_TTM', 'CURRENCY',
].join(',');

// 实测 500 是被接受的页大小；再大未见得收，所以不往上涨。
const DEFAULT_PAGE_SIZE = 500;
// 安全阀：正常全市场约 5 页（2246 条 / 500）。页数爆掉说明分页理解错了，该停。
const DEFAULT_MAX_PAGES = 50;

const sleep = (sec) => new Promise((r) => setTimeout(r, sec * 1000));

/**
 * 读一个**带横线**的参数。
 *
 * ⚠️ opencli 是 `--${arg.name}` 原样拼标志的，所以 `page-delay` 这个参数在
 *    `args` 里的键就是 **`'page-delay'`**，不是 `page_delay` 也不是 `pageDelay`。
 *    实测踩过：写成 `args.page_delay` 会拿到 `undefined` → `|| 0` → **标志被静默忽略**
 *    （`--page-delay 3` 跑出来 0 秒停顿，而结果看起来完全正常）。
 *    camelCase 也试一下，防止中间层改名。
 */
const argOf = (args, kebab) => {
  const v = args[kebab];
  if (v !== undefined && v !== null && v !== '') return v;
  return args[kebab.replace(/-([a-z])/g, (_m, c) => c.toUpperCase())];
};

cli({
  site: 'eastmoney',
  name: 'hk-f10',
  access: 'read',
  description: '港股 F10 主要财务指标（全市场，按报告期；分页取全并核对 count，不静默截断）',
  domain: 'datacenter.eastmoney.com',
  strategy: Strategy.PUBLIC,
  browser: false,
  example: "opencli eastmoney hk-f10 --date 2025-12-31 -f json",
  args: [
    { name: 'date', type: 'string', required: true, help: "报告期 REPORT_DATE，YYYY-MM-DD（如 2025-12-31 年报 / 2026-06-30 中报）" },
    { name: 'page-size', type: 'int', default: DEFAULT_PAGE_SIZE, help: `每页条数（实测上限 ${DEFAULT_PAGE_SIZE}）` },
    { name: 'page-delay', type: 'int', default: 0, help: '翻页间隔秒数（本命令不替你限速；被限流时会**报错**而不是少给）' },
    { name: 'max-pages', type: 'int', default: DEFAULT_MAX_PAGES, help: '页数安全阀' },
    { name: 'columns', type: 'string', help: '覆盖默认列（逗号分隔）' },
    { name: 'with-meta', type: 'boolean', default: false, help: '返回 {count, pages, rows} 而不是裸数组' },
  ],
  func: async (args) => {
    const date = String(args.date ?? '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new CliError('INVALID_ARGUMENT', `--date 要 YYYY-MM-DD，收到 "${date}"`);
    }
    const pageSize = Math.max(1, Number(argOf(args, 'page-size')) || DEFAULT_PAGE_SIZE);
    const maxPages = Math.max(1, Number(argOf(args, 'max-pages')) || DEFAULT_MAX_PAGES);
    const delay = Math.max(0, Number(argOf(args, 'page-delay')) || 0);
    const columns = String(args.columns ?? '').trim() || DEFAULT_COLUMNS;

    const rows = [];
    let count = null;
    let pages = null;

    for (let page = 1; page <= maxPages; page += 1) {
      if (page > 1 && delay > 0) await sleep(delay);

      const url = new URL(BASE);
      url.searchParams.set('reportName', REPORT_NAME);
      url.searchParams.set('columns', columns);
      url.searchParams.set('filter', `(REPORT_DATE='${date}')`);
      url.searchParams.set('pageNumber', String(page));
      url.searchParams.set('pageSize', String(pageSize));
      url.searchParams.set('source', 'HSF10');
      url.searchParams.set('client', 'PC');

      const resp = await fetch(url, { headers: HEADERS });
      if (!resp.ok) {
        throw new CliError('HTTP_ERROR', `eastmoney hk-f10 第 ${page} 页 HTTP ${resp.status}（date=${date}）`);
      }
      const parsed = parseDatacenter(await resp.json());
      if (!parsed.ok) {
        throw new CliError('NO_DATA', `eastmoney hk-f10 第 ${page} 页：${parsed.why}（date=${date}）`);
      }
      if (count === null && parsed.count !== null) count = parsed.count;
      if (pages === null && parsed.pages !== null) pages = parsed.pages;

      // ⚠️ **空页不等于到底**（见文件头）。但只要 count 在，下面那条对账就会
      //    把"被限流的空页"和"真的翻完了"分开 —— 前者 fetched < count，报错。
      if (parsed.rows.length === 0) break;
      rows.push(...parsed.rows);

      if (count !== null && rows.length >= count) break;
    }

    const bad = completenessCheck(rows.length, count);
    if (bad) {
      throw new CliError(
        'TRUNCATED',
        `eastmoney hk-f10 date=${date}：${bad.detail} —— ` +
          `上游快速连打会返回空页，与"翻到底"同形；**不返回短表**。` +
          `加 --page-delay 3 放慢，或稍后重试。`,
      );
    }

    return argOf(args, 'with-meta') ? { count, pages, rows } : rows;
  },
});
