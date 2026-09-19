# eastmoney-ext

东方财富板块数据扩展 —— **A股**。

属于 [opencli-plugins-market-data](../../) monorepo。单独安装：

```bash
opencli plugin install github:salomon1184/opencli-plugins-market-data/eastmoney-ext
```

## ⚠️ 本插件覆盖内置的 `eastmoney` 站点

两个命令补的都是**内置版没有的能力**，覆盖是**纯增量**：`--range` 不传时行为与内置逐字一致。
**不需要板块多日资金的话，不必装它。**

## 覆盖是怎么生效的（机制）

opencli 的适配器加载顺序是 **内置 → 用户级（`~/.opencli/clis/`）→ 插件**，
注册表以 `site/name` 为键直接覆盖 —— 所以同名命令后加载的**整体替换**先加载的。

插件排最后，所以本插件的 `eastmoney/sectors`、`eastmoney/sector-quote`
会盖掉内置的同名命令。opencli 自带 `adapter-shadow.js` 会提示这种覆盖，
说明这是**被支持的用法**，不是 hack。

`opencli adapter status` 可以看到哪些站点有本地覆盖。

## 命令

三个命令，性质分两类：

| 命令 | 性质 | 补的是什么 |
|---|---|---|
| `sectors --range today\|5d\|10d` | **覆盖** | 内置 `sectors` **没有 `--range`**，只有今日主力净额；这里补上板块级 5/10 日累计 |
| `sector-quote <BK####>` | **覆盖** | 内置 `quote` 的符号解析（`_secid.js`）只认个股/指数形态，**板块代码 `BK1158` 走不通**（实测 `BK1158` 与 `90.BK1158` 均报 `INVALID_ARGUMENT`） |
| `pool --type zt\|dt\|zb\|qs\|cx` | **新增** | 涨停/跌停/炸板/强势/次新五个股池。内置**没有**这一类（最接近的 `hot-rank` 是热股榜，还要 cookie） |

```bash
opencli eastmoney sectors --type industry --sort money-flow --range 5d --limit 12 -f json
opencli eastmoney sector-quote "BK1158,BK0459" -f json
opencli eastmoney pool --type zt --date 2026-09-18 -f json
```

`sector-quote` 一次请求返回：`changePercent` / `mainNet` / `mainNet5d` / `mainNet10d` /
`upCount` / `downCount` —— 够写「微盘股 −3.32%（15涨384跌）」这种句子。

## `pool`：打板情绪数据

`pool` 是**新增命令**（内置没有 `pool` 这个名字，不存在撞名），走一个**独立的 host**
`push2ex.eastmoney.com`。一次请求一个池。

```bash
opencli eastmoney pool --type zt --date 2026-09-18 -f json
```

⚠️ **`--limit` 省略 = 取全部**（不是"默认 50"）。上游应答里的 **`data.tc` 才是真实家数**，
`pagesize` 只是分页大小 —— 两者不等时，拿「返回条数」当家数会**静默少数**：
2026-09-18 实际 **78 家**涨停，旧的默认 50 会安安静静报成 50。

所以本命令把**截断做成有声的**：

| 调用 | 行为 |
|---|---|
| 省略 `--limit` | 开 500 取全；若仍被截断（`tc` > 返回条数）→ **报错**，不静默少给 |
| 显式给 `--limit N` | 视为**有意**取前 N 条 → **只告警**（stderr）不改结果 |

`--limit` 因此**刻意没有默认值** —— 有默认值就分不清「有意截断」和「默认不够」，
而这两者一个只该提醒、一个该报错。

| `--type` | 池 | 该池特有的字段 |
|---|---|---|
| `zt` | 涨停 | `limitUpFund` 封板资金 / `firstLimitTime` 首封 / `lastLimitTime` 末封 / `breakCount` 炸板次数 / `consecutive` 连板数 |
| `dt` | 跌停 | `openCount` 开板次数 / `pe` |
| `zb` | 炸板 | `limitUpPrice` / `breakCount` |
| `qs` | 强势 | `limitUpPrice` / `volumeRatio` 量比 |
| `cx` | 次新 | `limitUpPrice` |

五个池的**字段并不一致**，所以输出是一套**并集列**，该池没有的填 `null`。

三个实测踩过的坑：

1. **`--date` 必传，且不传不会回退到当天** —— 上游直接 `rc:102`，所以本命令把它设成
   必填项。但应答里的 **`qdate` 不能用来校验日期**：传 `date=20260904`，`qdate` 仍然回
   `20260918`（最新交易日），而**数据确实是 09-04 的**（09-18 有 78 家涨停、09-04 有 39 家，
   各重复两次调用结果一致）。拿 `qdate` 跟请求日期比对会**误杀所有历史查询**。
2. **价格是 ×1000 的整数**：`p:12660` ↔ 实际 12.66。本命令**做还原** —— 这是**去编码**，
   不是「替调用方归一单位」（12660 不是别的单位下的价格，它就是个编码值）。
   而 `amount` / `floatCap` / `totalCap` 的**单位是元**，**原样透传**、字段名不带单位后缀。
3. **`limitUpPrice` 会碰到哨兵值**：上游对**没有涨跌幅限制**的标的（`C` 开头的次新股等）
   不留空，而是填 `1000000000`。本命令把它映射成 `null` —— 不然你会看到
   「涨停价 1000000 元」这种看着完全像真数的假值。

**空池不是错误**：`--type dt --date 2026-09-18` 返回 `[]`（那天就是没有跌停股），
而不是报错 —— 让调用方能区分「当天没有」和「请求失败」。

⚠️ `pool` 走的 `push2ex` 用的**公共 token 与其余东财 host 不同**：内置全站用的
`bd1d9ddb04089700cf9c27f6f7426281` 在这个 host 上返回 `rc:205, data:null`
（看着像「没数据」，实则是 token 不对）。适配器里已经用对了，这里只是记一笔，
免得你照着别处的代码抄。

## ⚠️ `clist` 端点不稳 —— 很可能就是限流封禁

`sectors` 走 `push2.eastmoney.com/api/qt/clist/get`，该端点历史上多次整条不可达
（`fetch failed` / `cause: other side closed`）。

**这里原先的判断要修正。** 原文写的是「同期 `quote` / `index-board` / `sector-quote`
全部正常，所以判断依据是『**多个命令同时挂 vs 单个端点挂**』」—— 2026-09-19 的实测
**不支持**这个判据：那天 `sectors` / `sector-quote` / `index-board` 一起挂，稍后
`rank` / `money-flow` / `quote` 也一起挂（它们都走同一个 host），而 curl 直接打是
**0 字节**（TLS 握手成功、服务端不返回）、node undici 也是 0/10 —— 这与**限流封禁**
的表现完全一致，见根 README 的「限速与封禁」。

所以**别用「几个命令同时挂」来区分「端点故障」和「行情缺失」**。更可能的解释是
**你这个源 IP 被这个 host 限了**，跟有几个命令失败无关。

处置不变：退避重试 + 失败时如实记缺位。`sector-quote` 是**板块口径**的合法替代
（不是个股口径顶替）。**不要**换 host 兜底 —— `push2delay` 之类只是**还没被打掉**的
host，照同样频率打下去一样会被封。

## 限速

本适配器**不重试、不限速**。东方财富按**源 IP** 限流，突发请求会被临时封禁 ——
**紧循环重试比不重试更糟**。请用带退避的包装器调用。

⚠️ **各 host 独立计量**（`push2` / `push2delay` / `push2his` / `push2ex`）：
一个被封时另一个可能仍然通。那不是「备用源」，只是还没被打掉的那个。
详见根 README 的「限速与封禁」。
