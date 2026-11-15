# Preserve JavascriptInterface methods and annotations under R8/ProGuard
-keepattributes JavascriptInterface
-keepattributes *Annotation*

-keepclassmembers class com.example.WebAppInterface {
    @android.webkit.JavascriptInterface <methods>;
}
-keep class com.example.WebAppInterface { *; }
-keep class com.example.TankAlarmReceiver { *; }
-keep class com.example.TankBootReceiver { *; }
-keep class com.example.WaterTileService { *; }
