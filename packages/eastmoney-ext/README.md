# eastmoney-ext

东方财富板块数据扩展 —— **A股**。

属于 [opencli-plugins-market-data](../../) monorepo。单独安装：

```bash
opencli plugin install github:salomon1184/opencli-plugins-market-data/eastmoney-ext
```

## ⚠️ 本插件覆盖内置的 `eastmoney` 站点

两个命令补的都是**内置版没有的能力**，覆盖是**纯增量**：`--range` 不传时行为与内置逐字一致。
**不需要板块多日资金的话，不必装它。**

## 命令

| 命令 | 补的是什么 |
|---|---|
| `sectors --range today\|5d\|10d` | 内置 `sectors` **没有 `--range`**，只有今日主力净额；这里补上板块级 5/10 日累计 |
| `sector-quote <BK####>` | 内置 `quote` 的符号解析（`_secid.js`）只认个股/指数形态，**板块代码 `BK1158` 走不通**（实测 `BK1158` 与 `90.BK1158` 均报 `INVALID_ARGUMENT`） |

```bash
opencli eastmoney sectors --type industry --sort money-flow --range 5d --limit 12 -f json
opencli eastmoney sector-quote "BK1158,BK0459" -f json
```

`sector-quote` 一次请求返回：`changePercent` / `mainNet` / `mainNet5d` / `mainNet10d` /
`upCount` / `downCount` —— 够写「微盘股 −3.32%（15涨384跌）」这种句子。

## ⚠️ `clist` 端点不稳

`sectors` 走 `push2.eastmoney.com/api/qt/clist/get`，该端点在历史上**多次整条不可达**
（`fetch failed` / `cause: other side closed`，退避重试耗尽仍失败），而**同期
`quote` / `index-board` / `sector-quote`（走 ulist）全部正常** ——
所以判断依据是「**多个命令同时挂 vs 单个端点挂**」，别一见失败就当成行情缺失。

失败时如实记缺位；`sector-quote` 是**板块口径**的合法替代（不是个股口径顶替）。

## 限速

本适配器**不重试、不限速**。东方财富按**源 IP** 限流，突发请求会被临时封禁 ——
**紧循环重试比不重试更糟**。请用带退避的包装器调用。
