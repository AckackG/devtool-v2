(() => {
  const records = [];
  const byKey = new Map();
  let panelWindow = null;
  let pendingBodies = 0;

  function resourceTypeOf(entry) {
    return String(entry?._resourceType || entry?.resourceType || "").toLowerCase();
  }

  function mimeTypeOf(entry) {
    return String(entry?.response?.content?.mimeType || "").toLowerCase();
  }

  function isWebSocket(entry) {
    const url = String(entry?.request?.url || "");
    const type = resourceTypeOf(entry);
    if (/^wss?:/i.test(url)) return true;
    if (type === "websocket") return true;
    if (Number(entry?.response?.status) === 101) {
      const headers = entry?.response?.headers || [];
      return headers.some((h) => String(h.name).toLowerCase() === "upgrade" && String(h.value).toLowerCase().includes("websocket"));
    }
    return false;
  }

  function isImage(entry) {
    const type = resourceTypeOf(entry);
    const mime = mimeTypeOf(entry);
    return type === "image" || mime.startsWith("image/");
  }

  function shouldExclude(entry) {
    return isWebSocket(entry) || isImage(entry);
  }

  function makeKey(entry) {
    const req = entry?.request || {};
    return [entry?.startedDateTime || "", req.method || "", req.url || "", entry?.time ?? ""].join("|");
  }

  function cloneHeaderList(headers) {
    return Array.isArray(headers)
      ? headers.map((h) => ({ name: h?.name ?? "", value: h?.value ?? "" }))
      : [];
  }

  function cloneCookies(cookies) {
    return Array.isArray(cookies)
      ? cookies.map((c) => ({ ...c }))
      : [];
  }

  function cloneQueryString(items) {
    return Array.isArray(items)
      ? items.map((q) => ({ name: q?.name ?? "", value: q?.value ?? "" }))
      : [];
  }

  function buildRecord(entry) {
    const req = entry.request || {};
    const res = entry.response || {};
    const content = res.content || {};

    return {
      captured_at: new Date().toISOString(),
      startedDateTime: entry.startedDateTime || null,
      time: entry.time ?? null,
      resourceType: entry._resourceType || entry.resourceType || null,
      serverIPAddress: entry.serverIPAddress || null,
      connection: entry.connection || null,
      pageref: entry.pageref || null,
      request: {
        method: req.method || null,
        url: req.url || null,
        httpVersion: req.httpVersion || null,
        headers: cloneHeaderList(req.headers),
        queryString: cloneQueryString(req.queryString),
        cookies: cloneCookies(req.cookies),
        headersSize: req.headersSize ?? null,
        bodySize: req.bodySize ?? null,
        postData: req.postData
          ? {
              mimeType: req.postData.mimeType || null,
              text: req.postData.text ?? null,
              params: Array.isArray(req.postData.params) ? req.postData.params.map((p) => ({ ...p })) : null
            }
          : null
      },
      response: {
        status: res.status ?? null,
        statusText: res.statusText || null,
        httpVersion: res.httpVersion || null,
        headers: cloneHeaderList(res.headers),
        cookies: cloneCookies(res.cookies),
        redirectURL: res.redirectURL || null,
        headersSize: res.headersSize ?? null,
        bodySize: res.bodySize ?? null,
        content: {
          size: content.size ?? null,
          compression: content.compression ?? null,
          mimeType: content.mimeType || null,
          encoding: content.encoding || null,
          text: content.text ?? null
        }
      },
      cache: entry.cache ? { ...entry.cache } : null,
      timings: entry.timings ? { ...entry.timings } : null,
      initiator: entry._initiator ? { ...entry._initiator } : null
    };
  }

  function getResponseBody(entry, callback) {
    if (typeof entry.getContent === "function") {
      pendingBodies += 1;
      updatePanel();
      try {
        entry.getContent((content, encoding) => {
          pendingBodies = Math.max(0, pendingBodies - 1);
          callback(content, encoding || null);
          updatePanel();
        });
        return;
      } catch {
        pendingBodies = Math.max(0, pendingBodies - 1);
      }
    }

    const content = entry?.response?.content || {};
    callback(content.text ?? null, content.encoding || null);
  }

  function ingest(entry) {
    if (!entry?.request || shouldExclude(entry)) return;

    const key = makeKey(entry);
    if (byKey.has(key)) return;

    const record = buildRecord(entry);
    byKey.set(key, record);
    records.push(record);
    updatePanel();

    getResponseBody(entry, (body, encoding) => {
      record.response.content.text = body;
      record.response.content.encoding = encoding;
      updatePanel();
    });
  }

  function estimateBytes() {
    let bytes = 0;
    for (const record of records) {
      bytes += Number(record.request?.bodySize || 0) > 0 ? Number(record.request.bodySize) : 0;
      bytes += Number(record.response?.bodySize || 0) > 0 ? Number(record.response.bodySize) : 0;
      if (record.request?.postData?.text) bytes += record.request.postData.text.length;
      if (record.response?.content?.text) bytes += record.response.content.text.length;
    }
    return bytes;
  }

  function stats() {
    return {
      count: records.length,
      pendingBodies,
      approxBytes: estimateBytes()
    };
  }

  function clear() {
    records.length = 0;
    byKey.clear();
    pendingBodies = 0;
    updatePanel();
  }

  function exportAll() {
    const payload = {
      format: "devtools-full-recorder-v1",
      exported_at: new Date().toISOString(),
      note: "Images and WebSocket requests are excluded. Data exists only for this DevTools lifetime unless exported.",
      record_count: records.length,
      records
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    a.href = url;
    a.download = `devtools-full-recorder-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function sampleRows(limit = 100) {
    return records.slice(-limit).reverse().map((record) => ({
      method: record.request.method,
      status: record.response.status,
      type: record.resourceType || record.response.content.mimeType || "",
      url: record.request.url,
      responseBytes: record.response.bodySize ?? record.response.content.size ?? null,
      hasRequestBody: Boolean(record.request.postData?.text),
      hasResponseBody: record.response.content.text != null
    }));
  }

  function searchResponses(query, options = {}) {
    const rawNeedle = String(query ?? "");
    if (!rawNeedle) {
      return { query: rawNeedle, scanned: 0, matchedRecords: 0, totalMatches: 0, results: [] };
    }

    const caseSensitive = Boolean(options.caseSensitive);
    const needle = caseSensitive ? rawNeedle : rawNeedle.toLowerCase();
    const results = [];
    let scanned = 0;
    let totalMatches = 0;

    for (const record of records) {
      const body = record?.response?.content?.text;
      if (typeof body !== "string") continue;
      scanned += 1;

      const haystack = caseSensitive ? body : body.toLowerCase();
      let index = haystack.indexOf(needle);
      if (index < 0) continue;

      let matchCount = 0;
      let from = 0;
      while (true) {
        const found = haystack.indexOf(needle, from);
        if (found < 0) break;
        matchCount += 1;
        from = found + Math.max(needle.length, 1);
      }
      totalMatches += matchCount;

      const context = 120;
      const start = Math.max(0, index - context);
      const end = Math.min(body.length, index + rawNeedle.length + context);
      let snippet = body.slice(start, end).replace(/[\r\n\t]+/g, " ");
      if (start > 0) snippet = `…${snippet}`;
      if (end < body.length) snippet = `${snippet}…`;

      results.push({
        method: record?.request?.method || "",
        status: record?.response?.status ?? "",
        type: record?.resourceType || record?.response?.content?.mimeType || "",
        url: record?.request?.url || "",
        matchCount,
        snippet
      });
    }

    results.reverse();
    return {
      query: rawNeedle,
      scanned,
      matchedRecords: results.length,
      totalMatches,
      results
    };
  }

  function updatePanel() {
    if (!panelWindow) return;
    try {
      panelWindow.updateRecorderView?.(stats(), sampleRows());
    } catch {
      panelWindow = null;
    }
  }

  const api = {
    getStats: stats,
    getSampleRows: sampleRows,
    searchResponses,
    clear,
    exportAll
  };

  chrome.devtools.network.getHAR((har) => {
    try {
      for (const entry of har?.entries || []) ingest(entry);
    } catch {}
  });

  chrome.devtools.network.onRequestFinished.addListener((entry) => {
    ingest(entry);
  });

  chrome.devtools.panels.create("Full Recorder", "", "panel.html", (panel) => {
    panel.onShown.addListener((win) => {
      panelWindow = win;
      try {
        win.recorderApi = api;
        win.updateRecorderView?.(stats(), sampleRows());
      } catch {}
    });

    panel.onHidden.addListener(() => {
      panelWindow = null;
    });
  });
})();
