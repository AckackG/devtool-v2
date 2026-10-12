# DevTools Full Recorder

通用 DevTools Network 记录扩展。

- 仅在 DevTools 打开期间存在。
- 关闭 DevTools 后内存记录自动消失。
- 自动记录 DevTools 打开后产生的网络请求，并尝试接管 DevTools 已经记录到的当前 HAR entries。
- 保存 Request：method / URL / query / headers / cookies / request body(postData)。
- 保存 Response：status / headers / cookies / MIME / response body / encoding。
- 保存 timing / cache / initiator / server IP 等可用元数据。
- 排除 Image。
- 排除 WebSocket。
- 数据只放在 DevTools page 的内存中，不写 IndexedDB、不写 chrome.storage。
- `Full Recorder` 面板可一键导出分类 ZIP（包含按 DOC、FETCH、XHR、JS、CSS 等 Network 类型分类好的 JSON），或手动清空。
- 支持对**已经抓取到内存中的 Response Body**做全文子串搜索，不会重新请求网络；结果显示命中的请求 URL、状态、MIME、命中次数和首个命中片段。
- **点击搜索结果或列表记录任意行**，可直接展开**请求详情抽屉**，查看 Headers、Payload（Query/PostData）、Response Body（支持格式化与一键复制）、Cookies 以及一键复制 cURL 命令。

## 安装

1. 打开 `chrome://extensions/`
2. 开启“开发者模式”
3. 点击“加载已解压的扩展程序”
4. 选择本目录
5. 打开任意网页的 DevTools
6. 会出现 `Full Recorder` 面板

注意：为了确保 Response Body 被拿到，建议先打开 DevTools，再刷新页面或触发你要记录的请求。
