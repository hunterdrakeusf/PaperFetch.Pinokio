const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");
const { spawn, spawnSync } = require("child_process");

const ROOT_DIR = __dirname;
const APP_DIR = path.join(ROOT_DIR, "app");
const TOOLS_DIR = path.join(ROOT_DIR, "tools");
const GRADLE_DIR = path.join(TOOLS_DIR, "gradle");
const GRADLE_HOME = path.join(TOOLS_DIR, "gradle-home");
const SDK_DIR = path.join(TOOLS_DIR, "android-sdk");
const DOWNLOADS_DIR = path.join(TOOLS_DIR, "downloads");

const DEFAULT_GRADLE_VERSION = "9.3.1";
const CMDLINE_TOOLS_BUILD = "15641748";
const SDK_PACKAGES = [
  "platform-tools",
  "platforms;android-36.1",
  "build-tools;36.1.0",
];
const APP_PACKAGE = "com.aistudio.paperfetch.wryq";
const MAIN_ACTIVITY = "com.example.MainActivity";

const IS_WIN = process.platform === "win32";

function getGradleVersion() {
  const propsPath = path.join(
    APP_DIR,
    "gradle",
    "wrapper",
    "gradle-wrapper.properties"
  );
  if (fs.existsSync(propsPath)) {
    const content = fs.readFileSync(propsPath, "utf8");
    const match = content.match(/gradle-([0-9.]+)-(?:bin|all)\.zip/);
    if (match) return match[1];
  }
  return DEFAULT_GRADLE_VERSION;
}

function getPaths() {
  const gradleVersion = getGradleVersion();
  const gradleBin = path.join(
    GRADLE_DIR,
    `gradle-${gradleVersion}`,
    "bin",
    IS_WIN ? "gradle.bat" : "gradle"
  );
  const sdkmanagerBin = path.join(
    SDK_DIR,
    "cmdline-tools",
    "latest",
    "bin",
    IS_WIN ? "sdkmanager.bat" : "sdkmanager"
  );
  const adbBin = path.join(
    SDK_DIR,
    "platform-tools",
    IS_WIN ? "adb.exe" : "adb"
  );
  const apkPath = path.join(
    APP_DIR,
    "app",
    "build",
    "outputs",
    "apk",
    "debug",
    "app-debug.apk"
  );
  const keystorePath = path.join(APP_DIR, "debug.keystore");
  const localPropsPath = path.join(APP_DIR, "local.properties");

  return {
    rootDir: ROOT_DIR,
    appDir: APP_DIR,
    toolsDir: TOOLS_DIR,
    gradleDir: GRADLE_DIR,
    gradleHome: GRADLE_HOME,
    gradleVersion,
    gradleBin,
    sdkDir: SDK_DIR,
    sdkmanagerBin,
    adbBin,
    apkPath,
    keystorePath,
    localPropsPath,
    downloadsDir: DOWNLOADS_DIR,
  };
}

function findJavaHome() {
  const javaExe = IS_WIN ? "java.exe" : "java";
  const javacExe = IS_WIN ? "javac.exe" : "javac";

  const isJdkDir = (dir) =>
    Boolean(
      dir &&
        fs.existsSync(path.join(dir, "bin", javaExe)) &&
        fs.existsSync(path.join(dir, "bin", javacExe))
    );

  const candidates = [];
  if (process.env.JAVA_HOME) candidates.push(process.env.JAVA_HOME);

  const condaDirs = [
    process.env.CONDA_PREFIX,
    path.join(ROOT_DIR, "conda_env"),
  ].filter(Boolean);

  for (const c of condaDirs) {
    candidates.push(
      path.join(c, "Library", "lib", "jvm"),
      path.join(c, "Library"),
      path.join(c, "lib", "jvm"),
      c
    );
  }

  for (const dir of candidates) {
    if (isJdkDir(dir)) return dir;
  }

  const lookup = spawnSync(IS_WIN ? "where" : "which", ["javac"], {
    encoding: "utf8",
  });
  if (lookup.status === 0 && lookup.stdout) {
    const first = lookup.stdout
      .split(/\r?\n/)
      .map((s) => s.trim())
      .find(Boolean);
    if (first && fs.existsSync(first)) {
      const real = fs.realpathSync(first);
      const home = path.resolve(path.dirname(real), "..");
      if (isJdkDir(home)) return home;
    }
  }

  throw new Error(
    "JDK (javac) not found. Run install.js to install OpenJDK 21 in conda_env."
  );
}

function getBuildEnv() {
  const p = getPaths();
  const javaHome = findJavaHome();
  const pathSep = IS_WIN ? ";" : ":";
  const extraPaths = [
    path.join(javaHome, "bin"),
    path.dirname(p.adbBin),
    path.dirname(p.sdkmanagerBin),
    path.dirname(p.gradleBin),
  ].filter((d) => fs.existsSync(d));

  return {
    ...process.env,
    JAVA_HOME: javaHome,
    ANDROID_HOME: p.sdkDir,
    ANDROID_SDK_ROOT: p.sdkDir,
    GRADLE_USER_HOME: p.gradleHome,
    PATH: [...extraPaths, process.env.PATH || ""].join(pathSep),
  };
}

function quoteWinArg(arg) {
  if (!arg) return '""';
  if (/[\s;=&|<>^%"]/.test(arg)) {
    return '"' + arg.replace(/"/g, '\\"') + '"';
  }
  return arg;
}

function spawnTool(exe, args, options = {}) {
  const isBatch =
    IS_WIN &&
    (exe.toLowerCase().endsWith(".bat") || exe.toLowerCase().endsWith(".cmd"));
  if (isBatch) {
    const cmdLine = [exe, ...args].map(quoteWinArg).join(" ");
    return spawn("cmd.exe", ["/d", "/s", "/c", `"${cmdLine}"`], {
      ...options,
      windowsVerbatimArguments: true,
      windowsHide: true,
    });
  }
  return spawn(exe, args, {
    ...options,
    windowsHide: true,
  });
}

function runCommand(exe, args, options = {}) {
  return new Promise((resolve, reject) => {
    const capture = Boolean(options.capture);
    const stdinText = options.stdinText;
    const stdio = [
      stdinText ? "pipe" : "ignore",
      capture ? "pipe" : "inherit",
      capture ? "pipe" : "inherit",
    ];
    const child = spawnTool(exe, args, {
      cwd: options.cwd || ROOT_DIR,
      env: options.env || process.env,
      stdio,
    });

    let output = "";
    if (capture) {
      child.stdout.on("data", (d) => {
        output += d.toString();
      });
      child.stderr.on("data", (d) => {
        output += d.toString();
      });
    }

    if (stdinText && child.stdin) {
      child.stdin.on("error", () => {});
      child.stdin.write(stdinText);
      child.stdin.end();
    }

    child.on("error", (err) => reject(err));
    child.on("close", (code) => {
      if (capture) {
        resolve({ code: code ?? 1, output });
      } else if (code === 0) {
        resolve({ code: 0, output: "" });
      } else {
        reject(new Error(`Command failed (${code}): ${exe} ${args.join(" ")}`));
      }
    });
  });
}

function downloadFile(url, destPath, redirects = 0) {
  if (redirects > 10) {
    return Promise.reject(new Error(`Too many redirects downloading ${url}`));
  }
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  const tempPath = `${destPath}.part`;

  return new Promise((resolve, reject) => {
    const client = url.startsWith("https:") ? https : http;
    const req = client.get(
      url,
      { headers: { "User-Agent": "PaperFetch-Pinokio-Launcher/1.0" } },
      (res) => {
        if (
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          res.resume();
          const nextUrl = new URL(res.headers.location, url).toString();
          downloadFile(nextUrl, destPath, redirects + 1)
            .then(resolve)
            .catch(reject);
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode} downloading ${url}`));
          return;
        }

        const total = Number(res.headers["content-length"] || 0);
        let received = 0;
        let lastPct = -10;
        const file = fs.createWriteStream(tempPath);

        res.on("data", (chunk) => {
          received += chunk.length;
          if (total > 0) {
            const pct = Math.floor((received / total) * 100);
            if (pct >= lastPct + 10) {
              lastPct = pct;
              const mb = (received / 1048576).toFixed(1);
              const totalMb = (total / 1048576).toFixed(1);
              console.log(`  Downloading... ${pct}% (${mb}/${totalMb} MB)`);
            }
          }
        });

        res.pipe(file);
        file.on("finish", () => {
          file.close(() => {
            fs.renameSync(tempPath, destPath);
            resolve(destPath);
          });
        });
        file.on("error", (err) => {
          try {
            fs.unlinkSync(tempPath);
          } catch (_) {}
          reject(err);
        });
      }
    );

    req.on("error", (err) => {
      try {
        fs.unlinkSync(tempPath);
      } catch (_) {}
      reject(err);
    });
  });
}

function hasCommand(cmd) {
  const res = spawnSync(IS_WIN ? "where" : "which", [cmd], {
    stdio: "ignore",
  });
  return res.status === 0;
}

async function extractZip(zipPath, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  if (hasCommand("7zz")) {
    await runCommand("7zz", ["x", "-y", `-o${destDir}`, zipPath]);
    return;
  }
  if (hasCommand("7z")) {
    await runCommand("7z", ["x", "-y", `-o${destDir}`, zipPath]);
    return;
  }
  if (hasCommand("unzip")) {
    await runCommand("unzip", ["-q", "-o", zipPath, "-d", destDir]);
    return;
  }
  if (hasCommand("tar")) {
    await runCommand("tar", ["-xf", zipPath, "-C", destDir]);
    return;
  }
  throw new Error(
    "No zip extraction utility found (tried 7zz, 7z, unzip, tar)."
  );
}

function ensureExecutable(filePath) {
  if (!IS_WIN && fs.existsSync(filePath)) {
    fs.chmodSync(filePath, 0o755);
  }
}

async function ensureGradle() {
  const p = getPaths();
  if (fs.existsSync(p.gradleBin)) {
    console.log(`[OK] Gradle ${p.gradleVersion} already installed.`);
    return;
  }
  const zipName = `gradle-${p.gradleVersion}-bin.zip`;
  const zipPath = path.join(p.downloadsDir, zipName);
  const url = `https://services.gradle.org/distributions/${zipName}`;

  if (!fs.existsSync(zipPath)) {
    console.log(`[1/5] Downloading Gradle ${p.gradleVersion}...`);
    await downloadFile(url, zipPath);
  }
  console.log(`[1/5] Extracting Gradle ${p.gradleVersion}...`);
  await extractZip(zipPath, p.gradleDir);
  ensureExecutable(p.gradleBin);
  try {
    fs.unlinkSync(zipPath);
  } catch (_) {}

  if (!fs.existsSync(p.gradleBin)) {
    throw new Error(`Gradle binary missing after extraction: ${p.gradleBin}`);
  }
}

async function ensureAndroidSdk() {
  const p = getPaths();
  const env = getBuildEnv();

  if (!fs.existsSync(p.sdkmanagerBin)) {
    const osTag =
      process.platform === "win32"
        ? "win"
        : process.platform === "darwin"
        ? "mac"
        : "linux";
    const zipName = `commandlinetools-${osTag}-${CMDLINE_TOOLS_BUILD}_latest.zip`;
    const zipPath = path.join(p.downloadsDir, zipName);
    const url = `https://dl.google.com/android/repository/${zipName}`;

    if (!fs.existsSync(zipPath)) {
      console.log(`[2/5] Downloading Android SDK Command-Line Tools (${osTag})...`);
      await downloadFile(url, zipPath);
    }

    const tmpDir = path.join(p.toolsDir, "tmp-cmdline");
    fs.rmSync(tmpDir, { recursive: true, force: true });
    console.log("[2/5] Extracting Android SDK Command-Line Tools...");
    await extractZip(zipPath, tmpDir);

    const targetDir = path.join(p.sdkDir, "cmdline-tools", "latest");
    fs.rmSync(targetDir, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(targetDir), { recursive: true });
    fs.renameSync(path.join(tmpDir, "cmdline-tools"), targetDir);
    fs.rmSync(tmpDir, { recursive: true, force: true });

    const binDir = path.join(targetDir, "bin");
    if (!IS_WIN && fs.existsSync(binDir)) {
      for (const f of fs.readdirSync(binDir)) {
        ensureExecutable(path.join(binDir, f));
      }
    }
    try {
      fs.unlinkSync(zipPath);
    } catch (_) {}
  } else {
    console.log("[OK] Android SDK Command-Line Tools already installed.");
  }

  console.log("[3/5] Accepting Android SDK licenses...");
  const licenseRes = await runCommand(
    p.sdkmanagerBin,
    [`--sdk_root=${p.sdkDir}`, "--licenses"],
    {
      env,
      capture: true,
      stdinText: "y\n".repeat(100),
    }
  );
  if (licenseRes.code !== 0) {
    console.log(licenseRes.output);
  }

  console.log(`[3/5] Installing Android SDK packages: ${SDK_PACKAGES.join(", ")}...`);
  await runCommand(
    p.sdkmanagerBin,
    [`--sdk_root=${p.sdkDir}`, ...SDK_PACKAGES],
    {
      env,
      stdinText: "y\n".repeat(20),
    }
  );
}

async function ensureProjectConfig() {
  const p = getPaths();
  const env = getBuildEnv();

  const sdkDirProp = p.sdkDir.replace(/\\/g, "/");
  fs.writeFileSync(p.localPropsPath, `sdk.dir=${sdkDirProp}\n`, "utf8");
  console.log(`[4/5] Wrote app/local.properties -> ${sdkDirProp}`);

  if (!fs.existsSync(p.keystorePath)) {
    console.log("[4/5] Generating Android debug.keystore for debugConfig...");
    const keytool = path.join(
      env.JAVA_HOME,
      "bin",
      IS_WIN ? "keytool.exe" : "keytool"
    );
    await runCommand(
      keytool,
      [
        "-genkeypair",
        "-v",
        "-keystore",
        p.keystorePath,
        "-storepass",
        "android",
        "-alias",
        "androiddebugkey",
        "-keypass",
        "android",
        "-keyalg",
        "RSA",
        "-keysize",
        "2048",
        "-validity",
        "10000",
        "-dname",
        "CN=Android Debug,O=Android,C=US",
      ],
      { env }
    );
  } else {
    console.log("[OK] app/debug.keystore already exists.");
  }
}

async function runGradle(tasks, options = {}) {
  const p = getPaths();
  const env = getBuildEnv();
  if (!fs.existsSync(p.gradleBin)) {
    throw new Error("Gradle is not installed. Run install.js first.");
  }
  const args = [...tasks, "--no-daemon"];
  return runCommand(p.gradleBin, args, {
    cwd: p.appDir,
    env,
    capture: Boolean(options.capture),
  });
}

async function runAdb(args, options = {}) {
  const p = getPaths();
  const env = getBuildEnv();
  if (!fs.existsSync(p.adbBin)) {
    throw new Error("ADB is not installed. Run install.js first.");
  }
  return runCommand(p.adbBin, args, {
    cwd: p.rootDir,
    env,
    capture: options.capture !== false,
  });
}

async function buildDebugApk(capture = false) {
  const p = getPaths();
  await ensureProjectConfig();
  console.log("[5/5] Building PaperFetch Debug APK (:app:assembleDebug)...");
  const res = await runGradle([":app:assembleDebug"], { capture });
  if (fs.existsSync(p.apkPath)) {
    const stat = fs.statSync(p.apkPath);
    const mb = (stat.size / 1048576).toFixed(2);
    console.log(`[OK] Built PaperFetch APK (${mb} MB): ${p.apkPath}`);
  }
  return res;
}

async function main() {
  const cmd = process.argv[2] || "install";
  if (!fs.existsSync(APP_DIR)) {
    throw new Error("Upstream repository not found in ./app. Run install.js first.");
  }
  const env = getBuildEnv();
  console.log(`Using JAVA_HOME=${env.JAVA_HOME}`);

  if (cmd === "install") {
    await ensureGradle();
    await ensureAndroidSdk();
    await buildDebugApk(false);
  } else if (cmd === "build") {
    await ensureGradle();
    await ensureAndroidSdk();
    await buildDebugApk(false);
  } else if (cmd === "test") {
    await ensureProjectConfig();
    await runGradle([":app:testDebugUnitTest"], { capture: false });
  } else {
    console.log("Usage: node setup.js [install|build|test]");
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  });
}

module.exports = {
  APP_PACKAGE,
  MAIN_ACTIVITY,
  getPaths,
  findJavaHome,
  getBuildEnv,
  runGradle,
  runAdb,
  ensureProjectConfig,
};
