(() => {
  const records = [];
  const byKey = new Map();
  const byId = new Map();
  let nextRecordId = 1;
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
    record.id = nextRecordId++;
    byId.set(record.id, record);
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

  function categoryCounts() {
    const counts = {};
    for (const record of records) {
      const cat = getNetworkCategory(record);
      counts[cat] = (counts[cat] || 0) + 1;
    }
    return counts;
  }

  function stats() {
    return {
      count: records.length,
      pendingBodies,
      approxBytes: estimateBytes(),
      categoryCounts: categoryCounts()
    };
  }

  function clear() {
    records.length = 0;
    byKey.clear();
    byId.clear();
    nextRecordId = 1;
    pendingBodies = 0;
    updatePanel();
  }

  const CRC_TABLE = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    CRC_TABLE[i] = c >>> 0;
  }

  function calcCrc32(buf) {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) {
      crc = CRC_TABLE[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  async function compressDeflate(buf) {
    const cs = new CompressionStream("deflate-raw");
    const writer = cs.writable.getWriter();
    writer.write(buf);
    writer.close();
    const reader = cs.readable.getReader();
    const chunks = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    const total = chunks.reduce((a, b) => a + b.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
      out.set(c, offset);
      offset += c.length;
    }
    return out;
  }

  function getDosDateTime(date = new Date()) {
    const year = Math.max(1980, date.getFullYear());
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const hours = date.getHours();
    const minutes = date.getMinutes();
    const seconds = Math.floor(date.getSeconds() / 2);

    const dosTime = (hours << 11) | (minutes << 5) | seconds;
    const dosDate = ((year - 1980) << 9) | (month << 5) | day;
    return { dosTime, dosDate };
  }

  async function createZip(files) {
    const fileEntries = [];
    const encoder = new TextEncoder();
    const { dosTime, dosDate } = getDosDateTime();

    for (const f of files) {
      const nameBytes = encoder.encode(f.name);
      const rawBytes = typeof f.content === "string" ? encoder.encode(f.content) : f.content;
      const crc = calcCrc32(rawBytes);
      let compBytes = rawBytes;
      let method = 0;

      if (typeof CompressionStream !== "undefined" && rawBytes.length > 0) {
        try {
          const deflated = await compressDeflate(rawBytes);
          if (deflated.length < rawBytes.length) {
            compBytes = deflated;
            method = 8;
          }
        } catch {}
      }

      fileEntries.push({
        nameBytes,
        rawBytes,
        compBytes,
        crc,
        method,
        size: rawBytes.length,
        compSize: compBytes.length
      });
    }

    let localParts = [];
    let centralParts = [];
    let currentOffset = 0;

    for (const entry of fileEntries) {
      entry.offset = currentOffset;

      const localHeader = new Uint8Array(30 + entry.nameBytes.length);
      const lv = new DataView(localHeader.buffer);
      lv.setUint32(0, 0x04034b50, true);
      lv.setUint16(4, 20, true);
      lv.setUint16(6, 0x0800, true);
      lv.setUint16(8, entry.method, true);
      lv.setUint16(10, dosTime, true);
      lv.setUint16(12, dosDate, true);
      lv.setUint32(14, entry.crc, true);
      lv.setUint32(18, entry.compSize, true);
      lv.setUint32(22, entry.size, true);
      lv.setUint16(26, entry.nameBytes.length, true);
      lv.setUint16(28, 0, true);
      localHeader.set(entry.nameBytes, 30);

      localParts.push(localHeader);
      localParts.push(entry.compBytes);
      currentOffset += localHeader.length + entry.compBytes.length;

      const cdHeader = new Uint8Array(46 + entry.nameBytes.length);
      const cv = new DataView(cdHeader.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 0x0800, true);
      cv.setUint16(10, entry.method, true);
      cv.setUint16(12, dosTime, true);
      cv.setUint16(14, dosDate, true);
      cv.setUint32(16, entry.crc, true);
      cv.setUint32(20, entry.compSize, true);
      cv.setUint32(24, entry.size, true);
      cv.setUint16(28, entry.nameBytes.length, true);
      cv.setUint16(30, 0, true);
      cv.setUint16(32, 0, true);
      cv.setUint16(34, 0, true);
      cv.setUint16(36, 0, true);
      cv.setUint32(38, 0, true);
      cv.setUint32(42, entry.offset, true);
      cdHeader.set(entry.nameBytes, 46);

      centralParts.push(cdHeader);
    }

    const centralOffset = currentOffset;
    const centralSize = centralParts.reduce((a, b) => a + b.length, 0);

    const eocd = new Uint8Array(22);
    const ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(4, 0, true);
    ev.setUint16(6, 0, true);
    ev.setUint16(8, fileEntries.length, true);
    ev.setUint16(10, fileEntries.length, true);
    ev.setUint32(12, centralSize, true);
    ev.setUint32(16, centralOffset, true);
    ev.setUint16(20, 0, true);

    const totalLen = centralOffset + centralSize + eocd.length;
    const finalZip = new Uint8Array(totalLen);
    let pos = 0;
    for (const p of [...localParts, ...centralParts, eocd]) {
      finalZip.set(p, pos);
      pos += p.length;
    }
    return finalZip;
  }

  function getNetworkCategory(record) {
    const type = String(record?.resourceType || "").toLowerCase().trim();
    switch (type) {
      case "document":
      case "doc":
        return "HTML";
      case "fetch":
        return "FETCH";
      case "xhr":
        return "XHR";
      case "script":
      case "js":
        return "JS";
      case "stylesheet":
      case "css":
        return "CSS";
      case "font":
        return "FONT";
      case "media":
        return "MEDIA";
      case "manifest":
        return "MANIFEST";
      case "wasm":
        return "WASM";
      case "websocket":
      case "ws":
        return "WS";
      case "eventsource":
        return "EVENTSOURCE";
      case "ping":
        return "PING";
      case "prefetch":
        return "PREFETCH";
      default: {
        if (type) return type.toUpperCase().replace(/[^A-Z0-9_-]/g, "_");
        const mime = String(record?.response?.content?.mimeType || "").toLowerCase();
        if (mime.includes("html")) return "HTML";
        if (mime.includes("json")) return "FETCH";
        if (mime.includes("javascript")) return "JS";
        if (mime.includes("css")) return "CSS";
        return "OTHER";
      }
    }
  }

  async function exportAll() {
    const groups = new Map();
    for (const record of records) {
      const cat = getNetworkCategory(record);
      if (!groups.has(cat)) groups.set(cat, []);
      groups.get(cat).push(record);
    }

    const files = [];
    if (groups.size === 0) {
      files.push({
        name: "EMPTY.json",
        content: JSON.stringify({
          format: "devtools-full-recorder-v1",
          exported_at: new Date().toISOString(),
          category: "EMPTY",
          note: "Images and WebSocket requests are excluded. Data exists only for this DevTools lifetime unless exported.",
          record_count: 0,
          records: []
        }, null, 2)
      });
    } else {
      for (const [category, catRecords] of groups.entries()) {
        const payload = {
          format: "devtools-full-recorder-v1",
          exported_at: new Date().toISOString(),
          category,
          note: "Images and WebSocket requests are excluded. Data exists only for this DevTools lifetime unless exported.",
          record_count: catRecords.length,
          records: catRecords
        };
        files.push({
          name: `${category}.json`,
          content: JSON.stringify(payload, null, 2)
        });
      }
    }

    const zipBytes = await createZip(files);
    const blob = new Blob([zipBytes], { type: "application/zip" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    a.href = url;
    a.download = `devtools-full-recorder-${stamp}.zip`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function sampleRows(limit = 100) {
    return records.slice(-limit).reverse().map((record) => ({
      id: record.id,
      method: record.request.method,
      status: record.response.status,
      type: record.resourceType || record.response.content.mimeType || "",
      category: getNetworkCategory(record),
      url: record.request.url,
      responseBytes: record.response.bodySize ?? record.response.content.size ?? null,
      hasRequestBody: Boolean(record.request.postData?.text),
      hasResponseBody: record.response.content.text != null
    }));
  }

  function countOccurrences(haystack, needle) {
    let count = 0;
    let from = 0;
    while (true) {
      const found = haystack.indexOf(needle, from);
      if (found < 0) break;
      count += 1;
      from = found + Math.max(needle.length, 1);
    }
    return count;
  }

  function makeSnippet(text, index, needleLength, context = 120) {
    const start = Math.max(0, index - context);
    const end = Math.min(text.length, index + needleLength + context);
    let snippet = text.slice(start, end).replace(/[\r\n\t]+/g, " ");
    if (start > 0) snippet = `…${snippet}`;
    if (end < text.length) snippet = `${snippet}…`;
    return snippet;
  }

  function searchResponses(query, options = {}) {
    const rawNeedle = String(query ?? "");
    if (!rawNeedle) {
      return { query: rawNeedle, scannedRecords: 0, scannedBodies: 0, matchedRecords: 0, totalMatches: 0, results: [] };
    }

    const caseSensitive = Boolean(options.caseSensitive);
    const needle = caseSensitive ? rawNeedle : rawNeedle.toLowerCase();
    const results = [];
    let scannedBodies = 0;
    let totalMatches = 0;

    for (const record of records) {
      const url = String(record?.request?.url || "");
      const urlHaystack = caseSensitive ? url : url.toLowerCase();
      const urlIndex = urlHaystack.indexOf(needle);
      const urlMatches = urlIndex >= 0 ? countOccurrences(urlHaystack, needle) : 0;

      const body = record?.response?.content?.text;
      let bodyMatches = 0;
      let bodyIndex = -1;
      if (typeof body === "string") {
        scannedBodies += 1;
        const bodyHaystack = caseSensitive ? body : body.toLowerCase();
        bodyIndex = bodyHaystack.indexOf(needle);
        if (bodyIndex >= 0) bodyMatches = countOccurrences(bodyHaystack, needle);
      }

      if (urlMatches === 0 && bodyMatches === 0) continue;

      const matchCount = urlMatches + bodyMatches;
      totalMatches += matchCount;

      let source;
      let snippet;
      if (urlMatches > 0) {
        source = bodyMatches > 0 ? "URL + Response" : "URL";
        snippet = makeSnippet(url, urlIndex, rawNeedle.length);
      } else {
        source = "Response";
        snippet = makeSnippet(body, bodyIndex, rawNeedle.length);
      }

      results.push({
        id: record.id,
        method: record?.request?.method || "",
        status: record?.response?.status ?? "",
        type: record?.resourceType || record?.response?.content?.mimeType || "",
        category: getNetworkCategory(record),
        url,
        matchCount,
        source,
        snippet
      });
    }

    results.reverse();
    return {
      query: rawNeedle,
      scannedRecords: records.length,
      scannedBodies,
      matchedRecords: results.length,
      totalMatches,
      results
    };
  }

  function getRecord(id) {
    return byId.get(Number(id)) || null;
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
    getRecord,
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

  chrome.devtools.panels.create("Full Recorder", "icons/icon16.png", "panel.html", (panel) => {
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
