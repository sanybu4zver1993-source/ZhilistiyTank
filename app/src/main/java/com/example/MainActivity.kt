package com.example

import android.annotation.SuppressLint
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.core.app.ActivityCompat
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Scaffold
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import com.example.ui.theme.MyApplicationTheme

class MainActivity : ComponentActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON) // Wakelock для ИЗО-таймеров
    enableEdgeToEdge()
    
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        if (ContextCompat.checkSelfPermission(this, android.Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(this, arrayOf(android.Manifest.permission.POST_NOTIFICATIONS), 101)
        }
    }
    
    setContent {
      MyApplicationTheme {
        Scaffold(modifier = Modifier.fillMaxSize()) { innerPadding ->
          WebAppWrapper(this, modifier = Modifier.padding(innerPadding))
        }
      }
    }
  }
}

class WebAppInterface(private val context: Context) {
    private val prefs: SharedPreferences = context.getSharedPreferences("TankPrefs", Context.MODE_PRIVATE)

    @JavascriptInterface
    fun getWater(): Int {
        return prefs.getInt("water_ml", 0)
    }

    @JavascriptInterface
    fun addWater(amount: Int) {
        val current = prefs.getInt("water_ml", 0)
        prefs.edit().putInt("water_ml", current + amount).apply()
    }
    
    @JavascriptInterface
    fun resetWater() {
        prefs.edit().putInt("water_ml", 0).apply()
    }

    @JavascriptInterface
    fun showNotification(title: String, message: String) {
        val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val channelId = "tank_reminders"
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(channelId, "Tank Reminders", NotificationManager.IMPORTANCE_HIGH)
            notificationManager.createNotificationChannel(channel)
        }
        val notification = NotificationCompat.Builder(context, channelId)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(title)
            .setContentText(message)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .build()
        notificationManager.notify(System.currentTimeMillis().toInt(), notification)
    }
}

@SuppressLint("SetJavaScriptEnabled")
@Composable
fun WebAppWrapper(context: Context, modifier: Modifier = Modifier) {
  AndroidView(
    factory = { ctx ->
      WebView(ctx).apply {
        settings.apply {
          javaScriptEnabled = true
          domStorageEnabled = true
          databaseEnabled = true
          mediaPlaybackRequiresUserGesture = false
          allowFileAccess = true
          allowContentAccess = true
        }

        addJavascriptInterface(WebAppInterface(context), "AndroidBridge")
        webViewClient = WebViewClient()
        webChromeClient = WebChromeClient()
        
        loadUrl("file:///android_asset/index.html")
      }
    },
    modifier = modifier.fillMaxSize()
  )
}

