// _datacenter.js 的单测 —— 纯函数，不联网。
//
// 跑：node --test packages/eastmoney-ext/_datacenter.test.js
//
// fixture 是 2026-09-19 实测探测原样抄下来的。

import test from 'node:test';
import assert from 'node:assert/strict';

import { parseDatacenter, completenessCheck, looksLikeLastPage } from './_datacenter.js';

// ---- 实测：RPT_HKF10_FN_MAININDICATOR, REPORT_DATE='2025-12-31', pageSize=3 ----
const OK_ENVELOPE = {
  version: 'x', success: true, code: 0, message: 'ok',
  result: {
    pages: 749,
    count: 2246,
    data: [{ SECURITY_CODE: '00495', SECURITY_NAME_ABBR: 'PALADIN',
      REPORT_DATE: '2025-12-31 00:00:00', PE_TTM: -0.149079825601 }],
  },
};

test('parseDatacenter: 正常信封 → rows/count/pages', () => {
  const r = parseDatacenter(OK_ENVELOPE);
  assert.equal(r.ok, true);
  assert.equal(r.count, 2246);          // ← 完整性对账就靠它
  assert.equal(r.pages, 749);
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].SECURITY_CODE, '00495');
});

test('parseDatacenter: success=false 要认出来 —— HTTP 200 也可能带这层', () => {
  // ⚠️ 只看 HTTP 状态会漏掉这一层：200 + success:false 是上游"我答复了但没数据"
  const r = parseDatacenter({ success: false, code: 9201, message: '报表不存在', result: null });
  assert.equal(r.ok, false);
  assert.match(r.why, /success=false/);
  assert.match(r.why, /报表不存在/);
});

test('parseDatacenter: 没有 result 段 → 不 ok，且带上 message', () => {
  const r = parseDatacenter({ success: true, message: 'ok', result: null });
  assert.equal(r.ok, false);
  assert.match(r.why, /没有 result/);
});

test('parseDatacenter: 不是对象就直说类型', () => {
  assert.equal(parseDatacenter([]).ok, false);
  assert.match(parseDatacenter([]).why, /array/);
  assert.equal(parseDatacenter(null).ok, false);
});

test('parseDatacenter: count 缺失给 null，**不拿 0 冒充**', () => {
  // 0 会被下游读成"上游说一条都没有"，而真相是"上游没说有多少" —— 两者处置相反
  const r = parseDatacenter({ success: true, result: { data: [{ a: 1 }] } });
  assert.equal(r.ok, true);
  assert.equal(r.count, null);
  assert.equal(r.pages, null);
});

test('parseDatacenter: data 不是数组时当空页，不当错误', () => {
  // 「这页没有」是合法答复（翻到底、或被限流）—— 到底是哪一种由 count 对账来分
  const r = parseDatacenter({ success: true, result: { count: 2246, data: null } });
  assert.equal(r.ok, true);
  assert.deepEqual(r.rows, []);
  assert.equal(r.count, 2246);
});

// ---- completenessCheck：本适配器存在的理由 ----

test('completenessCheck: 取回条数==count → null（取全了）', () => {
  assert.equal(completenessCheck(2246, 2246), null);
});

test('completenessCheck: 少于 count → error（这就是静默截断）', () => {
  // 被限流返回空页时，手写脚本会当成"翻到底" —— 拿 count 一对就露馅
  const r = completenessCheck(1200, 2246);
  assert.equal(r.level, 'error');
  assert.match(r.detail, /共 2246 条，实际只取回 1200 条/);
});

test('completenessCheck: 多于 count 也 error（对不上就是理解错了分页）', () => {
  assert.equal(completenessCheck(2300, 2246).level, 'error');
});

test('completenessCheck: count 拿不到 → null（不判定，但也不假装核对过）', () => {
  assert.equal(completenessCheck(100, null), null);
  assert.equal(completenessCheck(100, undefined), null);
  assert.equal(completenessCheck(100, NaN), null);
});

test('completenessCheck: 真空（上游说 0、也取回 0）是合法结果', () => {
  assert.equal(completenessCheck(0, 0), null);
});

test('looksLikeLastPage: 条数少于页大小才算"可能到底"；空页不算', () => {
  assert.equal(looksLikeLastPage(3, 500), true);
  assert.equal(looksLikeLastPage(500, 500), false);
  // ⚠️ 空页返回 false —— 它可能是限流，不能凭它就断定到底了
  assert.equal(looksLikeLastPage(0, 500), false);
});
