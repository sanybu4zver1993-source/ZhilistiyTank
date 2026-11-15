package com.example

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Build
import android.os.SystemClock
import android.util.Log
import okhttp3.Call
import okhttp3.Dns
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.net.InetAddress
import java.net.URLEncoder
import java.net.UnknownHostException
import java.util.concurrent.Callable
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.ExecutionException
import java.util.concurrent.ExecutorCompletionService
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

object ResilientNetwork {
    private const val TAG = "VeinyTankNet"
    private const val DOH_CACHE_TTL_MS = 10 * 60 * 1000L
    private const val SYSTEM_DNS_TIMEOUT_MS = 2_000L
    private const val DOH_RACE_TIMEOUT_MS = 4_200L
    private const val DOH_OUTAGE_COOLDOWN_MS = 12_000L

    @Volatile
    private var appContext: Context? = null

    @Volatile
    private var lastAllDohFailedAtMs: Long = 0L

    fun init(context: Context) {
        appContext = context.applicationContext
    }

    data class HttpResponse(
        val ok: Boolean,
        val status: Int,
        val body: String,
        val error: String = "",
        val resolvedVia: String = "",
        val elapsedMs: Long = 0L
    )

    private data class CachedDnsEntry(
        val addresses: List<InetAddress>,
        val via: String,
        val expiresAtMs: Long
    )

    private val dnsCache = ConcurrentHashMap<String, CachedDnsEntry>()
    private val lastResolutionSource = ConcurrentHashMap<String, String>()
    private val dnsExecutor = Executors.newCachedThreadPool()

    private val dohBootstrapClient: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .connectTimeout(3, TimeUnit.SECONDS)
            .readTimeout(4, TimeUnit.SECONDS)
            .writeTimeout(4, TimeUnit.SECONDS)
            .retryOnConnectionFailure(false)
            .build()
    }

    fun clearDnsCache() {
        dnsCache.clear()
        lastResolutionSource.clear()
        lastAllDohFailedAtMs = 0L
    }

    private val dohEndpoints = listOf(
        "1.1.1.1" to "https://1.1.1.1/dns-query",
        "8.8.8.8" to "https://8.8.8.8/resolve",
        "1.0.0.1" to "https://1.0.0.1/dns-query",
        "8.8.4.4" to "https://8.8.4.4/resolve"
    )

    private fun isSinkholeOrInvalid(addr: InetAddress): Boolean {
        if (addr.isAnyLocalAddress || addr.isLoopbackAddress || addr.isLinkLocalAddress || addr.isMulticastAddress) {
            return true
        }
        val host = addr.hostAddress ?: return true
        return host == "0.0.0.0" || host == "::" || host == "127.0.0.1" || host == "::1"
    }

    private fun checkNetworkPrecondition(): String? {
        val ctx = appContext ?: return null
        return try {
            val cm = ctx.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager ?: return null
            val net = cm.activeNetwork
                ?: return "Нет активной сети на устройстве (Wi-Fi/моб. сеть выключены или блокировка без VPN)"
            val caps = cm.getNetworkCapabilities(net)
                ?: return "Сеть не передаёт параметры устройству"
            if (!caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)) {
                return "Активная сеть без выхода в интернет"
            }
            null
        } catch (_: Exception) {
            null
        }
    }

    fun resolveSystemDnsOnly(hostname: String): List<InetAddress> {
        val future = dnsExecutor.submit(Callable {
            Dns.SYSTEM.lookup(hostname).filterNot { isSinkholeOrInvalid(it) }
        })
        return try {
            val res = future.get(SYSTEM_DNS_TIMEOUT_MS, TimeUnit.MILLISECONDS)
            if (res.isEmpty()) throw UnknownHostException("Sinkholed or empty DNS for $hostname")
            res
        } catch (e: Exception) {
            future.cancel(true)
            throw UnknownHostException("${e.cause?.message ?: e.message ?: "System DNS failed"} ($hostname)")
        }
    }

    private fun queryDohSingle(
        hostname: String,
        qType: String,
        label: String,
        baseUrl: String,
        activeCalls: CopyOnWriteArrayList<Call>
    ): Pair<List<InetAddress>, String> {
        val encoded = URLEncoder.encode(hostname, "UTF-8")
        val url = "$baseUrl?name=$encoded&type=$qType"
        val req = Request.Builder()
            .url(url)
            .header("Accept", "application/dns-json")
            .header("User-Agent", "VeinyTank/4.2")
            .get()
            .build()
        val call = dohBootstrapClient.newCall(req)
        activeCalls.add(call)
        try {
            call.execute().use { resp ->
                if (!resp.isSuccessful) {
                    throw UnknownHostException("$label($qType)=HTTP ${resp.code}")
                }
                val body = resp.body?.string().orEmpty()
                val json = JSONObject(body)
                val status = json.optInt("Status", -1)
                val answers = json.optJSONArray("Answer")
                val ips = mutableListOf<InetAddress>()
                if (status == 0 && answers != null) {
                    for (i in 0 until answers.length()) {
                        val ans = answers.optJSONObject(i) ?: continue
                        val type = ans.optInt("type", -1)
                        if (type == 1 || type == 28) {
                            val data = ans.optString("data", "").trim()
                            if (data.isNotEmpty()) {
                                try {
                                    val addr = InetAddress.getByName(data)
                                    if (!isSinkholeOrInvalid(addr)) ips.add(addr)
                                } catch (_: Exception) {
                                }
                            }
                        }
                    }
                }
                if (ips.isEmpty()) {
                    throw UnknownHostException("$label($qType)=empty(dnsStatus=$status)")
                }
                return ips to "doh:$label"
            }
        } catch (t: Throwable) {
            if (t is UnknownHostException) throw t
            throw UnknownHostException("$label($qType)=${t.javaClass.simpleName}")
        }
    }

    fun resolveViaDohOnly(hostname: String, bypassCooldown: Boolean = false): Pair<List<InetAddress>, String> {
        if (!bypassCooldown && lastAllDohFailedAtMs > 0L) {
            val sinceFail = SystemClock.elapsedRealtime() - lastAllDohFailedAtMs
            if (sinceFail in 0 until DOH_OUTAGE_COOLDOWN_MS) {
                throw UnknownHostException("Внешние DoH-серверы (1.1.1.1 / 8.8.8.8) не отвечают — блокировка трафика приложению или нет интернета")
            }
        }

        val allErrors = mutableListOf<String>()
        for (qType in listOf("A", "AAAA")) {
            val ecs = ExecutorCompletionService<Pair<List<InetAddress>, String>>(dnsExecutor)
            val activeCalls = CopyOnWriteArrayList<Call>()
            val futures = dohEndpoints.map { (label, baseUrl) ->
                ecs.submit(Callable { queryDohSingle(hostname, qType, label, baseUrl, activeCalls) })
            }
            val deadlineNs = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(DOH_RACE_TIMEOUT_MS)
            var gotTimeout = false
            try {
                for (i in futures.indices) {
                    val remainingMs = TimeUnit.NANOSECONDS.toMillis(deadlineNs - System.nanoTime())
                    if (remainingMs <= 0L) {
                        gotTimeout = true
                        break
                    }
                    val completed = ecs.poll(remainingMs, TimeUnit.MILLISECONDS)
                    if (completed == null) {
                        gotTimeout = true
                        break
                    }
                    try {
                        val res = completed.get()
                        if (res.first.isNotEmpty()) {
                            lastAllDohFailedAtMs = 0L
                            return res
                        }
                    } catch (ee: ExecutionException) {
                        val msg = ee.cause?.message ?: ee.message ?: "error"
                        allErrors.add(msg)
                        if (msg.contains("SocketTimeoutException")) gotTimeout = true
                    }
                }
            } finally {
                activeCalls.forEach { runCatching { it.cancel() } }
                futures.forEach { it.cancel(true) }
            }

            // If IPv4 (A) timed out across all 4 DoH servers, AAAA will time out on the same blocked socket too.
            if (gotTimeout && qType == "A") {
                allErrors.add("timeout")
                break
            }
        }

        lastAllDohFailedAtMs = SystemClock.elapsedRealtime()
        Log.e(TAG, "DoH race failed for $hostname: ${allErrors.joinToString(", ")}")
        throw UnknownHostException("Нет ответа от 1.1.1.1 / 8.8.8.8 (проверь Wi-Fi, VPN или доступ приложения в сеть в настройках HyperOS)")
    }

    val resilientDns = object : Dns {
        override fun lookup(hostname: String): List<InetAddress> {
            val cleanHost = hostname.trim().lowercase()
            val now = SystemClock.elapsedRealtime()
            val cached = dnsCache[cleanHost]
            if (cached != null && now < cached.expiresAtMs && cached.addresses.isNotEmpty()) {
                lastResolutionSource[cleanHost] = "${cached.via}(cached)"
                return cached.addresses
            }

            checkNetworkPrecondition()?.let { reason ->
                lastResolutionSource[cleanHost] = "no-network"
                throw UnknownHostException(reason)
            }

            try {
                val sysAddrs = resolveSystemDnsOnly(cleanHost)
                dnsCache[cleanHost] = CachedDnsEntry(sysAddrs, "system", now + DOH_CACHE_TTL_MS)
                lastResolutionSource[cleanHost] = "system"
                return sysAddrs
            } catch (sysErr: UnknownHostException) {
                Log.w(TAG, "System DNS failed for $cleanHost (${sysErr.message}), falling back to parallel DoH...")
            }

            val (dohAddrs, source) = resolveViaDohOnly(cleanHost)
            dnsCache[cleanHost] = CachedDnsEntry(dohAddrs, source, now + DOH_CACHE_TTL_MS)
            lastResolutionSource[cleanHost] = source
            Log.d(TAG, "Resolved $cleanHost via $source -> ${dohAddrs.firstOrNull()?.hostAddress}")
            return dohAddrs
        }
    }

    private fun invalidateDns(urlString: String) {
        try {
            val host = java.net.URL(urlString).host.trim().lowercase()
            if (host.isNotEmpty()) dnsCache.remove(host)
        } catch (_: Exception) {
        }
    }

    val httpClient: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .dns(resilientDns)
            .connectTimeout(20, TimeUnit.SECONDS)
            .readTimeout(60, TimeUnit.SECONDS)
            .writeTimeout(30, TimeUnit.SECONDS)
            .retryOnConnectionFailure(true)
            .build()
    }

    fun get(
        urlString: String,
        headers: Map<String, String> = emptyMap(),
        connectTimeoutMs: Int = 15_000,
        readTimeoutMs: Int = 25_000
    ): HttpResponse {
        val started = SystemClock.elapsedRealtime()
        val host = runCatching { java.net.URL(urlString).host.lowercase() }.getOrDefault("")
        val client = if (connectTimeoutMs == 20_000 && readTimeoutMs == 60_000) {
            httpClient
        } else {
            httpClient.newBuilder()
                .connectTimeout(connectTimeoutMs.toLong(), TimeUnit.MILLISECONDS)
                .readTimeout(readTimeoutMs.toLong(), TimeUnit.MILLISECONDS)
                .build()
        }

        val builder = Request.Builder()
            .url(urlString)
            .header("Accept", "application/json")
            .header("User-Agent", "VeinyTank/4.2")
            .get()
        headers.forEach { (k, v) -> builder.header(k, v) }

        return executeCall(client, builder.build(), host, urlString, started)
    }

    fun postJson(
        urlString: String,
        jsonBody: String,
        headers: Map<String, String> = emptyMap(),
        connectTimeoutMs: Int = 20_000,
        readTimeoutMs: Int = 60_000
    ): HttpResponse {
        val started = SystemClock.elapsedRealtime()
        val host = runCatching { java.net.URL(urlString).host.lowercase() }.getOrDefault("")
        val client = if (connectTimeoutMs == 20_000 && readTimeoutMs == 60_000) {
            httpClient
        } else {
            httpClient.newBuilder()
                .connectTimeout(connectTimeoutMs.toLong(), TimeUnit.MILLISECONDS)
                .readTimeout(readTimeoutMs.toLong(), TimeUnit.MILLISECONDS)
                .build()
        }

        val mediaType = "application/json; charset=UTF-8".toMediaType()
        val builder = Request.Builder()
            .url(urlString)
            .header("Accept", "application/json")
            .header("User-Agent", "VeinyTank/4.2")
            .post(jsonBody.toRequestBody(mediaType))
        headers.forEach { (k, v) -> builder.header(k, v) }

        return executeCall(client, builder.build(), host, urlString, started)
    }

    private fun executeCall(
        client: OkHttpClient,
        request: Request,
        host: String,
        urlString: String,
        startedAtMs: Long
    ): HttpResponse {
        return try {
            client.newCall(request).execute().use { resp ->
                val body = resp.body?.string().orEmpty()
                val elapsed = SystemClock.elapsedRealtime() - startedAtMs
                val via = lastResolutionSource[host] ?: "system"
                HttpResponse(
                    ok = resp.isSuccessful,
                    status = resp.code,
                    body = body,
                    resolvedVia = via,
                    elapsedMs = elapsed
                )
            }
        } catch (t: Throwable) {
            invalidateDns(urlString)
            val elapsed = SystemClock.elapsedRealtime() - startedAtMs
            val msg = t.message?.takeIf { it.isNotBlank() } ?: t.javaClass.simpleName
            Log.e(TAG, "HTTP failed host=$host (${t.javaClass.simpleName}: $msg)")
            HttpResponse(
                ok = false,
                status = 0,
                body = "",
                error = msg,
                resolvedVia = lastResolutionSource[host] ?: "failed",
                elapsedMs = elapsed
            )
        }
    }

    fun inspectDeviceNetworkState(context: Context): JSONObject {
        val out = JSONObject()
        try {
            val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
            val network = cm?.activeNetwork
            val caps = if (network != null) cm.getNetworkCapabilities(network) else null
            val links = if (network != null) cm.getLinkProperties(network) else null

            val transports = mutableListOf<String>()
            if (caps != null) {
                if (caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) transports.add("Wi-Fi")
                if (caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR)) transports.add("Мобильная")
                if (caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)) transports.add("Ethernet")
                if (caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN)) transports.add("VPN")
            }

            out.put("connected", caps != null && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET))
            out.put("validated", caps?.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED) == true)
            out.put("vpnActive", caps?.hasTransport(NetworkCapabilities.TRANSPORT_VPN) == true)
            out.put("transports", if (transports.isEmpty()) "Нет сети" else transports.joinToString(" + "))

            if (links != null) {
                val dnsList = links.dnsServers.mapNotNull { it.hostAddress }.filter { it.isNotBlank() }
                out.put("dnsServers", if (dnsList.isEmpty()) "Нет" else dnsList.joinToString(", "))
                val proxy = links.httpProxy
                out.put("httpProxy", if (proxy != null && !proxy.host.isNullOrBlank()) "${proxy.host}:${proxy.port}" else "Нет")
            } else {
                out.put("dnsServers", "Нет")
                out.put("httpProxy", "Нет")
            }

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P && links != null) {
                val privDns = links.privateDnsServerName
                out.put("privateDnsActive", links.isPrivateDnsActive)
                out.put("privateDnsHost", privDns ?: if (links.isPrivateDnsActive) "Авто/Системный" else "Выкл")
            } else {
                out.put("privateDnsActive", false)
                out.put("privateDnsHost", "N/A")
            }
        } catch (e: Exception) {
            out.put("connected", false)
            out.put("error", e.message ?: "Ошибка чтения сети")
        }
        return out
    }

    fun probeHostResolution(hostname: String): JSONObject {
        val out = JSONObject().put("host", hostname)
        val sysStart = SystemClock.elapsedRealtime()
        try {
            val sysAddrs = resolveSystemDnsOnly(hostname)
            out.put("systemOk", true)
            out.put("systemIp", sysAddrs.firstOrNull()?.hostAddress ?: "")
            out.put("systemMs", SystemClock.elapsedRealtime() - sysStart)
        } catch (e: Exception) {
            out.put("systemOk", false)
            out.put("systemError", e.message ?: "System DNS failed")
            out.put("systemMs", SystemClock.elapsedRealtime() - sysStart)
        }

        val dohStart = SystemClock.elapsedRealtime()
        try {
            val (dohAddrs, src) = resolveViaDohOnly(hostname, bypassCooldown = true)
            out.put("dohOk", true)
            out.put("dohSource", src)
            out.put("dohIp", dohAddrs.firstOrNull()?.hostAddress ?: "")
            out.put("dohMs", SystemClock.elapsedRealtime() - dohStart)
        } catch (e: Exception) {
            out.put("dohOk", false)
            out.put("dohError", e.message ?: "DoH failed")
            out.put("dohMs", SystemClock.elapsedRealtime() - dohStart)
        }
        return out
    }
}
