# tencent-data

腾讯行情适配器 —— **A股 / 港股 / 美股**，明文 HTTP，无需 cookie 与浏览器扩展。

属于 [opencli-plugins-market-data](../../) monorepo。单独安装：

```bash
opencli plugin install github:salomon1184/opencli-plugins-market-data/tencent-data
```

## 命令

| 命令 | 说明 |
|---|---|
| `kline <sym>` | 日/周/月 K 线，复权可选（`qfq` / `hfq` / `none`）。实测 800 根可用 |
| `quote <syms>` | 实时快照，多标的逗号分隔，**一次请求** |
| `minute <sym>` | 当日分时（1 分钟粒度） |

```bash
opencli tencent kline sh512480 --period week --count 200 -f json
opencli tencent quote "512480,159915,600519" -f json
```

## 代码写法

| 市场 | 写法 | 备注 |
|---|---|---|
| A股 | `512480` 或 `sh512480` | 6 位数字可按首位推断市场 |
| 港股 | `hk00700` | 必须显式前缀；**该端点不给港股前复权** |
| 美股 | `usAAPL.OQ` | **必须带交易所后缀**，否则返回退化假数据（见下） |

## ⚠️ 美股：裸 ticker 会静默返回假数据

实测（2026-09-19）：

| 输入 | 结果 |
|---|---|
| `usAAPL` | **永远 2 行**（`2011-06-02` + 最新），且**无视 `--count`** |
| `usAAPL.OQ` | 正常，日期连续 |
| `usAAPL.N` | 1 行（AAPL 不在 NYSE） |

不报错、不空返回，就是给了两行看着像数据的错数据。**必须写后缀。**

## ⚠️ `000xxx` 必须显式指定市场

`000001` = 上证指数（`sh000001`）**或** 平安银行（`sz000001`）。按首位数字猜不准，
猜错会静默返回另一个标的的数据。解析器**直接拒绝**歧义代码：

```bash
opencli tencent kline 000001 --market sh    # 或直接写 sh000001
```

## ⚠️ 港股：该端点不给前复权

腾讯对港股只返回**不复权**价（键是 `day`，不是 `qfqday`）—— 实测 `hk00700` 如此。
A股 有服务端前复权（`qfq`），港股没有。**所以港股拆股要调用方自己折算。**

做法：维护一张 `(生效日, 比例)` 修正表，在回测/画图前手工处理。参考实现见
`auto-quant` 工作区的 `research/hstech-strategy/tencent_fetch.py` ——
它的 `REVERSE_SPLITS` 就是干这个的（例如某 2 倍做多恒科 ETF 在 2022-07-27 反向 5:1）。

⚠️ **那张表是逐标的的既成事实，不是通用规则** —— 所以本适配器**不内置它**
（内置一张只有个别标的的表，既不全也不通用）。请在你的策略层维护自己的表。

## 不支持的

**分钟 K 线** —— 端点 `…/appstock/app/kline/mkline` 明文 HTTP 走不通
（m1/m5/m15/m30/m60 四种周期全部 `SSL: UNEXPECTED_EOF_WHILE_READING`）。
`minute` 命令给的是**当日分时**（267 行/交易日），没有日期参数、取不到历史。

## 限速

本适配器**不重试、不限速**。腾讯是网页接口，批量拉取易被封 IP ——
连续取多个标的时**至少间隔 1 秒**，重试交给调用方的退避包装。
