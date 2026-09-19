// _quote.js 的单测 —— 纯函数，不联网。
//
// 跑：node --test packages/tencent-data/_quote.test.js
//
// ⚠️ 这个文件存在的理由：`num` 在本仓有**四份**（`quote.js` / `_pool.js` /
//    `_datacenter.js` / `_fmp.js`），而这四个里**只有它原本是命令文件里的私有函数、
//    测不到**。它的注释钉着真踩过的坑（`f[39]` 空串 → `"pe": 0`），
//    但注解不会报警 —— 所以把它搬进 `_quote.js` 并补上这些断言。

import test from 'node:test';
import assert from 'node:assert/strict';

import { num } from './_quote.js';

test('num: 空串是 null，不是 0 —— 这就是那个 ETF 市盈率的坑', () => {
  // 实测 `sh512480`（ETF）的 `f[39]`（市盈率）就是空串。旧写法 `Number('')` = 0
  // 且有限 → 输出 `"pe": 0` —— 一个 ETF 的「市盈率 0」看着像真数，其实是上游没给。
  assert.equal(num(''), null);
  assert.equal(num('   '), null);
});

test('num: 显式 null / undefined 也是 null（不能只拦空串）', () => {
  // `Number(null)` 是 0 且有限 —— 本仓在 _datacenter.js 上正是栽在这一格
  assert.equal(num(null), null);
  assert.equal(num(undefined), null);
});

test('num: 真的 0 要留成 0（别把「确实是 0」也吞掉）', () => {
  assert.equal(num(0), 0);
  assert.equal(num('0'), 0);
  assert.equal(num(0.0), 0);
});

test('num: 数字与数字字符串照常过', () => {
  assert.equal(num(12.66), 12.66);
  assert.equal(num('12.66'), 12.66);
  assert.equal(num(-3.5), -3.5);
  assert.equal(num('1e3'), 1000);
});

test('num: 非数字串 / NaN / Infinity 一律 null', () => {
  assert.equal(num('abc'), null);
  assert.equal(num(NaN), null);
  assert.equal(num(Infinity), null);
  assert.equal(num(-Infinity), null);
});

test('num: 上游只会给字符串/数字 —— 数组这种非输入不保证语义（有心照不宣的 quirk）', () => {
  assert.equal(num({}), null);
  // ⚠️ **quirk，不是期望语义**：`Number([])` 是 **0**（空数组转数字为 0），
  //    所以 `num([])` 会给 0 而不是 null。
  //    这个端点的字段值只可能是字符串或数字，数组不会出现；而且另外三份 `num`
  //    （`_pool.js` / `_datacenter.js` / `_fmp.js`）同形，**在这里单独收紧会让四份不一致**。
  //    所以记下它，不做特例 —— 但别以为它返回的是"没有值"。
  assert.equal(num([]), 0);
});
