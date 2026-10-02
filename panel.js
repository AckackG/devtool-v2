const $ = (id) => document.getElementById(id);

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${(value / 1024 ** 3).toFixed(2)} GB`;
}

window.updateRecorderView = (stats, rows) => {
  $("count").textContent = Number(stats?.count || 0).toLocaleString();
  $("pending").textContent = Number(stats?.pendingBodies || 0).toLocaleString();
  $("bytes").textContent = formatBytes(stats?.approxBytes || 0);

  const tbody = $("rows");
  tbody.textContent = "";
  for (const row of rows || []) {
    const tr = document.createElement("tr");
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
    `命中 ${Number(result.matchedRecords || 0).toLocaleString()} 个请求，共 ${Number(result.totalMatches || 0).toLocaleString()} 处。`;

  for (const row of result.results || []) {
    const tr = document.createElement("tr");
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

$("export").addEventListener("click", () => {
  window.recorderApi?.exportAll?.();
});

$("clear").addEventListener("click", () => {
  window.recorderApi?.clear?.();
  renderSearch(null);
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

setTimeout(() => {
  if (window.recorderApi) {
    window.updateRecorderView(window.recorderApi.getStats(), window.recorderApi.getSampleRows());
  }
}, 0);
