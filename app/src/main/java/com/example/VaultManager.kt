package com.example

import android.content.Context
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
    private val slotSize = 4 * 1024 * 1024 // 4 MB per slot (8 MB total)
    private val pbkdf2Iterations = 120_000

    init {
        ensureHardwareKeys()
    }

    fun isInitialized(): Boolean {
        return vaultFile.exists() && metaPrefs.getBoolean("vault_ready", false)
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
        if (!vaultFile.exists() || vaultFile.length() < slotSize * 2L) {
            RandomAccessFile(vaultFile, "rw").use { raf ->
                val buf = ByteArray(65536)
                val sr = SecureRandom()
                val chunks = (slotSize * 2) / buf.size
                repeat(chunks) {
                    sr.nextBytes(buf)
                    raf.write(buf)
                }
                raf.fd.sync()
            }
        }
    }

    private fun deriveSlotKey(pin: String, salt: ByteArray): SecretKeySpec {
        val spec = PBEKeySpec(pin.toCharArray(), salt, pbkdf2Iterations, 256)
        val pbkdf2Bytes = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256")
            .generateSecret(spec).encoded
        spec.clearPassword()

        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        val hwKey = ks.getKey(keyAlias, null) as SecretKey
        val mac = Mac.getInstance("HmacSHA256").apply { init(hwKey) }
        val finalKey = mac.doFinal(pbkdf2Bytes)
        pbkdf2Bytes.fill(0)
        return SecretKeySpec(finalKey, "AES")
    }

    private fun computePanicMac(pin: String): String {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        val pKey = ks.getKey(panicAlias, null) as SecretKey
        val mac = Mac.getInstance("HmacSHA256").apply { init(pKey) }
        return mac.doFinal(pin.toByteArray(Charsets.UTF_8))
            .joinToString("") { "%02x".format(it) }
    }

    @Synchronized
    fun setupVault(realPin: String, decoyPin: String, panicPin: String, initialRealJson: String): Boolean {
        if (realPin.isBlank() || decoyPin.isBlank() || realPin == decoyPin) return false
        if (panicPin.isNotBlank() && (panicPin == realPin || panicPin == decoyPin)) return false

        ensureHardwareKeys()
        ensureVaultContainer()

        writeSlot(0, realPin, initialRealJson.toByteArray(Charsets.UTF_8))
        val decoyJson = "{\"dossier\":{\"goal\":\"maintenance\"},\"events\":[],\"water\":0,\"food\":{\"totalB\":0,\"totalF\":0,\"totalU\":0,\"totalKcal\":0},\"bodyBattery\":90}"
        writeSlot(1, decoyPin, decoyJson.toByteArray(Charsets.UTF_8))

        val editor = metaPrefs.edit().putBoolean("vault_ready", true)
        if (panicPin.isNotBlank()) {
            editor.putString("panic_mac", computePanicMac(panicPin))
        } else {
            editor.remove("panic_mac")
        }
        editor.apply()
        return true
    }

    @Synchronized
    fun writeSlot(slotIndex: Int, pin: String, jsonPayload: ByteArray) {
        require(slotIndex in 0..1)
        ensureVaultContainer()

        val sr = SecureRandom()
        val salt = ByteArray(16).also { sr.nextBytes(it) }
        val iv = ByteArray(12).also { sr.nextBytes(it) }
        val key = deriveSlotKey(pin, salt)

        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key, GCMParameterSpec(128, iv))
        val lenBytes = ByteBuffer.allocate(4).putInt(jsonPayload.size).array()
        val plainCombined = lenBytes + jsonPayload
        require(plainCombined.size <= slotSize - 64) { "State exceeds vault slot size" }
        val ciphertext = cipher.doFinal(plainCombined)

        RandomAccessFile(vaultFile, "rw").use { raf ->
            raf.seek((slotIndex * slotSize).toLong())
            raf.write(salt)
            raf.write(iv)
            raf.writeInt(ciphertext.size)
            raf.write(ciphertext)
            raf.fd.sync()
        }
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

        RandomAccessFile(vaultFile, "r").use { raf ->
            for (slot in 0..1) {
                raf.seek((slot * slotSize).toLong())
                val salt = ByteArray(16).also { raf.readFully(it) }
                val iv = ByteArray(12).also { raf.readFully(it) }
                val cLen = raf.readInt()
                if (cLen <= 16 || cLen > slotSize - 32) continue
                val ciphertext = ByteArray(cLen).also { raf.readFully(it) }

                try {
                    val key = deriveSlotKey(pin, salt)
                    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
                    cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, iv))
                    val plain = cipher.doFinal(ciphertext)
                    val actualLen = ByteBuffer.wrap(plain, 0, 4).int
                    if (actualLen < 0 || actualLen > plain.size - 4) continue
                    val jsonStr = String(plain, 4, actualLen, Charsets.UTF_8)
                    out.put("status", "OK")
                    out.put("slot", slot)
                    out.put("stateJson", jsonStr)
                    return out.toString()
                } catch (_: Exception) {
                    // Wrong PIN for this slot
                }
            }
        }

        out.put("status", "DENIED")
        return out.toString()
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
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        if (ks.containsAlias(keyAlias)) ks.deleteEntry(keyAlias)
        if (ks.containsAlias(panicAlias)) ks.deleteEntry(panicAlias)
        ensureHardwareKeys()

        if (vaultFile.exists()) {
            RandomAccessFile(vaultFile, "rw").use { raf ->
                val noise = ByteArray(4096)
                val sr = SecureRandom()
                sr.nextBytes(noise)
                raf.seek(0)
                raf.write(noise)
                sr.nextBytes(noise)
                raf.seek(slotSize.toLong())
                raf.write(noise)
                raf.fd.sync()
            }
            vaultFile.delete()
        }
        metaPrefs.edit().clear().apply()
        android.os.Handler(android.os.Looper.getMainLooper()).post {
            try {
                WebStorage.getInstance().deleteAllData()
            } catch (_: Exception) {
            }
        }
    }
}
