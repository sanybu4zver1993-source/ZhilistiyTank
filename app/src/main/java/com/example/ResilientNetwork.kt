package com.example

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
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
    private const val USER_AGENT = "VeinyTank/4.2 (Android; Mobile)"
    private const val DOH_CACHE_TTL_MS = 10 * 60 * 1000L
    private const val SYSTEM_DNS_TIMEOUT_MS = 2_000L
    private const val DOH_RACE_TIMEOUT_MS = 4_200L
    private const val DOH_OUTAGE_COOLDOWN_MS = 12_000L
    const val DEFAULT_NEXTDNS_HOST = "8a5865.dns.nextdns.io"

    @Volatile
    private var appContext: Context? = null

    @Volatile
    private var lastAllDohFailedAtMs: Long = 0L

    @Volatile
    private var networkCallbackRegistered: Boolean = false

    @Volatile
    private var lastNetworkSignature: String? = null

    @Volatile
    private var configuredNextDnsHost: String = DEFAULT_NEXTDNS_HOST

    @Volatile
    private var configuredNextDnsProfileId: String = "8a5865"

    fun parseNextDnsProfileId(raw: String): String {
        val cleaned = raw.trim().lowercase()
        if (cleaned.isEmpty()) return ""
        val withoutProto = cleaned.removePrefix("https://").removePrefix("http://")
        return when {
            withoutProto.startsWith("dns.nextdns.io/") ->
                withoutProto.removePrefix("dns.nextdns.io/").substringBefore('/').substringBefore('?')
            withoutProto.contains(".dns.nextdns.io") ->
                withoutProto.substringBefore(".dns.nextdns.io").substringAfterLast('.')
            withoutProto.matches(Regex("^[a-z0-9]{4,16}$")) -> withoutProto
            else -> ""
        }.filter { it.isLetterOrDigit() || it == '-' || it == '_' }
    }

    fun setNextDnsProfile(hostOrId: String) {
        val trimmed = hostOrId.trim().lowercase()
        val id = parseNextDnsProfileId(trimmed)
        val normalizedHost = when {
            trimmed.isEmpty() -> ""
            id.isNotEmpty() -> "$id.dns.nextdns.io"
            else -> trimmed
        }
        if (normalizedHost != configuredNextDnsHost || id != configuredNextDnsProfileId) {
            configuredNextDnsHost = normalizedHost
            configuredNextDnsProfileId = id
            clearDnsCache()
            runCatching { httpClient.connectionPool.evictAll() }
            Log.d(TAG, "NextDNS profile updated: host=$configuredNextDnsHost id=$configuredNextDnsProfileId")
        }
    }

    fun getNextDnsHost(): String = configuredNextDnsHost
    fun getNextDnsProfileId(): String = configuredNextDnsProfileId

    fun init(context: Context) {
        val appCtx = context.applicationContext
        appContext = appCtx
        registerNetworkChangeWatcher(appCtx)
    }

    private fun registerNetworkChangeWatcher(ctx: Context) {
        if (networkCallbackRegistered) return
        synchronized(this) {
            if (networkCallbackRegistered) return
            try {
                val cm = ctx.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager ?: return
                cm.registerDefaultNetworkCallback(object : ConnectivityManager.NetworkCallback() {
                    override fun onAvailable(network: Network) {
                        val caps = runCatching { cm.getNetworkCapabilities(network) }.getOrNull()
                        handleNetworkTopologyChanged(network, caps)
                    }

                    override fun onCapabilitiesChanged(network: Network, networkCapabilities: NetworkCapabilities) {
                        handleNetworkTopologyChanged(network, networkCapabilities)
                    }

                    override fun onLost(network: Network) {
                        lastNetworkSignature = null
                        clearDnsCache()
                        runCatching { httpClient.connectionPool.evictAll() }
                    }
                })
                networkCallbackRegistered = true
            } catch (e: Exception) {
                Log.w(TAG, "Failed to register NetworkCallback: ${e.message}")
            }
        }
    }

    private fun handleNetworkTopologyChanged(network: Network, caps: NetworkCapabilities?) {
        val sig = buildString {
            append(network.toString())
            append('|')
            if (caps != null) {
                append(caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI))
                append(caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR))
                append(caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN))
            }
        }
        val prev = lastNetworkSignature
        lastNetworkSignature = sig
        if (prev != null && prev != sig) {
            Log.d(TAG, "Network changed ($prev -> $sig); resetting DNS cache & connection pool")
            clearDnsCache()
            runCatching { httpClient.connectionPool.evictAll() }
        }
    }

    data class HttpResponse(
        val ok: Boolean,
        val status: Int,
        val body: String,
        val error: String = "",
        val resolvedVia: String = "",
        val elapsedMs: Long = 0L,
        val lastModified: String = ""
    )

    private data class CachedDnsEntry(
        val addresses: List<InetAddress>,
        val via: String,
        val expiresAtMs: Long
    )

    private val dnsCache = ConcurrentHashMap<String, CachedDnsEntry>()
    private val lastResolutionSource = ConcurrentHashMap<String, String>()
    private val dnsExecutor = Executors.newCachedThreadPool()

    // Bootstrap DNS for dns.nextdns.io so NextDNS works even if ISP/HyperOS System DNS is completely down
    private val nextDnsBootstrapDns = object : Dns {
        override fun lookup(hostname: String): List<InetAddress> {
            val clean = hostname.trim().lowercase()
            if (clean == "dns.nextdns.io" || clean.endsWith(".dns.nextdns.io")) {
                try {
                    val sys = Dns.SYSTEM.lookup(clean).filterNot { isSinkholeOrInvalid(it) }
                    if (sys.isNotEmpty()) return sys
                } catch (_: Exception) {
                }
                return listOf(
                    InetAddress.getByName("45.90.28.0"),
                    InetAddress.getByName("45.90.30.0")
                )
            }
            return Dns.SYSTEM.lookup(hostname)
        }
    }

    private val dohBootstrapClient: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .dns(nextDnsBootstrapDns)
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
            var net = cm.activeNetwork
            if (net == null) {
                // HyperOS App Freezer can briefly report null activeNetwork right after resume
                runCatching { Thread.sleep(250L) }
                net = cm.activeNetwork
            }
            if (net == null) {
                return "Нет активной сети на устройстве (Wi-Fi/моб. сеть выключены или блокировка без VPN)"
            }
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

    // Minimal RFC 1035 wire-format DNS query builder for RFC 8484 DoH (used by NextDNS)
    private fun buildDnsWireQuery(hostname: String, qTypeInt: Int): ByteArray {
        val out = java.io.ByteArrayOutputStream(64)
        // Header: ID=0x0000 (recommended by RFC 8484), Flags=0x0100 (RD=1), QDCOUNT=1, AN=0, NS=0, AR=0
        out.write(0); out.write(0)
        out.write(0x01); out.write(0x00)
        out.write(0); out.write(1)
        out.write(0); out.write(0)
        out.write(0); out.write(0)
        out.write(0); out.write(0)

        for (label in hostname.trim().trimEnd('.').split('.')) {
            val lb = label.toByteArray(Charsets.UTF_8)
            if (lb.isEmpty() || lb.size > 63) continue
            out.write(lb.size)
            out.write(lb)
        }
        out.write(0) // Root terminator
        out.write((qTypeInt ushr 8) and 0xFF); out.write(qTypeInt and 0xFF)
        out.write(0); out.write(1) // QCLASS = IN
        return out.toByteArray()
    }

    private fun skipDnsName(pkt: ByteArray, startOffset: Int): Int {
        var pos = startOffset
        var safety = 0
        while (pos < pkt.size && safety++ < 128) {
            val len = pkt[pos].toInt() and 0xFF
            if (len == 0) return pos + 1
            if ((len and 0xC0) == 0xC0) return pos + 2
            pos += 1 + len
        }
        return pkt.size
    }

    private fun parseDnsWireResponse(pkt: ByteArray): List<InetAddress> {
        if (pkt.size < 12) return emptyList()
        val rcode = pkt[3].toInt() and 0x0F
        if (rcode != 0) return emptyList()
        val qdCount = ((pkt[4].toInt() and 0xFF) shl 8) or (pkt[5].toInt() and 0xFF)
        val anCount = ((pkt[6].toInt() and 0xFF) shl 8) or (pkt[7].toInt() and 0xFF)

        var pos = 12
        for (i in 0 until qdCount) {
            pos = skipDnsName(pkt, pos)
            pos += 4 // QTYPE + QCLASS
            if (pos > pkt.size) return emptyList()
        }

        val addrs = mutableListOf<InetAddress>()
        for (i in 0 until anCount) {
            if (pos >= pkt.size) break
            pos = skipDnsName(pkt, pos)
            if (pos + 10 > pkt.size) break
            val type = ((pkt[pos].toInt() and 0xFF) shl 8) or (pkt[pos + 1].toInt() and 0xFF)
            val rdLength = ((pkt[pos + 8].toInt() and 0xFF) shl 8) or (pkt[pos + 9].toInt() and 0xFF)
            pos += 10
            if (pos + rdLength > pkt.size) break
            if ((type == 1 && rdLength == 4) || (type == 28 && rdLength == 16)) {
                val rawIp = pkt.copyOfRange(pos, pos + rdLength)
                try {
                    val addr = InetAddress.getByAddress(rawIp)
                    if (!isSinkholeOrInvalid(addr)) addrs.add(addr)
                } catch (_: Exception) {
                }
            }
            pos += rdLength
        }
        return addrs
    }

    private fun queryNextDnsWireSingle(
        hostname: String,
        qType: String,
        profileId: String,
        activeCalls: CopyOnWriteArrayList<Call>
    ): Pair<List<InetAddress>, String> {
        val qTypeInt = if (qType == "AAAA") 28 else 1
        val wireBody = buildDnsWireQuery(hostname, qTypeInt)
        val mediaType = "application/dns-message".toMediaType()
        val url = "https://dns.nextdns.io/$profileId"
        val req = Request.Builder()
            .url(url)
            .header("Accept", "application/dns-message")
            .header("User-Agent", USER_AGENT)
            .post(wireBody.toRequestBody(mediaType))
            .build()
        val call = dohBootstrapClient.newCall(req)
        activeCalls.add(call)
        try {
            call.execute().use { resp ->
                if (!resp.isSuccessful) {
                    throw UnknownHostException("nextdns:$profileId($qType)=HTTP ${resp.code}")
                }
                val bytes = resp.body?.bytes() ?: throw UnknownHostException("nextdns:$profileId=empty body")
                val ips = parseDnsWireResponse(bytes)
                if (ips.isEmpty()) {
                    throw UnknownHostException("nextdns:$profileId($qType)=empty")
                }
                return ips to "nextdns:$profileId"
            }
        } catch (t: Throwable) {
            if (t is UnknownHostException) throw t
            throw UnknownHostException("nextdns:$profileId($qType)=${t.javaClass.simpleName}")
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
            .header("User-Agent", USER_AGENT)
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

    fun resolveViaNextDnsOnly(hostname: String): Pair<List<InetAddress>, String> {
        val profileId = configuredNextDnsProfileId
        if (profileId.isEmpty()) {
            throw UnknownHostException("NextDNS профиль не указан")
        }
        val activeCalls = CopyOnWriteArrayList<Call>()
        val ecs = ExecutorCompletionService<Pair<List<InetAddress>, String>>(dnsExecutor)
        val futures = listOf("A", "AAAA").map { qType ->
            ecs.submit(Callable { queryNextDnsWireSingle(hostname, qType, profileId, activeCalls) })
        }
        val ipv4 = mutableListOf<InetAddress>()
        val ipv6 = mutableListOf<InetAddress>()
        val errs = mutableListOf<String>()
        val deadlineNs = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(3_200L)
        try {
            var done = 0
            while (done < futures.size) {
                val remMs = TimeUnit.NANOSECONDS.toMillis(deadlineNs - System.nanoTime())
                val waitMs = if (ipv4.isNotEmpty() || ipv6.isNotEmpty()) minOf(remMs, 250L) else remMs
                if (waitMs <= 0L) break
                val f = ecs.poll(waitMs, TimeUnit.MILLISECONDS) ?: break
                done++
                try {
                    val (addrs, _) = f.get()
                    addrs.forEach { a ->
                        if (a is java.net.Inet6Address) ipv6.add(a) else ipv4.add(a)
                    }
                    if (ipv4.isNotEmpty() && ipv6.isNotEmpty()) break
                } catch (ee: ExecutionException) {
                    errs.add(ee.cause?.message ?: ee.message ?: "error")
                }
            }
        } finally {
            activeCalls.forEach { runCatching { it.cancel() } }
            futures.forEach { it.cancel(true) }
        }
        val combined = interleaveAddrs(ipv4, ipv6)
        if (combined.isEmpty()) {
            throw UnknownHostException(errs.firstOrNull() ?: "NextDNS $profileId timeout")
        }
        return combined to "nextdns:$profileId"
    }

    private fun interleaveAddrs(ipv4: List<InetAddress>, ipv6: List<InetAddress>): List<InetAddress> {
        val out = mutableListOf<InetAddress>()
        val maxLen = maxOf(ipv4.size, ipv6.size)
        for (idx in 0 until maxLen) {
            if (idx < ipv4.size && !out.contains(ipv4[idx])) out.add(ipv4[idx])
            if (idx < ipv6.size && !out.contains(ipv6[idx])) out.add(ipv6[idx])
        }
        return out
    }

    fun resolveViaDohOnly(hostname: String, bypassCooldown: Boolean = false): Pair<List<InetAddress>, String> {
        if (!bypassCooldown && lastAllDohFailedAtMs > 0L) {
            val sinceFail = SystemClock.elapsedRealtime() - lastAllDohFailedAtMs
            if (sinceFail in 0 until DOH_OUTAGE_COOLDOWN_MS) {
                throw UnknownHostException("Внешние DoH-серверы (NextDNS / 1.1.1.1 / 8.8.8.8) не отвечают — блокировка трафика приложению или нет интернета")
            }
        }

        val profileId = configuredNextDnsProfileId
        val allErrors = mutableListOf<String>()
        val nextDnsIpv4 = mutableListOf<InetAddress>()
        val nextDnsIpv6 = mutableListOf<InetAddress>()
        val fallbackIpv4 = mutableListOf<InetAddress>()
        val fallbackIpv6 = mutableListOf<InetAddress>()
        var fallbackSource = ""

        val ecs = ExecutorCompletionService<Pair<List<InetAddress>, String>>(dnsExecutor)
        val activeCalls = CopyOnWriteArrayList<Call>()
        val futures = mutableListOf<java.util.concurrent.Future<Pair<List<InetAddress>, String>>>()

        if (profileId.isNotEmpty()) {
            listOf("A", "AAAA").forEach { qType ->
                futures.add(ecs.submit(Callable {
                    val (addrs, src) = queryNextDnsWireSingle(hostname, qType, profileId, activeCalls)
                    addrs to "$src($qType)"
                }))
            }
        }

        dohEndpoints.forEach { (label, baseUrl) ->
            listOf("A", "AAAA").forEach { qType ->
                futures.add(ecs.submit(Callable {
                    val (addrs, src) = queryDohSingle(hostname, qType, label, baseUrl, activeCalls)
                    addrs to "$src($qType)"
                }))
            }
        }

        val deadlineNs = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(DOH_RACE_TIMEOUT_MS)

        try {
            var completedCount = 0
            while (completedCount < futures.size) {
                val hasNextDns = nextDnsIpv4.isNotEmpty() || nextDnsIpv6.isNotEmpty()
                val hasFallback = fallbackIpv4.isNotEmpty() || fallbackIpv6.isNotEmpty()
                val remainingMs = TimeUnit.NANOSECONDS.toMillis(deadlineNs - System.nanoTime())
                // Give NextDNS a short priority window if public DoH replied first
                val waitMs = when {
                    hasNextDns -> minOf(remainingMs, 250L)
                    hasFallback -> minOf(remainingMs, if (profileId.isNotEmpty()) 450L else 300L)
                    else -> remainingMs
                }
                if (waitMs <= 0L) break

                val completed = ecs.poll(waitMs, TimeUnit.MILLISECONDS) ?: break
                completedCount++
                try {
                    val (addrs, srcTag) = completed.get()
                    if (addrs.isNotEmpty()) {
                        val isNext = srcTag.startsWith("nextdns:")
                        if (!isNext && fallbackSource.isEmpty()) fallbackSource = srcTag.substringBefore('(')
                        addrs.forEach { addr ->
                            if (isNext) {
                                if (addr is java.net.Inet6Address) nextDnsIpv6.add(addr) else nextDnsIpv4.add(addr)
                            } else {
                                if (addr is java.net.Inet6Address) fallbackIpv6.add(addr) else fallbackIpv4.add(addr)
                            }
                        }
                        if (nextDnsIpv4.isNotEmpty() && nextDnsIpv6.isNotEmpty()) break
                    }
                } catch (ee: ExecutionException) {
                    allErrors.add(ee.cause?.message ?: ee.message ?: "error")
                }
            }
        } finally {
            activeCalls.forEach { runCatching { it.cancel() } }
            futures.forEach { it.cancel(true) }
        }

        if (nextDnsIpv4.isNotEmpty() || nextDnsIpv6.isNotEmpty()) {
            lastAllDohFailedAtMs = 0L
            return interleaveAddrs(nextDnsIpv4, nextDnsIpv6) to "nextdns:$profileId"
        }

        if (fallbackIpv4.isNotEmpty() || fallbackIpv6.isNotEmpty()) {
            lastAllDohFailedAtMs = 0L
            return interleaveAddrs(fallbackIpv4, fallbackIpv6) to fallbackSource.ifEmpty { "doh" }
        }

        lastAllDohFailedAtMs = SystemClock.elapsedRealtime()
        Log.e(TAG, "DoH race failed for $hostname: ${allErrors.joinToString(", ")}")
        throw UnknownHostException("Нет ответа от NextDNS / 1.1.1.1 / 8.8.8.8 (проверь Wi-Fi, VPN или доступ приложения в сеть в настройках HyperOS)")
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
            .readTimeout(90, TimeUnit.SECONDS)
            .writeTimeout(30, TimeUnit.SECONDS)
            .pingInterval(20, TimeUnit.SECONDS)
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
        val client = if (connectTimeoutMs == 20_000 && readTimeoutMs == 90_000) {
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
            .header("User-Agent", USER_AGENT)
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
        val client = if (connectTimeoutMs == 20_000 && readTimeoutMs == 90_000) {
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
            .header("User-Agent", USER_AGENT)
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
                val lastMod = resp.header("Last-Modified").orEmpty()
                HttpResponse(
                    ok = resp.isSuccessful,
                    status = resp.code,
                    body = body,
                    resolvedVia = via,
                    elapsedMs = elapsed,
                    lastModified = lastMod
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
            out.put("nextDnsHost", configuredNextDnsHost)
            out.put("nextDnsProfileId", configuredNextDnsProfileId)
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

        val profileId = configuredNextDnsProfileId
        if (profileId.isNotEmpty()) {
            val ndStart = SystemClock.elapsedRealtime()
            try {
                val (ndAddrs, _) = resolveViaNextDnsOnly(hostname)
                out.put("nextDnsOk", true)
                out.put("nextDnsProfile", profileId)
                out.put("nextDnsIp", ndAddrs.firstOrNull()?.hostAddress ?: "")
                out.put("nextDnsMs", SystemClock.elapsedRealtime() - ndStart)
            } catch (e: Exception) {
                out.put("nextDnsOk", false)
                out.put("nextDnsProfile", profileId)
                out.put("nextDnsError", e.message ?: "NextDNS failed")
                out.put("nextDnsMs", SystemClock.elapsedRealtime() - ndStart)
            }
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
