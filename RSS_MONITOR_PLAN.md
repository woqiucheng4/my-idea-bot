# 社交媒体关键词监控方案设计 (RSSHub)

本设计旨在无需修改现有代码逻辑的前提下，利用 RSSHub 的订阅路由与过滤功能，实现对小红书、知乎、V2EX 特定关键词（如“求推荐”、“怎么没有”、“吐槽”）的监控。

## 1. 核心策略：通用订阅 + 关键词过滤

由于部分平台（如小红书、知乎）未直接提供稳定的全站关键词搜索 API，我们将采用“**混合策略**”：
1.  **RSSHub 原生搜索**: 利用搜索引擎（Bing）的 RSSHub 路由进行全网精确检索（推荐）。
2.  **全量订阅 + 过滤**: 订阅平台最新/热门内容，并利用 RSSHub 的 `filter` 参数筛选关键词。

## 2. 详细路由设计

### 2.1 🔴 小红书 (Xiaohongshu)
小红书的反爬机制极其严格，且官方无“关键词搜索”RSS 路由。最稳定的方案是利用 Bing 搜索的 RSSHub 路由。

*   **监控方式**: 搜索引擎代理 (Bing Search)
*   **RSSHub 路由**: `/bing/search/:keyword`
*   **搜索语法**: `site:xiaohongshu.com (关键词1 OR 关键词2)`
*   **目标关键词**: `求推荐`、`怎么没有`、`吐槽`
*   **生成的 RSS 链接**:
    ```
    https://rsshub.app/bing/search/site:xiaohongshu.com%20(求推荐%20OR%20怎么没有%20OR%20吐槽)
    ```
    *(注：URL 中的空格和中文会自动编码，实际请求时应保持编码格式)*

### 2.2 🔵 知乎 (Zhihu)
知乎同样推荐使用搜索代理方式获取全站维度的关键词内容。若只需监控特定话题，可使用话题路由。

*   **监控方式**: 搜索引擎代理 (Bing Search)
*   **搜索语法**: `site:zhihu.com/question (求推荐 OR 怎么没有 OR 吐槽)`
    *   *注：加上 `/question` 可仅监控问题，去掉则包含文章和回答。*
*   **生成的 RSS 链接**:
    ```
    https://rsshub.app/bing/search/site:zhihu.com%2Fquestion%20(求推荐%20OR%20怎么没有%20OR%20吐槽)
    ```

### 2.3 🟢 V2EX
V2EX 结构开放，可以直接订阅“全站最新”主题并配合 RSSHub 的过滤器使用。

*   **监控方式**: 全站最新主题 + 关键词正则过滤
*   **RSSHub 路由**: `/v2ex/topics/latest`
*   **过滤参数**: `filter=求推荐|怎么没有|吐槽` (支持正则 `|` 代表或)
*   **生成的 RSS 链接**:
    ```
    https://rsshub.app/v2ex/topics/latest?filter=求推荐|怎么没有|吐槽
    ```

## 3. 实现细节与配置

如果你计划将来将此集成到 `monitor.js` 中，只需增加一个新的数据源获取逻辑即可，处理方式与 `runRedditDiscovery` 类似：

1.  **请求 URL**: 使用上述生成的 RSSHub 链接。
2.  **解析**: 同样解析 XML 格式 (`<entry>` 或 `<item>`)。
3.  **去重**: 利用链接 ID (`guid` 或 `link`) 进行去重。

### RSSHub 过滤器参数说明 (Query Parameters)
RSSHub 所有路由都支持以下参数，这使得我们在服务器端就能完成筛选，减少你本地代码的负担：
*   `filter`: 匹配标题或描述中包含的内容（支持 Regex）。
*   `filter_title`: 仅匹配标题。
    *   *例如*: `/v2ex/topics/latest?filter_title=求推荐|吐槽`
*   `filter_time`: 限制发布时间（秒）。
    *   *例如*: `&filter_time=86400` (只看最近 24 小时的内容)

## 4. 建议
建议自行部署 RSSHub 实例（Docker 部署），因为官方实例 `rsshub.app` 对小红书和搜索引擎的抓取经常会触发反爬限制导致不可用。自建实例配置简单且更稳定。
