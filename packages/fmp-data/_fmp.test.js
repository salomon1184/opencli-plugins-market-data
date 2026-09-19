// _fmp.js 的单测 —— 纯函数，不联网。
//
// 跑：node --test packages/fmp-data/_fmp.test.js
//
// fixture 全部是 2026-09-19 实测探测**原样抄下来的**，不是编的 ——
// 所以这些断言同时也在钉「上游的形状确实是这样」。

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  num, classifyHttp, errorMessageOf, profileRow, incomeRow, eodRow,
  resolveKey, configPathFromEnv,
} from './_fmp.js';

// ---- 实测：/profile?symbol=AAPL（截取用到的字段）----
const AAPL_PROFILE = {
  symbol: 'AAPL', companyName: 'Apple Inc.', price: 245.5, marketCap: 3600000000000,
  change: 1.2, changePercentage: 0.49, range: '169.21-260.10',
  sector: 'Technology', industry: 'Consumer Electronics', exchange: 'NASDAQ',
  currency: 'USD', beta: 1.18, averageVolume: 52000000, ceo: 'Tim Cook',
  website: 'https://www.apple.com', cik: '0000320193', description: '…',
};

test('num: 空串是 null，不是 0', () => {
  // `Number('')` 是 0 且有限 —— 只靠 Number.isFinite 会把"上游没给"变成"就是 0"
  assert.equal(num(''), null);
  assert.equal(num('   '), null);
  assert.equal(num(null), null);
  assert.equal(num(undefined), null);
  assert.equal(num('abc'), null);
});

test('num: 真的 0 要保留成 0', () => {
  assert.equal(num(0), 0);
  assert.equal(num('0'), 0);
});

test('classifyHttp: 401/403 → AUTH_REQUIRED（key 的问题）', () => {
  const r = classifyHttp(401, '{"Error Message":"Invalid API KEY."}');
  assert.equal(r.code, 'AUTH_REQUIRED');
  assert.match(r.message, /Invalid API KEY/);   // 把上游原话带上
});

test('classifyHttp: 402 → PLAN_RESTRICTED，且文案说清是 symbol 级', () => {
  // ⚠️ 关键：402 不是"该端点要付费"，是"这个 symbol 不在套餐内" ——
  //    同端点的大盘股常能通。写成笼统的"财报不可用"会导出过宽的结论。
  const r = classifyHttp(402, "Premium Query Parameter: 'Special Endpoint…'");
  assert.equal(r.code, 'PLAN_RESTRICTED');
  assert.match(r.message, /symbol 级/);
});

test('classifyHttp: 429 → RATE_LIMITED，并说明本适配器不重试', () => {
  const r = classifyHttp(429, '');
  assert.equal(r.code, 'RATE_LIMITED');
  assert.match(r.message, /不重试也不限速/);
});

test('classifyHttp: 2xx 放行、其它 5xx 归 HTTP_ERROR', () => {
  assert.equal(classifyHttp(200, '[]'), null);
  assert.equal(classifyHttp(500, 'boom').code, 'HTTP_ERROR');
});

test('errorMessageOf: 401 那种**对象** body 要能认出来', () => {
  // 401 的 body 是 {"Error Message":…}，不是数组 —— 当数组用会静默拿到空
  assert.equal(errorMessageOf({ 'Error Message': 'Invalid API KEY.' }), 'Invalid API KEY.');
  assert.equal(errorMessageOf({ error: 'x' }), 'x');
  assert.equal(errorMessageOf([{ symbol: 'AAPL' }]), null);   // 正常数组不算错误
  assert.equal(errorMessageOf(null), null);
});

test('profileRow: 映射实测字段，缺的给 null 不给 undefined', () => {
  const r = profileRow(AAPL_PROFILE);
  assert.equal(r.symbol, 'AAPL');
  assert.equal(r.name, 'Apple Inc.');        // companyName → name
  assert.equal(r.marketCap, 3600000000000);
  assert.equal(r.sector, 'Technology');
  const bare = profileRow({ symbol: 'X' });
  assert.equal(bare.name, null);
  assert.equal(bare.price, null);
  assert.ok(!('undefined' in Object.values(bare).map(String)));
});

test('profileRow: companyName 缺失时退到 name（老字段名）', () => {
  assert.equal(profileRow({ symbol: 'X', name: 'Fallback Inc.' }).name, 'Fallback Inc.');
});

test('incomeRow / eodRow: 映射实测字段', () => {
  const i = incomeRow({ symbol: 'AAPL', date: '2024-09-28', period: 'FY',
    revenue: 391035000000, grossProfit: 180683000000, netIncome: 93736000000 });
  assert.equal(i.revenue, 391035000000);
  assert.equal(i.netIncome, 93736000000);
  assert.equal(i.costOfRevenue, null);       // 上游没给就是 null

  const e = eodRow({ symbol: 'AAPL', date: '2026-09-18', open: 1, high: 2,
    low: 0.5, close: 1.5, volume: 100, change: 0.5, changePercent: 0.3, vwap: 1.4 });
  assert.equal(e.close, 1.5);
  assert.equal(e.vwap, 1.4);
});

test('resolveKey: 显式 > 环境变量 > 配置文件', () => {
  const readFile = () => JSON.stringify({ providerKeys: { fmp: 'from-config' } });
  assert.equal(resolveKey({ apikey: 'flag', env: { FMP_API_KEY: 'env' },
    configPath: '/x', readFile }).from, 'flag');
  assert.equal(resolveKey({ env: { FMP_API_KEY: 'env' },
    configPath: '/x', readFile }).from, 'env');
  assert.equal(resolveKey({ env: {}, configPath: '/x', readFile }).from, 'config');
});

test('resolveKey: 什么都有没有 → {key:null}（不静默给空 key）', () => {
  const r = resolveKey({ env: {}, configPath: '/nope', readFile: () => { throw new Error('ENOENT'); } });
  assert.equal(r.key, null);
  assert.equal(r.from, null);
});

test('resolveKey: 空串参数不算给了 key', () => {
  assert.equal(resolveKey({ apikey: '   ', env: {} }).from, null);
});

test('configPathFromEnv: 路径**只**来自环境变量 —— 仓库里不内置任何具体位置', () => {
  // ⚠️ 这条钉的是「公开仓库里不出现私有路径」：内置一个别人机器上不存在的路径，
  //    对使用者是死路，对自己是把私有目录结构印在公开仓库上。
  assert.equal(configPathFromEnv({ FMP_CONFIG: '/tmp/keys.json' }), '/tmp/keys.json');
  assert.equal(configPathFromEnv({ FMP_CONFIG: '  /tmp/keys.json  ' }), '/tmp/keys.json');
});

test('configPathFromEnv: 没设 / 空串 → null（跳过这一步，不是变成空路径）', () => {
  assert.equal(configPathFromEnv({}), null);
  assert.equal(configPathFromEnv({ FMP_CONFIG: '' }), null);
  assert.equal(configPathFromEnv({ FMP_CONFIG: '   ' }), null);
  assert.equal(configPathFromEnv(), null);
});

// 注：原先这里测的 `parseRange` 已删（导出着但三个命令都没用 —— 见 _fmp.js 的注）。
