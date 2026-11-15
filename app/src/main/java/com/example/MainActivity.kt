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
import android.util.Log
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.ConsoleMessage
import android.webkit.JavascriptInterface
import android.webkit.RenderProcessGoneDetail
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
import androidx.activity.result.PickVisualMediaRequest
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
import androidx.core.content.FileProvider
import androidx.webkit.WebViewAssetLoader
import com.example.ui.theme.MyApplicationTheme
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileOutputStream
import java.net.URLEncoder
import java.util.concurrent.Executors

class MainActivity : ComponentActivity() {

    private var webViewRef: WebView? = null
    private var bridgeRef: WebAppInterface? = null
    private lateinit var vaultManager: VaultManager

    private var filePathCallback: ValueCallback<Array<Uri>>? = null
    private var pendingPhotoCallbackName: String? = null
    private var pendingCameraFile: File? = null
    private var pendingVoiceCallbackName: String? = null

    private var awaitingSystemResult = false
    private var systemResultDeadlineMs = 0L

    private lateinit var filePickerLauncher: ActivityResultLauncher<String>
    private lateinit var foodPhotoPickerLauncher: ActivityResultLauncher<PickVisualMediaRequest>
    private lateinit var foodCameraLauncher: ActivityResultLauncher<Uri>
    private lateinit var voiceFoodLauncher: ActivityResultLauncher<Intent>
    private lateinit var notifPermissionLauncher: ActivityResultLauncher<String>

    private val imageExecutor = Executors.newSingleThreadExecutor()
    private val mainHandler = Handler(Looper.getMainLooper())

    fun launchExternalSystemFlow(ttlMs: Long = 90_000L, block: () -> Unit) {
        awaitingSystemResult = true
        systemResultDeadlineMs = SystemClock.elapsedRealtime() + ttlMs
        try {
            block()
        } catch (e: Exception) {
            awaitingSystemResult = false
            systemResultDeadlineMs = 0L
            throw e
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

        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.dark(AndroidColor.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.dark(AndroidColor.TRANSPARENT)
        )

        ResilientNetwork.init(applicationContext)
        vaultManager = VaultManager(applicationContext)

        filePickerLauncher = registerForActivityResult(ActivityResultContracts.GetContent()) { uri ->
            clearExternalFlowGrace()
            val cb = filePathCallback
            filePathCallback = null
            if (cb != null) {
                cb.onReceiveValue(if (uri != null) arrayOf(uri) else null)
            }
        }

        foodPhotoPickerLauncher = registerForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
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
                } catch (t: Throwable) {
                    JSONObject().put("ok", false).put("error", t.message ?: "Ошибка сжатия фото").toString()
                }
                invokeJsCallback(cbName, res)
            }
        }

        foodCameraLauncher = registerForActivityResult(ActivityResultContracts.TakePicture()) { success ->
            clearExternalFlowGrace()
            val cbName = pendingPhotoCallbackName
            val tempFile = pendingCameraFile
            pendingPhotoCallbackName = null
            pendingCameraFile = null
            if (cbName == null) {
                tempFile?.delete()
                return@registerForActivityResult
            }

            if (!success || tempFile == null || !tempFile.exists() || tempFile.length() == 0L) {
                tempFile?.delete()
                invokeJsCallback(cbName, JSONObject().put("ok", false).put("cancelled", true).toString())
                return@registerForActivityResult
            }

            imageExecutor.execute {
                val res = try {
                    val b64 = decodeAndCompressUriToBase64(applicationContext, Uri.fromFile(tempFile), 1024)
                    if (b64 != null) {
                        JSONObject().put("ok", true).put("base64", b64).put("mimeType", "image/jpeg").toString()
                    } else {
                        JSONObject().put("ok", false).put("error", "Не удалось декодировать снимок").toString()
                    }
                } catch (t: Throwable) {
                    JSONObject().put("ok", false).put("error", t.message ?: "Ошибка сжатия снимка").toString()
                } finally {
                    tempFile.delete()
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
                try {
                    launchExternalSystemFlow {
                        notifPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
                    }
                } catch (_: Exception) {
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
                            layoutParams = ViewGroup.LayoutParams(
                                ViewGroup.LayoutParams.MATCH_PARENT,
                                ViewGroup.LayoutParams.MATCH_PARENT
                            )
                            setBackgroundColor(AndroidColor.parseColor("#0D1117"))
                            settings.apply {
                                javaScriptEnabled = true
                                domStorageEnabled = true
                                mediaPlaybackRequiresUserGesture = false
                                allowFileAccess = false
                                allowContentAccess = false
                            }

                            VaultManager.webViewWipeHook = {
                                webViewRef?.clearCache(true)
                                webViewRef?.clearFormData()
                            }

                            val bridge = WebAppInterface(this@MainActivity, this, vaultManager)
                            bridgeRef = bridge
                            addJavascriptInterface(bridge, "AndroidBridge")

                            webViewClient = object : WebViewClient() {
                                override fun shouldInterceptRequest(
                                    view: WebView,
                                    request: WebResourceRequest
                                ): WebResourceResponse? {
                                    return assetLoader.shouldInterceptRequest(request.url)
                                }

                                override fun shouldOverrideUrlLoading(
                                    view: WebView,
                                    request: WebResourceRequest
                                ): Boolean {
                                    val url = request.url ?: return true
                                    return !(url.scheme == "https" && url.host == "appassets.androidplatform.net")
                                }

                                override fun onRenderProcessGone(
                                    view: WebView?,
                                    detail: RenderProcessGoneDetail?
                                ): Boolean {
                                    view?.loadUrl("https://appassets.androidplatform.net/assets/index.html")
                                    return true
                                }
                            }

                            webChromeClient = object : WebChromeClient() {
                                override fun onConsoleMessage(consoleMessage: ConsoleMessage?): Boolean {
                                    if (consoleMessage != null) {
                                        val lvl = consoleMessage.messageLevel()
                                        if (lvl == ConsoleMessage.MessageLevel.ERROR || lvl == ConsoleMessage.MessageLevel.WARNING) {
                                            Log.w("VeinyTankWV", "[${lvl.name}] ${consoleMessage.message()} (${consoleMessage.sourceId()}:${consoleMessage.lineNumber()})")
                                        }
                                    }
                                    return super.onConsoleMessage(consoleMessage)
                                }

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
            try {
                launchExternalSystemFlow(ttlMs = 120_000L) {
                    foodPhotoPickerLauncher.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
                }
            } catch (e: Exception) {
                pendingPhotoCallbackName = null
                invokeJsCallback(callbackName, JSONObject().put("ok", false).put("error", e.message ?: "Галерея недоступна").toString())
            }
        }
    }

    fun launchFoodCameraCapture(callbackName: String) {
        mainHandler.post {
            var tempFile: File? = null
            try {
                val dir = File(cacheDir, "camera_temp").apply { mkdirs() }
                tempFile = File(dir, "food_capture_${System.currentTimeMillis()}.jpg")
                val uri = FileProvider.getUriForFile(this, "${packageName}.fileprovider", tempFile)
                pendingCameraFile?.delete()
                pendingCameraFile = tempFile
                pendingPhotoCallbackName = callbackName
                launchExternalSystemFlow(ttlMs = 120_000L) {
                    foodCameraLauncher.launch(uri)
                }
            } catch (e: Exception) {
                tempFile?.delete()
                pendingCameraFile = null
                pendingPhotoCallbackName = null
                Log.e("VeinyTankAI", "Camera launch failed: ${e.message}")
                invokeJsCallback(callbackName, JSONObject().put("ok", false).put("error", "Камера недоступна: ${e.message}").toString())
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
            try {
                launchExternalSystemFlow {
                    voiceFoodLauncher.launch(intent)
                }
            } catch (e: Exception) {
                pendingVoiceCallbackName = null
                invokeJsCallback(callbackName, JSONObject().put("ok", false).put("error", e.message ?: "Голос недоступен").toString())
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
        // Flush encrypted Vault state to disk when switching windows, WITHOUT locking the session.
        // Vault locks only on explicit "🔒 Скрыть" or when the app is closed (onDestroy).
        webViewRef?.evaluateJavascript(
            "window.flushVaultNow && window.flushVaultNow();",
            null
        )
    }

    override fun onResume() {
        super.onResume()
        if (awaitingSystemResult) {
            clearExternalFlowGrace()
        }
        webViewRef?.evaluateJavascript(
            "window.syncWaterFromNative && window.syncWaterFromNative();",
            null
        )
    }

    override fun onDestroy() {
        mainHandler.removeCallbacksAndMessages(null)
        WaterSyncBus.activeListener = null
        VaultManager.webViewWipeHook = null
        if (!isChangingConfigurations) {
            VaultManager.clearSessionInRam()
        }
        webViewRef?.apply {
            stopLoading()
            destroy()
        }
        webViewRef = null
        bridgeRef?.shutdown()
        bridgeRef = null
        imageExecutor.shutdownNow()
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
        try {
            cryptoExecutor.execute {
                VaultManager.clearSessionInRam()
            }
        } catch (_: Exception) {
            VaultManager.clearSessionInRam()
        }
    }

    fun shutdown() {
        mainHandler.removeCallbacksAndMessages(null)
        cryptoExecutor.shutdown()
        networkExecutor.shutdownNow()
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
            try {
                activity.startActivity(intent)
            } catch (_: Exception) {
            }
        }
    }

    @JavascriptInterface
    fun isIgnoringBatteryOptimizations(): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            val pm = context.getSystemService(Context.POWER_SERVICE) as PowerManager
            pm.isIgnoringBatteryOptimizations(context.packageName)
        } else {
            true
        }
    }

    @JavascriptInterface
    fun openBatteryOptimizationSettings() {
        val intent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
        } else {
            Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                data = Uri.parse("package:${context.packageName}")
            }
        }
        try {
            activity.startActivity(intent)
        } catch (_: Exception) {
            try {
                activity.startActivity(
                    Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                        data = Uri.parse("package:${context.packageName}")
                    }
                )
            } catch (_: Exception) {
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
        try {
            activity.startActivity(miuiIntent)
        } catch (_: Exception) {
            openAppDetailsSettings()
        }
    }

    @JavascriptInterface
    fun openAppDetailsSettings() {
        try {
            activity.startActivity(
                Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                    data = Uri.parse("package:${context.packageName}")
                }
            )
        } catch (_: Exception) {
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
    fun takeFoodPhotoAsync(callbackName: String) {
        activity.launchFoodCameraCapture(callbackName)
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

    // --- Native Gemini Proxy (x-goog-api-key header + AQ. Express routing + LogFox safe diagnostics) ---
    private fun keyPrefixTag(key: String): String {
        val prefix = when {
            key.startsWith("AIza") -> "AIza"
            key.startsWith("AQ.") -> "AQ"
            else -> "custom"
        }
        return "$prefix(len=${key.length})"
    }

    private fun extractGeminiErrorMsg(rawBody: String): String {
        if (rawBody.isBlank()) return ""
        return try {
            val obj = JSONObject(rawBody)
            obj.optJSONObject("error")?.optString("message", "")?.takeIf { it.isNotBlank() }
                ?: obj.optString("message", "")
        } catch (_: Exception) {
            rawBody.take(200)
        }
    }

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

            var apiErrorNote = ""
            try {
                Log.d("VeinyTankAI", "fetchGeminiModels key=${keyPrefixTag(cleanKey)}")
                val resp = ResilientNetwork.get(
                    urlString = "https://generativelanguage.googleapis.com/v1beta/models?pageSize=100",
                    headers = mapOf("x-goog-api-key" to cleanKey),
                    connectTimeoutMs = 15_000,
                    readTimeoutMs = 20_000
                )
                Log.d("VeinyTankAI", "fetchGeminiModels status=${resp.status} via=${resp.resolvedVia} bodyLen=${resp.body.length}")
                if (resp.ok) {
                    val json = JSONObject(resp.body)
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
                            JSONObject()
                                .put("ok", true)
                                .put("fallback", false)
                                .put("resolvedVia", resp.resolvedVia)
                                .put("models", filtered)
                                .toString()
                        )
                        return@execute
                    }
                    apiErrorNote = "API вернул 0 подходящих моделей"
                } else {
                    val errDetail = extractGeminiErrorMsg(resp.body).ifBlank { resp.error }
                    apiErrorNote = "HTTP ${resp.status}${if (errDetail.isNotBlank()) ": $errDetail" else ""}"
                    Log.w("VeinyTankAI", "fetchGeminiModels rejected: $apiErrorNote")
                }
            } catch (t: Throwable) {
                apiErrorNote = "${t.javaClass.simpleName}: ${t.message ?: "network error"}"
                Log.e("VeinyTankAI", "fetchGeminiModels exception: $apiErrorNote")
            }

            // Vertex Express AQ. keys often cannot query models.list; provide curated fallback list cleanly
            val msg = if (cleanKey.startsWith("AQ.")) {
                "AQ-ключ ($apiErrorNote): загружен базовый список моделей"
            } else {
                "Не удалось получить список с API ($apiErrorNote) — показан базовый набор"
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
            val resultJson = try {
                val cleanKey = apiKey.trim()
                val cleanModel = modelId.trim().removePrefix("models/")
                if (cleanKey.isEmpty() || cleanModel.isEmpty()) {
                    JSONObject().put("ok", false).put("status", 0).put("error", "Не указан ключ или модель")
                } else {
                    val startedAt = SystemClock.elapsedRealtime()
                    Log.d("VeinyTankAI", "callGemini start model=$cleanModel key=${keyPrefixTag(cleanKey)} payloadLen=${payloadJson.length}")
                    val result = callGeminiWithFallback(cleanKey, cleanModel, payloadJson)
                    val elapsed = SystemClock.elapsedRealtime() - startedAt
                    result.put("elapsedMs", elapsed)
                    Log.d(
                        "VeinyTankAI",
                        "callGemini done model=$cleanModel ok=${result.optBoolean("ok")} status=${result.optInt("status")} endpoint=${result.optString("endpoint")} via=${result.optString("resolvedVia")} elapsed=${elapsed}ms"
                    )
                    result
                }
            } catch (t: Throwable) {
                Log.e("VeinyTankAI", "callGemini fatal: ${t.javaClass.simpleName}: ${t.message}")
                JSONObject().put("ok", false).put("status", 0).put("error", "${t.javaClass.simpleName}: ${t.message ?: "Unknown error"}")
            }
            invokeJsCallback(callbackName, resultJson.toString())
        }
    }

    private fun callGeminiWithFallback(cleanKey: String, cleanModel: String, payloadJson: String): JSONObject {
        val encodedModel = URLEncoder.encode(cleanModel, "UTF-8").replace("+", "%20")
        val encodedKey = URLEncoder.encode(cleanKey, "UTF-8")
        val isAqKey = cleanKey.startsWith("AQ.")

        val aiStudioUrl = "https://generativelanguage.googleapis.com/v1beta/models/$encodedModel:generateContent"
        val expressV1Url = "https://aiplatform.googleapis.com/v1/publishers/google/models/$encodedModel:generateContent?key=$encodedKey"
        val expressV1BetaUrl = "https://aiplatform.googleapis.com/v1beta1/publishers/google/models/$encodedModel:generateContent?key=$encodedKey"

        // AI Studio now issues AQ.* keys as well, and generativelanguage works on both AIza* and AI Studio AQ.*.
        val studioRes = postGeminiJson(aiStudioUrl, cleanKey, payloadJson, useQueryKey = false, hostLabel = "generativelanguage")
        if (studioRes.optBoolean("ok", false) || !isAqKey) {
            return studioRes
        }

        // For Vertex Express AQ.* keys, try aiplatform regardless of whether studio failed with HTTP 4xx or network/DNS error (status 0).
        var vertexRes = postGeminiJson(expressV1Url, cleanKey, payloadJson, useQueryKey = true, hostLabel = "aiplatform-v1")
        if (vertexRes.optBoolean("ok", false)) {
            return vertexRes
        }
        if (vertexRes.optInt("status", 0) == 404) {
            val betaRes = postGeminiJson(expressV1BetaUrl, cleanKey, payloadJson, useQueryKey = true, hostLabel = "aiplatform-v1beta1")
            if (betaRes.optBoolean("ok", false)) {
                return betaRes
            }
            vertexRes = betaRes
        }

        val studioStatus = studioRes.optInt("status", 0)
        val vertexStatus = vertexRes.optInt("status", 0)
        val studioErr = studioRes.optString("error", "ошибка")
        val vertexErr = vertexRes.optString("error", "ошибка")
        val combinedErr = "AI Studio (generativelanguage, HTTP $studioStatus): $studioErr\nVertex Express (aiplatform, HTTP $vertexStatus): $vertexErr"
        val preferred = if (studioStatus != 0) studioRes else vertexRes
        return JSONObject()
            .put("ok", false)
            .put("status", preferred.optInt("status", 0))
            .put("body", preferred.optString("body", ""))
            .put("endpoint", "generativelanguage + aiplatform")
            .put("resolvedVia", "${studioRes.optString("resolvedVia")} / ${vertexRes.optString("resolvedVia")}")
            .put("error", combinedErr)
    }

    private fun postGeminiJson(
        urlString: String,
        apiKey: String,
        payloadJson: String,
        useQueryKey: Boolean,
        hostLabel: String
    ): JSONObject {
        val headers = if (!useQueryKey) mapOf("x-goog-api-key" to apiKey) else emptyMap()
        val resp = ResilientNetwork.postJson(
            urlString = urlString,
            jsonBody = payloadJson,
            headers = headers,
            connectTimeoutMs = 20_000,
            readTimeoutMs = 60_000
        )
        return if (resp.ok) {
            JSONObject()
                .put("ok", true)
                .put("status", resp.status)
                .put("body", resp.body)
                .put("endpoint", hostLabel)
                .put("resolvedVia", resp.resolvedVia)
        } else {
            val errMsg = extractGeminiErrorMsg(resp.body).ifBlank { resp.error }
            Log.w("VeinyTankAI", "Failed on $hostLabel status=${resp.status} via=${resp.resolvedVia}: ${errMsg.take(260)}")
            JSONObject()
                .put("ok", false)
                .put("status", resp.status)
                .put("body", resp.body)
                .put("endpoint", hostLabel)
                .put("resolvedVia", resp.resolvedVia)
                .put("error", errMsg.ifBlank { "HTTP ${resp.status} ($hostLabel)" })
        }
    }

    @JavascriptInterface
    fun runGlobalNetworkDiagnosticsAsync(
        trainerKey: String,
        visionKey: String,
        modelId: String,
        callbackName: String
    ) {
        networkExecutor.execute {
            val out = JSONObject()
            try {
                ResilientNetwork.clearDnsCache()

                // 1. Device Network / VPN / Private DNS state
                out.put("network", ResilientNetwork.inspectDeviceNetworkState(context))

                // 2. Fresh System DNS vs DoH resolution probes
                val hosts = listOf(
                    "generativelanguage.googleapis.com",
                    "aiplatform.googleapis.com",
                    "siren.pp.ua",
                    "api.open-meteo.com"
                )
                val dnsArray = JSONArray()
                for (h in hosts) {
                    dnsArray.put(ResilientNetwork.probeHostResolution(h))
                }
                out.put("dns", dnsArray)

                // 3. Background services HTTP checks
                val services = JSONObject()
                val sirenResp = ResilientNetwork.get("https://siren.pp.ua/api/v3/alerts", connectTimeoutMs = 8_000, readTimeoutMs = 10_000)
                services.put(
                    "siren",
                    JSONObject()
                        .put("ok", sirenResp.ok && AirAlertHelper.isValidSirenAlertsPayload(sirenResp.body))
                        .put("status", sirenResp.status)
                        .put("via", sirenResp.resolvedVia)
                        .put("ms", sirenResp.elapsedMs)
                        .put("error", sirenResp.error)
                )

                val weatherResp = ResilientNetwork.get(
                    "https://api.open-meteo.com/v1/forecast?latitude=51.4982&longitude=31.2893&current=temperature_2m",
                    connectTimeoutMs = 8_000,
                    readTimeoutMs = 10_000
                )
                services.put(
                    "weather",
                    JSONObject()
                        .put("ok", weatherResp.ok && weatherResp.body.contains("current"))
                        .put("status", weatherResp.status)
                        .put("via", weatherResp.resolvedVia)
                        .put("ms", weatherResp.elapsedMs)
                        .put("error", weatherResp.error)
                )
                out.put("services", services)

                // 4. Live Gemini Key probes
                val cleanModel = modelId.trim().ifEmpty { "gemini-4-hydrogen" }.removePrefix("models/")
                val cleanTrainer = trainerKey.trim()
                val cleanVision = visionKey.trim()
                val probePayload = """{"contents":[{"role":"user","parts":[{"text":"Ответь словом: ОК"}]}],"generationConfig":{"temperature":0,"maxOutputTokens":16}}"""

                if (cleanTrainer.isNotEmpty()) {
                    val tStart = SystemClock.elapsedRealtime()
                    val tRes = callGeminiWithFallback(cleanTrainer, cleanModel, probePayload)
                    tRes.put("configured", true)
                    tRes.put("model", cleanModel)
                    tRes.put("keyTag", keyPrefixTag(cleanTrainer))
                    tRes.put("ms", SystemClock.elapsedRealtime() - tStart)
                    tRes.remove("body")
                    out.put("trainerKeyTest", tRes)
                } else {
                    out.put("trainerKeyTest", JSONObject().put("configured", false))
                }

                if (cleanVision.isNotEmpty() && cleanVision != cleanTrainer) {
                    val vStart = SystemClock.elapsedRealtime()
                    val vRes = callGeminiWithFallback(cleanVision, cleanModel, probePayload)
                    vRes.put("configured", true)
                    vRes.put("model", cleanModel)
                    vRes.put("keyTag", keyPrefixTag(cleanVision))
                    vRes.put("ms", SystemClock.elapsedRealtime() - vStart)
                    vRes.remove("body")
                    out.put("visionKeyTest", vRes)
                } else {
                    out.put("visionKeyTest", JSONObject().put("sameAsTrainer", true))
                }

                out.put("ok", true)
            } catch (t: Throwable) {
                out.put("ok", false).put("error", "${t.javaClass.simpleName}: ${t.message ?: "Diagnostic error"}")
            }
            invokeJsCallback(callbackName, out.toString())
        }
    }

    // --- Air Raid Alerts & Weather ---
    @JavascriptInterface
    fun fetchAirAlertsAsync(alertsInUaToken: String, callbackName: String) {
        networkExecutor.execute {
            val result = AirAlertHelper.fetchAlertsWithFallback(alertsInUaToken, context)
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
            val headers = if (!bearerToken.isNullOrBlank()) {
                mapOf("Authorization" to "Bearer $bearerToken")
            } else {
                emptyMap()
            }
            val resp = ResilientNetwork.get(
                urlString = urlString,
                headers = headers,
                connectTimeoutMs = 10_000,
                readTimeoutMs = 12_000
            )
            val result = if (resp.ok) {
                JSONObject().put("ok", true).put("body", resp.body).put("resolvedVia", resp.resolvedVia).toString()
            } else {
                JSONObject().put("ok", false).put("status", resp.status).put("error", resp.error).toString()
            }
            invokeJsCallback(callbackName, result)
        }
    }
}
