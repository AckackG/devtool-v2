# DevTools Full Recorder

通用 DevTools Network 记录扩展。

- 仅在 DevTools 打开期间存在。
- 关闭 DevTools 后内存记录自动消失。
- 自动记录 DevTools 打开后产生的网络请求，并尝试接管 DevTools 已经记录到的当前 HAR entries。
- 保存 Request：method / URL / query / headers / cookies / request body(postData)。
- 保存 Response：status / headers / cookies / MIME / response body / encoding。
- 保存 timing / cache / initiator / server IP 等可用元数据。
- 排除 Network 类型明确为 Image 的请求。
- 排除 Network 类型明确为 WebSocket 的请求。
- 数据只放在 DevTools page 的内存中，不写 IndexedDB、不写 chrome.storage。
- `Full Recorder` 面板可一键导出分类 ZIP（包含按 HTML、FETCH、XHR、JS、CSS 等 Network 类型分类好的 JSON），或手动清空。
- 提供类似 DevTools Network 的类型筛选栏（ALL、FETCH、JS、HTML、CSS 等多选组合），列表与搜索结果会同步按所选类型过滤；搜索时类型标签显示命中数量，清空搜索后恢复显示总数量。
- 支持对**已经抓取到内存中的 URL 与 Response Body**做全文子串搜索，不会重新请求网络；结果显示命中位置（URL / Response / URL + Response）、请求 URL、状态、MIME、命中次数和首个命中片段。
- 面板可见时会定期从 HAR 补抓，避免个别请求因 `onRequestFinished` 漏报而缺失；也可以点击“同步 HAR”立即补抓。
- 对于 Chrome DevTools 扩展 API 完全看不到的 XHR（例如由页面外挂脚本/其他扩展发起的请求），通过 `webRequest` 兜底捕获 URL、状态、响应头等元数据；这类记录没有响应体，详情里会明确标注。
- 切换到其他 DevTools 面板时仍会后台接收并刷新记录；顶部“网络事件”计数可用于确认 Chrome 是否把网络完成事件推送给扩展。
- **点击搜索结果或列表记录任意行**，可直接展开**请求详情抽屉**，查看 Headers、Payload（Query/PostData）、Response Body（支持格式化与一键复制）、Cookies 以及一键复制 cURL 命令。

## 安装

1. 打开 `chrome://extensions/`
2. 开启“开发者模式”
3. 点击“加载已解压的扩展程序”
4. 选择本目录
5. 打开任意网页的 DevTools
6. 会出现 `Full Recorder` 面板

注意：为了确保 Response Body 被拿到，建议先打开 DevTools，再刷新页面或触发你要记录的请求。
