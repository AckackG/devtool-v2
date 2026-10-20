const $ = (id) => document.getElementById(id);

const CATEGORY_ORDER = ["FETCH", "XHR", "JS", "HTML", "CSS", "FONT", "MEDIA", "WASM", "MANIFEST", "EVENTSOURCE", "PING", "PREFETCH", "OTHER"];
const activeCategories = new Set();

let currentDrawerRecord = null;
let lastRows = [];
let lastSearchResult = null;
let lastCategoryCounts = {};

function matchesCategoryFilter(row) {
  if (activeCategories.size === 0) return true;
  return activeCategories.has(row?.category || "OTHER");
}

function sortedCategoryNames(counts) {
  return Object.keys(counts || {}).sort((a, b) => {
    const ai = CATEGORY_ORDER.indexOf(a);
    const bi = CATEGORY_ORDER.indexOf(b);
    if (ai !== bi) return (ai < 0 ? CATEGORY_ORDER.length : ai) - (bi < 0 ? CATEGORY_ORDER.length : bi);
    return a.localeCompare(b);
  });
}

function createFilterChip(name, count, active, onClick) {
  const chip = document.createElement("button");
  chip.type = "button";
  chip.className = `filter-chip${active ? " active" : ""}`;
  chip.dataset.category = name;
  chip.setAttribute("aria-pressed", String(active));

  const label = document.createElement("span");
  label.textContent = name;
  const countEl = document.createElement("span");
  countEl.className = "count";
  countEl.textContent = Number(count || 0).toLocaleString();

  chip.appendChild(label);
  chip.appendChild(countEl);
  chip.addEventListener("click", onClick);
  return chip;
}

function searchCategoryCounts(result) {
  if (!result?.query) return null;
  const counts = {};
  for (const row of result.results || []) {
    const category = row.category || "OTHER";
    counts[category] = (counts[category] || 0) + 1;
  }
  return counts;
}

function renderFilterBar(totalCounts) {
  const bar = $("filter-bar");
  bar.textContent = "";
  const label = document.createElement("span");
  label.className = "filter-label";
  label.textContent = "筛选类型：";
  bar.appendChild(label);

  const hitCounts = searchCategoryCounts(lastSearchResult);
  const displayCounts = {};
  for (const name of new Set([...Object.keys(totalCounts || {}), ...Object.keys(hitCounts || {})])) {
    displayCounts[name] = Number((hitCounts || totalCounts || {})[name] || 0);
  }

  const total = Object.values(displayCounts).reduce((sum, value) => sum + Number(value || 0), 0);
  bar.appendChild(createFilterChip("ALL", total, activeCategories.size === 0, () => {
    activeCategories.clear();
    refreshViews();
  }));

  for (const name of sortedCategoryNames(displayCounts)) {
    bar.appendChild(createFilterChip(name, displayCounts[name], activeCategories.has(name), () => {
      if (activeCategories.has(name)) activeCategories.delete(name);
      else activeCategories.add(name);
      refreshViews();
    }));
  }

  const stateText = hitCounts
    ? `搜索命中 ${total.toLocaleString()} 个请求，类型标签显示命中数量。`
    : "当前显示全部类型的记录。";
  const filterText = activeCategories.size === 0
    ? "点击多个类型可组合筛选，点击 ALL 恢复全部。"
    : `当前筛选：${[...activeCategories].join("、")}。搜索与列表均只显示所选类型，点击 ALL 恢复全部。`;
  $("filter-summary").textContent = `${stateText}${filterText}`;
}

function refreshViews() {
  renderFilterBar(lastCategoryCounts);
  renderRows(lastRows);
  renderSearch(lastSearchResult);
}

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
    { name: "Capture Source", value: record._captureSource === "webRequest" ? "webRequest 兜底（无响应体）" : "DevTools HAR" },
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
  } else if (record._captureSource === "webRequest") {
    respEl.textContent = "(该请求由 webRequest 兜底捕获，Chrome 未向 DevTools API 暴露响应体)";
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

function renderRows(rows) {
  const tbody = $("rows");
  tbody.textContent = "";
  const visibleRows = (rows || []).filter(matchesCategoryFilter);

  if (visibleRows.length === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 6;
    td.textContent = (rows || []).length === 0 ? "暂无记录" : "当前筛选条件下没有记录";
    td.className = "empty-hint";
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }

  for (const row of visibleRows) {
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
}

window.updateRecorderView = (stats, rows) => {
  $("count").textContent = Number(stats?.count || 0).toLocaleString();
  $("pending").textContent = Number(stats?.pendingBodies || 0).toLocaleString();
  $("bytes").textContent = formatBytes(stats?.approxBytes || 0);
  $("events").textContent = Number(stats?.liveEventsReceived || 0).toLocaleString();
  $("excluded").textContent = Number(stats?.liveEventsExcluded || 0).toLocaleString();

  const typeCounts = stats?.liveEventTypeCounts || {};
  const typeText = Object.entries(typeCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => `${name}: ${count}`)
    .join(" · ");
  const exclusionText = Number(stats?.liveEventsExcluded || 0) > 0
    ? `排除原因：图片 ${Number(stats.excludedImages || 0)} · WebSocket ${Number(stats.excludedWebSockets || 0)} · 无请求 ${Number(stats.excludedNoRequest || 0)}`
    : "";
  const har = stats?.lastHARSync;
  const harText = har ? `HAR 日志 ${Number(har.entries || 0).toLocaleString()} 条，上次同步新增 ${Number(har.added || 0).toLocaleString()} 条` : "";
  const webRequestText = Number(stats?.webRequestCount || 0) > 0
    ? `webRequest 补抓 ${Number(stats.webRequestCount).toLocaleString()} 条`
    : "";
  $("event-types").textContent = [typeText ? `已收到网络事件类型：${typeText}` : "", exclusionText, harText, webRequestText].filter(Boolean).join("；");

  lastRows = rows || [];
  lastCategoryCounts = stats?.categoryCounts || {};
  refreshViews();
};

function renderSearch(result) {
  lastSearchResult = result || null;
  const section = $("search-section");
  const tbody = $("search-rows");
  tbody.textContent = "";

  if (!result?.query) {
    section.classList.add("hidden");
    $("search-summary").textContent = "同时搜索当前已经抓取到内存中的 URL 与 Response Body，不重新请求网络。";
    return;
  }

  section.classList.remove("hidden");
  const visibleResults = (result.results || []).filter(matchesCategoryFilter);
  const visibleMatches = visibleResults.reduce((sum, row) => sum + Number(row.matchCount || 0), 0);
  const filterNote = activeCategories.size > 0
    ? `当前筛选显示 ${visibleResults.length.toLocaleString()} 个请求、${visibleMatches.toLocaleString()} 处命中。`
    : "";
  $("search-summary").textContent =
    `已扫描 ${Number(result.scannedRecords || 0).toLocaleString()} 条记录的 URL 与 ` +
    `${Number(result.scannedBodies || 0).toLocaleString()} 个 Response Body；` +
    `命中 ${Number(result.matchedRecords || 0).toLocaleString()} 个请求，共 ${Number(result.totalMatches || 0).toLocaleString()} 处。` +
    `${filterNote}点击结果可直接查看详情。`;

  if (visibleResults.length === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 7;
    td.textContent = "当前筛选条件下没有匹配结果";
    td.className = "empty-hint";
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }

  for (const row of visibleResults) {
    const tr = document.createElement("tr");
    tr.classList.add("clickable-row");
    tr.title = "点击查看该请求完整详情与 Response";
    tr.addEventListener("click", () => openDrawer(row.id, "response"));

    const cells = [
      row.method || "",
      row.status ?? "",
      row.matchCount ?? 0,
      row.source || "",
      row.type || "",
      row.url || "",
      row.snippet || ""
    ];

    cells.forEach((value, index) => {
      const td = document.createElement("td");
      td.textContent = String(value);
      td.title = String(value);
      if (index === 5) td.classList.add("url-cell");
      if (index === 6) td.classList.add("snippet");
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  }
}

function runResponseSearch() {
  const query = $("response-search").value;
  if (!query) {
    renderSearch(null);
    renderFilterBar(lastCategoryCounts);
    $("response-search").focus();
    return;
  }

  const result = window.recorderApi?.searchResponses?.(query, {
    caseSensitive: $("case-sensitive").checked
  });
  renderSearch(result);
  renderFilterBar(lastCategoryCounts);
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

$("sync-har").addEventListener("click", async () => {
  const btn = $("sync-har");
  if (btn.disabled) return;
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = "同步中...";
  try {
    const result = await window.recorderApi?.syncHAR?.();
    window.updateRecorderView(window.recorderApi.getStats(), window.recorderApi.getSampleRows());
    if (result) {
      btn.textContent = `HAR ${Number(result.entries || 0)} 条 / 新增 ${Number(result.added || 0)}`;
      await new Promise((resolve) => setTimeout(resolve, 1600));
    }
  } catch (err) {
    console.error("HAR sync failed:", err);
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
});

$("clear").addEventListener("click", () => {
  activeCategories.clear();
  window.recorderApi?.clear?.();
  renderSearch(null);
  renderFilterBar(lastCategoryCounts);
  closeDrawer();
});

$("search-response").addEventListener("click", runResponseSearch);

$("response-search").addEventListener("keydown", (event) => {
  if (event.key === "Enter") runResponseSearch();
});

$("clear-search").addEventListener("click", () => {
  $("response-search").value = "";
  renderSearch(null);
  renderFilterBar(lastCategoryCounts);
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
