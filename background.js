const ports = new Map();

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "full-recorder-capture") return;
  ports.set(port, null);

  port.onMessage.addListener((message) => {
    if (message?.type === "init") {
      ports.set(port, Number.isInteger(message.tabId) ? message.tabId : null);
    }
  });

  port.onDisconnect.addListener(() => {
    ports.delete(port);
  });
});

function parseQuery(url) {
  try {
    return [...new URL(url).searchParams.entries()].map(([name, value]) => ({ name, value }));
  } catch {
    return [];
  }
}

function statusTextOf(statusLine) {
  const match = String(statusLine || "").match(/^\S+\s+\d+\s+(.*)$/);
  return match ? match[1] : "";
}

function mimeOf(headers) {
  const found = headers.find((header) => header.name.toLowerCase() === "content-type");
  return found ? found.value : null;
}

function resourceTypeOf(details) {
  switch (details.type) {
    case "xmlhttprequest":
      return "xhr";
    case "main_frame":
    case "sub_frame":
      return "document";
    case "stylesheet":
      return "stylesheet";
    case "script":
      return "script";
    case "image":
      return "image";
    case "font":
      return "font";
    case "media":
      return "media";
    case "websocket":
      return "websocket";
    case "ping":
      return "ping";
    default:
      return details.type || "other";
  }
}

function buildEntry(details) {
  const headers = (details.responseHeaders || []).map((header) => ({
    name: header.name || "",
    value: header.value ?? ""
  }));

  return {
    captured_at: new Date().toISOString(),
    startedDateTime: new Date(details.timeStamp || Date.now()).toISOString(),
    time: null,
    resourceType: resourceTypeOf(details),
    _captureSource: "webRequest",
    _requestId: details.requestId || null,
    serverIPAddress: details.ip || null,
    request: {
      method: details.method || "GET",
      url: details.url || "",
      httpVersion: null,
      headers: [],
      queryString: parseQuery(details.url || ""),
      cookies: [],
      headersSize: null,
      bodySize: null,
      postData: null
    },
    response: {
      status: details.statusCode ?? null,
      statusText: statusTextOf(details.statusLine),
      httpVersion: null,
      headers,
      cookies: [],
      redirectURL: null,
      headersSize: null,
      bodySize: null,
      content: {
        size: null,
        compression: null,
        mimeType: mimeOf(headers),
        encoding: null,
        text: null
      }
    },
    cache: null,
    timings: null,
    initiator: null
  };
}

function broadcast(details, entry) {
  for (const [port, tabId] of ports) {
    if (tabId == null || details.tabId !== tabId) continue;
    try {
      port.postMessage({ type: "xhr", entry });
    } catch {}
  }
}

chrome.webRequest.onCompleted.addListener(
  (details) => {
    if (details.type !== "xmlhttprequest") return;
    broadcast(details, buildEntry(details));
  },
  { urls: ["<all_urls>"] },
  ["responseHeaders"]
);

chrome.webRequest.onErrorOccurred.addListener(
  (details) => {
    if (details.type !== "xmlhttprequest") return;
    const entry = buildEntry(details);
    entry.response.status = null;
    entry.response.statusText = details.error || "failed";
    broadcast(details, entry);
  },
  { urls: ["<all_urls>"] }
);
