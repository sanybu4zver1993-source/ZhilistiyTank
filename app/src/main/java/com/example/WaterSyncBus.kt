package com.example

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Build
import android.service.quicksettings.TileService
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
import java.util.UUID

object WaterSyncBus {
    private const val PREFS = "TankWaterLedger"
    private const val KEY_QUEUE = "pending_events_json"
    private const val KEY_CACHE_DAY = "cache_day"
    private const val KEY_CACHE_ML = "cache_ml"
    private const val KEY_WATER_REMINDER_ENABLED = "water_reminder_enabled"
    private const val KEY_NEXT_WATER_ALARM_TS = "next_water_alarm_ts"

    @Volatile
    var activeListener: (() -> Unit)? = null

    private fun todayKey(): String = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date())

    @Synchronized
    fun getDisplayTotalMl(ctx: Context): Int {
        val sp = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val today = todayKey()
        return if (sp.getString(KEY_CACHE_DAY, "") == today) {
            sp.getInt(KEY_CACHE_ML, 0)
        } else {
            sp.edit().putString(KEY_CACHE_DAY, today).putInt(KEY_CACHE_ML, 0).apply()
            0
        }
    }

    @Synchronized
    fun enqueueFromTile(ctx: Context, deltaMl: Int): Int {
        val sp = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val today = todayKey()
        val base = getDisplayTotalMl(ctx)
        val updatedTotal = (base + deltaMl).coerceAtLeast(0)

        val arr = JSONArray(sp.getString(KEY_QUEUE, "[]"))
        val evt = JSONObject().apply {
            put("id", UUID.randomUUID().toString())
            put("ts", System.currentTimeMillis())
            put("day", today)
            put("deltaMl", deltaMl)
            put("source", "qs_tile")
        }
        arr.put(evt)

        sp.edit()
            .putString(KEY_QUEUE, arr.toString())
            .putString(KEY_CACHE_DAY, today)
            .putInt(KEY_CACHE_ML, updatedTotal)
            .apply()

        scheduleWaterReminderWithQuietHours(ctx, 2 * 3600L)
        activeListener?.invoke()
        return updatedTotal
    }

    @Synchronized
    fun peekPendingJson(ctx: Context): String {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getString(KEY_QUEUE, "[]") ?: "[]"
    }

    @Synchronized
    fun ackEventsAndSyncDisplay(ctx: Context, ackIdsJson: String, authoritativeTodayMl: Int) {
        val sp = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val ackSet = mutableSetOf<String>()
        val ackArr = JSONArray(ackIdsJson)
        for (i in 0 until ackArr.length()) {
            ackSet.add(ackArr.getString(i))
        }

        val currentArr = JSONArray(sp.getString(KEY_QUEUE, "[]"))
        val remaining = JSONArray()
        for (i in 0 until currentArr.length()) {
            val item = currentArr.getJSONObject(i)
            if (item.getString("id") !in ackSet) remaining.put(item)
        }

        sp.edit()
            .putString(KEY_QUEUE, remaining.toString())
            .putString(KEY_CACHE_DAY, todayKey())
            .putInt(KEY_CACHE_ML, authoritativeTodayMl.coerceAtLeast(0))
            .apply()

        try {
            TileService.requestListeningState(ctx, ComponentName(ctx, WaterTileService::class.java))
        } catch (_: Exception) {
        }
    }

    fun computeQuietHoursAwareTriggerMillis(delaySeconds: Long): Long {
        val target = System.currentTimeMillis() + (delaySeconds * 1000L)
        val cal = Calendar.getInstance().apply { timeInMillis = target }
        val hour = cal.get(Calendar.HOUR_OF_DAY)
        val minute = cal.get(Calendar.MINUTE)

        val isQuietNightLate = hour > 22 || (hour == 22 && minute >= 30)
        val isQuietMorningEarly = hour < 8 || (hour == 8 && minute < 30)

        if (isQuietNightLate) {
            cal.add(Calendar.DAY_OF_YEAR, 1)
            cal.set(Calendar.HOUR_OF_DAY, 8)
            cal.set(Calendar.MINUTE, 30)
            cal.set(Calendar.SECOND, 0)
            cal.set(Calendar.MILLISECOND, 0)
        } else if (isQuietMorningEarly) {
            cal.set(Calendar.HOUR_OF_DAY, 8)
            cal.set(Calendar.MINUTE, 30)
            cal.set(Calendar.SECOND, 0)
            cal.set(Calendar.MILLISECOND, 0)
        }
        return cal.timeInMillis
    }

    fun scheduleWaterReminderWithQuietHours(ctx: Context, delaySeconds: Long): Boolean {
        val triggerAt = computeQuietHoursAwareTriggerMillis(delaySeconds)
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putBoolean(KEY_WATER_REMINDER_ENABLED, true)
            .putLong(KEY_NEXT_WATER_ALARM_TS, triggerAt)
            .apply()
        return dispatchAlarmAt(ctx, 102, triggerAt, "💧 Таймер гидратации", "Пора сделать пару глотков воды.")
    }

    fun rescheduleOnBoot(ctx: Context) {
        val sp = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        if (!sp.getBoolean(KEY_WATER_REMINDER_ENABLED, false)) return
        val savedTs = sp.getLong(KEY_NEXT_WATER_ALARM_TS, 0L)
        val now = System.currentTimeMillis()
        val triggerAt = if (savedTs > now + 60_000L) {
            savedTs
        } else {
            computeQuietHoursAwareTriggerMillis(30 * 60L)
        }
        dispatchAlarmAt(ctx, 102, triggerAt, "💧 Таймер гидратации", "Пора сделать пару глотков воды.")
    }

    fun dispatchAlarmAt(ctx: Context, alarmId: Int, triggerAt: Long, title: String, body: String): Boolean {
        val am = ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        val intent = Intent(ctx, TankAlarmReceiver::class.java).apply {
            putExtra("notif_id", alarmId)
            putExtra("title", title)
            putExtra("body", body)
        }
        val pi = PendingIntent.getBroadcast(
            ctx,
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
}
