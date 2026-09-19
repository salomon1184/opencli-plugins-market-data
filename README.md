# opencli-plugins-market-data

行情数据适配器集合 —— [opencli](https://github.com/jackwener/opencli) 插件（monorepo）。

三个子插件，**可分别安装**。行情类全部走**明文 HTTP**：不需要 cookie、不需要浏览器扩展。

| 子插件 | 站点 | 覆盖 | 性质 |
|---|---|---|---|
| [`tencent-data`](packages/tencent-data) | `tencent` | **A股 · 港股 · 美股** | 新增站点 |
| [`eastmoney-ext`](packages/eastmoney-ext) | `eastmoney` | A股 | ⚠️ **覆盖内置站点** |
| [`fmp-data`](packages/fmp-data) | `fmp` | 美股（基本面/日线） | 新增站点 · **需自己的 API key** |

## 安装

```bash
# 三个都装
opencli plugin install github:salomon1184/opencli-plugins-market-data

# 只装腾讯（想要港股/美股 K 线、但不想动内置 eastmoney 的，装这个）
opencli plugin install github:salomon1184/opencli-plugins-market-data/tencent-data

# 只装东财扩展
opencli plugin install github:salomon1184/opencli-plugins-market-data/eastmoney-ext

# 只装 FMP（美股公司档案/利润表/日线；需要自己的 FMP API key）
opencli plugin install github:salomon1184/opencli-plugins-market-data/fmp-data
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
opencli eastmoney pool --type zt --date 2026-09-18 -f json    # 涨停池（另有 dt/zb/qs/cx）
```

### `fmp-data`

⚠️ **需要自己的 API key**（`--apikey` / 环境变量 / 配置文件，见[子包 README](packages/fmp-data)）。
免费档**按 symbol 分档** —— 大盘股常通、小盘常 402，且**端点之间行为不一致**，别互相套用。

```bash
opencli fmp profile AAPL -f json                          # 公司档案
opencli fmp income AAPL --period annual --limit 5 -f json # 利润表
opencli fmp eod AAPL --last 250 -f json                   # 日线（默认全历史）
```

## 市场覆盖与代码写法

| 市场 | 写法 | 说明 |
|---|---|---|
| **A股** | `512480` / `sh512480` / `sz159915` | 6 位数字可省前缀（5/6/9→沪，1/2/3→深） |
| **港股** | `hk00700` | 必须写前缀。⚠️ 该端点对港股**不给前复权** |
| **美股** | `usAAPL` / `usAAPL.OQ` | 两种写法都收 —— 见下方 ⚠️（腾讯两个端点要的形态相反） |

⚠️ **两个会静默出错的地方**（都已做防护或明确文档化）：

1. **美股：腾讯两个端点要的代码形态是相反的**（2026-09-19 实测）——

   | 端点 | 认 | 不认 |
   |---|---|---|
   | `qt.gtimg.cn`（`quote`） | `usAAPL` | `usAAPL.OQ` → `v_pv_none_match`，**查无此标的** |
   | `web.ifzq.gtimg.cn`（`kline`） | `usAAPL.OQ` | `usAAPL` → **2 行退化假数据**（首日+最新），且**无视 `--count`** |

   裸 ticker 那条最阴：它**不报错**，形状合法、内容是假的。本适配器的处理是让两个命令
   各自声明要哪种形态，**调用方写哪种都行**：`quote` 会把后缀剥掉；`kline` 遇到裸代码
   先查一次 `quote`（应答的 `f[2]` 会回显带后缀的真代码，如 `AAPL.OQ`）自动补上，
   再请求 K 线。注意 `kline` 走裸代码时**会多一次请求**，批量拉取时直接写全后缀更省。
2. **`000xxx` 有歧义** —— `000001` 既可以是上证指数（`sh000001`）也可能是平安银行（`sz000001`）。
   按首位猜是猜不准的，猜错的后果是**静默返回另一个标的的数据**。所以解析器**直接拒绝**，
   逼调用方给 `--market sh` 或写全 `sh000001`。

⚠️ **市场相关的字段布局**：`quote` 里 `f[46]` 之后的字段**含义随市场变**
（A股是市净率/涨停价/跌停价/量比，港股美股那个位置是**英文名**和 52 周高低）。
外盘/内盘 `f[7]/f[8]` 同理。所以这些字段**只在 A股下填值，港美股给 `null`** ——
给美股填个「涨停价 344.26」正是本仓库最反对的静默错数。

## 已知限制（不是 bug，是上游如此）

- **分钟 K 线不可得** —— 腾讯 `…/appstock/app/kline/mkline` 明文 HTTP 四种周期全 `SSL EOF`。
  `minute` 命令给的是**当日分时**，不是历史分钟 K。
- **港股无前复权** —— 该端点对港股只返回不复权价（键是 `day`，不是 `qfqday`）。
  上游不给复权，所以**拆股要自己修**：维护一张 `(生效日, 比例)` 表，在回测/画图前手工折算。
  参考实现：`auto-quant` 工作区的 `research/hstech-strategy/tencent_fetch.py`
  （它的 `REVERSE_SPLITS` 就是干这个的 —— 例如某 2 倍做多恒科 ETF 在 2022-07-27 反向 5:1）。
  **注意**：那张表是**逐标的的既成事实**，不是通用规则 —— 适配器不该内置它。
- **东方财富 `clist` 端点不稳** —— `sectors` 走的那个端点历史上多次整条不可达
  （`fetch failed` / `Other side closed`）。**原先这里写的是「这不是本插件的问题」，
  那个归因很可能是错的** —— 见下方「限速与封禁」：这类症状与**限流封禁**的表现完全
  一致，未必是上游故障。无论哪种成因，处置方式相同：调用方退避重试，失败时如实记缺位。
  **不要**拿别的口径顶替，也**不要**靠换 host 兜底。

## 限速与封禁

**本插件不重试、不限速。** 腾讯与东方财富都是网页接口，**批量拉取易被封 IP**：

- 连续取多个标的时，**两次请求至少间隔 1 秒**。
- 重试请用调用方自己的退避包装。本项目的参考实现是
  `fetch_retry.py`：1s→2s→4s，退避封顶，且把**「真空数据」与「请求失败」分开处置**
  （前者不重试 —— 重试修不了"答复说没有"，只会白耗请求额度、加剧被限流）。

⚠️ **`fmp-data` 的机制不一样**，别把上面那套套过去：FMP 是商业 API，限流按**套餐**算
（超了回 **429**），不存在"按源 IP 封禁"这回事，也就没有"换个 host 绕过去"的余地。
节奏同样归调用方（免费档建议每只间隔 5~7s）—— 见[子包 README](packages/fmp-data)。

### 东财的封禁：症状与「上游宕机」无法区分

这条单独写，因为它**极容易被误判**，而误判会直接导致错误的架构决定：

- **症状**：`fetch failed` / `cause: other side closed`；用 curl 直接打是 **0 字节**
  （TLS 握手能成功，服务端不返回就关闭连接）。**从单次失败看，和上游宕机一模一样。**
- **各 host 独立计量**：`push2` 被封时 `push2delay` 可能仍然通。所以看到「换个 host
  就好了」**不要**当成找到了备用源 —— 那只是一个**还没被打掉**的 host，照同样频率
  打下去一样会被封。把偶发故障固化成设计缺陷，比不兜底更糟。
- **触发门槛很低**：2026-09-19 实测，以约 1 秒间隔连续探测十几个端点，就把
  `push2.eastmoney.com` 打进了持续封禁（curl 0/10、`node` undici 0/10、
  `opencli eastmoney rank` 0/12），而同一时刻 `push2delay` 仍 10/10。
- **所以**：遇到这个症状**先怀疑自己被限流**，不要断言上游挂了。隔几分钟用**单次**
  请求复测再下结论。真正的处置是**退避重试 + 失败时如实记缺位**，不是换 host。

### 开发这个插件时尤其注意

改适配器要实测端点，而实测正是最容易触发封禁的动作。建议：同一 host 保持 ≥1s 间隔、
控制总量、需要广覆盖时分散到不同 host，并且**别把失败窗口当成上游的稳定性质**记进文档。

## 关于 `eastmoney-ext` 覆盖内置

`eastmoney-ext` 会**覆盖内置的 `eastmoney` 站点**。原因：内置 `sectors` 没有 `--range`，
拿不到板块级 5/10 日主力净额；而内置 `quote` 的符号解析不认板块代码 `BK####`。

覆盖是**纯增量** —— `--range` 不传时行为与内置逐字一致。**若你不需要板块多日资金，
不必装它。**

## 测试

纯函数有单测，**不联网**：

```bash
node --test packages/tencent-data/_symbol.test.js packages/eastmoney-ext/_pool.test.js
# 或者直接（自动发现 *.test.js）
node --test
```

用 Node 内建的 test runner，**零依赖**（本仓库没有 package.json / node_modules）。
能测的只有**不带 `@jackwener/opencli/*` import** 的纯模块 —— 所以池的解码逻辑
单独放在 `packages/eastmoney-ext/_pool.js`，而不是留在 `pool.js` 里
（后者要 import registry 和 CliError，裸跑 node 解析不了）。

这些测试钉的是**踩过的坑**，不是覆盖率：`000xxx` 的歧义拒绝、美股后缀的剥/补、
字段的 ×1000 去编码、时间补零、以及**「没有值」不能变成假 0**
（`Number(null)` 和 `Number('')` 都是 0 —— 只靠 `Number.isFinite` 拦不住）。

**网络路径不在单测范围内** —— 端点行为只认实测。改适配器请真跑一遍，
但注意别把源 IP 打进封禁（见上）。

## 出处

这些适配器在一个**私有工作区**里长期使用（服务于一个每日 A股 情绪/资金看板与若干复盘视频），
抽出来做成插件供其他工作区复用。那个工作区不开源，所以这里不附链接。

每个文件都保留了完整的「为什么这么写」注释 —— 包括实测踩过的坑：
腾讯实时行情是 **GBK** 不是 UTF-8；多标的答复第二段以换行开头，
正则不加 `m` 标志会**静默漏掉除第一条外的所有标的**。

## License

MIT
