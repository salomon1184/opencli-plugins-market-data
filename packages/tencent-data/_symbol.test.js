// _symbol.js 的单测 —— 纯函数，不联网。
//
// 跑：node --test packages/tencent-data/_symbol.test.js
//
// 这里锁的都是**踩过的坑**，不是「覆盖率」。特别是 `000xxx` 的歧义拒绝和美股后缀的
// 剥/补 —— 这两个错了都是**静默返回另一个标的的数据**，比报错糟得多，所以必须钉死。

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MARKETS, resolveSymbol, splitSymbols,
  isAShare, isUs, toQuoteForm, hasUsSuffix,
} from './_symbol.js';

test('resolveSymbol: A股按首位推断市场', () => {
  // 5 / 6 / 9 开头 → 沪
  assert.equal(resolveSymbol('512480'), 'sh512480');
  assert.equal(resolveSymbol('600519'), 'sh600519');
  assert.equal(resolveSymbol('900901'), 'sh900901');
  // 1 / 2 / 3 开头 → 深
  assert.equal(resolveSymbol('159915'), 'sz159915');
  assert.equal(resolveSymbol('200011'), 'sz200011');
  assert.equal(resolveSymbol('300750'), 'sz300750');
});

test('resolveSymbol: 已带前缀的一律放行（含港股/美股）', () => {
  assert.equal(resolveSymbol('sh512480'), 'sh512480');
  assert.equal(resolveSymbol('SZ159915'), 'sz159915');   // 前缀大小写无所谓，输出归一成小写
  assert.equal(resolveSymbol('hk00700'), 'hk00700');
  assert.equal(resolveSymbol('usAAPL'), 'usAAPL');
  assert.equal(resolveSymbol('usAAPL.OQ'), 'usAAPL.OQ');
});

test('resolveSymbol: 000xxx 必须抛错（不猜 —— 猜错会静默给另一个标的的数据）', () => {
  // 000001 既可能是 sh000001（上证指数）也可能是 sz000001（平安银行）
  assert.throws(() => resolveSymbol('000001'), /歧义/);
  assert.throws(() => resolveSymbol('000002'), /歧义/);
});

test('resolveSymbol: 给了 --market 就能解歧义代码', () => {
  assert.equal(resolveSymbol('000001', { market: 'sh' }), 'sh000001');
  assert.equal(resolveSymbol('000001', { market: 'sz' }), 'sz000001');
  // 代码里已经写了前缀，就不要再叠一层
  assert.equal(resolveSymbol('sh000001', { market: 'sh' }), 'sh000001');
  assert.equal(resolveSymbol('512480', { market: 'sz' }), 'sz512480');
});

test('resolveSymbol: 坏输入一律抛错，不返回一个「看着像」的代码', () => {
  assert.throws(() => resolveSymbol(''), /empty/);
  assert.throws(() => resolveSymbol('   '), /empty/);
  assert.throws(() => resolveSymbol('ABCDEF'), /Unrecognized/);   // 没有前缀、不是 6 位数字
  assert.throws(() => resolveSymbol('51248'), /Unrecognized/);    // 5 位
  assert.throws(() => resolveSymbol('1234567'), /Unrecognized/);  // 7 位
  assert.throws(() => resolveSymbol('512480', { market: 'xx' }), /unknown market/);
});

test('MARKETS 就是解析器认的那四个前缀', () => {
  assert.deepEqual(MARKETS, ['sh', 'sz', 'hk', 'us']);
});

test('toQuoteForm: 美股剥掉交易所后缀（qt.gtimg.cn 只认裸代码）', () => {
  assert.equal(toQuoteForm('usAAPL.OQ'), 'usAAPL');
  assert.equal(toQuoteForm('usAAPL.N'), 'usAAPL');
  assert.equal(toQuoteForm('usAAPL'), 'usAAPL');          // 本来就没有，不变
});

test('toQuoteForm: 非美股一律原样返回（别把 A股/港股误伤）', () => {
  assert.equal(toQuoteForm('sh512480'), 'sh512480');
  assert.equal(toQuoteForm('sz159915'), 'sz159915');
  assert.equal(toQuoteForm('hk00700'), 'hk00700');
});

test('hasUsSuffix: 只对带点的美股为真', () => {
  assert.equal(hasUsSuffix('usAAPL.OQ'), true);
  assert.equal(hasUsSuffix('usAAPL'), false);
  assert.equal(hasUsSuffix('sh512480'), false);
  assert.equal(hasUsSuffix('hk00700'), false);
});

test('isUs / isAShare 互斥且只认前缀', () => {
  assert.equal(isUs('usAAPL.OQ'), true);
  assert.equal(isUs('sh512480'), false);
  assert.equal(isAShare('sh512480'), true);
  assert.equal(isAShare('sz159915'), true);
  assert.equal(isAShare('hk00700'), false);
  assert.equal(isAShare('usAAPL'), false);
});

test('splitSymbols: 逗号 / 中文逗号 / 空白都能分，且去空', () => {
  assert.deepEqual(splitSymbols('a,b'), ['a', 'b']);
  assert.deepEqual(splitSymbols('a，b'), ['a', 'b']);      // 中文逗号
  assert.deepEqual(splitSymbols('a b'), ['a', 'b']);
  assert.deepEqual(splitSymbols(' a , b ，, c '), ['a', 'b', 'c']);
  assert.deepEqual(splitSymbols(''), []);
  assert.deepEqual(splitSymbols(undefined), []);
});
