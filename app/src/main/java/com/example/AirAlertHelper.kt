package com.example

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener
import java.io.File

object AirAlertHelper {

    private const val REGIONS_CACHE_TTL_MS = 24L * 60L * 60L * 1000L
    private const val ALERTS_COALESCE_MS = 5_000L

    private data class CityMatcher(
        val cityKey: String,
        val stateExact: String,
        val districtExact: String,
        val communityExacts: List<String>
    )

    private val CITY_MATCHERS = listOf(
        CityMatcher(
            cityKey = "Чернигов",
            stateExact = "чернігівська область",
            districtExact = "чернігівський район",
            communityExacts = listOf("чернігівська територіальна громада", "м. чернігів")
        ),
        CityMatcher(
            cityKey = "Киев",
            stateExact = "м. київ",
            districtExact = "",
            communityExacts = listOf("м. київ")
        ),
        CityMatcher(
            cityKey = "Сумы",
            stateExact = "сумська область",
            districtExact = "сумський район",
            communityExacts = listOf("сумська територіальна громада", "м. суми")
        ),
        CityMatcher(
            cityKey = "Харьков",
            stateExact = "харківська область",
            districtExact = "харківський район",
            communityExacts = listOf("харківська територіальна громада", "м. харків")
        ),
        CityMatcher(
            cityKey = "Днепр",
            stateExact = "дніпропетровська область",
            districtExact = "дніпровський район",
            communityExacts = listOf("дніпровська територіальна громада", "м. дніпро")
        ),
        CityMatcher(
            cityKey = "Одесса",
            stateExact = "одеська область",
            districtExact = "одеський район",
            communityExacts = listOf("одеська територіальна громада", "м. одеса")
        ),
        CityMatcher(
            cityKey = "Львов",
            stateExact = "львівська область",
            districtExact = "львівський район",
            communityExacts = listOf("львівська територіальна громада", "м. львів")
        )
    )

    @Volatile
    private var cachedRegionsIndex: JSONObject? = null

    @Volatile
    private var cachedRegionsAtMs: Long = 0L

    private val regionsLock = Any()

    fun isValidJsonPayload(raw: String): Boolean {
        val trimmed = raw.trim()
        if (trimmed.isEmpty() || (trimmed[0] != '{' && trimmed[0] != '[')) return false
        return try {
            val parsed = JSONTokener(trimmed).nextValue()
            parsed is JSONObject || parsed is JSONArray
        } catch (_: Exception) {
            false
        }
    }

    /**
     * Parses `https://siren.pp.ua/api/v3/regions` (`{"states": [...]}`) into a compact lookup
     * map `{ "Чернигов": { communityId, communityName, districtId, districtName, stateId, stateName }, ... }`.
     */
    fun parseSirenRegionsIndex(regionsJson: String): JSONObject {
        val out = JSONObject()
        val trimmed = regionsJson.trim()
        if (trimmed.isEmpty()) return out

        val rootObj = try {
            val v = JSONTokener(trimmed).nextValue()
            when (v) {
                is JSONObject -> v
                is JSONArray -> JSONObject().put("states", v)
                else -> return out
            }
        } catch (_: Exception) {
            return out
        }

        val states = rootObj.optJSONArray("states") ?: rootObj.optJSONArray("regions") ?: return out

        for (i in 0 until states.length()) {
            val stateNode = states.optJSONObject(i) ?: continue
            val stateName = stateNode.optString("regionName", "").trim()
            val stateLower = stateName.lowercase()
            val stateId = stateNode.optString("regionId", "").trim()

            for (matcher in CITY_MATCHERS) {
                if (stateLower == matcher.stateExact) {
                    val entry = JSONObject()
                    entry.put("stateId", stateId)
                    entry.put("stateName", stateName)
                    if (matcher.communityExacts.contains(stateLower)) {
                        entry.put("communityId", stateId)
                        entry.put("communityName", stateName)
                    }
                    collectChildMatches(stateNode.optJSONArray("regionChildIds"), matcher, entry)
                    out.put(matcher.cityKey, entry)
                }
            }
        }
        return out
    }

    private fun collectChildMatches(children: JSONArray?, matcher: CityMatcher, entry: JSONObject) {
        if (children == null) return
        for (i in 0 until children.length()) {
            val node = children.optJSONObject(i) ?: continue
            val name = node.optString("regionName", "").trim()
            val lower = name.lowercase()
            val id = node.optString("regionId", "").trim()
            val type = node.optString("regionType", "").trim()

            if (matcher.districtExact.isNotEmpty() && lower == matcher.districtExact &&
                (type.isEmpty() || type.equals("District", ignoreCase = true))
            ) {
                entry.put("districtId", id)
                entry.put("districtName", name)
            }
            if (matcher.communityExacts.contains(lower) &&
                (type.isEmpty() || type.equals("Community", ignoreCase = true))
            ) {
                entry.put("communityId", id)
                entry.put("communityName", name)
            }

            val subChildren = node.optJSONArray("regionChildIds")
            if (subChildren != null && subChildren.length() > 0) {
                collectChildMatches(subChildren, matcher, entry)
            }
        }
    }

    private val fetchLock = Any()

    @Volatile
    private var lastFetchAtMs: Long = 0L

    @Volatile
    private var lastTokenHash: String = ""

    @Volatile
    private var lastResultJson: String? = null

    fun isValidSirenAlertsPayload(raw: String): Boolean {
        val trimmed = raw.trim()
        if (trimmed.isEmpty()) return false
        return try {
            val parsed = JSONTokener(trimmed).nextValue()
            when (parsed) {
                is JSONArray -> true // empty [] = valid "no active alerts"
                is JSONObject -> parsed.has("activeAlerts") || parsed.has("alerts")
                else -> false
            }
        } catch (_: Exception) {
            false
        }
    }

    fun isValidAlertsInUaPayload(raw: String): Boolean {
        val trimmed = raw.trim()
        if (trimmed.isEmpty()) return false
        return try {
            val obj = JSONObject(trimmed)
            obj.has("alerts") && obj.optJSONArray("alerts") != null
        } catch (_: Exception) {
            false
        }
    }

    fun isValidUbillingPayload(raw: String): Boolean {
        val trimmed = raw.trim()
        if (trimmed.isEmpty()) return false
        return try {
            val obj = JSONObject(trimmed)
            if (obj.has("error") && !obj.has("states") && !obj.has("state")) return false
            obj.optJSONObject("states") != null || obj.optJSONObject("state") != null
        } catch (_: Exception) {
            false
        }
    }

    private fun getOrFetchSirenRegionsIndex(context: Context?): JSONObject {
        val now = System.currentTimeMillis()
        cachedRegionsIndex?.let { cached ->
            if (cached.length() > 0 && (now - cachedRegionsAtMs) < REGIONS_CACHE_TTL_MS) {
                return cached
            }
        }
        synchronized(regionsLock) {
            cachedRegionsIndex?.let { cached ->
                if (cached.length() > 0 && (System.currentTimeMillis() - cachedRegionsAtMs) < REGIONS_CACHE_TTL_MS) {
                    return cached
                }
            }
            val cacheFile = context?.let { File(it.filesDir, "siren_regions_cache.json") }
            if (cacheFile != null && cacheFile.exists() &&
                (System.currentTimeMillis() - cacheFile.lastModified()) < REGIONS_CACHE_TTL_MS
            ) {
                try {
                    val diskObj = JSONObject(cacheFile.readText(Charsets.UTF_8))
                    if (diskObj.length() > 0) {
                        cachedRegionsIndex = diskObj
                        cachedRegionsAtMs = cacheFile.lastModified()
                        return diskObj
                    }
                } catch (_: Exception) {
                }
            }
            val res = httpGet("https://siren.pp.ua/api/v3/regions", null, 6_000, 8_000)
            if (res.first in 200..299 && isValidJsonPayload(res.second)) {
                val parsed = parseSirenRegionsIndex(res.second)
                if (parsed.length() > 0) {
                    cachedRegionsIndex = parsed
                    cachedRegionsAtMs = System.currentTimeMillis()
                    try {
                        cacheFile?.writeText(parsed.toString(), Charsets.UTF_8)
                    } catch (_: Exception) {
                    }
                    return parsed
                }
            }
            return cachedRegionsIndex ?: JSONObject()
        }
    }

    fun fetchAlertsWithFallback(alertsInUaToken: String, context: Context? = null): String {
        val token = alertsInUaToken.trim()
        val tokenKey = if (token.isEmpty()) "" else token.hashCode().toString()
        synchronized(fetchLock) {
            val now = System.currentTimeMillis()
            val prev = lastResultJson
            if (prev != null && tokenKey == lastTokenHash && (now - lastFetchAtMs) < ALERTS_COALESCE_MS) {
                return prev
            }

            val fresh = fetchAlertsUncoalesced(token, context)
            lastResultJson = fresh
            lastTokenHash = tokenKey
            lastFetchAtMs = System.currentTimeMillis()
            return fresh
        }
    }

    private fun fetchAlertsUncoalesced(token: String, context: Context?): String {
        var fallbackNote = ""

        if (token.isNotEmpty()) {
            val alertsInUaRes = httpGet(
                urlString = "https://api.alerts.in.ua/v1/alerts/active.json",
                bearerToken = token,
                connectMs = 8_000,
                readMs = 10_000
            )
            if (alertsInUaRes.first in 200..299 && isValidAlertsInUaPayload(alertsInUaRes.second)) {
                return JSONObject()
                    .put("ok", true)
                    .put("source", "alerts.in.ua")
                    .put("body", alertsInUaRes.second)
                    .toString()
            }
            fallbackNote = "alerts.in.ua недоступен (код ${alertsInUaRes.first})"
        }

        // Primary keyless radar with city/district/hromada precision: siren.pp.ua
        val regionsIndex = getOrFetchSirenRegionsIndex(context)
        val sirenRes = httpGet(
            urlString = "https://siren.pp.ua/api/v3/alerts",
            bearerToken = null,
            connectMs = 8_000,
            readMs = 10_000
        )
        if (sirenRes.first in 200..299 && isValidSirenAlertsPayload(sirenRes.second)) {
            return JSONObject()
                .put("ok", true)
                .put("source", "siren.pp.ua")
                .put("regionsIndex", regionsIndex)
                .put("body", sirenRes.second)
                .apply {
                    if (fallbackNote.isNotEmpty()) put("note", fallbackNote)
                }
                .toString()
        }

        val sirenFailNote = if (sirenRes.first > 0) {
            "siren.pp.ua код ${sirenRes.first}"
        } else {
            "siren.pp.ua недоступен"
        }

        // Automatic fallback radar (oblast precision): ubilling.net.ua
        val ubillingRes = httpGet(
            urlString = "https://ubilling.net.ua/aerialalerts/",
            bearerToken = null,
            connectMs = 8_000,
            readMs = 10_000
        )
        if (ubillingRes.first in 200..299 && isValidUbillingPayload(ubillingRes.second)) {
            val combinedNote = listOf(fallbackNote, sirenFailNote).filter { it.isNotEmpty() }.joinToString("; ")
            return JSONObject()
                .put("ok", true)
                .put("source", "ubilling.net.ua")
                .put("body", ubillingRes.second)
                .apply {
                    if (combinedNote.isNotEmpty()) put("note", combinedNote)
                }
                .toString()
        }

        return JSONObject()
            .put("ok", false)
            .put("status", ubillingRes.first)
            .put("error", "Все радары недоступны ($sirenFailNote, ubilling код ${ubillingRes.first})")
            .toString()
    }

    private fun httpGet(
        urlString: String,
        bearerToken: String?,
        connectMs: Int,
        readMs: Int
    ): Pair<Int, String> {
        val headers = if (!bearerToken.isNullOrBlank()) {
            mapOf("Authorization" to "Bearer $bearerToken")
        } else {
            emptyMap()
        }
        val res = ResilientNetwork.get(
            urlString = urlString,
            headers = headers,
            connectTimeoutMs = connectMs,
            readTimeoutMs = readMs
        )
        return res.status to res.body
    }
}
