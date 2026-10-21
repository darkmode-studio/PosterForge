# PosterForge (Android)

Offline poster maker for Android: native Kotlin shell + WebView (Fabric.js 5.3.1 canvas), served from APK assets through
`WebViewAssetLoader` at `https://appassets.androidplatform.net/assets/index.html`. No Capacitor, no server.

* Package `com.sandeep.posterforge`, version 1.1.0 (versionCode 3), minSdk 24, targetSdk 36.
* `MainActivity.kt` – WebView, edge-to-edge insets → `window.pfSetInsets`, back button → `window.pfHandleBack`,
  photo picker for `<input type=file>`, blocks every non-asset network request from the WebView.
* `NativeBridge.kt` (`window.PFNative`) – encrypted Gemini key (set/clear/hint only; the key never goes to JS),
  `gemini()` REST call made natively, chunked file transfer → MediaStore (Pictures/PosterForge, SVG → Downloads/PosterForge) or share sheet.
* `SecureStore.kt` – EncryptedSharedPreferences (AES-256-GCM, Android Keystore master key). Excluded from backup.
* Web code: `app/src/main/assets/` (`js/app.js`, `tools.js`, `history.js`, `db.js`, `ui.js`, `native.js`).

## Build
```
source /workspace/android-build/env.sh
cp /workspace/android-keys/posterforge-keystore.properties keystore.properties   # release signing
./gradlew testDebugUnitTest assembleDebug assembleRelease
```
For an update bump `versionCode` in `app/build.gradle.kts` and keep signing with the same keystore.

## Tests
* `../test/e2e.py` (+ `e2e_csp.py`, same suite with the page CSP enforced) – 55 Playwright checks on the web assets with a mocked `PFNative` (serve assets on :8241 with `../test/serve.sh`).
* `../test/e2e_pro.py [--csp]` – 39 checks for the 1.1.0 features + UI fixes at 360/412/461 px (DPR 2.6), incl. a 4× 12 MP import perf test.
* `app/src/test/.../CoreTest.kt` – Robolectric/JUnit: Gemini request (key in header, model sanitising, errors), key hint, file names.
* `app/src/test/.../ImagingTest.kt` – Robolectric (native graphics): cutout, filters, trace, cancel, 12 MP decode to working size,
  job files, tile stitcher, memory budget, and a perf test with several 12 MP images (prints `PERF` timings/heap).

## Fonts (1.0.1)
29 families bundled offline in `app/src/main/assets/fonts`, each with its licence file (`LICENSE-<Family>.txt`):
- Malayalam: Manjari, Chilanka, Noto Sans Malayalam, Noto Serif Malayalam, Baloo Chettan 2, Anek Malayalam, Gayathri, Rachana, Meera, Keraleeyam, Uroob, Dyuthi
- Serif: Playfair Display, DM Serif Display, Cormorant Garamond, Fraunces, Lora
- Sans: Montserrat, Poppins, Inter, Space Grotesk, Oswald
- Display: Bebas Neue, Anton, Archivo Black
- Script: Dancing Script, Great Vibes, Caveat, Permanent Marker

All are SIL OFL 1.1 except Permanent Marker (Apache 2.0). `build-fonts.py` (run by `download-assets.sh`) makes static
Regular/Bold instances of variable fonts, then subsets every font to Latin (+ Malayalam for the Malayalam fonts) while
keeping all OpenType layout features, so conjunct shaping is unchanged. Total size is about 6 MB uncompressed.

## 1.1.0 – pro editing engine (stage 1)
- Groups / ungroup; multi-select via the top-bar Select mode or long-press (520 ms).
- Clipping: select a photo + a shape or text → *Clip* puts the photo inside; zoom/pan inside the frame; *Release* restores both.
- Layer masks on photos: hide/reveal brush (size, softness), gradient masks (4 directions + radial), invert, clear. Stored as a
  PNG alpha mask in the project; the photo itself is never changed.
- 16 blend modes per layer. Photo adjustments (presets + brightness/contrast/saturation/warmth/blur/vignette), non-destructive.
- Smart snapping: artboard edges/centre, other items' edges/centres, equal-spacing indicator with gap labels, 5 % safe margins.
- All of the above go through the existing history (one undo step per action) and crash-safe autosave.
- Performance: photos decode natively (`Jobs.kt`/`ImageOps.kt`, single background thread, EXIF-aware, inSampleSize) to a
  2048 px working copy; the original is kept in IndexedDB (`originals` store) and swapped in for exports that need it.
  Trace, cutout and filters run as native background jobs with progress + cancel. PNG/JPEG export renders ~4 MP tiles in
  the WebView and stitches/encodes natively. Max export size comes from `ActivityManager.MemoryInfo` (`memoryInfo()`).
- UI: toolbar labels shortened (Icons, Canvas) and never clipped; selection strip has left padding + scroll fades and is
  hidden while a tool panel is open; panel help text no longer clipped.
