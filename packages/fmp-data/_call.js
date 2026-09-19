// fmp 的 HTTP 层 —— 三个命令共用，**key 解析只此一处**。
//
// 为什么单独一层：这套 key 解析在两个工作区的四个实现里**被抄了四遍**
// （三个 shell 各一行 python 掏 json，一个 python 又重写了一遍）。抄四遍的东西
// 迟早会有三份忘了改。这里收成一处。
//
// ⚠️ 本层**不重试、不限速**（同本仓其它适配器的立场）：东财是按源 IP 封、
//    FMP 是按套餐限流，两者的正确节奏只有调用方知道。适配器只负责
//    「发一次请求 + 把失败翻译成**能分开处置**的错误」。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { CliError } from '@jackwener/opencli/errors';
import { BASE, classifyHttp, errorMessageOf, resolveKey } from './_fmp.js';

/** OpenAlice 把各家 provider key 收在这里；opencli 之外的约定，所以只作兜底。 */
export const CONFIG_PATH = '~/.openalice/data/config/market-data.json';

const expand = (p) => (p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p);

/** 解 key：`--apikey` → `FMP_API_KEY` → OpenAlice 配置文件。都取不到就**报错，不静默返空**。 */
export function requireKey(apikey) {
  const cfgPath = expand(CONFIG_PATH);
  const { key, from } = resolveKey({
    apikey,
    env: process.env,
    configPath: cfgPath,
    readFile: (p) => fs.readFileSync(p, 'utf8'),
  });
  if (!key) {
    throw new CliError(
      'AUTH_REQUIRED',
      '没找到 FMP API key —— 三条路都试过了：--apikey / 环境变量 FMP_API_KEY / ' +
        `${CONFIG_PATH} 的 providerKeys.fmp。` +
        '（空 key 打过去只会拿到 401，看起来像"key 配错了"，其实是根本没有 key。）',
    );
  }
  return { key, from };
}

/**
 * 打一次 FMP，返回**数组**。
 *
 * ⚠️ **返空不是错误，但也不是"没有数据"** —— 免费档对「符号不存在」和
 *    「不支持批量」都回 200 + `[]`（见 _fmp.js 文件头的四个陷阱）。
 *    所以这里**原样返回空数组**，由调用方按语义决定怎么处置：
 *    单符号命令把它当 NOT_FOUND 报出来，多符号命令拿它做逐符号核对。
 */
export async function fmpGet(endpoint, params, key, label = null) {
  const url = new URL(BASE + endpoint);
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined || v === '') continue;
    url.searchParams.set(k, String(v));
  }
  url.searchParams.set('apikey', key);

  // ⚠️ 错误文案一律带上是**哪个符号**。402 是 symbol 级的（见 _fmp.js 文件头），
  //    不点名就会得出"该端点要付费"这种过宽的结论 —— 而同端点大盘股本来就通。
  const where = label ? `[${label}] ` : '';

  let resp;
  try {
    resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  } catch (e) {
    throw new CliError('HTTP_ERROR', `${where}FMP 请求失败（网络层）：${String(e).slice(0, 200)}`);
  }

  const text = await resp.text();
  const bad = classifyHttp(resp.status, text);
  if (bad) throw new CliError(bad.code, where + bad.message);

  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    throw new CliError('NO_DATA', `FMP 返回的不是 JSON（HTTP ${resp.status}）：${text.slice(0, 200)}`);
  }

  // ⚠️ 200 也可能是**对象**（401 的 body 就长这样）—— 当数组用会静默拿到空。
  const msg = errorMessageOf(obj);
  if (msg) throw new CliError('AUTH_REQUIRED', `FMP 答复里带错误文案：${msg}`);
  if (!Array.isArray(obj)) {
    throw new CliError(
      'NO_DATA',
      `FMP 期望数组、实际是 ${typeof obj} —— 不是数就是失败：${JSON.stringify(obj).slice(0, 200)}`,
    );
  }
  return obj;
}
