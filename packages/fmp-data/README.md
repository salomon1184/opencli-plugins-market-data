# fmp-data

[Financial Modeling Prep](https://financialmodelingprep.com/) —— **美股**公司档案、利润表、日线历史。

属于 [opencli-plugins-market-data](../../) monorepo。单独安装：

```bash
opencli plugin install git@github.com:salomon1184/opencli-plugins-market-data.git
```

**为什么有这个包**：FMP 在真实工程里有**至少四份各写各的实现**（三个 shell + 一个 python），
其中两份在**同一个目录里并行维护**（`us_snap_equiv.py` 是 `us_free_daily.sh` 的逐行重写，
因为 shell 版被沙箱/审批拦了）。四份各自解析 key、各自映射字段、各自猜错误码。
这里收成一处。

## 命令

```bash
opencli fmp profile "AAPL,MSFT" --delay 7 -f json
opencli fmp income AAPL --period annual --limit 5 -f json
opencli fmp eod AAPL --last 250 -f json
```

| 命令 | 端点 | 说明 |
|---|---|---|
| `profile <symbols>` | `/stable/profile` | 档案：现价/市值/52 周区间/板块。**一次请求一个符号**，多个则逐个发 |
| `income <symbol>` | `/stable/income-statement` | 利润表，`--period annual\|quarter`、`--limit N` |
| `eod <symbol>` | `/stable/historical-price-eod/full` | 日线，`--from/--to` 是**上游**过滤、`--last N` 是**本地**截取 |

## ⚠️ 免费档的四个陷阱（2026-09-19 逐条实测，不是推测）

这是本适配器的主要价值 —— 它们合起来正是"看着像真数据的错数"。

| # | 现象 | 后果 |
|---|---|---|
| 1 | **不支持批量**：`profile?symbol=AAPL,MSFT` → **HTTP 200 + 空数组** | 谁按"逗号一次拿完"写，谁拿到空表却看不出错 |
| 2 | **402 是 `symbol` 级的**：同日 AAPL income 通、PLAB（小盘）402 | 笼统写成"财报端点要付费"会导出过宽的结论 |
| 3 | **`profile` 的符号不存在也是 200 + 空数组** | 与 #1 同形 —— "返空"绝不能当成"今天没数据" |
| 4 | **key 无效是 401，body 是 `{"Error Message":…}` 对象** | 当数组用会静默拿到空 → "key 错了"看起来像"这只票没数据" |

⚠️ **端点之间不一致，别互相套用**（实测）：`profile` 的坏符号 → 200+空；
**`income` / `eod` 的坏符号 → 402**（与"真实小盘被套餐挡住"**完全同形，分不开**）。
所以 `income`/`eod` 的错误文案里**不会**猜"是不是符号拼错了"。

适配器把以上各自映射成**不同的 `code`**，让调用方能分开处置：

| code | 含义 |
|---|---|
| `AUTH_REQUIRED` | key 缺失/无效（401/403，或 200 里夹着错误文案） |
| `PLAN_RESTRICTED` | 该 symbol 不在套餐内（402）—— 文案**带符号名** |
| `RATE_LIMITED` | 429；本适配器**不重试**，节奏归调用方 |
| `NOT_FOUND` / `NO_DATA` | `profile` 没拿回唯一一条 / 区间滤空 |

## ⚠️ `profile` 多符号时是**严格**的

任何一个符号没拿回**唯一一条**，整条命令就报错并**指名**列出是哪几个。

**这是刻意的**：对选股筛选器来说，静默少一只 = 那只看起来"不满足条件"，
而它其实只是没取到。要"跳过坏的、保留好的"，**改成逐只调用**（单符号时天然宽容）。

## 限速

本适配器**不重试、不限速** —— 免费档的节奏由调用方管：

- `profile` 多符号时用 `--delay 7`（原脚本的实测值）。
- 遇到 429 自己退避；原脚本的做法是「429 退避 12s、其它失败 5s、每只至多 4 次」。
- `eod` 一次会返回**全历史**（AAPL 实测 1255 条），要末段用 `--last`。

## API key

解析顺序（都取不到就**报错**，不静默变成空 key）：

1. `--apikey`
2. 环境变量 `FMP_API_KEY`（或 `FMP_KEY`）
3. `FMP_CONFIG` 指向的 JSON 文件里的 `providerKeys.fmp`

第 3 条是给「把各家 key 收在一个文件里」的工作区留的扩展点。
⚠️ **路径由你自己用环境变量给，仓库里不内置任何具体位置** —— 这是公开仓库：
写死某个工作区的配置路径，对别人是一条**不存在的死路**，对自己是把私有目录结构
印在公开仓库上，两头都不划算。

```bash
export FMP_CONFIG=~/path/to/market-data.json
# 文件形如：{"providerKeys": {"fmp": "<your-key>"}}
```

## 测试

```bash
node --test packages/fmp-data/_fmp.test.js
```

`_fmp.js` 是纯函数层（不联网），fixture 全部是实测探测原样抄下来的。
