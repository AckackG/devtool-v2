const $ = (id) => document.getElementById(id);

let currentDrawerRecord = null;

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${(value / 1024 ** 3).toFixed(2)} GB`;
}

function switchDrawerTab(tabName) {
  document.querySelectorAll(".drawer-tab").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === tabName);
  });
  document.querySelectorAll(".tab-pane").forEach((pane) => {
    pane.classList.toggle("active", pane.id === `tab-${tabName}`);
  });
}

function renderKvList(containerId, items) {
  const container = $(containerId);
  if (!container) return;
  container.textContent = "";
  if (!items || items.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-hint";
    empty.textContent = "(无数据)";
    container.appendChild(empty);
    return;
  }
  for (const item of items) {
    const row = document.createElement("div");
    row.className = "kv-row";

    const key = document.createElement("div");
    key.className = "kv-key";
    key.textContent = String(item.name ?? item.key ?? "");
    key.title = key.textContent;

    const val = document.createElement("div");
    val.className = "kv-val";
    val.textContent = String(item.value ?? "");
    val.title = val.textContent;

    row.appendChild(key);
    row.appendChild(val);
    container.appendChild(row);
  }
}

function generateCurl(record) {
  if (!record?.request) return "";
  const req = record.request;
  const parts = [`curl '${String(req.url || "").replace(/'/g, "'\\''")}'`];
  if (req.method && req.method !== "GET") {
    parts.push(`-X ${req.method}`);
  }
  for (const h of req.headers || []) {
    if (!h?.name || h.name.startsWith(":")) continue;
    parts.push(`-H '${String(h.name).replace(/'/g, "'\\''")}: ${String(h.value ?? "").replace(/'/g, "'\\''")}'`);
  }
  if (req.postData?.text) {
    parts.push(`--data-raw '${String(req.postData.text).replace(/'/g, "'\\''")}'`);
  }
  return parts.join(" \\\n  ");
}

function copyWithFeedback(buttonId, text) {
  const btn = $(buttonId);
  if (!btn) return;
  const originalText = btn.textContent;
  navigator.clipboard.writeText(text || "").then(() => {
    btn.textContent = "已复制!";
    setTimeout(() => {
      btn.textContent = originalText;
    }, 1200);
  }).catch(() => {
    btn.textContent = "复制失败";
    setTimeout(() => {
      btn.textContent = originalText;
    }, 1200);
  });
}

function openDrawer(recordId, initialTab = "headers") {
  const record = window.recorderApi?.getRecord?.(recordId);
  if (!record) return;
  currentDrawerRecord = record;

  // Header badges
  const method = record.request?.method || "GET";
  $("d-method").textContent = method;

  const status = record.response?.status;
  const statusText = record.response?.statusText || "";
  const statusBadge = $("d-status");
  statusBadge.textContent = status != null ? `${status} ${statusText}`.trim() : "Pending";
  statusBadge.className = "badge";
  if (Number(status) >= 200 && Number(status) < 300) statusBadge.classList.add("badge-ok");
  else if (Number(status) >= 300 && Number(status) < 400) statusBadge.classList.add("badge-redir");
  else if (Number(status) >= 400) statusBadge.classList.add("badge-err");
  else statusBadge.classList.add("badge-gray");

  const resType = record.resourceType || record.response?.content?.mimeType || "other";
  $("d-type").textContent = resType;

  $("d-url").textContent = record.request?.url || "";
  $("d-url").title = record.request?.url || "";

  // General Tab
  renderKvList("d-general-kv", [
    { name: "Request URL", value: record.request?.url || "" },
    { name: "Request Method", value: record.request?.method || "" },
    { name: "Status Code", value: status != null ? `${status} ${statusText}` : "" },
    { name: "Remote Address", value: record.serverIPAddress || "(未知)" },
    { name: "Resource Type", value: record.resourceType || "(自动检测)" },
    { name: "Captured Time", value: record.captured_at || record.startedDateTime || "" },
    { name: "Duration", value: record.time != null ? `${Number(record.time).toFixed(1)} ms` : "(未知)" }
  ]);

  // Headers Tab
  renderKvList("d-resp-headers-kv", record.response?.headers || []);
  renderKvList("d-req-headers-kv", record.request?.headers || []);

  // Payload Tab
  renderKvList("d-query-kv", record.request?.queryString || []);
  const payloadEl = $("d-payload-text");
  const postData = record.request?.postData;
  if (postData?.text) {
    try {
      payloadEl.textContent = JSON.stringify(JSON.parse(postData.text), null, 2);
    } catch {
      payloadEl.textContent = postData.text;
    }
  } else {
    payloadEl.textContent = "(无请求体 Payload)";
  }

  // Response Tab
  const respMeta = $("d-resp-meta");
  const content = record.response?.content || {};
  respMeta.textContent = `Response Body (${content.mimeType || "未知类型"} | ${content.size != null ? formatBytes(content.size) : "未知大小"})`;
  const respEl = $("d-response-text");
  if (content.text != null) {
    try {
      respEl.textContent = JSON.stringify(JSON.parse(content.text), null, 2);
    } catch {
      respEl.textContent = content.text;
    }
  } else {
    respEl.textContent = "(等待响应体中或响应内容为空)";
  }

  // Cookies Tab
  renderKvList("d-resp-cookies-kv", (record.response?.cookies || []).map((c) => ({ name: c.name, value: c.value })));
  renderKvList("d-req-cookies-kv", (record.request?.cookies || []).map((c) => ({ name: c.name, value: c.value })));

  switchDrawerTab(initialTab);
  $("drawer").classList.add("open");
  $("drawer-backdrop").classList.add("open");
  $("drawer").setAttribute("aria-hidden", "false");
}

function closeDrawer() {
  $("drawer").classList.remove("open");
  $("drawer-backdrop").classList.remove("open");
  $("drawer").setAttribute("aria-hidden", "true");
  currentDrawerRecord = null;
}

window.updateRecorderView = (stats, rows) => {
  $("count").textContent = Number(stats?.count || 0).toLocaleString();
  $("pending").textContent = Number(stats?.pendingBodies || 0).toLocaleString();
  $("bytes").textContent = formatBytes(stats?.approxBytes || 0);

  const tbody = $("rows");
  tbody.textContent = "";
  for (const row of rows || []) {
    const tr = document.createElement("tr");
    tr.classList.add("clickable-row");
    tr.title = "点击查看该请求完整详情";
    tr.addEventListener("click", () => openDrawer(row.id, "headers"));

    const cells = [
      row.method || "",
      row.status ?? "",
      row.type || "",
      row.hasRequestBody ? "YES" : "",
      row.hasResponseBody ? "YES" : "",
      row.url || ""
    ];
    cells.forEach((value, index) => {
      const td = document.createElement("td");
      td.textContent = String(value);
      if ((index === 3 || index === 4) && value === "YES") td.className = "yes";
      if (index === 5) {
        td.title = String(value);
        td.classList.add("url-cell");
      }
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  }
};

function renderSearch(result) {
  const section = $("search-section");
  const tbody = $("search-rows");
  tbody.textContent = "";

  if (!result?.query) {
    section.classList.add("hidden");
    $("search-summary").textContent = "只搜索当前已经抓取到内存中的 Response Body，不重新请求网络。";
    return;
  }

  section.classList.remove("hidden");
  $("search-summary").textContent =
    `已扫描 ${Number(result.scanned || 0).toLocaleString()} 个已有 Response Body；` +
    `命中 ${Number(result.matchedRecords || 0).toLocaleString()} 个请求，共 ${Number(result.totalMatches || 0).toLocaleString()} 处。点击结果可直接查看详情。`;

  for (const row of result.results || []) {
    const tr = document.createElement("tr");
    tr.classList.add("clickable-row");
    tr.title = "点击查看该请求完整详情与 Response";
    tr.addEventListener("click", () => openDrawer(row.id, "response"));

    const cells = [
      row.method || "",
      row.status ?? "",
      row.matchCount ?? 0,
      row.type || "",
      row.url || "",
      row.snippet || ""
    ];

    cells.forEach((value, index) => {
      const td = document.createElement("td");
      td.textContent = String(value);
      td.title = String(value);
      if (index === 4) td.classList.add("url-cell");
      if (index === 5) td.classList.add("snippet");
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  }
}

function runResponseSearch() {
  const query = $("response-search").value;
  if (!query) {
    renderSearch(null);
    $("response-search").focus();
    return;
  }

  const result = window.recorderApi?.searchResponses?.(query, {
    caseSensitive: $("case-sensitive").checked
  });
  renderSearch(result);
}

$("export").addEventListener("click", async () => {
  const btn = $("export");
  if (btn.disabled) return;
  const origText = btn.textContent;
  btn.disabled = true;
  btn.textContent = "正在导出 ZIP...";
  try {
    await window.recorderApi?.exportAll?.();
  } catch (err) {
    console.error("Export failed:", err);
  } finally {
    btn.disabled = false;
    btn.textContent = origText;
  }
});

$("clear").addEventListener("click", () => {
  window.recorderApi?.clear?.();
  renderSearch(null);
  closeDrawer();
});

$("search-response").addEventListener("click", runResponseSearch);

$("response-search").addEventListener("keydown", (event) => {
  if (event.key === "Enter") runResponseSearch();
});

$("clear-search").addEventListener("click", () => {
  $("response-search").value = "";
  renderSearch(null);
  $("response-search").focus();
});

// Drawer event listeners
document.querySelectorAll(".drawer-tab").forEach((tab) => {
  tab.addEventListener("click", () => switchDrawerTab(tab.dataset.tab));
});

$("d-close").addEventListener("click", closeDrawer);
$("drawer-backdrop").addEventListener("click", closeDrawer);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeDrawer();
});

$("d-copy-url").addEventListener("click", () => {
  if (currentDrawerRecord?.request?.url) {
    copyWithFeedback("d-copy-url", currentDrawerRecord.request.url);
  }
});

$("d-copy-curl").addEventListener("click", () => {
  if (currentDrawerRecord) {
    copyWithFeedback("d-copy-curl", generateCurl(currentDrawerRecord));
  }
});

$("d-copy-resp").addEventListener("click", () => {
  const text = currentDrawerRecord?.response?.content?.text;
  if (text != null) {
    copyWithFeedback("d-copy-resp", text);
  }
});

setTimeout(() => {
  if (window.recorderApi) {
    window.updateRecorderView(window.recorderApi.getStats(), window.recorderApi.getSampleRows());
  }
}, 0);
