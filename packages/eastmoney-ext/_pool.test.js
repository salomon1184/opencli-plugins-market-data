// _pool.js 的单测 —— 纯函数，不联网。
//
// 跑：node --test packages/eastmoney-ext/_pool.test.js
//
// fixture 全部是 2026-09-18 / 2026-09-04 两次真实探测**原样抄下来的**应答记录，
// 不是编的 —— 所以这些断言同时也在钉「上游的形状确实是这样」。

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  POOLS, PRICE_SENTINEL, num, price, hhmmss, toCompactDate, mapPoolRow, truncationCheck,
  withMeta,
} from './_pool.js';

// ---- 真实记录（涨停池 2026-09-18，百通能源 001376）----
const ZT_ROW = {
  c: '001376', m: 0, n: '百通能源', p: 12660, zdp: 9.991312026977539,
  amount: 147380124, ltsz: 2721777362.58, tshare: 6185676000.0,
  hs: 5.414848804473877, lbc: 1, fbt: 92500, lbt: 92500,
  fund: 106626318, zbc: 0, hybk: '电力', zttj: { days: 1, ct: 1 },
};

// ---- 真实记录（跌停池 2026-09-04，集泰股份 002909）----
// 注意：跌停池**没有 zttj**，`days` 是平的，且多出 oc / pe / fba。
const DT_ROW = {
  c: '002909', m: 0, n: '集泰股份', p: 7210, zdp: -9.987516403198242,
  amount: 1135015040, ltsz: 2742881431.43, tshare: 2811900000.0,
  pe: -102.87174987792969, hs: 37.838600158691406, fund: 1333049,
  lbt: 145418, fba: 105587563, days: 1, oc: 11, hybk: '化学制品',
};

// ---- 真实记录（次新池 2026-09-18，C沈鼓 601091）----
// ztp 是**哨兵** 1000000000：C 开头的次新股没有涨跌幅限制。
const CX_ROW = {
  c: '601091', m: 1, n: 'C沈鼓', p: 57770, ztp: 1000000000, ztf: '0',
  zdp: 177.74038696289063, amount: 4816769792, ltsz: 12198897024.140002,
  tshare: 179664849739.84, hs: 89.08139038085938, ods: 2, od: 20260917,
  ipod: 20260917, o: 1, nh: 0, zttj: { days: 0, ct: 0 },
};

test('POOLS: 五个池，路径与内置命令名一致', () => {
  assert.deepEqual(Object.keys(POOLS), ['zt', 'dt', 'zb', 'qs', 'cx']);
  assert.equal(POOLS.zt.path, 'ZT');
  assert.equal(POOLS.cx.path, 'CX');
});

test('num: 「没有值」一律 null —— 不把 undefined/null/空串变成假 0', () => {
  // 这三条是重点：Number(undefined)=NaN 但 Number(null)=0、Number('')=0，
  // 只靠 Number.isFinite 会把后两者静默当成真值 0。
  assert.equal(num(undefined), null);
  assert.equal(num(null), null);
  assert.equal(num(''), null);
  assert.equal(num('   '), null);
  // 其余坏值
  assert.equal(num('abc'), null);
  assert.equal(num(NaN), null);
  assert.equal(num(Infinity), null);
});

test('num: 真的 0 要留成 0（别把「确实是 0」也吞掉）', () => {
  assert.equal(num(0), 0);
  assert.equal(num('0'), 0);
  assert.equal(num(1.5), 1.5);
  assert.equal(num('42'), 42);
});

test('price: ×1000 的编码还原成元', () => {
  assert.equal(price(12660), 12.66);      // 实测 百通能源 涨停价
  assert.equal(price(7210), 7.21);        // 实测 集泰股份
  assert.equal(price(57770), 57.77);      // 实测 C沈鼓
});

test('price: 哨兵值必须变 null（否则会给出「涨停价 1000000 元」这种假值）', () => {
  assert.equal(PRICE_SENTINEL, 1000000000);
  assert.equal(price(PRICE_SENTINEL), null);
  assert.equal(price(CX_ROW.ztp), null);  // 真实记录走一遍
  assert.equal(price(undefined), null);
  assert.equal(price(0), 0);              // 真 0 仍然是 0
});

test('hhmmss: HHMMSS 整数 → 补零的字符串（这个函数的全部意义就是补零）', () => {
  assert.equal(hhmmss(92500), '09:25:00');    // 实测 首封时间
  assert.equal(hhmmss(145418), '14:54:18');   // 实测 末封时间
  assert.equal(hhmmss(93000), '09:30:00');
  assert.equal(hhmmss(0), '00:00:00');
  assert.equal(hhmmss(undefined), null);
  assert.equal(hhmmss(null), null);
});

test('toCompactDate: 两种写法都收，认不出给 null', () => {
  assert.equal(toCompactDate('2026-09-18'), '20260918');
  assert.equal(toCompactDate('20260918'), '20260918');
  assert.equal(toCompactDate(' 2026-09-18 '), '20260918');
});

test('toCompactDate: 认不出的形式给 null，不猜（命令层据此报 CliError）', () => {
  assert.equal(toCompactDate('2026/09/18'), null);
  assert.equal(toCompactDate('2026-9-18'), null);   // 月份必须两位
  assert.equal(toCompactDate('2026-09-18T00:00'), null);
  assert.equal(toCompactDate(''), null);
  assert.equal(toCompactDate(undefined), null);
});

test('mapPoolRow: 涨停池 —— 连板/封板资金/首末封时间都在，rank 从 1 起', () => {
  const r = mapPoolRow(ZT_ROW, 0);
  assert.equal(r.rank, 1);
  assert.equal(r.code, '001376');
  assert.equal(r.name, '百通能源');
  assert.equal(r.price, 12.66);
  assert.equal(r.industry, '电力');
  assert.equal(r.consecutive, 1);            // lbc 连板数
  assert.equal(r.limitUpFund, 106626318);    // fund 封板资金，单位元
  assert.equal(r.firstLimitTime, '09:25:00');
  assert.equal(r.lastLimitTime, '09:25:00');
  assert.equal(r.breakCount, 0);
  assert.equal(r.boardDays, 1);              // 来自嵌套的 zttj.days
  assert.equal(r.boardCount, 1);             // 来自嵌套的 zttj.ct
});

test('mapPoolRow: 跌停池 —— zttj 不存在，days 是平的；该池没有的列必须是 null', () => {
  const r = mapPoolRow(DT_ROW, 4);
  assert.equal(r.rank, 5);
  assert.equal(r.price, 7.21);
  assert.equal(r.boardDays, 1);              // 来自**平的** days
  assert.equal(r.boardCount, null);          // 跌停池没有 ct —— 不能凭空造
  assert.equal(r.openCount, 11);             // oc，仅跌停池有
  assert.equal(r.pe, -102.87174987792969);
  // 涨停池专有的字段在跌停池上必须是 null
  assert.equal(r.consecutive, null);
  assert.equal(r.firstLimitTime, null);
  assert.equal(r.breakCount, null);
  assert.equal(r.limitUpPrice, null);
  assert.equal(r.volumeRatio, null);
});

test('mapPoolRow: 次新池 —— 哨兵 ztp 出 null，且「0 天 0 板」是真值不是缺值', () => {
  const r = mapPoolRow(CX_ROW, 1);
  assert.equal(r.limitUpPrice, null);        // 哨兵 1000000000 已拦
  assert.equal(r.price, 57.77);              // 但 p 本身是真的
  assert.equal(r.boardDays, 0);              // zttj.days=0 是真值，要保留成 0
  assert.equal(r.boardCount, 0);
  assert.equal(r.amount, 4816769792);        // 元，原样透传
});

test('mapPoolRow: 缺 industry 时给 null，不给 undefined', () => {
  const r = mapPoolRow({ c: '000001', n: 'X', p: 1000 }, 0);
  assert.equal(r.industry, null);
  assert.equal(r.price, 1);
  assert.equal(r.changePercent, null);
});

// ---- truncationCheck：截断必须有声，且两种情形处置相反 ----
//
// 背景（2026-09-19）：上游 `data.tc` 是真实家数、`pagesize` 只是分页大小。
// 旧版默认 limit=50，而 09-18 实际有 78 家 —— 拿返回条数当家数会**静默少数**。
// 78 就是当天涨停池的真实 tc，下面直接拿它当 fixture。

test('truncationCheck: 未截断（tc 78，取回 78）→ null，什么都不该报', () => {
  assert.equal(truncationCheck(78, 78, { explicitLimit: false, limit: 500 }), null);
});

test('truncationCheck: 取回的比 tc 还多也不报（不拿它当倒挂异常）', () => {
  assert.equal(truncationCheck(78, 80, { explicitLimit: false, limit: 500 }), null);
});

test('truncationCheck: 省略 --limit 却被截断 → error（宁可不给，不许少给）', () => {
  const r = truncationCheck(78, 50, { explicitLimit: false, limit: 500 });
  assert.equal(r.level, 'error');
  assert.match(r.detail, /共 78 条，只取回 50 条/);
  assert.match(r.detail, /提高 --limit/);
});

test('truncationCheck: 显式 --limit 50 → warn（有意截断，只提醒不改结果）', () => {
  const r = truncationCheck(78, 50, { explicitLimit: true, limit: 50 });
  assert.equal(r.level, 'warn');
  assert.match(r.detail, /有意截断/);
  // ⚠️ 关键：显式截断**不能**升级成 error —— 那是调用方自己要的前 50 条。
  assert.notEqual(r.level, 'error');
});

test('truncationCheck: tc 取不到时不判定 —— 别把字段缺失升级成取数失败', () => {
  for (const bad of [null, undefined, NaN, '78']) {
    assert.equal(truncationCheck(bad, 50, { explicitLimit: false, limit: 500 }), null,
      `tc=${String(bad)} 不该判定`);
  }
});

test('truncationCheck: 空池（tc 0，取回 0）是合法结果，不是截断', () => {
  assert.equal(truncationCheck(0, 0, { explicitLimit: false, limit: 500 }), null);
});

// ---- withMeta（--with-meta 的信封）----

test('withMeta: tc / qdate 取上游原值，rows 原样带出', () => {
  const rows = [mapPoolRow(ZT_ROW, 0)];
  const e = withMeta({ tc: 78, qdate: 20260918, pool: [] }, rows);
  assert.equal(e.tc, 78);              // 真实家数，**不是** rows.length
  assert.equal(e.qdate, 20260918);
  assert.deepEqual(e.pool, rows);
});

test('withMeta: tc 与 rows.length 可以不等 —— 差额正是截断信号', () => {
  // 有 tc 之后调用方就不必反推了；不等时它自己就知道少了多少
  const e = withMeta({ tc: 78, qdate: 20260918 }, [mapPoolRow(ZT_ROW, 0)]);
  assert.equal(e.tc, 78);
  assert.equal(e.pool.length, 1);
});

test('withMeta: 上游没给 tc/qdate 时是 null，不抛', () => {
  const e = withMeta(undefined, []);
  assert.equal(e.tc, null);
  assert.equal(e.qdate, null);
  assert.deepEqual(e.pool, []);
});

test('withMeta: qdate 透传的是上游那个值 —— 别把它当请求日', () => {
  // 实测传 date=20260904，qdate 仍回 20260918（最新交易日）。这条钉住"透传"语义：
  // 万一有人想在这里"顺手改成请求日"，测试会红。
  const e = withMeta({ tc: 39, qdate: 20260918 }, []);
  assert.equal(e.qdate, 20260918);
});
