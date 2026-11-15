package com.example

import android.Manifest
import android.annotation.SuppressLint
import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.provider.MediaStore
import android.provider.Settings
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
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Scaffold
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import androidx.webkit.WebViewAssetLoader
import com.example.ui.theme.MyApplicationTheme
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

class MainActivity : ComponentActivity() {

    private var webViewRef: WebView? = null
    private var filePathCallback: ValueCallback<Array<Uri>>? = null

    private lateinit var filePickerLauncher: ActivityResultLauncher<String>
    private lateinit var notifPermissionLauncher: ActivityResultLauncher<String>

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Anti-forensics: block OS screenshots, screen recording, and Recents thumbnails
        window.setFlags(
            WindowManager.LayoutParams.FLAG_SECURE,
            WindowManager.LayoutParams.FLAG_SECURE
        )
        // Keep screen awake for isometric timers and PVT
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        enableEdgeToEdge()

        filePickerLauncher = registerForActivityResult(ActivityResultContracts.GetContent()) { uri ->
            val cb = filePathCallback
            filePathCallback = null
            if (cb != null) {
                if (uri != null) {
                    cb.onReceiveValue(arrayOf(uri))
                } else {
                    cb.onReceiveValue(null)
                }
            }
        }

        notifPermissionLauncher = registerForActivityResult(ActivityResultContracts.RequestPermission()) { _ -> }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED
            ) {
                notifPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
            }
        }

        val vaultManager = VaultManager(applicationContext)

        setContent {
            MyApplicationTheme {
                Scaffold(modifier = Modifier.fillMaxSize()) { innerPadding ->
                    AndroidView(
                        factory = { ctx ->
                            val assetLoader = WebViewAssetLoader.Builder()
                                .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(ctx))
                                .build()

                            WebView(ctx).apply {
                                webViewRef = this
                                settings.apply {
                                    javaScriptEnabled = true
                                    domStorageEnabled = true
                                    databaseEnabled = false
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
                                            filePickerLauncher.launch(mime)
                                            true
                                        } catch (_: Exception) {
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
                            .padding(innerPadding)
                    )
                }
            }
        }
    }

    override fun onPause() {
        super.onPause()
        webViewRef?.evaluateJavascript(
            "window.onAppBackgrounded && window.onAppBackgrounded();",
            null
        )
    }

    override fun onResume() {
        super.onResume()
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
    private val context: Context,
    private val webView: WebView,
    private val vaultManager: VaultManager
) {
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

    @JavascriptInterface
    fun isVaultInitialized(): Boolean = vaultManager.isInitialized()

    @JavascriptInterface
    fun setupVaultAsync(
        realPin: String,
        decoyPin: String,
        panicPin: String,
        initialJson: String,
        callbackName: String
    ) {
        cryptoExecutor.execute {
            val ok = try {
                vaultManager.setupVault(realPin, decoyPin, panicPin, initialJson)
            } catch (_: Exception) {
                false
            }
            val res = JSONObject().put("ok", ok).toString()
            invokeJsCallback(callbackName, res)
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
    fun saveVaultStateAsync(slotIndex: Int, pin: String, jsonPayload: String, callbackName: String) {
        cryptoExecutor.execute {
            val ok = try {
                vaultManager.writeSlot(slotIndex, pin, jsonPayload.toByteArray(Charsets.UTF_8))
                true
            } catch (_: Exception) {
                false
            }
            val res = JSONObject().put("ok", ok).toString()
            invokeJsCallback(callbackName, res)
        }
    }

    @JavascriptInterface
    fun triggerPanicWipeAsync(callbackName: String) {
        cryptoExecutor.execute {
            vaultManager.executeCryptoShredding()
            invokeJsCallback(callbackName, "{\"wiped\":true}")
        }
    }

    @JavascriptInterface
    fun peekWaterQueue(): String = WaterSyncBus.peekPendingJson(context)

    @JavascriptInterface
    fun ackWaterQueue(ackIdsJson: String, authoritativeTodayMl: Int) {
        WaterSyncBus.ackEventsAndSyncDisplay(context, ackIdsJson, authoritativeTodayMl)
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
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            try {
                context.startActivity(intent)
            } catch (_: Exception) {
            }
        }
    }

    @JavascriptInterface
    fun sendNativeAlarm(alarmId: Int, delaySeconds: Long, title: String, body: String): Boolean {
        val am = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        val triggerAt = System.currentTimeMillis() + (delaySeconds * 1000L)
        val intent = Intent(context, TankAlarmReceiver::class.java).apply {
            putExtra("notif_id", alarmId)
            putExtra("title", title)
            putExtra("body", body)
        }
        val pi = PendingIntent.getBroadcast(
            context,
            alarmId,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            if (am.canScheduleExactAlarms()) {
                am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pi)
                true
            } else {
                am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pi)
                false
            }
        } else {
            am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pi)
            true
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

    @JavascriptInterface
    fun getDefaultApiConfig(): String {
        return JSONObject().apply {
            put("trainerKey", BuildConfig.GEMINI_TRAINER_API_KEY)
            put("visionKey", BuildConfig.GEMINI_VISION_API_KEY)
        }.toString()
    }

    @JavascriptInterface
    fun fetchAirAlertsAsync(callbackName: String) {
        fetchHttpGetAsync("https://ubilling.net.ua/aerialalerts/", callbackName)
    }

    @JavascriptInterface
    fun fetchWeatherAsync(lat: Double, lon: Double, callbackName: String) {
        val url = "https://api.open-meteo.com/v1/forecast?latitude=$lat&longitude=$lon&current=temperature_2m,wind_speed_10m,weather_code&timezone=auto"
        fetchHttpGetAsync(url, callbackName)
    }

    private fun fetchHttpGetAsync(urlString: String, callbackName: String) {
        networkExecutor.execute {
            val result = try {
                val conn = (URL(urlString).openConnection() as HttpURLConnection).apply {
                    requestMethod = "GET"
                    connectTimeout = 8000
                    readTimeout = 8000
                    setRequestProperty("Accept", "application/json")
                    setRequestProperty("User-Agent", "VeinyTank/4.2")
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
