package com.sandeep.posterforge

import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.os.SystemClock
import android.view.View
import android.view.ViewGroup
import android.webkit.ConsoleMessage
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.widget.FrameLayout
import android.widget.Toast
import java.io.File
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.FileProvider
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.updatePadding
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewClientCompat

class MainActivity : ComponentActivity() {
    companion object {
        const val ORIGIN = "https://appassets.androidplatform.net"
        const val START_URL = "$ORIGIN/assets/index.html"
    }

    private lateinit var webView: WebView
    lateinit var bridge: NativeBridge
    private var pageReady = false
    private var lastBack = 0L
    private var fileCallback: ValueCallback<Array<Uri>>? = null

    // Android Photo Picker (no storage permission). Falls back to ACTION_OPEN_DOCUMENT on old devices.
    private val pickImage = registerForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        deliverFiles(uri?.let { arrayOf(it) })
    }
    // Fonts, .tframe projects, .map files: system document picker.
    // Batch watermark: multi-select Photo Picker.
    private val pickImages = registerForActivityResult(ActivityResultContracts.PickMultipleVisualMedia()) { uris ->
        deliverFiles(if (uris.isEmpty()) null else uris.toTypedArray())
    }
    // <input capture>: the system camera app writes into our cache through FileProvider (no CAMERA permission needed).
    private var cameraUri: Uri? = null
    private val takePicture = registerForActivityResult(ActivityResultContracts.TakePicture()) { ok ->
        deliverFiles(if (ok) cameraUri?.let { arrayOf(it) } else null)
    }
    private var insetsJs = ""
    private val pickDocument = registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        deliverFiles(uri?.let { arrayOf(it) })
    }
    private val pickDocuments = registerForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        deliverFiles(if (uris.isEmpty()) null else uris.toTypedArray())
    }
    val storagePermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        bridge.onStoragePermission(granted)
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        val splash = installSplashScreen()
        super.onCreate(savedInstanceState)
        val started = SystemClock.uptimeMillis()
        splash.setKeepOnScreenCondition { !pageReady && SystemClock.uptimeMillis() - started < 2500 }
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.dark(Color.TRANSPARENT)
        )

        val root = FrameLayout(this).apply { setBackgroundColor(0xFF090D16.toInt()) }
        webView = WebView(this).apply {
            setBackgroundColor(0xFF090D16.toInt())
            layoutParams = FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
            overScrollMode = View.OVER_SCROLL_NEVER          // no overscroll glow / stretch
            isVerticalScrollBarEnabled = false
            isHorizontalScrollBarEnabled = false
            isHapticFeedbackEnabled = true
            // No long-press text-selection / context menu, except inside text fields (Malayalam IME editing).
            setOnLongClickListener { hitTestResult.type != WebView.HitTestResult.EDIT_TEXT_TYPE }
        }
        root.addView(webView)
        setContentView(root)
        // Edge-to-edge: the web UI draws behind the status and navigation bars and gets their sizes as CSS
        // variables (--sat/--sab/--sal/--sar). The keyboard shrinks the WebView (like adjustResize) so the
        // full-screen text editor always sits above it.
        ViewCompat.setOnApplyWindowInsetsListener(root) { v, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
            v.updatePadding(bottom = ime.bottom)
            val d = resources.displayMetrics.density
            val bottom = if (ime.bottom > 0) 0f else bars.bottom / d
            insetsJs = "window.pfSetInsets&&window.pfSetInsets(${bars.top / d},$bottom,${bars.left / d},${bars.right / d})"
            if (pageReady) webView.evaluateJavascript(insetsJs, null)
            WindowInsetsCompat.CONSUMED
        }

        val assetLoader = WebViewAssetLoader.Builder()
            .setDomain("appassets.androidplatform.net")
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            // results of native image jobs (cutout, filters, decoded photos); see NativeBridge.jobRun
            .addPathHandler("/jobs/", WebViewAssetLoader.InternalStoragePathHandler(this, java.io.File(cacheDir, "jobs").apply { mkdirs() }))
            .build()

        with(webView.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true          // localStorage
            @Suppress("DEPRECATION")
            databaseEnabled = true            // IndexedDB / WebSQL (IndexedDB is always on in modern WebView)
            allowFileAccess = false           // assets are served over https://appassets.androidplatform.net
            allowContentAccess = true         // content:// URIs returned by the photo picker
            mediaPlaybackRequiresUserGesture = true
            cacheMode = WebSettings.LOAD_DEFAULT
            textZoom = 100                    // keep layout stable when the system font size is large
            setSupportZoom(false)
            builtInZoomControls = false
            displayZoomControls = false
            loadWithOverviewMode = true
            useWideViewPort = true
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
        }
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)

        bridge = NativeBridge(this, webView, SecureStore(this))
        webView.addJavascriptInterface(bridge, "PFNative")

        webView.webViewClient = object : WebViewClientCompat() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                if (request.url.host == "appassets.androidplatform.net") assetLoader.shouldInterceptRequest(request.url)
                // The web layer is fully offline: block every other network fetch (Gemini goes through the native bridge).
                else if (request.url.scheme == "http" || request.url.scheme == "https") WebResourceResponse("text/plain", "utf-8", 403, "Blocked", emptyMap(), java.io.ByteArrayInputStream(ByteArray(0)))
                else null

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val url = request.url
                if (url.host == "appassets.androidplatform.net") return false
                // Links to other sites (licences, font pages) open in the browser, never inside the editor.
                try { startActivity(Intent(Intent.ACTION_VIEW, url)) } catch (_: ActivityNotFoundException) {}
                return true
            }

            override fun onPageFinished(view: WebView, url: String?) { pageReady = true; if (insetsJs.isNotEmpty()) view.evaluateJavascript(insetsJs, null) }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                fileCallback?.onReceiveValue(null)
                fileCallback = callback
                val accept = params.acceptTypes.flatMap { it.split(",") }.map { it.trim() }.filter { it.isNotEmpty() }
                val imagesOnly = accept.isNotEmpty() && accept.all { it.startsWith("image/") }
                return try {
                    when {
                        imagesOnly && params.isCaptureEnabled -> {
                            val dir = File(cacheDir, "camera").apply { mkdirs() }
                            dir.listFiles()?.forEach { if (System.currentTimeMillis() - it.lastModified() > 86_400_000) it.delete() }
                            val f = File(dir, "camera-${System.currentTimeMillis()}.jpg")
                            cameraUri = FileProvider.getUriForFile(this@MainActivity, "$packageName.fileprovider", f)
                            takePicture.launch(cameraUri!!)
                        }
                        imagesOnly && params.mode == FileChooserParams.MODE_OPEN_MULTIPLE -> pickImages.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
                        imagesOnly -> pickImage.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
                        params.mode == FileChooserParams.MODE_OPEN_MULTIPLE -> pickDocuments.launch(arrayOf("*/*"))
                        else -> pickDocument.launch(arrayOf("*/*"))
                    }
                    true
                } catch (e: ActivityNotFoundException) {
                    fileCallback = null
                    false
                }
            }

            override fun onConsoleMessage(msg: ConsoleMessage): Boolean {
                if (BuildConfig.DEBUG) android.util.Log.d("PosterForgeJS", "${msg.message()} @${msg.sourceId()}:${msg.lineNumber()}")
                return true
            }
        }

        // Back: 1) let the web app close a tab/panel, 2) WebView history, 3) double-press to exit.
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                webView.evaluateJavascript("(function(){try{return !!(window.pfHandleBack&&window.pfHandleBack())}catch(e){return false}})()") { handled ->
                    if (handled == "true") return@evaluateJavascript
                    if (webView.canGoBack()) { webView.goBack(); return@evaluateJavascript }
                    val now = SystemClock.uptimeMillis()
                    if (now - lastBack < 2000) finish()
                    else { lastBack = now; Toast.makeText(this@MainActivity, R.string.press_back_again, Toast.LENGTH_SHORT).show() }
                }
            }
        })

        if (savedInstanceState != null) webView.restoreState(savedInstanceState)
        if (webView.url == null) webView.loadUrl(START_URL)
    }

    private fun deliverFiles(uris: Array<Uri>?) {
        fileCallback?.onReceiveValue(uris)
        fileCallback = null
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        webView.saveState(outState)
    }

    override fun onPause() { webView.onPause(); super.onPause() }
    override fun onResume() { super.onResume(); webView.onResume() }
    override fun onDestroy() {
        webView.removeJavascriptInterface("PFNative")
        webView.destroy()
        super.onDestroy()
    }
}
