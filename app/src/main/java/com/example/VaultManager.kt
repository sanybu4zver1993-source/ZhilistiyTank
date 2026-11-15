package com.example

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.webkit.WebStorage
import org.json.JSONObject
import java.io.File
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.security.KeyStore
import java.security.MessageDigest
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.Mac
import javax.crypto.SecretKey
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.PBEKeySpec
import javax.crypto.spec.SecretKeySpec

class VaultManager(private val context: Context) {
    private val vaultFile = File(context.noBackupFilesDir, "tank_state.bin")
    private val metaPrefs = context.getSharedPreferences("TankVaultMeta", Context.MODE_PRIVATE)

    private val keyAlias = "veiny_tank_hw_pepper_v1"
    private val panicAlias = "veiny_tank_panic_mac_v1"
    private val slotSize = 2 * 1024 * 1024 // 2 MB fixed encrypted slot (4 MB total container)
    private val headerSize = 16 + 12 // 16B salt + 12B IV (no plaintext length metadata)
    private val gcmTagBytes = 16
    private val pbkdf2Iterations = 120_000

    companion object {
        private val sessionLock = Any()
        private var activeSlot: Int = -1
        private var sessionKeyBytes: ByteArray? = null
        private var sessionSalt: ByteArray? = null

        fun hasActiveSession(): Boolean = synchronized(sessionLock) {
            activeSlot in 0..1 && sessionKeyBytes != null && sessionSalt != null
        }

        fun getActiveSlot(): Int = synchronized(sessionLock) { activeSlot }

        fun clearSessionInRam() {
            synchronized(sessionLock) {
                sessionKeyBytes?.fill(0)
                sessionKeyBytes = null
                sessionSalt?.fill(0)
                sessionSalt = null
                activeSlot = -1
            }
        }
    }

    init {
        ensureHardwareKeys()
    }

    fun isInitialized(): Boolean {
        return vaultFile.exists() &&
            vaultFile.length() >= slotSize * 2L &&
            metaPrefs.getBoolean("vault_ready", false)
    }

    private fun ensureHardwareKeys() {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        if (!ks.containsAlias(keyAlias)) {
            val kg = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_HMAC_SHA256, "AndroidKeyStore")
            kg.init(
                KeyGenParameterSpec.Builder(keyAlias, KeyProperties.PURPOSE_SIGN)
                    .setDigests(KeyProperties.DIGEST_SHA256)
                    .build()
            )
            kg.generateKey()
        }
        if (!ks.containsAlias(panicAlias)) {
            val kg = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_HMAC_SHA256, "AndroidKeyStore")
            kg.init(
                KeyGenParameterSpec.Builder(panicAlias, KeyProperties.PURPOSE_SIGN)
                    .setDigests(KeyProperties.DIGEST_SHA256)
                    .build()
            )
            kg.generateKey()
        }
    }

    private fun ensureVaultContainer() {
        if (!vaultFile.exists() || vaultFile.length() != slotSize * 2L) {
            RandomAccessFile(vaultFile, "rw").use { raf ->
                raf.setLength(slotSize * 2L)
                val buf = ByteArray(65536)
                val sr = SecureRandom()
                val chunks = (slotSize * 2) / buf.size
                raf.seek(0)
                repeat(chunks) {
                    sr.nextBytes(buf)
                    raf.write(buf)
                }
                raf.fd.sync()
            }
        }
    }

    private fun deriveSlotKeyBytes(pin: String, salt: ByteArray): ByteArray {
        val spec = PBEKeySpec(pin.toCharArray(), salt, pbkdf2Iterations, 256)
        val pbkdf2Bytes = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256")
            .generateSecret(spec).encoded
        spec.clearPassword()

        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        val hwKey = ks.getKey(keyAlias, null) as SecretKey
        val mac = Mac.getInstance("HmacSHA256").apply { init(hwKey) }
        val finalKey = mac.doFinal(pbkdf2Bytes)
        pbkdf2Bytes.fill(0)
        return finalKey
    }

    private fun computePanicMac(pin: String): String {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        val pKey = ks.getKey(panicAlias, null) as SecretKey
        val mac = Mac.getInstance("HmacSHA256").apply { init(pKey) }
        return mac.doFinal(pin.toByteArray(Charsets.UTF_8))
            .joinToString("") { "%02x".format(it) }
    }

    private fun writeFullFixedSlot(slotIndex: Int, salt: ByteArray, keyBytes: ByteArray, jsonPayload: ByteArray) {
        require(slotIndex in 0..1)
        require(salt.size == 16 && keyBytes.size == 32)
        ensureVaultContainer()

        val plaintextCapacity = slotSize - headerSize - gcmTagBytes
        require(jsonPayload.size <= plaintextCapacity - 4) { "State exceeds 2 MB slot capacity" }

        val sr = SecureRandom()
        val iv = ByteArray(12).also { sr.nextBytes(it) }
        val plainBuf = ByteArray(plaintextCapacity)
        // Fill entire slot payload with random padding first, then write 4B actual length + JSON
        sr.nextBytes(plainBuf)
        ByteBuffer.wrap(plainBuf, 0, 4).putInt(jsonPayload.size)
        System.arraycopy(jsonPayload, 0, plainBuf, 4, jsonPayload.size)

        val keySpec = SecretKeySpec(keyBytes, "AES")
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, keySpec, GCMParameterSpec(128, iv))
        val ciphertext = cipher.doFinal(plainBuf)
        plainBuf.fill(0)

        RandomAccessFile(vaultFile, "rw").use { raf ->
            raf.seek((slotIndex * slotSize).toLong())
            raf.write(salt)
            raf.write(iv)
            raf.write(ciphertext)
            raf.fd.sync()
        }
    }

    private fun readAndDecryptSlot(slotIndex: Int, pin: String): Triple<ByteArray, ByteArray, String>? {
        val salt = ByteArray(16)
        val iv = ByteArray(12)
        val ciphertext = ByteArray(slotSize - headerSize)

        RandomAccessFile(vaultFile, "r").use { raf ->
            raf.seek((slotIndex * slotSize).toLong())
            raf.readFully(salt)
            raf.readFully(iv)
            raf.readFully(ciphertext)
        }

        val keyBytes = deriveSlotKeyBytes(pin, salt)
        return try {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(keyBytes, "AES"), GCMParameterSpec(128, iv))
            val plain = cipher.doFinal(ciphertext)
            val actualLen = ByteBuffer.wrap(plain, 0, 4).int
            if (actualLen < 0 || actualLen > plain.size - 4) {
                keyBytes.fill(0)
                plain.fill(0)
                return null
            }
            val jsonStr = String(plain, 4, actualLen, Charsets.UTF_8)
            plain.fill(0)
            Triple(salt, keyBytes, jsonStr)
        } catch (_: Exception) {
            keyBytes.fill(0)
            null
        }
    }

    private fun writeRandomDummySlot1() {
        val sr = SecureRandom()
        val dummySalt = ByteArray(16).also { sr.nextBytes(it) }
        val dummyKey = ByteArray(32).also { sr.nextBytes(it) }
        val dummyJson = "{\"dossier\":{\"goal\":\"maintenance\"},\"events\":[],\"water\":0}".toByteArray(Charsets.UTF_8)
        writeFullFixedSlot(1, dummySalt, dummyKey, dummyJson)
        dummyKey.fill(0)
    }

    @Synchronized
    fun setupVaultSinglePin(realPin: String, initialRealJson: String): Boolean {
        if (realPin.length < 4) return false

        ensureHardwareKeys()
        ensureVaultContainer()

        val sr = SecureRandom()
        val realSalt = ByteArray(16).also { sr.nextBytes(it) }
        val realKey = deriveSlotKeyBytes(realPin, realSalt)
        writeFullFixedSlot(0, realSalt, realKey, initialRealJson.toByteArray(Charsets.UTF_8))

        // Initialize Slot 1 with indistinguishable full-slot ciphertext on an ephemeral random key
        writeRandomDummySlot1()

        metaPrefs.edit()
            .putBoolean("vault_ready", true)
            .remove("panic_mac")
            .apply()

        synchronized(sessionLock) {
            sessionKeyBytes?.fill(0)
            sessionSalt?.fill(0)
            activeSlot = 0
            sessionKeyBytes = realKey
            sessionSalt = realSalt
        }
        return true
    }

    @Synchronized
    fun unlockOrWipe(pin: String): String {
        val out = JSONObject()
        if (!isInitialized()) {
            out.put("status", "UNINITIALIZED")
            return out.toString()
        }

        if (isPanicPin(pin)) {
            executeCryptoShredding()
            out.put("status", "WIPED")
            out.put("slot", 1)
            out.put("stateJson", "{}")
            return out.toString()
        }

        for (slot in 0..1) {
            val result = readAndDecryptSlot(slot, pin)
            if (result != null) {
                val (salt, keyBytes, jsonStr) = result
                synchronized(sessionLock) {
                    sessionKeyBytes?.fill(0)
                    sessionSalt?.fill(0)
                    activeSlot = slot
                    sessionKeyBytes = keyBytes
                    sessionSalt = salt
                }
                out.put("status", "OK")
                out.put("slot", slot)
                out.put("stateJson", jsonStr)
                return out.toString()
            }
        }

        out.put("status", "DENIED")
        return out.toString()
    }

    @Synchronized
    fun saveActiveSlot(jsonPayload: ByteArray): String {
        val (slot, keyCopy, saltCopy) = synchronized(sessionLock) {
            val k = sessionKeyBytes ?: return "LOCKED"
            val s = sessionSalt ?: return "LOCKED"
            if (activeSlot !in 0..1) return "LOCKED"
            Triple(activeSlot, k.copyOf(), s.copyOf())
        }
        return try {
            writeFullFixedSlot(slot, saltCopy, keyCopy, jsonPayload)
            "OK"
        } catch (_: Exception) {
            "ERROR"
        } finally {
            keyCopy.fill(0)
            saltCopy.fill(0)
        }
    }

    @Synchronized
    fun changeCurrentSlotPin(oldPin: String, newPin: String): String {
        if (newPin.length < 4) return "INVALID_NEW_PIN"
        val currentSlot = synchronized(sessionLock) { activeSlot }
        if (currentSlot !in 0..1) return "LOCKED"

        val decrypted = readAndDecryptSlot(currentSlot, oldPin) ?: return "WRONG_PIN"
        val (_, oldKeyBytes, jsonStr) = decrypted
        oldKeyBytes.fill(0)

        val sr = SecureRandom()
        val newSalt = ByteArray(16).also { sr.nextBytes(it) }
        val newKey = deriveSlotKeyBytes(newPin, newSalt)
        writeFullFixedSlot(currentSlot, newSalt, newKey, jsonStr.toByteArray(Charsets.UTF_8))

        synchronized(sessionLock) {
            sessionKeyBytes?.fill(0)
            sessionSalt?.fill(0)
            activeSlot = currentSlot
            sessionKeyBytes = newKey
            sessionSalt = newSalt
        }
        return "OK"
    }

    @Synchronized
    fun configureHiddenCodes(realPin: String, decoyPin: String, panicPin: String): String {
        val currentSlot = synchronized(sessionLock) { activeSlot }
        if (currentSlot != 0) return "DENIED"

        val decrypted = readAndDecryptSlot(0, realPin) ?: return "WRONG_REAL_PIN"
        decrypted.second.fill(0)

        if (decoyPin.isNotBlank()) {
            if (decoyPin.length < 4 || decoyPin == realPin) return "INVALID_DECOY"
            val sr = SecureRandom()
            val decoySalt = ByteArray(16).also { sr.nextBytes(it) }
            val decoyKey = deriveSlotKeyBytes(decoyPin, decoySalt)
            val decoyJson = "{\"dossier\":{\"goal\":\"maintenance\",\"region\":\"Чернигов\"},\"events\":[],\"water\":0,\"food\":{\"totalB\":0,\"totalF\":0,\"totalU\":0,\"totalKcal\":0},\"bodyBattery\":88}"
            writeFullFixedSlot(1, decoySalt, decoyKey, decoyJson.toByteArray(Charsets.UTF_8))
            decoyKey.fill(0)
        } else {
            writeRandomDummySlot1()
        }

        val editor = metaPrefs.edit()
        if (panicPin.isNotBlank()) {
            if (panicPin.length < 4 || panicPin == realPin || panicPin == decoyPin) return "INVALID_PANIC"
            editor.putString("panic_mac", computePanicMac(panicPin))
        } else {
            editor.remove("panic_mac")
        }
        editor.apply()
        return "OK"
    }

    private fun isPanicPin(pin: String): Boolean {
        val storedHex = metaPrefs.getString("panic_mac", null) ?: return false
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        val pKey = ks.getKey(panicAlias, null) as? SecretKey ?: return false
        val mac = Mac.getInstance("HmacSHA256").apply { init(pKey) }
        val digest = mac.doFinal(pin.toByteArray(Charsets.UTF_8))
            .joinToString("") { "%02x".format(it) }
        return MessageDigest.isEqual(digest.toByteArray(), storedHex.toByteArray())
    }

    @Synchronized
    fun executeCryptoShredding() {
        clearSessionInRam()
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        if (ks.containsAlias(keyAlias)) ks.deleteEntry(keyAlias)
        if (ks.containsAlias(panicAlias)) ks.deleteEntry(panicAlias)
        ensureHardwareKeys()

        if (vaultFile.exists()) {
            RandomAccessFile(vaultFile, "rw").use { raf ->
                val noise = ByteArray(65536)
                val sr = SecureRandom()
                val chunks = (slotSize * 2) / noise.size
                raf.seek(0)
                repeat(chunks) {
                    sr.nextBytes(noise)
                    raf.write(noise)
                }
                raf.fd.sync()
            }
            vaultFile.delete()
        }
        metaPrefs.edit().clear().apply()
        Handler(Looper.getMainLooper()).post {
            try {
                WebStorage.getInstance().deleteAllData()
            } catch (_: Exception) {
            }
        }
    }
}
