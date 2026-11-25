# PaperFetch (Pinokio Launcher)

[![Install with Pinokio](https://badges.pinokio.co/install.svg)](https://pinokio.co/resolve?url=https://github.com/hunterdrakeusf/PaperFetch.Pinokio)

This app will help you find the pdfs for your journal database search results saved as csv or ris files. It's fast and adds just a touch of whimsey.

1-click cross-platform Pinokio launcher for **[PaperFetch](https://github.com/hunterdrakeusf/PaperFetch)** — an open-source native Android app (Kotlin + Jetpack Compose) that scans CSV (including Rayyan exports), RIS, and text reference lists for DOIs, resolves free legal open-access research PDFs via OpenAlex, Europe PMC, and Crossref, downloads them, and tracks progress with dashboards and Rayyan CSV export.

## What This Launcher Does

Because upstream **PaperFetch** is a native Android Gradle project (`compileSdk 36.1`, `minSdk 24`, Gradle `9.3.1`) without a checked-in Gradle wrapper or debug keystore, this Pinokio launcher automates the entire build and deployment toolchain in an isolated local environment (Windows, macOS, and Linux):

1. **Install (`install.js`)**:
   - Clones `https://github.com/hunterdrakeusf/PaperFetch` into `app/` without modifying upstream source files.
   - Installs OpenJDK 21 in a dedicated `conda_env/` via `conda-forge`.
   - Downloads Gradle `9.3.1` and Android SDK Command-Line Tools locally into `tools/`.
   - Accepts Android SDK licenses and installs `platform-tools` (`adb`), `platforms;android-36.1`, and `build-tools;36.1.0`.
   - Generates a local `app/debug.keystore` and `app/local.properties` (both already gitignored upstream).
   - Compiles the upstream Android APK (`app/app/build/outputs/apk/debug/app-debug.apk`).
2. **Start (`start.js`)**:
   - Launches a local web UI in Pinokio (`http://127.0.0.1:<port>`) where you can:
     - **Download `PaperFetch-debug.apk`** to sideload onto any Android 7.0+ (API 24+) device.
     - **1-click Install & Launch via ADB** on any USB/wireless-connected Android phone or Android Emulator.
     - **Rebuild the Debug APK** or **Run Upstream Unit Tests** (`:app:testDebugUnitTest`).
3. **Update (`update.js`)**: Pulls the latest launcher and upstream PaperFetch commits and rebuilds the APK.
4. **Reset (`reset.js`)**: Removes `app/`, `conda_env/`, and `tools/` for a clean reinstall.

## How to Use

1. Click **Install** in Pinokio and wait for the Android toolchain setup and APK build to finish.
2. Click **Start** to open the PaperFetch Launcher Web UI.
3. Either:
   - Click **Download APK** and transfer/install `PaperFetch-debug.apk` on your Android device, **or**
   - Connect an Android device (with USB Debugging enabled) or start an Android Emulator, click **Refresh Devices**, and click **Install & Launch**.

## Programmatic API

When started, the launcher exposes a local HTTP JSON API on `http://127.0.0.1:<PORT>` (shown in the Pinokio Web UI address bar):

| Method | Endpoint | Description |
| --- | --- | --- |
| `GET` | `/api/status` | Returns build status, APK metadata, upstream git commit, and toolchain paths |
| `GET` | `/api/apk` | Downloads `PaperFetch-debug.apk` |
| `GET` | `/api/devices` | Lists connected ADB Android devices and emulators |
| `POST` | `/api/build` | Rebuilds the upstream Debug APK (`:app:assembleDebug`) |
| `POST` | `/api/test` | Runs upstream Kotlin unit tests (`:app:testDebugUnitTest`) |
| `POST` | `/api/adb/deploy` | Installs and launches PaperFetch on a connected ADB device (optional JSON body `{"serial":"..."}`) |

### cURL

```bash
# Check launcher and APK status
curl -s http://127.0.0.1:3000/api/status

# Download the built APK
curl -L -o PaperFetch-debug.apk http://127.0.0.1:3000/api/apk

# List connected ADB devices
curl -s http://127.0.0.1:3000/api/devices

# Rebuild the APK
curl -X POST http://127.0.0.1:3000/api/build

# Run upstream unit tests
curl -X POST http://127.0.0.1:3000/api/test

# Install and launch on the first ready ADB device
curl -X POST http://127.0.0.1:3000/api/adb/deploy \
  -H "Content-Type: application/json" \
  -d '{}'
```

### JavaScript (Node.js / Browser)

```javascript
const BASE_URL = "http://127.0.0.1:3000";

// 1. Check status
const status = await fetch(`${BASE_URL}/api/status`).then((r) => r.json());
console.log("APK ready:", status.apk.exists, "Size (MB):", status.apk.sizeMB);

// 2. Run upstream unit tests
const testResult = await fetch(`${BASE_URL}/api/test`, { method: "POST" }).then((r) => r.json());
console.log("Tests passed:", testResult.ok);

// 3. Deploy to first connected Android device
const deployResult = await fetch(`${BASE_URL}/api/adb/deploy`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({})
}).then((r) => r.json());
console.log("Deploy result:", deployResult);
```

### Python

```python
import requests

BASE_URL = "http://127.0.0.1:3000"

# 1. Check launcher and APK status
status = requests.get(f"{BASE_URL}/api/status").json()
print("APK ready:", status["apk"]["exists"], "Commit:", status["git"]["commit"])

# 2. Download the built APK
apk_resp = requests.get(f"{BASE_URL}/api/apk")
apk_resp.raise_for_status()
with open("PaperFetch-debug.apk", "wb") as f:
    f.write(apk_resp.content)

# 3. Trigger upstream unit tests
test_res = requests.post(f"{BASE_URL}/api/test").json()
print("Tests passed:", test_res["ok"])
```
