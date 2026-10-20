# HANDOFF：Discord XHR/FETCH 在 Full Recorder 中完全缺失

更新时间：2026-10-20
当前版本：`manifest.json` v1.5.0
仓库：`AckackG/devtool-v2`（本地目录 `devtools-full-recorder`）

## 一句话结论

不是本项目过滤/渲染把 XHR 藏起来了，而是**当前环境里 Chrome DevTools 扩展 API 完全拿不到这批 XHR/FETCH**：

- `chrome.devtools.network.getHAR()` 返回 2044 条 HAR，但 `_resourceType` 只有 script / stylesheet / image / font / other / preflight / document / media。
- `chrome.devtools.network.onRequestFinished` 同样收到 2044 条实时事件，仍然 **0 条 xhr / fetch**。
- 与此同时，Network 面板里能看到大量 XHR，URL 形如：
  `https://discord.com/api/v9/channels/<channelId>/messages?before=<snowflake>&limit=20`
  Type = `xhr`，Status = 200，Content-Type = `application/json`，Initiator = `main_hook.js:143`。

## 现象与现场证据

### Network 面板

- 过滤器：`Fetch/XHR` + 文本过滤 `mess`。
- 可见请求包括：
  - `messages?limit=10` → 200
  - `saved-messages?bookmark_ids=true` → 404
  - 多条 `messages?before=...&limit=20` → 200
- 所有 XHR 的 Initiator 都是 `main_hook.js:143`。
- 其中一条请求的元数据（已去掉认证信息）：
  - Method: GET
  - Status: 200 OK
  - Remote address: `127.0.0.1:9910`（本机代理）
  - Response Content-Type: `application/json`
  - `sec-fetch-mode: cors`，`sec-fetch-site: same-origin`
  - Chrome 版本：153
- 用户之前的完整请求头里有 `Authorization` 和 `Cookie`，**本文件不记录这些敏感值**。

### Full Recorder 面板

- 记录数：1940
- 网络事件：2044（排除 106）
- 事件类型统计：
  - script 1317
  - stylesheet 597
  - image 106
  - font 10
  - other 10
  - preflight 2
  - document 1
  - media 1
  - **xhr 0 / fetch 0**
- 排除原因：图片 106 / WebSocket 0 / 无请求 0
- HAR 日志：2044 条，上次同步新增 0 条
- 结论：排除的 106 条是图片，和 XHR 无关；XHR 根本没进入扩展可用的 HAR/事件流。

## 已排除的方向

1. **不是搜索框问题**：URL 搜索已支持，且 XHR 连记录都没有。
2. **不是图片 MIME 误排除**：排除逻辑已改为仅按 Network 类型 `image` / `websocket` 排除；`fetch` / `xhr` 永远不因 MIME 被排除。
3. **不是列表只显示最近 100 条**：HAR 同步统计显示 HAR 本身就没有 XHR。
4. **不是面板隐藏后停止刷新**：已修复 `onHidden` 解绑问题，隐藏时仍后台更新。
5. **不是 `getHAR` callback / Promise 兼容问题**：`readHAR()` 已同时支持 Promise 和 callback；HAR 能拿到 2044 条其他类型记录。
6. **不是 Network 面板过滤器影响 HAR**：HAR 里包含 script/style/image，说明它返回的是完整日志；只是缺 XHR。

## 高可能性原因（待验证）

### 1. 请求不是由页面主世界发起

`main_hook.js` 很像是用户安装的脚本/其他扩展/AI 浏览器工具注入的 hook。若 XHR 由以下上下文发起，Chrome 的 devtools extension API 可能不把它归到 inspected page 的 HAR：

- 另一个扩展的 content script / isolated world；
- 浏览器自动化扩展的 MAIN world hook；
- Service Worker / 非主 frame target。

Network 面板会聚合展示，但 `chrome.devtools.network` 可能只暴露主 target。这一条最符合“Network 有、HAR 没有”的现象。

### 2. 本机代理

请求 Remote Address 是 `127.0.0.1:9910`。目前看静态资源同样走代理且能抓到，代理本身不太可能是原因，但仍建议对比一次不走代理的情况。

## 当前代码结构

- `devtools.html` / `devtools.js`
  - 在 DevTools page 中注册网络事件、维护内存记录。
  - `getHAR()` + `onRequestFinished` 双通道采集。
  - `syncHAR()`：启动、面板显示、每 10 秒、手动按钮都会同步 HAR。
  - v1.5.0 新增 webRequest 兜底接入：连接 `background.js` 的 `full-recorder-capture` port。
- `background.js`（v1.5.0 新增）
  - 监听 `chrome.webRequest.onCompleted` / `onErrorOccurred`。
  - **目前只处理 `details.type === "xmlhttprequest"`**。
  - 按 `tabId` 过滤后，通过 port 把 minimal HAR entry 发给 devtools page。
  - 不含请求体、请求头、响应体；含 URL、method、status、响应头、时间。
- `panel.html` / `panel.js`
  - 类型筛选、URL + Response 搜索、命中数统计、详情抽屉。
  - 顶部诊断信息包括：网络事件类型、排除原因、HAR 同步结果、`webRequest 补抓 N 条`。
- `manifest.json`
  - v1.5.0 新增：
    - `"permissions": ["webRequest"]`
    - `"host_permissions": ["<all_urls>"]`
    - `"background": { "service_worker": "background.js" }`

## v1.5.0 webRequest 兜底的实现细节

- `background.js`
  - 监听所有 URL 的 XHR（`xmlhttprequest`）。
  - `onCompleted` 带 `responseHeaders`。
  - `onErrorOccurred` 记录失败/取消请求。
  - entry 中带 `_captureSource: "webRequest"` 和 `_requestId`。
- `devtools.js`
  - `ingestExternal(entry)`：
    - 先按 `_requestId` 去重（同一个请求的 completed/error 只保留一条）。
    - 再按 method + URL + 10 秒内时间去重，避免和 DevTools API 记录重复。
    - 若 DevTools 后补到同一请求，会 merge 成 `_captureSource: "devtools"` 并补响应体。
  - `webRequestCount` 显示在面板诊断行。
- 这类记录没有响应体，详情里会显示：
  `(该请求由 webRequest 兜底捕获，Chrome 未向 DevTools API 暴露响应体)`

## 需要立即验证的事

1. 重新加载扩展（v1.5.0 会新增 `webRequest` 权限和 `<all_urls>` host 权限），关闭/重开 DevTools。
2. 触发 Discord 的 messages XHR，观察 Full Recorder 顶部是否出现 `webRequest 补抓 N 条`，以及 XHR 类型是否出现。
3. 若没有出现，打开 `chrome://extensions` → 本扩展的 Service Worker 控制台，确认：
   - `onCompleted` 是否收到 `details.type === "xmlhttprequest"`；
   - `details.tabId` 是多少（当前只转发和 devtools page `tabId` 相同的请求；`-1` 会被丢弃）；
   - port 是否成功连接并完成 `init`。
4. 如果 `webRequest` 也看不到，说明这批请求被 Chrome 归到了其他 extension/target，考虑下面的方案。

## 建议的后续方案（按优先级）

### A. 先确认请求发起者

- 在 Network 里右键该 XHR → Copy → Copy as cURL / Copy as fetch，确认它确实来自页面。
- 临时禁用 `main_hook.js` 所在的脚本/扩展，再触发一次，看 DevTools API 能否抓到。
- 用同样的请求在空白页 `fetch()` 一次，验证本扩展在普通页面能正常抓 fetch/XHR。

### B. webRequest 能看到、但需要响应体

- 用 `chrome.devtools.inspectedWindow.eval` 在页面主世界 hook `window.fetch` 和 `XMLHttpRequest`：
  - 记录 method、URL、请求体、状态、响应头、`response.clone().text()`；
  - 结果缓存在页面全局队列，devtools page 定时 eval 取走；
  - 仅在 `main_hook.js` 运行于 MAIN world 时有效。
- 如果 `main_hook.js` 在 isolated world，主世界 hook 看不到它的 fetch/XHR，需要另找办法。

### C. webRequest 也看不到

- 说明请求被 Chrome 归到其他 extension / target。可尝试：
  - 给 webRequest 放宽 `tabId` 过滤（先临时允许 `-1`，记录所有 XHR 观察）；
  - 检查 `details.initiator` / `documentId` / `parentFrameId`；
  - 用 `chrome.debugger` + CDP Network domain 理论上能抓所有 target，但 **`chrome.debugger` 和已打开的 DevTools 不能同时 attach 同一个 tab**，会互相 detach，不适合当前“用户正在看 DevTools”的场景。
- 若最终确认是其他扩展发起的请求，最现实的方案是：让用户在 Full Recorder 里直接粘贴/导入 HAR，或提供一个独立的抓包入口。

### D. 只缺响应体

- DevTools API 和 webRequest 都拿不到 body 时，只能走页面 hook 或外部代理（例如用户已有的 `127.0.0.1:9910` 代理）。
- 可以让用户从代理工具导出 HAR，再导入本扩展；这是最稳的兜底。

## 重要限制

- `webRequest` 只提供元数据，无法读取响应体。
- `webRequest` 可能看不到其他扩展自身发起的请求，需要实测。
- 当前 `tabId` 过滤会丢弃 `tabId === -1` 的请求；如果这批 XHR 是 Service Worker 发起，需要放宽过滤，但要避免混入其他 tab。
- 当前 webRequest 兜底没有历史缓存：必须在 DevTools page 连接 port 之后发生的 XHR 才会被转发。若需要补历史，可以在 Service Worker 中加按 tabId 的环形缓冲或 `chrome.storage.session`。
- 代码没有真实浏览器回归测试；`/tmp/opencode/test-recorder.js` 是本次会话中的 mock 测试（未提交），覆盖了 HAR ingest、URL/Response 搜索、webRequest 兜底记录、XHR 分类。

## 安全检查

用户在对话中贴出过完整的 Discord 请求头，其中包含 `Authorization` 和 `Cookie`。这些值**没有**写入仓库或本文件。建议相关 token / 会话尽快轮换。
