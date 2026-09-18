// eastmoney sectors — 板块排行（行业/概念/地域）+ 板块级多日资金。
//
// 这是**用户级覆盖版**，覆盖内置的 `clis/eastmoney/sectors.js`（v1.8.7）。
//
// 为什么是覆盖而不是新建一个 `sectors-range`：
//   opencli 的加载顺序是「内置 → 用户级 → 插件」（dist/src/main.js），且
//   registerCommand 用 `site/name` 作 key 直接 Map.set —— 后注册的同名命令
//   就是一个纯粹的覆盖。官方的 adapter-shadow.js 专门检测并提示这种覆盖，
//   说明它是被支持的用法，不是 hack。
//   覆盖的收益：看板 Issue 里已有的 `opencli eastmoney sectors --type industry
//   --sort money-flow` 一行都不用改，`--range` 是纯增量，不传时行为与内置一致。
//
// 与内置的唯一差别 = 多了 `--range`：
//   · `--range today`（默认）→ mainNet 取 f62，排序键 f62 —— 与内置逐字一致
//   · `--range 5d`            → mainNet 取 f164，排序键 f164
//   · `--range 10d`           → mainNet 取 f174，排序键 f174
//   mainNet5d / mainNet10d 三档**在同一次请求里全拿到**（东财 clist 一次可以
//   要多个 f 字段），所以不额外发请求 —— 少一次请求就少一分触发源 IP 限流的风险。
//
//   opencli eastmoney sectors
//   opencli eastmoney sectors --type concept --sort money-flow --limit 30
//   opencli eastmoney sectors --type industry --sort money-flow --range 5d -f json

import { cli, Strategy } from '@jackwener/opencli/registry';
import { CliError } from '@jackwener/opencli/errors';

const SECTOR_TYPES = {
  industry: 'm:90+t:2',
  concept:  'm:90+t:3',
  region:   'm:90+t:1',
};

// 主力净额字段：今日 / 5日 / 10日 三档在同一次请求里一起取。
const NET_FIELD_BY_RANGE = {
  today: 'f62',
  '5d':  'f164',
  '10d': 'f174',
};

// 排序键里的 money-flow / out-flow 要跟着 --range 走：`--sort money-flow
// --range 5d` 的语义是「按 5 日累计净流入排序」，不是「按今日排序再看 5 日数字」。
// 其余排序键（涨跌幅/成交额）与周期无关，保持恒定。
const SORTS = {
  change: { fid: 'f3', order: 'desc' },
  drop:   { fid: 'f3', order: 'asc' },
  'money-flow': { fid: 'f62', order: 'desc', rangeAware: true },
  'out-flow':   { fid: 'f62', order: 'asc',  rangeAware: true },
  turnover: { fid: 'f6', order: 'desc' },
};

cli({
  site: 'eastmoney',
  name: 'sectors',
  access: 'read',
  description: '板块排行（行业/概念/地域）按涨跌幅、主力资金或成交额排序，可带板块级 5日/10日主力净额',
  domain: 'push2.eastmoney.com',
  strategy: Strategy.PUBLIC,
  browser: false,
  example: 'opencli eastmoney sectors --type industry --sort money-flow --range 5d -f json',
  args: [
    { name: 'type',  type: 'string', default: 'industry', help: '板块类型：industry / concept / region' },
    { name: 'sort',  type: 'string', default: 'change',   help: '排序：change / drop / money-flow / out-flow / turnover' },
    { name: 'range', type: 'string', default: 'today',    help: '主力净额周期：today / 5d / 10d（同时决定 money-flow/out-flow 的排序键）' },
    { name: 'limit', type: 'int',    default: 20,         help: '返回数量 (max 100)' },
  ],
  columns: [
    'rank', 'code', 'name', 'price', 'changePercent',
    'mainNet', 'mainNet5d', 'mainNet10d',
    'leadStock', 'leadChangePercent', 'upCount', 'downCount',
  ],
  func: async (args) => {
    const typeKey = String(args.type ?? 'industry').toLowerCase();
    const fs = SECTOR_TYPES[typeKey];
    if (!fs) throw new CliError('INVALID_ARGUMENT', `Unknown sector type "${typeKey}". Valid: ${Object.keys(SECTOR_TYPES).join(', ')}`);

    const sortKey = String(args.sort ?? 'change').toLowerCase();
    const sort = SORTS[sortKey];
    if (!sort) throw new CliError('INVALID_ARGUMENT', `Unknown sort "${sortKey}". Valid: ${Object.keys(SORTS).join(', ')}`);

    const rangeKey = String(args.range ?? 'today').toLowerCase();
    const netField = NET_FIELD_BY_RANGE[rangeKey];
    if (!netField) throw new CliError('INVALID_ARGUMENT', `Unknown range "${rangeKey}". Valid: ${Object.keys(NET_FIELD_BY_RANGE).join(', ')}`);

    // limit 的钳制沿用内置写法：本文件是覆盖版，行为要跟内置保持一致（看板每天
    // 都跑这条命令，契约不能变）。typed-errors.md 反对静默钳制，这里是有意保留的例外。
    const limit = Math.max(1, Math.min(Number(args.limit) || 20, 100));
    const fid = sort.rangeAware ? netField : sort.fid;

    const url = new URL('https://push2.eastmoney.com/api/qt/clist/get');
    url.searchParams.set('pn', '1');
    url.searchParams.set('pz', String(limit));
    url.searchParams.set('po', sort.order === 'desc' ? '1' : '0');
    url.searchParams.set('np', '1');
    url.searchParams.set('fltt', '2');
    url.searchParams.set('invt', '2');
    url.searchParams.set('fid', fid);
    url.searchParams.set('fs', fs);
    // 相比内置多要了 f164 / f174 两个字段，一次请求全拿到，不额外发请求。
    url.searchParams.set('fields', 'f12,f14,f2,f3,f62,f164,f174,f104,f105,f128,f136,f140,f141');
    url.searchParams.set('ut', 'b2884a393a59ad64002292a3e90d46a5');

    const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!resp.ok) throw new CliError('HTTP_ERROR', `sectors failed: HTTP ${resp.status}`);
    const data = await resp.json();
    const diff = Array.isArray(data?.data?.diff) ? data.data.diff : [];
    if (diff.length === 0) throw new CliError('NO_DATA', 'eastmoney returned no sector data');

    return diff.slice(0, limit).map((it, i) => ({
      rank: i + 1,
      code: it.f12,
      name: it.f14,
      price: it.f2,
      changePercent: it.f3,
      // mainNet = 所选周期的主力净额；不传 --range 时它就是内置的 f62。
      mainNet: it[netField],
      mainNet5d: it.f164,
      mainNet10d: it.f174,
      leadStock: it.f128,
      leadChangePercent: it.f136,
      upCount: it.f104,
      downCount: it.f105,
    }));
  },
});
