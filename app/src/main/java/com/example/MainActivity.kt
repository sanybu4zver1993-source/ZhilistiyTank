package com.example

import android.Manifest
import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.ComponentName
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color as AndroidColor
import android.graphics.Matrix
import android.media.ExifInterface
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import android.provider.MediaStore
import android.provider.Settings
import android.speech.RecognizerIntent
import android.util.Base64
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import androidx.webkit.WebViewAssetLoader
import com.example.ui.theme.MyApplicationTheme
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.util.concurrent.Executors

class MainActivity : ComponentActivity() {

    private var webViewRef: WebView? = null
    private lateinit var vaultManager: VaultManager

    private var filePathCallback: ValueCallback<Array<Uri>>? = null
    private var pendingPhotoCallbackName: String? = null
    private var pendingVoiceCallbackName: String? = null

    private var awaitingSystemResult = false
    private var systemResultDeadlineMs = 0L

    private lateinit var filePickerLauncher: ActivityResultLauncher<String>
    private lateinit var foodPhotoPickerLauncher: ActivityResultLauncher<String>
    private lateinit var voiceFoodLauncher: ActivityResultLauncher<Intent>
    private lateinit var notifPermissionLauncher: ActivityResultLauncher<String>

    private val imageExecutor = Executors.newSingleThreadExecutor()
    private val mainHandler = Handler(Looper.getMainLooper())

    fun launchExternalSystemFlow(ttlMs: Long = 90_000L, block: () -> Unit) {
        awaitingSystemResult = true
        systemResultDeadlineMs = SystemClock.elapsedRealtime() + ttlMs
        try {
            block()
        } catch (_: Exception) {
            awaitingSystemResult = false
            systemResultDeadlineMs = 0L
        }
    }

    private fun clearExternalFlowGrace() {
        awaitingSystemResult = false
        systemResultDeadlineMs = 0L
    }

    private fun invokeJsCallback(callbackName: String, argJsonLiteral: String) {
        val safeName = callbackName.replace(Regex("[^a-zA-Z0-9_$.]"), "")
        if (safeName.isBlank()) return
        val quoted = JSONObject.quote(argJsonLiteral)
        mainHandler.post {
            webViewRef?.evaluateJavascript("window['$safeName'] && window['$safeName']($quoted);", null)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Anti-forensics: block OS screenshots, screen recording, and Recents thumbnails
        window.setFlags(
            WindowManager.LayoutParams.FLAG_SECURE,
            WindowManager.LayoutParams.FLAG_SECURE
        )
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.dark(AndroidColor.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.dark(AndroidColor.TRANSPARENT)
        )

        vaultManager = VaultManager(applicationContext)

        filePickerLauncher = registerForActivityResult(ActivityResultContracts.GetContent()) { uri ->
            clearExternalFlowGrace()
            val cb = filePathCallback
            filePathCallback = null
            if (cb != null) {
                cb.onReceiveValue(if (uri != null) arrayOf(uri) else null)
            }
        }

        foodPhotoPickerLauncher = registerForActivityResult(ActivityResultContracts.GetContent()) { uri ->
            clearExternalFlowGrace()
            val cbName = pendingPhotoCallbackName
            pendingPhotoCallbackName = null
            if (cbName == null) return@registerForActivityResult

            if (uri == null) {
                invokeJsCallback(cbName, JSONObject().put("ok", false).put("cancelled", true).toString())
                return@registerForActivityResult
            }

            imageExecutor.execute {
                val res = try {
                    val b64 = decodeAndCompressUriToBase64(applicationContext, uri, 1024)
                    if (b64 != null) {
                        JSONObject().put("ok", true).put("base64", b64).put("mimeType", "image/jpeg").toString()
                    } else {
                        JSONObject().put("ok", false).put("error", "Не удалось декодировать фото").toString()
                    }
                } catch (e: Exception) {
                    JSONObject().put("ok", false).put("error", e.message ?: "Ошибка сжатия фото").toString()
                }
                invokeJsCallback(cbName, res)
            }
        }

        voiceFoodLauncher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            clearExternalFlowGrace()
            val cbName = pendingVoiceCallbackName
            pendingVoiceCallbackName = null
            if (cbName == null) return@registerForActivityResult

            val matches = result.data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)
            val text = matches?.firstOrNull()?.trim() ?: ""
            val payload = if (result.resultCode == RESULT_OK && text.isNotEmpty()) {
                JSONObject().put("ok", true).put("text", text).toString()
            } else {
                JSONObject().put("ok", false).toString()
            }
            invokeJsCallback(cbName, payload)
        }

        notifPermissionLauncher = registerForActivityResult(ActivityResultContracts.RequestPermission()) { _ ->
            clearExternalFlowGrace()
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED
            ) {
                launchExternalSystemFlow {
                    notifPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
                }
            }
        }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                val wv = webViewRef
                if (wv == null) {
                    moveTaskToBack(true)
                    return
                }
                wv.evaluateJavascript("window.handleHardwareBack ? window.handleHardwareBack() : 'MINIMIZE';") { raw ->
                    val action = raw?.trim('"') ?: "MINIMIZE"
                    if (action == "MINIMIZE") {
                        moveTaskToBack(true)
                    }
                }
            }
        })

        setContent {
            MyApplicationTheme {
                AndroidView(
                    factory = { ctx ->
                        val assetLoader = WebViewAssetLoader.Builder()
                            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(ctx))
                            .build()

                        WebView(ctx).apply {
                            webViewRef = this
                            setBackgroundColor(AndroidColor.parseColor("#0D1117"))
                            settings.apply {
                                javaScriptEnabled = true
                                domStorageEnabled = true
                                mediaPlaybackRequiresUserGesture = false
                                allowFileAccess = false
                                allowContentAccess = false
                            }

                            addJavascriptInterface(
                                WebAppInterface(this@MainActivity, this, vaultManager),
                                "AndroidBridge"
                            )

                            webViewClient = object : WebViewClient() {
                                override fun shouldInterceptRequest(
                                    view: WebView,
                                    request: WebResourceRequest
                                ): WebResourceResponse? {
                                    return assetLoader.shouldInterceptRequest(request.url)
                                }
                            }

                            webChromeClient = object : WebChromeClient() {
                                override fun onShowFileChooser(
                                    webView: WebView?,
                                    filePathCallback: ValueCallback<Array<Uri>>?,
                                    fileChooserParams: FileChooserParams?
                                ): Boolean {
                                    this@MainActivity.filePathCallback?.onReceiveValue(null)
                                    this@MainActivity.filePathCallback = filePathCallback
                                    val mime = fileChooserParams?.acceptTypes
                                        ?.firstOrNull { it.isNotBlank() } ?: "*/*"
                                    return try {
                                        launchExternalSystemFlow {
                                            filePickerLauncher.launch(mime)
                                        }
                                        true
                                    } catch (_: Exception) {
                                        clearExternalFlowGrace()
                                        this@MainActivity.filePathCallback?.onReceiveValue(null)
                                        this@MainActivity.filePathCallback = null
                                        false
                                    }
                                }
                            }

                            loadUrl("https://appassets.androidplatform.net/assets/index.html")
                        }
                    },
                    modifier = Modifier
                        .fillMaxSize()
                        .background(Color(0xFF0D1117))
                        .systemBarsPadding()
                        .imePadding()
                )
            }
        }
    }

    fun launchFoodPhotoPicker(callbackName: String) {
        mainHandler.post {
            pendingPhotoCallbackName = callbackName
            launchExternalSystemFlow {
                foodPhotoPickerLauncher.launch("image/*")
            }
        }
    }

    fun launchVoiceFoodRecognizer(callbackName: String) {
        mainHandler.post {
            pendingVoiceCallbackName = callbackName
            val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                putExtra(RecognizerIntent.EXTRA_LANGUAGE, "ru-RU")
                putExtra(RecognizerIntent.EXTRA_PROMPT, "Назови еду и вес...")
            }
            launchExternalSystemFlow {
                voiceFoodLauncher.launch(intent)
            }
        }
    }

    private fun decodeAndCompressUriToBase64(context: Context, uri: Uri, maxSide: Int): String? {
        val boundsOpts = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        context.contentResolver.openInputStream(uri)?.use {
            BitmapFactory.decodeStream(it, null, boundsOpts)
        }
        if (boundsOpts.outWidth <= 0 || boundsOpts.outHeight <= 0) return null

        var sampleSize = 1
        while (boundsOpts.outWidth / (sampleSize * 2) >= maxSide ||
            boundsOpts.outHeight / (sampleSize * 2) >= maxSide
        ) {
            sampleSize *= 2
        }

        val decodeOpts = BitmapFactory.Options().apply {
            inSampleSize = sampleSize
            inPreferredConfig = Bitmap.Config.RGB_565
        }
        val subsampled = context.contentResolver.openInputStream(uri)?.use {
            BitmapFactory.decodeStream(it, null, decodeOpts)
        } ?: return null

        val rotation = try {
            context.contentResolver.openInputStream(uri)?.use { input ->
                val exif = ExifInterface(input)
                when (exif.getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)) {
                    ExifInterface.ORIENTATION_ROTATE_90 -> 90f
                    ExifInterface.ORIENTATION_ROTATE_180 -> 180f
                    ExifInterface.ORIENTATION_ROTATE_270 -> 270f
                    else -> 0f
                }
            } ?: 0f
        } catch (_: Exception) {
            0f
        }

        val maxDim = maxOf(subsampled.width, subsampled.height).toFloat()
        val scale = if (maxDim > maxSide) maxSide / maxDim else 1f
        val matrix = Matrix().apply {
            postScale(scale, scale)
            if (rotation != 0f) postRotate(rotation)
        }

        val finalBitmap = Bitmap.createBitmap(subsampled, 0, 0, subsampled.width, subsampled.height, matrix, true)
        if (finalBitmap !== subsampled) subsampled.recycle()

        val baos = ByteArrayOutputStream(163840)
        finalBitmap.compress(Bitmap.CompressFormat.JPEG, 80, baos)
        finalBitmap.recycle()
        return Base64.encodeToString(baos.toByteArray(), Base64.NO_WRAP)
    }

    override fun onPause() {
        super.onPause()
        val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
        val now = SystemClock.elapsedRealtime()
        val isPickerGraceActive = awaitingSystemResult && now < systemResultDeadlineMs && pm.isInteractive

        if (!isPickerGraceActive) {
            clearExternalFlowGrace()
            VaultManager.clearSessionInRam()
            webViewRef?.evaluateJavascript(
                "window.onAppBackgrounded && window.onAppBackgrounded();",
                null
            )
        }
    }

    override fun onResume() {
        super.onResume()
        val now = SystemClock.elapsedRealtime()
        if (awaitingSystemResult && now >= systemResultDeadlineMs) {
            clearExternalFlowGrace()
            VaultManager.clearSessionInRam()
            webViewRef?.evaluateJavascript(
                "window.onAppBackgrounded && window.onAppBackgrounded();",
                null
            )
            return
        }
        if (awaitingSystemResult) {
            clearExternalFlowGrace()
        }
        webViewRef?.evaluateJavascript(
            "window.syncWaterFromNative && window.syncWaterFromNative();",
            null
        )
    }

    override fun onDestroy() {
        webViewRef = null
        super.onDestroy()
    }
}

class WebAppInterface(
    private val activity: MainActivity,
    private val webView: WebView,
    private val vaultManager: VaultManager
) {
    private val context = activity.applicationContext
    private val cryptoExecutor = Executors.newSingleThreadExecutor()
    private val networkExecutor = Executors.newCachedThreadPool()
    private val mainHandler = Handler(Looper.getMainLooper())

    init {
        WaterSyncBus.activeListener = {
            mainHandler.post {
                webView.evaluateJavascript(
                    "window.syncWaterFromNative && window.syncWaterFromNative();",
                    null
                )
            }
        }
    }

    private fun invokeJsCallback(callbackName: String, argJsonLiteral: String) {
        val safeName = callbackName.replace(Regex("[^a-zA-Z0-9_$.]"), "")
        if (safeName.isBlank()) return
        val quoted = JSONObject.quote(argJsonLiteral)
        mainHandler.post {
            webView.evaluateJavascript("window['$safeName'] && window['$safeName']($quoted);", null)
        }
    }

    // --- Vault (RAM-only key, 1-PIN onboarding, slot-neutral PIN change) ---
    @JavascriptInterface
    fun isVaultInitialized(): Boolean = vaultManager.isInitialized()

    @JavascriptInterface
    fun hasActiveVaultSession(): Boolean = VaultManager.hasActiveSession()

    @JavascriptInterface
    fun lockVaultSessionNow() {
        VaultManager.clearSessionInRam()
    }

    @JavascriptInterface
    fun setupVaultSinglePinAsync(realPin: String, initialJson: String, callbackName: String) {
        cryptoExecutor.execute {
            val ok = try {
                vaultManager.setupVaultSinglePin(realPin, initialJson)
            } catch (_: Exception) {
                false
            }
            invokeJsCallback(callbackName, JSONObject().put("ok", ok).toString())
        }
    }

    @JavascriptInterface
    fun unlockVaultAsync(pin: String, callbackName: String) {
        cryptoExecutor.execute {
            val res = try {
                vaultManager.unlockOrWipe(pin)
            } catch (e: Exception) {
                JSONObject().put("status", "ERROR").put("message", e.message ?: "Crypto error").toString()
            }
            invokeJsCallback(callbackName, res)
        }
    }

    @JavascriptInterface
    fun saveVaultStateAsync(jsonPayload: String, callbackName: String) {
        cryptoExecutor.execute {
            val status = try {
                vaultManager.saveActiveSlot(jsonPayload.toByteArray(Charsets.UTF_8))
            } catch (_: Exception) {
                "ERROR"
            }
            invokeJsCallback(callbackName, JSONObject().put("status", status).toString())
        }
    }

    @JavascriptInterface
    fun changeCurrentSlotPinAsync(oldPin: String, newPin: String, callbackName: String) {
        cryptoExecutor.execute {
            val status = try {
                vaultManager.changeCurrentSlotPin(oldPin, newPin)
            } catch (_: Exception) {
                "ERROR"
            }
            invokeJsCallback(callbackName, JSONObject().put("status", status).toString())
        }
    }

    @JavascriptInterface
    fun configureHiddenCodesAsync(realPin: String, decoyPin: String, panicPin: String, callbackName: String) {
        cryptoExecutor.execute {
            val status = try {
                vaultManager.configureHiddenCodes(realPin, decoyPin, panicPin)
            } catch (_: Exception) {
                "ERROR"
            }
            invokeJsCallback(callbackName, JSONObject().put("status", status).toString())
        }
    }

    // --- Water & Alarms ---
    @JavascriptInterface
    fun peekWaterQueue(): String = WaterSyncBus.peekPendingJson(context)

    @JavascriptInterface
    fun ackWaterQueue(ackIdsJson: String, authoritativeTodayMl: Int) {
        WaterSyncBus.ackEventsAndSyncDisplay(context, ackIdsJson, authoritativeTodayMl)
    }

    @JavascriptInterface
    fun scheduleWaterAlarm(delaySeconds: Long): Boolean {
        return WaterSyncBus.scheduleWaterReminderWithQuietHours(context, delaySeconds)
    }

    @JavascriptInterface
    fun canScheduleExactAlarms(): Boolean {
        val am = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            am.canScheduleExactAlarms()
        } else {
            true
        }
    }

    @JavascriptInterface
    fun openExactAlarmSettings() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val intent = Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM).apply {
                data = Uri.parse("package:${context.packageName}")
            }
            activity.launchExternalSystemFlow {
                activity.startActivity(intent)
            }
        }
    }

    @JavascriptInterface
    fun openBatteryOptimizationSettings() {
        val intent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                data = Uri.parse("package:${context.packageName}")
            }
        } else {
            Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                data = Uri.parse("package:${context.packageName}")
            }
        }
        activity.launchExternalSystemFlow {
            try {
                activity.startActivity(intent)
            } catch (_: Exception) {
                activity.startActivity(
                    Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                        data = Uri.parse("package:${context.packageName}")
                    }
                )
            }
        }
    }

    @JavascriptInterface
    fun openHyperOsAutoStartSettings() {
        val miuiIntent = Intent().apply {
            component = ComponentName(
                "com.miui.securitycenter",
                "com.miui.permcenter.autostart.AutoStartManagementActivity"
            )
        }
        activity.launchExternalSystemFlow {
            try {
                activity.startActivity(miuiIntent)
            } catch (_: Exception) {
                activity.startActivity(
                    Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                        data = Uri.parse("package:${context.packageName}")
                    }
                )
            }
        }
    }

    @JavascriptInterface
    fun showNotification(title: String, message: String) {
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val channelId = "tank_alerts"
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val ch = NotificationChannel(channelId, "Протоколы и ЦНС", NotificationManager.IMPORTANCE_HIGH)
            nm.createNotificationChannel(ch)
        }
        val notification = NotificationCompat.Builder(context, channelId)
            .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
            .setContentTitle(title)
            .setContentText(message)
            .setVisibility(NotificationCompat.VISIBILITY_SECRET)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .build()
        nm.notify((System.currentTimeMillis() % Int.MAX_VALUE).toInt(), notification)
    }

    // --- Native Food Photo Compression & Optional Voice Input ---
    @JavascriptInterface
    fun pickAndCompressFoodPhotoAsync(callbackName: String) {
        activity.launchFoodPhotoPicker(callbackName)
    }

    @JavascriptInterface
    fun canUseVoiceInput(): Boolean {
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
        return context.packageManager.queryIntentActivities(intent, 0).isNotEmpty()
    }

    @JavascriptInterface
    fun startVoiceFoodAsync(callbackName: String) {
        activity.launchVoiceFoodRecognizer(callbackName)
    }

    // --- File Export ---
    @JavascriptInterface
    fun saveExportFileBase64(filename: String, mimeType: String, base64Data: String): Boolean {
        return try {
            val bytes = Base64.decode(base64Data, Base64.DEFAULT)
            val cleanName = filename.replace(Regex("[^a-zA-Z0-9._-]"), "_")
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val values = ContentValues().apply {
                    put(MediaStore.Downloads.DISPLAY_NAME, cleanName)
                    put(MediaStore.Downloads.MIME_TYPE, mimeType)
                    put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/VeinyTank")
                }
                val resolver = context.contentResolver
                val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
                    ?: return false
                resolver.openOutputStream(uri)?.use { it.write(bytes) } ?: return false
                true
            } else {
                @Suppress("DEPRECATION")
                val dir = File(
                    Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS),
                    "VeinyTank"
                )
                if (!dir.exists()) dir.mkdirs()
                FileOutputStream(File(dir, cleanName)).use { it.write(bytes) }
                true
            }
        } catch (_: Exception) {
            false
        }
    }

    // --- Native Gemini Proxy (x-goog-api-key header + AQ. Express fallback) ---
    @JavascriptInterface
    fun fetchGeminiModelsAsync(apiKey: String, callbackName: String) {
        networkExecutor.execute {
            val cleanKey = apiKey.trim()
            if (cleanKey.isEmpty()) {
                invokeJsCallback(callbackName, JSONObject().put("ok", false).put("error", "Пустой ключ").toString())
                return@execute
            }

            val fallbackList = JSONArray(
                listOf(
                    "gemini-4-hydrogen",
                    "gemini-2.5-pro",
                    "gemini-2.5-flash",
                    "gemini-2.5-flash-lite",
                    "gemini-2.0-flash"
                )
            )

            try {
                val conn = (URL("https://generativelanguage.googleapis.com/v1beta/models?pageSize=100").openConnection() as HttpURLConnection).apply {
                    requestMethod = "GET"
                    connectTimeout = 15_000
                    readTimeout = 20_000
                    setRequestProperty("Accept", "application/json")
                    setRequestProperty("x-goog-api-key", cleanKey)
                }
                val code = conn.responseCode
                if (code in 200..299) {
                    val body = conn.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }
                    val json = JSONObject(body)
                    val arr = json.optJSONArray("models") ?: JSONArray()
                    val filtered = JSONArray()
                    for (i in 0 until arr.length()) {
                        val m = arr.getJSONObject(i)
                        val name = m.optString("name", "").removePrefix("models/")
                        val methods = m.optJSONArray("supportedGenerationMethods")?.toString() ?: ""
                        val lower = name.lowercase()
                        if (name.isNotBlank() &&
                            methods.contains("generateContent") &&
                            !lower.contains("tts") &&
                            !lower.contains("embedding") &&
                            !lower.contains("imagen") &&
                            !lower.contains("robotics") &&
                            !lower.contains("aqa")
                        ) {
                            filtered.put(name)
                        }
                    }
                    if (filtered.length() > 0) {
                        invokeJsCallback(
                            callbackName,
                            JSONObject().put("ok", true).put("fallback", false).put("models", filtered).toString()
                        )
                        return@execute
                    }
                }
            } catch (_: Exception) {
            }

            // Express AQ. keys often cannot query models.list; provide curated fallback list cleanly
            val msg = if (cleanKey.startsWith("AQ.")) {
                "Express-ключ (AQ.): загружен базовый список моделей"
            } else {
                "Не удалось получить список с API — показан базовый набор"
            }
            invokeJsCallback(
                callbackName,
                JSONObject().put("ok", true).put("fallback", true).put("note", msg).put("models", fallbackList).toString()
            )
        }
    }

    @JavascriptInterface
    fun callGeminiAsync(apiKey: String, modelId: String, payloadJson: String, callbackName: String) {
        networkExecutor.execute {
            val cleanKey = apiKey.trim()
            val cleanModel = modelId.trim().removePrefix("models/")
            if (cleanKey.isEmpty() || cleanModel.isEmpty()) {
                invokeJsCallback(
                    callbackName,
                    JSONObject().put("ok", false).put("status", 0).put("error", "Не указан ключ или модель").toString()
                )
                return@execute
            }

            val encodedModel = URLEncoder.encode(cleanModel, "UTF-8").replace("+", "%20")
            val primaryUrl = "https://generativelanguage.googleapis.com/v1beta/models/$encodedModel:generateContent"
            var result = postGeminiJson(primaryUrl, cleanKey, payloadJson, useQueryKey = false)

            // Fallback to Vertex Express endpoint for AQ. keys if AI Studio endpoint rejects
            val status = result.optInt("status", 0)
            if (!result.optBoolean("ok", false) && cleanKey.startsWith("AQ.") && (status == 400 || status == 401 || status == 403 || status == 404)) {
                val expressUrl = "https://aiplatform.googleapis.com/v1/publishers/google/models/$encodedModel:generateContent?key=" +
                    URLEncoder.encode(cleanKey, "UTF-8")
                val expressResult = postGeminiJson(expressUrl, cleanKey, payloadJson, useQueryKey = true)
                if (expressResult.optBoolean("ok", false)) {
                    result = expressResult
                }
            }

            invokeJsCallback(callbackName, result.toString())
        }
    }

    private fun postGeminiJson(urlString: String, apiKey: String, payloadJson: String, useQueryKey: Boolean): JSONObject {
        return try {
            val conn = (URL(urlString).openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                doOutput = true
                connectTimeout = 15_000
                readTimeout = 45_000
                setRequestProperty("Content-Type", "application/json; charset=UTF-8")
                setRequestProperty("Accept", "application/json")
                if (!useQueryKey) {
                    setRequestProperty("x-goog-api-key", apiKey)
                }
            }
            conn.outputStream.use { it.write(payloadJson.toByteArray(Charsets.UTF_8)) }
            val code = conn.responseCode
            val stream = if (code in 200..299) conn.inputStream else conn.errorStream
            val body = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() } ?: ""
            if (code in 200..299) {
                JSONObject().put("ok", true).put("status", code).put("body", body)
            } else {
                JSONObject().put("ok", false).put("status", code).put("body", body)
            }
        } catch (e: Exception) {
            JSONObject().put("ok", false).put("status", 0).put("error", e.message ?: "Network error")
        }
    }

    // --- Air Raid Alerts & Weather ---
    @JavascriptInterface
    fun fetchAirAlertsAsync(alertsInUaToken: String, callbackName: String) {
        networkExecutor.execute {
            val result = AirAlertHelper.fetchAlertsWithFallback(alertsInUaToken)
            invokeJsCallback(callbackName, result)
        }
    }

    @JavascriptInterface
    fun fetchWeatherAsync(lat: Double, lon: Double, callbackName: String) {
        val url = "https://api.open-meteo.com/v1/forecast?latitude=$lat&longitude=$lon&current=temperature_2m,wind_speed_10m,weather_code&timezone=Europe%2FKyiv"
        fetchHttpGetAsync(url, null, callbackName)
    }

    private fun fetchHttpGetAsync(urlString: String, bearerToken: String?, callbackName: String) {
        networkExecutor.execute {
            val result = try {
                val conn = (URL(urlString).openConnection() as HttpURLConnection).apply {
                    requestMethod = "GET"
                    connectTimeout = 10_000
                    readTimeout = 12_000
                    setRequestProperty("Accept", "application/json")
                    setRequestProperty("User-Agent", "VeinyTank/4.2")
                    if (!bearerToken.isNullOrBlank()) {
                        setRequestProperty("Authorization", "Bearer $bearerToken")
                    }
                }
                val code = conn.responseCode
                if (code in 200..299) {
                    val body = conn.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }
                    JSONObject().put("ok", true).put("body", body).toString()
                } else {
                    JSONObject().put("ok", false).put("status", code).toString()
                }
            } catch (e: Exception) {
                JSONObject().put("ok", false).put("error", e.message ?: "Network error").toString()
            }
            invokeJsCallback(callbackName, result)
        }
    }
}
