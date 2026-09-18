# opencli-plugins-market-data

行情数据适配器集合 —— [opencli](https://github.com/jackwener/opencli) 插件（monorepo）。

两个子插件，**可分别安装**。全部走**明文 HTTP**：不需要 cookie、不需要浏览器扩展。

| 子插件 | 站点 | 覆盖市场 | 性质 |
|---|---|---|---|
| [`tencent-data`](packages/tencent-data) | `tencent` | **A股 · 港股 · 美股** | 新增站点 |
| [`eastmoney-ext`](packages/eastmoney-ext) | `eastmoney` | A股 | ⚠️ **覆盖内置站点** |

## 安装

```bash
# 两个都装
opencli plugin install github:salomon1184/opencli-plugins-market-data

# 只装腾讯（想要港股/美股 K 线、但不想动内置 eastmoney 的，装这个）
opencli plugin install github:salomon1184/opencli-plugins-market-data/tencent-data

# 只装东财扩展
opencli plugin install github:salomon1184/opencli-plugins-market-data/eastmoney-ext
```

## 命令

### `tencent-data`

```bash
opencli tencent kline sh512480 --period day --count 250 -f json   # 日/周/月，复权可选
opencli tencent quote "512480,159915,600519" -f json              # 实时快照，多标的一次请求
opencli tencent minute sh512480 -f json                           # 当日分时
```

### `eastmoney-ext`

```bash
opencli eastmoney sectors --type industry --sort money-flow --range 5d --limit 12 -f json
opencli eastmoney sector-quote BK1158 -f json
```

## 市场覆盖与代码写法

| 市场 | 写法 | 说明 |
|---|---|---|
| **A股** | `512480` / `sh512480` / `sz159915` | 6 位数字可省前缀（5/6/9→沪，1/2/3→深） |
| **港股** | `hk00700` | 必须写前缀。⚠️ 该端点对港股**不给前复权** |
| **美股** | `usAAPL.OQ` | **必须带交易所后缀**（`.OQ` NASDAQ / `.N` NYSE 等） |

⚠️ **两个会静默出错的地方**（都已做防护或明确文档化）：

1. **美股裸 ticker**（`usAAPL`）**不报错，但返回退化的假数据** —— 永远 2 行（首日+最新），
   且**无视 `--count`**。所以本适配器要求显式后缀。（实测：`usAAPL` 2 行；`usAAPL.OQ` 正常）
2. **`000xxx` 有歧义** —— `000001` 既可以是上证指数（`sh000001`）也可能是平安银行（`sz000001`）。
   按首位猜是猜不准的，猜错的后果是**静默返回另一个标的的数据**。所以解析器**直接拒绝**，
   逼调用方给 `--market sh` 或写全 `sh000001`。

## 已知限制（不是 bug，是上游如此）

- **分钟 K 线不可得** —— 腾讯 `…/appstock/app/kline/mkline` 明文 HTTP 四种周期全 `SSL EOF`。
  `minute` 命令给的是**当日分时**，不是历史分钟 K。
- **港股无前复权** —— 拆股要调用方自己处理。
- **东方财富 `clist` 端点不稳** —— `sectors` 走的那个端点历史上多次整条不可达
  （`fetch failed` / `Other side closed`）。这不是本插件的问题；调用方应实现退避重试，
  并在失败时如实记缺位。**不要**拿别的口径顶替。

## 限速

**本插件不重试、不限速。** 腾讯与东方财富都是网页接口，**批量拉取易被封 IP**：

- 连续取多个标的时，**两次请求至少间隔 1 秒**。
- 重试请用调用方自己的退避包装。本项目的参考实现是
  `fetch_retry.py`：1s→2s→4s，退避封顶，且把**「真空数据」与「请求失败」分开处置**
  （前者不重试 —— 重试修不了"答复说没有"，只会白耗请求额度、加剧被限流）。

## 关于 `eastmoney-ext` 覆盖内置

`eastmoney-ext` 会**覆盖内置的 `eastmoney` 站点**。原因：内置 `sectors` 没有 `--range`，
拿不到板块级 5/10 日主力净额；而内置 `quote` 的符号解析不认板块代码 `BK####`。

覆盖是**纯增量** —— `--range` 不传时行为与内置逐字一致。**若你不需要板块多日资金，
不必装它。**

## 出处

这些适配器在一个**私有工作区**里长期使用（服务于一个每日 A股 情绪/资金看板与若干复盘视频），
抽出来做成插件供其他工作区复用。那个工作区不开源，所以这里不附链接。

每个文件都保留了完整的「为什么这么写」注释 —— 包括实测踩过的坑：
腾讯实时行情是 **GBK** 不是 UTF-8；多标的答复第二段以换行开头，
正则不加 `m` 标志会**静默漏掉除第一条外的所有标的**。

## License

MIT
