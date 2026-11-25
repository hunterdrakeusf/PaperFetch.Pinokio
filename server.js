const fs = require("fs");
const path = require("path");
const http = require("http");
const { spawnSync } = require("child_process");
const {
  APP_PACKAGE,
  MAIN_ACTIVITY,
  getPaths,
  findJavaHome,
  runGradle,
  runAdb,
  ensureProjectConfig,
} = require("./setup");

const PORT = Number(process.env.PORT) || 3000;
const HOST = "127.0.0.1";

let activeJob = null;

function getGitInfo(dir) {
  if (!fs.existsSync(dir)) return null;
  const rev = spawnSync("git", ["rev-parse", "--short", "HEAD"], {
    cwd: dir,
    encoding: "utf8",
  });
  const branch = spawnSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
    cwd: dir,
    encoding: "utf8",
  });
  return {
    commit: rev.status === 0 ? rev.stdout.trim() : "unknown",
    branch: branch.status === 0 ? branch.stdout.trim() : "unknown",
  };
}

function getApkInfo() {
  const p = getPaths();
  if (!fs.existsSync(p.apkPath)) {
    return { exists: false, path: p.apkPath };
  }
  const stat = fs.statSync(p.apkPath);
  return {
    exists: true,
    path: p.apkPath,
    fileName: "PaperFetch-debug.apk",
    sizeBytes: stat.size,
    sizeMB: Number((stat.size / 1048576).toFixed(2)),
    updatedAt: stat.mtime.toISOString(),
  };
}

async function listAdbDevices() {
  const p = getPaths();
  if (!fs.existsSync(p.adbBin)) {
    return { available: false, devices: [], raw: "ADB not installed" };
  }
  const res = await runAdb(["devices", "-l"], { capture: true });
  const lines = res.output
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("List of devices") && !l.startsWith("*"));

  const devices = lines.map((line) => {
    const parts = line.split(/\s+/);
    const serial = parts[0];
    const state = parts[1] || "unknown";
    const meta = {};
    for (const token of parts.slice(2)) {
      const idx = token.indexOf(":");
      if (idx > 0) {
        meta[token.slice(0, idx)] = token.slice(idx + 1);
      }
    }
    return {
      serial,
      state,
      model: meta.model || meta.device || serial,
      product: meta.product || "",
    };
  });

  return { available: true, devices, raw: res.output };
}

function readJsonBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk.toString();
      if (data.length > 1024 * 1024) req.destroy();
    });
    req.on("end", () => {
      if (!data.trim()) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (_) {
        resolve({});
      }
    });
  });
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

const INDEX_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>PaperFetch — Pinokio Android Launcher</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #0f1117;
      --card: #181c26;
      --border: #2a3040;
      --text: #eef1f7;
      --muted: #98a2b3;
      --accent: #4f8cff;
      --accent-hover: #3b78eb;
      --ok: #22c55e;
      --warn: #f59e0b;
      --err: #ef4444;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.5;
    }
    .wrap {
      max-width: 960px;
      margin: 0 auto;
      padding: 28px 20px 48px;
    }
    header {
      display: flex;
      align-items: center;
      gap: 16px;
      margin-bottom: 24px;
    }
    header img {
      width: 56px;
      height: 56px;
      border-radius: 14px;
      border: 1px solid var(--border);
    }
    h1 { margin: 0; font-size: 1.65rem; }
    .subtitle { margin: 4px 0 0; color: var(--muted); font-size: 0.95rem; }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(290px, 1fr));
      gap: 16px;
      margin-bottom: 18px;
    }
    .card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 18px;
    }
    .card h2 {
      margin: 0 0 12px;
      font-size: 1.05rem;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .badge {
      font-size: 0.75rem;
      padding: 2px 8px;
      border-radius: 999px;
      font-weight: 600;
      background: #232938;
      color: var(--muted);
    }
    .badge.ok { background: rgba(34, 197, 94, 0.16); color: #4ade80; }
    .badge.warn { background: rgba(245, 158, 11, 0.16); color: #fbbf24; }
    .meta { font-size: 0.88rem; color: var(--muted); margin: 6px 0; }
    .meta code {
      color: var(--text);
      background: #10131a;
      padding: 2px 6px;
      border-radius: 5px;
      word-break: break-all;
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-top: 14px;
    }
    button, a.btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      padding: 9px 14px;
      border-radius: 8px;
      border: 1px solid var(--border);
      background: #222836;
      color: var(--text);
      text-decoration: none;
      font-size: 0.9rem;
      font-weight: 500;
      cursor: pointer;
    }
    button.primary, a.btn.primary {
      background: var(--accent);
      border-color: var(--accent);
      color: #fff;
    }
    button.primary:hover, a.btn.primary:hover { background: var(--accent-hover); }
    button:hover:not(:disabled), a.btn:hover { border-color: #465066; }
    button:disabled { opacity: 0.55; cursor: not-allowed; }
    .device-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 10px 12px;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: #12151e;
      margin-top: 8px;
    }
    pre {
      margin: 10px 0 0;
      padding: 14px;
      background: #0b0d12;
      border: 1px solid var(--border);
      border-radius: 10px;
      overflow-x: auto;
      max-height: 360px;
      font-size: 0.82rem;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .hint {
      font-size: 0.85rem;
      color: var(--muted);
      margin-top: 10px;
    }
  </style>
</head>
<body>
  <div class="wrap">
    <header>
      <img src="/icon.png" alt="PaperFetch icon" />
      <div>
        <h1>PaperFetch</h1>
        <p class="subtitle">Native Android app (Kotlin / Jetpack Compose) — scan CSV &amp; RIS reference lists for DOIs and download open-access research PDFs.</p>
      </div>
    </header>

    <div class="grid">
      <div class="card">
        <h2>Android APK <span id="apkBadge" class="badge">Loading...</span></h2>
        <div id="apkMeta" class="meta">Checking build output...</div>
        <div class="actions">
          <a id="downloadBtn" class="btn primary" href="/api/apk" download="PaperFetch-debug.apk">Download APK</a>
          <button id="buildBtn" onclick="runAction('/api/build', 'Building Debug APK...')">Rebuild APK</button>
          <button id="testBtn" onclick="runAction('/api/test', 'Running upstream unit tests...')">Run Unit Tests</button>
        </div>
        <p class="hint">Sideload <code>PaperFetch-debug.apk</code> onto any Android 7.0+ (API 24+) device or install directly via ADB below.</p>
      </div>

      <div class="card">
        <h2>ADB Devices &amp; Emulators <span id="devBadge" class="badge">0</span></h2>
        <div class="actions" style="margin-top: 0; margin-bottom: 10px;">
          <button onclick="refreshDevices()">Refresh Devices</button>
        </div>
        <div id="deviceList" class="meta">Scanning ADB devices...</div>
        <p class="hint">Enable <strong>USB Debugging</strong> (or Wireless Debugging) on your Android device or start an Android Emulator, then click <strong>Refresh Devices</strong>.</p>
      </div>
    </div>

    <div class="card">
      <h2>Environment &amp; Output <span id="jobBadge" class="badge">Idle</span></h2>
      <div id="envMeta" class="meta"></div>
      <pre id="output">Ready. Click "Download APK", "Install &amp; Launch" on an ADB device, "Rebuild APK", or "Run Unit Tests".</pre>
    </div>
  </div>

  <script>
    async function refreshStatus() {
      const res = await fetch('/api/status');
      const data = await res.json();
      const apkBadge = document.getElementById('apkBadge');
      const apkMeta = document.getElementById('apkMeta');
      const downloadBtn = document.getElementById('downloadBtn');

      if (data.apk && data.apk.exists) {
        apkBadge.textContent = 'Ready (' + data.apk.sizeMB + ' MB)';
        apkBadge.className = 'badge ok';
        apkMeta.innerHTML =
          'Package: <code>' + data.appPackage + '</code><br/>' +
          'Built: <code>' + new Date(data.apk.updatedAt).toLocaleString() + '</code><br/>' +
          'Commit: <code>' + (data.git ? data.git.commit : 'unknown') + '</code>';
        downloadBtn.style.pointerEvents = 'auto';
        downloadBtn.style.opacity = '1';
      } else {
        apkBadge.textContent = 'Not Built';
        apkBadge.className = 'badge warn';
        apkMeta.textContent = 'APK not found. Click Rebuild APK to compile.';
        downloadBtn.style.pointerEvents = 'none';
        downloadBtn.style.opacity = '0.5';
      }

      document.getElementById('envMeta').innerHTML =
        'Gradle: <code>' + data.gradleVersion + '</code> &nbsp; ' +
        'JAVA_HOME: <code>' + (data.javaHome || 'not found') + '</code>';

      const jobBadge = document.getElementById('jobBadge');
      jobBadge.textContent = data.activeJob ? ('Running: ' + data.activeJob) : 'Idle';
      jobBadge.className = data.activeJob ? 'badge warn' : 'badge ok';
    }

    async function refreshDevices() {
      const res = await fetch('/api/devices');
      const data = await res.json();
      const list = document.getElementById('deviceList');
      const badge = document.getElementById('devBadge');
      const devices = data.devices || [];
      badge.textContent = devices.length + ' connected';
      badge.className = devices.length > 0 ? 'badge ok' : 'badge';

      if (devices.length === 0) {
        list.textContent = 'No ADB devices or emulators detected.';
        return;
      }

      list.innerHTML = '';
      for (const dev of devices) {
        const row = document.createElement('div');
        row.className = 'device-row';
        const info = document.createElement('div');
        info.innerHTML = '<strong>' + dev.model + '</strong><br/><span class="meta"><code>' + dev.serial + '</code> (' + dev.state + ')</span>';
        const btn = document.createElement('button');
        btn.className = 'primary';
        btn.textContent = 'Install & Launch';
        btn.disabled = dev.state !== 'device';
        btn.onclick = () => deployDevice(dev.serial);
        row.appendChild(info);
        row.appendChild(btn);
        list.appendChild(row);
      }
    }

    function setBusy(busy, label) {
      document.getElementById('buildBtn').disabled = busy;
      document.getElementById('testBtn').disabled = busy;
      const badge = document.getElementById('jobBadge');
      badge.textContent = busy ? label : 'Idle';
      badge.className = busy ? 'badge warn' : 'badge ok';
    }

    async function runAction(url, label) {
      const out = document.getElementById('output');
      setBusy(true, label);
      out.textContent = label + '\\nThis may take a minute...';
      try {
        const res = await fetch(url, { method: 'POST' });
        const data = await res.json();
        out.textContent = (data.ok ? '[SUCCESS]\\n' : '[FAILED]\\n') + (data.output || data.error || '');
      } catch (err) {
        out.textContent = 'Request failed: ' + err.message;
      } finally {
        setBusy(false, 'Idle');
        await refreshStatus();
      }
    }

    async function deployDevice(serial) {
      const out = document.getElementById('output');
      setBusy(true, 'Deploying to ' + serial + '...');
      out.textContent = 'Installing PaperFetch APK and launching on ' + serial + '...';
      try {
        const res = await fetch('/api/adb/deploy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ serial })
        });
        const data = await res.json();
        out.textContent = (data.ok ? '[DEPLOYED & LAUNCHED]\\n' : '[FAILED]\\n') + (data.output || data.error || '');
      } catch (err) {
        out.textContent = 'Deploy failed: ' + err.message;
      } finally {
        setBusy(false, 'Idle');
      }
    }

    refreshStatus();
    refreshDevices();
  </script>
</body>
</html>`;

const server = http.createServer(async (req, res) => {
  const urlObj = new URL(req.url, `http://${HOST}:${PORT}`);
  const pathname = urlObj.pathname;

  try {
    if (req.method === "GET" && pathname === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(INDEX_HTML);
      return;
    }

    if (req.method === "GET" && pathname === "/icon.png") {
      const iconPath = path.join(__dirname, "icon.png");
      if (fs.existsSync(iconPath)) {
        res.writeHead(200, { "Content-Type": "image/png" });
        fs.createReadStream(iconPath).pipe(res);
      } else {
        res.writeHead(404);
        res.end("Not found");
      }
      return;
    }

    if (req.method === "GET" && pathname === "/api/status") {
      const p = getPaths();
      let javaHome = null;
      try {
        javaHome = findJavaHome();
      } catch (_) {}
      sendJson(res, 200, {
        app: "PaperFetch",
        repository: "https://github.com/hunterdrakeusf/PaperFetch",
        appPackage: APP_PACKAGE,
        mainActivity: MAIN_ACTIVITY,
        gradleVersion: p.gradleVersion,
        javaHome,
        sdkInstalled: fs.existsSync(p.adbBin),
        git: getGitInfo(p.appDir),
        apk: getApkInfo(),
        activeJob,
      });
      return;
    }

    if (req.method === "GET" && pathname === "/api/apk") {
      const p = getPaths();
      if (!fs.existsSync(p.apkPath)) {
        sendJson(res, 404, {
          ok: false,
          error: "APK not built yet. Call POST /api/build first.",
        });
        return;
      }
      const stat = fs.statSync(p.apkPath);
      res.writeHead(200, {
        "Content-Type": "application/vnd.android.package-archive",
        "Content-Disposition": 'attachment; filename="PaperFetch-debug.apk"',
        "Content-Length": stat.size,
      });
      fs.createReadStream(p.apkPath).pipe(res);
      return;
    }

    if (req.method === "GET" && pathname === "/api/devices") {
      const info = await listAdbDevices();
      sendJson(res, 200, info);
      return;
    }

    if (req.method === "POST" && pathname === "/api/build") {
      if (activeJob) {
        sendJson(res, 409, { ok: false, error: `Busy running: ${activeJob}` });
        return;
      }
      activeJob = "build";
      try {
        await ensureProjectConfig();
        const result = await runGradle([":app:assembleDebug"], {
          capture: true,
        });
        sendJson(res, result.code === 0 ? 200 : 500, {
          ok: result.code === 0,
          code: result.code,
          output: result.output,
          apk: getApkInfo(),
        });
      } finally {
        activeJob = null;
      }
      return;
    }

    if (req.method === "POST" && pathname === "/api/test") {
      if (activeJob) {
        sendJson(res, 409, { ok: false, error: `Busy running: ${activeJob}` });
        return;
      }
      activeJob = "test";
      try {
        await ensureProjectConfig();
        const result = await runGradle([":app:testDebugUnitTest"], {
          capture: true,
        });
        sendJson(res, result.code === 0 ? 200 : 500, {
          ok: result.code === 0,
          code: result.code,
          output: result.output,
        });
      } finally {
        activeJob = null;
      }
      return;
    }

    if (req.method === "POST" && pathname === "/api/adb/deploy") {
      if (activeJob) {
        sendJson(res, 409, { ok: false, error: `Busy running: ${activeJob}` });
        return;
      }
      const p = getPaths();
      if (!fs.existsSync(p.apkPath)) {
        sendJson(res, 400, {
          ok: false,
          error: "APK not found. Build the APK first.",
        });
        return;
      }
      const body = await readJsonBody(req);
      let serial = body.serial;
      if (!serial) {
        const info = await listAdbDevices();
        const ready = info.devices.find((d) => d.state === "device");
        if (!ready) {
          sendJson(res, 400, {
            ok: false,
            error: "No ready ADB device or emulator connected.",
          });
          return;
        }
        serial = ready.serial;
      }

      activeJob = `deploy:${serial}`;
      try {
        const installRes = await runAdb(
          ["-s", serial, "install", "-r", p.apkPath],
          { capture: true }
        );
        if (installRes.code !== 0) {
          sendJson(res, 500, {
            ok: false,
            serial,
            output: installRes.output,
          });
          return;
        }
        const launchRes = await runAdb(
          [
            "-s",
            serial,
            "shell",
            "am",
            "start",
            "-n",
            `${APP_PACKAGE}/${MAIN_ACTIVITY}`,
          ],
          { capture: true }
        );
        sendJson(res, launchRes.code === 0 ? 200 : 500, {
          ok: launchRes.code === 0,
          serial,
          output: `${installRes.output}\n${launchRes.output}`.trim(),
        });
      } finally {
        activeJob = null;
      }
      return;
    }

    sendJson(res, 404, { ok: false, error: "Not found" });
  } catch (err) {
    sendJson(res, 500, { ok: false, error: err.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`PaperFetch Launcher running at http://${HOST}:${PORT}`);
});
