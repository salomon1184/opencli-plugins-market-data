// fmp 适配器的纯函数层 —— 不联网，所以能离线测（同本仓 eastmoney-ext/_pool.js 的惯例）。
//
// 为什么值得有这个适配器：`financialmodelingprep.com` 在两个工作区里有**至少四份
// 各写各的实现**（三个 shell + 一个 python），其中 `us_free_daily.sh` 与
// `us_snap_equiv.py` **在同一个目录里并行维护**（后者是前者的逐行重写，因为 shell
// 版被沙箱拦了）。四份都自己解析 API key、自己映射字段、自己猜错误码。
//
// ⚠️ **免费档的四个陷阱**（2026-09-19 逐条实测，不是推测）：
//
//   1. **不支持批量**。`profile?symbol=AAPL,MSFT` 返回 **HTTP 200 但数组为空**
//      —— 不是报错，是静默返空。谁按"逗号分隔一次拿完"写，谁就拿到一个空表
//      而看不出错。（`quote?symbol=A,B` 直接 402 付费。）
//   2. **402 是按 symbol 分档的**，不是"功能不存在"。AAPL 的 income-statement
//      返回 200，PLAB（小盘）同样端点返回 402。所以 402 要**指名道姓**报出来，
//      不能笼统说"财报不可用"。
//   3. **符号不存在是 200 + 空数组** —— 与陷阱 1 同一个形状。所以"返空"
//      绝不能当成"今天没数据"。
//      ⚠️ **但这条只对 `profile` 成立**（2026-09-19 实测）：`income` / `eod` 的
//      坏符号回 **402**，与陷阱 2 的"真实小盘被套餐挡住"**完全同形、分不开**。
//      所以那两个命令的错误文案里**不猜**"是不是符号拼错了"。见 README
//      「端点之间不一致，别互相套用」。
//   4. **Key 无效是 401，且 body 是 `{"Error Message": "..."}`** —— 一个**对象**，
//      不是数组。`resp.json()` 之后按键取值会静默得到 undefined。
//
// 这四条合起来正是本仓最反对的那类失败：**看着像真数据的错数**。
// 适配器把它们各自映射成不同的 CliError code，让调用方能分开处置。

export const BASE = 'https://financialmodelingprep.com/stable';

/** 「没有值」一律 null，绝不变成 0（`Number('')` 是 0，必须显式拦空串）。 */
export const num = (v) => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string' && v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * HTTP 状态 + body → 一个**能分开处置**的错误分类。
 *
 * 返回 `null` 表示可以继续解析；否则给出 `{ code, message }`。
 * `code` 用 CliError 认的自由字符串（opencli 不校验 code 白名单）。
 */
export function classifyHttp(status, bodyText = '') {
  const body = String(bodyText || '').slice(0, 200);
  if (status === 401 || status === 403) {
    return {
      code: 'AUTH_REQUIRED',
      message: `FMP 拒绝了 key（HTTP ${status}）—— 检查 --apikey / FMP_API_KEY / ` +
        `~/.openalice/data/config/market-data.json 的 providerKeys.fmp。上游原话：${body}`,
    };
  }
  if (status === 402) {
    // ⚠️ 按 symbol 分档 —— 同一个端点这只通、那只不通。所以别写成"该端点不可用"。
    return {
      code: 'PLAN_RESTRICTED',
      message: `该 symbol 不在你的 FMP 套餐内（HTTP 402）—— **是 symbol 级的**，` +
        `不是端点不存在（同端点的大盘股常能通）。上游原话：${body}`,
    };
  }
  if (status === 429) {
    return {
      code: 'RATE_LIMITED',
      message: `FMP 限流（HTTP 429）—— 免费档需要放慢；本适配器**不重试也不限速**，` +
        `节奏由调用方管（见 README「限速」）。`,
    };
  }
  if (status < 200 || status >= 300) {
    return { code: 'HTTP_ERROR', message: `FMP 返回 HTTP ${status}：${body}` };
  }
  return null;
}

/**
 * 解 401 那种**对象** body —— 返回其中的错误文案，不是错误就返回 null。
 *
 * ⚠️ 存在的理由：401 的 body 是 `{"Error Message": "…"}`，**不是数组**。
 *    直接当数组用会静默拿到空，于是"key 错了"看起来像"这只票没有数据"。
 */
export function errorMessageOf(obj) {
  if (!obj || Array.isArray(obj) || typeof obj !== 'object') return null;
  for (const k of ['Error Message', 'error', 'message']) {
    if (typeof obj[k] === 'string' && obj[k]) return obj[k];
  }
  return null;
}

/** FMP profile → 输出行。**只出核对过的字段**（见文件头实测）。 */
export function profileRow(d = {}) {
  return {
    symbol: d.symbol ?? null,
    name: d.companyName ?? d.name ?? null,
    price: num(d.price),
    marketCap: num(d.marketCap),
    change: num(d.change),
    changePercentage: num(d.changePercentage),
    range: d.range ?? null,              // "lo-hi" 字符串，调用方自己切
    sector: d.sector ?? null,
    industry: d.industry ?? null,
    exchange: d.exchange ?? null,
    currency: d.currency ?? null,
    beta: num(d.beta),
    averageVolume: num(d.averageVolume),
    ceo: d.ceo ?? null,
    website: d.website ?? null,
  };
}

/** FMP income-statement → 输出行。 */
export function incomeRow(d = {}) {
  return {
    symbol: d.symbol ?? null,
    date: d.date ?? null,
    period: d.period ?? null,
    revenue: num(d.revenue),
    costOfRevenue: num(d.costOfRevenue),
    grossProfit: num(d.grossProfit),
    operatingIncome: num(d.operatingIncome),
    netIncome: num(d.netIncome),
    eps: num(d.eps),
    ebitda: num(d.ebitda),
  };
}

/** FMP historical-price-eod → 输出行。 */
export function eodRow(d = {}) {
  return {
    symbol: d.symbol ?? null,
    date: d.date ?? null,
    open: num(d.open),
    high: num(d.high),
    low: num(d.low),
    close: num(d.close),
    volume: num(d.volume),
    change: num(d.change),
    changePercent: num(d.changePercent),
    vwap: num(d.vwap),
  };
}

/**
 * 把 key 从几个来源里解出来：显式参数 → 环境变量 → OpenAlice 的配置文件。
 *
 * `configPath` 是 opencli 之外的约定（OpenAlice 把各家 provider key 收在一处），
 * 所以它是**最后**的兜底，且读不到就如实说读不到 —— 不静默变成一个空 key
 * （空 key 打过去会拿到 401，看起来像"key 配错了"，其实是没有 key）。
 */
export function resolveKey({ apikey = null, env = {}, configPath = null, readFile = null } = {}) {
  if (apikey && String(apikey).trim()) {
    return { key: String(apikey).trim(), from: 'flag' };
  }
  const e = env.FMP_API_KEY ?? env.FMP_KEY;
  if (e && String(e).trim()) return { key: String(e).trim(), from: 'env' };

  if (configPath && readFile) {
    try {
      const cfg = JSON.parse(readFile(configPath));
      const k = cfg?.providerKeys?.fmp;
      if (k && String(k).trim()) return { key: String(k).trim(), from: 'config' };
    } catch {
      // 读不到/解析不了 = 没有 key，继续往下走，最终如实报缺
    }
  }
  return { key: null, from: null };
}

/** 把一个 `range` 字符串（"12.34-56.78"）切成 {lo, hi}；切不出就 null。 */
export function parseRange(range) {
  if (typeof range !== 'string') return null;
  const [a, b] = range.split('-');
  const lo = num(a);
  const hi = num(b);
  if (lo === null || hi === null) return null;
  return { lo, hi };
}
