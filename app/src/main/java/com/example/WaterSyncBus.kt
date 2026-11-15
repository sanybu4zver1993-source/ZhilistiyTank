package com.example

import android.content.ComponentName
import android.content.Context
import android.service.quicksettings.TileService
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.UUID

object WaterSyncBus {
    private const val PREFS = "TankWaterLedger"
    private const val KEY_QUEUE = "pending_events_json"
    private const val KEY_CACHE_DAY = "cache_day"
    private const val KEY_CACHE_ML = "cache_ml"

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
}
